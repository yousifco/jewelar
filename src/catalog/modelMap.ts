/**
 * Per-SKU 3D models — maps a Shopify product `handle` to an optional 3D model
 * URL (.glb / .gltf). When a handle is listed here, the viewer / try-on loads
 * that model instead of the built-in procedural piece; otherwise it falls back
 * to the procedural piece for that type.
 *
 * ── How to add a real model for a SKU ───────────────────────────────────────
 * 1) Put the .glb under /public/models/  (served at `${BASE}models/<file>.glb`,
 *    e.g. `/jewelar/models/ring1.glb` on GitHub Pages), or host it on a CDN.
 * 2) Add an entry: '<product-handle>': '<url>'. Authoring convention: model in
 *    millimetres, Y-up, facing +Z, origin at the natural anchor point (band
 *    centre for a ring, bail for a necklace, hook for an earring). The loader
 *    re-centres + scales to match the procedural piece, but matching this keeps
 *    placement accurate.
 * 3) Meshy / scan exports usually arrive with no real materials (plain grey).
 *    The viewer re-dresses them with OUR gold + diamond materials (respecting
 *    the المعدن / الحجر selectors). It auto-detects band-vs-stone by size, and
 *    logs every mesh name to the console — if the auto split is wrong, read the
 *    names from the console and tag them in MODEL_CONFIG_BY_HANDLE below.
 *
 * NOTE: ring/bracelet handles listed here open in the 3D VIEWER (so the
 * metal/stone selectors apply). Keep the handle list in index.html's redirect
 * (`VIEWER_MODEL_HANDLES`) in sync so the deep-link stays in the viewer instead
 * of redirecting to the AR mirror.
 */
export const MODEL_BY_HANDLE: Record<string, string> = {
  'tryon-test-ring': `${import.meta.env.BASE_URL}models/ring1.glb`,
};

/** Resolve a product handle to a model URL, or null to use the procedural piece. */
export function modelUrlForHandle(handle: string | null | undefined): string | null {
  if (!handle) return null;
  return MODEL_BY_HANDLE[handle] ?? null;
}

/**
 * Optional per-model part tagging for re-materialising imported meshes. When a
 * model's parts don't split cleanly by size, list mesh-name substrings (matched
 * case-insensitively) to force a part to GOLD (`metal`) or DIAMOND (`stone`).
 * Anything not listed falls back to the size heuristic. `rotation` (radians,
 * XYZ) can upright a model that wasn't authored Y-up / facing +Z.
 */
export interface ModelPartConfig {
  metal?: string[];
  stone?: string[];
  rotation?: [number, number, number];
}

export const MODEL_CONFIG_BY_HANDLE: Record<string, ModelPartConfig> = {
  // After loading ring1.glb, read the mesh names logged to the console and fill
  // this in if the auto band/stone split looks wrong, e.g.:
  // 'tryon-test-ring': { metal: ['band', 'shank'], stone: ['diamond', 'gem', 'stone'] },
};

/** Resolve a product handle to its part config, or null when none is defined. */
export function modelConfigForHandle(handle: string | null | undefined): ModelPartConfig | null {
  if (!handle) return null;
  return MODEL_CONFIG_BY_HANDLE[handle] ?? null;
}
