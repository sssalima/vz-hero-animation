/**
 * Normalise fetched models (tools/assets/incoming) into scene-ready GLBs.
 *
 *   node tools/assets/ingest.mjs --review [slot | slot.id ...]   every candidate -> tools/assets/_review/<slot>.<id>.glb
 *   node tools/assets/ingest.mjs [slot ...]                      picked candidate -> public/models/<slot>.glb + src/scene/assetMeta.ts
 *   node tools/assets/ingest.mjs --meta                         only regenerate src/scene/assetMeta.ts (after editing a GLB by hand)
 *
 * Per model (all steps driven by tools/assets/sources.json, see README.md):
 *  1. spec-gloss -> metal-rough, dequantise, un-instance; every primitive baked to world space
 *  2. orientation fix (`up`), long axis aligned to +x (`align`), extra `yaw`
 *  3. ground / shadow planes and `strip` matches removed
 *  4. real-world scale from `size` (length = x, height = y, width = z), centred on x/z, base at y = 0
 *     (`keepY` keeps the source ground line, e.g. stairs that go below street level); `crop` then
 *     keeps only the triangles inside a box
 *  5. materials remapped to palette roles (glass / rubber / chrome / tone / foliage ...); colour
 *     textures flattened to their average, palette atlases baked to vertex colours, foliage kept;
 *     near-black bodies lifted so they read in the greyscale scenes
 *  6. `parts` (by name or by box) split into pivoted child nodes for animation
 *  7. merged per material, simplified to the slot's triangle budget, creased normals
 *  8. WebP textures, meshopt compression
 */
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { NodeIO, Primitive } from "@gltf-transform/core"
import { ALL_EXTENSIONS, EXTTextureWebP } from "@gltf-transform/extensions"
import {
  compactPrimitive,
  dedup,
  dequantize,
  joinPrimitives,
  meshopt,
  metalRough,
  prune,
  simplifyPrimitive,
  transformPrimitive,
  uninstance,
  unweldPrimitive,
  weldPrimitive,
} from "@gltf-transform/functions"
import {
  MeshoptDecoder,
  MeshoptEncoder,
  MeshoptSimplifier,
} from "meshoptimizer"
import sharp from "sharp"
import { rawPath, readManifest, select } from "./fetch.mjs"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../..")
const MODELS = path.join(ROOT, "public", "models")
const REVIEW = path.join(HERE, "_review")
const META = path.join(HERE, "meta.json")
const META_TS = path.join(ROOT, "src", "scene", "assetMeta.ts")

// ------------------------------------------------------------------ palette (matches src/scene/common.tsx PAL)

const srgb = (hex) => {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
}
const ROLES = {
  paint: { color: srgb("#c9cdd1"), rough: 0.35, metal: 0.35 },
  white: { color: srgb("#e9ecee"), rough: 0.55, metal: 0 },
  panel: { color: srgb("#d4d8dc"), rough: 0.55, metal: 0.05 },
  light: { color: srgb("#b9bfc5"), rough: 0.5, metal: 0.1 },
  mid: { color: srgb("#8f979f"), rough: 0.45, metal: 0.3 },
  steel: { color: srgb("#7d858d"), rough: 0.4, metal: 0.55 },
  dark: { color: srgb("#3a3f45"), rough: 0.55, metal: 0.2 },
  black: { color: srgb("#16191c"), rough: 0.5, metal: 0.1 },
  rubber: { color: srgb("#121416"), rough: 0.85, metal: 0 },
  glass: { color: srgb("#2b3238"), rough: 0.08, metal: 0.4 },
  chrome: { color: srgb("#b0b6bc"), rough: 0.22, metal: 0.85 },
  concrete: { color: srgb("#c9ccce"), rough: 0.9, metal: 0 },
  wood: { color: srgb("#8a6a48"), rough: 0.8, metal: 0 },
}
const ROLE_RULES = [
  [
    /glass|window|windshield|windscreen|\bglas\b|vidrio|cristal|scheibe|lens/i,
    "glass",
  ],
  [/tire|tyre|rubber|pneu|reifen/i, "rubber"],
  [/chrome|chrom\b|mirror/i, "chrome"],
  [/leaf|leaves|foliage|needle|twig|blatt/i, "foliage"],
]
const GROUND_NAMES =
  /shadow|ground|terrain|backdrop|baseplate|base_plate|grass_?plane|\bplane\b|floor_?plane/i
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]

// ------------------------------------------------------------------ 4x4 helpers (column-major)

