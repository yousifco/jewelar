/**
 * Per-SKU 3D models — maps a Shopify product `handle` to an optional 3D model
 * URL (.glb / .gltf). When a handle is listed here, the viewer / try-on loads
 * that model instead of the built-in procedural piece; otherwise it falls back
 * to the procedural piece for that type.
 *
 * ── How to add a real model for a SKU ───────────────────────────────────────
 * 1) Put the .glb under /public/models/  (served at `${BASE}models/<file>.glb`),
 *    or host it on a CDN.
 * 2) Add an entry: '<product-handle>': '<url>'. Authoring convention: model in
 *    millimetres, Y-up, facing +Z, origin at the natural anchor point (band
 *    centre for a ring, bail for a necklace, hook for an earring). The loader
 *    re-centres + scales to fit, but matching this keeps placement accurate.
 *
 * Examples (uncomment + replace with real URLs):
 *   'tryon-test-ring':     `${import.meta.env.BASE_URL}models/ring-aurora.glb`,
 *   'tryon-test-necklace': 'https://cdn.myshop.com/models/necklace-luna.glb',
 *   'tryon-test-earring':  'https://cdn.myshop.com/models/earring-iris.glb',
 */
export const MODEL_BY_HANDLE: Record<string, string> = {
  // (empty for now — every SKU uses its procedural piece)
};

/** Resolve a product handle to a model URL, or null to use the procedural piece. */
export function modelUrlForHandle(handle: string | null | undefined): string | null {
  if (!handle) return null;
  return MODEL_BY_HANDLE[handle] ?? null;
}
