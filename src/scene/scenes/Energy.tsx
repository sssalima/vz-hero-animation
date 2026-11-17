import { useMemo } from "react"
import { CatmullRomCurve3, TubeGeometry, Vector3 } from "three"
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
  type V3,
} from "../common"
import { Instances, type Placement } from "../instances"
import { useClone, usePart } from "../models"
import type { SceneDef } from "."

/**
 * Energy: a grid edge with generation and storage. A wind turbine, the solar field's
 * inverter bank, a substation transformer and a battery storage unit carry SIMs; the rest of
 * the substation, distant turbines, poles and lines are ghosted.
 */

/** fenced substation compound */
const SUB = { x0: -22, x1: -2.6, z0: -10.4, z1: 4.4 }
const T1: V3 = [-9, 0, -16]
const XFMR: V3 = [-6.8, 0, 0.6]
const XFMR_2: V3 = [-14.6, 0, 0.6]
const BAY: V3 = [-12.2, 0, -6.9]
const BAY_SCALE = 0.72
const BESS: V3 = [2.4, 0, -2.6]
const INVERTER: V3 = [-0.4, 0, -9.8]
const FAR_TURBINES: [V3, number][] = [
  [[8, 0, -33], 2.1],
  [[-33, 0, -4], 4.0],
  [[-42, 0, -26], 1.2],
]
const SOLAR_ROWS = [-13.4, -18.6, -23.8]
const SOLAR_X0 = -1.8
const SOLAR_PAIRS = 7
const SOLAR_TILT = 0.44
const SOLAR_Y = 1.55

function paintSite(g: CanvasRenderingContext2D, M: (m: number) => number) {
  // origin (-60, -60): 120 x 120 m of rough grassland
  const X = (x: number) => M(x + 60)
  const Z = (z: number) => M(z + 60)
  g.fillStyle = "#f7f8f6"
  g.fillRect(0, 0, M(120), M(120))
  for (let i = 0; i < 900; i++) {
    const x = (Math.sin(i * 12.9898) * 43758.5453) % 1
    const z = (Math.sin(i * 78.233) * 12543.123) % 1
    g.fillStyle = `rgba(0,0,0,${0.012 + Math.abs(x) * 0.02})`
    g.beginPath()
    g.arc(Math.abs(x) * M(120), Math.abs(z) * M(120), M(0.6 + Math.abs(z) * 1.8), 0, Math.PI * 2)
    g.fill()
  }
  // gravel substation pad + BESS pad
  g.fillStyle = "#e9eaea"
  g.fillRect(X(SUB.x0 - 0.5), Z(SUB.z0 - 0.5), M(SUB.x1 - SUB.x0 + 1), M(SUB.z1 - SUB.z0 + 1))
  g.fillRect(X(-1.6), Z(-8.4), M(8.2), M(8.6))
  // access road
  g.fillStyle = "#eeefef"
  g.fillRect(X(-60), Z(5.4), M(70), M(3.6))
  g.fillRect(X(6.4), Z(-28), M(3.6), M(37))
  g.fillStyle = "rgba(0,0,0,0.05)"
  g.fillRect(X(-60), Z(5.4), M(70), M(0.08))
  g.fillRect(X(-60), Z(8.9), M(70), M(0.08))
  // turbine hardstands
  for (const [[x, , z]] of [[T1], ...FAR_TURBINES]) {
    g.fillStyle = "#ececec"
    g.fillRect(X(x - 3), Z(z - 3), M(6), M(6))
  }
}

// ------------------------------------------------------------------ wind

