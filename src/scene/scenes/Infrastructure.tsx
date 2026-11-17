import { useThree } from "@react-three/fiber"
import { useLayoutEffect, useMemo, useRef } from "react"
import { ExtrudeGeometry, Group, Plane, Shape, Vector3, type Material, type Mesh, type Object3D } from "three"
import { ASSET_META } from "../assetMeta"
import { Anchor, type CalloutDef } from "../callouts"
import { sceneClock } from "../carousel"
import {
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
import { Instances, type Placement } from "../instances"
import { useClone } from "../models"
import { Car, type CarKind } from "../vehicles"
import type { SceneDef } from "."

/**
 * Infrastructure: a downtown intersection drawn as a cut-away block so the metro station
 * beneath the avenue is visible. The traffic signal, a street camera, a smart streetlight
 * and the metro train carry SIMs; buildings, street furniture and traffic are ghosted.
 */

// slab extents (street level y = 0); the +x face is cut open through the station and tunnel
const SLAB = { x0: -34, x1: 6, z0: -34, z1: 8, depth: 7 }
// sourced station sections under the avenue, turned so the track runs along the cut face (the
// street lid hides anything deeper in) with the platform behind it; bored tube beyond
const SECTION_L = ASSET_META.subway_station.size[2]
const STATION = { x: 1.8, y: -6.6, sections: 3 }
const STATION_Z0 = SLAB.z1 - SECTION_L * STATION.sections
/** section-local track centre is x = -2.48; the platform runs from -1.0 to 4.5 */
const TRACK_X = STATION.x + 2.48
const RAIL_Y = STATION.y + 0.85
const PLATFORM_Y = STATION.y + 1.52
const TUBE_Y = RAIL_Y - 0.75
const TUBE_R = ASSET_META.subway_tunnel.size[1] / 2
const TUBE_SEGMENTS = 2
const TRAIN_STOP = (STATION_Z0 + SLAB.z1) / 2
const CAR_L = ASSET_META.metro_car.size[0]
const SIGNAL: V3 = [3.6, 0, 0.6]
const CAMERA_POLE: V3 = [-4.6, 0, -6.6]
const SMART_LIGHT: V3 = [4.8, 0, -11.2]
/** street entrance on the west sidewalk; its stair shaft runs down inside the earth block */
const ENTRANCE: V3 = [-5.8, 0, -13.6]

function paintStreets(g: CanvasRenderingContext2D, M: (m: number) => number) {
  // origin (x0, z0): 40 x 42 m
  const X = (x: number) => M(x - SLAB.x0)
  const Z = (z: number) => M(z - SLAB.z0)
  g.fillStyle = "#f3f4f4"
  g.fillRect(0, 0, M(40), M(42))
  // sidewalk paving joints
  g.strokeStyle = "rgba(0,0,0,0.04)"
  g.lineWidth = 1
  for (let a = 0; a < 42; a += 1.5) {
    g.beginPath()
    g.moveTo(0, M(a))
    g.lineTo(M(40), M(a))
    g.stroke()
    g.beginPath()
    g.moveTo(M(a), 0)
    g.lineTo(M(a), M(42))
    g.stroke()
  }
  // roadways: avenue along z (x -4..3), cross street along x (z -6..0)
  g.fillStyle = "#e1e3e5"
  g.fillRect(X(-4), 0, M(7), M(42))
  g.fillRect(0, Z(-6), X(3), M(6))
  // centre line + lane dashes
  g.fillStyle = "rgba(0,0,0,0.18)"
  for (let z = SLAB.z0; z < SLAB.z1; z += 4) if (z < -7 || z > 1) g.fillRect(X(-0.55), Z(z), M(0.12), M(2))
  // crosswalks
  g.fillStyle = "#ffffff"
  for (let k = 0; k < 12; k++) {
    g.fillRect(X(-3.8 + k * 0.58), Z(0.4), M(0.32), M(2.2))
    g.fillRect(X(-3.8 + k * 0.58), Z(-8.6), M(0.32), M(2.2))
  }
  for (let k = 0; k < 10; k++) g.fillRect(X(-7.2), Z(-5.8 + k * 0.58), M(2.2), M(0.32))
  // stop bars
  g.fillRect(X(-0.5), Z(3.0), M(3.4), M(0.35))
  g.fillRect(X(-4), Z(-9.2), M(3.4), M(0.35))
}

// ------------------------------------------------------------------ cut-away block

/** Earth west of the bored tube: a box with a half-round notch where the tube lining sits. */
function useTubeEarth() {
  return useMemo(() => {
    const cy = TUBE_Y + TUBE_R
    const s = new Shape()
    const top = -1
    const bottom = -SLAB.depth
    s.moveTo(SLAB.x0, bottom)
    s.lineTo(TRACK_X, bottom)
    s.lineTo(TRACK_X, cy - TUBE_R)
    s.absarc(TRACK_X, cy, TUBE_R, -Math.PI / 2, Math.PI / 2, true)
    s.lineTo(TRACK_X, top)
    s.lineTo(SLAB.x0, top)
    s.closePath()
    const depth = STATION_Z0 - SLAB.z0
    // shape in (x, y), extruded along +z from the slab's south edge
    return new ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 24 }).translate(0, 0, SLAB.z0)
  }, [])
}

