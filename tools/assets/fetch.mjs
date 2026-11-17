/**
 * Download candidate models listed in tools/assets/sources.json into tools/assets/incoming/
 * (git-ignored) and record their title / author / licence back into the manifest so
 * credits.mjs can run from the repository alone.
 *
 *   node tools/assets/fetch.mjs                 every candidate
 *   node tools/assets/fetch.mjs car_sedan tree  whole slots
 *   node tools/assets/fetch.mjs tree.c          one candidate
 *
 * Sources
 * - objaverse: Sketchfab uploads mirrored by allenai/objaverse on Hugging Face (GLB + metadata)
 * - polyhaven: CC0 glTF from api.polyhaven.com (1k textures)
 * - nvidia:    SimReady USD via tools/simready/fetch.py + usd2glb.py (usd-core + numpy wheels unpacked
 *              into tools/.pydeps, see README.md)
 * - upload:    files you place in tools/assets/incoming/upload/<file>.{glb,gltf,obj,fbx}
 *
 * Only CC0 and CC-BY sources are accepted; anything else is reported and skipped.
 */
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import zlib from "node:zlib"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../..")
const MANIFEST = path.join(HERE, "sources.json")
const INCOMING = path.join(HERE, "incoming")
const HF = "https://huggingface.co/datasets/allenai/objaverse/resolve/main/"
const S3 = "https://omniverse-content-production.s3-us-west-2.amazonaws.com/"

export const LICENSES = {
  by: { id: "CC-BY-4.0", url: "https://creativecommons.org/licenses/by/4.0/" },
  cc0: {
    id: "CC0-1.0",
    url: "https://creativecommons.org/publicdomain/zero/1.0/",
  },
  nvidia: {
    id: "NVIDIA Omniverse content license",
    url: "https://docs.omniverse.nvidia.com/platform/latest/common/NVIDIA_Omniverse_License_Agreement.html",
  },
  upload: {
    id: "TurboSquid Standard License (royalty-free, not redistributable as a model)",
    url: "https://blog.turbosquid.com/royalty-free-license/",
  },
}

export function readManifest() {
  return JSON.parse(fs.readFileSync(MANIFEST, "utf8"))
}
export function writeManifest(m) {
  fs.writeFileSync(MANIFEST, JSON.stringify(m, null, 2) + "\n")
}

/** Select candidates from CLI args (slot or slot.id); empty = all. */
export function select(manifest, args) {
  const out = []
  for (const [slot, def] of Object.entries(manifest.slots)) {
    for (const cand of def.candidates) {
      const key = `${slot}.${cand.id}`
      if (!args.length || args.includes(slot) || args.includes(key))
        out.push({ slot, def, cand, key })
    }
  }
  return out
}

/** Where the raw (pre-ingest) file for a candidate lives once fetched. */
export function rawPath(slot, cand) {
  switch (cand.source) {
    case "objaverse":
      return path.join(INCOMING, "objaverse", `${cand.uid}.glb`)
    case "polyhaven":
      return path.join(
        INCOMING,
        "polyhaven",
        cand.asset,
        `${cand.asset}_1k.gltf`,
      )
    case "nvidia":
      return path.join(INCOMING, "nvidia", `${slot}.${cand.id}.glb`)
    case "upload": {
      const dir = path.join(INCOMING, "upload")
      for (const ext of [".glb", ".gltf"]) {
        const p = path.join(dir, cand.file + ext)
        if (fs.existsSync(p)) return p
      }
      return path.join(dir, `${cand.file}.glb`)
    }
  }
  throw new Error(`unknown source ${cand.source}`)
}

async function download(url, dest) {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return dest
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(240000) })
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      const buf = Buffer.from(await res.arrayBuffer())
      fs.writeFileSync(dest + ".part", buf)
      fs.renameSync(dest + ".part", dest)
      return dest
    } catch (e) {
      if (attempt >= 3) throw new Error(`${url}: ${e.message}`)
      await new Promise((r) => setTimeout(r, 1500 * attempt))
    }
  }
}

