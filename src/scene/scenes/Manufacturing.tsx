import { useMemo, useRef } from "react"
import {
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
} from "three"
import { Anchor, type CalloutDef } from "../callouts"
import { BaseFloor, Faded, Prop, useSceneFrame } from "../common"
import { createFloorTexture, FLOOR } from "../floor"
import { useClone, useClones, useModel, type ModelKey } from "../models"
import {
  AMR,
  amrX,
  BELT_Y,
  CYCLE,
  conveyorProgress,
  entryTime,
  gripTime,
  LID_H,
  LID_TOP,
  lidReleaseTime,
  magazineState,
  MAG_TOP,
  MAG_VISIBLE,
  MAG_X,
  mod,
  MOVE,
  N_CAP,
  N_QC,
  PAIL_H,
  PALLET_TOP,
  palletOf,
  palletProgress,
  palletX,
  PED_H,
  PITCH,
  placeTime,
  R1,
  R1_PATH,
  r2Cycle,
  r2Path,
  samplePath,
  slotOf,
  SLOTS,
  X_CAP,
  X_ENTRY,
  X_PICK,
  X_QC,
  Z_PALLET,
  Z_ROBOT,
} from "../timeline"
import { applyUR10, getUR10Rig, solveToolDown, type JointAngles } from "../ur10"
import type { SceneDef } from "."

/**
 * Manufacturing: a pail capping, vision QC and palletizing line. The UR10 cells, the QC
 * gate and the AMR carry SIMs; conveyors, product and set dressing are ghosted.
 */
const GREEN = new Color("#76b900")
const R1_BASE = { x: X_CAP, y: PED_H, z: Z_ROBOT }
const R2_BASE = { x: X_PICK, y: PED_H, z: Z_ROBOT }
const R2_PATHS = SLOTS.map((_, s) => r2Path(s))

type V3 = {
  x: number
  y: number
  z: number
}
const r1Target = (t: number, out: V3) =>
  samplePath(R1_PATH, mod(t, CYCLE), R1_BASE, out)
const r2Target = (t: number, out: V3) => {
  const { pail, phase } = r2Cycle(t)
  return samplePath(R2_PATHS[slotOf(pail)], phase, R2_BASE, out)
}

function FactoryFloor() {
  const tex = useMemo(() => createFloorTexture(), [])
  const w = FLOOR.x1 - FLOOR.x0
  const d = FLOOR.z1 - FLOOR.z0
  return (
    <group>
      <mesh
        rotation-x={-Math.PI / 2}
        position={[(FLOOR.x0 + FLOOR.x1) / 2, 0, (FLOOR.z0 + FLOOR.z1) / 2]}
        receiveShadow
      >
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial
          map={tex}
          roughness={0.9}
          metalness={0}
          envMapIntensity={0.25}
        />
      </mesh>
      <BaseFloor />
    </group>
  )
}

const MAIN_A05 = [-2.118, -4.118, -6.118, -8.118, -10.118, -12.118]
const PALLET_LINE = Array.from({ length: 7 }, (_, k) => -1.95 + k * 2)

function Conveyors() {
  return (
    <group>
      <Prop model="conveyorDrive" position={[X_PICK + 0.6, 0, 0]} />
      {MAIN_A05.map((x) => (
        <Prop key={x} model="conveyor" position={[x, 0, 0]} />
      ))}
      {PALLET_LINE.map((x) => (
        <Prop key={x} model="conveyor" position={[x, 0, Z_PALLET]} />
      ))}
      {/* end stop */}
      <mesh position={[X_PICK + 0.5, BELT_Y + 0.07, 0]} castShadow>
        <boxGeometry args={[0.06, 0.12, 0.92]} />
        <meshStandardMaterial
          color="#e2b218"
          roughness={0.45}
          metalness={0.2}
        />
      </mesh>
    </group>
  )
}

