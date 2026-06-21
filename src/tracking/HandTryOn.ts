import * as THREE from 'three';
import {
  buildBracelet,
  buildHandRing,
  createStudioEnvironment,
  makeGemMaterial,
  makeMetalMaterial,
  type BuiltPiece,
} from '../engine';
import { createHandOccluders, type HandOccluders } from '../occlusion/handOccluders';
import { dist, HAND, lerp, makeCoverMapper, normalize2 } from './mapping';
import { type HandFrame } from './handLandmarker';

/**
 * The Phase 3 hand try-on scene — ring on the ring finger, bracelet on the
 * wrist. Same y-up orthographic, CSS-mirrored overlay as the face try-on.
 *
 * Each band is built with its hole along local +Y; we orient local +Y to the
 * finger/forearm direction (tilted slightly out of screen so the band reads as
 * an ellipse, not edge-on) and local +Z toward the camera, scale to the
 * measured width, and a depth-only cylinder occluder hides the band's back arc.
 */

// Tunables.
const RING_TILT = 0.55; // finger tilt out of screen (ellipse foreshortening)
const FOREARM_TILT = 0.45;
const RING_W = 0.17; // ring band radius ÷ palm width
const BRACELET_W = 0.55; // bracelet band radius ÷ palm width
const FINGER_OCC = 0.78; // finger occluder radius ÷ band radius
const FOREARM_OCC = 0.9;

const UP_Y = new THREE.Vector3(0, 1, 0);
const FORWARD_Z = new THREE.Vector3(0, 0, 1);

export class HandTryOn {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  private camera: THREE.OrthographicCamera;

  private readonly flash: THREE.PointLight;
  private readonly ring: BuiltPiece;
  private readonly bracelet: BuiltPiece;
  private readonly occluders: HandOccluders;

  private showRing = true;
  private showBracelet = false;
  private elapsed = 0;
  private clock = new THREE.Clock();
  private viewW = 1;
  private viewH = 1;

