import { useLayoutEffect, useMemo, useRef } from "react"
import { Group, Matrix4, Mesh } from "three"
import { Anchor, type CalloutDef } from "../callouts"
import { sceneClock } from "../carousel"
import {
  BaseFloor,
  Box,
  Connected,
  Cyl,
  Faded,
  glow,
  hash,
  mat,
  PaintedGround,
  PAL,
  Prop,
  useSceneFrame,
  type V3,
} from "../common"
import { Instances, placementMatrix, useInstancePool, type Placement } from "../instances"
import { useClone, usePart } from "../models"
import { Combine, GrainCart, Tractor } from "../vehicles"
import type { SceneDef } from "."

/**
 * Agriculture: harvest day. The combine works up a swath of standing wheat with a tractor
 * and grain cart alongside, in front of the farmstead. The combine, grain cart, a monitored
 * grain bin and a field weather station carry SIMs; crop, buildings and fences are ghosted.
 */

// swath worked by the combine (heading -z, 5.1 m header); standing crop to +x, stubble to -x
const SWATH_X = 2
const SWATH_HALF = 2.6
const CART_DX = -7.6
const Z_START = 9
const SPEED = 1.5
const HEADER_AHEAD = 5.4
const FIELD = { x0: SWATH_X - SWATH_HALF, x1: 22, z0: -20, z1: 16 }
/** grain bin pair + elevator leg; the nearer bin (local +z) is the monitored one */
const BINS: V3 = [-13, 0, -12]
const BIN_DZ = 4.3
const WEATHER: V3 = [13, 0, -10]
const FENCE_X = -9.8

const combineZ = () => Z_START - SPEED * sceneClock("agriculture").local

function paintFarm(g: CanvasRenderingContext2D, M: (m: number) => number) {
  // origin (-50, -50): 100 x 100 m
  const X = (x: number) => M(x + 50)
  const Z = (z: number) => M(z + 50)
  g.fillStyle = "#f7f7f4"
  g.fillRect(0, 0, M(100), M(100))
  // harvested stubble with drill rows (rows run along z)
  g.fillStyle = "#f1f0ea"
  g.fillRect(X(-30), Z(-24), M(FIELD.x1 + 30), M(44))
  g.fillStyle = "rgba(0,0,0,0.045)"
  for (let x = -30; x < FIELD.x1; x += 0.8) g.fillRect(X(x), Z(-24), M(0.12), M(44))
  // farmyard gravel + lane
  g.fillStyle = "#ebebea"
  g.fillRect(X(-34), Z(-26), M(23.5), M(18))
  g.fillRect(X(-34), Z(-8), M(4.5), M(40))
  // field margin
  g.fillStyle = "rgba(0,0,0,0.06)"
  g.fillRect(X(-30), Z(-24.2), M(FIELD.x1 + 30), M(0.2))
}

// ------------------------------------------------------------------ crop

const ROW = 0.75
const STEP = 0.75

/** Instanced wheat clumps; the combine's header cuts them down to stubble as it passes. */
function Crop() {
  const cells = useMemo(() => {
    const out: { x: number; z: number; s: number; r: number }[] = []
    for (let x = FIELD.x0 + 0.4; x < FIELD.x1; x += ROW)
      for (let z = FIELD.z0; z < FIELD.z1; z += STEP) {
        const k = out.length
        const c = { x: x + (hash(k) - 0.5) * 0.14, z: z + (hash(k * 3) - 0.5) * 0.3, s: 0.9 + hash(k * 7) * 0.35, r: hash(k * 11) * 6.28 }
        // leave a clearing around the weather station
        if (Math.hypot(c.x - WEATHER[0], c.z - WEATHER[2]) < 1.6) continue
        out.push(c)
      }
    return out
  }, [])
  const pool = useInstancePool("crop", cells.length)
  const m = useMemo(() => new Matrix4(), [])
  const cut = useRef<boolean[]>([])
  const write = (i: number, harvested: boolean) => {
    const c = cells[i]
    const w = c.s * 1.45
    pool.set(i, placementMatrix({ position: [c.x, 0, c.z], rotation: c.r, scale: [w, harvested ? 0.14 : c.s, w] }, m))
  }
  useLayoutEffect(() => {
    cells.forEach((_, i) => {
      cut.current[i] = false
      write(i, false)
    })
    pool.commit()
  }, [cells, pool])
  useSceneFrame(() => {
    const head = combineZ() - HEADER_AHEAD
    let dirty = false
    cells.forEach((c, i) => {
      const harvested = Math.abs(c.x - SWATH_X) < SWATH_HALF && c.z > head
      if (harvested !== cut.current[i]) {
        cut.current[i] = harvested
        write(i, harvested)
        dirty = true
      }
    })
    if (dirty) pool.commit(false)
  })
  return <primitive object={pool.root} />
}

