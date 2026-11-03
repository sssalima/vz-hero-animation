/**
 * Deterministic production timeline. Every moving thing in the scene is a pure function of
 * time `t` (seconds), so the line runs forever without drift and can be paused or scrubbed.
 */

// ---------------------------------------------------------------- layout (metres, Y up)
export const CYCLE = 4 // seconds per unit
export const MOVE = 1.5 // indexed conveyor move duration
export const PITCH = 1 // spacing between pails on the main line
export const BELT_Y = 0.769 // roller top of the Isaac ConveyorBelt_A05/A08 modules

export const PAIL_H = 0.4781 // SimReady screwtoppail_a04 incl. lid
export const LID_TOP = 0.4781
export const LID_H = 0.0508

export const N_PICK = 12 // conveyor slots from infeed to the palletizer pick point
export const N_QC = N_PICK - 2
export const N_CAP = N_PICK - 4
export const X_PICK = 2
export const X_ENTRY = X_PICK - N_PICK * PITCH
export const X_QC = X_ENTRY + N_QC * PITCH
export const X_CAP = X_ENTRY + N_CAP * PITCH

export const Z_ROBOT = -0.81
export const PED_H = 1.05
export const Z_PALLET = -1.62
export const PALLET_H = 0.12 // SimReady blockpallet_a01
export const PALLET_TOP = BELT_Y + PALLET_H
export const PALLET_PITCH = 1.6
export const PALLET_MOVE = 2.2
/** pallet slots (dx, dz) relative to pallet centre, far row first */
export const SLOTS: [number, number][] = [
  [-0.36, -0.19],
  [0, -0.19],
  [0.36, -0.19],
  [-0.36, 0.19],
  [0, 0.19],
  [0.36, 0.19],
]
export const PER_PALLET = SLOTS.length

export const MAG_X = X_CAP - 0.7 // lid magazine
export const MAG_TOP = 1.0
export const MAG_VISIBLE = 8

// ---------------------------------------------------------------- easing helpers
export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)
export const smooth = (x: number) => {
  const t = clamp01(x)
  return t * t * t * (t * (t * 6 - 15) + 10)
}
export const easeInOut = (x: number) => {
  const t = clamp01(x)
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}
export const mod = (a: number, n: number) => ((a % n) + n) % n
const span = (t: number, a: number, b: number) => clamp01((t - a) / (b - a))

// ---------------------------------------------------------------- main conveyor
export const entryTime = (i: number) => i * CYCLE
/** number of pitches travelled by pail i at time t (indexed motion) */
export function conveyorProgress(i: number, t: number) {
  const u = t - entryTime(i)
  if (u < 0) return -1
  const n = Math.floor(u / CYCLE)
  return n + easeInOut((u - n * CYCLE) / MOVE)
}
/** global cycle index during which pail i dwells at slot s */
export const cycleAtSlot = (i: number, s: number) => i + s - 1

// ---------------------------------------------------------------- capping robot (R1)
export const R1 = {
  pickLid: 0.55,
  releaseLid: 2.6,
}
export const lidPickTime = (i: number) =>
  cycleAtSlot(i, N_CAP) * CYCLE + R1.pickLid
export const lidReleaseTime = (i: number) =>
  cycleAtSlot(i, N_CAP) * CYCLE + R1.releaseLid

type Waypoint = {
  x: number
  y: number
  z: number
}
type Segment = {
  from: string
  to: string
  t0: number
  t1: number
  lift?: number
}

export type Path = {
  points: Record<string, Waypoint>
  segments: Segment[]
  period: number
}

/** R1 world-space waypoints */
const capHi = 0.26
export const R1_PATH: Path = {
  period: CYCLE,
  points: {
    magHi: { x: MAG_X, y: MAG_TOP + capHi, z: Z_ROBOT },
    magLo: { x: MAG_X, y: MAG_TOP, z: Z_ROBOT },
    pailHi: { x: X_CAP, y: BELT_Y + PAIL_H + capHi, z: 0 },
    pailLo: { x: X_CAP, y: BELT_Y + PAIL_H, z: 0 },
  },
  segments: [
    { from: "magHi", to: "magLo", t0: 0, t1: 0.45 },
    { from: "magLo", to: "magLo", t0: 0.45, t1: 0.65 },
    { from: "magLo", to: "magHi", t0: 0.65, t1: 1.05 },
    { from: "magHi", to: "pailHi", t0: 1.05, t1: 2.05, lift: 0.08 },
    { from: "pailHi", to: "pailLo", t0: 2.05, t1: 2.45 },
    { from: "pailLo", to: "pailLo", t0: 2.45, t1: 2.75 },
    { from: "pailLo", to: "pailHi", t0: 2.75, t1: 3.1 },
    { from: "pailHi", to: "magHi", t0: 3.1, t1: 4.0, lift: 0.08 },
  ],
}

/** lids picked from the magazine up to time t */
export function magazineState(t: number) {
  const c = Math.floor(t / CYCLE)
  const tau = t - c * CYCLE
  const picked = c + (tau >= R1.pickLid ? 1 : 0)
  const rise = tau >= R1.pickLid ? smooth(span(tau, 0.8, 1.4)) : 1
  return { picked, rise }
}

