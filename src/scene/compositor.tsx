import { useFrame, useThree } from "@react-three/fiber"
import { N8AOPostPass } from "n8ao"
import {
  BrightnessContrastEffect,
  CopyPass,
  EffectComposer,
  EffectPass,
  HueSaturationEffect,
  RenderPass,
  ToneMappingEffect,
  ToneMappingMode,
} from "postprocessing"
import { useEffect, useMemo } from "react"
import {
  DirectionalLight,
  HalfFloatType,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  type Group,
  type WebGLRenderer,
  type Object3D,
} from "three"
import { hideCallouts, projectCallouts } from "./callouts"
import { carouselState, SCENE_IDS } from "./carousel"
import { lineClock } from "./clock"
import { SCENES, type View } from "./scenes"

/** Objects the compositor drives per scene: one group per scene plus the shadow-casting key light. */
export const rig = {
  groups: [] as (Group | null)[],
  key: null as DirectionalLight | null,
  keyTarget: null as Object3D | null,
}

// ------------------------------------------------------------------ iso camera

const ISO_AZIMUTH = Math.PI / 4
const ISO_ELEVATION = Math.atan(1 / Math.SQRT2) // true isometric (35.26 deg)
/** the manufacturing line's framing; other scenes scale relative to it */
const BASE_SPAN = 10.8

const pointer = { x: 0, y: 0, sx: 0, sy: 0 }
const dir = new Vector3()
const right = new Vector3()
const up = new Vector3()
const target = new Vector3()

function frameCamera(cam: OrthographicCamera, view: View, w: number, h: number) {
  const az = ISO_AZIMUTH + pointer.sx * 0.035
  const el = ISO_ELEVATION - pointer.sy * 0.02
  const aspect = w / h
  const wide = aspect > 1.15
  const s = view.span / BASE_SPAN
  // world units visible across the viewport
  const span = wide
    ? Math.max(BASE_SPAN, 15.5 * (h / w)) * s
    : 6.8 * s * (view.narrow ?? 1)
  const zoom = Math.max(w, 320) / span
  cam.left = -w / 2
  cam.right = w / 2
  cam.top = h / 2
  cam.bottom = -h / 2
  cam.zoom = zoom
  const dist = 40 * Math.max(1, s)
  cam.near = 0.1
  cam.far = dist * 3
  dir.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az))
  right.set(Math.cos(az), 0, -Math.sin(az))
  up.crossVectors(dir, right).normalize().negate()
  // push the scene to the right of the headline on wide screens, below it on tall ones
  const ox = wide ? -(w * 0.14) / zoom : 0
  // `up` points down-screen, so negative offsets lower the scene
  const oy = wide ? (h * -0.025) / zoom : aspect < 0.8 ? (h * -0.2) / zoom : 0
  target
    .set(view.center[0], view.center[1], view.center[2])
    .addScaledVector(right, ox)
    .addScaledVector(up, oy)
  cam.position.copy(target).addScaledVector(dir, dist)
  cam.up.set(0, 1, 0)
  cam.lookAt(target)
  cam.updateProjectionMatrix()
  cam.updateMatrixWorld()
}

function frameLight(view: View) {
  const key = rig.key
  if (!key) return
  const s = Math.max(1, view.span / BASE_SPAN)
  const [cx, , cz] = view.center
  key.position.set(cx - 7 * s, 13 * s, cz + 6.5 * s)
  if (rig.keyTarget) {
    rig.keyTarget.position.set(cx, 0, cz)
    rig.keyTarget.updateMatrixWorld()
  }
  const sc = key.shadow.camera
  sc.left = -13 * s
  sc.right = 13 * s
  sc.top = 11 * s
  sc.bottom = -11 * s
  sc.near = 1
  sc.far = 40 * s
  sc.updateProjectionMatrix()
  key.shadow.normalBias = 0.025 * s
}

// ------------------------------------------------------------------ dissolve

