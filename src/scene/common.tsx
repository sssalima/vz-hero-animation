import { useFrame } from "@react-three/fiber"
import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react"
import {
  CanvasTexture,
  Color,
  LinearMipmapLinearFilter,
  MeshBasicMaterial,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  type Group,
  type Side,
} from "three"
import { isSceneLive, type SceneId } from "./carousel"
import { lineClock } from "./clock"
import { applyFade, applyTone } from "./fade"
import { useClone, type ModelKey } from "./models"

// ------------------------------------------------------------------ scene scope

export const SceneContext = createContext<SceneId>("manufacturing")

/** useFrame that only runs while its scene is on screen (or about to dissolve in). */
export function useSceneFrame(cb: (t: number, dt: number) => void, priority = 0) {
  const id = useContext(SceneContext)
  useFrame((_, dt) => {
    if (isSceneLive(id)) cb(lineClock.t, dt)
  }, priority)
}

// ------------------------------------------------------------------ ghosting

/** Lightens every mesh beneath it (see fade.ts); re-scans for meshes mounted later. */
export function Faded({ children }: { children: ReactNode }) {
  const ref = useRef<Group>(null)
  const frame = useRef(0)
  useLayoutEffect(() => {
    if (ref.current) applyFade(ref.current)
  })
  useFrame(() => {
    if (++frame.current % 30 === 0 && ref.current) applyFade(ref.current)
  })
  return <group ref={ref}>{children}</group>
}

/** SIM-equipped devices: full tone with a little extra weight (see fade.ts). */
export function Connected({ children }: { children: ReactNode }) {
  const ref = useRef<Group>(null)
  const frame = useRef(0)
  useLayoutEffect(() => {
    if (ref.current) applyTone(ref.current)
  })
  useFrame(() => {
    if (++frame.current % 30 === 0 && ref.current) applyTone(ref.current)
  })
  return <group ref={ref}>{children}</group>
}

// ------------------------------------------------------------------ props

export type V3 = [number, number, number]

type PropProps = {
  model: ModelKey
  position: V3
  rotation?: number
  scale?: number | V3
}