const I = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
function mul(a, b) {
  const o = new Array(16).fill(0)
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]
  return o
}
const rot = (axis, deg) => {
  const t = (deg * Math.PI) / 180
  const c = Math.cos(t)
  const s = Math.sin(t)
  if (axis === "x") return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]
  if (axis === "y") return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]
  return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
}
const TS = (t, s = [1, 1, 1]) => [
  s[0],
  0,
  0,
  0,
  0,
  s[1],
  0,
  0,
  0,
  0,
  s[2],
  0,
  t[0],
  t[1],
  t[2],
  1,
]

function bounds(prims) {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (const p of prims) {
    const a = p.getAttribute("POSITION").getArray()
    for (let i = 0; i < a.length; i += 3)
      for (let k = 0; k < 3; k++) {
        if (a[i + k] < min[k]) min[k] = a[i + k]
        if (a[i + k] > max[k]) max[k] = a[i + k]
      }
  }
  return { min, max, size: max.map((v, k) => v - min[k]) }
}

const triCount = (p) =>
  (p.getIndices()
    ? p.getIndices().getCount()
    : p.getAttribute("POSITION").getCount()) / 3

function area(p) {
  const pos = p.getAttribute("POSITION").getArray()
  const idx = p.getIndices()?.getArray()
  const n = idx ? idx.length : pos.length / 3
  let sum = 0
  for (let i = 0; i < n; i += 3) {
    const [a, b, c] = idx ? [idx[i], idx[i + 1], idx[i + 2]] : [i, i + 1, i + 2]
    const ux = pos[b * 3] - pos[a * 3],
      uy = pos[b * 3 + 1] - pos[a * 3 + 1],
      uz = pos[b * 3 + 2] - pos[a * 3 + 2]
    const vx = pos[c * 3] - pos[a * 3],
      vy = pos[c * 3 + 1] - pos[a * 3 + 1],
      vz = pos[c * 3 + 2] - pos[a * 3 + 2]
    sum +=
      Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2
  }
  return sum
}

// ------------------------------------------------------------------ primitives

function ensureIndices(doc, p) {
  if (p.getIndices()) return
  const n = p.getAttribute("POSITION").getCount()
  p.setIndices(
    doc
      .createAccessor()
      .setType("SCALAR")
      .setArray(Uint32Array.from({ length: n }, (_, i) => i)),
  )
}

/** Primitive copy with its own accessors, so transforms never touch shared data. */
function deepClone(doc, prim) {
  const p = doc
    .createPrimitive()
    .setMode(prim.getMode())
    .setMaterial(prim.getMaterial())
  for (const sem of prim.listSemantics()) {
    const src = prim.getAttribute(sem)
    p.setAttribute(
      sem,
      doc
        .createAccessor()
        .setType(src.getType())
        .setArray(src.getArray().slice())
        .setNormalized(src.getNormalized()),
    )
  }
  const idx = prim.getIndices()
  if (idx)
    p.setIndices(
      doc
        .createAccessor()
        .setType("SCALAR")
        .setArray(Uint32Array.from(idx.getArray())),
    )
  ensureIndices(doc, p)
  return p
}

/**
 * Split a primitive's triangles by predicate(point) -> [inside, outside] (either may be null).
 * Tested on the centroid, or with `all` on every vertex (so big faces crossing the region stay out).
 */
function splitByCentroid(doc, prim, inside, all = false) {
  const pos = prim.getAttribute("POSITION").getArray()
  const idx = prim.getIndices().getArray()
  const a = []
  const b = []
  const vert = (j) => [pos[j * 3], pos[j * 3 + 1], pos[j * 3 + 2]]
  for (let i = 0; i < idx.length; i += 3) {
    const c = [0, 1, 2].map(
      (k) =>
        (pos[idx[i] * 3 + k] +
          pos[idx[i + 1] * 3 + k] +
          pos[idx[i + 2] * 3 + k]) /
        3,
    )
    const hit = all
      ? inside(vert(idx[i])) && inside(vert(idx[i + 1])) && inside(vert(idx[i + 2]))
      : inside(c)
    ;(hit ? a : b).push(idx[i], idx[i + 1], idx[i + 2])
  }
  const make = (list) => {
    if (!list.length) return null
    const p = deepClone(doc, prim)
    p.getIndices().setArray(Uint32Array.from(list))
    compactPrimitive(p)
    return p
  }
  return [make(a), make(b)]
}

