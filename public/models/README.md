# Catalog 3D models

Drop real product `.glb` / `.gltf` files here. Files in `public/` are copied
verbatim into the build root, so a file named `ring1.glb` here is served at:

- dev: `/models/ring1.glb`
- GitHub Pages: `/jewelar/models/ring1.glb`

That URL is wired up in [`src/catalog/modelMap.ts`](../../src/catalog/modelMap.ts)
via `${import.meta.env.BASE_URL}models/ring1.glb`, mapped from the Shopify
product handle `tryon-test-ring`.

Test it: open `?piece=ring&handle=tryon-test-ring` — the 3D viewer loads the
model, re-dresses its meshes with our gold + diamond materials (respecting the
المعدن / الحجر selectors), and falls back to the procedural ring if the file is
missing or fails to load.

Authoring convention: model in millimetres, Y-up, facing +Z, origin at the band
centre. The viewer auto-centres and scales to the procedural ring; if band vs.
stone parts don't split correctly by size, read the mesh names logged to the
browser console and tag them in `MODEL_CONFIG_BY_HANDLE`.
