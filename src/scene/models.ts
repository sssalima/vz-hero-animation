import { useGLTF } from "@react-three/drei"
import { useMemo } from "react"
import { Material, Mesh, MeshStandardMaterial, Object3D } from "three"
import { ASSET_META } from "./assetMeta"

const base = import.meta.env.BASE_URL
const hashes: Record<string, { hash?: string }> = ASSET_META
/**
 * Sourced models carry their content hash (written by tools/assets/ingest.mjs) in the URL, so a
 * re-ingested model replaces the cached copy: useGLTF caches by URL for the life of the page, and
 * browsers / CDNs cache by URL too.
 */
const url = (name: string) => {
  const v = hashes[name]?.hash
  return `${base}models/${name}.glb${v ? `?v=${v}` : ""}`
}

/** Converted NVIDIA SimReady / Isaac Sim assets (USD -> glTF, see public/models/README.md) */
export const MODELS = {
  conveyor: url("conveyor_A05"),
  conveyorDrive: url("conveyor_A08"),
  ur10: url("ur10"),
  amr: url("iw_hub"),
  pail: url("screwtoppail_a04"),
  pallet: url("blockpallet_a01"),
  palletLoadA: url("pallet_load_a04"),
  palletLoadB: url("pallet_load_b02"),
  tote: url("tote_c01"),
  bulkBin: url("container_j01"),
  bulkBox: url("container_f03"),
  ibc: url("ibctank_a01"),
  plasticDrum: url("plasticdrum_b01"),
  fiberDrum: url("fiberdrum_a01"),
  cone: url("trafficcone_a04"),
  fence: url("metalfencing_a2"),
  platform: url("stationaryworkplatform_a03"),
  ladder: url("tiltandrollladder_a02"),
  crate: url("heavydutywoodcrate_a01"),
  box: url("cubebox_a07"),
  exportPallet: url("exportpallet_a02"),
  // industry scenes (tools/simready/assets.json)
  posTerminal: url("pos_terminal"),
  orderKiosk: url("order_kiosk"),
  beverageFridge: url("beverage_fridge"),
  rangeOven: url("range_oven"),
  kitchenCounter: url("kitchen_counter"),
  kitchenIsland: url("kitchen_island"),
  rangeHood: url("range_hood"),
  steelTable: url("steel_table"),
  reachFridge: url("reach_fridge"),
  wallSink: url("wall_sink"),
  coffeeMachine: url("coffee_machine"),
  trashWheeled: url("trash_wheeled"),
  stockPot: url("stock_pot"),
  hospitalBed: url("hospital_bed"),
  patientMonitor: url("patient_monitor"),
  infusionPump: url("infusion_pump"),
  ivPole: url("iv_pole"),
  ventilator: url("ventilator"),
  ultrasound: url("ultrasound"),
  xrayStand: url("xray_stand"),
  xrayTable: url("xray_table"),
  xrayArm: url("xray_arm"),
  xrayGenerator: url("xray_generator"),
  roboticSystem: url("robotic_system"),
  surgicalTable: url("surgical_table"),
  anesthesia: url("anesthesia"),
  surgicalLight: url("surgical_light"),
  bedsideTable: url("bedside_table"),
  hospitalChair: url("hospital_chair"),
  drugCabinet: url("drug_cabinet"),
  medicalCart: url("medical_cart"),
  diagnosticCart: url("diagnostic_cart"),
  bedHeadUnit: url("bed_head_unit"),
  wasteBin: url("waste_bin"),
  forkliftAuto: url("forklift_auto"),
  palletJack: url("pallet_jack"),
  rackLarge: url("rack_large"),
  palletWrapped: url("pallet_wrapped"),
  securityCage: url("security_cage"),
  dockBoard: url("dock_board"),
  utilityPole: url("utility_pole"),
  signalArm: url("signal_arm"),
  crosswalkSignal: url("crosswalk_signal"),
  ledStreetlamp: url("led_streetlamp"),
  lamppostDouble: url("lamppost_double"),
  bench: url("bench"),
  bikeRack: url("bike_rack"),
  bollard: url("bollard"),
  hydrant: url("hydrant"),
  cityTrashcan: url("city_trashcan"),
  smallCell: url("small_cell"),
  securityCamA: url("security_cam_a"),
  securityCamD: url("security_cam_d"),
  plywoodCrate: url("plywood_crate"),
  greenCrate: url("green_crate"),
  wheelbarrow: url("wheelbarrow"),
  // sourced models (tools/assets/sources.json -> ingest.mjs; credits in public/models/CREDITS.md)
  carSedan: url("car_sedan"),
  carHatch: url("car_hatch"),
  carSuv: url("car_suv"),
  boxTruck: url("box_truck"),
  semiTractor: url("semi_tractor"),
  semiTrailer: url("semi_trailer"),
  serviceVan: url("service_van"),
  servicePickup: url("service_pickup"),
  pickupLadder: url("pickup_ladder"),
  guardrail: url("guardrail"),
  signGantry: url("sign_gantry"),
  tree: url("tree"),
  streetCabinet: url("street_cabinet"),
  combine: url("combine"),
  tractor: url("tractor"),
  grainBin: url("grain_bin"),
  barn: url("barn"),
  machineShed: url("machine_shed"),
  crop: url("crop"),
  farmFence: url("farm_fence"),
  windTurbine: url("wind_turbine"),
  solarTable: url("solar_table"),
  inverter: url("inverter"),
  transformer: url("transformer"),
  substationBay: url("substation_bay"),
  controlHouse: url("control_house"),
  metroCar: url("metro_car"),
  subwayTunnel: url("subway_tunnel"),
  subwayStation: url("subway_station"),
  subwayEntrance: url("subway_entrance"),
  trafficSignal: url("traffic_signal"),
  evCharger: url("ev_charger"),
  cityBuilding: url("city_building"),
  cityStore: url("city_store"),
  cityOffice: url("city_office"),
  shippingContainer: url("shipping_container"),
  dockDoor: url("dock_door"),
  warehouseWall: url("warehouse_wall"),
  nurseStation: url("nurse_station"),
  hospitalScreen: url("hospital_screen"),
  bistroTable: url("bistro_table"),
  walkInCooler: url("walk_in_cooler"),
  bess: url("bess"),
} as const