const CROP_GROUND = mat("#e3e0d2", { rough: 1 })

/** Tonal ground under the standing crop; the swath's band shrinks as the header cuts it. */
function StandingCrop() {
  const swath = useRef<Mesh>(null)
  useSceneFrame(() => {
    const head = Math.max(FIELD.z0, Math.min(FIELD.z1, combineZ() - HEADER_AHEAD))
    const len = head - FIELD.z0
    if (!swath.current) return
    swath.current.visible = len > 0.01
    swath.current.scale.y = Math.max(len, 0.001)
    swath.current.position.z = FIELD.z0 + len / 2
  })
  const x1 = SWATH_X + SWATH_HALF
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[(x1 + FIELD.x1) / 2, 0.004, (FIELD.z0 + FIELD.z1) / 2]} material={CROP_GROUND} receiveShadow>
        <planeGeometry args={[FIELD.x1 - x1, FIELD.z1 - FIELD.z0]} />
      </mesh>
      <mesh ref={swath} rotation-x={-Math.PI / 2} position={[SWATH_X, 0.004, 0]} material={CROP_GROUND} receiveShadow>
        <planeGeometry args={[SWATH_HALF * 2, 1]} />
      </mesh>
    </group>
  )
}

// ------------------------------------------------------------------ machinery

function Harvest() {
  const combine = useRef<Group>(null)
  const cart = useRef<Group>(null)
  useSceneFrame(() => {
    const z = combineZ()
    if (combine.current) combine.current.position.z = z
    if (cart.current) cart.current.position.z = z - 0.6
  })
  return (
    <>
      <group ref={combine} position={[SWATH_X, 0, Z_START]} rotation-y={Math.PI / 2}>
        <Combine connected />
        <Anchor id="ag-combine" position={[3.8, 3.9, 0]} />
      </group>
      <group ref={cart} position={[SWATH_X + CART_DX, 0, Z_START]} rotation-y={Math.PI / 2}>
        {/* tractor drawbar 2.4 m behind its centre, cart hitch 4.6 m ahead of the cart's */}
        <group position={[7.0, 0, 0]}>
          <Tractor connected />
        </group>
        <GrainCart fill={0.75} connected />
        <Anchor id="ag-cart" position={[-1.5, 6.4, 0]} />
      </group>
    </>
  )
}

// ------------------------------------------------------------------ farmstead

/** Corrugated bin pair with the elevator leg; the near bin is split out as the monitored device. */
function GrainBins() {
  const scene = useClone("grainBin")
  const bin = usePart(scene, "bin")
  return (
    <group position={BINS}>
      <Faded>
        <primitive object={scene} />
      </Faded>
      {bin && (
        <Connected>
          <primitive object={bin} />
          {/* level / moisture sensor puck on the roof */}
          <group position={[1.15, 5.95, BIN_DZ + 1.0]} rotation={[0.45, 0, -0.3]}>
            <Box args={[0.45, 0.22, 0.32]} material={PAL.black} />
            <Box args={[0.1, 0.04, 0.02]} position={[0.1, 0.06, 0.17]} material={glow("#76b900", 3)} shadow={false} />
          </group>
        </Connected>
      )}
    </group>
  )
}

const FENCE: Placement[] = Array.from({ length: 21 }, (_, k) => ({
  position: [FENCE_X, 0, -24 + 1.3 + k * 2.6] as [number, number, number],
  rotation: Math.PI / 2,
}))

const TREES: Placement[] = [
  [-30, -22, 1.2],
  [-26, -27, 1],
  [-36, -14, 1.3],
  [-19, -29, 0.9],
  [-37, 2, 1.1],
  [-34, 11, 1.25],
].map(([x, z, s], i) => ({ position: [x, 0, z] as [number, number, number], scale: s, rotation: i * 1.7 }))

