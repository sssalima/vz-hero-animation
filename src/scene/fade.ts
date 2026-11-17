import { Material, Mesh, Object3D } from "three"

/**
 * Shared "ghost" uniform: lightened (non SIM-equipped) objects blend their final shaded
 * colour this far toward white. One knob for the whole scene.
 */
export const FADE = { value: 0.6 }

const cache = new WeakMap<Material, Material>()

export function fadedMaterial(src: Material): Material {
  const hit = cache.get(src)
  if (hit) return hit
  const m = src.clone()
  const baseKey = src.customProgramCacheKey?.() ?? ""
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uFade = FADE
    shader.fragmentShader =
      "uniform float uFade;\n" +
      shader.fragmentShader.replace(
        "#include <dithering_fragment>",
        "gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(1.0), uFade);\n#include <dithering_fragment>",
      )
  }
  m.customProgramCacheKey = () => `${baseKey}|faded`
  cache.set(src, m)
  return m
}

/** Swap every mesh under `root` to faded materials and stop it casting shadows (idempotent). */
export function applyFade(root: Object3D) {
  root.traverse((o) => {
    const mesh = o as Mesh
    if (!mesh.isMesh || mesh.userData.faded) return
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map(fadedMaterial)
      : fadedMaterial(mesh.material)
    mesh.castShadow = false
    mesh.userData.faded = true
  })
}

/**
 * Connected devices get a slight tone-down so naturally white equipment (X-ray tables,
 * kiosks, containers) still separates from the ghosted surroundings.
 */
export const CONTRAST = { value: 0.22 }

const toneCache = new WeakMap<Material, Material>()

function tonedMaterial(src: Material): Material {
  const hit = toneCache.get(src)
  if (hit) return hit
  const m = src.clone()
  const baseKey = src.customProgramCacheKey?.() ?? ""
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTone = CONTRAST
    shader.fragmentShader =
      "uniform float uTone;\n" +
      shader.fragmentShader.replace(
        "#include <dithering_fragment>",
        "gl_FragColor.rgb *= 1.0 - uTone;\n#include <dithering_fragment>",
      )
  }
  m.customProgramCacheKey = () => `${baseKey}|toned`
  toneCache.set(src, m)
  return m
}

/** Apply the connected-device tone to every mesh under `root` (idempotent; skips faded meshes). */
export function applyTone(root: Object3D) {
  root.traverse((o) => {
    const mesh = o as Mesh
    if (!mesh.isMesh || mesh.userData.faded || mesh.userData.toned) return
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    // leave unlit indicator lamps alone
    if (mats.some((mm) => (mm as Material & { isMeshBasicMaterial?: boolean }).isMeshBasicMaterial)) return
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map(tonedMaterial)
      : tonedMaterial(mesh.material)
    mesh.userData.toned = true
  })
}
