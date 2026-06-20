import { dist, type Landmark, type Vec2 } from './mapping';

/**
 * Pure anchoring maths for the face try-on (BUILD_SPEC §4–5), kept free of
 * Three.js so it can be unit-tested without a GPU/camera. FaceTryOn calls these
 * and copies the results onto the 3D groups.
 *
 * Coordinate space: y-up view pixels (the orthographic camera), +Z toward the
 * camera. All lengths are expressed as multiples of the face width `fw`.
 */

// ---- Tunables ----
export const EAR_FRONT_Z = 0.45; // earring Z facing forward — in front of the head occluder
export const EAR_DEPTH_GAIN = 4.5; // how hard a head turn pushes the far earring back in Z
export const EAR_SCALE = 0.14; // earring size (× fw)
export const EAR_LOBE_DROP = 0.03; // small drop below the ear centroid to the lobe (× fw)
export const EAR_OUT_NUDGE = 0.05; // outward nudge onto the ear edge (× fw)
export const HEAD_OCC = { rx: 0.6, ry: 0.82, rz: 0.55 }; // head-occluder ellipsoid radii (× fw)

// Necklace, relative to the shoulder span: width ≈ 60% of shoulder distance so
// it rings the neck/collarbone (not the shoulder tips), raised toward the neck
// base so the pendant rests on the UPPER chest.
const NECK_WIDTH_FRAC = 0.6; // chain width ÷ shoulder span (model spans X=±1)
const NECK_RAISE_FRAC = 0.12; // raise above shoulder midpoint, × span (toward the neck)

export interface NecklaceAnchor {
  x: number;
  y: number;
  z: number;
  scale: number;
  source: 'pose' | 'face';
}

export interface AnchorIndices {
  leftShoulder: number;
  rightShoulder: number;
  chin: number;
}

/**
 * Necklace anchor. Driven by the BODY (PoseLandmarker shoulders) so it does NOT
 * move when the head turns: the anchor X is the shoulder midpoint (independent
 * of the face), the width spans the shoulders, and it's kept upright by the
 * caller. The pose is accepted only when both shoulders are clearly below the
 * chin with a plausible span; otherwise we fall back to a face-based anchor that
 * uses the ear-midpoint X (more stable under yaw than the chin).
 *
 * @param earMidX  mapped X of the ear-cluster midpoint (for the fallback)
 * @param chin     mapped chin point
 * @param chinNormY raw normalised chin Y (for the below-the-chin test)
 */
export function necklaceAnchor(
  pose: Landmark[] | null,
  P: (l: Landmark) => Vec2,
  idx: AnchorIndices,
  fw: number,
  earMidX: number,
  chin: Vec2,
  chinNormY: number,
): NecklaceAnchor {
  const lS = pose?.[idx.leftShoulder];
  const rS = pose?.[idx.rightShoulder];
  const valid =
    !!lS &&
    !!rS &&
    (lS.visibility ?? 1) > 0.5 &&
    (rS.visibility ?? 1) > 0.5 &&
    lS.y > chinNormY + 0.06 && // shoulders clearly below the chin (y-down)
    rS.y > chinNormY + 0.06;

  if (valid) {
    const a = P(lS);
    const b = P(rS);
    const span = dist(a, b);
    if (span > fw * 1.1 && span < fw * 4.5) {
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      // Raise toward the neck base by a fixed fraction of the span (NOT the chin,
      // so head pitch/look-down doesn't move it). Width is ~60% of the shoulder
      // span: model endpoints at X=±1 ⇒ scale = (WIDTH_FRAC·span)/2.
      return {
        x: midX,
        y: midY + span * NECK_RAISE_FRAC,
        z: 0,
        scale: (span * NECK_WIDTH_FRAC) / 2,
        source: 'pose',
      };
    }
  }

  // Fallback (shoulders not usable): face-based, upright, ear-midpoint X. Width
  // ~ face width so it still rings the neck rather than the shoulders.
  return { x: earMidX, y: chin.y - fw * 0.5, z: 0, scale: fw * 0.55, source: 'face' };
}

export interface EarringAnchor {
  x: number;
  y: number;
  z: number;
  scale: number;
}

/**
 * Earring anchor. Pinned to the ear's cluster centroid, dropped straight DOWN
 * (screen-vertical) to the lobe. `relDepth` is this ear's mean Z minus the other
 * ear's: ≈0 facing forward (earring at EAR_FRONT_Z, in front of the occluder →
 * visible); large+ when this ear turns away (pushed behind the occluder →
 * hidden). `side` is +1 for the person's right ear, -1 for the left.
 *
 * The returned Y already accounts for the model's hook being at local y≈0.9, so
 * the hook lands on the lobe and the drop dangles beneath it.
 */
export function earringAnchor(
  earCentroid: Vec2,
  relDepth: number,
  fw: number,
  side: number,
): EarringAnchor {
  const scale = fw * EAR_SCALE;
  const x = earCentroid.x + side * fw * EAR_OUT_NUDGE;
  const lobeY = earCentroid.y - fw * EAR_LOBE_DROP;
  const z = fw * (EAR_FRONT_Z - relDepth * EAR_DEPTH_GAIN);
  return { x, y: lobeY - 0.9 * scale, z, scale };
}

/**
 * Front-surface Z of the head occluder ellipsoid at world X `x` (head centred at
 * `headCenterX`). Returns -Infinity outside the ellipse footprint (no occluder
 * there). An earring is hidden when its Z is behind (less than) this.
 */
export function occluderFrontZ(x: number, headCenterX: number, fw: number): number {
  const dx = (x - headCenterX) / (fw * HEAD_OCC.rx);
  const k = 1 - dx * dx;
  if (k <= 0) return -Infinity;
  return Math.sqrt(k) * fw * HEAD_OCC.rz;
}

/** Whether an earring is visible (in front of the head occluder) at its X/Z. */
export function earringVisible(e: EarringAnchor, headCenterX: number, fw: number): boolean {
  return e.z > occluderFrontZ(e.x, headCenterX, fw);
}
