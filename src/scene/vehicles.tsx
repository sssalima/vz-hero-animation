import { useMemo } from "react"
import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  type Material,
} from "three"
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js"
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js"
import { ASSET_META } from "./assetMeta"
import { Box, Cyl, glow, mat, PAL, Prop, type V3 } from "./common"
import type { ModelKey } from "./models"

/**
 * Vehicles and mobile machinery. Road vehicles, farm machinery and rolling stock are sourced
 * models (tools/assets, normalised to real-world metres) facing +x with the origin on the ground
 * under the vehicle's centre. The SIM gateway on connected vehicles stays a small hand-built box,
 * and the grain cart is hand-built until a licensed model is supplied (see sources.json).
 */

const geos = new Map<string, BufferGeometry>()
function cached<T extends BufferGeometry>(key: string, make: () => T): T {
  let g = geos.get(key)
  if (!g) {
    g = make()
    geos.set(key, g)
  }
  return g as T
}

type RBoxProps = {
  args: V3
  r?: number
  position?: V3
  rotation?: V3
  material?: Material
}

/** Rounded box (cached geometry) for the hand-built fallbacks. */
export function RBox({
  args,
  r = 0.08,
  position,
  rotation,
  material = PAL.panel,
}: RBoxProps) {
  const [w, h, d] = args
  const geo = cached(
    `rb|${w}|${h}|${d}|${r}`,
    () => new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2, h / 2, d / 2)),
  )
  return (
    <mesh
      geometry={geo}
      position={position}
      rotation={rotation}
      material={material}
      castShadow
      receiveShadow
    />
  )
}

/** Flotation tyre with chevron lugs (axle along z), rim and hub. */
function TreadWheel({ position, r, w }: { position: V3; r: number; w: number }) {
  const tyre = cached(`tread|${r}|${w}`, () => {
    const parts: BufferGeometry[] = [
      new CylinderGeometry(r - 0.05, r - 0.05, w, 32).rotateX(Math.PI / 2),
    ]
    const n = 30
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2
      const side = k % 2 ? 1 : -1
      const lug = new BoxGeometry(0.07, 0.11, w * 0.55)
        .rotateY(side * 0.5)
        .translate(0, r - 0.05, side * w * 0.2)
        .rotateZ(a)
      parts.push(lug)
    }
    return mergeGeometries(parts.map((g) => g.toNonIndexed()))!
  })
  const rim = cached(`rim|${r}|${w}`, () =>
    new CylinderGeometry(r * 0.58, r * 0.58, w + 0.02, 20).rotateX(Math.PI / 2),
  )
  const hub = cached(`hub|${r}|${w}`, () =>
    new CylinderGeometry(r * 0.2, r * 0.2, w + 0.1, 12).rotateX(Math.PI / 2),
  )
  return (
    <group position={position}>
      <mesh geometry={tyre} material={PAL.rubber} castShadow receiveShadow />
      <mesh geometry={rim} material={PAL.light} castShadow />
      <mesh geometry={hub} material={PAL.steel} />
    </group>
  )
}

// ------------------------------------------------------------------ SIM gateway

/** Rooftop telematics gateway: the SIM-equipped box on connected fleet vehicles. */
export function Gateway({ position }: { position: V3 }) {
  return (
    <group position={position}>
      <RBox
        args={[0.42, 0.1, 0.3]}
        r={0.04}
        position={[0, 0.05, 0]}
        material={PAL.black}
      />
      <Box
        args={[0.06, 0.02, 0.06]}
        position={[0.14, 0.11, 0.08]}
        material={glow("#76b900", 2.4)}
        shadow={false}
      />
    </group>
  )
}

// ------------------------------------------------------------------ road vehicles

export type CarKind = "sedan" | "suv" | "hatch"
export const CAR_MODEL: Record<CarKind, ModelKey> = {
  sedan: "carSedan",
  suv: "carSuv",
  hatch: "carHatch",
}

/** Passenger car (ghost traffic). */
export function Car({ kind = "sedan" }: { kind?: CarKind }) {
  return <Prop model={CAR_MODEL[kind]} position={[0, 0, 0]} />
}

