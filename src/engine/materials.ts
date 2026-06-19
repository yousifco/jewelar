import * as THREE from 'three';

/**
 * PBR material definitions for the jewellery engine.
 *
 * Metals use MeshStandardMaterial (metalness 1) with polished-gold colours and
 * low roughness + high envMapIntensity so they read as real reflective metal.
 * Gems use MeshPhysicalMaterial with transmission + ior 2.42, clearcoat and
 * coloured attenuation so they refract and glow with depth instead of looking
 * like plastic.
 *
 * Both materials are *shared* — the viewer mutates a single metal instance and
 * a single gem instance in place when the shopper changes the selection.
 */

export type MetalKey = 'yellow' | 'white' | 'rose';
export type GemKey = 'diamond' | 'ruby' | 'sapphire' | 'emerald';

export interface MetalSpec {
  /** Display colour of the polished alloy. */
  color: number;
  /** Micro-roughness — lower = mirror-like polish. */
  roughness: number;
  /** How strongly the studio environment reflects in the metal. */
  envMapIntensity: number;
  /** Arabic label for the UI. */
  name: string;
}

export interface GemSpec {
  color: number;
  /** Body-colour saturation depth: shorter = more saturated stone. */
  attenuationDistance: number;
  /** Coloured stones transmit a touch less than diamond. */
  transmission: number;
  name: string;
}

// Polished karat-gold tones (warm, bright — not brown).
export const METALS: Record<MetalKey, MetalSpec> = {
  yellow: { color: 0xffd27a, roughness: 0.09, envMapIntensity: 2.8, name: 'ذهب أصفر' },
  white: { color: 0xece9e3, roughness: 0.08, envMapIntensity: 3.0, name: 'ذهب أبيض' },
  rose: { color: 0xf7c6b0, roughness: 0.1, envMapIntensity: 2.8, name: 'ذهب وردي' },
};

export const GEMS: Record<GemKey, GemSpec> = {
  diamond: { color: 0xffffff, attenuationDistance: 8, transmission: 1.0, name: 'ألماس' },
  ruby: { color: 0xff1f47, attenuationDistance: 0.45, transmission: 0.92, name: 'ياقوت' },
  sapphire: { color: 0x2658ff, attenuationDistance: 0.5, transmission: 0.92, name: 'زفير' },
  emerald: { color: 0x10c074, attenuationDistance: 0.5, transmission: 0.9, name: 'زمرّد' },
};

/** Create a fresh polished-gold material for the given alloy. */
export function makeMetalMaterial(key: MetalKey): THREE.MeshStandardMaterial {
  const m = METALS[key];
  return new THREE.MeshStandardMaterial({
    color: m.color,
    metalness: 1,
    roughness: m.roughness,
    envMapIntensity: m.envMapIntensity,
  });
}

/**
 * Create a fresh gem material. Diamonds get full transmission and a long
 * attenuation distance (near-colourless brilliance); coloured stones get
 * slightly lower transmission and a short, coloured attenuation so the body
 * colour saturates with depth. A clearcoat adds the wet, polished surface
 * glint, and a faint iridescence fakes the rainbow "fire" (true dispersion
 * needs three r167+).
 */
export function makeGemMaterial(key: GemKey): THREE.MeshPhysicalMaterial {
  const g = GEMS[key];
  const mat = new THREE.MeshPhysicalMaterial({
    color: g.color,
    metalness: 0,
    roughness: 0,
    transmission: g.transmission,
    thickness: 0.9,
    ior: 2.42,
    specularIntensity: 1,
    specularColor: new THREE.Color(0xffffff),
    envMapIntensity: 3.5,
    clearcoat: 1,
    clearcoatRoughness: 0.02,
    attenuationColor: new THREE.Color(g.color),
    attenuationDistance: g.attenuationDistance,
    // Faint thin-film tint approximating dispersion "fire" on the facet edges.
    iridescence: 0.18,
    iridescenceIOR: 1.6,
  });
  mat.iridescenceThicknessRange = [120, 420];
  return mat;
}

/** Mutate an existing metal material in place to a new alloy. */
export function applyMetal(material: THREE.MeshStandardMaterial, key: MetalKey): void {
  const m = METALS[key];
  material.color.set(m.color);
  material.roughness = m.roughness;
  material.envMapIntensity = m.envMapIntensity;
  material.needsUpdate = true;
}

/** Mutate an existing gem material in place to a new stone type. */
export function applyGem(material: THREE.MeshPhysicalMaterial, key: GemKey): void {
  const g = GEMS[key];
  material.color.set(g.color);
  material.attenuationColor.set(g.color);
  material.transmission = g.transmission;
  material.attenuationDistance = g.attenuationDistance;
  material.needsUpdate = true;
}
