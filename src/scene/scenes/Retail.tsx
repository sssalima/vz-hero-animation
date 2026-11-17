import { useLayoutEffect, useRef } from "react"
import { Group, Mesh } from "three"
import { ASSET_META } from "../assetMeta"
import { Anchor, type CalloutDef } from "../callouts"
import {
  BaseFloor,
  Box,
  Connected,
  Cyl,
  Faded,
  glow,
  PaintedGround,
  PAL,
  Prop,
  useSceneFrame,
} from "../common"
import { Instances, type Placement } from "../instances"
import { useClone, usePart } from "../models"
import type { SceneDef } from "."

/**
 * Retail: a quick-service restaurant kitchen. The walk-in cooler, the self-order kiosks and
 * the POS register carry SIMs; the cook line, prep tables and dining side are ghosted.
 */

// walk-in cooler footprint
const WI = { x0: -3.4, x1: -0.6, z0: -4.9, z1: -2.6, h: 2.55 }
/** door cycle: deliveries go in and out every ~11 s */
const DOOR_PERIOD = 11
const doorOpen = (t: number) => {
  const u = ((t % DOOR_PERIOD) + DOOR_PERIOD) % DOOR_PERIOD
  if (u < 6.5) return 0
  if (u < 7.3) return smooth((u - 6.5) / 0.8)
  if (u < 9.6) return 1
  if (u < 10.4) return 1 - smooth((u - 9.6) / 0.8)
  return 0
}
const smooth = (x: number) => x * x * (3 - 2 * x)

function paintKitchen(g: CanvasRenderingContext2D, M: (m: number) => number) {
  // origin = (-8, -6); kitchen quarry tile up to x = 2.2, dining planks beyond
  const kx = M(10.2)
  g.fillStyle = "#f4f5f5"
  g.fillRect(0, 0, kx, M(12))
  g.strokeStyle = "rgba(0,0,0,0.07)"
  g.lineWidth = 1.2
  for (let x = 0; x <= 10.2; x += 0.3) {
    g.beginPath()
    g.moveTo(M(x), 0)
    g.lineTo(M(x), M(12))
    g.stroke()
  }
  for (let z = 0; z <= 12; z += 0.3) {
    g.beginPath()
    g.moveTo(0, M(z))
    g.lineTo(kx, M(z))
    g.stroke()
  }
  // floor drains under the cook line and prep tables
  g.fillStyle = "rgba(0,0,0,0.12)"
  for (const [x, z] of [
    [2.6, 3.4],
    [4.6, 6.4],
  ])
    g.fillRect(M(x), M(z), M(0.3), M(0.3))
  // dining planks
  g.fillStyle = "#fbfbfa"
  g.fillRect(kx, 0, M(6), M(12))
  g.strokeStyle = "rgba(0,0,0,0.05)"
  for (let z = 0; z <= 12; z += 0.18) {
    g.beginPath()
    g.moveTo(kx, M(z))
    g.lineTo(M(16.2), M(z))
    g.stroke()
  }
  // threshold
  g.fillStyle = "rgba(0,0,0,0.16)"
  g.fillRect(kx - M(0.03), 0, M(0.06), M(12))
}

const WALL_H = 2.8
const WALL_S = WALL_H / ASSET_META.warehouse_wall.size[1]
const PANEL_W = ASSET_META.warehouse_wall.size[2] * WALL_S

/** SimReady wall panels scaled to the 2.8 m kitchen ceiling line. */
const WALL_PANELS: Placement[] = [
  ...Array.from({ length: Math.ceil(16 / PANEL_W) }, (_, k) => ({
    position: [-8 + PANEL_W * (k + 0.5), 0, -5.07] as [number, number, number],
    rotation: Math.PI / 2,
    scale: WALL_S,
  })),
  ...Array.from({ length: Math.ceil(9 / PANEL_W) }, (_, k) => ({
    position: [-8.07, 0, -5 + PANEL_W * (k + 0.5)] as [number, number, number],
    scale: WALL_S,
  })),
]

function Walls() {
  return (
    <group>
      <Instances model="warehouseWall" items={WALL_PANELS} />
      {/* tiled splash band along the cook line */}
      <Box args={[0.02, 1.0, 4.2]} position={[-7.97, 1.4, -2.6]} material={PAL.panel} shadow={false} />
    </group>
  )
}

const RANGE_ZS = [-3.6, -2.95, -2.3, -1.65]
const HOODS: Placement[] = RANGE_ZS.map((z) => ({ position: [-7.72, 1.72, z], rotation: Math.PI / 2 }))