// ------------------------------------------------------------------ objaverse

let objectPaths = null
async function objaversePath(uid) {
  if (!objectPaths) {
    const f = await download(
      HF + "object-paths.json.gz",
      path.join(INCOMING, "_index", "object-paths.json.gz"),
    )
    objectPaths = JSON.parse(
      zlib.gunzipSync(fs.readFileSync(f)).toString("utf8"),
    )
  }
  const p = objectPaths[uid]
  if (!p) throw new Error(`objaverse uid ${uid} not in object-paths index`)
  return p
}

// shard files are ~30 MB parsed; keep only the records we asked for
const metaCache = new Map()
async function objaverseMeta(uid, glbPath) {
  const shard = glbPath.split("/")[1]
  if (!metaCache.has(uid)) {
    const f = await download(
      `${HF}metadata/${shard}.json.gz`,
      path.join(INCOMING, "_index", "meta", `${shard}.json.gz`),
    )
    metaCache.set(
      uid,
      JSON.parse(zlib.gunzipSync(fs.readFileSync(f)).toString("utf8"))[uid],
    )
  }
  const m = metaCache.get(uid)
  if (!m) throw new Error(`no metadata for ${uid}`)
  const lic = (m.license || "").toLowerCase()
  const license = lic === "cc0" ? "cc0" : lic === "by" ? "by" : lic
  return {
    title: m.name,
    author: m.user?.displayName || m.user?.username,
    authorUrl:
      m.user?.profileUrl ||
      (m.user?.username
        ? `https://sketchfab.com/${m.user.username}`
        : undefined),
    license,
    url: m.viewerUrl || `https://sketchfab.com/3d-models/${uid}`,
    faces: m.faceCount,
  }
}

async function fetchObjaverse(cand) {
  const p = await objaversePath(cand.uid)
  const meta = await objaverseMeta(cand.uid, p)
  Object.assign(cand, {
    title: meta.title,
    author: meta.author,
    authorUrl: meta.authorUrl,
    license: meta.license,
    url: meta.url,
  })
  if (!(meta.license in { by: 1, cc0: 1 }))
    throw new Error(`licence "${meta.license}" not allowed (CC0 / CC-BY only)`)
  await download(HF + p, rawPath(null, cand))
}

// ------------------------------------------------------------------ poly haven

async function fetchPolyHaven(cand) {
  const info = await (
    await fetch(`https://api.polyhaven.com/info/${cand.asset}`)
  ).json()
  const files = await (
    await fetch(`https://api.polyhaven.com/files/${cand.asset}`)
  ).json()
  const g = files.gltf?.["1k"]?.gltf
  if (!g) throw new Error(`no 1k glTF for ${cand.asset}`)
  const dir = path.dirname(rawPath(null, cand))
  await download(g.url, rawPath(null, cand))
  for (const [rel, f] of Object.entries(g.include || {}))
    await download(f.url, path.join(dir, rel))
  Object.assign(cand, {
    title: info.name,
    author: Object.keys(info.authors || {}).join(", "),
    license: "cc0",
    url: `https://polyhaven.com/a/${cand.asset}`,
  })
}

// ------------------------------------------------------------------ nvidia simready

async function nvidiaUsdKey(src) {
  if (/\.usdz?$/i.test(src)) return src
  // a folder: pick its top-level asset layer
  const xml = await (
    await fetch(
      `${S3}?list-type=2&prefix=${encodeURIComponent(src.replace(/\/?$/, "/"))}`,
    )
  ).text()
  const keys = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1])
  const top = keys.filter(
    (k) =>
      /\.usdc?$/i.test(k) && k.slice(src.length + 1).split("/").length === 1,
  )
  const pick =
    top.find((k) => /\/sm_[^/]+\.usdc?$/i.test(k)) ||
    top[0] ||
    keys.find(
      (k) =>
        /\.usdc?$/i.test(k) &&
        !/(instances|_mujoco|_newton|\/Props\/|\/Materials?\/)/i.test(k),
    )
  if (!pick) throw new Error(`no USD layer under ${src}`)
  return pick
}

