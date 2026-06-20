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
 * The Phase 2 face try-on scene.
 *
 * Renders 3D jewellery (necklace + earrings from the Phase 1 engine) on a
 * transparent canvas overlaid on the camera. Everything is rendered in NATIVE
 * (un-mirrored) camera space using a y-up orthographic camera in view pixels;
 * the page CSS-mirrors both the video and this canvas together for the selfie
 * look (see mapping.ts).
 *
 * Anchoring (the bit that makes it look worn when the head turns):
 *  - Earrings are pinned RIGIDLY to each ear's tragus landmark (234/454) and
 *    drop straight down (screen-vertical), so each tracks its own ear; the far
 *    earring is pushed back in Z by the landmark depth and hidden by the head
 *    occluder when the head turns away.
 *  - The necklace is anchored to the BODY via PoseLandmarker shoulders (11/12),
 *    kept UPRIGHT and decoupled from head yaw/roll/pitch, so it stays on the
 *    neck/chest as the head turns. It falls back to a face-based, upright anchor
 *    only when the shoulders aren't detected.
 */

// Tunable anchoring constants (px are relative to face width `fw`).
const BASE_Z = 0;
const EAR_DEPTH_GAIN = 14; // how strongly head-turn pushes an earring fwd/back in Z
const EAR_BASE_Z = 0.28; // default earring Z (× fw), in front of the head occluder

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
      const anchor = this.necklaceAnchor(frame, P, chin, fw);
      this.necklace.group.position.set(anchor.x, anchor.y, BASE_Z + fw * 0.05);
      this.necklace.group.quaternion.identity(); // UPRIGHT — ignores head yaw/roll/pitch
      this.necklace.group.scale.setScalar(anchor.scale);
      // Neck/jaw occluder at the actual neck (above the drape) so it can hide
      // anything passing behind the neck without covering the chain.
      this.occluders.neck.position.set(anchor.x, chin.y - fw * 0.35, BASE_Z);
      this.occluders.neck.scale.set(fw * 0.4, fw * 1.2, fw * 0.28);
    }

    // ---- Earrings: pinned to each ear's tragus, dangling straight down ----
    this.earringR.group.visible = this.showEarrings;
    this.earringL.group.visible = this.showEarrings;
    if (this.showEarrings) {
      this.placeEarring(this.earringR, earR, lm[FACE.earR], fw, +1);
      this.placeEarring(this.earringL, earL, lm[FACE.earL], fw, -1);
      // Head occluder (taller, reaching the lobes) hides the far earring when
      // the head is turned away.
      const hx = (earR.x + earL.x) / 2;
      const hy = (earR.y + earL.y) / 2;
      this.occluders.head.position.set(hx, hy, BASE_Z);
      this.occluders.head.scale.set(fw * 0.58, fw * 0.85, fw * 0.55);
    }

    this.render();
    return true;
  }

  /**
   * Necklace anchor + scale. Prefers PoseLandmarker shoulders (11/12) — body
   * points that DON'T move when the head turns — using their midpoint (lifted
   * toward the neck) and span for width. Falls back to a face-based, upright
   * anchor (chin projected straight DOWN in screen space) when no body is found.
   */
  private necklaceAnchor(
    frame: FaceFrame,
    P: (l: Landmark) => Vec2,
    chin: Vec2,
    fw: number,
  ): { x: number; y: number; scale: number } {
    const pose = frame.pose;
    const lS = pose?.[POSE.leftShoulder];
    const rS = pose?.[POSE.rightShoulder];
    if (lS && rS) {
      const a = P(lS);
      const b = P(rS);
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      const shoulderW = dist(a, b) || fw * 2;
      // Lift toward the neck (above the shoulder line) and scale to ~0.6× span.
      return { x: midX, y: midY + shoulderW * 0.18, scale: shoulderW * 0.32 };
    }
    // Fallback: straight down from the chin (screen-vertical → stays upright,
    // doesn't swing with head roll/pitch).
    return { x: chin.x, y: chin.y - fw * 0.7, scale: fw * 0.68 };
  }

  /**
   * Pin an earring rigidly to one ear's tragus landmark, dropping straight down
   * in screen space to the lobe so it stays on the ear as the head turns.
   * `side` is +1 for the person's right ear, -1 for the left (outward nudge).
   */
  private placeEarring(
    piece: BuiltPiece,
    earScreen: Vec2,
    earLm: Landmark,
    fw: number,
    side: number,
  ): void {
    // Straight-down (screen-vertical) drop to the lobe + a small outward nudge
    // onto the ear edge. No face-down vector → no drift toward the mouth.
    const x = earScreen.x + side * fw * 0.04;
    const y = earScreen.y - fw * 0.06;
    const z = earLm.z;
    const scale = fw * 0.15; // ~30% smaller than before
    // MediaPipe z is negative toward the camera, so the nearer ear is pushed
    // forward (+Z, in front of the head occluder) and the far ear behind it.
    const zoff = -z * fw * EAR_DEPTH_GAIN;
    // The earring's hook is at local y≈0.9; offset down so the hook lands on the
    // lobe and the drop dangles beneath it.
    piece.group.position.set(x, y - 0.9 * scale, BASE_Z + fw * EAR_BASE_Z + zoff);
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
