# Catalog 3D models

Models are resolved **by Shopify product handle**, no hardcoded list.

## Convention

A product's model lives at:

- dev: `/models/<handle>.glb`
- GitHub Pages: `/jewelar/models/<handle>.glb`

So a product with handle `tryon-test-ring` is served from
`tryon-test-ring.glb` in this folder. If the file loads it's used; if it 404s,
the app falls back to the built-in procedural piece for that type.

## manifest.json

`manifest.json` (fetched once) supplies per-model placement:

```json
{
  "defaults": { "ring": { "scale": 1.0, "spinDeg": 180 }, ... },
  "handles":  { "<handle>": { "piece": "ring", "scale": 1.0, "spinDeg": 180 } }
}
```

- `piece` — ring | bracelet | necklace | earrings.
- `scale` — multiplies the auto finger-fit radius (hand try-on).
- `spinDeg` — spin about the finger axis to seat the setting on top of the
  finger (180° = back-of-hand). The hand-roll tracking composes on top of this.

Handles not listed in `handles` use the per-piece `defaults` (piece type comes
from the `?piece=` deep-link).

## Adding a product

1. Export the `.glb` (Y-up; the hand try-on auto-detects the hole axis and
   scales to the finger). Name it `<handle>.glb` and drop it here.
2. If placement needs tuning, add a `handles` entry with `scale` / `spinDeg`.
3. Test: `?piece=ring&handle=<handle>` — the console/overlay logs the resolved
   URL and whether the GLB or the procedural fallback was used.
