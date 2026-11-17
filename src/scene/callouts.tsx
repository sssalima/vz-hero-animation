import { useLayoutEffect, useRef, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { Object3D, Vector3, type Camera, type Group } from "three"
import type { SceneId } from "./carousel"
import { useControls } from "./clock"

/**
 * Station callouts: SIM-equipped devices streaming telemetry over the cellular network.
 *
 * Each scene declares its callouts as data (`CalloutDef`) and drops an `<Anchor id>` into
 * its 3D tree where the card should point. The cards themselves are plain DOM rendered
 * outside the canvas; the compositor projects every live anchor with its scene's camera and
 * writes position / opacity straight to the element each frame.
 */
export type CalloutDef = {
  id: string
  scene: SceneId
  title: string
  /** cellular signal strength, 1-4 bars */
  bars: number
  /** animation offset so devices don't transmit in lockstep */
  delay: number
  status: (t: number) => string
}

type Slot = {
  def: CalloutDef
  el: HTMLDivElement
  text: HTMLSpanElement
  last: string
  shown: boolean
}

const anchors = new Map<string, Object3D>()
const slots = new Map<string, Slot>()
const v = new Vector3()

/** Marks where a callout points. `alpha` (userData) can fade moving devices in and out. */
export function Anchor({
  id,
  position = [0, 0, 0],
  children,
}: {
  id: string
  position?: [number, number, number]
  children?: ReactNode
}) {
  const ref = useRef<Group>(null)
  useLayoutEffect(() => {
    const o = ref.current
    if (!o) return
    anchors.set(id, o)
    return () => {
      if (anchors.get(id) === o) anchors.delete(id)
    }
  }, [id])
  return (
    <group ref={ref} position={position}>
      {children}
    </group>
  )
}

/** Fade a moving anchor (0..1), e.g. vehicles entering and leaving the frame. */
export function setAnchorAlpha(id: string, alpha: number) {
  const a = anchors.get(id)
  if (a) a.userData.alpha = alpha
}

/** Position the cards of one scene for this frame. */
export function projectCallouts(
  scene: SceneId,
  camera: Camera,
  width: number,
  height: number,
  alpha: number,
  t: number,
) {
  for (const slot of slots.values()) {
    if (slot.def.scene !== scene) continue
    const anchor = anchors.get(slot.def.id)
    const a = anchor ? alpha * ((anchor.userData.alpha as number) ?? 1) : 0
    if (!anchor || a <= 0.001) {
      hide(slot)
      continue
    }
    anchor.updateWorldMatrix(true, false)
    v.setFromMatrixPosition(anchor.matrixWorld).project(camera)
    const x = ((v.x + 1) / 2) * width
    const y = ((1 - v.y) / 2) * height
    slot.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`
    slot.el.style.opacity = a.toFixed(3)
    if (!slot.shown) {
      slot.el.style.visibility = "visible"
      slot.shown = true
    }
    const s = slot.def.status(t)
    if (s !== slot.last) {
      slot.text.textContent = s
      slot.last = s
    }
  }
}

/** Hide every card that doesn't belong to a live scene. */
export function hideCallouts(live: SceneId[]) {
  for (const slot of slots.values()) if (!live.includes(slot.def.scene)) hide(slot)
}

function hide(slot: Slot) {
  if (!slot.shown) return
  slot.el.style.opacity = "0"
  slot.el.style.visibility = "hidden"
  slot.shown = false
}

const SIM_CARD_SRC = `${import.meta.env.BASE_URL}images/sim-card.png`

function Card({ def }: { def: CalloutDef }) {
  const { labels } = useControls()
  const el = useRef<HTMLDivElement>(null)
  const text = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    if (!el.current || !text.current) return
    const slot: Slot = {
      def,
      el: el.current,
      text: text.current,
      last: "",
      shown: false,
    }
    slots.set(def.id, slot)
    return () => {
      slots.delete(def.id)
    }
  }, [def])
  return (
    <div ref={el} className="callout-pin" style={{ visibility: "hidden" }}>
      <div
        className="callout"
        data-visible={labels}
        style={{ "--d": `${def.delay}s` } as React.CSSProperties}
      >
        <div className="callout-chip">
          <span className="callout-sim">
            <img
              src={SIM_CARD_SRC}
              alt=""
              width={40}
              height={31}
              draggable={false}
            />
            <svg className="callout-waves" viewBox="0 0 22 22" aria-hidden>
              {[7, 13, 19].map((r, i) => (
                <path
                  key={r}
                  d={`M1 ${21 - r} A ${r} ${r} 0 0 1 ${1 + r} 21`}
                  style={{ "--i": i } as React.CSSProperties}
                />
              ))}
            </svg>
          </span>
          <span className="callout-text">
            <span className="callout-title">{def.title}</span>
            <span className="callout-status">
              <span ref={text} />
            </span>
          </span>
          <span
            className="callout-net"
            aria-label={`5G signal, ${def.bars} of 4 bars`}
          >
            <span className="callout-bars">
              {[0, 1, 2, 3].map((k) => (
                <i
                  key={k}
                  data-on={k < def.bars}
                  style={{ "--i": k } as React.CSSProperties}
                />
              ))}
            </span>
            <span className="callout-gen">5G</span>
          </span>
        </div>
        <div className="callout-stem">
          <i className="callout-packet" />
        </div>
      </div>
    </div>
  )
}

/** DOM layer for every scene's cards (rendered outside the canvas, into the label layer). */
export function CalloutLayer({
  container,
  defs,
}: {
  container: HTMLElement | null
  defs: CalloutDef[]
}) {
  if (!container) return null
  return createPortal(
    <>
      {defs.map((d) => (
        <Card key={d.id} def={d} />
      ))}
    </>,
    container,
  )
}
