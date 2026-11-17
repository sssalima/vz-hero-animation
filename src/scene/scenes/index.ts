import type { ComponentType } from "react"
import type { CalloutDef } from "../callouts"
import { SCENE_IDS, type SceneId } from "../carousel"
import { agriculture } from "./Agriculture"
import { energy } from "./Energy"
import { facilities } from "./Facilities"
import { healthcare } from "./Healthcare"
import { infrastructure } from "./Infrastructure"
import { manufacturing } from "./Manufacturing"
import { retail } from "./Retail"
import { transportation } from "./Transportation"

/** Iso framing: `center` is the look-at point; `span` is the visible width in metres on wide screens. */
export type View = {
  center: [number, number, number]
  span: number
  /** extra zoom-out factor on narrow (mobile) screens */
  narrow?: number
}

export type SceneDef = {
  id: SceneId
  view: View
  Component: ComponentType
  callouts: CalloutDef[]
}

const byId: Record<SceneId, SceneDef> = {
  manufacturing,
  retail,
  energy,
  transportation,
  healthcare,
  facilities,
  agriculture,
  infrastructure,
}

export const SCENES: SceneDef[] = SCENE_IDS.map((id) => byId[id])
export const ALL_CALLOUTS: CalloutDef[] = SCENES.flatMap((s) => s.callouts)
