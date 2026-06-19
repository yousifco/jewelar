# JewelAR — Build Specification

> Single source of truth for building the product. Phases are sequential; each has acceptance
> criteria (AC). The app UI must be **Arabic-first (RTL)**; code, comments, and this spec are English.

## 1. Product summary
On-device WebAR jewellery try-on for gold/jewellery, embeddable in Shopify. Runs in the
shopper's browser. No server-side inference or image storage. Owned product, no recurring SDK fees.

## 2. Hard constraints
- **On-device only.** No server does tracking/rendering. No per-try-on cost.
- **Static deploy.** Output is static files on GitHub Pages / Cloudflare Pages (HTTPS).
- **Open-source libs only:** MediaPipe Tasks Vision (Apache-2.0), Three.js (MIT).
- **Privacy:** camera frames never leave the device; no upload, no storage of shopper imagery.
- **Performance targets:** 60 fps desktop, ≥30 fps modern mobile (iPhone 12+/mid Android).

## 3. Tech stack
- Build: **Vite + TypeScript**. Output static. ESLint + Prettier.
- Rendering: **Three.js r160+** (WebGL2).
  - Metals: `MeshStandardMaterial` `{ metalness:1, roughness:0.12–0.18, envMapIntensity:~1.5 }`.
    Gold colors: yellow `#FFC864`, white `#E9E7DF`, rose `#F2B39A`.
  - Gems: `MeshPhysicalMaterial` `{ transmission:1, ior:2.42, roughness:0, thickness, clearcoat:1, attenuationColor }`. Diamonds high transmission; colored stones lower transmission + colored attenuation.
  - Environment reflections: `PMREMGenerator.fromScene(new RoomEnvironment())` — procedural, **no HDR file**.
  - Tone mapping `ACESFilmic`, `outputColorSpace = SRGB`.
- Tracking: **MediaPipe Tasks Vision 0.10.x** (`@mediapipe/tasks-vision`), `runningMode:"VIDEO"`.
  - `FaceLandmarker` (numFaces 1): 468 landmarks + `facialTransformationMatrixes` (4x4 head pose) + `outputFacialTransformationMatrixes:true`. Use the matrix to place a 3D head anchor for necklace/earrings.
  - `HandLandmarker` (numHands 1–2): 21 landmarks (+`worldLandmarks`) for ring/bracelet/watch.
  - Model assets (float16, from `storage.googleapis.com/mediapipe-models/...`):
    `face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
    `hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`.
  - WASM fileset: `FilesetResolver.forVisionTasks(".../tasks-vision@0.10.x/wasm")`.

## 4. Alignment & math (validated in prototypes — reuse)
- **Selfie mirror:** display video `scaleX(-1)`. Draw layer NOT mirrored; convert each landmark to
  screen with **cover-fit** mapping, then mirror X: `screenX = W - (dx + lm.x*dw)`, `screenY = dy + lm.y*dh`,
  where `scale=max(W/sw,H/sh)`, `dw=sw*scale`, `dh=sh*scale`, `dx=(W-dw)/2`, `dy=(H-dh)/2`.
- **Smoothing:** EMA factor ~0.5 on landmarks to cut jitter; upgrade to **One-Euro filter** for production.
- **Key indices** — Face: ears `234`/`454`, chin `152`, forehead `10`. Hand: wrist `0`, MCPs `5/9/13/17`, ring finger `13`(MCP)/`14`(PIP).

## 5. Occlusion (the "worn" look — most important)
2D overlay always looks pasted. Use **depth-only occluders** in the 3D scene:
- Build invisible meshes (`colorWrite:false`, `depthWrite:true`) shaped like the body part.
- **Face/neck:** transform the canonical face mesh by `facialTransformationMatrix`; extend a neck/jaw
  occluder so the back of a necklace and the far earring are hidden.
- **Hand:** cylinder occluders fitted along finger segments (MCP→PIP) and the wrist (from landmarks),
  so the back arc of a ring band / bangle is hidden → real wrap.
- Render order: occluders first (depth only), then jewellery.

## 6. True-size (ring sizing)
- Estimate finger width in mm from landmark distances calibrated against a reference (e.g. detected
  card or known camera intrinsics approximation). MVP: relative sizing slider + recommended size band.
- AC target: recommended ring size within ±0.5 size once calibrated.

## 7. Phases & acceptance criteria
- **Phase 0 — Scaffold + deploy.** Vite+TS, Arabic RTL shell, GitHub Pages Action (deploy on push).
  AC: live HTTPS URL renders a Three.js hello scene.
- **Phase 1 — PBR engine.** Parametric ring/pendant/earring; gold types; gem types; env reflections;
  orbit viewer; light slider. AC: photoreal gold + gem sparkle, perf targets met. (See `/seed` engine.)
- **Phase 2 — Face try-on.** Necklace + earrings anchored to face matrix; face/neck occluder; mirror.
  AC: tracks head smoothly, correct occlusion, looks worn.
- **Phase 3 — Hand try-on.** Ring/bracelet/watch on hand landmarks; finger/wrist occluders; sizing MVP.
  AC: ring wraps finger with occlusion; bangle sits at wrist; size recommendation shown.
- **Phase 4 — Realism + UX.** Camera light estimation → adaptive `envMapIntensity`/exposure; snapshot &
  share; "try with a photo" fallback; graceful camera-permission handling.
- **Phase 5 — Real catalog assets.** `GLTFLoader` for CAD/3D models; parametric fallback; asset pipeline
  doc (model spec, scale convention in mm, naming by SKU).
- **Phase 6 — Shopify packaging.** Theme App Extension (app block) on product template; merchant settings
  (map product → model/category, anchor offsets); billing via Shopify managed pricing. Keep AR client-side.
- **Phase 7 — Store-platform data integration.** Pull product data + price from the **store platform**,
  not from any ERP. Use a **pluggable data adapter** so platforms can be added later.
  - **ShopifyAdapter (now):** read product, variants, price, and metafields. Suggested metafields
    (namespace `jewelar`): `category` (ring/necklace/...), `model_url` (glTF/GLB), `karat`, `weight_g`,
    `making_charge`, `stone_value`, and optional `gold_rate_per_g`.
  - **Price display:** default = the store's own variant price. If `gold_rate_per_g` is present, optionally
    recompute: `weight_g * gold_rate_per_g * karatFactor + making_charge + stone_value`. Cache rate 1–5 min.
  - **Adapter interface** `StoreAdapter { getProduct(id), getPrice(id), getModel(id) }` with future
    `WooCommerceAdapter`, `SallaAdapter`, `ZidAdapter`, `CustomRestAdapter`. No ERP coupling anywhere.
    Provide mock fixtures so it runs without a live store.
- **Phase 8 — Perf + analytics + QA.** FPS guard / model-quality fallback; events (open, try, snapshot,
  add-to-cart); QA matrix iOS Safari + Android Chrome.

## 8. Shopify packaging detail
- Deliver as **Theme App Extension** (app block) → merchants add a "Try-On" block to the product page,
  **no theme code edits**.
- Optional minimal **Remix app**: only for settings + billing. The try-on runs fully client-side; avoid
  server inference to keep recurring cost ~zero. Use Shopify App Proxy only if a settings read is needed.
- Distribution: custom/private app for the existing client base, or a public listing later.

## 9. Non-goals (initial)
- No server-side rendering/inference. No storing shopper images. No native app (web only).

## 10. References
- `/seed/engine.html` — PBR rendering quality target.
- `/seed/ar-tryon.html` — MediaPipe face+hand tracking + mapping/smoothing reference (2D; replace its 2D
  draw with the 3D engine + occluders in Phases 2–3).
