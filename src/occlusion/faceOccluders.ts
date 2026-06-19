import * as THREE from 'three';

/**
 * Depth-only occluders for the face try-on (BUILD_SPEC §5).
 *
 * These invisible meshes write depth but no colour (`colorWrite:false`,
 * `depthWrite:true`) and render *before* the jewellery (negative renderOrder),
 * so any jewellery geometry behind them in Z is hidden by the depth test —
 * giving the "worn" look instead of a pasted overlay:
 *
 *  - headOccluder: an ellipsoid over the head; hides the *far* earring when the
 *    head is turned (the far earring sits behind it in Z).
 *  - neckOccluder: a capsule/cylinder at the neck/jaw; hides the *back* arc of
 *    the necklace chain (which loops behind the neck in Z).
 *
 * Both are positioned/scaled per frame by the try-on from face landmarks.
 */

function occluderMaterial(): THREE.Material {
  const m = new THREE.MeshBasicMaterial();
  m.colorWrite = false; // depth only
  m.depthWrite = true;
  return m;
}

export interface FaceOccluders {
  head: THREE.Mesh;
  neck: THREE.Mesh;
  group: THREE.Group;
}

export function createFaceOccluders(): FaceOccluders {
  const group = new THREE.Group();
  const mat = occluderMaterial();

  // Unit sphere — scaled to an ellipsoid each frame to fit the head.
  const head = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 18), mat);
  head.renderOrder = -10;

  // Unit-ish cylinder along Y — scaled to fit the neck/jaw column each frame.
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 24, 1), mat);
  neck.renderOrder = -10;

  group.add(head, neck);
  return { head, neck, group };
}
