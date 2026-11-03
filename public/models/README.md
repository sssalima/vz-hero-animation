# Scene assets

Every model in this folder is an NVIDIA Omniverse asset, converted from OpenUSD to
glTF (`.glb`) for the browser. Real-world scale (metres, Y-up), OmniPBR/MDL material
parameters and textures were carried over; meshes were decimated, given creased
normals and meshopt-compressed (`EXT_meshopt_compression`), with textures as WebP.

Source: `https://omniverse-content-production.s3-us-west-2.amazonaws.com/Assets/`

| File | Source asset |
| --- | --- |
| `conveyor_A05.glb` | `Isaac/4.2/Isaac/Props/Conveyors/ConveyorBelt_A05.usd` |
| `conveyor_A08.glb` | `Isaac/4.2/Isaac/Props/Conveyors/ConveyorBelt_A08.usd` |
| `ur10.glb` | `Isaac/4.2/Isaac/Robots/UR10/ur10_short_suction.usd` (joint hierarchy rebuilt from UsdPhysics revolute joints; joint nodes carry their axis in `extras.axis`) |
| `iw_hub.glb` | `Isaac/4.2/Isaac/Robots/Idealworks/iw_hub_static.usd` |
| `screwtoppail_a04.glb` | `simready_content/common_assets/props/screwtoppail_a04` (lid kept as a separate `lid` node) |
| `blockpallet_a01.glb` | `simready_content/common_assets/props/blockpallet_a01` |
| `pallet_load_a04.glb` | `simready_content/common_assets/props/pallet_asm_a04_120x122x75cm_pr_v_nvd_01` |
| `pallet_load_b02.glb` | `simready_content/common_assets/props/pallet_asm_b02_111x111x129cm_pr_v_nvd_01` |
| `container_j01.glb`, `container_f03.glb` | `simready_content/common_assets/props/container_*` |
| `ibctank_a01.glb` | `simready_content/common_assets/props/ibctank_a01` |
| `steeldrum_a01.glb`, `plasticdrum_b01.glb`, `fiberdrum_a01.glb` | `simready_content/common_assets/props/*drum_*` |
| `exportpallet_a02.glb` | `simready_content/common_assets/props/exportpallet_a02` |
| `tote_c01.glb`, `cubebox_a07.glb` | `simready_content/common_assets/props/tote_c01`, `cubebox_a07` |
| `heavydutywoodcrate_a01.glb` | `simready_content/common_assets/props/heavydutywoodcrate_a01` |
| `metalfencing_a2.glb` | `simready_content/common_assets/props/metalfencing_a2` |
| `stationaryworkplatform_a03.glb` | `simready_content/common_assets/props/stationaryworkplatform_a03` |
| `tiltandrollladder_a02.glb` | `simready_content/common_assets/props/tiltandrollladder_a02` |
| `trafficcone_a04.glb` | `simready_content/common_assets/props/trafficcone_a04` |

Use of these assets is subject to NVIDIA's Omniverse content license terms.
