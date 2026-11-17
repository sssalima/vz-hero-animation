import { Environment, Lightformer, PerformanceMonitor } from "@react-three/drei"
import { Canvas, useFrame, useThree } from "@react-three/fiber"
import {
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react"
import { Object3D } from "three"
import { CalloutLayer } from "./callouts"
import {
  advanceCarousel,
  carousel,
  carouselState,
  markSceneReady,
  SCENE_IDS,
  useMountedUpTo,
} from "./carousel"
import { getControls, lineClock } from "./clock"
import { SceneContext } from "./common"
import { Compositor, rig } from "./compositor"
import { ALL_CALLOUTS, SCENES, type SceneDef } from "./scenes"

// ------------------------------------------------------------------ clock

function ClockDriver() {
  useFrame((_, dt) => {
    if (getControls().paused) return
    const step = Math.min(dt, 0.1)
    lineClock.t += step * lineClock.speed
    advanceCarousel(step)
  }, -10)
  return null
}

// ------------------------------------------------------------------ dev stats

const statsOn = typeof location !== "undefined" && new URLSearchParams(location.search).has("stats")

/** dev aid: `?stats` logs draw calls + triangles per frame (all passes) for the scene on screen */
function StatsLogger() {
  const gl = useThree((s) => s.gl)
  useEffect(() => {
    gl.info.autoReset = false
    return () => {
      gl.info.autoReset = true
    }
  }, [gl])
  const last = useRef(0)
  useFrame(({ clock }) => {
    const { a, k } = carouselState()
    if (k === 0 && clock.elapsedTime - last.current > 3) {
      last.current = clock.elapsedTime
      console.log(`[stats] ${SCENE_IDS[a]} calls=${gl.info.render.calls} tris=${gl.info.render.triangles} geometries=${gl.info.memory.geometries}`)
    }
    gl.info.reset()
  }, -20)
  return null
}

// ------------------------------------------------------------------ environment

function Lights() {
  const target = useMemo(() => new Object3D(), [])
  return (
    <>
      <hemisphereLight args={["#ffffff", "#cfd3d8", 0.8]} />
      <directionalLight
        ref={(l) => {
          rig.key = l
          rig.keyTarget = target
          if (l) l.target = target
        }}
        intensity={2.3}
        color="#ffffff"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0003}
      />
      <primitive object={target} />
      <directionalLight position={[9, 6, 10]} intensity={0.5} color="#ffffff" />
      <Environment resolution={256} frames={1}>
        {/* light studio backdrop so metals reflect a bright room rather than a black void */}
        <color attach="background" args={["#b4bac1"]} />
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
          intensity={0.8}
          position={[0, 3, -10]}
          scale={4}
        />
      </Environment>
    </>
  )
}

// ------------------------------------------------------------------ scenes

const initial = carouselState()
const firstScene = carousel.pinned ?? SCENE_IDS[initial.a]
/** scenes on screen at start-up mount straight away; the rest follow in order */
const eager = new Set([initial.a, initial.k > 0 || carousel.t > 0 ? initial.b : initial.a])

/** Reports a scene as loaded once its assets resolve, after warming its shaders. */
function Ready({ def, index, onFirst }: { def: SceneDef; index: number; onFirst?: () => void }) {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  useEffect(() => {
    let done = false
    const group = rig.groups[index]
    const finish = () => {
      if (done) return
      done = true
      markSceneReady(def.id)
      if (def.id === firstScene) onFirst?.()
    }
    if (group) {
      // compile this scene's programs up front so its first dissolve doesn't hitch
      const was = group.visible
      group.visible = true
      const p = gl.compileAsync(group, camera, scene)
      group.visible = was
      p.then(finish, finish)
    } else finish()
    return () => {
      done = true
    }
  }, [gl, scene, camera, def, index, onFirst])
  return null
}

function SceneSlot({ def, index, onFirst }: { def: SceneDef; index: number; onFirst?: () => void }) {
  const upTo = useMountedUpTo()
  const mount = carousel.pinned ? def.id === carousel.pinned : index <= upTo || eager.has(index)
  const { Component } = def
  return (
    <group
      ref={(g) => {
        rig.groups[index] = g
        if (g) g.visible = false
      }}
    >
      {mount && (
        <SceneContext.Provider value={def.id}>
          <Suspense fallback={null}>
            <Component />
            <Ready def={def} index={index} onFirst={onFirst} />
          </Suspense>
        </SceneContext.Provider>
      )}
    </group>
  )
}

// ------------------------------------------------------------------ root

export default function HeroScene({
  onReady,
  labelLayer,
}: {
  onReady?: () => void
  labelLayer?: RefObject<HTMLDivElement | null>
}) {
  const [dpr, setDpr] = useState(() =>
    Math.min(window.devicePixelRatio || 1, 1.75),
  )
  const [layer, setLayer] = useState<HTMLElement | null>(null)
  useEffect(() => setLayer(labelLayer?.current ?? null), [labelLayer])
  return (
    <>
      <Canvas
        shadows
        dpr={dpr}
        gl={{
          antialias: false,
          powerPreference: "high-performance",
          stencil: false,
        }}
        onCreated={({ gl }) => gl.setClearColor("#ffffff", 0)}
      >
        {/* drop resolution on slower GPUs instead of dropping frames */}
        <PerformanceMonitor onDecline={() => setDpr(1)} />
        <ClockDriver />
        {statsOn && <StatsLogger />}
        <Lights />
        {SCENES.map((def, i) => (
          <SceneSlot key={def.id} def={def} index={i} onFirst={onReady} />
        ))}
        <Compositor />
      </Canvas>
      <CalloutLayer container={layer} defs={ALL_CALLOUTS} />
    </>
  )
}
