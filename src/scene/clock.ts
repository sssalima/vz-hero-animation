import { useSyncExternalStore } from "react"
import { CYCLE } from "./timeline"

/**
 * Shared simulation clock. The 3D scene advances `t` every frame; the HTML overlay
 * subscribes to control state (paused, labels) and samples `t` for telemetry.
 */
const prefersReducedMotion =
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches

// Start deep into a steady-state run, just before the palletizer swings.
export const lineClock = {
  t: 1200 * CYCLE + 2.1,
  speed: 1,
}

type Controls = {
  paused: boolean
  labels: boolean
}
let controls: Controls = { paused: !!prefersReducedMotion, labels: true }
const listeners = new Set<() => void>()

export function setControls(patch: Partial<Controls>) {
  controls = { ...controls, ...patch }
  listeners.forEach((l) => l())
}
export function getControls() {
  return controls
}
export function useControls() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => controls,
  )
}