/**
 * Field weather station (hand-built fallback): guyed 4 m mast with a cup anemometer and wind
 * vane on the crossarm, a solar panel, multi-plate radiation shield, logger enclosure with its
 * cellular antenna, and a rain gauge on its own post. The cups spin and the vane hunts.
 */
function WeatherStation({ position }: { position: V3 }) {
  const cups = useRef<Group>(null)
  const vane = useRef<Group>(null)
  const led = useRef<Mesh>(null)
  useSceneFrame((t) => {
    if (cups.current) cups.current.rotation.y = t * 5
    if (vane.current) vane.current.rotation.y = 0.6 + Math.sin(t * 0.7) * 0.25 + Math.sin(t * 1.9) * 0.08
    if (led.current) led.current.visible = Math.floor(t * 1.5) % 3 !== 0
  })
  const H = 4
  const white = mat("#e4e7e9", { rough: 0.5 })
  return (
    <group position={position}>
      <Box args={[0.9, 0.12, 0.9]} position={[0, 0.06, 0]} material={PAL.concrete} />
      <Cyl r={0.05} r2={0.04} h={H} position={[0, H / 2, 0]} material={PAL.steel} seg={10} />
      {/* guy wires to three ground anchors */}
      {[0, 1, 2].map((k) => {
        const a = (k * Math.PI * 2) / 3 + 0.4
        const R = 1.9
        const len = Math.hypot(R, H * 0.72)
        return (
          <group key={k} rotation-y={a}>
            <Cyl r={0.008} h={len} position={[R / 2, (H * 0.72) / 2, 0]} rotation={[0, 0, Math.atan2(R, H * 0.72)]} material={PAL.steel} seg={4} shadow={false} />
            <Box args={[0.16, 0.08, 0.16]} position={[R, 0.04, 0]} material={PAL.concrete} />
          </group>
        )
      })}
      {/* crossarm: anemometer on one end, vane on the other */}
      <Box args={[1.3, 0.05, 0.05]} position={[0, H - 0.05, 0]} material={PAL.steel} />
      <group ref={cups} position={[0.6, H + 0.18, 0]}>
        <Cyl r={0.02} h={0.22} position={[0, -0.1, 0]} material={PAL.dark} seg={8} />
        {[0, 1, 2].map((k) => (
          <group key={k} rotation-y={(k * Math.PI * 2) / 3}>
            <Box args={[0.26, 0.015, 0.015]} position={[0.13, 0, 0]} material={PAL.steel} shadow={false} />
            <mesh position={[0.27, 0, 0]} rotation-z={Math.PI / 2} material={PAL.dark}>
              <coneGeometry args={[0.05, 0.08, 12, 1, true]} />
            </mesh>
          </group>
        ))}
      </group>
      <group ref={vane} position={[-0.6, H + 0.15, 0]}>
        <Cyl r={0.02} h={0.2} position={[0, -0.08, 0]} material={PAL.dark} seg={8} />
        <Box args={[0.5, 0.02, 0.02]} position={[0.05, 0, 0]} material={PAL.dark} shadow={false} />
        <Box args={[0.16, 0.14, 0.008]} position={[-0.22, 0.02, 0]} material={PAL.dark} />
        <mesh position={[0.32, 0, 0]} rotation-z={-Math.PI / 2} material={PAL.dark}>
          <coneGeometry args={[0.025, 0.08, 8]} />
        </mesh>
      </group>
      {/* solar panel on a bracket, facing south (+z) */}
      <group position={[0, 2.9, 0.12]}>
        <Box args={[0.08, 0.08, 0.2]} position={[0, 0, 0]} material={PAL.steel} />
        <group position={[0, 0.05, 0.22]} rotation={[-0.75, 0, 0]}>
          <Box args={[0.62, 0.03, 0.45]} material={PAL.glass} />
          <Box args={[0.64, 0.02, 0.47]} position={[0, -0.02, 0]} material={PAL.steel} shadow={false} />
        </group>
      </group>
      {/* multi-plate radiation shield (air temperature / RH) */}
      <group position={[-0.28, 2.15, 0]}>
        <Box args={[0.28, 0.04, 0.04]} position={[0.14, 0.1, 0]} material={PAL.steel} />
        {Array.from({ length: 7 }, (_, k) => (
          <Cyl key={k} r={0.09 - k * 0.002} h={0.018} position={[0, 0.12 - k * 0.04, 0]} material={white} seg={16} shadow={false} />
        ))}
      </group>
      {/* logger enclosure with cellular antenna + status LED */}
      <group position={[0, 1.35, 0.11]}>
        <Box args={[0.4, 0.5, 0.18]} position={[0, 0, 0.04]} material={white} />
        <Box args={[0.36, 0.004, 0.005]} position={[0, -0.05, 0.135]} material={PAL.mid} shadow={false} />
        <Cyl r={0.012} h={0.32} position={[0.15, 0.41, 0.04]} material={PAL.black} seg={6} />
        <mesh ref={led} position={[-0.12, 0.17, 0.135]} material={glow("#76b900", 3)}>
          <boxGeometry args={[0.04, 0.025, 0.01]} />
        </mesh>
      </group>
      {/* tipping-bucket rain gauge on its own post */}
      <group position={[0.85, 0, -0.55]}>
        <Cyl r={0.03} h={0.9} position={[0, 0.45, 0]} material={PAL.steel} seg={8} />
        <Cyl r={0.1} h={0.3} position={[0, 1.05, 0]} material={white} seg={16} />
      </group>
    </group>
  )
}