/** Unweld, area-weighted normals within `crease` degrees of each face, weld again. */
function creaseNormals(doc, prim, crease = 38) {
  unweldPrimitive(prim)
  const pos = prim.getAttribute("POSITION").getArray()
  const n = pos.length / 3
  const nt = n / 3
  const fn = new Float32Array(nt * 3)
  const fa = new Float32Array(nt)
  for (let t = 0; t < nt; t++) {
    const a = t * 9
    const ux = pos[a + 3] - pos[a],
      uy = pos[a + 4] - pos[a + 1],
      uz = pos[a + 5] - pos[a + 2]
    const vx = pos[a + 6] - pos[a],
      vy = pos[a + 7] - pos[a + 1],
      vz = pos[a + 8] - pos[a + 2]
    const cx = uy * vz - uz * vy,
      cy = uz * vx - ux * vz,
      cz = ux * vy - uy * vx
    const l = Math.hypot(cx, cy, cz)
    fa[t] = l / 2
    if (l > 0) fn.set([cx / l, cy / l, cz / l], t * 3)
  }
  const groups = new Map()
  const keys = new Array(n)
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(pos[i * 3] * 2e4)},${Math.round(pos[i * 3 + 1] * 2e4)},${Math.round(pos[i * 3 + 2] * 2e4)}`
    keys[i] = k
    let g = groups.get(k)
    if (!g) groups.set(k, (g = []))
    g.push((i / 3) | 0)
  }
  const cos = Math.cos((crease * Math.PI) / 180)
  const out = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    const t = (i / 3) | 0
    let x = 0,
      y = 0,
      z = 0
    for (const t2 of groups.get(keys[i])) {
      const d =
        fn[t * 3] * fn[t2 * 3] +
        fn[t * 3 + 1] * fn[t2 * 3 + 1] +
        fn[t * 3 + 2] * fn[t2 * 3 + 2]
      if (d >= cos) {
        x += fn[t2 * 3] * fa[t2]
        y += fn[t2 * 3 + 1] * fa[t2]
        z += fn[t2 * 3 + 2] * fa[t2]
      }
    }
    const l = Math.hypot(x, y, z)
    if (l > 0) out.set([x / l, y / l, z / l], i * 3)
    else out.set([fn[t * 3], fn[t * 3 + 1], fn[t * 3 + 2] || 1], i * 3)
  }
  prim.setAttribute(
    "NORMAL",
    doc.createAccessor().setType("VEC3").setArray(out),
  )
  weldPrimitive(prim)
}

// ------------------------------------------------------------------ textures

const toLin = (c) => {
  const s = c / 255
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}
const imageCache = new Map()
async function decode(texture, size = 256) {
  const key = `${size}|${texture.getURI()}|${texture.getImage()?.byteLength}`
  if (imageCache.has(key)) return imageCache.get(key)
  let out = null
  try {
    const { data, info } = await sharp(texture.getImage())
      .resize(size, size, { fit: "fill" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    out = { data, w: info.width, h: info.height }
  } catch {
    out = null
  }
  imageCache.set(key, out)
  return out
}

async function textureStats(texture) {
  const img = await decode(texture, 64)
  if (!img) return null
  const { data } = img
  const sum = [0, 0, 0]
  const colors = new Set()
  let clear = 0
  const n = data.length / 4
  for (let i = 0; i < data.length; i += 4) {
    for (let k = 0; k < 3; k++) sum[k] += toLin(data[i + k])
    colors.add(
      ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3),
    )
    if (data[i + 3] < 128) clear++
  }
  return { mean: sum.map((s) => s / n), unique: colors.size, clear: clear / n }
}

// ------------------------------------------------------------------ materials

async function analyse(material, cand, cache) {
  if (cache.has(material)) return cache.get(material)
  const name = material?.getName() ?? ""
  const factor = material?.getBaseColorFactor() ?? [1, 1, 1, 1]
  const tex = material?.getBaseColorTexture() ?? null
  const stats = tex ? await textureStats(tex) : null
  const alphaMode = material?.getAlphaMode() ?? "OPAQUE"
  let role = null
  for (const [rx, r] of cand.materials ?? [])
    if (new RegExp(rx, "i").test(name)) role = r
  if (!role) for (const [rx, r] of ROLE_RULES) if (rx.test(name)) role = r
  if (!role && stats && alphaMode !== "OPAQUE" && stats.clear > 0.2)
    role = "foliage"
  if (!role && alphaMode === "BLEND" && factor[3] < 0.9 && !tex) role = "glass"
  if (role === "foliage" && !stats) role = "tone"
  if (!role) role = "tone"
  let mode = role === "foliage" ? "keep" : "flat"
  if (role === "tone" && stats && stats.unique <= 40) mode = "vertex"
  if (cand.texture && role === "tone")
    mode = cand.texture === "keep" && !stats ? "flat" : cand.texture
  if (cand.texture === "keep" && role === "foliage") mode = "keep"
  const color =
    stats && mode === "flat"
      ? factor.slice(0, 3).map((f, k) => f * stats.mean[k])
      : factor.slice(0, 3)
  const info = {
    role,
    mode,
    color,
    rough: Math.min(
      0.85,
      Math.max(0.35, material?.getRoughnessFactor() ?? 0.55),
    ),
    metal: Math.min(0.3, material?.getMetallicFactor() ?? 0),
    doubleSided: !!material?.getDoubleSided(),
    texture: tex,
    texCoord: material?.getBaseColorTextureInfo()?.getTexCoord() ?? 0,
  }
  cache.set(material, info)
  return info
}

async function bakeVertexColors(doc, prim, info) {
  const img = await decode(info.texture, 256)
  const uv = prim.getAttribute(`TEXCOORD_${info.texCoord}`)
  if (!img || !uv) return false
  const n = prim.getAttribute("POSITION").getCount()
  const out = new Float32Array(n * 3)
  const prev = prim.getAttribute("COLOR_0")
  const t = [0, 0]
  const c = [0, 0, 0, 1]
  for (let i = 0; i < n; i++) {
    uv.getElement(i, t)
    const u = t[0] - Math.floor(t[0])
    const v = t[1] - Math.floor(t[1])
    const px = Math.min(img.w - 1, Math.floor(u * img.w))
    const py = Math.min(img.h - 1, Math.floor(v * img.h))
    const o = (py * img.w + px) * 4
    if (prev) prev.getElement(i, c)
    for (let k = 0; k < 3; k++)
      out[i * 3 + k] =
        toLin(img.data[o + k]) * info.color[k] * (prev ? c[k] : 1)
  }
  prim.setAttribute(
    "COLOR_0",
    doc.createAccessor().setType("VEC3").setArray(out),
  )
  return true
}

/** Normalise COLOR_0 to float VEC3; returns its mean if nearly uniform (then the attribute is dropped). */
function normaliseVertexColor(doc, prim) {
  const acc = prim.getAttribute("COLOR_0")
  if (!acc) return null
  const n = acc.getCount()
  const out = new Float32Array(n * 3)
  const c = [0, 0, 0, 1]
  const mean = [0, 0, 0]
  for (let i = 0; i < n; i++) {
    acc.getElement(i, c)
    for (let k = 0; k < 3; k++) {
      out[i * 3 + k] = c[k]
      mean[k] += c[k] / n
    }
  }
  let dev = 0
  for (let i = 0; i < n; i++)
    for (let k = 0; k < 3; k++)
      dev = Math.max(dev, Math.abs(out[i * 3 + k] - mean[k]))
  if (dev < 0.04) {
    prim.setAttribute("COLOR_0", null)
    return mean
  }
  prim.setAttribute(
    "COLOR_0",
    doc.createAccessor().setType("VEC3").setArray(out),
  )
  return null
}

// ------------------------------------------------------------------ main pipeline

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    "meshopt.encoder": MeshoptEncoder,
    "meshopt.decoder": MeshoptDecoder,
  })

export async function ingest(slot, def, cand, outFile) {
  const notes = []
  const doc = await io.read(rawPath(slot, cand))
  const root = doc.getRoot()
  const used = root.listExtensionsUsed().map((e) => e.extensionName)
  if (used.includes("KHR_materials_pbrSpecularGlossiness"))
    await doc.transform(metalRough())
  await doc.transform(dequantize(), uninstance())
  for (const a of root.listAnimations()) {
    for (const s of a.listSamplers()) s.dispose()
    for (const c of a.listChannels()) c.dispose()
    a.dispose()
  }
  for (const node of root.listNodes()) node.setSkin(null)

  // 1. bake every triangle primitive to world space (with the up-axis fix)
  let pre = I()
  if (cand.up === "z") pre = rot("x", -90)
  else if (cand.up === "-z") pre = rot("x", 90)
  else if (cand.up === "x") pre = rot("z", 90)
  // extra tilt fixes for sources modelled leaning or standing up: [["x", deg], ...] in order
  for (const [axis, deg] of cand.rotate ?? []) pre = mul(rot(axis, deg), pre)
  const stripRx = cand.strip ? new RegExp(cand.strip, "i") : null
  let items = []
  const scene = root.getDefaultScene() ?? root.listScenes()[0]
  const visit = (node) => {
    const mesh = node.getMesh()
    if (mesh) {
      const wm = mul(pre, node.getWorldMatrix())
      for (const prim of mesh.listPrimitives()) {
        if (
          prim.getMode() !== Primitive.Mode.TRIANGLES ||
          !prim.getAttribute("POSITION")
        )
          continue
        const names = [
          node.getName(),
          mesh.getName(),
          prim.getMaterial()?.getName() ?? "",
        ].join(" | ")
        if (stripRx?.test(names)) continue
        const p = deepClone(doc, prim)
        transformPrimitive(p, wm)
        items.push({ prim: p, names, material: prim.getMaterial() })
      }
    }
    for (const c of node.listChildren()) visit(c)
  }
  for (const c of scene.listChildren()) visit(c)
  if (stripRx) notes.push(`stripped /${cand.strip}/`)
  for (const s of root.listScenes()) s.dispose()
  for (const n of root.listNodes()) n.dispose()
  for (const m of root.listMeshes()) m.dispose()
  if (!items.length) throw new Error("no triangle geometry")

  // 2. ground / shadow planes: flat, at the bottom, and wider than everything else
  for (let pass = 0; pass < 3; pass++) {
    const all = bounds(items.map((i) => i.prim))
    const H = all.size[1]
    const drop = items.filter((it) => {
      const b = bounds([it.prim])
      const flat =
        b.size[1] < Math.max(0.02 * H, 1e-6) &&
        b.min[1] <= all.min[1] + 0.02 * H
      if (!flat || cand.ground === "keep") return false
      const rest = items.filter((o) => o !== it)
      if (!rest.length) return false
      const r = bounds(rest.map((o) => o.prim))
      const wider = b.size[0] > r.size[0] * 1.08 || b.size[2] > r.size[2] * 1.08
      const covers = b.size[0] * b.size[2] > 0.4 * r.size[0] * r.size[2]
      return (
        wider ||
        (covers && (GROUND_NAMES.test(it.names) || triCount(it.prim) <= 200))
      )
    })
    if (!drop.length) break
    items = items.filter((i) => !drop.includes(i))
    notes.push(
      `ground removed (${drop.map((d) => d.names.split(" | ")[0] || "plane").join(", ")})`,
    )
  }

  // 3. orientation + scale
  let b = bounds(items.map((i) => i.prim))
  let orient = I()
  if (
    def.align !== false &&
    cand.align !== false &&
    b.size[2] > b.size[0] * 1.05
  ) {
    orient = rot("y", 90)
    notes.push("long axis -> x")
  }
  if (cand.yaw) orient = mul(rot("y", cand.yaw), orient)
  for (const it of items) transformPrimitive(it.prim, orient)
  b = bounds(items.map((i) => i.prim))
  // `size: null` on a candidate keeps the source's own (metre) scale
  const size = "size" in cand ? cand.size : def.size
  let s = 1
  if (size?.length) s = size.length / b.size[0]
  else if (size?.height) s = size.height / b.size[1]
  else if (size?.width) s = size.width / b.size[2]
  else if (Math.max(...b.size) > 400) {
    s = 0.01
    notes.push("assumed cm")
  }
  s *= cand.scale ?? 1
  const c = [
    (b.min[0] + b.max[0]) / 2,
    cand.keepY ? 0 : b.min[1],
    (b.min[2] + b.max[2]) / 2,
  ]
  const norm = mul(TS([0, 0, 0], [s, s, s]), TS([-c[0], -c[1], -c[2]]))
  for (const it of items) transformPrimitive(it.prim, norm)
  b = bounds(items.map((i) => i.prim))

  // 3b. crop to a box (normalised metres): one head of a multi-head signal, the back half of a tube
  if (cand.crop) {
    const [lo, hi] = cand.crop.box
    const inside = (p) => p.every((v, k) => v >= lo[k] && v <= hi[k])
    const kept = []
    for (const it of items) {
      const [a, rest] = splitByCentroid(doc, it.prim, inside)
      it.prim.dispose()
      rest?.dispose()
      if (a) kept.push({ ...it, prim: a })
    }
    if (!kept.length) throw new Error("crop box is empty")
    items = kept
    b = bounds(items.map((i) => i.prim))
    if (cand.crop.center) {
      const cc = [
        (b.min[0] + b.max[0]) / 2,
        cand.keepY ? 0 : b.min[1],
        (b.min[2] + b.max[2]) / 2,
      ]
      for (const it of items) transformPrimitive(it.prim, TS(cc.map((v) => -v)))
      b = bounds(items.map((i) => i.prim))
    }
    notes.push("cropped")
  }

  // 4. materials -> palette roles
  const cache = new Map()
  for (const it of items) it.info = await analyse(it.material, cand, cache)
  const finals = []
  for (const it of items) {
    const { info, prim } = it
    for (const sem of prim.listSemantics())
      if (/^(TANGENT|JOINTS_|WEIGHTS_)/.test(sem)) prim.setAttribute(sem, null)
    for (const t of prim.listTargets()) prim.removeTarget(t)
    let color = info.color
    let role = info.role
    if (
      role === "tone" &&
      info.mode === "vertex" &&
      !(await bakeVertexColors(doc, prim, info))
    )
      color = info.color
    if (
      role === "tone" &&
      info.mode === "vertex" &&
      prim.getAttribute("COLOR_0")
    )
      color = [1, 1, 1]
    const uniform = normaliseVertexColor(doc, prim)
    if (uniform) color = color.map((v, k) => v * uniform[k])
    if (role !== "tone" && role !== "foliage")
      prim.setAttribute("COLOR_0", null)
    // `brighten`: lift dark / weathered source colours (linear multiplier, clamped)
    if (cand.brighten && role === "tone") {
      color = color.map((v) => Math.min(1, v * cand.brighten))
      const vc = prim.getAttribute("COLOR_0")
      if (vc)
        vc.setArray(vc.getArray().map((v) => Math.min(1, v * cand.brighten)))
    }
    const keepUV = role === "foliage" && info.mode === "keep"
    const uv = keepUV ? prim.getAttribute(`TEXCOORD_${info.texCoord}`) : null
    for (const sem of prim.listSemantics())
      if (sem.startsWith("TEXCOORD_") || sem === "NORMAL")
        prim.setAttribute(sem, null)
    if (uv) prim.setAttribute("TEXCOORD_0", uv)
    it.final = {
      role,
      color,
      rough: info.rough,
      metal: info.metal,
      doubleSided: info.doubleSided || role === "foliage",
      texture: keepUV ? info.texture : null,
    }
    it.area = area(prim)
    finals.push(it)
  }
  // near-black bodies (dark textures / unlit exports) read as holes in the greyscale scenes
  const totalArea = finals.reduce((a, i) => a + i.area, 0)
  const darkArea = finals
    .filter(
      (i) =>
        i.final.role === "tone" &&
        !i.prim.getAttribute("COLOR_0") &&
        lum(i.final.color) < 0.012,
    )
    .reduce((a, i) => a + i.area, 0)
  if (darkArea > 0.35 * totalArea && cand.keepDark !== true) {
    for (const i of finals)
      if (
        i.final.role === "tone" &&
        !i.prim.getAttribute("COLOR_0") &&
        lum(i.final.color) < 0.012
      )
        i.final.color = ROLES.mid.color
    notes.push("dark body lifted")
  }
  for (const i of finals) {
    const r = ROLES[i.final.role]
    if (r)
      Object.assign(i.final, { color: r.color, rough: r.rough, metal: r.metal })
  }

  // source size for the decimation budget (box splits below dispose the original primitives)
  const srcTris = finals.reduce((a, i) => a + triCount(i.prim), 0)

  // 5. parts
  const parts = (cand.parts ?? def.parts ?? []).map((p) => ({
    ...p,
    items: [],
  }))
  let body = finals
  for (const part of parts) {
    const next = []
    for (const it of body) {
      if (part.match && new RegExp(part.match, "i").test(it.names))
        part.items.push(it)
      else if (part.box) {
        const [lo, hi] = part.box
        const [a, rest] = splitByCentroid(
          doc,
          it.prim,
          (p) => p.every((v, k) => v >= lo[k] && v <= hi[k]),
          part.contain === "all",
        )
        if (a) part.items.push({ ...it, prim: a })
        if (rest) next.push({ ...it, prim: rest })
        it.prim.dispose()
      } else next.push(it)
    }
    body = next
    if (!part.items.length) notes.push(`part "${part.name}" matched nothing`)
  }
  const groups = [{ name: "body", items: body, pivot: [0, 0, 0] }]
  for (const part of parts) {
    if (!part.items.length) continue
    const pb = bounds(part.items.map((i) => i.prim))
    const center = pb.min.map((v, k) => (v + pb.max[k]) / 2)
    const pivot = Array.isArray(part.pivot)
      ? part.pivot
      : part.pivot === "base"
        ? [center[0], pb.min[1], center[2]]
        : center
    for (const it of part.items)
      transformPrimitive(it.prim, TS(pivot.map((v) => -v)))
    groups.push({ name: part.name, items: part.items, pivot })
  }

  // 6. merge per material, simplify, normals
  const budget = cand.tris ?? def.tris ?? 20000
  const matCache = new Map()
  const material = (f) => {
    const key = JSON.stringify({
      ...f,
      color: f.color.map((v) => v.toFixed(3)),
      texture: f.texture ? f.texture.getURI() || "t" : null,
      vc: f.vc,
    })
    if (matCache.has(key)) return matCache.get(key)
    const m = doc
      .createMaterial(f.role)
      .setBaseColorFactor([...f.color, 1])
      .setRoughnessFactor(f.rough)
      .setMetallicFactor(f.metal)
      .setDoubleSided(f.doubleSided)
    if (f.texture)
      m.setBaseColorTexture(f.texture).setAlphaMode("MASK").setAlphaCutoff(0.5)
    matCache.set(key, m)
    return m
  }
  const outScene = doc.createScene(slot)
  const top = doc.createNode(slot)
  outScene.addChild(top)
  doc.getRoot().setDefaultScene(outScene)
  const stats = { tris: 0, parts: {} }
  for (const g of groups) {
    const byKey = new Map()
    for (const it of g.items) {
      it.final.vc = !!it.prim.getAttribute("COLOR_0")
      const key = JSON.stringify([
        it.final.role,
        it.final.color.map((v) => v.toFixed(3)),
        it.final.rough,
        it.final.metal,
        it.final.doubleSided,
        !!it.final.texture,
        it.final.vc,
      ])
      if (!byKey.has(key)) byKey.set(key, [])
      byKey.get(key).push(it)
    }
    const mesh = doc.createMesh(g.name)
    const gTris = g.items.reduce((a, i) => a + triCount(i.prim), 0)
    for (const list of byKey.values()) {
      const mat = material(list[0].final)
      for (const i of list) i.prim.setMaterial(mat)
      let prim =
        list.length > 1 ? joinPrimitives(list.map((i) => i.prim)) : list[0].prim
      if (list.length > 1) for (const i of list) i.prim.dispose()
      const target = Math.max(
        12,
        Math.round((budget * triCount(prim)) / Math.max(srcTris, 1)),
      )
      weldPrimitive(prim)
      for (const error of [0.002, 0.008, 0.02, 0.05, 0.1]) {
        if (triCount(prim) <= target * 1.15) break
        simplifyPrimitive(prim, {
          simplifier: MeshoptSimplifier,
          ratio: target / triCount(prim),
          error,
          lockBorder: false,
        })
      }
      if (!triCount(prim)) continue
      creaseNormals(doc, prim, cand.crease ?? 38)
      prim.setMaterial(mat)
      mesh.addPrimitive(prim)
    }
    const tris = mesh.listPrimitives().reduce((a, p) => a + triCount(p), 0)
    stats.tris += tris
    if (g.name === "body") top.addChild(doc.createNode(g.name).setMesh(mesh))
    else {
      // parts: the named node carries only the pivot; the mesh sits on a child node, because
      // quantization (step 7) folds each mesh's offset / scale into its own node's transform
      mesh.setName(`${g.name}_mesh`)
      const pivotNode = doc
        .createNode(g.name)
        .setTranslation(g.pivot.map((v) => +v.toFixed(4)))
        .addChild(doc.createNode(`${g.name}_mesh`).setMesh(mesh))
      top.addChild(pivotNode)
    }
    if (g.name !== "body")
      stats.parts[g.name] = { pivot: g.pivot.map((v) => +v.toFixed(3)), tris }
    void gTris
  }

  // 7. textures, cleanup, compression
  for (const m of root.listMaterials())
    if (!matCache.size || ![...matCache.values()].includes(m)) m.dispose()
  await doc.transform(
    prune({ keepAttributes: false, keepLeaves: false }),
    dedup(),
  )
  // animation sampler / morph data orphaned by step 1 can survive prune; drop anything unreferenced
  for (const acc of root.listAccessors())
    if (!acc.listParents().some((p) => p.propertyType !== "Root")) acc.dispose()
  let webp = false
  for (const t of root.listTextures()) {
    const buf = await sharp(t.getImage())
      .resize(256, 256, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80, alphaQuality: 90 })
      .toBuffer()
    t.setImage(new Uint8Array(buf))
      .setMimeType("image/webp")
      .setURI(`${slot}_${root.listTextures().indexOf(t)}.webp`)
    webp = true
  }
  for (const ext of root.listExtensionsUsed())
    if (
      ![
        "EXT_meshopt_compression",
        "KHR_mesh_quantization",
        "EXT_texture_webp",
      ].includes(ext.extensionName)
    )
      ext.dispose()
  if (webp) doc.createExtension(EXTTextureWebP).setRequired(true)
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: "medium" }))
  fs.mkdirSync(path.dirname(outFile), { recursive: true })
  await io.write(outFile, doc)
  return {
    tris: stats.tris,
    srcTris,
    parts: stats.parts,
    size: b.size.map((v) => +v.toFixed(3)),
    bytes: fs.statSync(outFile).size,
    materials: [
      ...new Set([...matCache.keys()].map((k) => JSON.parse(k).role)),
    ],
    notes,
  }
}

// ------------------------------------------------------------------ CLI

function writeAssetMeta(meta) {
  const entries = Object.entries(meta).sort(([a], [b]) => a.localeCompare(b))
  const body = entries
    .map(([slot, m]) => {
      const parts = Object.entries(m.parts || {})
        .map(([n, p]) => `${n}: [${p.pivot.join(", ")}]`)
        .join(", ")
      // content hash: models.ts appends it to the URL so a re-ingested model is never served
      // stale (from the loader's in-memory cache on hot reload, or from a browser / CDN cache)
      const file = path.join(MODELS, `${slot}.glb`)
      const hash = fs.existsSync(file)
        ? crypto.createHash("sha1").update(fs.readFileSync(file)).digest("hex").slice(0, 10)
        : ""
      return `  ${slot}: { size: [${m.size.join(", ")}], tris: ${m.tris}, hash: "${hash}", parts: { ${parts} } },`
    })
    .join("\n")
  fs.writeFileSync(
    META_TS,
    `// Generated by tools/assets/ingest.mjs — do not edit by hand.\n` +
      `/** Normalised size (metres: x = length, y = height, z = width), content hash and part pivots of each sourced model. */\n` +
      `export const ASSET_META = {\n${body}\n} as const satisfies Record<string, { size: readonly number[]; tris: number; hash: string; parts: Record<string, readonly number[]> }>\n\n` +
      `export type AssetSlot = keyof typeof ASSET_META\n`,
  )
}