function Block() {
  const earth = mat("#a7adb2", { rough: 0.95 })
  const tubeEarth = useTubeEarth()
  const { x0, x1, z0, z1, depth } = SLAB
  const L = z1 - z0
  const cz = (z0 + z1) / 2
  const sL = z1 - STATION_Z0
  const tubeL = STATION_Z0 - z0
  const segL = ASSET_META.subway_tunnel.size[2]
  // the platform's outer wall (section-local x = 4.5) becomes the back of the turned station
  const stationBack = STATION.x - 4.5
  return (
    <group>
      {/* street crust over everything */}
      <Box args={[x1 - x0, 1, L]} position={[(x0 + x1) / 2, -0.5, cz]} material={earth} />
      {/* ground west of the station + under it */}
      <Box args={[stationBack - x0, depth - 1, sL]} position={[(x0 + stationBack) / 2, -1 - (depth - 1) / 2, STATION_Z0 + sL / 2]} material={earth} />
      <Box args={[x1 - stationBack, depth + STATION.y, sL]} position={[(stationBack + x1) / 2, (-depth + STATION.y) / 2, STATION_Z0 + sL / 2]} material={earth} />
      {/* ground around the running tunnel + its invert */}
      <mesh geometry={tubeEarth} material={earth} castShadow receiveShadow />
      <Box args={[x1 - TRACK_X, depth + TUBE_Y, tubeL]} position={[(TRACK_X + x1) / 2, (-depth + TUBE_Y) / 2, z0 + tubeL / 2]} material={earth} />
      {/* sourced station sections + tube segments */}
      {Array.from({ length: STATION.sections }, (_, k) => (
        <Prop key={k} model="subwayStation" position={[STATION.x, STATION.y, z1 - SECTION_L * (k + 0.5)]} rotation={Math.PI} />
      ))}
      {Array.from({ length: TUBE_SEGMENTS }, (_, k) => (
        <Prop
          key={k}
          model="subwayTunnel"
          position={[TRACK_X, TUBE_Y, z0 + (tubeL / TUBE_SEGMENTS) * (k + 0.5)]}
          scale={[1, 1, tubeL / TUBE_SEGMENTS / segL]}
        />
      ))}
      {/* running rails through the tube (the station sections carry their own track) */}
      {[-0.68, 0.68].map((dx) => (
        <Box key={dx} args={[0.08, 0.12, tubeL]} position={[TRACK_X + dx, RAIL_Y - 0.06, z0 + tubeL / 2]} material={PAL.steel} shadow={false} />
      ))}
    </group>
  )
}

// ------------------------------------------------------------------ street level

const TREES: Placement[] = [
  [-6.4, 9.8],
  [-6.4, -18.6],
  [-6.4, -24.5],
  [4.8, -20],
].map(([x, z], i) => ({ position: [x, 0, z] as [number, number, number], scale: 0.55, rotation: i * 1.3 }))

