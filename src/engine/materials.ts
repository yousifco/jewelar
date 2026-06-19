import * as THREE from 'three';

/**
 * PBR material definitions for the jewellery engine.
 *
 * Metals use MeshStandardMaterial (metalness 1) with the gold colours and
 * roughness values from BUILD_SPEC §3. Gems use MeshPhysicalMaterial with
 * transmission + ior 2.42 so light refracts like a real cut stone.
 *
 * Both materials are *shared* — the viewer mutates a single metal instance and
 * a single gem instance in place when the shopper changes the selection, so the
 * whole piece updates at once without rebuilding geometry.
 */

export type MetalKey = 'yellow' | 'white' | 'rose';
export type GemKey = 'diamond' | 'ruby' | 'sapphire' | 'emerald';

export interface MetalSpec {
  /** Display colour of the alloy. */
  color: number;
  /** Micro-roughness — lower = mirror-like, higher = satin. */
  roughness: number;
  /** Arabic label for the UI. */
  name: string;
}

export interface GemSpec {
  color: number;
  name: string;
}

export const METALS: Record<MetalKey, MetalSpec> = {
  yellow: { color: 0xffc864, roughness: 0.17, name: 'ذهب أصفر' },
  white: { color: 0xe9e7df, roughness: 0.12, name: 'ذهب أبيض' },
  rose: { color: 0xf2b39a, roughness: 0.18, name: 'ذهب وردي' },
};

export const GEMS: Record<GemKey, GemSpec> = {
  diamond: { color: 0xffffff, name: 'ألماس' },
  ruby: { color: 0xff2b54, name: 'ياقوت' },
  sapphire: { color: 0x2d6cff, name: 'زفير' },
  emerald: { color: 0x18b56b, name: 'زمرّد' },
};

/** Create a fresh gold material for the given alloy. */
export function makeMetalMaterial(key: MetalKey): THREE.MeshStandardMaterial {
  const m = METALS[key];
  return new THREE.MeshStandardMaterial({
    color: m.color,
    metalness: 1,
    roughness: m.roughness,
    envMapIntensity: 1.5,
  });
}

/**
 * Create a fresh gem material. Diamonds get full transmission and a long
 * attenuation distance (near-colourless); coloured stones get lower
 * transmission and a short, coloured attenuation so the body colour reads.
 */
export function makeGemMaterial(key: GemKey): THREE.MeshPhysicalMaterial {
  const g = GEMS[key];
  const isDiamond = key === 'diamond';
  return new THREE.MeshPhysicalMaterial({
    color: g.color,
    metalness: 0,
    roughness: 0,
    transmission: isDiamond ? 1 : 0.6,
    thickness: 0.6,
    ior: 2.42,
    specularIntensity: 1,
    envMapIntensity: 2.4,
    clearcoat: 1,
    clearcoatRoughness: 0,
    attenuationColor: new THREE.Color(g.color),
    attenuationDistance: isDiamond ? 5 : 0.7,
  });
}

/** Mutate an existing metal material in place to a new alloy. */
export function applyMetal(material: THREE.MeshStandardMaterial, key: MetalKey): void {
  const m = METALS[key];
  material.color.set(m.color);
  material.roughness = m.roughness;
  material.needsUpdate = true;
}

/** Mutate an existing gem material in place to a new stone type. */
export function applyGem(material: THREE.MeshPhysicalMaterial, key: GemKey): void {
  const g = GEMS[key];
  const isDiamond = key === 'diamond';
  material.color.set(g.color);
  material.attenuationColor.set(g.color);
  material.transmission = isDiamond ? 1 : 0.6;
  material.attenuationDistance = isDiamond ? 5 : 0.7;
  material.needsUpdate = true;
}
