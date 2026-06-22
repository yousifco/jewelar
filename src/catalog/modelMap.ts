/**
 * Per-product 3D model resolution for the pilot — by Shopify product *handle*,
 * no hardcoded handle→URL list.
 *
 * Convention: a product's model lives at `${BASE}models/<handle>.glb`
 * (e.g. `/jewelar/models/<handle>.glb` on GitHub Pages). If that file loads it's
 * used; if it 404s the caller falls back to the procedural piece for that type.
 *
 * A single `${BASE}models/manifest.json` (fetched once, cached) supplies
 * per-model placement — `{ piece, scale, spinDeg }` — with per-piece defaults
 * for handles it doesn't list. `spinDeg` is the ring setting-orientation spin
 * about the finger axis; `scale` multiplies the auto finger-fit.
 */

// import.meta.env.BASE_URL is "/jewelar/" in prod, "/" in dev (trailing slash).
const BASE = import.meta.env.BASE_URL;

export type PieceType = 'ring' | 'bracelet' | 'necklace' | 'earrings';

export interface ModelSettings {
  piece: PieceType;
  /** Multiplies the auto finger-fit radius (1 = current working size). */
  scale: number;
  /** Spin about the finger axis (deg) to seat the setting on top of the finger. */
  spinDeg: number;
}

interface ManifestEntry {
  piece?: PieceType;
  scale?: number;
  spinDeg?: number;
}
interface Manifest {
  defaults?: Partial<Record<PieceType, { scale?: number; spinDeg?: number }>>;
  handles?: Record<string, ManifestEntry>;
}

// Built-in fallbacks if the manifest is missing a piece/handle entirely.
const PIECE_DEFAULTS: Record<PieceType, { scale: number; spinDeg: number }> = {
  ring: { scale: 1, spinDeg: 180 },
  bracelet: { scale: 1, spinDeg: 0 },
  necklace: { scale: 1, spinDeg: 0 },
  earrings: { scale: 1, spinDeg: 0 },
};

/** Convention URL for a handle's model, or null for an empty/unsafe handle. */
export function modelUrlForHandle(handle: string | null | undefined): string | null {
  if (!handle) return null;
  // Only plain product-handle characters (blocks path traversal / odd input).
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(handle)) return null;
  return `${BASE}models/${handle}.glb`;
}

let manifestPromise: Promise<Manifest> | null = null;
/** Fetch (once) and cache the model manifest; tolerant of a missing file. */
function loadManifest(): Promise<Manifest> {
  if (!manifestPromise) {
    manifestPromise = fetch(`${BASE}models/manifest.json`)
      .then((r) => (r.ok ? (r.json() as Promise<Manifest>) : {}))
      .catch(() => ({}));
  }
  return manifestPromise;
}

/**
 * Resolve placement settings for a handle: the manifest's per-handle entry if
 * present, otherwise the per-piece defaults (using `pieceHint`, e.g. from the
 * ?piece= deep-link, when the handle isn't listed).
 */
export async function modelSettingsForHandle(
  handle: string | null | undefined,
  pieceHint: PieceType,
): Promise<ModelSettings> {
  const manifest = await loadManifest();
  const entry = (handle && manifest.handles?.[handle]) || null;
  const piece = entry?.piece ?? pieceHint;
  const fallback = PIECE_DEFAULTS[piece] ?? PIECE_DEFAULTS.ring;
  const pieceDefault = manifest.defaults?.[piece] ?? {};
  return {
    piece,
    scale: entry?.scale ?? pieceDefault.scale ?? fallback.scale,
    spinDeg: entry?.spinDeg ?? pieceDefault.spinDeg ?? fallback.spinDeg,
  };
}