async function main() {
  const args = process.argv.slice(2)
  const review = args.includes("--review")
  const names = args.filter((a) => !a.startsWith("--"))
  if (args.includes("--meta")) {
    // regenerate src/scene/assetMeta.ts (sizes, pivots, hashes) from meta.json without ingesting
    writeAssetMeta(JSON.parse(fs.readFileSync(META, "utf8")))
    return
  }
  const manifest = readManifest()
  await MeshoptEncoder.ready
  await MeshoptSimplifier.ready
  await MeshoptDecoder.ready
  let todo = select(manifest, names)
  if (!review) todo = todo.filter((t) => t.def.pick === t.cand.id)
  const indexFile = path.join(REVIEW, "index.json")
  const index =
    review && fs.existsSync(indexFile)
      ? JSON.parse(fs.readFileSync(indexFile, "utf8"))
      : {}
  const meta = fs.existsSync(META)
    ? JSON.parse(fs.readFileSync(META, "utf8"))
    : {}
  for (const { slot, def, cand, key } of todo) {
    const out = review
      ? path.join(REVIEW, `${key}.glb`)
      : path.join(MODELS, `${slot}.glb`)
    const entry = {
      slot,
      id: cand.id,
      source: cand.source,
      title: cand.title,
      author: cand.author,
      license: cand.license,
      url: cand.url,
      use: def.use,
      scene: def.scene,
      replaces: def.replaces,
      budget: cand.tris ?? def.tris,
    }
    if (!fs.existsSync(rawPath(slot, cand))) {
      Object.assign(entry, {
        status: cand.source === "upload" ? "awaiting upload" : "not fetched",
      })
      if (review) index[key] = entry
      console.log(`skip ${key.padEnd(24)} ${entry.status}`)
      continue
    }
    try {
      const st = await ingest(slot, def, cand, out)
      Object.assign(entry, st, { status: "ok", file: path.relative(ROOT, out) })
      console.log(
        `ok   ${key.padEnd(24)} ${String(st.srcTris).padStart(7)} -> ${String(st.tris).padStart(6)} tris  ${(st.bytes / 1024).toFixed(0).padStart(5)} KB  ${st.size.join(" x ")} m  ${st.notes.join("; ")}`,
      )
      if (!review)
        meta[slot] = {
          size: st.size,
          tris: st.tris,
          parts: st.parts,
          from: key,
        }
    } catch (e) {
      Object.assign(entry, { status: `error: ${e.message}` })
      console.log(`FAIL ${key.padEnd(24)} ${e.stack}`)
    }
    if (review) index[key] = entry
  }
  if (review) {
    fs.mkdirSync(REVIEW, { recursive: true })
    fs.writeFileSync(indexFile, JSON.stringify(index, null, 1))
  } else {
    fs.writeFileSync(META, JSON.stringify(meta, null, 2) + "\n")
    writeAssetMeta(meta)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