export function Prop({ model, position, rotation = 0, scale = 1 }: PropProps) {
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

// ------------------------------------------------------------------ materials

type MatOpts = {
  rough?: number
  metal?: number
  emissive?: string
  emissiveIntensity?: number
  opacity?: number
  side?: Side
}

const matCache = new Map<string, MeshStandardMaterial>()

/** Shared, cached standard material (the scene renders in greyscale, so tone is what counts). */
export function mat(color: string, o: MatOpts = {}) {
  const key = `${color}|${o.rough ?? 0.6}|${o.metal ?? 0}|${o.emissive ?? ""}|${o.emissiveIntensity ?? 1}|${o.opacity ?? 1}|${o.side ?? 0}`
  let m = matCache.get(key)
  if (!m) {
    m = new MeshStandardMaterial({
      color,
      roughness: o.rough ?? 0.6,
      metalness: o.metal ?? 0,
    })
    if (o.emissive) {
      m.emissive = new Color(o.emissive)
      m.emissiveIntensity = o.emissiveIntensity ?? 1
    }
    if (o.opacity !== undefined && o.opacity < 1) {
      m.transparent = true
      m.opacity = o.opacity
      m.depthWrite = false
    }
    if (o.side !== undefined) m.side = o.side
    matCache.set(key, m)
  }
  return m
}

/** Unlit, un-tonemapped colour for indicator lamps and screens. */
export function glow(color: string, intensity = 1) {
  const key = `glow|${color}|${intensity}`
  let m = matCache.get(key) as unknown as MeshBasicMaterial | undefined
  if (!m) {
    m = new MeshBasicMaterial({
      color: new Color(color).multiplyScalar(intensity),
      toneMapped: false,
    })
    matCache.set(key, m as unknown as MeshStandardMaterial)
  }
  return m
}

export const PAL = {
  white: mat("#e9ecee", { rough: 0.55 }),
  panel: mat("#d4d8dc", { rough: 0.55, metal: 0.05 }),
  light: mat("#b9bfc5", { rough: 0.5, metal: 0.1 }),
  mid: mat("#8f979f", { rough: 0.45, metal: 0.3 }),
  steel: mat("#7d858d", { rough: 0.4, metal: 0.55 }),
  dark: mat("#3a3f45", { rough: 0.55, metal: 0.2 }),
  black: mat("#16191c", { rough: 0.5, metal: 0.1 }),
  rubber: mat("#121416", { rough: 0.85 }),
  glass: mat("#2b3238", { rough: 0.08, metal: 0.4 }),
  glassLight: mat("#cfd6db", { rough: 0.05, metal: 0.1, opacity: 0.45 }),
  concrete: mat("#c9ccce", { rough: 0.9 }),
  asphalt: mat("#6b7075", { rough: 0.95 }),
  yellow: mat("#e2b218", { rough: 0.5, metal: 0.15 }),
  wood: mat("#8a6a48", { rough: 0.8 }),
}

// ------------------------------------------------------------------ primitives

type BoxProps = {
  args: V3
  position?: V3
  rotation?: V3
  material?: MeshStandardMaterial | MeshBasicMaterial
  shadow?: boolean
}

/** Shadow-casting box. */
export function Box({
  args,
  position,
  rotation,
  material = PAL.panel,
  shadow = true,
}: BoxProps) {
  return (
    <mesh
      position={position}
      rotation={rotation}
      material={material}
      castShadow={shadow}
      receiveShadow
    >
      <boxGeometry args={args} />
    </mesh>
  )
}

type CylProps = {
  r: number
  r2?: number
  h: number
  position?: V3
  rotation?: V3
  material?: MeshStandardMaterial | MeshBasicMaterial
  seg?: number
  shadow?: boolean
}

export function Cyl({
  r,
  r2,
  h,
  position,
  rotation,
  material = PAL.steel,
  seg = 24,
  shadow = true,
}: CylProps) {
  return (
    <mesh
      position={position}
      rotation={rotation}
      material={material}
      castShadow={shadow}
      receiveShadow
    >
      <cylinderGeometry args={[r2 ?? r, r, h, seg]} />
    </mesh>
  )
}

// ------------------------------------------------------------------ ground

/** Large white floor that blends into the page background. */
export function BaseFloor({ y = -0.003 }: { y?: number }) {
  return (
    <mesh rotation-x={-Math.PI / 2} position-y={y} receiveShadow>
      <planeGeometry args={[400, 400]} />
      <meshStandardMaterial color="#ffffff" roughness={0.9} envMapIntensity={0.25} />
    </mesh>
  )
}

type Painter = (g: CanvasRenderingContext2D, M: (m: number) => number) => void

/**
 * A painted ground decal (`w` x `d` metres centred on `center`), drawn once to a canvas.
 * Painter coordinates are metres from the decal's top-left (x0, z0) corner via `M()`.
 */
export function PaintedGround({
  center,
  w,
  d,
  ppm = 48,
  paint,
  y = 0,
  roughness = 0.9,
}: {
  center: [number, number]
  w: number
  d: number
  ppm?: number
  paint: Painter
  y?: number
  roughness?: number
}) {
  const tex = useMemo(() => {
    const W = Math.round(w * ppm)
    const H = Math.round(d * ppm)
    const canvas = document.createElement("canvas")
    canvas.width = W
    canvas.height = H
    const g = canvas.getContext("2d")!
    g.fillStyle = "#ffffff"
    g.fillRect(0, 0, W, H)
    paint(g, (m) => m * ppm)
    const t = new CanvasTexture(canvas)
    t.colorSpace = SRGBColorSpace
    t.anisotropy = 8
    t.minFilter = LinearMipmapLinearFilter
    t.wrapS = t.wrapT = RepeatWrapping
    return t
  }, [w, d, ppm, paint])
  return (
    <mesh
      rotation-x={-Math.PI / 2}
      position={[center[0], y, center[1]]}
      receiveShadow
    >
      <planeGeometry args={[w, d]} />
      <meshStandardMaterial
        map={tex}
        roughness={roughness}
        metalness={0}
        envMapIntensity={0.25}
      />
    </mesh>
  )
}

/** Deterministic pseudo-random in [0,1) for repeatable layouts and schedules. */
export function hash(n: number) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return s - Math.floor(s)
}
