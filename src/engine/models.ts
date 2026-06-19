import * as THREE from 'three';
import { createBrilliantGeometry } from './brilliant';

/**
 * Parametric jewellery geometry builders.
 *
 * Goal: pieces that are immediately *recognisable* — a ring reads as a ring
 * (upright band, stone seated at the top), a pendant hangs from a bail with the
 * stone facing the viewer, an earring drops from an ear-wire. High segment
 * counts + smooth metal; faceted brilliant-cut stones that face the camera.
 *
 * Orientation conventions (camera looks down +Z toward -Z):
 *  - Metal rings/torus left in the XY plane => they face the camera (upright).
 *  - The brilliant geometry has its table at +Y. For stones that should face
 *    the viewer (pendant/earring) we rotate +90° about X so the table points
 *    at the camera (+Z); for the ring's solitaire the stone stays table-up.
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

// Shared faceted gem geometries (normalised, girdle radius ~1, table at +Y).
const GEM_HI = createBrilliantGeometry(32);
const GEM_LO = createBrilliantGeometry(18);

/** A brilliant-cut stone mesh whose girdle diameter ≈ `size`. */
function gem(size: number, detail: 'hi' | 'lo', out: THREE.Mesh[]): THREE.Mesh {
  const mesh = new THREE.Mesh(detail === 'hi' ? GEM_HI : GEM_LO);
  mesh.scale.setScalar(size * 0.5); // geometry girdle radius is 1 ⇒ diameter 2
  out.push(mesh);
  return mesh;
}

/** Make a stone face the camera (table toward +Z) instead of up. */
function faceCamera(mesh: THREE.Mesh): THREE.Mesh {
  mesh.rotation.x = Math.PI / 2;
  return mesh;
}

/** A ring of claw prongs gripping a seated stone (rounded tips at the girdle). */
function claws(radius: number, baseY: number, topY: number, count: number, out: THREE.Mesh[]) {
  const grp = new THREE.Group();
  const h = topY - baseY;
  const shaft = new THREE.CylinderGeometry(0.03, 0.038, h, 16);
  const tip = new THREE.SphereGeometry(0.035, 16, 12);
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + Math.PI / count;
    const x = Math.cos(a) * radius;
    const z = Math.sin(a) * radius;
    const p = new THREE.Mesh(shaft);
    p.position.set(x, baseY + h / 2, z);
    const cap = new THREE.Mesh(tip);
    cap.position.set(x, topY, z);
    grp.add(p, cap);
    out.push(p, cap);
  }
  return grp;
}

function buildRing(): BuiltPiece {
  const group = new THREE.Group();
  const metal: THREE.Mesh[] = [];
  const gems: THREE.Mesh[] = [];

  // Upright comfort-fit band — left in the XY plane so it faces the camera and
  // reads as a ring you'd look through.
  const bandR = 1.0;
  const band = new THREE.Mesh(new THREE.TorusGeometry(bandR, 0.12, 64, 256));
  metal.push(band);

  // Solitaire setting seated at the very top of the band (12 o'clock).
  const head = new THREE.Group();
  head.position.set(0, bandR, 0);

  const stoneSize = 0.62; // girdle diameter
  const stoneR = stoneSize * 0.5;

  // Tapered basket/gallery under the stone.
  const basket = new THREE.Mesh(
    new THREE.CylinderGeometry(stoneR * 0.92, stoneR * 0.5, 0.26, 32, 1, true),
  );
  basket.position.y = 0.05;
  metal.push(basket);
  const collar = new THREE.Mesh(new THREE.TorusGeometry(stoneR * 0.9, 0.028, 20, 64));
  collar.rotation.x = Math.PI / 2;
  collar.position.y = 0.18;
  metal.push(collar);

  // Centre stone, table up, seated in the basket.
  const centre = gem(stoneSize, 'hi', gems);
  centre.position.y = 0.32;
  head.add(basket, collar, claws(stoneR * 0.95, 0.12, 0.42, 4, metal), centre);
  group.add(head);

  // Pavé accents set into the front of the shoulders, facing the camera.
  for (const s of [-1, 1]) {
    for (let j = 0; j < 3; j++) {
      const a = s * (0.34 + j * 0.24);
      const acc = faceCamera(gem(0.16 - j * 0.02, 'lo', gems));
      acc.position.set(Math.sin(a) * bandR, Math.cos(a) * bandR, 0.12);
      group.add(acc);
    }
  }

  group.add(band);
  return { group, metalMeshes: metal, gemMeshes: gems };
}

function buildPendant(): BuiltPiece {
  const group = new THREE.Group();
  const metal: THREE.Mesh[] = [];
  const gems: THREE.Mesh[] = [];

  // Bail loop at the top (faces camera).
  const bail = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.045, 28, 80));
  bail.position.y = 1.05;
  metal.push(bail);
  // Connector from bail down to the halo.
  const link = new THREE.Mesh(new THREE.SphereGeometry(0.07, 24, 18));
  link.position.y = 0.86;
  metal.push(link);

  // Halo pendant: metal frame ring + forward-facing centre stone + a ring of
  // small forward-facing stones around it.
  const haloR = 0.6;
  const frame = new THREE.Mesh(new THREE.TorusGeometry(haloR, 0.07, 40, 160));
  frame.position.y = 0.18;
  metal.push(frame);

  const centre = faceCamera(gem(1.0, 'hi', gems));
  centre.position.set(0, 0.18, 0.02);

  const n = 18;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const small = faceCamera(gem(0.18, 'lo', gems));
    small.position.set(Math.cos(a) * haloR, 0.18 + Math.sin(a) * haloR, 0.08);
    group.add(small);
  }

  group.add(bail, link, frame, centre);
  return { group, metalMeshes: metal, gemMeshes: gems };
}

function buildEarring(): BuiltPiece {
  const group = new THREE.Group();
  const metal: THREE.Mesh[] = [];
  const gems: THREE.Mesh[] = [];

  // Ear wire (open hook) at the top.
  const hook = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.04, 24, 90, Math.PI * 1.35));
  hook.position.y = 0.95;
  hook.rotation.z = -0.3;
  metal.push(hook);

  // Small stud just below the hook (forward-facing).
  const studFrame = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.045, 28, 90));
  studFrame.position.y = 0.45;
  metal.push(studFrame);
  const stud = faceCamera(gem(0.26, 'lo', gems));
  stud.position.set(0, 0.45, 0.03);

  // Connecting link.
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.22, 12));
  bar.position.y = 0.2;
  metal.push(bar);

  // Halo drop below (forward-facing centre stone + small surround).
  const haloR = 0.42;
  const frame = new THREE.Mesh(new THREE.TorusGeometry(haloR, 0.055, 32, 120));
  frame.position.y = -0.28;
  metal.push(frame);
  const drop = faceCamera(gem(0.66, 'hi', gems));
  drop.position.set(0, -0.28, 0.02);

  const n = 14;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const small = faceCamera(gem(0.13, 'lo', gems));
    small.position.set(Math.cos(a) * haloR, -0.28 + Math.sin(a) * haloR, 0.06);
    group.add(small);
  }

  group.add(hook, studFrame, stud, bar, frame, drop);
  return { group, metalMeshes: metal, gemMeshes: gems };
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
