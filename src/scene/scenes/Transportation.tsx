import { useMemo, useRef, type ReactNode } from "react"
import { ExtrudeGeometry, Group, Matrix4, Shape } from "three"
import { ASSET_META } from "../assetMeta"
import { Anchor, setAnchorAlpha, type CalloutDef } from "../callouts"
import { sceneClock } from "../carousel"
import {
  BaseFloor,
  Connected,
  Faded,
  hash,
  PaintedGround,
  PAL,
  Prop,
  useSceneFrame,
} from "../common"
import { Instances, placementMatrix, useInstancePool, type Placement } from "../instances"
import { BoxTruck, CAR_MODEL, Semi, ServicePickup, Van, type CarKind } from "../vehicles"
import type { SceneDef } from "."

/**
 * Transportation: a six-lane freeway. Connected fleet vehicles (delivery trucks, reefer
 * semi, service van, field-service pickup) drift in and out with the traffic; regular
 * traffic, barriers, lighting and gantries are ghosted.
 */

const VIEW = { center: [0, 2, 0] as [number, number, number], span: 46 }
const WRAP = 240
const SLOT = 24
const SLOTS = WRAP / SLOT

type Lane = { z: number; dir: 1 | -1; v: number }
const LANES: Lane[] = [
  { z: 2.25, dir: 1, v: 6.0 },
  { z: 5.75, dir: 1, v: 5.2 },
  { z: 9.25, dir: 1, v: 4.4 },
  { z: -2.25, dir: -1, v: 6.4 },
  { z: -5.75, dir: -1, v: 5.4 },
  { z: -9.25, dir: -1, v: 4.6 },
]

const wrap = (x: number) => ((((x + WRAP / 2) % WRAP) + WRAP) % WRAP) - WRAP / 2

/** screen-space window (along the lane) where a vehicle is in frame, with soft edges */
function inFrame(x: number, z: number) {
  const u = (x - VIEW.center[0] - (z - VIEW.center[2])) * Math.SQRT1_2
  const lo = -0.2 * VIEW.span
  const hi = 0.35 * VIEW.span
  const a = Math.min(1, Math.max(0, (u - lo) / 4))
  const b = Math.min(1, Math.max(0, (hi - u) / 4))
  return Math.min(a, b)
}

// ------------------------------------------------------------------ connected fleet

type FleetSpec = {
  id: string
  lane: number
  /** x at the moment the scene starts dissolving in (scene-local t = 0) */
  x0: number
  /** clearance kept free of ghost traffic, metres either side */
  clear: number
  /** callout anchor height above the road */
  anchor: number
  render: ReactNode
}

// staggered so one or two connected vehicles are in frame from dissolve-in to dissolve-out
const FLEET: FleetSpec[] = [
  { id: "tr-utility", lane: 5, x0: 12, clear: 7, anchor: 3.2, render: <ServicePickup connected /> },
  { id: "tr-truck", lane: 1, x0: -17.7, clear: 9, anchor: ASSET_META.box_truck.size[1] + 0.8, render: <BoxTruck connected /> },
  { id: "tr-semi", lane: 4, x0: 49.4, clear: 13, anchor: ASSET_META.semi_tractor.size[1] + 1.0, render: <Semi connected /> },
  { id: "tr-van", lane: 2, x0: -47.8, clear: 7, anchor: ASSET_META.service_van.size[1] + 0.9, render: <Van connected /> },
  { id: "tr-truck-2", lane: 0, x0: -88.8, clear: 9, anchor: ASSET_META.box_truck.size[1] + 0.8, render: <BoxTruck connected /> },
]

/** per-visit variation so the fleet arrives differently each loop */
function fleetX(f: FleetSpec, local: number, loop: number) {
  const lane = LANES[f.lane]
  const jitter = (hash(loop * 13 + f.lane) - 0.5) * 12
  return wrap(f.x0 + jitter + lane.dir * lane.v * local)
}

function FleetVehicle({ spec }: { spec: FleetSpec }) {
  const ref = useRef<Group>(null)
  const lane = LANES[spec.lane]
  useSceneFrame(() => {
    const { local, loop } = sceneClock("transportation")
    const x = fleetX(spec, local, loop)
    const a = inFrame(x, lane.z)
    if (ref.current) {
      ref.current.position.x = x
      ref.current.visible = Math.abs(x) < 70
    }
    setAnchorAlpha(spec.id, a)
  })
  return (
    <group ref={ref} position={[0, 0, lane.z]} rotation-y={lane.dir === 1 ? 0 : Math.PI}>
      {spec.render}
      <Anchor id={spec.id} position={[0, spec.anchor, 0]} />
    </group>
  )
}

