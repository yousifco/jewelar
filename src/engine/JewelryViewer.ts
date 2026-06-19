import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  applyGem,
  applyMetal,
  makeGemMaterial,
  makeMetalMaterial,
  type GemKey,
  type MetalKey,
} from './materials';
import { buildPiece, type BuiltPiece, type PieceKey } from './models';

/**
 * The Phase 1 PBR rendering engine.
 *
 * Sets up a Three.js scene with:
 *  - a procedural RoomEnvironment baked through PMREMGenerator (no HDR asset),
 *  - ACESFilmic tone mapping + sRGB output,
 *  - a moving point light so gems throw moving sparkle highlights,
 *  - OrbitControls with auto-rotate.
 *
 * Exposes setters for piece / metal / gem / exposure that the UI binds to.
 */
export class JewelryViewer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;

  private readonly controls: OrbitControls;
  private readonly flash: THREE.PointLight;
  private readonly metalMaterial: THREE.MeshStandardMaterial;
  private readonly gemMaterial: THREE.MeshPhysicalMaterial;

  private current: BuiltPiece | null = null;
  private clock = new THREE.Clock();
  private running = false;
  private elapsed = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    this.camera.position.set(0, 0.4, 6);

    // Procedural studio environment → realistic reflections with no asset/cost.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    // Key + rim + a moving flash for sparkle.
    const key = new THREE.DirectionalLight(0xfff2d8, 2.2);
    key.position.set(3, 4, 5);
    const rim = new THREE.DirectionalLight(0x9fc6ff, 0.8);
    rim.position.set(-4, -1, -3);
    this.flash = new THREE.PointLight(0xffffff, 8, 20);
    this.scene.add(key, rim, this.flash);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 2.2;
    this.controls.minDistance = 3.5;
    this.controls.maxDistance = 9;
    this.controls.enablePan = false;

    // Shared materials — mutated in place on selection change.
    this.metalMaterial = makeMetalMaterial('yellow');
    this.gemMaterial = makeGemMaterial('diamond');

    this.handleResize();
    window.addEventListener('resize', this.handleResize);
  }

  /** Load a parametric piece, assigning the shared materials. */
  setPiece(key: PieceKey): void {
    if (this.current) {
      this.scene.remove(this.current.group);
      disposePiece(this.current);
    }
    const piece = buildPiece(key);
    for (const m of piece.metalMeshes) m.material = this.metalMaterial;
    for (const m of piece.gemMeshes) m.material = this.gemMaterial;
    piece.group.scale.setScalar(1.25);
    this.scene.add(piece.group);
    this.current = piece;
  }

  setMetal(key: MetalKey): void {
    applyMetal(this.metalMaterial, key);
  }

  setGem(key: GemKey): void {
    applyGem(this.gemMaterial, key);
  }

  /** Lighting slider → tone-mapping exposure. */
  setExposure(value: number): void {
    this.renderer.toneMappingExposure = value;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.clock.start();
    this.renderer.setAnimationLoop(this.tick);
  }

  stop(): void {
    this.running = false;
    this.renderer.setAnimationLoop(null);
  }

  private tick = (): void => {
    this.elapsed += this.clock.getDelta();
    const t = this.elapsed;
    // Orbit the flash so highlights sweep across the facets → sparkle.
    this.flash.position.set(Math.cos(t * 1.3) * 4, 2, Math.sin(t * 1.3) * 4);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  private handleResize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };
}

function disposePiece(piece: BuiltPiece): void {
  for (const mesh of [...piece.metalMeshes, ...piece.gemMeshes]) {
    mesh.geometry.dispose();
  }
}
