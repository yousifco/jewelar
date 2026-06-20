import * as THREE from 'three';

/**
 * Depth-only occluder for the face try-on (BUILD_SPEC §5).
 *
 * An invisible mesh that writes depth but no colour (`colorWrite:false`,
 * `depthWrite:true`) and renders BEFORE the necklace (negative renderOrder), so
 * any chain geometry behind it in Z is hidden by the depth test — giving the
 * "worn" look instead of a pasted overlay.
 *
 *  - neck (throat): a cylinder approximating the neck/throat column from the
 *    jaw/chin down to the neck base. It hides the rear/side parts of the chain
 *    that wrap behind the neck; only the front drape + pendant show.
 *
 * (Earrings no longer use a depth occluder — they fade out past a yaw threshold
 * instead, which is more robust than depth-sorting near-profile ears.)
 *
 * The mesh is positioned/scaled per frame by the try-on from the landmarks.
 */

export interface FaceOccluders {
  neck: THREE.Mesh;
  group: THREE.Group;
}

export function createFaceOccluders(): FaceOccluders {
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial();
  mat.colorWrite = false; // depth only
  mat.depthWrite = true;

  // Unit cylinder along Y — scaled to fit the neck/throat column each frame.
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 28, 1), mat);
  neck.renderOrder = -10;

  group.add(neck);
  return { neck, group };
}
