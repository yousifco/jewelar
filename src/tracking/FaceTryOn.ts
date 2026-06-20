import * as THREE from 'three';
import {
  buildNecklace,
  buildPiece,
  createStudioEnvironment,
  makeGemMaterial,
  makeMetalMaterial,
  type BuiltPiece,
} from '../engine';
import { createFaceOccluders, type FaceOccluders } from '../occlusion/faceOccluders';
import { avgScreen, dist, EAR_L, EAR_R, FACE, makeCoverMapper, POSE } from './mapping';
import {
  earringAnchor,
  earringOpacity,
  necklaceAnchor,
  type AnchorIndices,
  type EarringAnchor,
} from './anchors';
import { type FaceFrame } from './faceLandmarker';

/**
 * The Phase 2 face try-on scene (BUILD_SPEC §4–5).
 *
 * Renders 3D jewellery on a transparent canvas overlaid on the camera, in
 * NATIVE (un-mirrored) camera space with a y-up orthographic camera in view
 * pixels; the page CSS-mirrors both the video and this canvas together for the
 * selfie look (see mapping.ts).
 *
 * Anchoring maths lives in the pure, unit-tested `anchors.ts`:
 *  - NECKLACE → the BODY (PoseLandmarker shoulders 11/12). Spans the neck,
 *    pendant on the upper chest, kept strictly UPRIGHT and decoupled from the
 *    head. The chain wraps toward the back and a throat occluder hides the rear.
 *  - EARRINGS → each ear's landmark cluster (right 234/127/93, left 454/356/323),
 *    dropped to the lobe and kept in front. They fade out once the head yaw
 *    passes ~25° (from the facial transformation matrix) instead of drifting on
 *    near-profile ears.
 */

const ANCHOR_IDX: AnchorIndices = {
  leftShoulder: POSE.leftShoulder,
  rightShoulder: POSE.rightShoulder,
  chin: FACE.chin,
};

export class FaceTryOn {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  private camera: THREE.OrthographicCamera;

  private readonly flash: THREE.PointLight;
  private readonly necklace: BuiltPiece;
  private readonly earringR: BuiltPiece;
  private readonly earringL: BuiltPiece;
  private readonly earringMats: THREE.Material[] = []; // for the yaw fade
  private readonly occluders: FaceOccluders;

