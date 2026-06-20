import { describe, expect, it } from 'vitest';
import { EAR_L, EAR_R, makeCoverMapper, type Landmark, type Vec2 } from './mapping';
import {
  earringAnchor,
  earringOpacity,
  EAR_FADE_HI,
  EAR_FADE_LO,
  necklaceAnchor,
  type AnchorIndices,
} from './anchors';

/**
 * These tests simulate MediaPipe output for the four head poses the user cares
 * about (forward, turn-left, turn-right, look-down) and assert the anchoring
 * invariants — without needing a camera:
 *   - the necklace is driven by the shoulders and does NOT move when only the
 *     head turns;
 *   - each earring sits on its ear facing forward, hangs below the lobe, and
 *     fades out once the head yaw passes the threshold.
 */

const VIEW_W = 600;
const VIEW_H = 800;
// Use a 1:1 "video" so the cover mapper is a plain flip-to-y-up (easy to reason).
const P = makeCoverMapper(VIEW_W, VIEW_H, VIEW_W, VIEW_H);

const IDX: AnchorIndices = { leftShoulder: 11, rightShoulder: 12, chin: 152 };

/** Build a sparse landmark array; unset entries default to centre. */
function lmArray(set: Record<number, Partial<Landmark>>, size = 468): Landmark[] {
  const arr: Landmark[] = Array.from({ length: size }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  for (const [i, v] of Object.entries(set)) {
    arr[+i] = { x: 0.5, y: 0.5, z: 0, ...v };
  }
  return arr;
}

/** Build a pose array with the two shoulders set. */
function poseArray(left: Partial<Landmark>, right: Partial<Landmark>): Landmark[] {
  const arr: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0 }));
  arr[11] = { x: 0.5, y: 0.9, z: 0, visibility: 0.99, ...left };
  arr[12] = { x: 0.5, y: 0.9, z: 0, visibility: 0.99, ...right };
  return arr;
}

// Shoulders are the SAME body position in every head pose (the body doesn't
// move when the head turns). Left shoulder is on the person's left.
const SHOULDERS = () => poseArray({ x: 0.74, y: 0.95 }, { x: 0.26, y: 0.95 });

// Face landmarks per pose. Set chin (152) and every index in each ear cluster
// (EAR_R / EAR_L) to that ear's position, so the test follows the real cluster
// definition rather than hard-coding indices.
function facePose(opts: {
  earRX: number;
  earLX: number;
  earY: number;
  earRZ: number;
  earLZ: number;
  chinY: number;
}): Landmark[] {
  const { earRX, earLX, earY, earRZ, earLZ, chinY } = opts;
  const set: Record<number, Partial<Landmark>> = { 152: { x: 0.5, y: chinY } };
  for (const i of EAR_R) set[i] = { x: earRX, y: earY, z: earRZ };
  for (const i of EAR_L) set[i] = { x: earLX, y: earY, z: earLZ };
  return lmArray(set);
}

// Helper mirroring FaceTryOn: ear centroids, fw, anchors.
function compute(face: Landmark[], pose: Landmark[] | null) {
  const earR = avg(face, EAR_R);
  const earL = avg(face, EAR_L);
  const fw = Math.hypot(earR.x - earL.x, earR.y - earL.y) || 1;
  const earMidX = (earR.x + earL.x) / 2;
  const chin = P(face[152]);
  const neck = necklaceAnchor(pose, P, IDX, fw, earMidX, chin, face[152].y);
  const eR = earringAnchor(earR, fw, +1);
  const eL = earringAnchor(earL, fw, -1);
  return { fw, earR, earL, earMidX, neck, eR, eL };
}
function avg(face: Landmark[], ids: readonly number[]): Vec2 {
  let x = 0;
  let y = 0;
  for (const i of ids) {
    const p = P(face[i]);
    x += p.x;
    y += p.y;
  }
  return { x: x / ids.length, y: y / ids.length };
}

const FORWARD = facePose({
  earRX: 0.32,
  earLX: 0.68,
  earY: 0.42,
  earRZ: 0.03,
  earLZ: 0.03,
  chinY: 0.74,
});
// Head turned to the person's RIGHT: their LEFT ear swings toward the camera
// (nearer, more negative Z) and the RIGHT ear goes back (farther, +Z) and its X
// moves toward centre.
const TURN_RIGHT = facePose({
  earRX: 0.46,
  earLX: 0.72,
  earY: 0.42,
  earRZ: 0.1,
  earLZ: -0.05,
  chinY: 0.74,
});
const TURN_LEFT = facePose({
  earRX: 0.28,
  earLX: 0.54,
  earY: 0.42,
  earRZ: -0.05,
  earLZ: 0.1,
  chinY: 0.74,
});
// Looking down: ears + chin move down together, depth stays symmetric.
const LOOK_DOWN = facePose({
  earRX: 0.32,
  earLX: 0.68,
  earY: 0.55,
  earRZ: 0.03,
  earLZ: 0.03,
  chinY: 0.86,
});

