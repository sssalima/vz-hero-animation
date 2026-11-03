import {
  Environment,
  Html,
  Lightformer,
  OrthographicCamera,
  PerformanceMonitor,
} from "@react-three/drei"
import { Canvas, useFrame, useThree } from "@react-three/fiber"
import {
  Bloom,
  EffectComposer,
  N8AO,
  ToneMapping,
} from "@react-three/postprocessing"
import { ToneMappingMode } from "postprocessing"
import {
  createContext,
  Suspense,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react"
import {
  AdditiveBlending,
  Color,
  DirectionalLight,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  OrthographicCamera as OrthoCam,
  Vector3,
} from "three"
import { getControls, lineClock, useControls } from "./clock"
import { createFloorTexture, FLOOR, FLOOR_COLOR } from "./floor"
import {
  preloadModels,
  useClone,
  useClones,
  useModel,
  type ModelKey,
} from "./models"
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
} from "./timeline"
import { applyUR10, getUR10Rig, solveToolDown, type JointAngles } from "./ur10"

preloadModels()

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

// ------------------------------------------------------------------ clock + camera

function ClockDriver() {
  useFrame((_, dt) => {
    if (!getControls().paused)
      lineClock.t += Math.min(dt, 0.1) * lineClock.speed
  }, -10)
  return null
}

const ISO_AZIMUTH = Math.PI / 4
const ISO_ELEVATION = Math.atan(1 / Math.SQRT2) // true isometric (35.26 deg)
const SCENE_CENTER = new Vector3(0.2, 0.9, -0.9)

function IsoCamera() {
  const cam = useRef<OrthoCam>(null)
  const size = useThree((s) => s.size)
  const pointer = useRef({ x: 0, y: 0, sx: 0, sy: 0 })
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      pointer.current.x = (e.clientX / window.innerWidth) * 2 - 1
      pointer.current.y = (e.clientY / window.innerHeight) * 2 - 1
    }
    window.addEventListener("pointermove", onMove)
    return () => window.removeEventListener("pointermove", onMove)
  }, [])
  const tmp = useMemo(
    () => ({ right: new Vector3(), up: new Vector3(), target: new Vector3() }),
    [],
  )
  useFrame((_, dt) => {
    const c = cam.current
    if (!c) return
    const p = pointer.current
    const k = 1 - Math.exp(-dt * 2.5)
    p.sx += (p.x - p.sx) * k
    p.sy += (p.y - p.sy) * k
    const az = ISO_AZIMUTH + p.sx * 0.035
    const el = ISO_ELEVATION - p.sy * 0.02
    const wide = size.width / size.height > 1.15
    // world units visible across the viewport
    const span = wide ? Math.max(10.8, 15.5 * (size.height / size.width)) : 6.8
    const zoom = Math.max(size.width, 320) / span
    c.zoom = zoom
    const dir = new Vector3(
      Math.cos(el) * Math.sin(az),
      Math.sin(el),
      Math.cos(el) * Math.cos(az),
    )
    tmp.right.set(Math.cos(az), 0, -Math.sin(az))
    tmp.up.crossVectors(dir, tmp.right).normalize().negate()
    // push the line to the right of the headline on wide screens, below it on tall ones
    const ox = wide ? -(size.width * 0.14) / zoom : 0
    // tmp.up points down-screen, so negative offsets lower the scene
    const oy = wide
      ? (size.height * -0.025) / zoom
      : (size.height * -0.16) / zoom
    tmp.target
      .copy(SCENE_CENTER)
      .addScaledVector(tmp.right, ox)
      .addScaledVector(tmp.up, oy)
    c.position.copy(tmp.target).addScaledVector(dir, 40)
    c.up.set(0, 1, 0)
    c.lookAt(tmp.target)
    c.updateProjectionMatrix()
  })
  return <OrthographicCamera ref={cam} makeDefault near={0.1} far={120} />
}

// ------------------------------------------------------------------ environment