/** Light box truck (7.8 m). */
export function BoxTruck({ connected = false }: { connected?: boolean }) {
  return (
    <group>
      <Prop model="boxTruck" position={[0, 0, 0]} />
      {connected && (
        <Gateway position={[0.8, ASSET_META.box_truck.size[1], 0]} />
      )}
    </group>
  )
}

// tractor fifth wheel sits 1.69 m behind the tractor's centre, the trailer kingpin 5.7 m ahead of its own
const TRACTOR_X = 5.68
const TRAILER_X = TRACTOR_X - 1.69 - 5.7

/** Tractor unit with a 13.6 m box trailer (17 m overall). */
export function Semi({ connected = false }: { connected?: boolean }) {
  return (
    <group>
      <Prop model="semiTractor" position={[TRACTOR_X, 0, 0]} />
      <Prop model="semiTrailer" position={[TRAILER_X, 0, 0]} />
      {connected && (
        <>
          <Gateway
            position={[TRACTOR_X + 1.2, ASSET_META.semi_tractor.size[1], 0]}
          />
          <Gateway
            position={[TRAILER_X + 5.4, ASSET_META.semi_trailer.size[1], 0]}
          />
        </>
      )}
    </group>
  )
}

/** High-roof service van (5.9 m). */
export function Van({ connected = false }: { connected?: boolean }) {
  return (
    <group>
      <Prop model="serviceVan" position={[0, 0, 0]} />
      {connected && (
        <Gateway position={[-0.3, ASSET_META.service_van.size[1], 0]} />
      )}
    </group>
  )
}

const RACK_Y = 2.06
const BED_Y = 1.18

/** Field-service pickup (5.5 m) with a ladder rack over the bed and an extension ladder stowed on it. */
export function ServicePickup({ connected = false }: { connected?: boolean }) {
  return (
    <group>
      <Prop model="servicePickup" position={[0, 0, 0]} />
      {/* rack: hoop behind the cab and at the tailgate, joined by side rails */}
      {[-0.55, -2.55].map((x) => (
        <group key={x}>
          {[-0.82, 0.82].map((z) => (
            <Box
              key={z}
              args={[0.06, RACK_Y - BED_Y, 0.06]}
              position={[x, (RACK_Y + BED_Y) / 2, z]}
              material={PAL.dark}
            />
          ))}
          <Box
            args={[0.08, 0.07, 1.74]}
            position={[x, RACK_Y, 0]}
            material={PAL.dark}
          />
        </group>
      ))}
      {[-0.82, 0.82].map((z) => (
        <Box
          key={z}
          args={[2.06, 0.05, 0.05]}
          position={[-1.55, RACK_Y - 0.02, z]}
          material={PAL.dark}
          shadow={false}
        />
      ))}
      <group position={[-0.65, RACK_Y + 0.035, 0.38]} scale={[1, 1, 1.6]}>
        <Prop model="pickupLadder" position={[0, 0, 0]} />
      </group>
      {connected && (
        <Gateway position={[0.25, ASSET_META.service_pickup.size[1], -0.2]} />
      )}
    </group>
  )
}

// ------------------------------------------------------------------ farm machinery

/** Combine harvester (10.9 m with its pickup header); the unloading auger is out on the left (-z). */
export function Combine({ connected = false }: { connected?: boolean }) {
  return (
    <group>
      <Prop model="combine" position={[0, 0, 0]} />
      {connected && <Gateway position={[2.0, 3.45, 0]} />}
    </group>
  )
}

/** Row-crop tractor (4.8 m). */
export function Tractor({ connected = false }: { connected?: boolean }) {
  return (
    <group>
      <Prop model="tractor" position={[0, 0, 0]} />
      {connected && <Gateway position={[-0.85, 2.93, 0]} />}
    </group>
  )
}

/**
 * Grain cart (hand-built fallback, ~1,100 bu): ribbed tapered hopper on a walking-beam tandem
 * with flotation tyres, hitch tongue with a parking jack and a folded unloading auger.
 * `fill` 0..1 raises the grain heap.
 */
