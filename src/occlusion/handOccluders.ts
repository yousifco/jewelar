import * as THREE from 'three';

/**
 * Depth-only occluders for the hand try-on (BUILD_SPEC §5): invisible cylinders
 * fitted along the finger and the forearm (`colorWrite:false`, `depthWrite:true`,
 * drawn before the jewellery). They hide the BACK arc of a band that wraps
 * behind the finger/arm in Z, giving the "worn" look.
 *
 * Both are unit cylinders along +Y; the try-on positions, orients (Y → the
 * finger/forearm axis) and scales (radius, length) them each frame.
 */

export interface HandOccluders {
  finger: THREE.Mesh;
  forearm: THREE.Mesh;
  group: THREE.Group;
}

export function createHandOccluders(): HandOccluders {
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial();
  mat.colorWrite = false; // depth only
  mat.depthWrite = true;

  const finger = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 20, 1), mat);
  finger.renderOrder = -10;
  const forearm = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 24, 1), mat);
  forearm.renderOrder = -10;

  group.add(finger, forearm);
  return { finger, forearm, group };
}
