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

// Polished karat-gold tones (warm, bright — not brown). envMapIntensity kept
// in the ~1.3–1.5 range so gold reads as solid reflective metal, not a glow.
export const METALS: Record<MetalKey, MetalSpec> = {
  yellow: { color: 0xffd27a, roughness: 0.11, envMapIntensity: 1.35, name: 'ذهب أصفر' },
  white: { color: 0xece9e3, roughness: 0.1, envMapIntensity: 1.5, name: 'ذهب أبيض' },
  rose: { color: 0xf7c6b0, roughness: 0.12, envMapIntensity: 1.35, name: 'ذهب وردي' },
};

export const GEMS: Record<GemKey, GemSpec> = {
  diamond: { color: 0xffffff, attenuationDistance: 6, transmission: 0.85, name: 'ألماس' },
  ruby: { color: 0xff1f47, attenuationDistance: 0.35, transmission: 0.7, name: 'ياقوت' },
  sapphire: { color: 0x2658ff, attenuationDistance: 0.4, transmission: 0.7, name: 'زفير' },
  emerald: { color: 0x10c074, attenuationDistance: 0.4, transmission: 0.68, name: 'زمرّد' },
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
  // No clearcoat / iridescence: those add a milky surface layer that washes a
  // faceted stone to flat white. The high IOR (2.42) already gives a strong
  // facet specular, and a thicker slab deepens the refraction so facets keep
  // dark/light contrast like a real cut stone.
  return new THREE.MeshPhysicalMaterial({
    color: g.color,
    metalness: 0,
    roughness: 0,
    transmission: g.transmission,
    thickness: 1.4,
    ior: 2.42,
    specularIntensity: 1,
    specularColor: new THREE.Color(0xffffff),
    envMapIntensity: 1.1,
    attenuationColor: new THREE.Color(g.color),
    attenuationDistance: g.attenuationDistance,
  });
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
