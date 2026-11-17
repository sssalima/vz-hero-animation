import { useMemo, useRef } from "react"
import { Group, Mesh, Object3D } from "three"
import { ASSET_META } from "../assetMeta"
import { Anchor, type CalloutDef } from "../callouts"
import {
  BaseFloor,
  Box,
  Connected,
  Cyl,
  Faded,
  glow,
  mat,
  PaintedGround,
  PAL,
  Prop,
  useSceneFrame,
  type V3,
} from "../common"
import { Instances, type Placement } from "../instances"
import { useClone } from "../models"
import { RBox } from "../vehicles"
import type { SceneDef } from "."

/**
 * Facilities management: a distribution warehouse. The autonomous forklift, the tracked
 * shipping container, a smart pallet and the stretch wrapper carry SIMs; racking, stock,
 * conveyors and the building are ghosted.
 */

const AISLE_Z = -4.6
const BACK_RACK_Z = -7.6
const FRONT_RACK_Z = -1.6
const RACK_XS = [-6, -2, 2, 6]
const LEVELS = [0.12, 1.56]

function paintFloor(g: CanvasRenderingContext2D, M: (m: number) => number) {
  // origin (-12, -10), 26 x 20 m sealed concrete
  g.fillStyle = "#f7f7f6"
  g.fillRect(0, 0, M(26), M(20))
  g.fillStyle = "rgba(0,0,0,0.035)"
  for (let x = 0; x <= 26; x += 6) g.fillRect(M(x), 0, 2, M(20))
  for (let z = 0; z <= 20; z += 6) g.fillRect(0, M(z), M(26), 2)
  // aisle edge lines
  g.fillStyle = "rgba(24,27,31,0.35)"
  for (const z of [AISLE_Z - 1.85, AISLE_Z + 1.85]) g.fillRect(M(2), M(z + 10), M(22), M(0.08))
  // staging bays
  g.strokeStyle = "rgba(24,27,31,0.3)"
  g.lineWidth = M(0.06)
  for (const [x, z] of [
    [1.4, 1.5],
    [2.9, 1.5],
    [1.4, 3.1],
    [2.9, 3.1],
  ])
    g.strokeRect(M(x - 0.7 + 12), M(z - 0.7 + 10), M(1.4), M(1.4))
  // forklift crossing hatch
  g.fillStyle = "rgba(24,27,31,0.12)"
  for (let k = 0; k < 14; k++) g.fillRect(M(10.5 + k * 0.35), M(7.3), M(0.16), M(1.4))
  // container pad
  g.strokeRect(M(2.8 + 12), M(0.6 + 10), M(6.8), M(3.2))
}

// ------------------------------------------------------------------ racking

function RackRow({ z, xs, seed }: { z: number; xs: number[]; seed: number }) {
  const loads: { p: V3; m: "palletWrapped" | "palletLoadA" | "palletLoadB" }[] = []
  xs.forEach((x, i) =>
    LEVELS.forEach((y, l) =>
      [-1.1, 0, 1.1].forEach((dx, k) => {
        const h = (seed * 31 + i * 7 + l * 3 + k * 5) % 9
        if (h < 2) return
        loads.push({ p: [x + dx, y, z], m: h < 5 ? "palletWrapped" : h < 7 ? "palletLoadB" : "palletWrapped" })
      }),
    ),
  )
  return (
    <group>
      {xs.map((x) => (
        <Prop key={x} model="rackLarge" position={[x, 0, z]} />
      ))}
      {loads.map((l, i) => (
        <Prop key={i} model={l.m} position={l.p} rotation={(i % 3) * 0.02} scale={l.m === "palletLoadB" ? 0.8 : 1} />
      ))}
    </group>
  )
}

const WALL_H = 6.5
const PANEL_W = ASSET_META.warehouse_wall.size[2]
const DOCK_W = ASSET_META.dock_door.size[2]
const BACK_Z = -9.2
const SIDE_X = -12.1
/** the dock module's wall plane sits 1.14 m behind its origin; shelter + leveller face outward */
const DOCK_PLANE = 1.14

