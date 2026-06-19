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
1. **Store-native data** — product info and live price pulled from the store platform (Shopify now,
   others later) via a pluggable adapter; an optional gold-rate metafield lets jewellers recompute price.
2. **Accurate ring sizing** from detected finger width ("find my size").
3. **Room-light-adaptive reflections** — gold/gem reflections adjust to the shopper's lighting.
4. **Arabic-first / Gulf-market UX**, sellable to any jewellery store (not tied to any ERP).

## Tech stack
- **Rendering:** Three.js (WebGL2) — PBR metals + transmissive gems + environment reflections (procedural studio env, no HDR asset).
- **Tracking:** MediaPipe Tasks Vision — FaceLandmarker (necklace/earrings), HandLandmarker (ring/bracelet/watch).
- **Occlusion:** depth-only occluder meshes (face/neck + finger/wrist) so jewellery behind the body is correctly hidden.
- **Packaging:** Shopify Theme App Extension (app block on product page).

## Run locally
Requires Node 20+.

```bash
npm install     # install dependencies
npm run dev     # start the Vite dev server (prints a localhost URL)
npm run build   # type-check + production build into dist/
npm run preview # serve the production build locally
npm run lint    # ESLint
```

Open the printed dev URL — the orbit viewer shows the PBR jewellery engine:
pick a piece (ring / pendant / earring), metal (yellow / white / rose gold),
gem (diamond / ruby / sapphire / emerald), and drag the lighting slider. Drag
on the canvas to orbit; a moving light makes the gems sparkle.

## Deploy (GitHub Pages, automatic)
A GitHub Actions workflow (`.github/workflows/deploy.yml`) builds the app and
deploys it to **GitHub Pages on every push to `main`**.

One-time setup: in the repo settings → **Pages**, set **Source = GitHub Actions**.
After that, every push to `main` publishes to:

```
https://yousifco.github.io/jewelar/
```

The Vite `base` is set to `/jewelar/` (overridable via the `BASE_PATH` env var)
so assets resolve correctly under the project-site sub-path.

## Build (browser-only, via Claude Code)
1. Open **claude.ai/code**, connect this repo (`yousifco/jewelar`).
2. Paste the prompts from `PROMPTS.md` in order. Each phase is a separate task.
3. Deploy is automated to GitHub Pages (set up in Phase 0). Every push → live HTTPS URL.

## Repo layout
```
/                Vite + TypeScript app (index.html, vite.config.ts, …)
/src/engine      PBR render engine (materials, parametric models, viewer)
/src/tracking    MediaPipe face/hand tracking (later phases)
/src/occlusion   depth-only occluder meshes (later phases)
/src/ui          UI controls
/extension       Shopify theme app extension (later phase)
/seed            reference prototypes (3D engine + AR tracking) — quality guidance
BUILD_SPEC.md    full technical specification
PROMPTS.md       copy-paste tasks for Claude Code on the web
```

## Docs
- **`BUILD_SPEC.md`** — full technical spec, phases, acceptance criteria.
- **`PROMPTS.md`** — ready-to-paste Claude Code tasks, phase by phase.
- **`/seed`** — working prototypes (open over HTTPS or locally on a computer) showing the target quality.