  private showNecklace = true;
  private showEarrings = true;
  private elapsed = 0;
  private clock = new THREE.Clock();
  private viewW = 1;
  private viewH = 1;
  private readonly tmpMat = new THREE.Matrix4();
  private readonly tmpEuler = new THREE.Euler();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly video: HTMLVideoElement,
  ) {
    const isMobile = window.matchMedia('(pointer: coarse)').matches;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.5 : 2));
    this.renderer.setClearColor(0x000000, 0); // transparent → video shows through
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    // y-up pixel-space camera at z=1000 looking down -Z, so larger world Z is
    // closer to the camera (front-of-occluder). Set per-frame in resize().
    this.camera = new THREE.OrthographicCamera(0, 1, 1, 0, 1, 2000);
    this.camera.position.z = 1000;

    this.scene.environment = createStudioEnvironment(this.renderer);

    const key = new THREE.DirectionalLight(0xfff4e2, 2.0);
    key.position.set(0.4, 1, 1);
    const fill = new THREE.DirectionalLight(0xbcd2ff, 0.6);
    fill.position.set(-1, 0, 0.5);
    this.flash = new THREE.PointLight(0xffffff, 1.2, 0, 0);
    this.scene.add(key, fill, this.flash);

    // Materials. The necklace keeps low transmission so the gems stay bright
    // over the transparent video. The earrings get their OWN materials (marked
    // transparent) so they can be faded out on a head turn independently.
    const necklaceMetal = makeMetalMaterial('yellow');
    const necklaceGem = makeGemMaterial('diamond');
    necklaceGem.transmission = 0.25;
    necklaceGem.envMapIntensity = 1.6;

    const earringMetal = makeMetalMaterial('yellow');
    earringMetal.transparent = true;
    const earringGem = makeGemMaterial('diamond');
    earringGem.transmission = 0; // opaque so opacity fades cleanly
    earringGem.envMapIntensity = 1.8;
    earringGem.transparent = true;
    this.earringMats.push(earringMetal, earringGem);

    const assign = (
      piece: BuiltPiece,
      metal: THREE.Material,
      gem: THREE.Material,
    ): BuiltPiece => {
      for (const m of piece.metalMeshes) m.material = metal;
      for (const m of piece.gemMeshes) m.material = gem;
      // Jewellery draws after the depth-only occluders.
      piece.group.renderOrder = 1;
      piece.group.traverse((o) => (o.renderOrder = 1));
      this.scene.add(piece.group);
      return piece;
    };
    this.necklace = assign(buildNecklace(), necklaceMetal, necklaceGem);
    this.earringR = assign(buildPiece('earring'), earringMetal, earringGem);
    this.earringL = assign(buildPiece('earring'), earringMetal, earringGem);

    this.occluders = createFaceOccluders();
    this.scene.add(this.occluders.group);

    this.resize();
  }

  setActive(necklace: boolean, earrings: boolean): void {
    this.showNecklace = necklace;
    this.showEarrings = earrings;
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.viewW = w;
    this.viewH = h;
    this.renderer.setSize(w, h, false);
    // y-up pixel-space camera: (left,right,top,bottom) = (0,W,H,0).
    this.camera.left = 0;
    this.camera.right = w;
    this.camera.top = h;
    this.camera.bottom = 0;
    this.camera.updateProjectionMatrix();
  }

  /** Anchor + render one frame from a detection result. */
  update(frame: FaceFrame): boolean {
    this.elapsed += this.clock.getDelta();
    // Moving flash → travelling sparkle on the facets.
    const t = this.elapsed;
    this.flash.position.set(
      this.viewW * 0.5 + Math.cos(t * 1.4) * this.viewW * 0.4,
      this.viewH * 0.6,
      600,
    );

    const lm = frame.landmarks;
    if (!lm) {
      this.necklace.group.visible = false;
      this.earringR.group.visible = false;
      this.earringL.group.visible = false;
      this.occluders.group.visible = false;
      this.render();
      return false;
    }

    const P = makeCoverMapper(this.video.videoWidth, this.video.videoHeight, this.viewW, this.viewH);
    // Stable per-ear anchors from landmark clusters (on the ear, not the jaw).
    const earR = avgScreen(lm, P, EAR_R);
    const earL = avgScreen(lm, P, EAR_L);
    const chin = P(lm[FACE.chin]);
    const fw = dist(earR, earL) || 1;
    const earMidX = (earR.x + earL.x) / 2;

    this.occluders.group.visible = this.showNecklace;

    // ---- Necklace: anchored to the BODY (shoulders), kept upright ----
    this.necklace.group.visible = this.showNecklace;
    if (this.showNecklace) {
      const a = necklaceAnchor(frame.pose, P, ANCHOR_IDX, fw, earMidX, chin, lm[FACE.chin].y);
      this.necklace.group.position.set(a.x, a.y, a.z);
      this.necklace.group.quaternion.identity(); // UPRIGHT — ignores head pose
      this.necklace.group.scale.setScalar(a.scale);
      // Throat occluder: a cylinder down the neck from the chin to the neck base,
      // pushed BACK in Z so its front surface sits just behind the front chain —
      // it hides the rear/side chain that wraps behind the neck, not the drape.
      const topY = chin.y;
      const botY = a.y - fw * 0.25;
      this.occluders.neck.position.set(a.x, (topY + botY) / 2, -fw * 0.35);
      this.occluders.neck.scale.set(fw * 0.34, Math.abs(topY - botY) + fw * 0.2, fw * 0.3);
    }

    // ---- Earrings: pinned to each ear, faded out past ~25° of head yaw ----
    const yawMag = this.headYaw(frame);
    const opacity = earringOpacity(yawMag);
    for (const m of this.earringMats) m.opacity = opacity;
    const earringsOn = this.showEarrings && opacity > 0.02;
    this.earringR.group.visible = earringsOn;
    this.earringL.group.visible = earringsOn;
    if (earringsOn) {
      this.applyEarring(this.earringR, earringAnchor(earR, fw, +1));
      this.applyEarring(this.earringL, earringAnchor(earL, fw, -1));
    }

    this.render();
    return true;
  }

  /** Head-yaw magnitude (radians) from the facial transformation matrix. */
  private headYaw(frame: FaceFrame): number {
    if (!frame.matrix || frame.matrix.length !== 16) return 0;
    this.tmpMat.fromArray(frame.matrix);
    this.tmpEuler.setFromRotationMatrix(this.tmpMat, 'YXZ');
    return Math.abs(this.tmpEuler.y);
  }

  private applyEarring(piece: BuiltPiece, a: EarringAnchor): void {
    piece.group.position.set(a.x, a.y, a.z);
    piece.group.quaternion.identity();
    piece.group.scale.setScalar(a.scale);
  }

  private render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.renderer.dispose();
  }
}