const steel = new MeshStandardMaterial({
  color: "#7d858d",
  roughness: 0.4,
  metalness: 0.55,
})
const aluminium = new MeshStandardMaterial({
  color: "#8f979f",
  roughness: 0.34,
  metalness: 0.45,
})
const panel = new MeshStandardMaterial({
  color: "#d4d8dc",
  roughness: 0.55,
  metalness: 0.05,
})
const hazard = new MeshStandardMaterial({ color: "#3a3f45", roughness: 0.6 })
const anodized = new MeshStandardMaterial({
  color: "#5a6168",
  roughness: 0.4,
  metalness: 0.45,
})
const steelLight = new MeshStandardMaterial({
  color: "#9aa1a8",
  roughness: 0.35,
  metalness: 0.55,
})
const safetyYellow = new MeshStandardMaterial({
  color: "#e2b218",
  roughness: 0.5,
  metalness: 0.15,
})
const greenLamp = new MeshBasicMaterial({
  color: GREEN.clone().multiplyScalar(3.2),
  toneMapped: false,
})
const amberLamp = new MeshStandardMaterial({ color: "#4a3406", roughness: 0.4 })
const redLamp = new MeshStandardMaterial({ color: "#3a0d0d", roughness: 0.4 })

type PedestalProps = {
  x: number
  z: number
}

function Pedestal({ x, z }: PedestalProps) {
  return (
    <group position={[x, 0, z]}>
      <mesh position-y={0.02} castShadow receiveShadow material={steelLight}>
        <boxGeometry args={[0.5, 0.04, 0.34]} />
      </mesh>
      <mesh position-y={PED_H / 2} castShadow receiveShadow material={steel}>
        <cylinderGeometry args={[0.12, 0.14, PED_H - 0.04, 28]} />
      </mesh>
      <mesh position-y={PED_H - 0.015} castShadow material={steelLight}>
        <cylinderGeometry args={[0.16, 0.16, 0.03, 32]} />
      </mesh>
      {/* andon stack light */}
      <group position={[0.2, PED_H - 0.36, 0.08]}>
        <mesh position-y={0.12} material={steel}>
          <cylinderGeometry args={[0.012, 0.012, 0.24, 8]} />
        </mesh>
        <mesh position-y={0.27} material={redLamp}>
          <cylinderGeometry args={[0.03, 0.03, 0.05, 16]} />
        </mesh>
        <mesh position-y={0.32} material={amberLamp}>
          <cylinderGeometry args={[0.03, 0.03, 0.05, 16]} />
        </mesh>
        <mesh position-y={0.37} material={greenLamp}>
          <cylinderGeometry args={[0.03, 0.03, 0.05, 16]} />
        </mesh>
      </group>
    </group>
  )
}

function Robot({
  base,
  target,
}: {
  base: V3
  target: (t: number, out: V3) => V3
}) {
  const scene = useClone("ur10")
  const rig = useMemo(() => getUR10Rig(scene), [scene])
  const state = useMemo(
    () => ({
      q: [0, 0, 0, 0, 0, 0] as JointAngles,
      p: { x: 0, y: 0, z: 0 },
      local: { x: 0, y: 0, z: 0 },
    }),
    [],
  )
  useSceneFrame((t) => {
    target(t, state.p)
    state.local.x = state.p.x - base.x
    state.local.y = state.p.y - base.y
    state.local.z = state.p.z - base.z
    if (solveToolDown(state.local, state.q)) applyUR10(rig, state.q)
  })
  return (
    <group>
      <Pedestal x={base.x} z={base.z} />
      <primitive object={scene} position={[base.x, base.y, base.z]} />
    </group>
  )
}

// ------------------------------------------------------------------ capping cell

const MAG_BODY_TOP = MAG_TOP - LID_H * MAG_VISIBLE

