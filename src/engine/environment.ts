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

  // Large overhead softbox — the main broad highlight that sweeps polished gold.
  scene.add(panel(14, 14, [0, 9, 1], center, [5.5, 5.2, 4.6]));
  // Warm key softbox, front-right.
  scene.add(panel(10, 12, [8, 3, 7], center, [6.0, 5.0, 3.6]));
  // Cool rim/fill from back-left for separation and blue glints in stones.
  scene.add(panel(9, 11, [-9, 2, -4], center, [3.4, 4.0, 6.0]));
  // Lower bounce/fill so the underside of metal isn't dead.
  scene.add(panel(12, 6, [0, -6, 5], center, [1.6, 1.5, 1.3]));

  // Thin bright strips → crisp streak highlights that travel across facets as
  // the piece rotates (the "sparkle lines").
  scene.add(panel(0.6, 9, [5, 4, -2], center, [9, 9, 9]));
  scene.add(panel(0.6, 9, [-4, 5, 3], center, [8, 8, 9]));
  scene.add(panel(7, 0.5, [-2, 7, -3], center, [8, 7.5, 7]));

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