export type ModelKey = keyof typeof MODELS

const prepared = new WeakSet<Object3D>()

function prepare(root: Object3D) {
  if (prepared.has(root)) return
  prepared.add(root)
  root.traverse((o) => {
    const mesh = o as Mesh
    if (!mesh.isMesh) return
    const mats = (
      Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    ) as Material[]
    const transparent = mats.some((m) => m.transparent)
    mesh.castShadow = !transparent
    mesh.receiveShadow = true
    for (const m of mats) {
      const sm = m as MeshStandardMaterial
      if (sm.isMeshStandardMaterial) {
        sm.envMapIntensity = 0.9
        if (sm.transparent) sm.depthWrite = false
      }
    }
  })
}

/** Load (cached) and prepare a model; returns the shared source scene. */
export function useModel(key: ModelKey) {
  const gltf = useGLTF(MODELS[key])
  prepare(gltf.scene)
  return gltf.scene
}

/** A memoised deep clone (geometry and materials are shared). */
export function useClone(key: ModelKey) {
  const scene = useModel(key)
  return useMemo(() => scene.clone(true), [scene])
}

/** N clones of a model, for pooled moving objects. */
export function useClones(key: ModelKey, count: number) {
  const scene = useModel(key)
  return useMemo(
    () => Array.from({ length: count }, () => scene.clone(true)),
    [scene, count],
  )
}

/** A named part (split out by tools/assets/ingest.mjs, pivoted for animation) of a cloned model. */
export function usePart(obj: Object3D, name: string) {
  return useMemo(() => obj.getObjectByName(name) ?? null, [obj, name])
}