function StreetFurniture() {
  return (
    <group>
      <Prop model="bench" position={[-6.2, 0, 4.5]} rotation={Math.PI / 2} scale={0.55} />
      <Prop model="bikeRack" position={[-6.8, 0, 1.2]} rotation={Math.PI / 2} />
      <Prop model="hydrant" position={[3.4, 0, 4.2]} />
      <Prop model="cityTrashcan" position={[3.8, 0, 2.4]} />
      <Prop model="cityTrashcan" position={[-5.2, 0, 2.2]} />
      {[-15, -13, -17].map((z) => (
        <Prop key={z} model="bollard" position={[3.35, 0, z]} />
      ))}
      <Prop model="crosswalkSignal" position={[-4.4, 2.4, 0.4]} rotation={Math.PI} />
      <Cyl r={0.06} h={2.6} position={[-4.4, 1.3, 0.4]} material={PAL.steel} seg={8} />
      <Prop model="ledStreetlamp" position={[-5.2, 0, 6.5]} rotation={0} scale={0.62} />
      <Prop model="ledStreetlamp" position={[-5.2, 0, -21.6]} rotation={0} scale={0.62} />
      {TREES.map((t) => (
        <Box key={t.position[2]} args={[1.2, 0.05, 1.2]} position={[t.position[0], 0.03, t.position[2]]} material={PAL.dark} shadow={false} />
      ))}
      <Instances model="tree" items={TREES} />
      {/* EV chargers at the kerb, facing the parking lane */}
      {[-27.6, -30.8].map((z) => (
        <Prop key={z} model="evCharger" position={[-6.9, 0, z]} />
      ))}
      <Prop model="streetCabinet" position={[4.6, 0, 1.6]} rotation={Math.PI / 2} />
    </group>
  )
}

/** Ghosted city block: sourced low-rise office + department store buildings fitted to the lots. */
function Buildings() {
  return (
    <group>
      <Prop model="cityBuilding" position={[-14.6, 0, -21]} rotation={Math.PI / 2} />
      <group position={[-27.2, 0, -21]} rotation-y={Math.PI / 2} scale={[0.7, 0.85, 0.7]}>
        <Prop model="cityStore" position={[0, 0, 0]} />
      </group>
      <group position={[-13, 0, 4.3]} scale={[1, 1, 0.74]}>
        <Prop model="cityOffice" position={[0, 0, 0]} />
      </group>
      <group position={[-24.5, 0, 4.3]} scale={[1.1, 0.8, 0.74]}>
        <Prop model="cityOffice" position={[0, 0, 0]} />
      </group>
    </group>
  )
}

function Traffic() {
  // queued at the stop lines while the avenue has the green
  const cars: { p: V3; r: number; kind: CarKind }[] = [
    { p: [-9.5, 0, -4.4], r: 0, kind: "sedan" },
    { p: [-15.2, 0, -4.4], r: 0, kind: "suv" },
    { p: [-20.8, 0, -4.4], r: 0, kind: "hatch" },
    { p: [1.3, 0, -20], r: -Math.PI / 2, kind: "suv" },
    { p: [-2.4, 0, -14], r: -Math.PI / 2, kind: "sedan" },
    { p: [-2.4, 0, 6.5], r: -Math.PI / 2, kind: "hatch" },
  ]
  return (
    <group>
      {cars.map((c, i) => (
        <group key={i} position={c.p} rotation-y={c.r}>
          <Car kind={c.kind} />
        </group>
      ))}
    </group>
  )
}

// ------------------------------------------------------------------ connected

const SIG_PERIOD = 14
const signalPhase = (t: number) => {
  const u = ((t % SIG_PERIOD) + SIG_PERIOD) % SIG_PERIOD
  return u < 8 ? "green" : u < 10 ? "amber" : "red"
}
const LAMP_OFF = mat("#30353a", { rough: 0.4 })
const LAMPS = {
  red: glow("#ff3b30", 2.6),
  amber: glow("#ffb020", 2.6),
  green: glow("#76b900", 3),
}
const LENSES = ["red", "amber", "green"] as const
/** span of the SimReady mast arm (pole bracket at +x) */
const ARM_W = 6.24

function meshesOf(o: Object3D | undefined) {
  const out: Mesh[] = []
  o?.traverse((m) => {
    if ((m as Mesh).isMesh) out.push(m as Mesh)
  })
  return out
}

