# Replace the basic procedural objects with detailed sourced models

## Goal
Bring the seven new industry scenes up to the fidelity of the **manufacturing** scene. Every hand-built procedural object is replaced with a detailed, real-world-scale model that sits naturally next to the SimReady assets. Vehicles, machinery, structures, street furniture and room architecture are all in scope. The ghosting, SIM callouts, carousel, dissolves and timings stay exactly as they are.

## Decisions (confirmed with you)
| Topic | Decision |
|---|---|
| Scope | Everything procedural in the 7 new scenes, including architecture (walls, partitions, buildings, tunnel). **Manufacturing is untouched**: it's the reference. |
| Primary sources | NVIDIA SimReady / Isaac / DriveSim content first. Then **Objaverse** (Sketchfab models with per-model licences, downloadable from Hugging Face), **CC-BY 4.0 or CC0 only**. Then **Poly Haven** (CC0). CC-BY-SA and NC models are excluded. |
| Attribution | CC-BY credits live **in the repo only**: `public/models/CREDITS.md`, generated from the manifest. No on-page credit link. |
| Approval | You approve picks on a **contact sheet** before anything is integrated. |
| Utility bucket truck | Replaced by a **Field Service Truck**: a sourced pickup fitted with a SimReady ladder and toolboxes. |
| Items with no open model | Sourced from **TurboSquid**. The sandbox can't reach TurboSquid (proxy blocks it, and downloads need your login), so I'll send exact search briefs, and you download and upload the files. Any item not supplied falls back to an upgraded hand-built model to the spec in §6. |

## What exploration established
- **Reachable:** the NVIDIA bucket, Objaverse on Hugging Face (GLB files plus licence, author and face-count metadata), and the Poly Haven API. **Not reachable:** Sketchfab images (403) and TurboSquid (403 / certificate errors).
- **Licences:** of about 3,000 permissive Objaverse matches, essentially every vehicle and machine is **CC-BY**. There are no CC0 vehicles anywhere.
- **Fidelity test:** I downloaded 20 candidates and rendered them in the hero's greyscale iso style. These match SimReady well:
  - the modern sedan, hatchback and SUV family;
  - the Scania cab with semi trailer, the Sprinter, and the R142 subway car;
  - the John Deere combine, the tractors, the V136 turbine, the grain bins, the barn and the ISO container.
- **Every sourced model needs conditioning.** Problems found:
  - baked-in ground or terrain planes (grain bins, turbine, loader tractor);
  - very dark or weathered textures (pickup, box truck, tractors);
  - single merged meshes (turbine: the rotor must be split out to spin; Zetor tractor: one material only);
  - brand decals (container logo, Scania marks).
  The pipeline in §3 handles all of these.

## 1. Replacement map
Legend: **●** = SIM-equipped (full tone + callout), ○ = ghosted.
- Objaverse candidates are listed as `name (uid prefix)`, and I'll render 2–3 per slot on the contact sheet.
- "NV" means an NVIDIA asset, converted with the existing `tools/simready/usd2glb.py`.
- "TS" means a TurboSquid brief you'll be asked to fill.

### Transportation (freeway)
| Current procedural | Replacement source | Notes |
|---|---|---|
| ○ Ghost traffic: sedan, SUV, hatch | Objaverse DanielZhabotinsky family: Generic sedan 2010 (`7fd6e157`), Modern Hatchback (`055ff8a2`), Generic SUV (`2866efdf`), Cadillac CTS 2003 (`1b3c8d3f`) | One consistent author gives consistent fidelity. Ghost budget is 8k tris each. Variety comes from mixing models; the `paint` prop is dropped. |
| ● Delivery Truck 214 / 117 | Light Box Truck (`cbc508a5`); alternates Japanese Box Truck (`656908d5`), 12' Box Truck (`2fd3678f`) | Material override: white box, mid-grey cab. |
| ● Reefer Trailer 08 | Tractor unit: Scania (`5a3d99e5`) or Scania truck (`59889032`, decimated). Trailer: Semi Trailer (`f507a422`). | Composed tractor + trailer with a hitch offset. Dirty textures are replaced with clean paint. |
| ● Service Van 12 | Mercedes Sprinter 2006 (`f69de131`); alternate Tiny Cargo Van scan (`517a0a63`) | Strip the bundled animation. |
| ● Utility Truck 31 → **Field Service Truck 31** | Generic 90s light pickup (`6c48c94b`) or Generic Japan pickup (`ca196284`), plus NV SimReady `Ladder_Extension_Fiberglass_A03` and a SimReady toolbox | The callout title and statuses get renamed. |
| ○ Median barrier | Poly Haven `concrete_road_barrier` (CC0); alternate Jersey Barrier (`b52246c9`) | Laid as clones along the median. |
| ○ Guard rails, sign gantry | NV DriveSim `safety_railing_01`, `signpost_dual_27ft` / `signpost_triple_27ft` | |
| ○ Trees | Poly Haven CC0 (`tree_small_02`, `island_tree_02/03`) | Decimated to ≤6k tris with alpha-masked leaves. |
| ○ Roadside cabinet | NV SimReady `Power_Terminal_A01` / `Electrical_Main_Terminal_A01` | Scale is re-checked first. |

