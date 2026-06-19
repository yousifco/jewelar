# PROMPTS — Claude Code on the web (claude.ai/code)

Paste these **one at a time**, in order, into a Claude Code session connected to `yousifco/jewelar`.
Wait for each task to finish and push before starting the next. Each prompt is self-contained.
Keep `BUILD_SPEC.md` in the repo — the prompts rely on it.

---

## Prompt 0 — Scaffold + auto-deploy
```
Read BUILD_SPEC.md in this repo. Scaffold a Vite + TypeScript static web app for an on-device
jewellery WebAR try-on. Requirements:
- Arabic-first, RTL shell (dir="rtl", lang="ar"), dark "velvet + gold" theme.
- Three.js installed. A hello scene renders a rotating cube to confirm WebGL works.
- GitHub Actions workflow that builds and deploys to GitHub Pages on every push to main.
- Clean folder structure: src/engine, src/tracking, src/occlusion, src/ui.
- README updated with run/deploy instructions.
Commit and open a PR. Acceptance: the deployed GitHub Pages URL shows the rotating scene.
```

## Prompt 1 — PBR rendering engine (Phase 1)
```
Implement Phase 1 from BUILD_SPEC.md (PBR engine). Build a Three.js render module in src/engine that
renders photoreal jewellery: gold metal (yellow/white/rose) via MeshStandardMaterial, gems
(diamond/ruby/sapphire/emerald) via MeshPhysicalMaterial with transmission+ior 2.42, and environment
reflections via PMREMGenerator + RoomEnvironment (no HDR file). Parametric models: ring, pendant, earring.
Add an orbit viewer page with controls for piece, metal, gem, and a lighting (exposure) slider, plus a
moving light so gems sparkle. Use the material params and tone-mapping settings in the spec. Match the
quality of /seed/engine.html. Keep 60fps desktop / 30fps mobile. Commit + PR.
```

## Prompt 2 — Face try-on + occlusion (Phase 2)
```
Implement Phase 2 from BUILD_SPEC.md. Add MediaPipe FaceLandmarker (VIDEO mode, outputFacial
TransformationMatrixes). Open the camera (mirrored selfie), and anchor a 3D NECKLACE and EARRINGS from
the Phase 1 engine to the head using the facial transformation matrix. Use the cover-fit + mirror mapping
and EMA smoothing described in the spec (§4). Add depth-only occluder meshes for neck/jaw and far ear
(§5) so the back of the necklace and the far earring are hidden — it must look WORN, not pasted.
Reference /seed/ar-tryon.html for tracking/mapping (but replace its 2D drawing with the 3D engine).
Handle camera-permission errors gracefully (and note HTTPS is required). Commit + PR.
```

## Prompt 3 — Hand try-on + occlusion + sizing (Phase 3)
```
Implement Phase 3 from BUILD_SPEC.md. Add MediaPipe HandLandmarker (VIDEO). Anchor a 3D RING to the ring
finger (landmarks 13→14) and BRACELET/WATCH to the wrist (landmark 0, oriented along the forearm 9→0),
using the engine + mapping/smoothing from earlier phases. Add cylinder depth-only occluders along the
finger and wrist so the back of the band is hidden (real wrap). Add an MVP ring-sizing readout from
finger width with a recommended size band. Commit + PR.
```

## Prompt 4 — Realism + UX (Phase 4)
```
Implement Phase 4 from BUILD_SPEC.md. Add camera-based light estimation (sample average luminance of the
video frame) and map it to envMapIntensity/exposure so reflections adapt to the room. Add snapshot +
share (compose video + 3D canvas to a PNG download). Add a "try with a photo" fallback (upload/take a
photo, run detection on the still). Polish the Arabic RTL UI. Commit + PR.
```

## Prompt 5 — Real catalog assets (Phase 5)
```
Implement Phase 5 from BUILD_SPEC.md. Add GLTFLoader support so real CAD/3D models (glTF/GLB) can be
loaded per SKU, with the parametric models as fallback. Define a model spec: scale convention in
millimetres, origin/anchor convention per category (ring/necklace/earring/bracelet), and SKU-based file
naming. Document the asset pipeline in docs/ASSETS.md. Commit + PR.
```

## Prompt 6 — Shopify Theme App Extension (Phase 6)
```
Implement Phase 6 from BUILD_SPEC.md. Create a Shopify Theme App Extension (app block) under /extension
that embeds the try-on on the product page with a "Try virtually" button — no theme code edits required.
Read the product's media/metafields to pick the model/category. Add merchant settings (map product →
model/category and anchor offsets). Scaffold a minimal Remix app only for settings + Shopify managed
pricing (billing); the AR stays fully client-side. Document install/test steps. Commit + PR.
```

## Prompt 7 — Store-platform data integration (Phase 7)
```
Implement Phase 7 from BUILD_SPEC.md. Do NOT integrate any ERP. Integrate with the STORE PLATFORM,
Shopify first, with a pluggable adapter for future platforms. Build a StoreAdapter interface
{ getProduct(id), getPrice(id), getModel(id) } and a ShopifyAdapter that reads product, variants, price,
and jewelar.* metafields (category, model_url, karat, weight_g, making_charge, stone_value, optional
gold_rate_per_g). Price display defaults to the store's variant price; if gold_rate_per_g exists, optionally
recompute weight_g*gold_rate_per_g*karatFactor + making_charge + stone_value (cache 1-5 min). Wire the live
price + correct 3D model/category into the try-on UI. Add mock fixtures so it runs without a live store, and
stub WooCommerceAdapter/SallaAdapter/ZidAdapter for the future. Commit + PR.
```

## Prompt 8 — Performance, analytics, QA (Phase 8)
```
Implement Phase 8 from BUILD_SPEC.md. Add an FPS guard that lowers model quality if the device is slow.
Add lightweight analytics events (open, try, snapshot, add-to-cart) with a pluggable sink. Create a QA
checklist (docs/QA.md) covering iOS Safari and Android Chrome, camera permissions, and the photo
fallback. Commit + PR.
```

---

### Tips
- If a task is large, tell Claude Code: "split into smaller PRs and continue."
- Review each PR's deployed Pages URL on your phone before merging.
- Keep app UI strings Arabic; keep code English.
