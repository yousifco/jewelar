import * as THREE from 'three';

/**
 * glTF/GLB loading for real catalog models (the Phase 5 hook). GLTFLoader is
 * imported LAZILY so it only ships to browsers that actually load a model — the
 * common procedural path never pulls it into the main bundle.
 */
export async function loadGltfScene(url: string): Promise<THREE.Group> {
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const gltf = await new GLTFLoader().loadAsync(url);
  return gltf.scene;
}

/**
 * Re-centre an object at the origin and uniformly scale it so its largest
 * dimension equals `size`. Returns a wrapper Group (so callers can position /
 * rotate it like a procedural piece). Lets arbitrary catalog models drop into
 * the same anchoring as the built-in pieces.
 */
export function fitToSize(obj: THREE.Object3D, size: number): THREE.Group {
  const box = new THREE.Box3().setFromObject(obj);
  const center = box.getCenter(new THREE.Vector3());
  const dims = box.getSize(new THREE.Vector3());
  const max = Math.max(dims.x, dims.y, dims.z) || 1;
  obj.position.sub(center); // centre at the origin
  const wrap = new THREE.Group();
  wrap.add(obj);
  wrap.scale.setScalar(size / max);
  return wrap;
}
