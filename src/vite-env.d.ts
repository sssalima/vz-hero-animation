/// <reference types="vite/client" />

declare module "n8ao" {
  import type { Camera, Scene } from "three"
  import { Pass } from "postprocessing"
  /** N8AO ambient occlusion pass for pmndrs/postprocessing (ships without typings). */
  export class N8AOPostPass extends Pass {
    constructor(scene: Scene, camera: Camera, width?: number, height?: number)
    camera: Camera
    autoDetectTransparency: boolean
    configuration: {
      aoRadius: number
      distanceFalloff: number
      intensity: number
      denoiseRadius: number
      transparencyAware: boolean
      [key: string]: unknown
    }
    setQualityMode(mode: "Performance" | "Low" | "Medium" | "High" | "Ultra"): void
  }
}