function Agriculture() {
  return (
    <group>
      <BaseFloor />
      <PaintedGround center={[0, 0]} w={100} d={100} ppm={12} paint={paintFarm} />
      <StandingCrop />
      <Connected>
        <Harvest />
        <WeatherStation position={WEATHER} />
      </Connected>
      <GrainBins />
      <Faded>
        <Crop />
        <Prop model="barn" position={[-25, 0, -1.5]} rotation={Math.PI / 2} scale={0.8} />
        <Prop model="machineShed" position={[-23, 0, -20.5]} />
        <Instances model="farmFence" items={FENCE} />
        <Instances model="tree" items={TREES} />
        <Prop model="wheelbarrow" position={[-17, 0, 4.6]} rotation={0.6} />
        <Prop model="plywoodCrate" position={[-15.6, 0, 3.4]} />
        <Prop model="greenCrate" position={[-15.6, 1.0, 3.4]} rotation={0.3} />
        <Prop model="ibc" position={[-17.2, 0, -15.4]} />
        <Prop model="ibc" position={[-18.6, 0, -15.6]} rotation={0.1} />
      </Faded>
      <Anchor id="ag-silo" position={[BINS[0], 9.2, BINS[2] + BIN_DZ]} />
      <Anchor id="ag-weather" position={[WEATHER[0], 4.8, WEATHER[2]]} />
    </group>
  )
}

// ------------------------------------------------------------------ telemetry

const callouts: CalloutDef[] = [
  {
    id: "ag-combine",
    scene: "agriculture",
    title: "Combine Harvester",
    bars: 4,
    delay: 0,
    status: (t) => `Yield ${Math.round(212 + Math.sin(t * 0.6) * 9)} bu/ac · 3.4 mph`,
  },
  {
    id: "ag-cart",
    scene: "agriculture",
    title: "Grain Cart",
    bars: 3,
    delay: 0.5,
    status: (t) => `${Math.min(96, 62 + Math.floor(sceneClock("agriculture").local * 1.6))}% full · 1,140 bu`,
  },
  {
    id: "ag-silo",
    scene: "agriculture",
    title: "Grain Bin 2",
    bars: 4,
    delay: 0.9,
    status: (t) => `64% · ${(14.1 + Math.sin(t * 0.1) * 0.2).toFixed(1)}% moisture · 58°F`,
  },
  {
    id: "ag-weather",
    scene: "agriculture",
    title: "Field Weather Station",
    bars: 3,
    delay: 1.3,
    status: (t) => `Wind ${Math.round(9 + Math.sin(t * 0.7) * 2)} mph · soil 61% VWC`,
  },
]

export const agriculture: SceneDef = {
  id: "agriculture",
  view: { center: [-2, 5, -6], span: 72 },
  Component: Agriculture,
  callouts,
}