### Agriculture
| Current | Replacement | Notes |
|---|---|---|
| ● Combine | John Deere CTS Combine (`9edb7261`); alternate Low Poly Combine (`84b8a341`) | Split the reel into a `reel` node if separable, otherwise keep it static. The augerOut swing is dropped unless the auger is a separate part. |
| ● Tractor | Zetor (`16d79989`), Tractor le0tard (`278fc1e0`), Tractor Ashkelon (`f09ddded`, strip its ground), Tractor sheldon.bean (`e9e844f2`) | Multi-material models rank higher, so glass reads. |
| ● Grain cart | **TS:** "grain cart" / "grain wagon" | Fallback per §6. |
| ● Grain Bin 2 + ○ bins | Silos by nermin (`ef3e7aa9`, strip `floor` and `trash`), Silo Johndoh (`19e8702e`), Industrial_Silo (`5a63e69b`) | The SIM sensor puck stays on the connected bin. |
| ○ Barn, machine shed | Croft Barn House (`3c4c2689`), Barn with mini-shop (`5e59322d`), L&C Pole Barn (`1266af29`) | |
| ○ Crop cones | Wheat — FREE (`ddff74ac`), decimated to one clump of ≤150 tris | Instanced in the existing harvest logic. |
| ○ Field fence, hay, trees | Fence: phase-1 search ("wooden fence", "farm fence"), fallback NV DriveSim `fence_post_6ft_01`. Hay bales (`9a9f28d0`). Trees: Poly Haven CC0. | |
| ● Field Weather Station | **TS:** "agricultural weather station" / "weather station mast" | Fallback per §6. |

### Energy
| Current | Replacement | Notes |
|---|---|---|
| ● / ○ Wind turbines | Generic Wind Turbine V136 (`90ad27be`), Wind turbine sodazot (`c98845dc`), Wind Turbine Stefifox (`ddfe9c08`, strip its ground) | The ingest step splits a `rotor` node with its pivot at the hub (§3). |
| ● Solar field | Photovoltaic Power Plant (`e7586533`), one80solar racking: Braced Single Post Carport (`d1b8914c`) and Full Cantilever T (`bb8d20b5`); panel (`8f094196`) | Rows built from cloned tables. |
| ● Solar inverter | AC Inverter (`e8d19ae2`), Sunny Boy Inverter (`a721a62c`) | Mounted on a SimReady steel skid. |
| ● Substation T1 + ○ second transformer | Substation Transformer (`3a033547`); **TS** brief "power transformer substation" as an upgrade | |
| ○ Breakers, gantry | 3 Phase Circuit Breaker (`1cb565a2`). Gantry: H-frame from two NV `double_utility_pole_65ft` + `double_crossarm_full_lg`. | |
| ○ Fence, control house | NV SimReady `Barrier_Fence_Metal_A02/A03`. Control house: SimReady wall modules (§1 architecture) with ForgeCAD `Interior_Door`. | |
| ● Battery Storage | **TS:** "battery energy storage container (BESS)" | Fallback: a sourced ISO container (closed, white) with a SimReady/Vertiv cooling unit. |
| Poles / wires | Already NV; the catenary wires stay as lines | |

