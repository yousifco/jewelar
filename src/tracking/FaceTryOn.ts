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
import {
  avgScreen,
  avgZ,
  dist,
  EAR_L,
  EAR_R,
  FACE,
  makeCoverMapper,
  POSE,
} from './mapping';
import {
  earringAnchor,
  HEAD_OCC,
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
 * All anchoring maths lives in the pure, unit-tested `anchors.ts`:
 *  - NECKLACE → the BODY (PoseLandmarker shoulders 11/12). Spans shoulder-to-
 *    shoulder, pendant on the upper chest, kept strictly UPRIGHT and decoupled
 *    from the head — so it does not swing when the head turns. Face-based
 *    fallback when the shoulders aren't usable.
 *  - EARRINGS → each ear's landmark cluster (right 234/227/137, left 454/447/
 *    366), dropped to the lobe. Occlusion uses the inter-ear depth difference so
 *    both are visible facing forward and the far one is hidden on a turn.
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
  private readonly occluders: FaceOccluders;

  private showNecklace = true;
  private showEarrings = true;
  private elapsed = 0;
  private clock = new THREE.Clock();
  private viewW = 1;
  private viewH = 1;

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

    // Shared materials for all AR pieces. Lower transmission than the orbit
    // viewer so the gems stay bright over the transparent video (no scene
    // behind them to refract).
    const metal = makeMetalMaterial('yellow');
    const gem = makeGemMaterial('diamond');
    gem.transmission = 0.25;
    gem.envMapIntensity = 1.6;

    const assign = (piece: BuiltPiece): BuiltPiece => {
      for (const m of piece.metalMeshes) m.material = metal;
      for (const m of piece.gemMeshes) m.material = gem;
      // Jewellery draws after the depth-only occluders.
      piece.group.renderOrder = 1;
      piece.group.traverse((o) => (o.renderOrder = 1));
      this.scene.add(piece.group);
      return piece;
    };
    this.necklace = assign(buildNecklace());
    this.earringR = assign(buildPiece('earring'));
    this.earringL = assign(buildPiece('earring'));

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

    this.occluders.group.visible = true;

    // ---- Necklace: anchored to the BODY (shoulders), kept upright ----
    this.necklace.group.visible = this.showNecklace;
    if (this.showNecklace) {
      const a = necklaceAnchor(frame.pose, P, ANCHOR_IDX, fw, earMidX, chin, lm[FACE.chin].y);
      this.necklace.group.position.set(a.x, a.y, a.z);
      this.necklace.group.quaternion.identity(); // UPRIGHT — ignores head pose
      this.necklace.group.scale.setScalar(a.scale);
      // Neck occluder at the neck (above the drape, behind it in Z) so it never
      // covers the front chain.
      this.occluders.neck.position.set(a.x, (chin.y + a.y) / 2, -fw * 0.2);
      this.occluders.neck.scale.set(fw * 0.45, fw * 1.0, fw * 0.3);
    }

    // ---- Earrings: pinned to each ear, far ear occluded on turn ----
    this.earringR.group.visible = this.showEarrings;
    this.earringL.group.visible = this.showEarrings;
    if (this.showEarrings) {
      // Inter-ear depth difference: ~0 facing forward, large for the far ear.
      const dz = avgZ(lm, EAR_R) - avgZ(lm, EAR_L);
      this.applyEarring(this.earringR, earringAnchor(earR, +dz, fw, +1));
      this.applyEarring(this.earringL, earringAnchor(earL, -dz, fw, -1));
      // Head occluder centred on the ear line so it reaches both lobes.
      this.occluders.head.position.set(earMidX, (earR.y + earL.y) / 2, 0);
      this.occluders.head.scale.set(fw * HEAD_OCC.rx, fw * HEAD_OCC.ry, fw * HEAD_OCC.rz);
    }

    this.render();
    return true;
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
