import { CanvasTexture, LinearMipmapLinearFilter, SRGBColorSpace } from "three"
import { AMR, X_CAP, X_PICK, X_QC, Z_PALLET, Z_ROBOT } from "./timeline"

export const FLOOR = { x0: -18, x1: 16, z0: -9, z1: 8 }
/** matches the neutral.0 page background token */
export const FLOOR_COLOR = "#ffffff"

/** Paints the factory floor: grid, aisle lines, cell outlines, keep-out hatching and stencils. */
export function createFloorTexture(ppm = 72) {
  const { x0, x1, z0, z1 } = FLOOR
  const w = Math.round((x1 - x0) * ppm)
  const h = Math.round((z1 - z0) * ppm)
  const canvas = document.createElement("canvas")
  canvas.width = w
  canvas.height = h
  const g = canvas.getContext("2d")!
  const X = (x: number) => (x - x0) * ppm
  const Z = (z: number) => (z - z0) * ppm
  const M = (m: number) => m * ppm

  g.fillStyle = FLOOR_COLOR
  g.fillRect(0, 0, w, h)

  // soft trowel variation so the concrete doesn't read as flat colour
  for (let i = 0; i < 70; i++) {
    const cx = Math.random() * w
    const cy = Math.random() * h
    const r = M(1.5 + Math.random() * 4)
    const grad = g.createRadialGradient(cx, cy, 0, cx, cy, r)
    const a = 0.012 + Math.random() * 0.02
    grad.addColorStop(
      0,
      Math.random() > 0.5
        ? `rgba(255,255,255,${a * 2})`
        : `rgba(0,0,0,${a * 0.5})`,
    )
    grad.addColorStop(1, "rgba(0,0,0,0)")
    g.fillStyle = grad
    g.fillRect(cx - r, cy - r, r * 2, r * 2)
  }

  // slab joints + grid
  for (let x = Math.ceil(x0); x <= x1; x++) {
    const major = x % 4 === 0
    g.fillStyle = major ? "rgba(0,0,0,0.09)" : "rgba(0,0,0,0.035)"
    g.fillRect(X(x) - (major ? 1.5 : 0.5), 0, major ? 3 : 1, h)
  }
  for (let z = Math.ceil(z0); z <= z1; z++) {
    const major = z % 4 === 0
    g.fillStyle = major ? "rgba(0,0,0,0.09)" : "rgba(0,0,0,0.035)"
    g.fillRect(0, Z(z) - (major ? 1.5 : 0.5), w, major ? 3 : 1)
  }

  // AMR aisle
  const aisle0 = AMR.z - 0.75
  const aisle1 = AMR.z + 0.75
  g.fillStyle = "rgba(0,0,0,0.018)"
  g.fillRect(0, Z(aisle0), w, Z(aisle1) - Z(aisle0))
  g.fillStyle = "rgba(24,27,31,0.42)"
  g.fillRect(0, Z(aisle0) - M(0.03), w, M(0.06))
  g.fillRect(0, Z(aisle1) - M(0.03), w, M(0.06))
  // flow chevrons (AMR drives toward -x)
  g.strokeStyle = "rgba(0,0,0,0.08)"
  g.lineWidth = M(0.05)
  for (let x = x0 + 1; x < x1; x += 3.2) {
    g.beginPath()
    g.moveTo(X(x + 0.2), Z(AMR.z - 0.22))
    g.lineTo(X(x), Z(AMR.z))
    g.lineTo(X(x + 0.2), Z(AMR.z + 0.22))
    g.stroke()
  }

  // back walkway line
  g.fillStyle = "rgba(24,27,31,0.3)"
  g.fillRect(0, Z(-2.75) - M(0.025), w, M(0.05))

  // robot work cells (dashed green outlines)
  const cell = (cx: number, label: string) => {
    const xa = X(cx - 1.55)
    const xb = X(cx + 1.55)
    const za = Z(Z_PALLET - 0.85)
    const zb = Z(0.95)
    g.save()
    g.strokeStyle = "rgba(24,27,31,0.32)"
    g.lineWidth = M(0.035)
    g.setLineDash([M(0.22), M(0.14)])
    g.strokeRect(xa, za, xb - xa, zb - za)
    g.restore()
    g.save()
    g.fillStyle = "rgba(0,0,0,0.2)"
    g.font = `600 ${M(0.2)}px "Geist Mono Variable", "Geist Mono", ui-monospace, monospace`
    g.textBaseline = "top"
    g.fillText(label, xa + M(0.12), zb - M(0.34))
    g.restore()
  }
  cell(X_CAP, "CELL A · CAPPING")
  cell(X_PICK, "CELL C · PALLETIZING")

  // keep-out hatching under the robot pedestals
  const hatch = (cx: number, cz: number, hw: number, hd: number) => {
    g.save()
    g.beginPath()
    g.rect(X(cx - hw), Z(cz - hd), M(hw * 2), M(hd * 2))
    g.clip()
    g.fillStyle = "rgba(24,27,31,0.06)"
    g.fillRect(X(cx - hw), Z(cz - hd), M(hw * 2), M(hd * 2))
    g.strokeStyle = "rgba(24,27,31,0.28)"
    g.lineWidth = M(0.05)
    for (let s = -hw - hd * 2; s < hw + hd * 2; s += 0.14) {
      g.beginPath()
      g.moveTo(X(cx + s), Z(cz - hd))
      g.lineTo(X(cx + s + hd * 2), Z(cz + hd))
      g.stroke()
    }
    g.restore()
  }
  hatch(X_CAP, Z_ROBOT, 0.42, 0.2)
  hatch(X_PICK, Z_ROBOT, 0.42, 0.2)

  // inspection gate footprint
  g.fillStyle = "rgba(24,27,31,0.06)"
  g.fillRect(X(X_QC - 0.32), Z(-0.85), M(0.64), M(1.7))
  g.fillStyle = "rgba(0,0,0,0.2)"
  g.font = `600 ${M(0.2)}px "Geist Mono Variable", "Geist Mono", ui-monospace, monospace`
  g.fillText("CELL B · VISION QC", X(X_QC - 0.75), Z(0.95) - M(0.14))

  // line stencil near the infeed
  g.save()
  g.fillStyle = "rgba(0,0,0,0.06)"
  g.font = `700 ${M(0.55)}px "Geist Mono Variable", "Geist Mono", ui-monospace, monospace`
  g.fillText("LINE 03", X(-7.4), Z(1.25))
  g.restore()

  const tex = new CanvasTexture(canvas)
  tex.colorSpace = SRGBColorSpace
  tex.anisotropy = 8
  tex.minFilter = LinearMipmapLinearFilter
  return tex
}