describe('necklace is body-driven and upright', () => {
  it('uses the pose (shoulders) when available', () => {
    expect(compute(FORWARD, SHOULDERS()).neck.source).toBe('pose');
  });

  it('does NOT move horizontally when the head turns (shoulders unchanged)', () => {
    const fwd = compute(FORWARD, SHOULDERS()).neck;
    const left = compute(TURN_LEFT, SHOULDERS()).neck;
    const right = compute(TURN_RIGHT, SHOULDERS()).neck;
    // Shoulder midpoint X is identical across poses → necklace X identical.
    expect(left.x).toBeCloseTo(fwd.x, 6);
    expect(right.x).toBeCloseTo(fwd.x, 6);
    expect(left.scale).toBeCloseTo(fwd.scale, 6);
  });

  it('barely moves when looking down (shoulders fixed)', () => {
    const fwd = compute(FORWARD, SHOULDERS()).neck;
    const down = compute(LOOK_DOWN, SHOULDERS()).neck;
    expect(down.x).toBeCloseTo(fwd.x, 6);
    expect(down.y).toBeCloseTo(fwd.y, 6);
  });

  it('width is ~60% of the shoulder span (rings the neck, not the shoulders)', () => {
    const pose = SHOULDERS();
    const a = P(pose[11]);
    const b = P(pose[12]);
    const span = Math.hypot(a.x - b.x, a.y - b.y);
    const neck = compute(FORWARD, pose).neck;
    // Chain width = 2·scale; expect ≈ 0.6·span (within 55–65%).
    const width = 2 * neck.scale;
    expect(width / span).toBeGreaterThan(0.55);
    expect(width / span).toBeLessThan(0.65);
  });

  it('falls back to a face anchor when shoulders are missing/above the chin', () => {
    expect(compute(FORWARD, null).neck.source).toBe('face');
    // Shoulders above the chin (invalid) → fallback too.
    const bad = poseArray({ x: 0.6, y: 0.3 }, { x: 0.4, y: 0.3 });
    expect(compute(FORWARD, bad).neck.source).toBe('face');
  });
});

describe('earrings sit on the ears and hang from the lobe', () => {
  it('each earring is at its ear X (within the small outward nudge)', () => {
    const c = compute(FORWARD, SHOULDERS());
    expect(Math.abs(c.eR.x - c.earR.x)).toBeLessThan(c.fw * 0.1);
    expect(Math.abs(c.eL.x - c.earL.x)).toBeLessThan(c.fw * 0.1);
  });

  it('earrings hang BELOW the lobe (drop dangles down)', () => {
    const c = compute(FORWARD, SHOULDERS());
    // y-up world: earring group origin is below the ear centroid.
    expect(c.eR.y).toBeLessThan(c.earR.y);
    expect(c.eL.y).toBeLessThan(c.earL.y);
  });

  it('earrings are placed in front (positive Z)', () => {
    const c = compute(FORWARD, SHOULDERS());
    expect(c.eR.z).toBeGreaterThan(0);
    expect(c.eL.z).toBeGreaterThan(0);
  });
});

describe('earrings fade out as the head turns', () => {
  it('fully visible facing forward, fully hidden past the threshold', () => {
    expect(earringOpacity(0)).toBe(1);
    expect(earringOpacity(EAR_FADE_LO - 0.01)).toBe(1);
    expect(earringOpacity(EAR_FADE_HI + 0.01)).toBe(0);
  });

  it('fades monotonically through the transition band', () => {
    const mid = (EAR_FADE_LO + EAR_FADE_HI) / 2;
    const o = earringOpacity(mid);
    expect(o).toBeGreaterThan(0);
    expect(o).toBeLessThan(1);
    // Larger yaw → lower opacity.
    expect(earringOpacity(mid + 0.02)).toBeLessThan(o);
  });

  it('the ~25° threshold falls inside the fade band', () => {
    const deg25 = (25 * Math.PI) / 180;
    expect(deg25).toBeGreaterThanOrEqual(EAR_FADE_LO);
    expect(deg25).toBeLessThanOrEqual(EAR_FADE_HI);
  });
});
