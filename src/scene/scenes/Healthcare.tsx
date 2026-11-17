import { useRef } from "react"
import { Group, Mesh } from "three"
import { Anchor, type CalloutDef } from "../callouts"
import {
  BaseFloor,
  Box,
  Connected,
  Faded,
  glow,
  PaintedGround,
  PAL,
  Prop,
  useSceneFrame,
} from "../common"
import type { SceneDef } from "."

/**
 * Healthcare: a clinic wing — patient room, digital radiography room and an OR around a
 * corridor nurse station. The patient monitor, infusion pump, X-ray system and surgical
 * robot carry SIMs; furniture, carts and the room shell are ghosted.
 */

function paintClinic(g: CanvasRenderingContext2D, M: (m: number) => number) {
  // origin (-5, -7): 11 x 11 m of sheet vinyl with 0.6 m score lines
  g.fillStyle = "#f6f7f7"
  g.fillRect(0, 0, M(11), M(11))
  g.strokeStyle = "rgba(0,0,0,0.045)"
  g.lineWidth = 1
  for (let a = 0; a <= 11; a += 0.6) {
    g.beginPath()
    g.moveTo(M(a), 0)
    g.lineTo(M(a), M(11))
    g.stroke()
    g.beginPath()
    g.moveTo(0, M(a))
    g.lineTo(M(11), M(a))
    g.stroke()
  }
  // OR: darker anti-static field under the table
  g.fillStyle = "rgba(0,0,0,0.04)"
  g.fillRect(M(6.3), M(2.0), M(3.6), M(3.2))
  // corridor wayfinding stripe
  g.fillStyle = "rgba(0,0,0,0.12)"
  g.fillRect(M(5.8), M(5.9), M(5.2), M(0.08))
  g.fillRect(M(5.8), M(6.1), M(5.2), M(0.03))
}

/** SimReady folding hospital screen (1.43 m wide), held to partition height so the rooms read from above. */
const SCREEN_H = 0.62

function Screen({ position, rotation = 0 }: { position: [number, number, number]; rotation?: number }) {
  return (
    <group position={position} rotation-y={rotation} scale={[1, SCREEN_H, 1]}>
      <Prop model="hospitalScreen" position={[0, 0, 0]} />
    </group>
  )
}

function Shell() {
  const H = 2.7
  return (
    <group>
      {/* back walls */}
      <Box args={[0.14, H, 10]} position={[-4.07, H / 2, -1]} material={PAL.white} />
      <Box args={[9.2, H, 0.14]} position={[0.5, H / 2, -6.07]} material={PAL.white} />
      {/* screens between patient room / radiography / OR */}
      {[-3.25, -1.8, -0.35].map((x) => (
        <Screen key={x} position={[x, 0, -1.5]} rotation={Math.PI / 2} />
      ))}
      {[-5.25, -3.8].map((z) => (
        <Screen key={z} position={[0.5, 0, z]} />
      ))}
      {[0.95, 2.4].map((z) => (
        <Screen key={z} position={[0.5, 0, z]} />
      ))}
      {/* radiographer's control screen */}
      <Screen position={[-0.3, 0, -5.35]} rotation={Math.PI / 2} />
      {/* corridor nurse station */}
      <Prop model="nurseStation" position={[3.3, 0, 3.0]} rotation={Math.PI} />
    </group>
  )
}

function PatientRoom() {
  return (
    <group>
      <Prop model="hospitalBed" position={[-2.1, 0, -0.15]} rotation={Math.PI / 2} />
      <Prop model="bedHeadUnit" position={[-3.75, 0, 0.9]} />
      <Prop model="bedsideTable" position={[-3.2, 0, 1.3]} rotation={Math.PI / 2} />
      <Prop model="hospitalChair" position={[-2.9, 0, 2.3]} rotation={2.4} />
      <Prop model="ventilator" position={[-3.5, 0, -1.0]} rotation={Math.PI / 2} />
      <Prop model="wasteBin" position={[-0.2, 0, 2.7]} />
    </group>
  )
}

function ImagingExtras() {
  return (
    <group>
      <Prop model="ultrasound" position={[-0.5, 0, -2.4]} rotation={-Math.PI / 2} />
      <Prop model="medicalCart" position={[-3.5, 0, -2.3]} rotation={Math.PI / 2} />
    </group>
  )
}

function OperatingRoom() {
  return (
    <group>
      <Prop model="surgicalTable" position={[2.8, 0, -3.5]} />
      <Prop model="surgicalLight" position={[2.8, 0.95, -3.6]} />
      <Prop model="anesthesia" position={[1.2, 0, -3.1]} rotation={Math.PI} />
      <Prop model="drugCabinet" position={[4.4, 0, -5.55]} />
      <Prop model="diagnosticCart" position={[4.5, 0, -2.2]} rotation={-Math.PI / 2} />
      <Prop model="medicalCart" position={[1.4, 0, -5.4]} />
    </group>
  )
}

