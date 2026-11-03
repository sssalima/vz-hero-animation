import { Object3D, Quaternion, Vector3 } from "three"

/**
 * Analytic "tool pointing down" inverse kinematics for the Isaac Sim UR10 asset.
 *
 * Joint origins/axes were extracted from the UsdPhysics revolute joints of
 * Isaac/Robots/UR10/ur10_short_suction.usd and rebuilt as a nested hierarchy
 * (see joint:* nodes in /models/ur10.glb). In the rest pose the arm extends
 * along +X, joint frames are world aligned and all lateral offsets point to -Z.
 */
export const UR10 = {
  shoulderHeight: 0.1273,
  upperArm: 0.612,
  forearm: 0.5723,
  /** wrist_2 -> wrist_3 offset along the wrist_2 axis */
  wristOffset: 0.1157,
  /** lateral offset of the tool centre point from the pan plane */
  lateral: 0.1639,
  /** wrist_3 axis -> suction cup tip */
  toolLength: 0.2532,
}

export const UR10_JOINTS = [
  "joint:shoulder_pan_joint",
  "joint:shoulder_lift_joint",
  "joint:elbow_joint",
  "joint:wrist_1_joint",
  "joint:wrist_2_joint",
  "joint:wrist_3_joint",
] as const

export type Vec3Like = {
  x: number
  y: number
  z: number
}

export type JointAngles = [number, number, number, number, number, number]

/**
 * Solve joint angles so the suction cup tip reaches `target` (robot base frame, metres, Y up)
 * with the tool axis pointing straight down. Returns null if unreachable.
 */
export function solveToolDown(
  target: Vec3Like,
  out?: JointAngles,
): JointAngles | null {
  const {
    shoulderHeight,
    upperArm: L1,
    forearm: L2,
    wristOffset,
    lateral: d,
    toolLength,
  } = UR10
  const rho2 = target.x * target.x + target.z * target.z
  if (rho2 <= d * d) return null
  const R = Math.sqrt(rho2 - d * d)
  // pan: target = R * radial + d * lateral, with radial = Ry(q1)*X and lateral = Ry(q1)*(-Z)
  const q1 = -(Math.atan2(target.z, target.x) + Math.atan2(d, R))

  // wrist_1 position in the arm plane, relative to the shoulder joint
  const a = R - wristOffset
  const b = target.y + toolLength - shoulderHeight
  const D2 = a * a + b * b
  const c3 = (D2 - L1 * L1 - L2 * L2) / (2 * L1 * L2)
  if (c3 > 1 || c3 < -1) return null
  const bend = Math.acos(c3)
  // elbow-up: upper arm elevation
  const phi1 =
    Math.atan2(b, a) + Math.atan2(L2 * Math.sin(bend), L1 + L2 * Math.cos(bend))
  // revolute axes 2-4 point along -Z (lateral), so a positive angle lowers the link
  const q2 = -phi1
  const q3 = bend
  // keep the wrist_2 axis horizontal and pointing outward
  const q4 = -Math.PI / 2 - q2 - q3
  const q5 = -Math.PI / 2
  const q6 = 0
  const res = out ?? [0, 0, 0, 0, 0, 0] as JointAngles
  res[0] = q1
  res[1] = q2
  res[2] = q3
  res[3] = q4
  res[4] = q5
  res[5] = q6
  return res
}

export type UR10Rig = {
  joints: Object3D[]
  axes: Vector3[]
}

/** Collect the nested joint nodes from a cloned UR10 scene. */
export function getUR10Rig(root: Object3D): UR10Rig {
  const joints: Object3D[] = []
  const axes: Vector3[] = []
  for (const name of UR10_JOINTS) {
    const node =
      root.getObjectByName(name.replace(/:/g, "")) ?? root.getObjectByName(name)
    if (!node) throw new Error(`UR10 rig is missing ${name}`)
    const axis = node.userData?.axis as number[] | undefined ?? [0, 0, 1]
    joints.push(node)
    axes.push(new Vector3(axis[0], axis[1], axis[2]).normalize())
  }
  return { joints, axes }
}

const tmpQ = new Quaternion()
export function applyUR10(rig: UR10Rig, q: JointAngles) {
  for (let i = 0; i < 6; i++) {
    rig.joints[i].quaternion.copy(tmpQ.setFromAxisAngle(rig.axes[i], q[i]))
  }
}
