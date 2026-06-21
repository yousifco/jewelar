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
  earringDepth,
  earringOffset,
  headYaw,
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
 *  - NECKLACE → the BODY (PoseLandmarker shoulders 11/12), upright. A simple
 *    chest drape; its tucked-back TOP is hidden by a depth-only neck occluder so
 *    the chain reads as coming from behind the neck (no loop up to the ears).
 *  - EARRINGS → ear/cheek landmark (right 234, left 454) + a yaw-blended offset
 *    (front-on outward beside the ear; turned, the matrix-rotated ear anchor).
 *    Each is placed at its true ear DEPTH so a depth-only head proxy hides the
 *    far one when the head turns. Stones are fully opaque pearl-white.
 *
 * Both occluders (head ellipsoid, neck cylinder) write depth only
 * (colorWrite:false) and render before the jewellery — see faceOccluders.ts.
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

    // Real brilliant-cut diamond material for ALL stones (pendant centre +
    // earring drops/accents). The stones already use the engine's faceted hull
    // geometry; this material makes them read as sparkling clear diamonds: high
    // transmission lets you see THROUGH the table to the refracted pavilion
    // facets, ior 2.42 + clearcoat give crisp facet glints, high envMapIntensity
    // reflects the bright studio panels for facet light/dark CONTRAST (even on a
    // plain wall), and a subtle iridescence fakes dispersion "fire" (true
    // dispersion needs three r167+).
    const diamond = (): THREE.MeshPhysicalMaterial => {
      const m = makeGemMaterial('diamond'); // ior 2.42, roughness 0, white attenuation
      m.transmission = 0.9;
      m.roughness = 0.05;
      m.thickness = 0.5;
      m.clearcoat = 1.0;
      m.clearcoatRoughness = 0.0;
      m.envMapIntensity = 2.4;
      m.iridescence = 0.25; // subtle rainbow "fire" on the facet edges
      m.iridescenceIOR = 1.3;
      m.iridescenceThicknessRange = [120, 400];
      return m;
    };
    // One shared diamond + one shared gold for the necklace and both earrings.
    const metalMat = makeMetalMaterial('yellow');
    const gemMat = diamond();

    const assign = (piece: BuiltPiece): BuiltPiece => {
      for (const m of piece.metalMeshes) m.material = metalMat;
      for (const m of piece.gemMeshes) m.material = gemMat;
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
    // Each occluder only writes depth when its piece is shown (otherwise a stale
    // proxy could hide the other piece).
    this.occluders.neck.visible = this.showNecklace;
    this.occluders.head.visible = this.showEarrings;

    // ---- Necklace: anchored to the BODY (shoulders), kept upright ----
    this.necklace.group.visible = this.showNecklace;
    if (this.showNecklace) {
      const a = necklaceAnchor(frame.pose, P, ANCHOR_IDX, fw, earMidX, chin, lm[FACE.chin].y);
      this.necklace.group.position.set(a.x, a.y, a.z);
      this.necklace.group.quaternion.identity(); // UPRIGHT — ignores head pose
      this.necklace.group.scale.setScalar(a.scale);
      // Neck occluder over the chain's tucked-back TOP, so it disappears behind
      // the neck/jaw. Front face sits just behind the front drape (≈ z 0); kept
      // LOW (around the neck base) so it never reveals a loop near the ears.
      this.occluders.neck.position.set(a.x, a.y + a.scale * 0.25, a.z - a.scale * 0.54);
      this.occluders.neck.scale.set(a.scale * 1.15, a.scale * 1.4, a.scale * 0.5);
    }

    // ---- Earrings: blend FRONT-facing (outward) ↔ ear-anchored (turned) ----
    this.earringR.group.visible = this.showEarrings;
    this.earringL.group.visible = this.showEarrings;
    if (this.showEarrings) {
      const faceCenterX = P(lm[FACE.noseTip]).x;
      const offR = earringOffset(frame.matrix, earR.x, faceCenterX, fw, +1);
      const offL = earringOffset(frame.matrix, earL.x, faceCenterX, fw, -1);
      const lobeR = { x: earR.x + offR.x, y: earR.y + offR.y };
      const lobeL = { x: earL.x + offL.x, y: earL.y + offL.y };
      // True ear depth: facing forward both sit in front of the head proxy;
      // turned, the far ear (larger landmark Z) is pushed behind it. Magnitude
      // from the sign-safe yaw, side from the inter-ear depth difference.
      const yawMag = Math.abs(headYaw(frame.matrix));
      const dz = avgZ(lm, EAR_R) - avgZ(lm, EAR_L);
      this.applyEarring(this.earringR, earringAnchor(lobeR, earringDepth(yawMag, +dz, fw), fw));
      this.applyEarring(this.earringL, earringAnchor(lobeL, earringDepth(yawMag, -dz, fw), fw));
      // Head proxy: ellipsoid over the head, reaching down to the mouth/jaw so
      // the far earring (which drifts toward the nose/mouth when turned) is hidden
      // behind it. The near earring sits in front and stays visible.
      this.occluders.head.position.set(earMidX, (earR.y + earL.y) / 2 - fw * 0.12, 0);
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
