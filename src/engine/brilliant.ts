import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';

/**
 * A faceted round brilliant-cut gem.
 *
 * Rather than a cylinder+cone stand-in, we lay out the real proportions of a
 * brilliant cut as concentric rings of points and take their convex hull:
 *
 *   table ring (flat top)  ─┐
 *   crown / star ring       ├─ crown
 *   girdle top ring        ─┘
 *   girdle bottom ring     ─┐
 *   pavilion main ring      ├─ pavilion
 *   culet (bottom point)   ─┘
 *
 * Alternate rings are rotated by half a step so the hull produces the
 * triangular star/kite/girdle facets of a real stone. ConvexGeometry yields
 * flat, sharp facets with correct outward normals — exactly the look that makes
 * a diamond throw hard, moving sparkle under a travelling light.
 *
 * The result is normalised so its girdle radius is ~1 and it is centred on the
 * origin; callers scale it to the setting.
 */
export function createBrilliantGeometry(sides = 24): THREE.BufferGeometry {
  const half = Math.PI / sides;

  // Proportions roughly follow a "Tolkowsky" ideal cut (relative to girdle Ø=1).
  const tableRadius = 0.53;
  const crownRingRadius = 0.82;
  const crownHeight = 0.34; // table height above girdle
  const crownRingHeight = 0.2;
  const girdleThickness = 0.05;
  const pavilionRingRadius = 0.62;
  const pavilionRingDepth = 0.55;
  const culetDepth = 0.93;

  const points: THREE.Vector3[] = [];
  const ring = (radius: number, y: number, offset: number) => {
    for (let i = 0; i < sides; i++) {
      const a = i * (2 * half) + offset;
      points.push(new THREE.Vector3(Math.cos(a) * radius, y, Math.sin(a) * radius));
    }
  };

  // Crown.
  ring(tableRadius, crownHeight, 0); // table edge (hull caps it → flat table facet)
  ring(crownRingRadius, crownRingHeight, half); // star/bezel ring (offset)
  ring(1.0, 0, 0); // girdle top
  // Girdle band + pavilion.
  ring(0.985, -girdleThickness, half); // girdle bottom (slightly inset → near-vertical band)
  ring(pavilionRingRadius, -pavilionRingDepth, 0); // pavilion main ring
  points.push(new THREE.Vector3(0, -culetDepth, 0)); // culet

  const geo = new ConvexGeometry(points);
  geo.computeVertexNormals(); // flat per-facet normals (non-indexed hull)
  geo.center();
  return geo;
}

/**
 * A baguette / step-cut style accent could go here later; for now accent stones
 * reuse the brilliant geometry at small scale.
 */