function LidMagazine() {
  const pail = useModel("pail")
  const lidSource = useMemo(() => pail.getObjectByName("lid")!, [pail])
  const lids = useMemo(
    () => Array.from({ length: MAG_VISIBLE + 2 }, () => lidSource.clone(true)),
    [lidSource],
  )
  const groups = useRef<(Group | null)[]>([])
  const tmp = useMemo(() => ({ x: 0, y: 0, z: 0 }), [])
  useSceneFrame((t) => {
    const { picked, rise } = magazineState(t)
    const n = lids.length
    const ref = picked + MAG_VISIBLE - 1
    for (let p = 0; p < n; p++) {
      const g = groups.current[p]
      if (!g) continue
      const ci = ref - mod(ref - p, n)
      const i = ci - N_CAP + 1
      const k = ci - picked
      if (k >= 0) {
        g.visible = k < MAG_VISIBLE
        g.position.set(
          MAG_X,
          MAG_TOP - LID_H * k - LID_H * (1 - rise) - LID_TOP,
          Z_ROBOT,
        )
      } else if (t < lidReleaseTime(i)) {
        r1Target(t, tmp)
        g.visible = true
        g.position.set(tmp.x, tmp.y - LID_TOP, tmp.z)
      } else {
        g.visible = false
      }
    }
  })
  return (
    <group>
      {/* magazine body with spring-fed stack */}
      <mesh
        position={[MAG_X, MAG_BODY_TOP / 2, Z_ROBOT]}
        castShadow
        receiveShadow
        material={steel}
      >
        <boxGeometry args={[0.42, MAG_BODY_TOP, 0.4]} />
      </mesh>
      <mesh
        position={[MAG_X, MAG_BODY_TOP - 0.012, Z_ROBOT]}
        material={safetyYellow}
      >
        <boxGeometry args={[0.43, 0.025, 0.41]} />
      </mesh>
      {[0, 1, 2, 3].map((k) => {
        const a = Math.PI / 4 + (k * Math.PI) / 2
        return (
          <mesh
            key={k}
            position={[
              MAG_X + Math.cos(a) * 0.19,
              MAG_BODY_TOP + 0.24,
              Z_ROBOT + Math.sin(a) * 0.19,
            ]}
            material={steelLight}
            castShadow
          >
            <cylinderGeometry args={[0.008, 0.008, 0.48, 8]} />
          </mesh>
        )
      })}
      <Faded>
        {lids.map((lid, p) => (
          <group key={p} ref={(g) => void (groups.current[p] = g)}>
            <primitive object={lid} />
          </group>
        ))}
      </Faded>
    </group>
  )
}

// ------------------------------------------------------------------ vision QC gate

