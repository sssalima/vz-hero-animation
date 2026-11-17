import { useSyncExternalStore } from "react"

/**
 * Looping industry carousel. Each scene holds for HOLD seconds, then dissolves into the next
 * over DISSOLVE seconds; after the last scene it dissolves back into the first.
 */
export const SCENE_IDS = [
  "manufacturing",
  "retail",
  "energy",
  "transportation",
  "healthcare",
  "facilities",
  "agriculture",
  "infrastructure",
] as const
export type SceneId = (typeof SCENE_IDS)[number]

export const HOLD = 12
export const DISSOLVE = 2.5
export const PERIOD = HOLD + DISSOLVE
const N = SCENE_IDS.length

/** dev aid: `?scene=energy` pins the carousel to one scene */
const pinned = (() => {
  if (typeof location === "undefined") return null
  const id = new URLSearchParams(location.search).get("scene")
  return (SCENE_IDS as readonly string[]).includes(id ?? "")
    ? (id as SceneId)
    : null
})()

/** dev aid: `?t=26` starts the carousel 26 s in (e.g. mid-dissolve) */
const startT = (() => {
  if (typeof location === "undefined") return 0
  const t = Number(new URLSearchParams(location.search).get("t"))
  return Number.isFinite(t) && t > 0 ? t : 0
})()

export const carousel = {
  /** carousel time in seconds (advances with the line clock, pauses with it) */
  t: pinned ? SCENE_IDS.indexOf(pinned) * PERIOD : startT,
  ready: new Set<SceneId>(),
  pinned,
}

const smooth = (x: number) => {
  const t = x < 0 ? 0 : x > 1 ? 1 : x
  return t * t * (3 - 2 * t)
}

export type CarouselState = {
  /** outgoing (or only) scene */
  a: number
  /** incoming scene */
  b: number
  /** dissolve progress 0..1 (0 when holding) */
  k: number
}

const state: CarouselState = { a: 0, b: 1, k: 0 }

export function carouselState(): CarouselState {
  const cycle = Math.floor(carousel.t / PERIOD)
  const u = carousel.t - cycle * PERIOD
  state.a = ((cycle % N) + N) % N
  state.b = (state.a + 1) % N
  state.k = u <= HOLD ? 0 : smooth((u - HOLD) / DISSOLVE)
  return state
}

/** advance the carousel, holding before a dissolve until the incoming scene has loaded */
export function advanceCarousel(dt: number) {
  if (carousel.pinned) {
    // keep the pinned scene playing inside its hold window
    const start = SCENE_IDS.indexOf(carousel.pinned) * PERIOD
    carousel.t = start + ((carousel.t - start + dt) % HOLD)
    return
  }
  const cycle = Math.floor(carousel.t / PERIOD)
  const u = carousel.t - cycle * PERIOD
  const next = SCENE_IDS[(((cycle + 1) % N) + N) % N]
  if (u + dt > HOLD && u <= HOLD && !carousel.ready.has(next)) {
    carousel.t = cycle * PERIOD + HOLD
    return
  }
  carousel.t += dt
}

/**
 * Scene-local time: seconds since this scene began dissolving in on the current loop, plus
 * the loop count (for per-visit variation). Lets scenes choreograph what happens on screen.
 */
export function sceneClock(id: SceneId) {
  const start = SCENE_IDS.indexOf(id) * PERIOD - DISSOLVE
  const len = PERIOD * N
  const rel = carousel.t - start
  const loop = Math.floor(rel / len)
  return { local: rel - loop * len, loop }
}

/** 0..1 visibility of a scene in the current frame */
export function sceneAlpha(index: number) {
  const { a, b, k } = carouselState()
  if (index === a) return 1 - k
  if (index === b) return k
  return 0
}

export function isSceneLive(id: SceneId) {
  const i = SCENE_IDS.indexOf(id)
  const { a, b, k } = carouselState()
  return i === a || (k > 0 && i === b) || (i === b && carousel.t % PERIOD > HOLD - 1)
}

// ------------------------------------------------------------ progressive mounting

let mountedUpTo = 0
const listeners = new Set<() => void>()

/** scenes mount one after another so the first one isn't starved of bandwidth */
export function markSceneReady(id: SceneId) {
  carousel.ready.add(id)
  let i = 0
  while (i < N && carousel.ready.has(SCENE_IDS[i])) i++
  const upTo = Math.min(N - 1, i)
  if (upTo !== mountedUpTo) {
    mountedUpTo = upTo
    listeners.forEach((l) => l())
  }
}

export function useMountedUpTo() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => mountedUpTo,
  )
}
