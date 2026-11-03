import { useGLTF } from "@react-three/drei"
import { useMemo } from "react"
import { Material, Mesh, MeshStandardMaterial, Object3D } from "three"

const base = import.meta.env.BASE_URL
const url = (name: string) => `${base}models/${name}.glb`

/** Converted NVIDIA SimReady / Isaac Sim assets (USD -> glTF, see public/models/README.md) */
export const MODELS = {
  conveyor: url("conveyor_A05"),
  conveyorDrive: url("conveyor_A08"),
  ur10: url("ur10"),
  amr: url("iw_hub"),
  pail: url("screwtoppail_a04"),
  pallet: url("blockpallet_a01"),
  palletLoadA: url("pallet_load_a04"),
  palletLoadB: url("pallet_load_b02"),
  tote: url("tote_c01"),
  bulkBin: url("container_j01"),
  bulkBox: url("container_f03"),
  ibc: url("ibctank_a01"),
  steelDrum: url("steeldrum_a01"),
  plasticDrum: url("plasticdrum_b01"),
  fiberDrum: url("fiberdrum_a01"),
  cone: url("trafficcone_a04"),
  fence: url("metalfencing_a2"),
  platform: url("stationaryworkplatform_a03"),
  ladder: url("tiltandrollladder_a02"),
  crate: url("heavydutywoodcrate_a01"),
  box: url("cubebox_a07"),
  exportPallet: url("exportpallet_a02"),
} as const

export type ModelKey = keyof typeof MODELS

const prepared = new WeakSet<Object3D>()

function prepare(root: Object3D) {
  if (prepared.has(root)) return
  prepared.add(root)
  root.traverse((o) => {
    const mesh = o as Mesh
    if (!mesh.isMesh) return
    const mats = (
      Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    ) as Material[]
    const transparent = mats.some((m) => m.transparent)
    mesh.castShadow = !transparent
    mesh.receiveShadow = true
    for (const m of mats) {
      const sm = m as MeshStandardMaterial
      if (sm.isMeshStandardMaterial) {
        sm.envMapIntensity = 0.9
        if (sm.transparent) sm.depthWrite = false
      }
    }
  })
}

/** Load (cached) and prepare a model; returns the shared source scene. */
export function useModel(key: ModelKey) {
  const gltf = useGLTF(MODELS[key])
  prepare(gltf.scene)
  return gltf.scene
}

/** A memoised deep clone (geometry and materials are shared). */
export function useClone(key: ModelKey) {
  const scene = useModel(key)
  return useMemo(() => scene.clone(true), [scene])
}

/** N clones of a model, for pooled moving objects. */
export function useClones(key: ModelKey, count: number) {
  const scene = useModel(key)
  return useMemo(
    () => Array.from({ length: count }, () => scene.clone(true)),
    [scene, count],
  )
}

export function preloadModels() {
  for (const u of Object.values(MODELS)) useGLTF.preload(u)
}
