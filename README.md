# JewelAR — On-Device Jewellery Virtual Try-On

Arabic-first WebAR virtual try-on for gold & jewellery, built to run **entirely on the
shopper's device** (no servers, no per-try-on cost) and to embed into **Shopify** stores.

Owned product — no recurring third-party SDK fees. Built with open-source libraries only.

## Why this architecture
- **All compute on-device** (the shopper's browser does tracking + rendering) → zero GPU/server cost.
- **Static hosting** (GitHub Pages / Cloudflare Pages, free + HTTPS).
- **Open-source only:** MediaPipe Tasks Vision (Apache-2.0) for tracking, Three.js (MIT) for PBR rendering.
- **Hybrid 3D assets:** parametric/3D models for hero pieces, photo-based try-on for the long tail.

## Differentiators (vs existing try-on apps)
1. **ERP integration** — live gold rate + inventory + real price shown during try-on (AMARSOFT ERP).
2. **Accurate ring sizing** from detected finger width ("find my size").
3. **Room-light-adaptive reflections** — gold/gem reflections adjust to the shopper's lighting.
4. **Arabic-first / Gulf-market UX** + ready distribution to existing client base.

## Tech stack
- **Rendering:** Three.js (WebGL2) — PBR metals + transmissive gems + environment reflections (procedural studio env, no HDR asset).
- **Tracking:** MediaPipe Tasks Vision — FaceLandmarker (necklace/earrings), HandLandmarker (ring/bracelet/watch).
- **Occlusion:** depth-only occluder meshes (face/neck + finger/wrist) so jewellery behind the body is correctly hidden.
- **Packaging:** Shopify Theme App Extension (app block on product page).

## How to build (browser-only, no local install)
1. Open **claude.ai/code**, connect this repo (`yousifco/jewelar`).
2. Paste the prompts from `PROMPTS.md` in order. Each phase is a separate task.
3. Deploy is automated to GitHub Pages (set up in Phase 0). Every push → live HTTPS URL.

## Repo layout (target)
```
/            Vite + TypeScript app
/src         engine (render), tracking, occlusion, ui
/public      static assets
/extension   Shopify theme app extension (later phase)
/seed        reference prototypes (3D engine + AR tracking) — built in chat, use as guidance
BUILD_SPEC.md  full technical specification
PROMPTS.md     copy-paste tasks for Claude Code on the web
```

## Docs
- **`BUILD_SPEC.md`** — full technical spec, phases, acceptance criteria.
- **`PROMPTS.md`** — ready-to-paste Claude Code tasks, phase by phase.
- **`/seed`** — working prototypes (open over HTTPS or locally on a computer) showing the target quality.
