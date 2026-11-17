# Sourced scene models

Pipeline that replaces procedural geometry in the industry scenes with open-licence,
SimReady or user-supplied models, normalised to match the SimReady assets already in
`public/models` (real-world metres, Y-up, +x forward, palette materials, meshopt GLB).

```sh
pnpm install --dir tools/assets --ignore-workspace --no-lockfile   # gltf-transform, meshoptimizer, sharp, puppeteer-core
node tools/assets/fetch.mjs [slot | slot.id ...]       # download into tools/assets/incoming/ (git-ignored)
node tools/assets/ingest.mjs --review [slot ...]       # every candidate -> tools/assets/_review/ (git-ignored, never built)
open /tools/assets/review.html                          # contact sheet on the dev server (?slot=, ?scene=)
node tools/assets/snapshot.mjs [slot ...]               # same sheet as PNGs in tools/assets/_review/sheet/
node tools/assets/ingest.mjs [slot ...]                # picked candidates -> public/models/<slot>.glb + src/scene/assetMeta.ts
node tools/assets/ingest.mjs --meta                    # only regenerate assetMeta.ts (sizes, pivots, content hashes)
node tools/assets/credits.mjs                          # public/models/CREDITS.md
```

NVIDIA candidates go through `tools/simready/fetch.py` + `usd2glb.py`, which need the
`usd-core` and `numpy` wheels for the local Python unpacked into `tools/.pydeps/` (git-ignored;
any `pip install --target tools/.pydeps usd-core numpy` works where pip is available).

`assetMeta.ts` records each model's content hash; `src/scene/models.ts` appends it to the URL
(`?v=<hash>`), so a re-ingested model is never served from the loader's in-memory cache during
hot reload, or from a browser / CDN cache after deploy.

## Sources and licences

| `source` | Where | Licence handling |
| --- | --- | --- |
| `objaverse` | Sketchfab uploads mirrored by [allenai/objaverse](https://huggingface.co/datasets/allenai/objaverse) (`uid`) | CC0 / CC-BY only; title, author and URL recorded for credits |
| `polyhaven` | [Poly Haven](https://polyhaven.com) models (`asset`) | CC0 |
| `nvidia` | Omniverse / SimReady USD (`src` folder or `.usd`) | NVIDIA Omniverse content licence, as for the other models in `public/models` |
| `upload` | Files you place in `tools/assets/incoming/upload/<file>.{glb,gltf,obj,fbx}` (e.g. TurboSquid purchases) | Your licence; not redistributed beyond the optimised GLB |

CC-BY-SA, NC and ND sources are rejected (they would restrict the app or forbid the
modifications ingest makes).

## `sources.json`

Each slot is one model the scenes use: `scene`, `replaces` (what it supersedes), `use`
(`hero` connected device, `ghost` background, `instanced` repeated), `tris` budget, target
`size` (`length` = x, `height` = y or `width` = z, metres), optional `align: false` (keep the
source heading instead of turning the long axis to +x) and `pick` (the chosen candidate id).

Candidate overrides:

- `up`: `"z"`, `"-z"` or `"x"` for sources that are not Y-up; `yaw` degrees about +Y so the front faces +x
- `size`, `scale`, `tris`, `align`: per-candidate versions of the slot fields
- `strip`: regex on `node | mesh | material` names to drop (props, people, signage, baked ground)
- `ground: "keep"`: disable automatic removal of flat bottom planes
- `materials`: `[[regex, role], ...]` onto palette roles `paint white panel light mid steel dark black rubber glass chrome concrete wood tone foliage`
  (`tone` keeps the source's average colour; `foliage` keeps an alpha-masked texture)
- `texture`: `flat` (average colour), `vertex` (bake into vertex colours) or `keep`
- `keepDark: true`: do not lift near-black bodies to the mid grey
- `parts`: `[{ "name": "rotor", "match": "regex" | "box": [[x0,y0,z0],[x1,y1,z1]], "pivot": [x,y,z] | "center" | "base" }]` —
  split into child nodes (named `name`, translated to `pivot`) so scenes can animate them; the
  mesh hangs off a `<name>_mesh` child, so rotating the named node always turns about the pivot.
  `"contain": "all"` makes a `box` take only triangles lying wholly inside it (not by centroid)
- `crease`: normal crease angle in degrees (default 38)
- `rotate`: `[["x", deg], ...]` extra tilt fixes applied after `up` (sources modelled leaning, e.g. a
  ladder or a PV module standing at 42°)
- `size: null`: keep the source's own metre scale; `keepY: true`: keep its ground line at y = 0
  instead of resting the lowest point there (entrance stairs that go below street level)
- `crop`: `{ "box": [[x0,y0,z0],[x1,y1,z1]], "center": bool }` keep only triangles whose centroid is
  inside the box, in normalised metres (one head of a multi-head signal, the back half of a tube
  for a cut-away, a container with its door end removed)
- `brighten`: linear multiplier for dark / weathered `tone` colours (vertex colours included)

Picks with no suitable open model and no upload yet (grain cart, stretch wrapper, weather
station) have no `pick`; the scenes use upgraded hand-built fallbacks until a file arrives in
`incoming/upload/`. Walk-in cooler and battery storage use open-model fallbacks (`review`
notes say how); their TurboSquid `t` candidates are still listed for a later upload.