/** SimReady warehouse shell: straight wall panels with two dock-entrance modules in the back wall. */
function Building() {
  const back = useMemo(() => {
    const out: { x: number; dock: boolean }[] = []
    let x = -12
    for (const dock of [false, true, true, false, false]) {
      const w = dock ? DOCK_W : PANEL_W
      out.push({ x: x + w / 2, dock })
      x += w
    }
    return out
  }, [])
  const panels = useMemo<Placement[]>(
    () => [
      ...back.filter((b) => !b.dock).map((b) => ({ position: [b.x, 0, BACK_Z] as V3, rotation: Math.PI / 2 })),
      ...Array.from({ length: 4 }, (_, k) => ({ position: [SIDE_X, 0, BACK_Z + 0.2 + PANEL_W * (k + 0.5)] as V3 })),
    ],
    [back],
  )
  return (
    <group>
      <Instances model="warehouseWall" items={panels} />
      {back
        .filter((b) => b.dock)
        .map(({ x }) => (
          <Prop key={x} model="dockDoor" position={[x, 0, BACK_Z - DOCK_PLANE]} rotation={Math.PI / 2} />
        ))}
    </group>
  )
}

// ------------------------------------------------------------------ container

const CT = ASSET_META.shipping_container.size
/** body half-width (the modelled ajar door leaf sticks out past it at the +x end) */
const CT_HALF_W = 1.22

/** 20 ft ISO dry container (sourced), long axis on x, doors (modelled ajar) on the +x end. */
function Container({ tracker = false }: { tracker?: boolean }) {
  return (
    <group>
      <Prop model="shippingContainer" position={[0, 0, 0]} />
      {tracker && (
        <group position={[CT[0] / 2 - 0.7, CT[1] - 0.4, CT_HALF_W + 0.05]}>
          <Box args={[0.34, 0.22, 0.06]} material={PAL.black} />
          <Box args={[0.05, 0.03, 0.02]} position={[0.1, 0.06, 0.04]} material={glow("#76b900", 3)} shadow={false} />
        </group>
      )}
    </group>
  )
}

// ------------------------------------------------------------------ autonomous forklift

const FK_PERIOD = 22
/** pose of the forklift over its put-away cycle: x, heading, fork height, carrying */
function forkliftPose(t: number) {
  const u = ((t % FK_PERIOD) + FK_PERIOD) % FK_PERIOD
  const ease = (a: number, b: number) => {
    const s = Math.min(1, Math.max(0, (u - a) / (b - a)))
    return s * s * (3 - 2 * s)
  }
  const x0 = -3.5
  const x1 = 3.6
  // drive out loaded, turn to the back rack, lift + place, lower, turn back, return empty, pick from staging
  const x = x0 + (x1 - x0) * ease(0, 5) - (x1 - x0) * ease(12, 17)
  const turn = ease(5, 6.5) - ease(10.5, 12)
  const lift = ease(6.5, 8.5) - ease(9.5, 10.5)
  const carrying = u < 9.5 || u > 19
  return { x, heading: turn * (Math.PI / 2), lift: lift * 1.5 + 0.12, carrying }
}

function AutonomousForklift() {
  const root = useRef<Group>(null)
  const scene = useClone("forkliftAuto")
  const lift = useMemo(() => scene.getObjectByName("lift") as Object3D | null, [scene])
  const liftY0 = useMemo(() => lift?.position.y ?? 0, [lift])
  const load = useRef<Group>(null)
  const beacon = useRef<Mesh>(null)
  useSceneFrame((t) => {
    const p = forkliftPose(t)
    if (root.current) {
      root.current.position.x = p.x
      root.current.rotation.y = p.heading
    }
    if (lift) lift.position.y = liftY0 + p.lift
    if (load.current) {
      load.current.visible = p.carrying
      load.current.position.y = p.lift + 0.12
    }
    if (beacon.current) beacon.current.material = Math.floor(t * 2.5) % 2 ? AMBER : GREEN
  })
  return (
    <group ref={root} position={[0, 0, AISLE_Z]}>
      <primitive object={scene} />
      <group ref={load} position={[1.75, 0.12, 0]}>
        <Faded>
          <Prop model="palletWrapped" position={[0, 0, 0]} />
        </Faded>
      </group>
      <mesh ref={beacon} position={[-1.2, 2.3, 0]} material={GREEN}>
        <cylinderGeometry args={[0.07, 0.07, 0.1, 12]} />
      </mesh>
      <Anchor id="fm-forklift" position={[-0.3, 2.85, 0]} />
    </group>
  )
}
const GREEN = glow("#76b900", 3)
const AMBER = glow("#ffb020", 3)

// ------------------------------------------------------------------ stretch wrapper

/**
 * Turntable stretch wrapper (hand-built fallback until a licensed model is supplied): skirted
 * turntable on a low base with an approach ramp, mast with a film carriage (film roll and two
 * pre-stretch rollers), operator pendant on a swing arm and a light curtain on the infeed side.
 */
