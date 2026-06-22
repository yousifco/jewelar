import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  buildBracelet,
  buildHandRing,
  createStudioEnvironment,
  dressImportedModel,
  makeGemMaterial,
  makeMetalMaterial,
  type BuiltPiece,
} from '../engine';
import { createHandOccluders, type HandOccluders } from '../occlusion/handOccluders';
import { dist, HAND, lerp, makeCoverMapper, normalize2, type Landmark } from './mapping';
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
const RING_W = 0.17; // ring band radius ÷ palm width (procedural fallback)
// Ring band radius ÷ finger width (dist ringMCP↔pinkyMCP). The band radius
// should ≈ half the finger, so the hole hugs the finger. Tune via the console
// logs (point 6) if the GLB ring sits loose/tight.
const RING_FINGER_W = 0.62;
const BRACELET_W = 0.55; // bracelet band radius ÷ palm width
const FINGER_OCC = 0.78; // finger occluder radius ÷ band radius
const FOREARM_OCC = 0.9;
const LOG_EVERY = 0.5; // seconds between ring-transform logs
// Default spin about the finger axis (deg) to seat the setting on TOP of the
// finger (back-of-hand side); 180° flips it from the palm side. Overridden
// per-model by the manifest's spinDeg. The live hand roll composes on top.
const DEFAULT_SPIN_DEG = 180;
// MediaPipe reports handedness on the raw (un-mirrored) selfie frame, so the
// dorsal (back-of-hand) normal from across×finger flips sign between hands. We
// negate it for ONE label so the SAME RING_SPIN_DEG lands the setting on top for
// both hands. If the setting is correct on one hand but on the palm for the
// other, flip this label.
const FLIP_DORSAL_FOR: 'Left' | 'Right' = 'Left';

// DIAGNOSTIC: render the loaded GLB with its OWN materials (the Meshy gold +
// baked white stones live in the model's baseColor texture) rather than
// overriding with our gold/diamond shader. The model is a single fused mesh, so
// our override would flatten it to plain gold and lose the pavé stones.
const USE_ORIGINAL_MATERIALS = true;