function CookLine() {
  const zs = RANGE_ZS
  return (
    <group>
      {zs.map((z) => (
        <group key={z}>
          <Prop model="rangeOven" position={[-7.6, 0, z]} rotation={Math.PI / 2} />
          <Prop model="stockPot" position={[-7.55, 0.96, z + 0.12]} rotation={0.4} />
        </group>
      ))}
      {/* SimReady hood over each range (instanced: the hood is 15 meshes) */}
      <Instances model="rangeHood" items={HOODS} />
      <Prop model="kitchenCounter" position={[-6.3, 0, -4.6]} rotation={Math.PI / 2} />
      <Prop model="wallSink" position={[-7.75, 0, 0.4]} rotation={Math.PI / 2} />
      <Prop model="trashWheeled" position={[-7.4, 0, 1.4]} />
    </group>
  )
}

function PrepArea() {
  return (
    <group>
      <Prop model="steelTable" position={[-4.4, 0, -0.7]} rotation={Math.PI / 2} />
      <Prop model="steelTable" position={[-4.4, 0, 1.25]} rotation={Math.PI / 2} />
      <Prop model="stockPot" position={[-4.35, 0.85, -1.1]} rotation={1.2} />
      <Prop model="greenCrate" position={[-4.45, 0.85, 1.4]} rotation={Math.PI / 2} />
      <Prop model="reachFridge" position={[0.3, 0, -4.4]} rotation={-Math.PI / 2} />
      <Prop model="reachFridge" position={[1.35, 0, -4.4]} rotation={-Math.PI / 2} />
      <Prop model="steelTable" position={[-1.3, 0, 0.2]} rotation={Math.PI / 2} />
    </group>
  )
}

/** Pass counter between kitchen and dining. */
function PassCounter() {
  return (
    <group>
      {[-1.85, -0.61, 0.63].map((z) => (
        <Prop key={z} model="kitchenIsland" position={[1.65, 0, z]} />
      ))}
    </group>
  )
}

function Dining() {
  return (
    <group>
      <Prop model="beverageFridge" position={[6.0, 0, -4.6]} rotation={-Math.PI / 2} />
      <Prop model="beverageFridge" position={[6.5, 0, -4.6]} rotation={-Math.PI / 2} />
      <Prop model="coffeeMachine" position={[4.6, 0, -4.55]} rotation={-Math.PI / 2} />
      {[
        [6.6, 3.2],
        [4.6, 3.6],
        [6.9, 1.2],
      ].map(([x, z], i) => (
        <Prop key={x + z} model="bistroTable" position={[x, 0, z]} rotation={i * 0.7} />
      ))}
    </group>
  )
}

const CU = ASSET_META.walk_in_cooler
/** how far the left door swings open (radians) */
const SWING = 1.35

/**
 * Walk-in cooler (fallback until a licensed walk-in is supplied): the sourced two-door cold
 * storage unit stretched to the cooler footprint. Its door parts are detached from the stretched
 * body so the left door swings without shearing; condensing unit on the roof.
 */
function WalkIn() {
  const scene = useClone("walkInCooler")
  const doorL = usePart(scene, "door_l")
  const doorR = usePart(scene, "door_r")
  const door = useRef<Group>(null)
  const fan = useRef<Mesh>(null)
  const lamp = useRef<Mesh>(null)
  useLayoutEffect(() => {
    // the part nodes carry only the hinge pivot (meshes hang off a child), and the hinge groups
    // below already sit on the pivot, so zero the nodes' own translation
    doorL?.position.set(0, 0, 0)
    doorR?.position.set(0, 0, 0)
  }, [doorL, doorR])
  useSceneFrame((t) => {
    const o = doorOpen(t)
    if (door.current) door.current.rotation.y = -o * SWING
    if (fan.current) fan.current.rotation.y = t * 9
    if (lamp.current) lamp.current.material = o > 0.05 ? AMBER : GREEN
  })
  const w = WI.x1 - WI.x0
  const d = WI.z1 - WI.z0
  const cx = (WI.x0 + WI.x1) / 2
  const cz = (WI.z0 + WI.z1) / 2
  const sx = w / CU.size[0]
  const sz = d / CU.size[2]
  const hinge = (p: readonly number[]): [number, number, number] => [cx + p[0] * sx, 0, cz + p[2] * sz]
  return (
    <group>
      <group position={[cx, 0, cz]} scale={[sx, 1, sz]}>
        <primitive object={scene} />
      </group>
      {/* doors hinge on their outer edges; only the left one swings (deliveries) */}
      <group ref={door} position={hinge(CU.parts.door_l)}>
        <group scale={[sx, 1, 1]}>{doorL && <primitive object={doorL} />}</group>
      </group>
      <group position={hinge(CU.parts.door_r)}>
        <group scale={[sx, 1, 1]}>{doorR && <primitive object={doorR} />}</group>
      </group>
      {/* temperature controller on the side panel + door status lamp over the doors */}
      <group position={[WI.x1 + 0.02, 1.5, WI.z1 - 0.45]} rotation-y={Math.PI / 2}>
        <Box args={[0.22, 0.3, 0.04]} material={PAL.dark} />
        <Box args={[0.14, 0.06, 0.01]} position={[0, 0.06, 0.025]} material={glow("#9be15d", 1.8)} shadow={false} />
      </group>
      <mesh ref={lamp} position={[cx, CU.size[1] - 0.12, WI.z1 + 0.03]} material={GREEN}>
        <boxGeometry args={[0.32, 0.06, 0.05]} />
      </mesh>
      {/* condensing unit */}
      <group position={[cx + 0.4, CU.size[1], cz - 0.2]}>
        <Box args={[1.3, 0.62, 0.8]} position={[0, 0.31, 0]} material={PAL.mid} />
        <Cyl r={0.28} h={0.02} position={[0.25, 0.63, 0]} material={PAL.dark} />
        <mesh ref={fan} position={[0.25, 0.65, 0]} material={PAL.black}>
          <boxGeometry args={[0.5, 0.01, 0.07]} />
        </mesh>
        <Cyl r={0.03} h={0.8} position={[-0.5, 0.0, -0.3]} material={PAL.steel} seg={8} />
      </group>
    </group>
  )
}
const GREEN = glow("#76b900", 3)
const AMBER = glow("#ffb020", 3)

