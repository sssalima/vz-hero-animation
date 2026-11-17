import { useEffect, useLayoutEffect, useMemo } from "react"
import {
  Euler,
  Group,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Vector3,
  type Mesh,
  type Object3D,
} from "three"
import { useModel, type ModelKey } from "./models"

/**
 * GPU instancing for repeated sourced models (traffic, guard rails, crop, fences, solar modules):
 * every mesh of the model becomes one InstancedMesh, so N copies cost one draw call per material
 * instead of N. Materials are shared with the source, so <Faded> / <Connected> still apply.
 */

export type Placement = {
  position: [number, number, number]
  /** heading about +y (radians) */
  rotation?: number
  scale?: number | [number, number, number]
  /** extra tilt about the model's local x (radians), applied before the heading */
  tilt?: number
}

const ZERO = new Matrix4().makeScale(0, 0, 0)
const _m = new Matrix4()
const _q = new Quaternion()
const _e = new Euler()
const _p = new Vector3()
const _s = new Vector3()

export function placementMatrix(p: Placement, out = new Matrix4()) {
  _e.set(p.tilt ?? 0, p.rotation ?? 0, 0, "YXZ")
  _q.setFromEuler(_e)
  _p.set(...p.position)
  if (Array.isArray(p.scale)) _s.set(...p.scale)
  else _s.setScalar(p.scale ?? 1)
  return out.compose(_p, _q, _s)
}

export class InstancePool {
  readonly root = new Group()
  private parts: { mesh: InstancedMesh; local: Matrix4 }[] = []

  constructor(
    source: Object3D,
    readonly count: number,
  ) {
    source.updateMatrixWorld(true)
    const inv = new Matrix4().copy(source.matrixWorld).invert()
    source.traverse((o) => {
      const m = o as Mesh
      if (!m.isMesh) return
      const im = new InstancedMesh(m.geometry, m.material, count)
      im.castShadow = m.castShadow
      im.receiveShadow = true
      im.name = m.name
      for (let i = 0; i < count; i++) im.setMatrixAt(i, ZERO)
      this.parts.push({
        mesh: im,
        local: new Matrix4().multiplyMatrices(inv, m.matrixWorld),
      })
      this.root.add(im)
    })
  }

  /** Place instance `i` (null hides it). Call `commit()` once all instances are written. */
  set(i: number, matrix: Matrix4 | null) {
    for (const { mesh, local } of this.parts)
      mesh.setMatrixAt(i, matrix ? _m.multiplyMatrices(matrix, local) : ZERO)
  }

  commit(bounds = true) {
    for (const { mesh } of this.parts) {
      mesh.instanceMatrix.needsUpdate = true
      if (bounds) mesh.computeBoundingSphere()
      else mesh.frustumCulled = false
    }
  }

  dispose() {
    for (const { mesh } of this.parts) mesh.dispose()
  }
}

/** A pool of `count` instances of a model; write matrices with `pool.set` + `pool.commit`. */
export function useInstancePool(model: ModelKey, count: number) {
  const source = useModel(model)
  const pool = useMemo(() => new InstancePool(source, count), [source, count])
  useEffect(() => () => pool.dispose(), [pool])
  return pool
}

/** Static copies of a model, e.g. a fence line or a solar row. */
export function Instances({
  model,
  items,
}: {
  model: ModelKey
  items: Placement[]
}) {
  const pool = useInstancePool(model, items.length)
  useLayoutEffect(() => {
    items.forEach((it, i) => pool.set(i, placementMatrix(it)))
    pool.commit()
  }, [pool, items])
  return <primitive object={pool.root} />
}
