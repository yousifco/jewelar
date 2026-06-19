import * as THREE from 'three';

/**
 * Procedural studio lighting environment for PBR reflections — brighter than
 * three's stock RoomEnvironment so polished gold actually reflects and gems
 * catch hard speculars. No HDR file: a handful of emissive "softbox" panels are
 * baked into a cube map by PMREMGenerator.
 *
 * Trick (same as RoomEnvironment): a MeshBasicMaterial's THREE.Color is an
 * unclamped float, so `color.setScalar(4)` emits HDR radiance > 1 that PMREM
 * captures — giving bright, punchy reflections.
 */

function panel(
  width: number,
  height: number,
  position: [number, number, number],
  lookAt: [number, number, number],
  rgb: [number, number, number],
): THREE.Mesh {
  const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  mat.color.setRGB(rgb[0], rgb[1], rgb[2]); // values > 1 => HDR emission
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
  mesh.position.set(...position);
  mesh.lookAt(new THREE.Vector3(...lookAt));
  return mesh;
}

/** Build the studio scene used as the PMREM source. */
function buildStudioScene(): THREE.Scene {
  const scene = new THREE.Scene();
  // Dark surround so reflections have contrast (deep velvet, not black).
  scene.background = new THREE.Color(0x14110b);

  const center: [number, number, number] = [0, 0, 0];

  // Intensities kept modest so metal reflects the studio without the panels
  // self-illuminating the surface into a glow. Reflections, not light sources.

  // Large overhead softbox — the main broad highlight that sweeps polished gold.
  scene.add(panel(14, 14, [0, 9, 1], center, [1.7, 1.6, 1.45]));
  // Warm key softbox, front-right.
  scene.add(panel(10, 12, [8, 3, 7], center, [1.9, 1.6, 1.2]));
  // Cool rim/fill from back-left for separation and blue glints in stones.
  scene.add(panel(9, 11, [-9, 2, -4], center, [1.0, 1.2, 1.7]));
  // Lower bounce/fill so the underside of metal isn't dead.
  scene.add(panel(12, 6, [0, -6, 5], center, [0.5, 0.48, 0.42]));

  // Thin brighter strips → crisp pinpoint streak highlights that travel across
  // facets as the piece rotates (the "sparkle lines"). These are the only
  // panels meant to read as hot glints.
  scene.add(panel(0.5, 9, [5, 4, -2], center, [3.0, 3.0, 3.0]));
  scene.add(panel(0.5, 9, [-4, 5, 3], center, [2.6, 2.6, 2.9]));
  scene.add(panel(7, 0.4, [-2, 7, -3], center, [2.6, 2.5, 2.3]));

  return scene;
}

/**
 * Bake the studio scene into a PMREM environment texture.
 * Returns the texture; caller assigns it to `scene.environment`.
 */
export function createStudioEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const studio = buildStudioScene();
  const target = pmrem.fromScene(studio, 0.04);
  // Dispose the source scene's GPU resources; keep the baked texture.
  studio.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
  });
  return target.texture;
}