/** Sourced 3-section head (lenses face +z); its red / amber / green lens parts are driven live. */
function SignalHead({ position }: { position: V3 }) {
  const scene = useClone("trafficSignal")
  const lenses = useMemo(() => LENSES.map((n) => meshesOf(scene.getObjectByName(n))), [scene])
  useSceneFrame((t) => {
    const p = signalPhase(t)
    LENSES.forEach((n, k) => {
      for (const m of lenses[k]) m.material = p === n ? LAMPS[n] : LAMP_OFF
    })
  })
  return <primitive object={scene} position={position} />
}

/** Tapered pole with the SimReady mast arm; heads hang from the arm, controller cabinet at the base. */
function TrafficSignal({ position, arm = 1 }: { position: V3; arm?: number }) {
  const ARM_Y = 5.3
  const W = ARM_W * arm
  // the arm rises ~1.2 m from the pole bracket to its tip
  const headAt = (u: number) => [-W * u, ARM_Y + 0.25 + 1.0 * u - 0.9, 0.0] as V3
  return (
    <group position={position}>
      <Cyl r={0.16} r2={0.11} h={ARM_Y + 0.9} position={[0, (ARM_Y + 0.9) / 2, 0]} material={PAL.steel} seg={14} />
      <group position={[-W / 2, ARM_Y, 0]} scale={[arm, 1, 1]}>
        <Prop model="signalArm" position={[0, 0, 0]} />
      </group>
      <SignalHead position={headAt(0.42)} />
      <SignalHead position={headAt(0.86)} />
      <Box args={[0.4, 0.6, 0.3]} position={[0.1, 1.4, 0.26]} material={PAL.dark} />
    </group>
  )
}
function CameraPole({ position }: { position: V3 }) {
  return (
    <group position={position}>
      <Cyl r={0.12} h={5.4} position={[0, 2.7, 0]} material={PAL.steel} seg={10} />
      <Box args={[0.9, 0.08, 0.08]} position={[0.4, 5.2, 0]} material={PAL.steel} />
      <group position={[0.85, 5.05, 0]} rotation-y={-Math.PI / 4}>
        <Prop model="securityCamD" position={[0, -0.2, 0]} rotation={Math.PI / 2} scale={2.6} />
      </group>
      <group position={[-0.1, 4.6, 0.15]} rotation-y={Math.PI / 4}>
        <Prop model="securityCamA" position={[0, -0.1, 0]} rotation={Math.PI / 2} scale={2.6} />
      </group>
      <Box args={[0.3, 0.5, 0.2]} position={[0, 2.2, 0.15]} material={PAL.dark} />
    </group>
  )
}

const LAMP_SCALE = 0.62
/** the SimReady LED streetlamp's pole sits 2.34 m from its origin, its head 2.35 m the other side */
const LAMP_POLE_X = 2.34

/** SimReady LED streetlamp whose own emissive lens dims with the schedule, plus sensor node + small cell. */
function SmartStreetlight({ position }: { position: V3 }) {
  const scene = useClone("ledStreetlamp")
  const lens = useMemo(
    () => meshesOf(scene).filter((m) => /emissive/i.test((m.material as Material).name)),
    [scene],
  )
  useSceneFrame((t) => {
    const on = Math.sin(t * 0.6) > -0.2 ? glow("#ffffff", 2.4) : glow("#ffffff", 1.2)
    for (const m of lens) m.material = on
  })
  const top = 13.74 * LAMP_SCALE
  return (
    <group position={position}>
      <group position={[-LAMP_POLE_X * LAMP_SCALE, 0, 0]} scale={LAMP_SCALE}>
        <primitive object={scene} />
      </group>
      <Box args={[0.22, 0.14, 0.22]} position={[0, top + 0.1, 0]} material={PAL.black} />
      <Cyl r={0.12} h={0.9} position={[0, top - 1.6, 0.18]} material={PAL.light} seg={10} />
    </group>
  )
}

/** keeps the arriving train from showing beyond the slab's south edge */
const SLAB_CLIP = new Plane(new Vector3(0, 0, 1), -SLAB.z0)