function StretchWrapper({ position }: { position: V3 }) {
  const table = useRef<Group>(null)
  const carriage = useRef<Group>(null)
  const rollers = useRef<Group>(null)
  useSceneFrame((t) => {
    if (table.current) table.current.rotation.y = t * 1.3
    if (rollers.current) rollers.current.children.forEach((r, i) => (r.rotation.y = t * (i ? 9 : 5.5)))
    const u = (t % 12) / 12
    if (carriage.current) carriage.current.position.y = 0.45 + 1.25 * (0.5 - 0.5 * Math.cos(u * Math.PI * 2))
  })
  const frame = mat("#9aa1a8", { rough: 0.45, metal: 0.4 })
  return (
    <group position={position}>
      {/* base, skirt and ramp */}
      <Cyl r={1.05} h={0.08} position={[0, 0.04, 0]} material={PAL.dark} seg={48} />
      <Cyl r={1.02} h={0.1} position={[0, 0.13, 0]} material={PAL.steel} seg={48} />
      <Box args={[0.9, 0.04, 1.4]} position={[1.45, 0.06, 0]} rotation={[0, 0, 0.12]} material={PAL.steel} />
      <group ref={table} position={[0, 0.18, 0]}>
        <Cyl r={0.98} h={0.04} position={[0, 0.02, 0]} material={PAL.mid} seg={48} />
        {[0, 1, 2, 3].map((k) => (
          <Box key={k} args={[1.9, 0.012, 0.05]} position={[0, 0.045, 0]} rotation={[0, (k * Math.PI) / 4, 0]} material={PAL.dark} shadow={false} />
        ))}
        <Faded>
          <Prop model="palletLoadA" position={[0, 0.05, 0]} />
        </Faded>
      </group>
      {/* mast on its foot, with a top cap */}
      <group position={[-1.45, 0, 0]}>
        <Box args={[0.8, 0.14, 0.8]} position={[0, 0.07, 0]} material={PAL.dark} />
        <RBox args={[0.3, 2.75, 0.34]} r={0.04} position={[0, 0.14 + 1.375, 0]} material={frame} />
        <Box args={[0.36, 0.08, 0.4]} position={[0, 2.93, 0]} material={PAL.dark} />
        {/* control cabinet with HMI on the mast face */}
        <RBox args={[0.46, 0.66, 0.24]} r={0.03} position={[0, 1.2, 0.3]} material={PAL.panel} />
        <Box args={[0.26, 0.17, 0.01]} position={[0, 1.34, 0.425]} material={PAL.glass} shadow={false} />
        <Box args={[0.12, 0.05, 0.01]} position={[0, 1.08, 0.425]} material={glow("#76b900", 2.5)} shadow={false} />
        {/* film carriage: film roll + two pre-stretch rollers between guide plates */}
        <group ref={carriage} position={[0.3, 0.45, 0]}>
          <Box args={[0.34, 0.06, 0.52]} position={[0, -0.32, 0]} material={PAL.dark} />
          <Box args={[0.34, 0.06, 0.52]} position={[0, 0.32, 0]} material={PAL.dark} />
          <Box args={[0.06, 0.7, 0.52]} position={[-0.17, 0, 0]} material={frame} />
          <Cyl r={0.11} h={0.56} position={[0.06, 0, 0.13]} material={PAL.white} seg={16} />
          <group ref={rollers}>
            <Cyl r={0.04} h={0.58} position={[0.14, 0, -0.08]} material={PAL.light} seg={12} />
            <Cyl r={0.04} h={0.58} position={[0.04, 0, -0.18]} material={PAL.steel} seg={12} />
          </group>
        </group>
      </group>
      {/* operator pendant on a swing arm */}
      <Box args={[0.7, 0.05, 0.05]} position={[-1.45, 2.4, 0.5]} rotation={[0, -0.6, 0]} material={PAL.steel} />
      <Cyl r={0.008} h={0.7} position={[-1.2, 2.05, 0.82]} material={PAL.black} seg={6} shadow={false} />
      <RBox args={[0.12, 0.22, 0.08]} r={0.02} position={[-1.2, 1.6, 0.82]} material={PAL.yellow} />
      {/* light curtain posts either side of the infeed */}
      {[-0.95, 0.95].map((z) => (
        <group key={z} position={[1.05, 0, z]}>
          <Box args={[0.06, 1.5, 0.06]} position={[0, 0.75, 0]} material={PAL.dark} />
          <Box args={[0.015, 1.3, 0.02]} position={[0, 0.8, -Math.sign(z) * 0.035]} material={glow("#ff3b30", 1.4)} shadow={false} />
        </group>
      ))}
    </group>
  )
}