// ------------------------------------------------------------------ ghost traffic

type Ghost = { lane: number; slot: number; kind: CarKind; dx: number; dz: number }

const KINDS: CarKind[] = ["sedan", "suv", "hatch", "sedan", "suv"]

const GHOSTS: Ghost[] = (() => {
  const out: Ghost[] = []
  LANES.forEach((_, l) => {
    for (let s = 0; s < SLOTS; s++) {
      const h = hash(l * 97 + s * 13)
      if (h < 0.3) continue
      out.push({
        lane: l,
        slot: s,
        kind: KINDS[Math.floor(hash(s * 7 + l) * KINDS.length)],
        dx: (hash(s + l * 31) - 0.5) * 8,
        dz: (hash(out.length) - 0.5) * 0.3,
      })
    }
  })
  return out
})()

/** One instance pool per car model; every ghost car is re-placed each frame. */
function TrafficPool({ kind }: { kind: CarKind }) {
  const cars = useMemo(() => GHOSTS.filter((g) => g.kind === kind), [kind])
  const pool = useInstancePool(CAR_MODEL[kind], cars.length)
  const m = useMemo(() => new Matrix4(), [])
  useSceneFrame(() => {
    const { local, loop } = sceneClock("transportation")
    const fleet = FLEET.map((f) => ({ lane: f.lane, x: fleetX(f, local, loop), clear: f.clear }))
    cars.forEach((g, i) => {
      const lane = LANES[g.lane]
      const x = wrap(-WRAP / 2 + g.slot * SLOT + g.dx + lane.dir * lane.v * local)
      // keep gaps around the connected vehicles in the same lane
      const blocked = fleet.some((f) => f.lane === g.lane && Math.abs(wrap(f.x - x)) < f.clear + 3)
      pool.set(
        i,
        blocked || Math.abs(x) > 75
          ? null
          : placementMatrix({ position: [x, 0, lane.z + g.dz], rotation: lane.dir === 1 ? 0 : Math.PI }, m),
      )
    })
    pool.commit(false)
  })
  return <primitive object={pool.root} />
}

function Traffic() {
  return (
    <>
      <TrafficPool kind="sedan" />
      <TrafficPool kind="suv" />
      <TrafficPool kind="hatch" />
    </>
  )
}

// ------------------------------------------------------------------ roadway

function paintFreeway(g: CanvasRenderingContext2D, M: (m: number) => number) {
  // origin (-100, -30): 200 x 60 m
  const Z = (z: number) => M(z + 30)
  g.fillStyle = "#f6f7f5"
  g.fillRect(0, 0, M(200), M(60))
  // asphalt carriageways + shoulders
  g.fillStyle = "#e3e5e7"
  g.fillRect(0, Z(-13.5), M(200), M(27))
  g.fillStyle = "#eceeef"
  g.fillRect(0, Z(-0.9), M(200), M(1.8))
  // edge lines
  g.fillStyle = "rgba(255,255,255,1)"
  for (const z of [-11.1, -0.75, 0.6, 10.95]) g.fillRect(0, Z(z), M(200), M(0.15))
  // lane dashes (3 m dash, 9 m gap)
  for (const z of [-7.5, -4.0, 4.0, 7.5])
    for (let x = 0; x < 200; x += 12) g.fillRect(M(x), Z(z - 0.07), M(3), M(0.14))
  // tyre wear in each lane
  g.fillStyle = "rgba(0,0,0,0.025)"
  for (const l of LANES)
    for (const dz of [-0.8, 0.8]) g.fillRect(0, Z(l.z + dz - 0.3), M(200), M(0.6))
  // verge mowing stripes
  g.fillStyle = "rgba(0,0,0,0.018)"
  for (let z = -30; z < -13.5; z += 2.4) g.fillRect(0, Z(z), M(200), M(1.2))
  for (let z = 14; z < 30; z += 2.4) g.fillRect(0, Z(z), M(200), M(1.2))
}

