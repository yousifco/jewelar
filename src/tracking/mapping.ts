/**
 * Cover-fit mapping + EMA smoothing helpers (BUILD_SPEC §4).
 *
 * Note on the selfie mirror: instead of mirroring X in the maths (the seed's
 * `screenX = W - …`), the try-on CSS-mirrors BOTH the video and the 3D overlay
 * canvas together (`transform: scaleX(-1)`). That is visually equivalent but
 * keeps all 3D maths — including MediaPipe's facial transformation matrix — in
 * the native, un-mirrored camera space, which avoids handedness/sign bugs when
 * orienting 3D jewellery. So this mapper does NOT mirror X; it only converts a
 * normalised landmark to an un-mirrored, cover-fit, **y-up** world pixel.
 */

export interface Landmark {
  x: number;
  y: number;
  z: number;
  /** Pose landmarks carry a visibility score (0..1); face landmarks don't. */
  visibility?: number;
}

export interface Vec2 {
  x: number;
  y: number;
}

/**
 * Build a mapper from normalised landmark coords (0..1, y-down) to world pixels
 * matching a CSS `object-fit: cover` video, in a **y-up** coordinate space
 * (y=0 at the bottom) so it lines up with the engine's +Y-up models and the
 * y-up orthographic camera.
 */
export function makeCoverMapper(
  videoW: number,
  videoH: number,
  viewW: number,
  viewH: number,
): (lm: Landmark) => Vec2 {
  const scale = Math.max(viewW / videoW, viewH / videoH);
  const dw = videoW * scale;
  const dh = videoH * scale;
  const dx = (viewW - dw) / 2;
  const dy = (viewH - dh) / 2;
  return (lm) => ({ x: dx + lm.x * dw, y: viewH - (dy + lm.y * dh) });
}

export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export function normalize2(x: number, y: number): Vec2 {
  const l = Math.hypot(x, y) || 1;
  return { x: x / l, y: y / l };
}

/**
 * Exponential moving average over a landmark array to cut jitter (factor ~0.5;
 * BUILD_SPEC §4 — upgrade to One-Euro for production). Returns a fresh array and
 * is safe to feed its own output back in as `prev`.
 */
export function smoothLandmarks(
  current: Landmark[],
  prev: Landmark[] | null,
  factor = 0.5,
): Landmark[] {
  if (!prev || prev.length !== current.length) {
    return current.map((p) => ({ x: p.x, y: p.y, z: p.z }));
  }
  return current.map((p, i) => ({
    x: lerp(prev[i].x, p.x, factor),
    y: lerp(prev[i].y, p.y, factor),
    z: lerp(prev[i].z, p.z, factor),
    visibility: p.visibility,
  }));
}

/**
 * Key MediaPipe FaceLandmarker indices used for anchoring (BUILD_SPEC §4).
 */
export const FACE = {
  earR: 234, // person's right ear region
  earL: 454, // person's left ear region
  chin: 152,
  forehead: 10,
  noseTip: 1,
} as const;

/**
 * Per-ear anchor at the EARLOBE: the lowest points of each ear's face-oval
 * contour (near the jaw angle), averaged. These sit at lobe height — unlike the
 * upper/outer silhouette points (234/454) which land up at the cheek/temple.
 *   - Right ear lobe: 132 + 58 (lowest right-ear contour points).
 *   - Left ear lobe:  361 + 288 (lowest left-ear contour points).
 * Verified left/right against the canonical 468 mesh face-oval ordering: 132/58
 * are on the person's right, 361/288 on the left.
 */
export const EAR_R = [132, 58] as const;
export const EAR_L = [361, 288] as const;

/** MediaPipe PoseLandmarker (BlazePose) shoulder indices for the necklace. */
export const POSE = {
  leftShoulder: 11,
  rightShoulder: 12,
} as const;

/** Average of mapped landmark positions over the given indices. */
export function avgScreen(
  lm: Landmark[],
  P: (l: Landmark) => Vec2,
  indices: readonly number[],
): Vec2 {
  let x = 0;
  let y = 0;
  for (const i of indices) {
    const p = P(lm[i]);
    x += p.x;
    y += p.y;
  }
  return { x: x / indices.length, y: y / indices.length };
}

/** Average of the raw (normalised) Z over the given indices. */
export function avgZ(lm: Landmark[], indices: readonly number[]): number {
  let z = 0;
  for (const i of indices) z += lm[i].z;
  return z / indices.length;
}
