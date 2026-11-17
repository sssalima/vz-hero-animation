# Lighten every 3D element except the SIM-equipped machines

## Goal
Push the whole 3D scene back toward white ("ghosted", ~60%) so that only the four elements that carry a SIM-card callout read at full tone. Lightened objects also lose their floor shadows, and their contact darkening is reduced. HTML callouts, hero copy and controls are unchanged.

## Decisions (confirmed)
| Topic | Decision |
|---|---|
| Full-tone elements | **Capping cell:** UR10 #1, its pedestal and stack light, and the lid-magazine body and guide rods (not the lids). **Vision QC gate:** all of it, including posts, beam, light bar, camera, lamp and scan sheet. **Palletizing cell:** UR10 #2, its pedestal and stack light. **AMR:** the iw.hub plus its tote payload. |
| Lightened elements | Main and pallet conveyors (including the end stop), all pails and lids (also while a robot holds them), pallets, the pallet dispenser, and all set dressing: bulk bins, IBCs, drums, export pallets, wrapped loads, crate, cartons, the crate-top tote, fences, platform, ladder and cones. |
| Strength | Blend the final shaded colour 60% toward white (`FADE = 0.6`), defined as one shared constant/uniform. |
| Shadows | Lightened meshes don't cast shadows (they still receive them). Lower the global AO so lightened surfaces get only faint contact darkening. |
| Floor | Unchanged (already white). |

## Approach: a material-level fade, applied by a wrapper component
The scene renders in greyscale, so "lighter" means blending each lightened object's lit colour toward white inside its shader. This keeps lighting, textures and the existing post stack intact, needs no extra render pass, and is easy to tune.

### New module `src/scene/fade.ts`
- `export const FADE = { value: 0.6 }`: a shared uniform object, so all faded materials update together.
- `fadedMaterial(src: Material): Material`
  - Cache: `WeakMap<Material, Material>`. One faded clone per source material, shared by every mesh that uses it.
  - `const m = src.clone()`. Set `m.onBeforeCompile = (shader) => { shader.uniforms.uFade = FADE; ... }`:
    - Prepend `uniform float uFade;` to `shader.fragmentShader`.
    - Replace `#include <dithering_fragment>` with `gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(1.0), uFade);\n#include <dithering_fragment>`.
  - `m.customProgramCacheKey = () => "faded"` (plus `src.customProgramCacheKey?.()` if present), so three.js compiles a separate program variant.
  - Works for MeshStandard, MeshPhysical and MeshBasic; all include `dithering_fragment`. Keep `transparent`, `opacity` and `depthWrite` as cloned.
  - Handle array materials by mapping each entry.
- `applyFade(root: Object3D)`: traverse meshes. Skip any mesh with `userData.faded` set. Otherwise:
  - `mesh.material = Array.isArray(mat) ? mat.map(fadedMaterial) : fadedMaterial(mat)`
  - `mesh.castShadow = false`
  - `mesh.userData.faded = true`

  Swapping `mesh.material` on a cloned mesh doesn't affect other clones of the same model, because clones share material references but not Mesh objects. So the same tote model can be full tone on the AMR and faded on the crate.

### New component `<Faded>` (in `FactoryScene.tsx`)
```tsx
function Faded({ children }: { children: ReactNode }) {
  const ref = useRef<Group>(null)
  useLayoutEffect(() => { if (ref.current) applyFade(ref.current) })
  // re-scan occasionally for meshes mounted later (Suspense, pooled clones)
  const frame = useRef(0)
  useFrame(() => { if (++frame.current % 30 === 0 && ref.current) applyFade(ref.current) })
  return <group ref={ref}>{children}</group>
}
```
`applyFade` is idempotent (via the `userData.faded` guard), so repeated scans are cheap.

### Scene wiring (`FactoryScene` root and components)
- Wrap in `<Faded>`: `<Conveyors />`, `<Pails />`, `<Pallets />`, `<PalletDispenser />`, `<SetDressing />`.
- Leave unwrapped (full tone): both `<Robot />` (includes `<Pedestal />`), `<QCGate />`, `<AMRUnit />` (AMR + tote).
- `LidMagazine`: keep the body and rods full tone, but wrap the lids `.map(...)` group in `<Faded>`, so stacked and carried lids are lightened.
- The procedural shared materials (`steel`, `panel`, `anodized`, `safetyYellow`, `greenLamp`, …) are used by both full-tone and faded objects. `fadedMaterial` clones them, so the originals stay full tone on the robots and the gate.

### Post-processing tweak (`Effects`)
- N8AO: `intensity` 2.2 → **1.4**, `aoRadius` 0.75 → **0.55**. This keeps readable contact shading under the SIM machines, while near-white faded objects only get faint edges.
- No other effect changes (Neutral tone mapping → greyscale → brightness/contrast stay as is).

## Edge cases
- **Pooled pails and pallets** are created at mount, so the first `useLayoutEffect` catches them. Visibility toggles don't matter because materials persist.
- **Pail lids** shown/hidden on pails are child meshes of the faded pail clones, so they're already faded.
- **Robots carrying pails or lids:** the products stay faded and the robot stays full tone (confirmed).
- **Callouts** are HTML in the label layer and are unaffected.
- **Transparent materials** (wrap film, conveyor acrylic) keep their alpha. Blending toward white only lightens them.
- **Shader compile cost:** one extra program per distinct source material on first frame (about 20–30). Acceptable and one-time.
- **Reduced-motion and paused states:** no interaction; this is static styling.

## Files to change
- `src/scene/fade.ts` (new): `FADE`, `fadedMaterial`, `applyFade`.
- `src/scene/FactoryScene.tsx`: add `<Faded>`, wrap components as listed, split the LidMagazine lids, adjust N8AO props, and import `useLayoutEffect`.

## Verification
1. `pnpm exec tsc --noEmit -p .` and `pnpm run build` pass. Run `pnpm exec oxfmt src`, then re-check tsc (the formatter breaks single-line object types, so keep new types multi-line).
2. Headless screenshots at 1600×900, 1366×768 and 390×844 (puppeteer + swiftshader, ~20 s settle). Check:
   - Conveyors, pails, pallets, dispenser and props read as pale grey, and they cast no floor shadows.
   - Both UR10s with pedestals, the QC gate, and the AMR + tote keep their current tone and shadows. Compare against the previous screenshot.
   - The lid-magazine body stays dark while its lid stack is pale.
   - No console or page errors.
3. If the faded objects still look too heavy (AO edges), drop N8AO intensity further (to 1.0). If the SIM machines look washed out, raise it back. `FADE.value` is the single knob for overall strength.
4. Commit via `figma make versions create --commit` with the changed files.