### Infrastructure (city)
| Current | Replacement | Notes |
|---|---|---|
| ● Metro Line 2 | NYC Subway car R142 (`564c1e5e`); alternates Subway Car (`abc21eee`), R62A (`eeccd33a`) | Two cars. |
| ○ Tunnel, platform, stairs | metro tube (`46b6647a`) as the tunnel lining; Metro/Subway Station Interior (`14f5a653`), cropped, as the platform and stairs | The earth section cut stays a clean box (it's the cut-away graphic itself). |
| ○ Subway entrance | Subway Entrance [Street Assets] (`35c02eee`) | |
| ○ Buildings | NV Rivermark `rivermark_plaza_bldg_01/02` (already converted), `kasa_bldg_01–03`, `bldg_modern_library` | Placed and cropped to the block footprints. |
| ● Traffic signal | Heads: McCain 8-Inch Leotek (`f337235e`) or GE Dr6 (`64eccd68`). Arm and pole: NV `signalarm_modern_01_20ft` + `signal_pole_avg_reg_25ft_01`. | Lens materials map to lamp roles that the code drives (§4). |
| ● Street camera | NV `metal_cylinderpost_12ft` + the DigitalTwin cameras already in use | |
| ● Smart streetlight | NV `streetlamp_led_01` (converted as `led_streetlamp`) | Its head material is the dimmable lamp role. |
| ○ EV chargers, bus stop | Charging Station (`3b2854e4`) / HEV Charging Station (`61c3ca98`); Kyoto Bus Stop (`5eb07fc3`) | |
| ○ Street trees, queued cars | Poly Haven CC0; the shared car family | |

### Facilities (warehouse)
| Current | Replacement | Notes |
|---|---|---|
| ● Shipping container | Classic Shipping Container (`772f4be3`), Freight shipping container (`2b787d1a`) | Logos are removed by the material override. Doors stay open if they're separate nodes; otherwise use a closed-door pose and move the tracker. |
| ● Stretch wrapper | **TS:** "stretch wrapper" / "pallet wrapping machine" | Fallback per §6. |
| ○ Walls, dock doors | NV SimReady `Warehouse_H10m_Straight_A04`, `Warehouse_H10m_Corner_In_A01`, `Wall_Entrance_A01`; dock: Gerstein Loading Dock (`2f83b11c`) or DigitalTwin `Modular/Warehouse_A` doors | |

### Retail (kitchen)
| Current | Replacement | Notes |
|---|---|---|
| ● Walk-in cooler | **TS:** "walk-in cooler" / "walk-in freezer" | Fallback per §6. The door must be separable to keep the door-open animation. |
| ○ Hood canopy | NV SimReady `range_hood` (converted) over each range; **TS** "commercial kitchen exhaust hood" as an upgrade | |
| ○ Dining tables, chairs | NV simready_content furniture tables and chairs (asset_info classes `furniture/table`, `seat/chair`) | |
| ○ Walls, queue rail | NV SimReady `Wall_Straight_A01` / `Wall_Corner_A01`. Queue rail: phase-1 search for "queue stanchion"; dropped if none qualifies. | |

### Healthcare (clinic)
| Current | Replacement | Notes |
|---|---|---|
| ○ Walls, partitions | Wall modules extracted from NV `Isaac/6.2/Isaac/Environments/Hospital`, else SimReady `Wall_*`; ForgeCAD `Interior_Door`; SimReady `Window_Blinds` on back walls | |
| ○ Nurse station | NV ArchVis `Commercial/Reception` desk; alternate Reception Desk proposal (`b20d6299`) | |
| ○ X-ray control screen | NV SimReady `Hospital_Screen_B0x` | |

**Stays procedural:**
- the painted ground decals (floors, roads, fields), which are textures rather than objects;
- the city earth section cut;
- catenary wires;
- the small SIM "gateway" pucks on vehicles. These are a 10 px detail and the same device language as the callouts.

## 2. TurboSquid brief (sent to you at Gate A)
For each of grain cart, field weather station, battery storage container, stretch wrapper and walk-in cooler (plus the optional transformer and hood upgrades), you'll get:
- the exact search phrase;
- acceptance criteria:
  - realistic, not stylized;
  - ≤150k polys;
  - real-world proportions;
  - format **FBX, OBJ or glTF/GLB** (not .max/.c4d/.blend only);
  - "Royalty Free" licence, free preferred;
  - separable door for the walk-in;
  - no prominent brand marks.

You upload the files in this chat. I fetch them with `figma attachments get <id> --dest tools/assets/incoming/<slot>.<ext>`. The incoming folder is git-ignored, and raw TurboSquid files are never committed; the TurboSquid licence forbids redistributing them as-is.

## 3. Asset pipeline: `tools/assets/` (new, Node + gltf-transform)
**Files**
- `tools/assets/sources.json` is the single manifest for all non-USD assets. Each entry looks like this:
  ```json
  "car_sedan": {
    "source": { "type": "objaverse", "uid": "7fd6e15785fa4aa9bfd6e31eb7c97ba6" },
    "credit": { "title": "Generic sedan 2010 - Low poly model", "author": "DanielZhabotinsky",
                "url": "https://sketchfab.com/3d-models/7fd6e15785fa4aa9bfd6e31eb7c97ba6", "license": "CC-BY-4.0" },
    "strip": ["(?i)ground|floor|plane|shadow"],
    "orient": { "rotateY": 90 },
    "size": { "length": 4.7 },
    "materials": [
      { "match": "(?i)glass|window", "role": "glass" },
      { "match": "(?i)tire|tyre|rubber|wheel", "role": "rubber" },
      { "match": "*", "role": "paint" }
    ],
    "parts": {},
    "tris": 8000
  }
  ```
  Source types:
  - `objaverse` (uid);
  - `polyhaven` (slug; glTF at 1k through the `api.polyhaven.com/files/<slug>` endpoint);
  - `upload` (path in `tools/assets/incoming/`);
  - NVIDIA assets keep using `tools/simready/assets.json`.
- `tools/assets/fetch.mjs` downloads sources into `$ASSET_CACHE` (default `/tmp/asset-cache`). For Objaverse it resolves the uid through the cached `object-paths.json.gz`. FBX is converted with the FBX2glTF Linux release, fetched into `/tmp`; OBJ is converted with the `obj2gltf` npm package.
- `tools/assets/ingest.mjs` runs these steps in order:
  1. Strip nodes and meshes matching `strip`, plus a ground-plane heuristic: a flat mesh at min-y whose footprint is more than 1.3× the rest of the model.
  2. Bake node transforms.
  3. Apply `orient`, so forward is +x and up is +y.
  4. Uniform-scale to `size.length` (or `height`), centre on x/z, and set y = 0 on the ground.
  5. Remap materials to **palette roles**: `paint`, `paintDark`, `trim`, `glass`, `rubber`, `chrome`, `light`, `keepTexture`, and the drivable roles `lampRed`, `lampAmber`, `lampGreen` and `lampWhite`. The colour and finish values come from `PAL` in `src/scene/common.tsx`, so sourced models share SimReady's tonal range. Brand and dirt textures are dropped. Only `keepTexture` keeps a ≤256 px WebP.
  6. Split `parts` into named, pivoted nodes. Supported splits:
     - `plane` + `radius` around an axis (turbine `rotor`);
     - bbox region (combine `reel`);
     - node-name regex (container doors, walk-in door).
  7. Weld, simplify to `tris` with meshoptimizer, then meshopt-compress and quantize, reusing `tools/simready/optimize.mjs`. That file is refactored to export `optimize(doc, opts)` while keeping its CLI.
  8. Write `public/models/<name>.glb`.
  9. Record final dimensions and part names in the generated `src/scene/assetMeta.ts`.
- `tools/assets/review.html` is the contact sheet, a Vite dev page at `/tools/assets/review.html`. It shows each slot's candidates in the hero's greyscale iso view beside a SimReady reference (forklift, hospital bed). Each tile is labelled with slot, number, title, author, licence, tris and dimensions. Candidates are written to `public/models/_review/`, which is git-ignored.
- `tools/assets/credits.mjs` generates `public/models/CREDITS.md` with title, author, source URL, licence and changes ("converted, decimated, materials normalised, rescaled"). It **fails** if any non-NVIDIA GLB lacks a credit. `public/models/README.md` links to it.
- Dependencies (`@gltf-transform/*`, `meshoptimizer`, `sharp`, `obj2gltf`) go into a scratch dir such as `/tmp/gt`. `tools/**/node_modules` is git-ignored, and the README documents the setup.

## 4. Code integration
- **`src/scene/models.ts`**: add a key per new GLB and remove keys for replaced or unused models. The unused GLBs are deleted from `public/models`.
- **`src/scene/vehicles.tsx`**: each component becomes a GLB-backed wrapper with the same names, so scene code barely changes:
  - `Car({ kind: "sedan" | "suv" | "hatch" | "cts" })`;
  - `BoxTruck`;
  - `Semi` (tractor + trailer at the hitch offset from `assetMeta`);
  - `Van`;
  - **`ServicePickup`**, which replaces `BucketTruck`;
  - `Combine` (spins the `reel` part if present);
  - `Tractor`, `GrainCart`, `MetroCar`.

  `Gateway` stays, positioned from `assetMeta` roof heights. The `RBox` / `Wheels` helpers are deleted once nothing uses them.
- **Drivable parts**:
  - The turbine finds `rotor` and rotates it about its local axis.
  - Signal heads swap the `lampRed`/`lampAmber`/`lampGreen` meshes between on and off materials. If a head's lenses share one material, ingest splits them by height thirds.
  - The streetlight's `lampWhite` dims.
  - The walk-in `door` and container doors use their split nodes.
  - The forklift is unchanged.
- **Scenes**: swap the components per §1 and re-place everything to the real `assetMeta` dimensions, using the projection helper plus screenshots. Callout anchor heights are read from `assetMeta`. Ghost traffic uses `useClones`. Crops and barriers use instancing or clones. Copy changes: "Utility Truck 31" becomes "Field Service Truck 31" ("Dispatched · outage #882" / "Ladder stowed · 55 mph").
- **Budgets**:
  - connected hero models: 20–40k tris;
  - ghost and background models: 5–10k;
  - trees: ≤6k;
  - crop clump: ≤150;
  - per scene: ≤1.2M visible tris and ≤500 draw calls;
  - new GLB payload: ≤10 MB total, ≤2 MB per scene. Scenes still load progressively, and the carousel already holds until the next scene is ready.

## 5. Phases and gates
0. **Stabilise the carousel build**:
   - investigate the 390×844 headless renderer crash, which hits every scene and blocks mobile verification;
   - un-track the committed `tools/simready/node_modules` symlink and git-ignore `tools/**/node_modules`;
   - prune GLBs that are no longer used, then commit.
1. **Tooling plus candidates**: build `tools/assets/`, auto-ingest every shortlisted candidate (auto-orient and scale, palette materials), and publish the contact sheet. Post the TurboSquid briefs. **Gate A: you pick one model per slot and upload the TurboSquid files.**
2. **Final ingest**: tune each chosen entry (orientation, strip lists, material roles, part splits, tri budget), then generate `CREDITS.md` and `assetMeta.ts`.
3. **Integrate scene by scene**, in this order: Transportation, Agriculture, Infrastructure, Energy, Facilities, Retail, Healthcare. Any TurboSquid item still missing gets its §6 fallback, so no scene is blocked.
4. **Verify and polish** (§7). **Gate B: you review the finished scenes.**

## 6. Fallback hand-built spec (only for TurboSquid items you don't supply)
Built from the same palette roles, with bevelled edges and real hardware so they hold up next to sourced models on the contact sheet:
- **Walk-in cooler:** cam-lock panel seams, strip-curtain doorway, three hinges, kick plate, pressure-relief port, condensing unit with fan guard and refrigerant lines.
- **Grain cart:** ribbed hopper, tread tyres on a walking-beam axle, hitch with jack, folding auger and spout.
- **Stretch wrapper:** turntable with skirt, tower with carriage, film roll and pre-stretch rollers, control pendant, light curtain.
- **Battery storage:** sourced container shell plus a SimReady cooling unit, door hardware and conduit.
- **Weather station:** guyed mast, anemometer and vane, solar panel, logger box.

Each fallback appears on the contact sheet for your sign-off like any other candidate.

## 7. Verification
- Run `pnpm exec tsc --noEmit -p .` and `pnpm run build`, then `pnpm exec oxfmt src` and re-run tsc.
- Contact sheet checks on every final GLB:
  - orientation (axes overlay);
  - dimensions within ±5% of target;
  - tone consistent with the SimReady reference;
  - no ground planes, logos or dark-texture leftovers.
- `credits.mjs` passes.
- Headless screenshots, **one Chromium at a time** (parallel runs ran out of memory), with a 35–40 s settle:
  - each scene through `?scene=<id>` at 1600×900, 1366×768 and 390×844;
  - dissolve frames at `?t=<boundary+1.2>&paused` for every adjacent pair, including the infrastructure-to-manufacturing loop.
- Add a dev-only `?stats` flag that logs `renderer.info` calls and triangles per scene to confirm the §4 budgets. Check that every connected element still reads darker than its ghosted surroundings, and that cards don't overlap.
- No console or page errors.
- Commit via `figma make versions create --commit` with the changed files.

## Risks and notes
- **CC-BY in repo only:** you chose this. CC-BY expects credit "reasonable to the medium", so a repo-only list is weaker for a public page and worth a quick legal check. Adding a footer link later is a one-line change.
- **TurboSquid licence:** the Royalty Free licence allows use in products, but bars redistributing the model itself. Shipping converted, decimated, meshopt-compressed GLBs inside the site is standard practice, but legal should confirm for a Verizon page.
- **Trademarks:** several sourced models are real brands (Mercedes Sprinter, Scania, John Deere, Cadillac). Ingest drops logo and decal textures. Where a logo is modelled geometry (grilles, badges), I'll call it out on the contact sheet so you can pick an unbranded alternate.
- **If a candidate fails ingest** (broken normals, unsplittable rotor, single-material glass), the next candidate in the slot is used. If a part split fails, that part stays static (combine reel, container doors).
- **Payload:** Transportation and Agriculture go from zero downloads to about 1.5–2 MB each. Progressive mounting covers this, and the first scene (manufacturing) is unaffected.