/** 20 m turbine; the rotor (split out by ingest, pivoted on the hub) spins about the shaft. */
function WindTurbine({ position, phase = 0 }: { position: V3; phase?: number }) {
  const scene = useClone("windTurbine")
  const rotor = usePart(scene, "rotor")
  const hub = ASSET_META.wind_turbine.parts.rotor
  useSceneFrame((t) => {
    // clockwise seen from upwind (the rotor faces the viewer), as real turbines turn
    if (rotor) rotor.rotation.x = -(t * 1.05 + phase)
  })
  return (
    // yawed into the wind with the rotor facing the viewer
    <group position={position} rotation-y={-Math.PI / 4}>
      <primitive object={scene} />
      {/* aviation light on the nacelle roof, near its tail */}
      <Box args={[0.12, 0.07, 0.12]} position={[hub[0] - 2.6, hub[1] + 0.3, hub[2]]} material={glow("#ff3b30", 2)} shadow={false} />
    </group>
  )
}

// ------------------------------------------------------------------ solar

const SOLAR: Placement[] = SOLAR_ROWS.flatMap((z) =>
  Array.from({ length: SOLAR_PAIRS }, (_, k) => ({
    position: [SOLAR_X0 + (k + 0.5) * 2.04, SOLAR_Y, z] as [number, number, number],
    tilt: SOLAR_TILT,
  })),
)

/** world (y, z) of a point `zl` metres along the module plane from its centre (+ toward the low front edge) */
const onPlane = (zl: number) => [SOLAR_Y - zl * Math.sin(SOLAR_TILT), zl * Math.cos(SOLAR_TILT)] as const

/** Fixed-tilt rows facing the viewer: sourced PV module pairs on driven-pile racking (piles, purlins, rafters). */
function SolarField() {
  const len = SOLAR_PAIRS * 2.04
  const cx = SOLAR_X0 + len / 2
  const piles = Math.round(len / 3)
  const purlins = [-1.4, 1.4].map(onPlane)
  return (
    <group>
      <Instances model="solarTable" items={SOLAR} />
      {SOLAR_ROWS.map((z) => (
        <group key={z} position={[0, 0, z]}>
          {purlins.map(([y, pz]) => (
            <Box key={pz} args={[len, 0.07, 0.07]} position={[cx, y - 0.09, pz]} material={PAL.steel} shadow={false} />
          ))}
          {Array.from({ length: piles + 1 }, (_, k) => SOLAR_X0 + 0.3 + k * ((len - 0.6) / piles)).map((x) => (
            <group key={x}>
              {purlins.map(([y, pz]) => (
                <Box key={pz} args={[0.08, y - 0.12, 0.08]} position={[x, (y - 0.12) / 2, pz]} material={PAL.steel} shadow={false} />
              ))}
              <Box args={[0.06, 0.06, 3.4]} position={[x, SOLAR_Y - 0.13, 0]} rotation={[SOLAR_TILT, 0, 0]} material={PAL.steel} shadow={false} />
            </group>
          ))}
        </group>
      ))}
    </group>
  )
}

/** String inverters + disconnects (sourced) on a unistrut frame over a small pad. */
function InverterBank({ position }: { position: V3 }) {
  const back = -ASSET_META.inverter.size[2] / 2 - 0.04
  return (
    <group position={position}>
      <Box args={[3.3, 0.12, 1.2]} position={[0, 0.06, -0.1]} material={PAL.concrete} />
      {[-1.25, 0, 1.25].map((x) => (
        <Box key={x} args={[0.06, 2.35, 0.06]} position={[x, 1.29, back]} material={PAL.steel} />
      ))}
      {[0.95, 1.9].map((y) => (
        <Box key={y} args={[2.9, 0.05, 0.05]} position={[0, y, back]} material={PAL.steel} shadow={false} />
      ))}
      <group position={[0, 0.12, 0]}>
        <Prop model="inverter" position={[0, 0, 0]} />
      </group>
      <Box args={[0.16, 0.05, 0.02]} position={[-0.95, 2.05, 0.34]} material={glow("#76b900", 3)} shadow={false} />
    </group>
  )
}

// ------------------------------------------------------------------ substation