function QCGate() {
  const sheet = useRef<Mesh>(null)
  const lamp = useRef<MeshBasicMaterial>(null)
  const bar = useRef<MeshBasicMaterial>(null)
  const sheetMat = useMemo(
    () =>
      new MeshBasicMaterial({
        color: "#20262c",
        transparent: true,
        opacity: 0.0,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  )
  const passColor = useMemo(() => GREEN.clone().multiplyScalar(4), [])
  const scanColor = useMemo(() => new Color("#ffb020").multiplyScalar(3), [])
  useSceneFrame((t) => {
    const tau = mod(t, CYCLE)
    const scanning = tau > MOVE + 0.15 && tau < CYCLE - 0.55
    const s = (tau - MOVE - 0.15) / (CYCLE - 0.7 - MOVE)
    if (sheet.current) {
      const y =
        BELT_Y +
        PAIL_H +
        0.08 -
        (PAIL_H + 0.04) * (0.5 - 0.5 * Math.cos(Math.PI * 2 * s))
      sheet.current.position.y = y
      sheetMat.opacity = scanning
        ? 0.22 * Math.sin(Math.PI * Math.min(1, Math.max(0, s))) + 0.04
        : 0
    }
    if (lamp.current) lamp.current.color.copy(scanning ? scanColor : passColor)
    if (bar.current)
      bar.current.color.copy(GREEN).multiplyScalar(scanning ? 3.4 : 1.6)
  })
  const H = 1.95
  const Wz = 0.7
  return (
    <group position={[X_QC, 0, 0]}>
      {[-1, 1].map((s) => (
        <group key={s} position={[0, 0, s * Wz]}>
          <mesh
            position-y={H / 2}
            castShadow
            receiveShadow
            material={aluminium}
          >
            <boxGeometry args={[0.08, H, 0.08]} />
          </mesh>
          <mesh position-y={0.015} material={anodized}>
            <boxGeometry args={[0.24, 0.03, 0.24]} />
          </mesh>
        </group>
      ))}
      <mesh position-y={H - 0.05} castShadow material={aluminium}>
        <boxGeometry args={[0.16, 0.1, Wz * 2 + 0.08]} />
      </mesh>
      {/* light bar facing down */}
      <mesh position={[0, H - 0.105, 0]}>
        <boxGeometry args={[0.05, 0.012, Wz * 2 - 0.2]} />
        <meshBasicMaterial ref={bar} color={GREEN} toneMapped={false} />
      </mesh>
      {/* camera housing */}
      <mesh position={[0, H + 0.07, 0]} castShadow material={anodized}>
        <boxGeometry args={[0.2, 0.14, 0.18]} />
      </mesh>
      <mesh
        position={[0.105, H + 0.07, 0]}
        rotation-z={Math.PI / 2}
        material={aluminium}
      >
        <cylinderGeometry args={[0.04, 0.04, 0.02, 20]} />
      </mesh>
      <mesh position={[-0.04, H + 0.155, 0.05]}>
        <boxGeometry args={[0.04, 0.03, 0.04]} />
        <meshBasicMaterial ref={lamp} color={GREEN} toneMapped={false} />
      </mesh>
      {/* scan sheet */}
      <mesh ref={sheet} rotation-x={-Math.PI / 2} material={sheetMat}>
        <planeGeometry args={[0.5, 0.95]} />
      </mesh>
    </group>
  )
}

// ------------------------------------------------------------------ pallet dispenser

const DISP_X0 = -1.95
const DISP_X1 = X_PICK - 1.25
const DISP_H = 1.12
const DISP_WZ = 0.66

/** Enclosed pallet magazine: empty pallets queue inside and index out toward the palletizer. */
function PalletDispenser() {
  const len = DISP_X1 - DISP_X0
  const cx = (DISP_X0 + DISP_X1) / 2
  const led = useRef<MeshBasicMaterial>(null)
  useSceneFrame((t) => {
    const pp = palletProgress(t)
    const moving = pp - Math.floor(pp) > 0 && pp - Math.floor(pp) < 0.999
    if (led.current)
      led.current.color.copy(GREEN).multiplyScalar(moving ? 3.6 : 1.8)
  })
  const posts: [number, number][] = [
    [DISP_X0, DISP_WZ],
    [DISP_X1, DISP_WZ],
    [DISP_X0, -DISP_WZ],
    [DISP_X1, -DISP_WZ],
    [cx, DISP_WZ],
    [cx, -DISP_WZ],
  ]
  return (
    <group position={[0, 0, Z_PALLET]}>
      {/* side panels + roof + rear */}
      {[-1, 1].map((sd) => (
        <mesh
          key={sd}
          position={[cx, DISP_H / 2 + 0.06, sd * DISP_WZ]}
          castShadow
          receiveShadow
          material={panel}
        >
          <boxGeometry args={[len, DISP_H - 0.12, 0.03]} />
        </mesh>
      ))}
      <mesh
        position={[cx, DISP_H, 0]}
        castShadow
        receiveShadow
        material={panel}
      >
        <boxGeometry args={[len + 0.06, 0.05, DISP_WZ * 2 + 0.06]} />
      </mesh>
      <mesh position={[DISP_X0, DISP_H / 2, 0]} castShadow material={panel}>
        <boxGeometry args={[0.03, DISP_H, DISP_WZ * 2]} />
      </mesh>
      {/* frame */}
      {posts.map(([x, z], k) => (
        <mesh
          key={k}
          position={[x, DISP_H / 2, z]}
          castShadow
          material={anodized}
        >
          <boxGeometry args={[0.07, DISP_H, 0.07]} />
        </mesh>
      ))}
      <mesh position={[cx, 0.09, DISP_WZ]} material={anodized}>
        <boxGeometry args={[len, 0.06, 0.06]} />
      </mesh>
      {/* status strip + HMI on the aisle side */}
      <mesh position={[cx, DISP_H - 0.09, DISP_WZ + 0.02]}>
        <boxGeometry args={[len - 0.2, 0.025, 0.01]} />
        <meshBasicMaterial ref={led} color={GREEN} toneMapped={false} />
      </mesh>
      <group position={[DISP_X0 + 0.5, 0.74, DISP_WZ + 0.03]}>
        <mesh material={anodized}>
          <boxGeometry args={[0.34, 0.24, 0.03]} />
        </mesh>
        <mesh position-z={0.016}>
          <planeGeometry args={[0.29, 0.18]} />
          <meshBasicMaterial color="#0f2a12" toneMapped={false} />
        </mesh>
        <mesh position={[-0.06, 0.03, 0.017]}>
          <planeGeometry args={[0.13, 0.025]} />
          <meshBasicMaterial
            color={GREEN.clone().multiplyScalar(1.6)}
            toneMapped={false}
          />
        </mesh>
        <mesh position={[0.02, -0.025, 0.017]}>
          <planeGeometry args={[0.2, 0.012]} />
          <meshBasicMaterial color="#5f8f3a" toneMapped={false} />
        </mesh>
      </group>
      {/* exit portal hazard frame */}
      <mesh
        position={[DISP_X1 + 0.04, DISP_H - 0.1, 0]}
        material={safetyYellow}
      >
        <boxGeometry args={[0.02, 0.08, DISP_WZ * 2]} />
      </mesh>
      {[-1, 1].map((sd) => (
        <mesh
          key={sd}
          position={[DISP_X1 + 0.04, (DISP_H - 0.1) / 2, sd * (DISP_WZ - 0.05)]}
          material={hazard}
        >
          <boxGeometry args={[0.02, DISP_H - 0.1, 0.06]} />
        </mesh>
      ))}
    </group>
  )
}

// ------------------------------------------------------------------ product flow

const PAIL_POOL = 48
const PALLET_POOL = 10
// pallets further upstream wait out of sight inside the dispenser
const PALLET_OFFSET_MIN = -2
const PALLET_OFFSET_MAX = 5

function Pails() {
  const clones = useClones("pail", PAIL_POOL)
  const lids = useMemo(
    () => clones.map((c) => c.getObjectByName("lid")!),
    [clones],
  )
  const groups = useRef<(Group | null)[]>([])
  const tmp = useMemo(() => ({ x: 0, y: 0, z: 0 }), [])
  useSceneFrame((t) => {
    const c = Math.floor(t / CYCLE)
    const pp = palletProgress(t)
    for (let p = 0; p < PAIL_POOL; p++) {
      const g = groups.current[p]
      if (!g) continue
      const i = c - mod(c - p, PAIL_POOL)
      if (t < entryTime(i)) {
        g.visible = false
        continue
      }
      g.visible = true
      if (t < gripTime(i)) {
        g.position.set(X_ENTRY + PITCH * conveyorProgress(i, t), BELT_Y, 0)
      } else if (t < placeTime(i)) {
        r2Target(t, tmp)
        g.position.set(tmp.x, tmp.y - PAIL_H, tmp.z)
      } else {
        const j = palletOf(i)
        if (pp - j > PALLET_OFFSET_MAX) {
          g.visible = false
          continue
        }
        const [dx, dz] = SLOTS[slotOf(i)]
        g.position.set(palletX(j, t) + dx, PALLET_TOP, Z_PALLET + dz)
      }
      lids[p].visible = t >= lidReleaseTime(i)
    }
  })
  return (
    <group>
      {clones.map((obj, p) => (
        <group key={p} ref={(g) => void (groups.current[p] = g)}>
          <primitive object={obj} />
        </group>
      ))}
    </group>
  )
}

function Pallets() {
  const clones = useClones("pallet", PALLET_POOL)
  const groups = useRef<(Group | null)[]>([])
  useSceneFrame((t) => {
    const pp = palletProgress(t)
    const ref = Math.floor(pp) - PALLET_OFFSET_MIN
    for (let p = 0; p < PALLET_POOL; p++) {
      const g = groups.current[p]
      if (!g) continue
      const j = ref - mod(ref - p, PALLET_POOL)
      const off = pp - j
      g.visible = off >= PALLET_OFFSET_MIN && off <= PALLET_OFFSET_MAX
      g.position.set(palletX(j, t), BELT_Y, Z_PALLET)
    }
  })
  return (
    <group>
      {clones.map((obj, p) => (
        <group
          key={p}
          ref={(g) => void (groups.current[p] = g)}
          rotation-y={Math.PI / 2}
        >
          <primitive object={obj} />
        </group>
      ))}
    </group>
  )
}

type AMRUnitProps = {
  offset: number
  payload: ModelKey
}

function AMRUnit({ offset, payload }: AMRUnitProps) {
  const ref = useRef<Group>(null)
  useSceneFrame((t) => {
    if (ref.current) ref.current.position.x = amrX(t, offset)
  })
  return (
    <group ref={ref} position={[0, 0, AMR.z]}>
      <Prop model="amr" position={[0, 0.081, 0]} />
      <Prop model={payload} position={[-0.32, 0.232, 0]} />
    </group>
  )
}

// ------------------------------------------------------------------ set dressing

function SetDressing() {
  const fences: [number, number, number][] = []
  for (const [x0, n] of [
    [-3.5, 3],
    [0.5, 3],
  ] as const)
    for (let k = 0; k < n; k++) fences.push([x0 + 1 + k * 1.002, 0, 1.08])
  for (const [x0, n] of [
    [-3.5, 3],
    [0.5, 3],
  ] as const)
    for (let k = 0; k < n; k++) fences.push([x0 + 1 + k * 1.002, 0, -2.58])
  return (
    <group>
      {/* raw material staging */}
      <Prop model="ibc" position={[-11.2, 0, -4.0]} />
      <Prop model="ibc" position={[-10.0, 0, -4.0]} />
      <Prop model="bulkBin" position={[-8.5, 0, -4.05]} />
      <Prop model="bulkBin" position={[-7.1, 0, -4.05]} />
      <Prop model="bulkBox" position={[-5.7, 0, -3.95]} />
      <Prop model="bulkBox" position={[-5.7, 0.886, -3.95]} rotation={0.04} />
      <Prop model="bulkBox" position={[-4.35, 0, -3.95]} />
      {/* drums */}
      <Prop model="exportPallet" position={[-1.45, 0, -3.95]} />
      <Prop model="plasticDrum" position={[-1.77, 0.144, -3.95]} />
      <Prop
        model="plasticDrum"
        position={[-1.12, 0.144, -3.95]}
        rotation={1.1}
      />
      <Prop model="fiberDrum" position={[-0.2, 0, -3.85]} />
      {/* finished goods */}
      <Prop
        model="palletLoadA"
        position={[3.6, 0, -3.9]}
        rotation={Math.PI / 2}
      />
      <Prop
        model="palletLoadA"
        position={[5.05, 0, -3.9]}
        rotation={Math.PI / 2}
      />
      <Prop model="palletLoadB" position={[6.5, 0, -3.9]} />
      <Prop
        model="palletLoadA"
        position={[7.95, 0, -3.9]}
        rotation={Math.PI / 2}
      />
      {/* packaging supplies by the line end */}
      <Prop
        model="exportPallet"
        position={[4.6, 0, 0.1]}
        rotation={Math.PI / 2}
      />
      <Prop model="box" position={[4.6, 0.144, -0.17]} />
      <Prop model="box" position={[4.6, 0.144, 0.37]} rotation={0.05} />
      <Prop model="box" position={[4.6, 0.666, 0.1]} rotation={-0.08} />
      <Prop model="crate" position={[5.95, 0, -0.15]} rotation={0.2} />
      <Prop model="tote" position={[5.9, 0.807, -0.15]} rotation={0.25} />
      {/* operator access + safety */}
      <Prop model="platform" position={[X_QC, 0, 1.12]} />
      <Prop model="ladder" position={[-4.5, 0, 0.95]} rotation={-Math.PI / 2} />
      {fences.map((p, k) => (
        <Prop key={k} model="fence" position={p} rotation={Math.PI / 2} />
      ))}
      <Prop model="cone" position={[-5.6, 0, 1.45]} />
      <Prop model="cone" position={[6.9, 0, 1.4]} />
      <Prop model="cone" position={[7.35, 0, 1.55]} />
    </group>
  )
}

// ------------------------------------------------------------------ callouts

function capStatus(t: number) {
  const tau = mod(t, CYCLE)
  if (tau < R1.pickLid) return "UR10 · picking lid"
  if (tau < 2.05) return "UR10 · transferring"
  if (tau < 2.75) return "UR10 · seating lid"
  return "UR10 · returning"
}
function qcStatus(t: number) {
  const c = Math.floor(t / CYCLE)
  const tau = t - c * CYCLE
  const i = c - N_QC + 1
  const dev = 0.18 + ((i * 7919) % 23) / 100
  if (tau > MOVE + 0.15 && tau < CYCLE - 0.55) return "Scanning seal…"
  return `Pass · Δ ${dev.toFixed(2)} mm`
}
function palletStatus(t: number) {
  const { pail, phase } = r2Cycle(t)
  const placed = phase >= 2.28 ? slotOf(pail) + 1 : slotOf(pail)
  const layer = `Pallet ${placed}/6`
  return phase < 0.95
    ? `${layer} · picking`
    : phase < 2.35
      ? `${layer} · placing`
      : `${layer} · returning`
}
function amrStatus() {
  return "Idealworks iw.hub · AMR"
}

function MovingAnchor() {
  const ref = useRef<Group>(null)
  useSceneFrame((t) => {
    if (ref.current) ref.current.position.x = amrX(t, 0) - 0.3
  })
  return (
    <group ref={ref} position={[0, 0, AMR.z]}>
      <Anchor id="mfg-amr" position={[0, 0.72, 0]} />
    </group>
  )
}

function Manufacturing() {
  return (
    <group>
      <FactoryFloor />
      {/* SIM-equipped machines keep full tone */}
      <Robot base={R1_BASE} target={r1Target} />
      <Robot base={R2_BASE} target={r2Target} />
      <LidMagazine />
      <QCGate />
      <AMRUnit offset={0} payload="tote" />
      {/* everything else is ghosted toward white */}
      <Faded>
        <Conveyors />
        <Pails />
        <Pallets />
        <PalletDispenser />
        <SetDressing />
      </Faded>
      <Anchor id="mfg-capping" position={[X_CAP - 0.25, 2.1, Z_ROBOT]} />
      <Anchor id="mfg-qc" position={[X_QC, 2.3, 0]} />
      <Anchor id="mfg-pallet" position={[X_PICK + 0.1, 2.15, Z_ROBOT]} />
      <MovingAnchor />
    </group>
  )
}

const callouts: CalloutDef[] = [
  { id: "mfg-capping", scene: "manufacturing", title: "Capping", bars: 4, delay: 0, status: capStatus },
  { id: "mfg-qc", scene: "manufacturing", title: "Vision QC", bars: 4, delay: 0.55, status: qcStatus },
  { id: "mfg-pallet", scene: "manufacturing", title: "Palletizing", bars: 3, delay: 0.3, status: palletStatus },
  { id: "mfg-amr", scene: "manufacturing", title: "Intralogistics", bars: 3, delay: 1.1, status: amrStatus },
]

export const manufacturing: SceneDef = {
  id: "manufacturing",
  view: { center: [0.2, 0.9, -0.9], span: 10.8 },
  Component: Manufacturing,
  callouts,
}
