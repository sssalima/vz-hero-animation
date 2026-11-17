/**
 * Second stage of usd2glb.py: optimise a raw glTF for the web with gltf-transform.
 *
 *   node tools/simready/optimize.mjs in.gltf out.glb [--ratio 0.5] [--error 0.002] [--tex 256]
 *
 * Needs @gltf-transform/{core,extensions,functions}, meshoptimizer and sharp resolvable
 * from this folder (e.g. `pnpm add` them in a scratch dir and symlink its node_modules here).
 *
 * - tiling / UDIM colour maps are averaged into baseColorFactor (detail is sub-pixel at hero scale)
 * - remaining colour maps are resized and re-encoded as WebP
 * - weld, meshoptimizer simplification, prune/dedup, quantize + EXT_meshopt_compression
 */
import { NodeIO } from "@gltf-transform/core"
import { ALL_EXTENSIONS, EXTTextureWebP } from "@gltf-transform/extensions"
import { dedup, meshopt, prune, simplify, weld } from "@gltf-transform/functions"
import { MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer"
import sharp from "sharp"

const [input, output, ...rest] = process.argv.slice(2)
const opt = { ratio: 0.5, error: 0.002, tex: 256 }
for (let i = 0; i < rest.length; i += 2) opt[rest[i].replace(/^--/, "")] = Number(rest[i + 1])

await MeshoptEncoder.ready
await MeshoptSimplifier.ready
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ "meshopt.encoder": MeshoptEncoder })
const doc = await io.read(input)
const root = doc.getRoot()

const toLinear = (c) => {
  const s = c / 255
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

let webp = false
const encoded = new Map()
for (const mat of root.listMaterials()) {
  const tex = mat.getBaseColorTexture()
  if (!tex) continue
  const img = tex.getImage()
  if (!img) {
    mat.setBaseColorTexture(null)
    continue
  }
  const flatten = mat.getExtras()?.flatten
  if (flatten) {
    const { channels } = await sharp(img).stats()
    const f = mat.getBaseColorFactor()
    mat.setBaseColorFactor([
      f[0] * toLinear(channels[0].mean),
      f[1] * toLinear(channels[1]?.mean ?? channels[0].mean),
      f[2] * toLinear(channels[2]?.mean ?? channels[0].mean),
      f[3],
    ])
    mat.setBaseColorTexture(null)
    continue
  }
  if (!encoded.has(tex)) {
    const buf = await sharp(img)
      .resize(opt.tex, opt.tex, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer()
    tex.setImage(new Uint8Array(buf)).setMimeType("image/webp")
    tex.setURI(tex.getURI().replace(/\.[a-z]+$/i, ".webp"))
    encoded.set(tex, true)
    webp = true
  }
}
for (const mat of root.listMaterials()) mat.setExtras({})
if (webp) doc.createExtension(EXTTextureWebP).setRequired(true)

await doc.transform(
  prune(),
  dedup(),
  weld(),
  simplify({ simplifier: MeshoptSimplifier, ratio: opt.ratio, error: opt.error }),
  prune(),
  meshopt({ encoder: MeshoptEncoder, level: "medium" }),
)

let tris = 0
for (const m of root.listMeshes())
  for (const p of m.listPrimitives()) tris += (p.getIndices()?.getCount() ?? 0) / 3
await io.write(output, doc)
const { size } = await import("node:fs").then((fs) => fs.statSync(output))
console.log(`    -> ${output.split("/").pop()} ${Math.round(tris)} tris, ${(size / 1024).toFixed(0)} KB`)
