import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createStudioEnvironment } from './environment';
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
 * The Phase 1 PBR rendering engine, realism pass.
 *
 *  - Procedural studio environment baked through PMREM (no HDR asset).
 *  - ACESFilmic tone mapping + sRGB output (applied by OutputPass).
 *  - Strong key/rim lights + a travelling point light so facets flare.
 *  - UnrealBloom post-processing for subtle sparkle on the brightest glints.
 *
 * Exposes setters for piece / metal / gem / exposure that the UI binds to.
 */
export class JewelryViewer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;

  private readonly controls: OrbitControls;
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly flash: THREE.PointLight;
  private readonly metalMaterial: THREE.MeshStandardMaterial;
  private readonly gemMaterial: THREE.MeshPhysicalMaterial;

  private current: BuiltPiece | null = null;
  private clock = new THREE.Clock();
  private running = false;
  private elapsed = 0;

  constructor(canvas: HTMLCanvasElement) {
    const isMobile = window.matchMedia('(pointer: coarse)').matches;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    // Cap DPR lower on mobile to keep bloom affordable (≥30 fps target).
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.5 : 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    // Pulled back with a touch more focal length so the whole piece sits
    // centred with margin (catalog framing), slightly elevated for a 3/4 view.
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    this.camera.position.set(0, 1.3, 8.5);

    // Bright procedural studio environment → punchy metal reflections.
    this.scene.environment = createStudioEnvironment(this.renderer);

    // Soft key + cool rim + a fill, plus a moving flash for travelling sparkle.
    // Kept gentle so the environment does most of the work and metal stays read.
    const key = new THREE.DirectionalLight(0xfff4e2, 1.6);
    key.position.set(4, 6, 5);
    const key2 = new THREE.DirectionalLight(0xffffff, 0.7);
    key2.position.set(-3, 2, 6);
    const rim = new THREE.DirectionalLight(0xbcd2ff, 0.6);
    rim.position.set(-5, -1, -4);
    this.flash = new THREE.PointLight(0xffffff, 6, 24, 1.5);
    this.scene.add(key, key2, rim, this.flash);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 1.0;
    this.controls.minDistance = 5;
    this.controls.maxDistance = 12;
    this.controls.enablePan = false;
    // Frame the piece centred (heads/drops sit above the band's origin).
    this.controls.target.set(0, 0.4, 0);
    this.controls.update();

    // Post-processing: render → bloom → tone-map/sRGB output.
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(1, 1),
      0.16, // strength — barely-there glint, no glowing gold halos
      0.25, // radius — tight
      0.92, // threshold — only the very brightest specular pixels bloom
    );
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

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
    this.flash.position.set(Math.cos(t * 1.3) * 4, 2.5, Math.sin(t * 1.3) * 4);
    this.controls.update();
    this.composer.render();
  };

  private handleResize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };
}

function disposePiece(piece: BuiltPiece): void {
  // Only metal geometries are unique per build; gem geometries are shared
  // module-level singletons, so they must not be disposed here.
  for (const mesh of piece.metalMeshes) {
    mesh.geometry.dispose();
  }
}