async function fetchNvidia(slot, def, cand) {
  const out = rawPath(slot, cand)
  Object.assign(cand, {
    title: cand.title || path.basename(cand.src),
    author: "NVIDIA",
    license: "nvidia",
    url: S3 + cand.src,
  })
  if (fs.existsSync(out)) return
  const key = await nvidiaUsdKey(cand.src)
  cand.usd = key
  const env = {
    ...process.env,
    PYTHONPATH: [process.env.PYTHONPATH, path.join(ROOT, "tools", ".pydeps")]
      .filter(Boolean)
      .join(":"),
  }
  const sr = path.join(ROOT, "tools", "simready")
  let r = spawnSync("python3", [path.join(sr, "fetch.py"), key], {
    env,
    stdio: "inherit",
  })
  if (r.status) throw new Error("simready fetch.py failed")
  const cache = process.env.SIMREADY_CACHE || "/tmp/simready-cache"
  fs.mkdirSync(path.dirname(out), { recursive: true })
  r = spawnSync(
    "python3",
    [
      path.join(sr, "usd2glb.py"),
      path.join(cache, key),
      out,
      "--tris",
      String(Math.max(def.tris || 20000, 4000) * 2),
    ],
    { env, stdio: "inherit" },
  )
  if (r.status) throw new Error("simready usd2glb.py failed")
}

// ------------------------------------------------------------------ uploads

function fetchUpload(cand) {
  const dir = path.join(INCOMING, "upload")
  const base = path.join(dir, cand.file)
  if (fs.existsSync(base + ".glb") || fs.existsSync(base + ".gltf")) return
  if (fs.existsSync(base + ".obj")) {
    const r = spawnSync(
      process.execPath,
      [
        path.join(HERE, "node_modules", "obj2gltf", "bin", "obj2gltf.js"),
        "-i",
        base + ".obj",
        "-o",
        base + ".glb",
      ],
      { stdio: "inherit" },
    )
    if (r.status) throw new Error("obj2gltf failed")
    return
  }
  if (fs.existsSync(base + ".fbx")) {
    const r = spawnSync(
      "npx",
      ["--yes", "fbx2gltf", "-b", "-i", base + ".fbx", "-o", base],
      { stdio: "inherit" },
    )
    if (r.status)
      throw new Error("fbx2gltf failed (convert to GLB in Blender and re-run)")
    return
  }
  throw new Error(
    `awaiting upload: put ${cand.file}.glb (or .gltf/.fbx/.obj) in ${path.relative(ROOT, dir)}/`,
  )
}

// ------------------------------------------------------------------ main

async function main() {
  const manifest = readManifest()
  const todo = select(manifest, process.argv.slice(2))
  const failures = []
  let i = 0
  const worker = async () => {
    while (i < todo.length) {
      const { slot, def, cand, key } = todo[i++]
      try {
        if (cand.source === "objaverse") await fetchObjaverse(cand)
        else if (cand.source === "polyhaven") await fetchPolyHaven(cand)
        else if (cand.source === "nvidia") await fetchNvidia(slot, def, cand)
        else if (cand.source === "upload") fetchUpload(cand)
        console.log(
          `ok   ${key.padEnd(24)} ${cand.title ?? ""} — ${cand.author ?? ""} (${cand.license ?? ""})`,
        )
        writeManifest(manifest)
      } catch (e) {
        failures.push(key)
        console.log(`FAIL ${key.padEnd(24)} ${e.message}`)
      }
    }
  }
  // NVIDIA conversions run python sequentially; everything else downloads 4 at a time
  await Promise.all(
    Array.from(
      { length: todo.some((t) => t.cand.source === "nvidia") ? 1 : 4 },
      worker,
    ),
  )
  writeManifest(manifest)
  console.log(
    `\n${todo.length - failures.length}/${todo.length} fetched${
      failures.length ? `; failed: ${failures.join(", ")}` : ""
    }`,
  )
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