/** Fit details surfaced to the debug overlay after a GLB is attached. */
export interface RingFitInfo {
  meshes: number;
  materials: number;
  bbox: { x: number; y: number; z: number };
  holeAxis: 'x' | 'y' | 'z';
  rotationDeg: { x: number; y: number; z: number };
  normalizeScale: number;
  materialsMode: 'original' | 'gold/diamond';
}

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

  // Shared gold + diamond materials (also dress a loaded GLB ring).
  private readonly metalMat: THREE.MeshStandardMaterial;
  private readonly gemMat: THREE.MeshPhysicalMaterial;

  // Per-model placement from the manifest (applied to a loaded GLB ring).
  private ringSpinDeg = DEFAULT_SPIN_DEG;
  private ringScale = 1;

  private showRing = true;
  private showBracelet = false;
  private elapsed = 0;
  private clock = new THREE.Clock();
  private viewW = 1;
  private viewH = 1;

  // Console tuning aids (point 6): track detection edges + throttle logs.
  private wasTracked: boolean | null = null;
  private lastLog = 0;
  private customRing = false; // a GLB swapped in → use finger-width scaling
  private loggedSource: boolean | null = null; // last logged render source

  // Scratch vectors (avoid per-frame allocation).
  private readonly axis = new THREE.Vector3();
  private readonly zAxis = new THREE.Vector3();
  private readonly xAxis = new THREE.Vector3();
  private readonly basis = new THREE.Matrix4();
  private readonly fingerVec = new THREE.Vector3();
  private readonly acrossVec = new THREE.Vector3();
  private readonly dorsalVec = new THREE.Vector3();

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
    this.metalMat = metal;
    this.gemMat = gem;

    const assign = (piece: BuiltPiece): BuiltPiece => {
      for (const m of piece.metalMeshes) m.material = metal;
      for (const m of piece.gemMeshes) m.material = gem;
      piece.group.renderOrder = 1;
      piece.group.traverse((o) => (o.renderOrder = 1));
      this.scene.add(piece.group);
      return piece;
    };
    // Build the procedural ring up front — it's the 404 / load-error fallback.
    // When the per-handle GLB loads, swapRingModel removes it and attaches the
    // GLB instead (so only one ever shows).
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

  /**
   * Real catalog model hook: load the per-handle .glb ring, attach it to the
   * anchored ring group, and re-orient so its hole axis runs along the band's
   * local +Y (which the per-frame anchoring points across the finger). Applies
   * the manifest `scale` + `spinDeg`. By default (USE_ORIGINAL_MATERIALS) it
   * keeps the model's OWN Meshy materials so baked stones survive; flip the flag
   * to re-dress with our gold/diamond. On error the procedural ring stays.
   */
  async loadCustomRing(
    url: string,
    settings?: { scale?: number; spinDeg?: number },
  ): Promise<{ ok: boolean; error?: string; info?: RingFitInfo }> {
    this.ringScale = settings?.scale ?? 1;
    this.ringSpinDeg = settings?.spinDeg ?? DEFAULT_SPIN_DEG;
    // Log the FINAL absolute URL the loader will fetch (confirms /jewelar/… is
    // not doubled to /jewelar/jewelar/…). A leading-slash path resolves against
    // the origin, so this should be https://<host>/jewelar/models/<handle>.glb.
    const absUrl = new URL(url, window.location.href).href;
    // eslint-disable-next-line no-console
    console.info('[hand] GLTFLoader.load → input:', url, '| absolute:', absUrl, '| settings:', {
      scale: this.ringScale,
      spinDeg: this.ringSpinDeg,
    });

    return new Promise((resolve) => {
      new GLTFLoader().load(
        url,
        (gltf) => {
          try {
            let meshCount = 0;
            const mats = new Set<string>();
            gltf.scene.traverse((o) => {
              const mesh = o as THREE.Mesh;
              if (!mesh.isMesh) return;
              meshCount++;
              const m = mesh.material;
              (Array.isArray(m) ? m : [m]).forEach((x) => x && mats.add(x.uuid));
            });
            // eslint-disable-next-line no-console
            console.info(
              `[hand] GLB loaded OK (${meshCount} mesh${meshCount === 1 ? '' : 'es'}, ` +
                `${mats.size} material${mats.size === 1 ? '' : 's'}) ←`,
              absUrl,
            );
            if (meshCount === 0) throw new Error('GLB contains no meshes');

            if (USE_ORIGINAL_MATERIALS) {
              // eslint-disable-next-line no-console
              console.info('[hand] keeping ORIGINAL Meshy materials (no gold/diamond override)');
            } else {
              dressImportedModel(gltf.scene, {
                metal: this.metalMat,
                gem: this.gemMat,
                label: 'hand',
              });
            }

            const fit = this.swapRingModel(gltf.scene);
            const info: RingFitInfo = {
              meshes: meshCount,
              materials: mats.size,
              materialsMode: USE_ORIGINAL_MATERIALS ? 'original' : 'gold/diamond',
              ...fit,
            };
            this.customRing = true;
            // eslint-disable-next-line no-console
            console.info('[hand] GLB attached to hand anchor (procedural ring removed)', info);
            resolve({ ok: true, info });
          } catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            // eslint-disable-next-line no-console
            console.error('[hand] GLB post-process FAILED:', err);
            resolve({ ok: false, error });
          }
        },
        (ev) => {
          if (ev.lengthComputable) {
            // eslint-disable-next-line no-console
            console.info(`[hand] GLB downloading ${((ev.loaded / ev.total) * 100).toFixed(0)}%`);
          }
        },
        (err) => {
          const error = err instanceof Error ? err.message : String(err);
          // eslint-disable-next-line no-console
          console.error('[hand] GLTFLoader onError for', absUrl, '→', err);
          resolve({ ok: false, error: `load error: ${error}` });
        },
      );
    });
  }

  /**
   * Normalise a loaded ring into the procedural local convention: hole axis
   * along +Y, band radius ≈ 1 (so the per-frame `scale.setScalar(r)` makes the
   * world band radius ≈ r). The hole axis is taken as the model's THINNEST
   * bounding-box axis (a band/torus is thin through its hole), then rotated to
   * +Y; the band diameter is the larger of the remaining two extents.
   */
  private swapRingModel(obj: THREE.Object3D): {
    bbox: { x: number; y: number; z: number };
    holeAxis: 'x' | 'y' | 'z';
    rotationDeg: { x: number; y: number; z: number };
    normalizeScale: number;
  } {
    // Centre the model's content at the origin.
    const box = new THREE.Box3().setFromObject(obj);
    if (box.isEmpty()) throw new Error('loaded ring has an empty bounding box');
    const center = box.getCenter(new THREE.Vector3());
    obj.position.sub(center);

    const wrap = new THREE.Group();
    wrap.add(obj);

    // Rotate the thinnest axis (the hole) to local +Y so the band wraps the
    // finger (the per-frame anchoring points local +Y across the finger).
    const size = box.getSize(new THREE.Vector3());
    const holeAxis = size.x <= size.y && size.x <= size.z ? 'x' : size.y <= size.z ? 'y' : 'z';
    if (holeAxis === 'x') wrap.rotation.z = Math.PI / 2; // x → y
    else if (holeAxis === 'z') wrap.rotation.x = -Math.PI / 2; // z → y
    const rotationDeg = {
      x: +THREE.MathUtils.radToDeg(wrap.rotation.x).toFixed(0),
      y: +THREE.MathUtils.radToDeg(wrap.rotation.y).toFixed(0),
      z: +THREE.MathUtils.radToDeg(wrap.rotation.z).toFixed(0),
    };

    // Scale so the band radius ≈ 1 (band diameter = max extent in the XZ plane).
    // The per-frame anchoring then scales this by the finger width.
    wrap.updateMatrixWorld(true);
    const box2 = new THREE.Box3().setFromObject(wrap);
    const s2 = box2.getSize(new THREE.Vector3());
    const bandDia = Math.max(s2.x, s2.z) || 1;
    const normalizeScale = 2 / bandDia; // diameter → 2 ⇒ radius → 1
    wrap.scale.setScalar(normalizeScale);

    wrap.renderOrder = 1;
    wrap.traverse((o) => (o.renderOrder = 1));

    const bbox = { x: +size.x.toFixed(3), y: +size.y.toFixed(3), z: +size.z.toFixed(3) };
    // eslint-disable-next-line no-console
    console.info('[hand] ring model normalised', {
      holeAxis,
      bbox,
      bandDiameter: +bandDia.toFixed(3),
      normalizeScale: +normalizeScale.toFixed(3),
      rotationDeg,
    });

    for (const child of [...this.ring.group.children]) this.ring.group.remove(child);
    this.ring.group.add(wrap);
    return { bbox, holeAxis, rotationDeg, normalizeScale };
  }

  /** Log only on a detection edge (hand found ↔ lost) to avoid per-frame spam. */
  private logTracked(tracked: boolean): void {
    if (this.wasTracked === tracked) return;
    this.wasTracked = tracked;
    // eslint-disable-next-line no-console
    console.info(`[hand] hand ${tracked ? 'detected' : 'not detected'}`);
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
      this.logTracked(false);
      this.ring.group.visible = false;
      this.bracelet.group.visible = false;
      this.occluders.group.visible = false;
      this.render();
      return false;
    }
    this.logTracked(true);

    const P = makeCoverMapper(this.video.videoWidth, this.video.videoHeight, this.viewW, this.viewH);
    const idx = P(lm[HAND.indexMCP]);
    const pinky = P(lm[HAND.pinkyMCP]);
    const palmW = dist(idx, pinky) || 1;
    this.occluders.group.visible = true;

    // ---- Ring on the ring finger (base, landmarks 13→14) ----
    this.ring.group.visible = this.showRing;
    this.occluders.finger.visible = this.showRing;
    if (this.showRing && this.loggedSource !== this.customRing) {
      this.loggedSource = this.customRing;
      // eslint-disable-next-line no-console
      console.info(`[hand] ring render source = ${this.customRing ? 'GLB' : 'PROCEDURAL'}`);
    }
    if (this.showRing) {
      const mcp = P(lm[HAND.ringMCP]); // 13
      const pip = P(lm[HAND.ringPIP]); // 14
      // Seat the band at the finger BASE (closer to the MCP knuckle).
      const cx = lerp(mcp.x, pip.x, 0.42);
      const cy = lerp(mcp.y, pip.y, 0.42);
      // Scale the band diameter to the finger width. Proxy = ring-finger MCP to
      // pinky MCP (13↔17), which spans ≈ one finger; band radius ≈ half of that.
      const fingerW = dist(mcp, pinky);
      const r = this.customRing ? fingerW * RING_FINGER_W * this.ringScale : palmW * RING_W;
      this.ring.group.position.set(cx, cy, 0);

      if (this.customRing) {
        // FULL 3D hand orientation so the ring rolls/pitches/yaws with the hand.
        // Build a basis from the landmark depths: local +Y = finger axis (13→14,
        // the band's hole), local +Z = the hand's DORSAL normal (across-knuckles
        // 5→17 ✕ finger) so the setting tracks the back of the hand as it rolls.
        const vw = this.video.videoWidth || 1;
        const vh = this.video.videoHeight || 1;
        const scale = Math.max(this.viewW / vw, this.viewH / vh);
        const dw = vw * scale;
        const dh = vh * scale;
        this.dir3(lm[HAND.ringMCP], lm[HAND.ringPIP], dw, dh, this.fingerVec);
        this.dir3(lm[HAND.indexMCP], lm[HAND.pinkyMCP], dw, dh, this.acrossVec);
        this.dorsalVec.crossVectors(this.acrossVec, this.fingerVec).normalize();
        // Make +Z point to the BACK of the hand for both hands (the cross-product
        // sign flips with chirality), so RING_SPIN_DEG lands the setting on top
        // regardless of which hand is shown.
        if (frame.handedness === FLIP_DORSAL_FOR) this.dorsalVec.negate();
        this.axis.copy(this.fingerVec); // occluder cylinder follows the finger
        this.orientByBasis(this.ring.group, this.fingerVec, this.dorsalVec);
        // Per-model setting→top offset (manifest spinDeg); the live hand roll is
        // already in the basis above, so this spin rides along as the hand turns.
        this.ring.group.rotateY(THREE.MathUtils.degToRad(this.ringSpinDeg));
      } else {
        // Procedural fallback: 2D finger direction with a fixed out-of-screen
        // tilt, setting locked toward the camera (orientAlong).
        const fdir = normalize2(pip.x - mcp.x, pip.y - mcp.y);
        this.axis.set(fdir.x, fdir.y, RING_TILT).normalize();
        this.orientAlong(this.ring.group);
      }

      this.ring.group.scale.setScalar(r);
      this.placeOccluder(this.occluders.finger, cx, cy, r * FINGER_OCC, palmW * 1.5);

      // Tuning log (throttled): the computed ring transform.
      if (t - this.lastLog > LOG_EVERY) {
        this.lastLog = t;
        // eslint-disable-next-line no-console
        console.info('[hand] ring transform', {
          center: { x: +cx.toFixed(1), y: +cy.toFixed(1) },
          radiusPx: +r.toFixed(1),
          fingerWpx: +fingerW.toFixed(1),
          palmWpx: +palmW.toFixed(1),
          axis: { x: +this.axis.x.toFixed(2), y: +this.axis.y.toFixed(2), z: +this.axis.z.toFixed(2) },
          source: this.customRing ? 'glb' : 'procedural',
          handedness: frame.handedness,
          spinDeg: this.ringSpinDeg,
          modelScale: this.ringScale,
        });
      }
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

  /**
   * Direction (scene space) between two landmarks, into `out`. Image space is
   * x-right / y-DOWN / z-toward-camera-negative; the scene is x-right / y-UP /
   * z-toward-camera-positive, and z uses ~the same scale as x. So flip y and z.
   */
  private dir3(a: Landmark, b: Landmark, dw: number, dh: number, out: THREE.Vector3): THREE.Vector3 {
    return out.set((b.x - a.x) * dw, -(b.y - a.y) * dh, -(b.z - a.z) * dw).normalize();
  }

  /**
   * Orient `obj` with a full 3D basis: local +Y → `yAxis` (finger/hole), local
   * +Z → `zHint` made perpendicular to Y (hand dorsal normal → setting on top),
   * local +X = Y✕Z. This rolls the ring with the hand instead of locking the
   * setting toward the camera.
   */
  private orientByBasis(obj: THREE.Object3D, yAxis: THREE.Vector3, zHint: THREE.Vector3): void {
    this.zAxis.copy(zHint).addScaledVector(yAxis, -zHint.dot(yAxis));
    if (this.zAxis.lengthSq() < 1e-6) this.zAxis.copy(FORWARD_Z);
    this.zAxis.normalize();
    this.xAxis.crossVectors(yAxis, this.zAxis).normalize();
    this.basis.makeBasis(this.xAxis, yAxis, this.zAxis);
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
