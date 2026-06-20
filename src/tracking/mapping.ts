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
  }));
}

/** Key MediaPipe FaceLandmarker indices used for anchoring (BUILD_SPEC §4). */
export const FACE = {
  // Tragus / front-of-ear anchors — each tracks its own ear as the head turns.
  earR: 234,
  earL: 454,
  chin: 152,
  forehead: 10,
  noseTip: 1,
} as const;

/** MediaPipe PoseLandmarker (BlazePose) shoulder indices for the necklace. */
export const POSE = {
  leftShoulder: 11,
  rightShoulder: 12,
} as const;