// ------------------------------------------------------------------ scene

const CONTAINER: V3 = [6.2, 0, 2.2]
const WRAPPER: V3 = [-0.5, 0, 1.0]
const SMART_PALLET: V3 = [1.4, 0, 3.1]

function Staging() {
  return (
    <group>
      <Prop model="palletLoadB" position={[1.4, 0, 1.5]} scale={0.85} />
      <Prop model="palletWrapped" position={[2.9, 0, 1.5]} />
      <Prop model="palletLoadA" position={[2.9, 0, 3.1]} rotation={Math.PI / 2} />
      <Prop model="palletJack" position={[-0.4, 0, 4.2]} rotation={-0.6} />
      <Prop model="dockBoard" position={[2.4, 0, 4.6]} rotation={Math.PI / 2} />
      {/* conveyor feeding the wrapper */}
      {[-2.62, -4.62, -6.62, -8.62].map((x) => (
        <Prop key={x} model="conveyor" position={[x, 0, WRAPPER[2]]} />
      ))}
      <Prop model="securityCage" position={[-10.3, 0, 0.2]} rotation={Math.PI / 2} />
      <Prop model="securityCage" position={[-8.9, 0, -1.2]} />
    </group>
  )
}

function Facilities() {
  return (
    <group>
      <BaseFloor />
      <PaintedGround center={[1, 0]} w={26} d={20} paint={paintFloor} ppm={36} />
      <Connected>
        <AutonomousForklift />
        <group position={CONTAINER}>
          <Container tracker />
        </group>
        <group position={SMART_PALLET}>
          <Prop model="palletLoadA" position={[0, 0, 0]} rotation={Math.PI / 2} />
          <Box args={[0.16, 0.08, 0.04]} position={[0.62, 0.1, 0.2]} material={PAL.black} />
        </group>
        <StretchWrapper position={WRAPPER} />
      </Connected>
      {/* everything else ghosted */}
      <Faded>
        <Building />
        <RackRow z={BACK_RACK_Z} xs={RACK_XS} seed={1} />
        <RackRow z={FRONT_RACK_Z} xs={RACK_XS.slice(0, 3)} seed={4} />
        <Staging />
      </Faded>
      <Anchor id="fm-container" position={[CONTAINER[0] + 2.3, CT[1] + 0.9, CONTAINER[2]]} />
      <Anchor id="fm-pallet" position={[SMART_PALLET[0], 1.2, SMART_PALLET[2]]} />
      <Anchor id="fm-wrapper" position={[WRAPPER[0] - 1.2, 3.0, WRAPPER[2]]} />
    </group>
  )
}

// ------------------------------------------------------------------ telemetry

function forkliftStatus(t: number) {
  const u = ((t % FK_PERIOD) + FK_PERIOD) % FK_PERIOD
  if (u < 5) return "Autonomous · to rack B-04"
  if (u < 10.5) return "Put-away · level 2 · 1.1 t"
  if (u < 17) return "Returning · 86% battery"
  return "Picking · staging lane 2"
}
function containerStatus(t: number) {
  const temp = 18.4 + Math.sin(t * 0.2) * 0.3
  return `MSKU 402187 · doors open · ${temp.toFixed(1)}°C`
}
function palletStatus(t: number) {
  const u = t % 9
  if (u < 4) return "SKU 88-102 · 48 cases · Bay 2"
  if (u < 6.5) return "Tilt 0.4° · shock OK"
  return "Next: Dock 3 · 14:20"
}
function wrapperStatus(t: number) {
  const n = 1260 + Math.floor(t / 12)
  const u = (t % 12) / 12
  return `Load ${n} · ${Math.round(u * 100)}% wrapped`
}

const callouts: CalloutDef[] = [
  { id: "fm-forklift", scene: "facilities", title: "Robotic Forklift", bars: 4, delay: 0, status: forkliftStatus },
  { id: "fm-container", scene: "facilities", title: "Shipping Container", bars: 3, delay: 0.5, status: containerStatus },
  { id: "fm-pallet", scene: "facilities", title: "Smart Pallet", bars: 3, delay: 0.9, status: palletStatus },
  { id: "fm-wrapper", scene: "facilities", title: "Stretch Wrapper", bars: 4, delay: 1.3, status: wrapperStatus },
]

export const facilities: SceneDef = {
  id: "facilities",
  view: { center: [1, 1, -1.5], span: 29 },
  Component: Facilities,
  callouts,
}