export function GrainCart({
  fill = 0.7,
  connected = false,
}: {
  fill?: number
  connected?: boolean
}) {
  const body = mat("#8d958a", { rough: 0.45, metal: 0.25 })
  const hopper = useMemo(
    () =>
      cached("cart-hopper", () => {
        // square frustum (4 radial segments turned 45°) stretched to 4.6 x 3.0 m on top, flat-shaded
        const g = new CylinderGeometry(1, 0.5, 1.9, 4, 1)
          .rotateY(Math.PI / 4)
          .scale(2.3 / Math.SQRT1_2, 1, 1.5 / Math.SQRT1_2)
        const flat = g.toNonIndexed()
        flat.computeVertexNormals()
        return flat
      }),
    [],
  )
  const slope = Math.atan(0.75 / 1.9)
  return (
    <group>
      {/* chassis: spine, tongue, clevis and jack */}
      <Box
        args={[4.8, 0.22, 0.28]}
        position={[0, 1.15, 0]}
        material={PAL.dark}
      />
      <Box
        args={[2.3, 0.18, 0.22]}
        position={[3.45, 0.92, 0]}
        rotation={[0, 0, 0.12]}
        material={body}
      />
      <Box
        args={[0.3, 0.12, 0.16]}
        position={[4.6, 0.78, 0]}
        material={PAL.steel}
      />
      <Cyl
        r={0.06}
        h={0.72}
        position={[3.9, 0.44, 0.18]}
        material={PAL.steel}
        seg={10}
      />
      <Box
        args={[0.26, 0.03, 0.26]}
        position={[3.9, 0.06, 0.18]}
        material={PAL.steel}
      />
      {/* hopper with stiffener ribs and a top rim */}
      <mesh
        geometry={hopper}
        position={[0, 2.4, 0]}
        material={body}
        castShadow
        receiveShadow
      />
      {[-1.05, -0.35, 0.35, 1.05].map((x) =>
        [-1, 1].map((s) => (
          <Box
            key={`${x}${s}`}
            args={[0.08, 2.02, 0.07]}
            position={[x, 2.4, s * 1.16]}
            rotation={[s * slope, 0, 0]}
            material={body}
          />
        )),
      )}
      {[-1, 1].map((s) => (
        <group key={s}>
          <Box
            args={[4.72, 0.12, 0.08]}
            position={[0, 3.36, s * 1.52]}
            material={PAL.mid}
            shadow={false}
          />
          <Box
            args={[0.08, 0.12, 3.1]}
            position={[s * 2.34, 3.36, 0]}
            material={PAL.mid}
            shadow={false}
          />
        </group>
      ))}
      <RBox
        args={[4.4, 0.18 + fill * 0.5, 2.8]}
        r={0.12}
        position={[0, 3.2 + fill * 0.2, 0]}
        material={mat("#d8d2c0", { rough: 0.95 })}
      />
      {/* walking-beam tandem each side */}
      {[-1, 1].map((s) => (
        <group key={s} position={[-0.3, 0, s * 1.58]}>
          <Box
            args={[1.9, 0.2, 0.16]}
            position={[0, 0.78, -s * 0.36]}
            material={PAL.dark}
          />
          <TreadWheel position={[0.86, 0.72, 0]} r={0.72} w={0.52} />
          <TreadWheel position={[-0.86, 0.72, 0]} r={0.72} w={0.52} />
        </group>
      ))}
      {/* folded unloading auger: upright tube at the front-right corner, top flight folded across the front */}
      <Cyl
        r={0.17}
        h={2.5}
        position={[2.05, 2.55, 1.2]}
        material={body}
        seg={16}
      />
      <Cyl
        r={0.16}
        h={2.5}
        position={[2.25, 3.82, 0.05]}
        rotation={[Math.PI / 2, 0, 0]}
        material={body}
        seg={16}
      />
      <Box
        args={[0.36, 0.36, 0.36]}
        position={[2.25, 3.82, 1.25]}
        material={PAL.mid}
      />
      <Box
        args={[0.34, 0.5, 0.34]}
        position={[2.25, 3.55, -1.25]}
        material={PAL.mid}
      />
      {connected && <Gateway position={[2.0, 3.42, -1.25]} />}
    </group>
  )
}

// ------------------------------------------------------------------ rail

/** NYC R142 subway car (15.5 m). */
export function MetroCar() {
  return <Prop model="metroCar" position={[0, 0, 0]} />
}