/** Self-order kiosk with a screen that wakes for each order. */
function Kiosk({ position, phase }: { position: [number, number, number]; phase: number }) {
  const led = useRef<Mesh>(null)
  useSceneFrame((t) => {
    const u = (t + phase) % 6
    if (led.current) led.current.material = u > 3.8 && u < 4.6 ? AMBER : GREEN
  })
  return (
    <group position={position}>
      <Prop model="orderKiosk" position={[0, 0, 0]} />
      <mesh ref={led} position={[0.22, 1.58, 0]} material={GREEN}>
        <boxGeometry args={[0.02, 0.03, 0.12]} />
      </mesh>
    </group>
  )
}

function Retail() {
  return (
    <group>
      <BaseFloor />
      <PaintedGround center={[0, 0]} w={16} d={12} paint={paintKitchen} />
      <Connected>
        <WalkIn />
        <Kiosk position={[4.6, 0, -1.4]} phase={0} />
        <Kiosk position={[3.4, 0, 1.6]} phase={2.6} />
        <Prop model="posTerminal" position={[1.62, 0.9, -0.35]} rotation={-Math.PI / 2} scale={1.6} />
      </Connected>
      {/* everything else ghosted */}
      <Faded>
        <Walls />
        <CookLine />
        <PrepArea />
        <PassCounter />
        <Dining />
      </Faded>
      <Anchor id="retail-walkin" position={[-1.6, 3.5, -3.75]} />
      <Anchor id="retail-pos" position={[1.62, 1.9, -0.35]} />
      <Anchor id="retail-kiosk-a" position={[4.6, 2.05, -1.4]} />
      <Anchor id="retail-kiosk-b" position={[3.4, 2.0, 1.6]} />
    </group>
  )
}

// ------------------------------------------------------------------ telemetry

function walkInStatus(t: number) {
  const o = doorOpen(t)
  const u = ((t % DOOR_PERIOD) + DOOR_PERIOD) % DOOR_PERIOD
  const temp = 36.2 + (u > 6.5 ? Math.min(1, (u - 6.5) / 4) * 1.1 : Math.max(0, 1.1 - u * 0.3))
  return o > 0.05 ? `Door open · ${temp.toFixed(1)}°F` : `Closed · ${temp.toFixed(1)}°F · 41% RH`
}
const order = (t: number, phase: number) => 1040 + Math.floor((t + phase) / 6)
function kioskStatus(phase: number) {
  return (t: number) => {
    const u = (t + phase) % 6
    const n = order(t, phase)
    if (u < 2.4) return "Taking order…"
    if (u < 3.8) return `Order #${n} · $${(12 + ((n * 37) % 23) + 0.4).toFixed(2)}`
    if (u < 4.6) return "Payment approved"
    return `Order #${n} → kitchen`
  }
}
function posStatus(t: number) {
  const u = t % 7
  const n = 211 + Math.floor(t / 7)
  if (u < 2.5) return `Ticket ${n} · $${(8 + ((n * 13) % 17) + 0.65).toFixed(2)}`
  if (u < 4) return "Tap to pay…"
  return `Approved · receipt sent`
}

const callouts: CalloutDef[] = [
  { id: "retail-walkin", scene: "retail", title: "Walk-in Cooler", bars: 4, delay: 0, status: walkInStatus },
  { id: "retail-pos", scene: "retail", title: "POS Register", bars: 4, delay: 0.4, status: posStatus },
  { id: "retail-kiosk-a", scene: "retail", title: "Order Kiosk 1", bars: 3, delay: 0.8, status: kioskStatus(0) },
  { id: "retail-kiosk-b", scene: "retail", title: "Order Kiosk 2", bars: 4, delay: 1.2, status: kioskStatus(2.6) },
]

export const retail: SceneDef = {
  id: "retail",
  view: { center: [-0.6, 1.1, -0.4], span: 16.5 },
  Component: Retail,
  callouts,
}