/** Two R142 cars pulling into the platform on each visit. */
function Metro() {
  const ref = useRef<Group>(null)
  const gl = useThree((s) => s.gl)
  const a = useClone("metroCar")
  const b = useClone("metroCar")
  useLayoutEffect(() => {
    gl.localClippingEnabled = true
    for (const car of [a, b])
      for (const m of meshesOf(car)) {
        const src = m.material as Material
        if (src.clippingPlanes?.length) continue
        const c = src.clone()
        c.clippingPlanes = [SLAB_CLIP]
        m.material = c
      }
  }, [gl, a, b])
  useSceneFrame(() => {
    const { local } = sceneClock("infrastructure")
    // decelerate from ~30 m out to a stop at the platform, then dwell
    const s = Math.min(1, local / 6.5)
    const e = 1 - (1 - s) * (1 - s)
    if (ref.current) ref.current.position.z = TRAIN_STOP - 30 * (1 - e)
  })
  return (
    <group ref={ref} position={[TRACK_X, RAIL_Y, TRAIN_STOP]} rotation-y={-Math.PI / 2}>
      <primitive object={a} position={[CAR_L / 2 + 0.25, 0, 0]} />
      <primitive object={b} position={[-CAR_L / 2 - 0.25, 0, 0]} />
      <Anchor id="in-metro" position={[0, 3.6, 0]} />
    </group>
  )
}

function Infrastructure() {
  const { x0, x1, z0, z1 } = SLAB
  return (
    <group>
      <PaintedGround center={[(x0 + x1) / 2, (z0 + z1) / 2]} w={x1 - x0} d={z1 - z0} ppm={30} paint={paintStreets} y={0.002} />
      <Connected>
        <Metro />
        <TrafficSignal position={SIGNAL} />
        <CameraPole position={CAMERA_POLE} />
        <SmartStreetlight position={SMART_LIGHT} />
      </Connected>
      <Faded>
        <Block />
        <group position={ENTRANCE} scale={[0.5, -PLATFORM_Y / 4.72, 1]}>
          <Prop model="subwayEntrance" position={[0, 0, 0]} />
        </group>
        <TrafficSignal position={[-4.6, 0, -6.9 - 2.2]} arm={0.62} />
        <Buildings />
        <StreetFurniture />
        <Traffic />
      </Faded>
      <Anchor id="in-signal" position={[SIGNAL[0] - 2.6, 6.6, SIGNAL[2]]} />
      <Anchor id="in-camera" position={[CAMERA_POLE[0] + 0.4, 6.0, CAMERA_POLE[2]]} />
      <Anchor id="in-light" position={[SMART_LIGHT[0] - 1.5, 9.6, SMART_LIGHT[2]]} />
    </group>
  )
}

// ------------------------------------------------------------------ telemetry

const callouts: CalloutDef[] = [
  {
    id: "in-signal",
    scene: "infrastructure",
    title: "Traffic Signal",
    bars: 4,
    delay: 0,
    status: (t) => {
      const p = signalPhase(t)
      const u = ((t % SIG_PERIOD) + SIG_PERIOD) % SIG_PERIOD
      const left = Math.ceil((p === "green" ? 8 : p === "amber" ? 10 : SIG_PERIOD) - u)
      return `Adaptive · ${p} ${left}s · 14 queued`
    },
  },
  {
    id: "in-camera",
    scene: "infrastructure",
    title: "Street Camera 14",
    bars: 4,
    delay: 0.5,
    status: (t) => (t % 11 < 7 ? "Streaming 4K · 6.2 Mbps" : "Event: near-miss logged"),
  },
  {
    id: "in-light",
    scene: "infrastructure",
    title: "Smart Streetlight",
    bars: 3,
    delay: 0.9,
    status: (t) => `Dimmed ${Math.sin(t * 0.6) > -0.2 ? 40 : 70}% · air AQI ${Math.round(34 + hash(Math.floor(t / 8)) * 6)}`,
  },
  {
    id: "in-metro",
    scene: "infrastructure",
    title: "Metro Line 2",
    bars: 4,
    delay: 1.3,
    status: () => {
      const { local } = sceneClock("infrastructure")
      return local < 6.5 ? `Arriving · ${Math.max(1, Math.ceil(6.5 - local))}s · 68% load` : "Doors open · dwell 30s"
    },
  },
]

export const infrastructure: SceneDef = {
  id: "infrastructure",
  view: { center: [0, -3, -9], span: 40 },
  Component: Infrastructure,
  callouts,
}
