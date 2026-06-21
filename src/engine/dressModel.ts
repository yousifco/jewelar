import * as THREE from 'three';

/**
 * Re-dress an imported model (e.g. a Meshy / scan .glb that arrives with flat
 * grey materials) with OUR gold + diamond materials, shared by the 3D viewer
 * and the hand try-on so the SAME file renders identically in both.
 *
 * Each mesh is classified band-vs-stone: the largest part (and anything tagged
 * `metalTags`) → metal; the clustered small parts (and anything tagged
 * `stoneTags`) → gem. Every mesh name + size is logged so callers can author
 * name tags (MODEL_CONFIG_BY_HANDLE) when the size heuristic is wrong.
 */
export interface DressModelOptions {
  /** Material applied to band/metal parts (mutated live by the metal selector). */
  metal: THREE.Material;
  /** Material applied to stone parts (mutated live by the gem selector). */
  gem: THREE.Material;
  /** Mesh-name substrings (case-insensitive) to force as metal. */
  metalTags?: string[];
  /** Mesh-name substrings (case-insensitive) to force as stone. */
  stoneTags?: string[];
  /** A part smaller than this fraction of the largest part is treated as a stone. */
  stoneSizeRatio?: number;
  /** Prefix for the console log (e.g. 'viewer' / 'hand'). */
  label?: string;
}

export function dressImportedModel(root: THREE.Object3D, opts: DressModelOptions): THREE.Mesh[] {
  const { metal, gem, metalTags, stoneTags, stoneSizeRatio = 0.4, label = 'model' } = opts;

  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  if (meshes.length === 0) return meshes;

  const sizes = meshes.map((m) => {
    const s = new THREE.Box3().setFromObject(m).getSize(new THREE.Vector3());
    return Math.max(s.x, s.y, s.z);
  });
  const maxSize = Math.max(...sizes, 1e-6);
  const hit = (name: string, subs?: string[]): boolean =>
    !!subs && subs.some((s) => name.toLowerCase().includes(s.toLowerCase()));

  const stone = meshes.map((m, i) => {
    const n = m.name || '';
    if (hit(n, stoneTags)) return true;
    if (hit(n, metalTags)) return false;
    return sizes[i] < maxSize * stoneSizeRatio; // heuristic: small part = stone
  });

  // eslint-disable-next-line no-console
  console.info(
    `[${label}] loaded model parts (tag these in MODEL_CONFIG_BY_HANDLE if wrong):`,
    meshes.map((m, i) => ({
      name: m.name || '(unnamed)',
      size: +sizes[i].toFixed(3),
      as: stone[i] ? 'stone→diamond' : 'metal→gold',
    })),
  );

  meshes.forEach((m, i) => {
    m.material = stone[i] ? gem : metal;
  });
  return meshes;
}