  // Scratch vectors (avoid per-frame allocation).
  private readonly axis = new THREE.Vector3();
  private readonly zAxis = new THREE.Vector3();
  private readonly xAxis = new THREE.Vector3();
  private readonly basis = new THREE.Matrix4();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly video: HTMLVideoElement,
  ) {
    const isMobile = window.matchMedia('(pointer: coarse)').matches;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.5 : 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(0, 1, 1, 0, 1, 2000);
    this.camera.position.z = 1000;

    this.scene.environment = createStudioEnvironment(this.renderer);

    const key = new THREE.DirectionalLight(0xfff4e2, 2.0);
    key.position.set(0.4, 1, 1);
    const fill = new THREE.DirectionalLight(0xbcd2ff, 0.6);
    fill.position.set(-1, 0, 0.5);
    this.flash = new THREE.PointLight(0xffffff, 1.2, 0, 0);
    this.scene.add(key, fill, this.flash);

    // Gold + real diamond, same as the face try-on.
    const metal = makeMetalMaterial('yellow');
    const gem = makeGemMaterial('diamond');
    gem.transmission = 0.9;
    gem.roughness = 0.05;
    gem.thickness = 0.5;
    gem.clearcoat = 1.0;
    gem.clearcoatRoughness = 0.0;
    gem.envMapIntensity = 2.4;

    const assign = (piece: BuiltPiece): BuiltPiece => {
      for (const m of piece.metalMeshes) m.material = metal;
      for (const m of piece.gemMeshes) m.material = gem;
      piece.group.renderOrder = 1;
      piece.group.traverse((o) => (o.renderOrder = 1));
      this.scene.add(piece.group);
      return piece;
    };
    this.ring = assign(buildHandRing());
    this.bracelet = assign(buildBracelet());

    this.occluders = createHandOccluders();
    this.scene.add(this.occluders.group);

    this.resize();
  }

  setActive(ring: boolean, bracelet: boolean): void {
    this.showRing = ring;
    this.showBracelet = bracelet;
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.viewW = w;
    this.viewH = h;
    this.renderer.setSize(w, h, false);
    this.camera.left = 0;
    this.camera.right = w;
    this.camera.top = h;
    this.camera.bottom = 0;
    this.camera.updateProjectionMatrix();
  }

  /** Anchor + render one frame from a hand detection. */
  update(frame: HandFrame): boolean {
    this.elapsed += this.clock.getDelta();
    const t = this.elapsed;
    this.flash.position.set(
      this.viewW * 0.5 + Math.cos(t * 1.4) * this.viewW * 0.4,
      this.viewH * 0.6,
      600,
    );

    const lm = frame.landmarks;
    if (!lm) {
      this.ring.group.visible = false;
      this.bracelet.group.visible = false;
      this.occluders.group.visible = false;
      this.render();
      return false;
    }

    const P = makeCoverMapper(this.video.videoWidth, this.video.videoHeight, this.viewW, this.viewH);
    const idx = P(lm[HAND.indexMCP]);
    const pinky = P(lm[HAND.pinkyMCP]);
    const palmW = dist(idx, pinky) || 1;
    this.occluders.group.visible = true;

    // ---- Ring on the ring finger (base, landmarks 13→14) ----
    this.ring.group.visible = this.showRing;
    this.occluders.finger.visible = this.showRing;
    if (this.showRing) {
      const mcp = P(lm[HAND.ringMCP]);
      const pip = P(lm[HAND.ringPIP]);
      const cx = lerp(mcp.x, pip.x, 0.42);
      const cy = lerp(mcp.y, pip.y, 0.42);
      const fdir = normalize2(pip.x - mcp.x, pip.y - mcp.y);
      this.axis.set(fdir.x, fdir.y, RING_TILT).normalize();
      const r = palmW * RING_W;
      this.ring.group.position.set(cx, cy, 0);
      this.orientAlong(this.ring.group);
      this.ring.group.scale.setScalar(r);
      this.placeOccluder(this.occluders.finger, cx, cy, r * FINGER_OCC, palmW * 1.5);
    }

    // ---- Bracelet on the wrist (landmarks 0, 5, 17; forearm 9→0) ----
    this.bracelet.group.visible = this.showBracelet;
    this.occluders.forearm.visible = this.showBracelet;
    if (this.showBracelet) {
      const wrist = P(lm[HAND.wrist]);
      const mid = P(lm[HAND.middleMCP]);
      const fdir = normalize2(wrist.x - mid.x, wrist.y - mid.y); // toward the forearm
      const cx = wrist.x + fdir.x * palmW * 0.25;
      const cy = wrist.y + fdir.y * palmW * 0.25;
      this.axis.set(fdir.x, fdir.y, FOREARM_TILT).normalize();
      const r = palmW * BRACELET_W;
      this.bracelet.group.position.set(cx, cy, 0);
      this.orientAlong(this.bracelet.group);
      this.bracelet.group.scale.setScalar(r);
      this.placeOccluder(this.occluders.forearm, cx, cy, r * FOREARM_OCC, palmW * 2.8);
    }

    this.render();
    return true;
  }

  /** Orient `obj` so local +Y → this.axis and local +Z → toward the camera. */
  private orientAlong(obj: THREE.Object3D): void {
    const y = this.axis;
    // z = camera direction made perpendicular to y.
    this.zAxis.copy(FORWARD_Z).addScaledVector(y, -FORWARD_Z.dot(y));
    if (this.zAxis.lengthSq() < 1e-6) this.zAxis.copy(FORWARD_Z);
    this.zAxis.normalize();
    this.xAxis.crossVectors(y, this.zAxis).normalize();
    this.basis.makeBasis(this.xAxis, y, this.zAxis);
    obj.quaternion.setFromRotationMatrix(this.basis);
  }

  private placeOccluder(
    mesh: THREE.Mesh,
    x: number,
    y: number,
    radius: number,
    length: number,
  ): void {
    mesh.position.set(x, y, 0);
    mesh.quaternion.setFromUnitVectors(UP_Y, this.axis); // cylinder Y → finger/forearm axis
    mesh.scale.set(radius, length, radius);
  }

  private render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.renderer.dispose();
  }
}