function Corridor() {
  return (
    <group>
      <Prop model="hospitalChair" position={[4.2, 0, 0.6]} rotation={-1.2} />
      <Prop model="hospitalChair" position={[3.4, 0, 0.2]} rotation={-0.8} />
      <Prop model="medicalCart" position={[1.4, 0, 0.0]} rotation={0.5} />
      <Prop model="wasteBin" position={[5.1, 0, 1.1]} />
    </group>
  )
}

/** Floor-mounted tube stand that tracks along the table between exposures. */
function XRaySystem() {
  const arm = useRef<Group>(null)
  const lamp = useRef<Mesh>(null)
  useSceneFrame((t) => {
    const u = t % 9
    const s = u < 3 ? 0 : u < 4.5 ? (u - 3) / 1.5 : u < 7.5 ? 1 : 1 - (u - 7.5) / 1.5
    const e = s * s * (3 - 2 * s)
    if (arm.current) arm.current.position.z = -3.4 - 0.6 + e * 1.0
    if (lamp.current) lamp.current.material = u > 4.6 && u < 5.0 ? AMBER : GREEN
  })
  return (
    <group>
      <Prop model="xrayTable" position={[-1.7, 0, -3.8]} />
      <group ref={arm} position={[-2.9, 0, -3.8]}>
        <Prop model="xrayArm" position={[0, 0, 0]} />
      </group>
      <Prop model="xrayStand" position={[-3.65, 0, -5.4]} />
      <Prop model="xrayGenerator" position={[-0.9, 0, -5.55]} />
      <mesh ref={lamp} position={[-0.3, 2.0, -5.36]} material={GREEN}>
        <boxGeometry args={[0.3, 0.05, 0.03]} />
      </mesh>
    </group>
  )
}
const GREEN = glow("#76b900", 3)
const AMBER = glow("#ffb020", 3)

function Healthcare() {
  return (
    <group>
      <BaseFloor />
      <PaintedGround center={[0.5, -1.5]} w={11} d={11} paint={paintClinic} />
      <Connected>
        <Prop model="patientMonitor" position={[-3.0, 0, -0.95]} rotation={Math.PI / 2} />
        <Prop model="ivPole" position={[-0.95, 0, -0.85]} />
        <Prop model="infusionPump" position={[-0.95, 1.05, -0.85]} rotation={-Math.PI / 2} />
        <XRaySystem />
        <Prop model="roboticSystem" position={[2.8, 0, -5.0]} />
      </Connected>
      {/* everything else ghosted */}
      <Faded>
        <Shell />
        <PatientRoom />
        <ImagingExtras />
        <OperatingRoom />
        <Corridor />
      </Faded>
      <Anchor id="hc-monitor" position={[-3.0, 1.95, -0.95]} />
      <Anchor id="hc-pump" position={[-0.95, 1.95, -0.85]} />
      <Anchor id="hc-xray" position={[-2.9, 2.55, -3.8]} />
      <Anchor id="hc-robot" position={[2.8, 2.35, -5.0]} />
    </group>
  )
}

// ------------------------------------------------------------------ telemetry

function monitorStatus(t: number) {
  const hr = 72 + Math.round(3 * Math.sin(t * 0.7) + Math.sin(t * 2.3))
  const sp = 97 + (Math.sin(t * 0.3) > 0.2 ? 1 : 0)
  return `HR ${hr} · SpO₂ ${sp}% · BP 118/76`
}
function pumpStatus(t: number) {
  const left = 42 - Math.floor((t / 60) % 40)
  return `Saline · 125 mL/h · ${left} min left`
}
function xrayStatus(t: number) {
  const u = t % 9
  const n = 3 + Math.floor(t / 9) % 4
  if (u < 4.5) return "Positioning tube head…"
  if (u < 5.2) return "Exposure · 80 kV · 4 mAs"
  return `Image ${n}/6 sent to PACS`
}
function robotStatus(t: number) {
  const u = t % 10
  if (u < 4) return "Arms docked · self-test OK"
  if (u < 7) return "Instrument 2 · 18 uses left"
  return "Telemetry synced · 12 ms"
}

const callouts: CalloutDef[] = [
  { id: "hc-monitor", scene: "healthcare", title: "Patient Monitor", bars: 4, delay: 0, status: monitorStatus },
  { id: "hc-pump", scene: "healthcare", title: "Infusion Pump", bars: 3, delay: 0.45, status: pumpStatus },
  { id: "hc-xray", scene: "healthcare", title: "Digital X-ray", bars: 4, delay: 0.9, status: xrayStatus },
  { id: "hc-robot", scene: "healthcare", title: "Surgical Robot", bars: 4, delay: 1.3, status: robotStatus },
]

export const healthcare: SceneDef = {
  id: "healthcare",
  view: { center: [-0.2, 0.8, -1.3], span: 16 },
  Component: Healthcare,
  callouts,
}