/** Slip-formed concrete median barrier: the F-shape profile (0.81 m tall) extruded along x. */
function MedianBarrier({ length = 200 }: { length?: number }) {
  const geo = useMemo(() => {
    const s = new Shape()
    const half = [
      [0.305, 0],
      [0.305, 0.075],
      [0.18, 0.255],
      [0.075, 0.81],
    ]
    s.moveTo(-half[0][0], 0)
    for (const [z, y] of half) s.lineTo(z, y)
    for (const [z, y] of [...half].reverse()) s.lineTo(-z, y)
    const g = new ExtrudeGeometry(s, { depth: length, bevelEnabled: false })
    // profile drawn in (z, y); extrude runs along +z -> turn it to run along x
    return g.rotateY(Math.PI / 2).translate(-length / 2, 0, 0)
  }, [length])
  return <mesh geometry={geo} material={PAL.concrete} receiveShadow />
}

const RAILS: Placement[] = [-13.2, 13.2].flatMap((z) =>
  Array.from({ length: 52 }, (_, k) => ({
    position: [-94 + k * ASSET_META.guardrail.size[0], 0, z] as [number, number, number],
    // the W-beam faces the carriageway
    rotation: z > 0 ? Math.PI : 0,
  })),
)

const TREES: Placement[] = Array.from({ length: 16 }, (_, k) => ({
  position: [-70 + k * 9 + hash(k) * 4, 0, (k % 2 ? 1 : -1) * (19 + hash(k * 3) * 6)] as [number, number, number],
  rotation: hash(k * 7) * Math.PI * 2,
  scale: 0.75 + hash(k * 5) * 0.4,
}))

function Roadside() {
  return (
    <group>
      <MedianBarrier />
      <Instances model="guardrail" items={RAILS} />
      {/* median lighting */}
      {[-60, -30, 0, 30, 60].map((x) => (
        <Prop key={x} model="lamppostDouble" position={[x, 0, 0]} rotation={Math.PI / 2} />
      ))}
      {/* overhead sign gantries, one spanning each carriageway */}
      <Prop model="signGantry" position={[30, 0, 5.8]} rotation={Math.PI / 2} />
      <Prop model="signGantry" position={[30, 0, -5.8]} rotation={-Math.PI / 2} />
      {/* roadside cell site + its equipment cabinet */}
      <Prop model="smallCell" position={[-26, 0, -19]} />
      <Prop model="streetCabinet" position={[-24, 0, -17.6]} rotation={Math.PI} />
      <Instances model="tree" items={TREES} />
    </group>
  )
}

function Transportation() {
  return (
    <group>
      <BaseFloor />
      <PaintedGround center={[0, 0]} w={200} d={60} ppm={14} paint={paintFreeway} />
      <Connected>
        {FLEET.map((f) => (
          <FleetVehicle key={f.id} spec={f} />
        ))}
      </Connected>
      <Faded>
        <Traffic />
        <Roadside />
      </Faded>
    </group>
  )
}

// ------------------------------------------------------------------ telemetry

const clock = (t: number, base: number) => {
  const m = (base + Math.floor(t / 20)) % 60
  return `2:${String(m).padStart(2, "0")} PM`
}

const callouts: CalloutDef[] = [
  {
    id: "tr-truck",
    scene: "transportation",
    title: "Delivery Truck 214",
    bars: 4,
    delay: 0,
    status: (t) => `${(61 + Math.sin(t * 0.4) * 1.5).toFixed(0)} mph · ETA ${clock(t, 40)}`,
  },
  {
    id: "tr-truck-2",
    scene: "transportation",
    title: "Delivery Truck 117",
    bars: 3,
    delay: 1.8,
    status: (t) => (t % 8 < 4 ? `Stop 6 of 14 · ${(58 + Math.sin(t) * 2).toFixed(0)} mph` : "Driver HOS 4h 12m left"),
  },
  {
    id: "tr-semi",
    scene: "transportation",
    title: "Reefer Trailer 08",
    bars: 3,
    delay: 0.6,
    status: (t) => `Cargo ${(34.2 + Math.sin(t * 0.25) * 0.3).toFixed(1)}°F · doors sealed`,
  },
  {
    id: "tr-van",
    scene: "transportation",
    title: "Service Van 12",
    bars: 4,
    delay: 1.0,
    status: (t) => (t % 10 < 5 ? "En route · job #5521" : `Next stop 3.2 mi · ${clock(t, 12)}`),
  },
  {
    id: "tr-utility",
    scene: "transportation",
    title: "Field Service Truck 31",
    bars: 3,
    delay: 1.4,
    status: (t) => (t % 9 < 4.5 ? "Ladder stowed · 55 mph" : "Dispatched · outage #882"),
  },
]

export const transportation: SceneDef = {
  id: "transportation",
  view: VIEW,
  Component: Transportation,
  callouts,
}