const mixShader = {
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tA;
    uniform sampler2D tB;
    uniform float uK;
    uniform float uAspect;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
                 mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
    }
    void main() {
      vec4 a = texture2D(tA, vUv);
      if (uK <= 0.0) {
        gl_FragColor = a;
      } else {
        vec4 b = texture2D(tB, vUv);
        // soft, organic dissolve with a gentle left-to-right drift
        vec2 p = vec2(vUv.x * uAspect, vUv.y);
        float n = 0.5 * noise(p * 2.3 + 3.7) + 0.22 * noise(p * 5.9 + 1.3) + 0.28 * vUv.x;
        float f = 0.34;
        float m = smoothstep(n - f, n + f, uK * (1.0 + 2.0 * f) - f);
        vec4 c = mix(a, b, m);
        // lift toward the page white at the midpoint so it reads as a fade, not a double exposure
        float veil = 0.32 * 4.0 * uK * (1.0 - uK);
        c.rgb = mix(c.rgb, vec3(1.0), veil);
        gl_FragColor = c;
      }
      #include <colorspace_fragment>
    }
  `,
}

// ------------------------------------------------------------------ pipeline

function createPipeline(gl: WebGLRenderer, scene: Scene) {
  const cams = SCENES.map(() => new OrthographicCamera())
  const composer = new EffectComposer(gl, {
    multisampling: 4,
    frameBufferType: HalfFloatType,
  })
  composer.autoRenderToScreen = false
  const renderPass = new RenderPass(scene, cams[0])
  const ao = new N8AOPostPass(scene, cams[0])
  ao.autoDetectTransparency = false
  ao.configuration.transparencyAware = false
  ao.setQualityMode("Medium")
  ao.configuration.intensity = 1.4
  ao.configuration.denoiseRadius = 12
  const fx = new EffectPass(
    cams[0],
    new ToneMappingEffect({ mode: ToneMappingMode.NEUTRAL }),
    // the scenes are rendered as a monochrome backdrop for the light hero
    new HueSaturationEffect({ saturation: -1 }),
    // lift the blacks so the monochrome scene sits softly on the white floor
    new BrightnessContrastEffect({ brightness: 0.035, contrast: -0.08 }),
  )
  const rtA = new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false })
  const rtB = new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false })
  const copy = new CopyPass(rtA, false)
  // CopyPass writes into whichever target is assigned here (not part of its public typings)
  const copyTarget = copy as unknown as { renderTarget: WebGLRenderTarget }
  composer.addPass(renderPass)
  composer.addPass(ao)
  composer.addPass(fx)
  composer.addPass(copy)

  const mixMat = new ShaderMaterial({
    ...mixShader,
    uniforms: {
      tA: { value: rtA.texture },
      tB: { value: rtB.texture },
      uK: { value: 0 },
      uAspect: { value: 1 },
    },
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  })
  const quad = new Mesh(new PlaneGeometry(2, 2), mixMat)
  quad.frustumCulled = false
  const mixScene = new Scene()
  mixScene.add(quad)
  const mixCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1)

  const buf = new Vector2()
  return {
    cams,
    setSize(w: number, h: number) {
      composer.setSize(w, h)
      gl.getDrawingBufferSize(buf)
      rtA.setSize(buf.x, buf.y)
      rtB.setSize(buf.x, buf.y)
      ao.setSize(buf.x, buf.y)
      mixMat.uniforms.uAspect.value = w / h
    },
    renderScene(index: number, target: WebGLRenderTarget, dt: number) {
      const cam = cams[index]
      const view = SCENES[index].view
      rig.groups.forEach((g, i) => {
        if (g) g.visible = i === index
      })
      frameLight(view)
      const s = view.span / BASE_SPAN
      ao.configuration.aoRadius = 0.55 * s
      ao.configuration.distanceFalloff = 0.6 * s
      composer.setMainCamera(cam)
      ao.camera = cam
      copyTarget.renderTarget = target
      composer.render(dt)
    },
    composite(k: number) {
      mixMat.uniforms.uK.value = k
      gl.setRenderTarget(null)
      // autoClear is off for the composer passes; clear the default framebuffer explicitly
      gl.clear()
      gl.render(mixScene, mixCam)
    },
    rtA,
    rtB,
    dispose() {
      composer.dispose()
      rtA.dispose()
      rtB.dispose()
      mixMat.dispose()
    },
  }
}

/** Takes over rendering: each live scene is rendered with its own camera, then dissolved. */
export function Compositor() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const size = useThree((s) => s.size)
  const dpr = useThree((s) => s.viewport.dpr)
  const pipe = useMemo(() => createPipeline(gl, scene), [gl, scene])
  useEffect(() => {
    gl.autoClear = false
    return () => {
      gl.autoClear = true
      pipe.dispose()
    }
  }, [gl, pipe])
  useEffect(() => {
    pipe.setSize(size.width, size.height)
  }, [pipe, size.width, size.height, dpr])
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      pointer.x = (e.clientX / window.innerWidth) * 2 - 1
      pointer.y = (e.clientY / window.innerHeight) * 2 - 1
    }
    window.addEventListener("pointermove", onMove)
    return () => window.removeEventListener("pointermove", onMove)
  }, [])

  useFrame((_, dt) => {
    const pk = 1 - Math.exp(-dt * 2.5)
    pointer.sx += (pointer.x - pointer.sx) * pk
    pointer.sy += (pointer.y - pointer.sy) * pk
    const { a, b, k } = carouselState()
    const w = size.width
    const h = size.height
    const live = k > 0 ? [a, b] : [a]
    live.forEach((i, slot) => {
      frameCamera(pipe.cams[i], SCENES[i].view, w, h)
      pipe.renderScene(i, slot === 0 ? pipe.rtA : pipe.rtB, dt)
      // outgoing cards leave during the first half of the dissolve, incoming ones arrive in the second
      const alpha = k === 0 ? 1 : slot === 0 ? clamp01(1 - k * 2) : clamp01(k * 2 - 1)
      projectCallouts(SCENE_IDS[i], pipe.cams[i], w, h, alpha, lineClock.t)
    })
    hideCallouts(live.map((i) => SCENE_IDS[i]))
    pipe.composite(k)
  }, 1)
  return null
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)