/** Chain-link perimeter from SimReady fence panels (stretched to 2.1 m), with a gate gap on the road side. */
function Fence() {
  const items = useMemo(() => {
    const { x0, x1, z0, z1 } = SUB
    const P = 1.22
    const out: Placement[] = []
    const scale: [number, number, number] = [1, 2, 1]
    for (let x = x0 + P; x <= x1 + 0.01; x += P) {
      out.push({ position: [x - 0.11, 0, z0], rotation: -Math.PI / 2, scale })
      // gate opening opposite the transformers
      if (x < -11 || x > -5.2) out.push({ position: [x - 0.11, 0, z1], rotation: -Math.PI / 2, scale })
    }
    for (let z = z0 + P; z <= z1 + 0.01; z += P) {
      out.push({ position: [x0, 0, z - 0.11], scale })
      out.push({ position: [x1, 0, z - 0.11], scale })
    }
    return out
  }, [])
  return <Instances model="fence" items={items} />
}

function Substation() {
  return (
    <group>
      <Fence />
      <group position={XFMR_2} scale={0.9}>
        <Prop model="transformer" position={[0, 0, 0]} />
      </group>
      <group position={BAY} scale={BAY_SCALE}>
        <Prop model="substationBay" position={[0, 0, 0]} />
      </group>
      <group position={[-18.6, 0, -14]} scale={[0.62, 1, 0.8]}>
        <Prop model="controlHouse" position={[0, 0, 0]} />
      </group>
    </group>
  )
}

// ------------------------------------------------------------------ storage + lines

const BESS_L = ASSET_META.bess.size[0]

/**
 * Battery storage (fallback until a licensed BESS model is supplied): the sourced ISO container
 * shell in white, closed at its +x end by a wall carrying two HVAC units, on a concrete plinth.
 */
function BessUnit({ lamp = false }: { lamp?: boolean }) {
  const end = BESS_L / 2 - 0.12
  return (
    <group>
      <Box args={[BESS_L + 0.5, 0.2, 2.9]} position={[0, 0.1, 0]} material={PAL.concrete} />
      <group position={[0, 0.2, 0]}>
        <Prop model="bess" position={[0, 0, 0]} />
        <Box args={[0.08, 2.4, 2.44]} position={[end, 1.21, 0]} material={PAL.white} />
        {[-0.6, 0.6].map((z) => (
          <group key={z} position={[end + 0.3, 1.25, z]}>
            <Box args={[0.5, 1.6, 0.95]} material={PAL.light} />
            <Cyl r={0.3} h={0.04} position={[0.26, 0.25, 0]} rotation={[0, 0, Math.PI / 2]} material={PAL.dark} seg={20} />
            <Box args={[0.02, 0.5, 0.8]} position={[0.26, -0.45, 0]} material={PAL.mid} shadow={false} />
          </group>
        ))}
        {/* conduit from the end wall down into the plinth */}
        <Box args={[0.08, 1.6, 0.08]} position={[end + 0.1, 0.8, 1.05]} material={PAL.steel} shadow={false} />
        {lamp && <Box args={[0.2, 0.05, 0.02]} position={[-1.8, 2.25, 1.23]} material={glow("#76b900", 3)} shadow={false} />}
      </group>
    </group>
  )
}

/** sagging conductor between two points */
function Wire({ a, b, sag = 1.4 }: { a: V3; b: V3; sag?: number }) {
  const geo = useMemo(() => {
    const pts = Array.from({ length: 9 }, (_, i) => {
      const k = i / 8
      return new Vector3(
        a[0] + (b[0] - a[0]) * k,
        a[1] + (b[1] - a[1]) * k - sag * 4 * k * (1 - k),
        a[2] + (b[2] - a[2]) * k,
      )
    })
    return new TubeGeometry(new CatmullRomCurve3(pts), 24, 0.035, 4, false)
  }, [a, b, sag])
  return <mesh geometry={geo} material={PAL.dark} />
}

const LINE_Z = BAY[2]
const POLES: V3[] = [
  [-29, 0, LINE_Z],
  [-44, 0, LINE_Z],
  [-59, 0, LINE_Z],
]
const ARM_Y = 20.9
const ARM_DZ = [-2.25, 0, 2.25]
/** where the line terminates on the substation structure's west end */
const DEAD_END: V3 = [BAY[0] - 6.4, 4.9, LINE_Z]