function Lights() {
  const key = useRef<DirectionalLight>(null)
  const target = useMemo(() => new Object3D(), [])
  useEffect(() => {
    if (key.current) key.current.target = target
  }, [target])
  return (
    <>
      <hemisphereLight args={["#d9e4ff", "#1b1e22", 0.55]} />
      <directionalLight
        ref={key}
        position={[-6.5, 13, 5.5]}
        intensity={2.6}
        color="#fff4e6"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0003}
        shadow-normalBias={0.025}
        shadow-camera-left={-13}
        shadow-camera-right={13}
        shadow-camera-top={11}
        shadow-camera-bottom={-11}
        shadow-camera-near={1}
        shadow-camera-far={40}
      />
      <primitive object={target} position={[0.5, 0, -1]} />
      <directionalLight
        position={[9, 6, 10]}
        intensity={0.55}
        color="#bcd3ff"
      />
      <Environment resolution={256} frames={1}>
        <Lightformer
          form="rect"
          intensity={2.4}
          position={[0, 9, 0]}
          rotation-x={Math.PI / 2}
          scale={[26, 6, 1]}
        />
        <Lightformer
          form="rect"
          intensity={1.4}
          position={[-10, 5, 4]}
          rotation-y={Math.PI / 2.4}
          scale={[12, 3, 1]}
        />
        <Lightformer
          form="rect"
          intensity={0.9}
          position={[10, 4, 8]}
          rotation-y={-Math.PI / 1.6}
          scale={[10, 2.5, 1]}
        />
        <Lightformer
          form="ring"
          color="#9be22d"
          intensity={0.8}
          position={[0, 3, -10]}
          scale={4}
        />
      </Environment>
    </>
  )
}

function Floor() {
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
          roughness={0.78}
          metalness={0}
          envMapIntensity={0.35}
        />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={-0.003} receiveShadow>
        <planeGeometry args={[220, 220]} />
        <meshStandardMaterial
          color={FLOOR_COLOR}
          roughness={0.85}
          envMapIntensity={0.3}
        />
      </mesh>
    </group>
  )
}

// ------------------------------------------------------------------ static assets

