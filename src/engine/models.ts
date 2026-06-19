import * as THREE from 'three';

/**
 * Parametric jewellery geometry builders.
 *
 * Each builder returns a THREE.Group plus the lists of metal meshes and gem
 * meshes inside it, so the viewer can assign the shared metal/gem materials and
 * later swap them. Geometry is intentionally lightweight (a few dozen meshes)
 * to keep 60fps desktop / 30fps mobile.
 */

export type PieceKey = 'ring' | 'pendant' | 'earring';

export interface BuiltPiece {
  group: THREE.Group;
  metalMeshes: THREE.Mesh[];
  gemMeshes: THREE.Mesh[];
}

export const PIECE_NAMES: Record<PieceKey, string> = {
  ring: 'خاتم',
  pendant: 'تعليقة',
  earring: 'قرط',
};

/** Approximate a brilliant-cut stone: a faceted crown cylinder + pavilion cone. */
function brilliant(size: number, out: THREE.Mesh[]): THREE.Group {
  const g = new THREE.Group();
  const table = 0.55 * size;
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(table, size, 0.35 * size, 12));
  const pavilion = new THREE.Mesh(new THREE.ConeGeometry(size, 1.0 * size, 12));
  pavilion.rotation.x = Math.PI;
  pavilion.position.y = -0.5 * size - 0.175 * size;
  g.add(crown, pavilion);
  out.push(crown, pavilion);
  return g;
}

/** A ring of prongs holding a centre stone. */
function prongsAround(radius: number, height: number, count: number, out: THREE.Mesh[]): THREE.Group {
  const grp = new THREE.Group();
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, height, 8));
    p.position.set(Math.cos(a) * radius, height * 0.3, Math.sin(a) * radius);
    grp.add(p);
    out.push(p);
  }
  return grp;
}

function buildRing(): BuiltPiece {
  const group = new THREE.Group();
  const metalMeshes: THREE.Mesh[] = [];
  const gemMeshes: THREE.Mesh[] = [];

  const band = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.16, 32, 80));
  band.rotation.x = Math.PI / 2;
  metalMeshes.push(band);

  const head = new THREE.Group();
  head.position.set(0, 1.0, 0);
  const basket = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.26, 0.22, 16));
  metalMeshes.push(basket);

  const centre = brilliant(0.46, gemMeshes);
  centre.position.y = 0.2;
  head.add(basket, prongsAround(0.34, 0.34, 4, metalMeshes), centre);

  // side accent stones
  for (const s of [-1, 1]) {
    const side = brilliant(0.16, gemMeshes);
    side.position.set(s * 0.5, 0.95, 0);
    side.rotation.z = s * 0.3;
    group.add(side);
  }

  group.add(band, head);
  return { group, metalMeshes, gemMeshes };
}

function buildPendant(): BuiltPiece {
  const group = new THREE.Group();
  const metalMeshes: THREE.Mesh[] = [];
  const gemMeshes: THREE.Mesh[] = [];

  const bail = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.06, 20, 40));
  bail.position.y = 1.05;
  metalMeshes.push(bail);

  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.09, 24, 60));
  metalMeshes.push(halo);

  const centre = brilliant(0.62, gemMeshes);
  centre.position.y = 0.18;

  const n = 14;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const small = brilliant(0.1, gemMeshes);
    small.position.set(Math.cos(a) * 0.62, Math.sin(a) * 0.62, 0.05);
    group.add(small);
  }

  group.add(bail, halo, centre);
  return { group, metalMeshes, gemMeshes };
}

function buildEarring(): BuiltPiece {
  const group = new THREE.Group();
  const metalMeshes: THREE.Mesh[] = [];
  const gemMeshes: THREE.Mesh[] = [];

  const hook = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.05, 20, 40, Math.PI * 1.3));
  hook.position.y = 0.9;
  metalMeshes.push(hook);

  const link = new THREE.Mesh(new THREE.SphereGeometry(0.1, 20, 20));
  link.position.y = 0.45;
  metalMeshes.push(link);

  const drop = brilliant(0.5, gemMeshes);
  drop.position.y = -0.1;
  drop.rotation.x = Math.PI;

  group.add(hook, link, drop);
  return { group, metalMeshes, gemMeshes };
}

const BUILDERS: Record<PieceKey, () => BuiltPiece> = {
  ring: buildRing,
  pendant: buildPendant,
  earring: buildEarring,
};

/** Build a parametric piece by key. */
export function buildPiece(key: PieceKey): BuiltPiece {
  return BUILDERS[key]();
}