function Lines() {
  const ends: V3[] = [DEAD_END, ...POLES.map((p) => [p[0], ARM_Y, p[2]] as V3)]
  return (
    <group>
      {POLES.map((p) => (
        <Prop key={p[0]} model="utilityPole" position={p} rotation={Math.PI / 2} />
      ))}
      {ends.slice(0, -1).map((e, i) =>
        ARM_DZ.map((dz) => (
          <Wire
            key={`${i}${dz}`}
            a={[e[0], e[1] - (i === 0 ? 0 : 0.4), e[2] + dz * (i === 0 ? 0.8 : 1)]}
            b={[ends[i + 1][0], ends[i + 1][1] - 0.4, ends[i + 1][2] + dz]}
            sag={i === 0 ? 0.8 : 1.6}
          />
        )),
      )}
    </group>
  )
}

function Energy() {
  const xfmrTop = ASSET_META.transformer.size[1]
  const hub = ASSET_META.wind_turbine.parts.rotor
  return (
    <group>
      <BaseFloor />
      <PaintedGround center={[0, 0]} w={120} d={120} ppm={10} paint={paintSite} />
      <Connected>
        <WindTurbine position={T1} phase={0.4} />
        <SolarField />
        <InverterBank position={INVERTER} />
        <group position={XFMR}>
          <Prop model="transformer" position={[0, 0, 0]} />
          <Box args={[0.14, 0.05, 0.02]} position={[2.2, 1.6, ASSET_META.transformer.size[2] / 2 - 0.2]} material={glow("#76b900", 3)} shadow={false} />
        </group>
        <group position={BESS}>
          <BessUnit lamp />
        </group>
      </Connected>
      <Faded>
        {FAR_TURBINES.map(([p, phase]) => (
          <WindTurbine key={p[0]} position={p} phase={phase} />
        ))}
        <Substation />
        <group position={[BESS[0], 0, BESS[2] - 3.4]}>
          <BessUnit />
        </group>
        <Lines />
      </Faded>
      <Anchor id="en-turbine" position={[T1[0] - 0.5, hub[1] + 1.4, T1[2] + 0.5]} />
      <Anchor id="en-solar" position={[INVERTER[0], 2.9, INVERTER[2]]} />
      <Anchor id="en-xfmr" position={[XFMR[0] + 1.0, xfmrTop + 0.6, XFMR[2]]} />
      <Anchor id="en-bess" position={[BESS[0] + 1.5, 3.3, BESS[2]]} />
    </group>
  )
}

// ------------------------------------------------------------------ telemetry

const callouts: CalloutDef[] = [
  {
    id: "en-turbine",
    scene: "energy",
    title: "Wind Turbine 07",
    bars: 4,
    delay: 0,
    status: (t) => `${(2.4 + Math.sin(t * 0.3) * 0.15).toFixed(2)} MW · 10 rpm · yaw 225°`,
  },
  {
    id: "en-solar",
    scene: "energy",
    title: "Solar Inverter B",
    bars: 3,
    delay: 0.5,
    status: (t) => `${Math.round(842 + Math.sin(t * 0.2) * 12)} kW · 98.6% eff.`,
  },
  {
    id: "en-xfmr",
    scene: "energy",
    title: "Substation T1",
    bars: 4,
    delay: 0.9,
    status: (t) => `Load ${Math.round(71 + Math.sin(t * 0.25) * 3)}% · oil ${(61.2 + Math.sin(t * 0.1)).toFixed(1)}°C`,
  },
  {
    id: "en-bess",
    scene: "energy",
    title: "Battery Storage",
    bars: 4,
    delay: 1.3,
    status: (t) => `${(78 + (t / 30) % 6).toFixed(1)}% SoC · charging 1.2 MW`,
  },
]

export const energy: SceneDef = {
  id: "energy",
  view: { center: [-2, 9, -6], span: 56 },
  Component: Energy,
  callouts,
}