type PropProps = {
  model: ModelKey
  position: [number, number, number]
  rotation?: number
  scale?: number
}
function Prop({ model, position, rotation = 0, scale = 1 }: PropProps) {
  const obj = useClone(model)
  return (
    <primitive
      object={obj}
      position={position}
      rotation-y={rotation}
      scale={scale}
    />
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
  color: "#2b3036",
  roughness: 0.42,
  metalness: 0.75,
})
const aluminium = new MeshStandardMaterial({
  color: "#c4cad0",
  roughness: 0.34,
  metalness: 0.45,
})
const panel = new MeshStandardMaterial({
  color: "#3a4249",
  roughness: 0.5,
  metalness: 0.35,
})
const hazard = new MeshStandardMaterial({ color: "#1a1a1a", roughness: 0.6 })
const anodized = new MeshStandardMaterial({
  color: "#1d2126",
  roughness: 0.38,
  metalness: 0.6,
})
const steelLight = new MeshStandardMaterial({
  color: "#4a525b",
  roughness: 0.35,
  metalness: 0.8,
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
  useFrame(() => {
    target(lineClock.t, state.p)
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
  useFrame(() => {
    const t = lineClock.t
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
      {lids.map((lid, p) => (
        <group key={p} ref={(g) => void (groups.current[p] = g)}>
          <primitive object={lid} />
        </group>
      ))}
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
        color: GREEN.clone().multiplyScalar(2.2),
        transparent: true,
        opacity: 0.0,
        blending: AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  )
  const passColor = useMemo(() => GREEN.clone().multiplyScalar(4), [])
  const scanColor = useMemo(() => new Color("#ffb020").multiplyScalar(3), [])
  useFrame(() => {
    const t = lineClock.t
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
        ? 0.5 * Math.sin(Math.PI * Math.min(1, Math.max(0, s))) + 0.08
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
  useFrame(() => {
    const pp = palletProgress(lineClock.t)
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
  useFrame(() => {
    const t = lineClock.t
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
  useFrame(() => {
    const t = lineClock.t
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
  useFrame(() => {
    if (ref.current) ref.current.position.x = amrX(lineClock.t, offset)
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
      <Prop model="steelDrum" position={[-1.77, 0.144, -3.95]} />
      <Prop model="steelDrum" position={[-1.12, 0.144, -3.95]} rotation={1.1} />
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

// ------------------------------------------------------------------ station callouts

const LabelLayer = createContext<RefObject<HTMLDivElement | null> | null>(null)

function Callout({
  position,
  index,
  title,
  children,
}: {
  position: [number, number, number]
  index: string
  title: string
  children?: ReactNode
}) {
  const { labels } = useControls()
  const layer = useContext(LabelLayer)
  return (
    <Html
      position={position}
      zIndexRange={[20, 0]}
      portal={layer as RefObject<HTMLElement> | undefined}
      style={{ pointerEvents: "none" }}
    >
      <div
        className="callout"
        data-visible={labels}
        style={{ transform: "translate(-50%, -100%)" }}
      >
        <div className="callout-chip">
          <span className="callout-index">{index}</span>
          <span className="callout-text">
            <span className="callout-title">{title}</span>
            <span className="callout-status">{children}</span>
          </span>
        </div>
        <div className="callout-stem" />
      </div>
    </Html>
  )
}

/** Html children render in their own React root, so poll the clock with rAF instead of useFrame. */
function LiveText({ read }: { read: (t: number) => string }) {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    let raf = 0
    let last = ""
    const tick = () => {
      const s = read(lineClock.t)
      if (s !== last && ref.current) {
        ref.current.textContent = s
        last = s
      }
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [read])
  return <span ref={ref} />
}

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

function MovingCallout() {
  const ref = useRef<Group>(null)
  useFrame(() => {
    if (ref.current) ref.current.position.x = amrX(lineClock.t, 0) - 0.3
  })
  return (
    <group ref={ref} position={[0, 0, AMR.z]}>
      <Callout position={[0, 0.72, 0]} index="04" title="Intralogistics">
        <LiveText read={amrStatus} />
      </Callout>
    </group>
  )
}

function Callouts() {
  return (
    <>
      <Callout
        position={[X_CAP - 0.25, 2.1, Z_ROBOT]}
        index="01"
        title="Capping"
      >
        <LiveText read={capStatus} />
      </Callout>
      <Callout position={[X_QC, 2.3, 0]} index="02" title="Vision QC">
        <LiveText read={qcStatus} />
      </Callout>
      <Callout
        position={[X_PICK + 0.1, 2.15, Z_ROBOT]}
        index="03"
        title="Palletizing"
      >
        <LiveText read={palletStatus} />
      </Callout>
      <MovingCallout />
    </>
  )
}

// ------------------------------------------------------------------ root

function Effects() {
  return (
    <EffectComposer multisampling={4} enableNormalPass={false}>
      <N8AO
        aoRadius={0.85}
        distanceFalloff={0.6}
        intensity={2.4}
        quality="medium"
      />
      <Bloom
        mipmapBlur
        luminanceThreshold={1}
        luminanceSmoothing={0.2}
        intensity={0.85}
        radius={0.6}
      />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
    </EffectComposer>
  )
}

export default function FactoryScene({
  onReady,
  labelLayer,
}: {
  onReady?: () => void
  labelLayer?: RefObject<HTMLDivElement | null>
}) {
  const [dpr, setDpr] = useState(() =>
    Math.min(window.devicePixelRatio || 1, 1.75),
  )
  return (
    <LabelLayer.Provider value={labelLayer ?? null}>
      <Canvas
        shadows
        dpr={dpr}
        gl={{
          antialias: false,
          powerPreference: "high-performance",
          stencil: false,
        }}
        onCreated={({ gl }) => gl.setClearColor("#0c0e10", 0)}
      >
        {/* drop resolution on slower GPUs instead of dropping frames */}
        <PerformanceMonitor onDecline={() => setDpr(1)} />
        <ClockDriver />
        <IsoCamera />
        <Lights />
        <Floor />
        <Suspense fallback={null}>
          <Conveyors />
          <Robot base={R1_BASE} target={r1Target} />
          <Robot base={R2_BASE} target={r2Target} />
          <LidMagazine />
          <QCGate />
          <Pails />
          <Pallets />
          <PalletDispenser />
          <AMRUnit offset={0} payload="tote" />
          <SetDressing />
          <Ready onReady={onReady} />
        </Suspense>
        {/* callouts don't load assets; keep them out of the suspense boundary so their DOM roots stay mounted */}
        <Callouts />
        <Effects />
      </Canvas>
    </LabelLayer.Provider>
  )
}

function Ready({ onReady }: { onReady?: () => void }) {
  useEffect(() => {
    onReady?.()
  }, [onReady])
  return null
}
