export type CatalogItem = {
  name: string
  role: string
  source: "SimReady" | "Isaac Sim"
  path: string
  size: string
}

/** Every asset used in the scene, with its location in the Omniverse content library. */
export const CATALOG: CatalogItem[] = [
  {
    name: "ConveyorBelt_A05",
    role: "Main + pallet roller line",
    source: "Isaac Sim",
    path: "Isaac/Props/Conveyors/ConveyorBelt_A05.usd",
    size: "2.00 × 1.15 m",
  },
  {
    name: "ConveyorBelt_A08",
    role: "Powered drive section",
    source: "Isaac Sim",
    path: "Isaac/Props/Conveyors/ConveyorBelt_A08.usd",
    size: "2.72 × 1.15 m",
  },
  {
    name: "UR10 · short suction",
    role: "Capping + palletizing robots",
    source: "Isaac Sim",
    path: "Isaac/Robots/UR10/ur10_short_suction.usd",
    size: "1.3 m reach",
  },
  {
    name: "iw.hub",
    role: "Autonomous mobile robot",
    source: "Isaac Sim",
    path: "Isaac/Robots/Idealworks/iw_hub_static.usd",
    size: "1.43 × 0.66 m",
  },
  {
    name: "screwtoppail_a04",
    role: "Product + lid",
    source: "SimReady",
    path: "common_assets/props/screwtoppail_a04",
    size: "Ø 0.33 × 0.48 m",
  },
  {
    name: "blockpallet_a01",
    role: "Outbound pallets",
    source: "SimReady",
    path: "common_assets/props/blockpallet_a01",
    size: "1.20 × 1.00 m",
  },
  {
    name: "pallet_asm_a04 / b02",
    role: "Wrapped finished goods",
    source: "SimReady",
    path: "common_assets/props/pallet_asm_*",
    size: "1.2 m loads",
  },
  {
    name: "container_j01 · f03",
    role: "Bulk raw-material bins",
    source: "SimReady",
    path: "common_assets/props/container_*",
    size: "1.2–1.3 m",
  },
  {
    name: "ibctank_a01",
    role: "Resin IBC totes",
    source: "SimReady",
    path: "common_assets/props/ibctank_a01",
    size: "1000 L",
  },
  {
    name: "steeldrum · plasticdrum · fiberdrum",
    role: "Drum staging",
    source: "SimReady",
    path: "common_assets/props/*drum_*",
    size: "200 L",
  },
  {
    name: "exportpallet_a02",
    role: "Plastic pallets",
    source: "SimReady",
    path: "common_assets/props/exportpallet_a02",
    size: "1.20 × 0.80 m",
  },
  {
    name: "tote_c01 · cubebox_a07",
    role: "Totes + cartons",
    source: "SimReady",
    path: "common_assets/props/tote_c01",
    size: "0.8 / 0.5 m",
  },
  {
    name: "heavydutywoodcrate_a01",
    role: "Spares crate",
    source: "SimReady",
    path: "common_assets/props/heavydutywoodcrate_a01",
    size: "0.9 m",
  },
  {
    name: "metalfencing_a2",
    role: "Cell guarding",
    source: "SimReady",
    path: "common_assets/props/metalfencing_a2",
    size: "1.2 m bays",
  },
  {
    name: "stationaryworkplatform_a03",
    role: "Operator step",
    source: "SimReady",
    path: "common_assets/props/stationaryworkplatform_a03",
    size: "0.96 × 0.73 m",
  },
  {
    name: "tiltandrollladder_a02",
    role: "Maintenance access",
    source: "SimReady",
    path: "common_assets/props/tiltandrollladder_a02",
    size: "1.53 m",
  },
  {
    name: "trafficcone_a04",
    role: "Aisle marking",
    source: "SimReady",
    path: "common_assets/props/trafficcone_a04",
    size: "0.71 m",
  },
]
