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
import { dist, FACE, makeCoverMapper, POSE, type Landmark, type Vec2 } from './mapping';
import { type FaceFrame } from './faceLandmarker';

/**
 * The Phase 2 face try-on scene (BUILD_SPEC §4–5).
 *
 * Renders 3D jewellery on a transparent canvas overlaid on the camera, in
 * NATIVE (un-mirrored) camera space with a y-up orthographic camera in view
 * pixels; the page CSS-mirrors both the video and this canvas together for the
 * selfie look (see mapping.ts).
 *
 * Anchoring (designed so head turns don't break it):
 *  - NECKLACE → the BODY. PoseLandmarker shoulders (11 left / 12 right): the
 *    chain spans shoulder-to-shoulder and the pendant rests on the upper chest.
 *    Kept strictly UPRIGHT (identity) and decoupled from head yaw/pitch/roll.
 *    Pose is validated (shoulders below the chin, sane span) and clamped, with a
 *    face-based fallback, so a bad detection can't fling it to the jaw.
 *  - EARRINGS → the face mesh. Each is pinned to its own ear (234 right /
 *    454 left), dropped straight down (screen-vertical) to the lobe. Occlusion
 *    uses the INTER-EAR depth difference (≈0 facing forward ⇒ both visible; the
 *    ear that turns away gets a large +Δ ⇒ pushed behind the head occluder and
 *    hidden). Using the difference — not absolute Z — is what keeps both
 *    earrings visible when facing forward.
 */

// Tunable anchoring constants (lengths are × face width `fw`).
const EAR_FRONT_Z = 0.45; // earring Z facing forward — safely in front of the head occluder
const EAR_DEPTH_GAIN = 4.5; // how strongly a head turn pushes the far earring back in Z
const EAR_SCALE = 0.16; // earring size
const HEAD_OCC = { rx: 0.6, ry: 0.82, rz: 0.55 }; // head occluder ellipsoid radii (× fw)

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
    const earR = P(lm[FACE.earR]);
    const earL = P(lm[FACE.earL]);
    const chin = P(lm[FACE.chin]);
    const fw = dist(earR, earL) || 1;

    this.occluders.group.visible = true;

    // ---- Necklace: anchored to the BODY (shoulders), kept upright ----
    this.necklace.group.visible = this.showNecklace;
    if (this.showNecklace) {
      const a = this.necklaceAnchor(frame, P, lm, fw);
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
      const dz = lm[FACE.earR].z - lm[FACE.earL].z;
      this.placeEarring(this.earringR, earR, +dz, fw, +1);
      this.placeEarring(this.earringL, earL, -dz, fw, -1);
      // Head occluder centred on the ear line so it reaches both lobes.
      const hx = (earR.x + earL.x) / 2;
      const hy = (earR.y + earL.y) / 2;
      this.occluders.head.position.set(hx, hy, 0);
      this.occluders.head.scale.set(fw * HEAD_OCC.rx, fw * HEAD_OCC.ry, fw * HEAD_OCC.rz);
    }

    this.render();
    return true;
  }

  /**
   * Necklace anchor + scale. Prefers PoseLandmarker shoulders (11/12) so the
   * chain spans shoulder-to-shoulder on the BODY (stable when the head turns).
   * The pose is accepted only if both shoulders are clearly below the chin with
   * a plausible span; otherwise it falls back to a face-based upright anchor.
   */
  private necklaceAnchor(
    frame: FaceFrame,
    P: (l: Landmark) => Vec2,
    lm: Landmark[],
    fw: number,
  ): { x: number; y: number; z: number; scale: number } {
    const lS = frame.pose?.[POSE.leftShoulder];
    const rS = frame.pose?.[POSE.rightShoulder];
    const chinNormY = lm[FACE.chin].y; // normalised (y-down)
    const shouldersValid =
      !!lS &&
      !!rS &&
      (lS.visibility ?? 1) > 0.5 &&
      (rS.visibility ?? 1) > 0.5 &&
      // Shoulders must sit clearly below the chin in the image (y-down).
      lS.y > chinNormY + 0.06 &&
      rS.y > chinNormY + 0.06;

    if (shouldersValid) {
      const a = P(lS!);
      const b = P(rS!);
      const span = dist(a, b);
      // Reject implausible spans (mis-detection); face width is ~ear-to-ear.
      if (span > fw * 1.1 && span < fw * 4.5) {
        const midX = (a.x + b.x) / 2;
        const midY = (a.y + b.y) / 2;
        // Lift toward the neck base so the chain rests on the upper chest.
        // Model endpoints are at X=±1 → scale = span/2 lands them on the shoulders.
        return { x: midX, y: midY + span * 0.08, z: 0, scale: span * 0.5 };
      }
    }

    // Fallback: face-based, straight DOWN from the chin (screen-vertical → stays
    // upright, doesn't swing with head roll/pitch).
    const chin = P(lm[FACE.chin]);
    return { x: chin.x, y: chin.y - fw * 0.6, z: 0, scale: fw * 0.95 };
  }

  /**
   * Pin an earring to one ear and drop it straight DOWN (screen-vertical) to the
   * lobe. `relDepth` is this ear's MediaPipe Z minus the other ear's: ≈0 facing
   * forward (earring in front, visible), large+ when this ear turns away
   * (earring pushed behind the head occluder, hidden). `side` is +1 for the
   * person's right ear, -1 for the left (small outward nudge onto the ear edge).
   */
  private placeEarring(
    piece: BuiltPiece,
    ear: Vec2,
    relDepth: number,
    fw: number,
    side: number,
  ): void {
    const scale = fw * EAR_SCALE;
    const x = ear.x + side * fw * 0.04;
    const lobeY = ear.y - fw * 0.16; // straight down to the lobe (screen-vertical)
    // Forward → EAR_FRONT_Z (in front of occluder); far ear (relDepth > 0) → back.
    const z = fw * (EAR_FRONT_Z - relDepth * EAR_DEPTH_GAIN);
    // Hook is at local y≈0.9; offset down so the hook sits on the lobe.
    piece.group.position.set(x, lobeY - 0.9 * scale, z);
    piece.group.quaternion.identity();
    piece.group.scale.setScalar(scale);
  }

  private render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.renderer.dispose();
  }
}
