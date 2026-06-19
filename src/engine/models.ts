import * as THREE from 'three';
import { createBrilliantGeometry } from './brilliant';

/**
 * Parametric jewellery geometry builders.
 *
 * Each builder returns a THREE.Group plus the lists of metal meshes and gem
 * meshes inside it, so the viewer can assign the shared metal/gem materials.
 * Geometry uses high segment counts and smooth shading so metal reads as
 * polished, not faceted; gems use the faceted brilliant-cut hull so they
 * sparkle. Still lightweight (a few dozen meshes) for 60/30 fps.
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

// Shared faceted gem geometries (normalised, girdle radius ~1). Reused across
// all stones; each mesh sets its own scale. Hi-detail for hero stones,
// lo-detail for the small accents.
const GEM_HI = createBrilliantGeometry(28);
const GEM_LO = createBrilliantGeometry(16);

/** A brilliant-cut stone mesh sized to `size` (girdle diameter ≈ size). */
function gem(size: number, detail: 'hi' | 'lo', out: THREE.Mesh[]): THREE.Mesh {
  const mesh = new THREE.Mesh(detail === 'hi' ? GEM_HI : GEM_LO);
  mesh.scale.setScalar(size);
  out.push(mesh);
  return mesh;
}

/** Rounded claw prongs around a centre stone (with domed tips). */
function prongsAround(
  radius: number,
  height: number,
  count: number,
  out: THREE.Mesh[],
): THREE.Group {
  const grp = new THREE.Group();
  const shaft = new THREE.CylinderGeometry(0.035, 0.045, height, 20);
  const tip = new THREE.SphereGeometry(0.04, 20, 16);
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const x = Math.cos(a) * radius;
    const z = Math.sin(a) * radius;
    const p = new THREE.Mesh(shaft);
    p.position.set(x, height * 0.3, z);
    const cap = new THREE.Mesh(tip);
    cap.position.set(x, height * 0.3 + height * 0.5, z);
    grp.add(p, cap);
    out.push(p, cap);
  }
  return grp;
}

function buildRing(): BuiltPiece {
  const group = new THREE.Group();
  const metalMeshes: THREE.Mesh[] = [];
  const gemMeshes: THREE.Mesh[] = [];

  // Comfort-fit band — high segment torus reads as a smooth polished shank.
  const band = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.17, 64, 256));
  band.rotation.x = Math.PI / 2;
  metalMeshes.push(band);

  const head = new THREE.Group();
  head.position.set(0, 1.0, 0);

  // Tapered, rounded basket under the centre stone.
  const basket = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.24, 0.24, 48, 1, true));
  metalMeshes.push(basket);
  const basketRim = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.03, 24, 64));
  basketRim.position.y = 0.12;
  basketRim.rotation.x = Math.PI / 2;
  metalMeshes.push(basketRim);

  const centre = gem(0.5, 'hi', gemMeshes);
  centre.position.y = 0.26;
  head.add(basket, basketRim, prongsAround(0.34, 0.36, 6, metalMeshes), centre);

  // Pavé side accents along the shoulders.
  for (const s of [-1, 1]) {
    for (let j = 0; j < 3; j++) {
      const acc = gem(0.13 - j * 0.02, 'lo', gemMeshes);
      const a = s * (0.42 + j * 0.28);
      acc.position.set(Math.sin(a) * 1.0, Math.cos(a) * 1.0, 0);
      acc.rotation.z = -a;
      group.add(acc);
    }
  }

  group.add(band, head);
  return { group, metalMeshes, gemMeshes };
}

function buildPendant(): BuiltPiece {
  const group = new THREE.Group();
  const metalMeshes: THREE.Mesh[] = [];
  const gemMeshes: THREE.Mesh[] = [];

  const bail = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.06, 32, 96));
  bail.position.y = 1.08;
  metalMeshes.push(bail);

  // Halo frame + bright-cut rail holding the surrounding stones.
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.64, 0.1, 40, 140));
  metalMeshes.push(halo);

  const centre = gem(0.74, 'hi', gemMeshes);
  centre.position.y = 0.18;
  centre.position.z = 0.04;

  const n = 16;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const small = gem(0.13, 'lo', gemMeshes);
    small.position.set(Math.cos(a) * 0.64, Math.sin(a) * 0.64 + 0.18, 0.12);
    small.rotation.z = a;
    group.add(small);
  }

  group.add(bail, halo, centre);
  return { group, metalMeshes, gemMeshes };
}

function buildEarring(): BuiltPiece {
  const group = new THREE.Group();
  const metalMeshes: THREE.Mesh[] = [];
  const gemMeshes: THREE.Mesh[] = [];

  const hook = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.05, 28, 96, Math.PI * 1.3));
  hook.position.y = 0.95;
  metalMeshes.push(hook);

  const link = new THREE.Mesh(new THREE.SphereGeometry(0.1, 32, 24));
  link.position.y = 0.5;
  metalMeshes.push(link);

  // Halo-set teardrop: a small frame ring + centre stone + accents.
  const frame = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.06, 32, 100));
  frame.position.y = -0.05;
  metalMeshes.push(frame);

  const drop = gem(0.6, 'hi', gemMeshes);
  drop.position.y = -0.05;

  const n = 12;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const small = gem(0.1, 'lo', gemMeshes);
    small.position.set(Math.cos(a) * 0.4, Math.sin(a) * 0.4 - 0.05, 0.06);
    small.rotation.z = a;
    group.add(small);
  }

  group.add(hook, link, frame, drop);
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