// ---------------------------------------------------------------- palletizing robot (R2)
export const R2 = {
  start: MOVE, // robot cycle starts when the pail arrives at the pick point
  grip: 0.5,
  release: 2.28,
}
const pickCycleStart = (i: number) => cycleAtSlot(i, N_PICK) * CYCLE + R2.start
export const gripTime = (i: number) => pickCycleStart(i) + R2.grip
export const placeTime = (i: number) => pickCycleStart(i) + R2.release

export const palletOf = (i: number) => Math.floor(i / PER_PALLET)
export const slotOf = (i: number) => i - palletOf(i) * PER_PALLET

/** pallet line progress (number of pallet pitches travelled, eased) */
const palletMoveStart0 = placeTime(PER_PALLET - 1) + 0.45
const palletPeriod = PER_PALLET * CYCLE
export function palletProgress(t: number) {
  const pm = (t - palletMoveStart0) / palletPeriod
  const n = Math.floor(pm)
  return n + easeInOut(((pm - n) * palletPeriod) / PALLET_MOVE)
}
export const X_PALLET_STATION = X_PICK
export const palletX = (j: number, t: number) =>
  X_PALLET_STATION + PALLET_PITCH * (palletProgress(t) - j)

const pickHi = 0.46
const placeHi = 0.17
/** R2 waypoints depend on the slot being filled, so they are built per cycle */
export function r2Path(slot: number): Path {
  const [dx, dz] = SLOTS[slot]
  const sx = X_PALLET_STATION + dx
  const sz = Z_PALLET + dz
  return {
    period: CYCLE,
    points: {
      pickHi: { x: X_PICK, y: BELT_Y + PAIL_H + pickHi, z: 0 },
      pickLo: { x: X_PICK, y: BELT_Y + PAIL_H, z: 0 },
      placeHi: { x: sx, y: PALLET_TOP + PAIL_H + placeHi, z: sz },
      placeLo: { x: sx, y: PALLET_TOP + PAIL_H, z: sz },
    },
    segments: [
      { from: "pickHi", to: "pickLo", t0: 0, t1: 0.4 },
      { from: "pickLo", to: "pickLo", t0: 0.4, t1: 0.55 },
      { from: "pickLo", to: "pickHi", t0: 0.55, t1: 0.95 },
      { from: "pickHi", to: "placeHi", t0: 0.95, t1: 1.85, lift: 0.06 },
      { from: "placeHi", to: "placeLo", t0: 1.85, t1: 2.2 },
      { from: "placeLo", to: "placeLo", t0: 2.2, t1: 2.35 },
      { from: "placeLo", to: "placeHi", t0: 2.35, t1: 2.7 },
      { from: "placeHi", to: "pickHi", t0: 2.7, t1: 3.9, lift: 0.06 },
      { from: "pickHi", to: "pickHi", t0: 3.9, t1: 4.0 },
    ],
  }
}
/** pail index handled by R2 in its current cycle */
export function r2Cycle(t: number) {
  const k = Math.floor((t - R2.start) / CYCLE)
  const phase = t - R2.start - k * CYCLE
  const pail = k - N_PICK + 1
  return { pail, phase }
}

// ---------------------------------------------------------------- path sampling
/**
 * Sample a robot path at `phase`, interpolating in cylindrical coordinates around the robot
 * base so transfers sweep in natural arcs. Returns a world-space TCP target.
 */
export function samplePath(
  path: Path,
  phase: number,
  base: Waypoint,
  out: Waypoint,
) {
  const p = mod(phase, path.period)
  let seg = path.segments[path.segments.length - 1]
  for (const s of path.segments) {
    if (p >= s.t0 && p < s.t1) {
      seg = s
      break
    }
  }
  const a = path.points[seg.from]
  const b = path.points[seg.to]
  const k = smooth((p - seg.t0) / (seg.t1 - seg.t0))
  const ax = a.x - base.x
  const az = a.z - base.z
  const bx = b.x - base.x
  const bz = b.z - base.z
  const ra = Math.hypot(ax, az)
  const rb = Math.hypot(bx, bz)
  const angA = Math.atan2(az, ax)
  let dAng = Math.atan2(bz, bx) - angA
  while (dAng > Math.PI) dAng -= Math.PI * 2
  while (dAng < -Math.PI) dAng += Math.PI * 2
  const ang = angA + dAng * k
  const r = ra + (rb - ra) * k
  out.x = base.x + Math.cos(ang) * r
  out.z = base.z + Math.sin(ang) * r
  out.y = a.y + (b.y - a.y) * k + (seg.lift ?? 0) * Math.sin(Math.PI * k)
  return out
}

// ---------------------------------------------------------------- AMR
export const AMR = { z: 2.35, from: 10, to: -12, speed: 0.85, period: 34 }
export function amrX(t: number, offset = 0) {
  const u = mod(t + offset, AMR.period)
  return AMR.from - u * AMR.speed
}

// ---------------------------------------------------------------- telemetry
export const BASE_UNITS = 18_240
export function unitsPalletized(t: number) {
  const k = Math.floor((t - placeTime(0)) / CYCLE) + 1
  return BASE_UNITS + Math.max(0, k)
}
export function palletsShipped(t: number) {
  return (
    Math.floor(BASE_UNITS / PER_PALLET) +
    Math.max(0, Math.floor(palletProgress(t)))
  )
}
