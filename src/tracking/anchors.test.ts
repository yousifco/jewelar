import { describe, expect, it } from 'vitest';
import { makeCoverMapper, type Landmark, type Vec2 } from './mapping';
import {
  earringAnchor,
  earringVisible,
  necklaceAnchor,
  occluderFrontZ,
  type AnchorIndices,
} from './anchors';

/**
 * These tests simulate MediaPipe output for the four head poses the user cares
 * about (forward, turn-left, turn-right, look-down) and assert the anchoring
 * invariants — without needing a camera:
 *   - the necklace is driven by the shoulders and does NOT move when only the
 *     head turns;
 *   - each earring stays on its ear, and the FAR ear's earring is occluded when
 *     the head turns away, while facing forward both earrings are visible.
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

// Face landmarks per pose. Only the indices the anchoring reads are set:
// chin (152) and the ear clusters (right: 234/227/137, left: 454/447/366).
function facePose(opts: {
  earRX: number;
  earLX: number;
  earY: number;
  earRZ: number;
  earLZ: number;
  chinY: number;
}): Landmark[] {
  const { earRX, earLX, earY, earRZ, earLZ, chinY } = opts;
  return lmArray({
    152: { x: 0.5, y: chinY },
    234: { x: earRX, y: earY, z: earRZ },
    227: { x: earRX, y: earY - 0.02, z: earRZ },
    137: { x: earRX + 0.01, y: earY + 0.02, z: earRZ },
    454: { x: earLX, y: earY, z: earLZ },
    447: { x: earLX, y: earY - 0.02, z: earLZ },
    366: { x: earLX - 0.01, y: earY + 0.02, z: earLZ },
  });
}

// Helper mirroring FaceTryOn: ear centroids, fw, relDepth, anchors.
function compute(face: Landmark[], pose: Landmark[] | null) {
  const earR = avg(face, [234, 227, 137]);
  const earL = avg(face, [454, 447, 366]);
  const earRZ = avgZ(face, [234, 227, 137]);
  const earLZ = avgZ(face, [454, 447, 366]);
  const fw = Math.hypot(earR.x - earL.x, earR.y - earL.y) || 1;
  const earMidX = (earR.x + earL.x) / 2;
  const chin = P(face[152]);
  const neck = necklaceAnchor(pose, P, IDX, fw, earMidX, chin, face[152].y);
  const dz = earRZ - earLZ;
  const eR = earringAnchor(earR, +dz, fw, +1);
  const eL = earringAnchor(earL, -dz, fw, -1);
  return { fw, earR, earL, earMidX, neck, eR, eL };
}
function avg(face: Landmark[], ids: number[]): Vec2 {
  let x = 0;
  let y = 0;
  for (const i of ids) {
    const p = P(face[i]);
    x += p.x;
    y += p.y;
  }
  return { x: x / ids.length, y: y / ids.length };
}
function avgZ(face: Landmark[], ids: number[]): number {
  return ids.reduce((s, i) => s + face[i].z, 0) / ids.length;
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

  it('falls back to a face anchor when shoulders are missing/above the chin', () => {
    expect(compute(FORWARD, null).neck.source).toBe('face');
    // Shoulders above the chin (invalid) → fallback too.
    const bad = poseArray({ x: 0.6, y: 0.3 }, { x: 0.4, y: 0.3 });
    expect(compute(FORWARD, bad).neck.source).toBe('face');
  });
});

describe('earrings stay on the ears with correct occlusion', () => {
  it('forward: both earrings near their ear X and BOTH visible', () => {
    const c = compute(FORWARD, SHOULDERS());
    // Each earring sits at its ear (within the small outward nudge).
    expect(Math.abs(c.eR.x - c.earR.x)).toBeLessThan(c.fw * 0.1);
    expect(Math.abs(c.eL.x - c.earL.x)).toBeLessThan(c.fw * 0.1);
    expect(earringVisible(c.eR, c.earMidX, c.fw)).toBe(true);
    expect(earringVisible(c.eL, c.earMidX, c.fw)).toBe(true);
  });

  it('turn right: far (right) earring hidden, near (left) visible', () => {
    const c = compute(TURN_RIGHT, SHOULDERS());
    expect(earringVisible(c.eR, c.earMidX, c.fw)).toBe(false);
    expect(earringVisible(c.eL, c.earMidX, c.fw)).toBe(true);
  });

  it('turn left: far (left) earring hidden, near (right) visible', () => {
    const c = compute(TURN_LEFT, SHOULDERS());
    expect(earringVisible(c.eL, c.earMidX, c.fw)).toBe(false);
    expect(earringVisible(c.eR, c.earMidX, c.fw)).toBe(true);
  });

  it('look down: both earrings visible (symmetric depth)', () => {
    const c = compute(LOOK_DOWN, SHOULDERS());
    expect(earringVisible(c.eR, c.earMidX, c.fw)).toBe(true);
    expect(earringVisible(c.eL, c.earMidX, c.fw)).toBe(true);
  });

  it('earrings hang BELOW the lobe (drop dangles down)', () => {
    const c = compute(FORWARD, SHOULDERS());
    // y-up world: earring group origin is below the ear centroid.
    expect(c.eR.y).toBeLessThan(c.earR.y);
    expect(c.eL.y).toBeLessThan(c.earL.y);
  });
});

describe('occluder geometry sanity', () => {
  it('front surface is largest at head centre, vanishes past the rim', () => {
    const fw = 100;
    expect(occluderFrontZ(0, 0, fw)).toBeGreaterThan(occluderFrontZ(40, 0, fw));
    expect(occluderFrontZ(1000, 0, fw)).toBe(-Infinity);
  });
});
