import * as THREE from 'three';
import {
  buildBracelet,
  buildHandRing,
  createStudioEnvironment,
  dressImportedModel,
  loadGltfScene,
  makeGemMaterial,
  makeMetalMaterial,
  type BuiltPiece,
} from '../engine';
import { createHandOccluders, type HandOccluders } from '../occlusion/handOccluders';
import { dist, HAND, lerp, makeCoverMapper, normalize2 } from './mapping';
import { type HandFrame } from './handLandmarker';
import type { ModelPartConfig } from '../catalog/modelMap';

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

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly video: HTMLVideoElement,
    /** When true, DON'T build the procedural ring — a GLB will be attached. */
    expectCustomRing = false,
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
    // When a per-handle GLB is expected, attach only an empty anchor group (no
    // procedural ring) so the finger never shows the built-in ring — the GLB
    // populates this group, or it stays empty if the GLB fails (debug overlay
    // reports which). Otherwise build the procedural ring as before.
    if (expectCustomRing) {
      const group = new THREE.Group();
      group.renderOrder = 1;
      this.scene.add(group);
      this.ring = { group, metalMeshes: [], gemMeshes: [] };
    } else {
      this.ring = assign(buildHandRing());
    }
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
   * Real catalog model hook: load the per-handle .glb ring and swap it into the
   * anchored ring group (the procedural ring stays as the fallback on error).
   * The model is re-dressed with OUR gold + diamond materials (same helper as
   * the 3D viewer → identical look) and re-oriented so its hole axis runs along
   * the band's local +Y (which the per-frame anchoring points across the finger).
   */
  async loadCustomRing(
    url: string,
    config?: ModelPartConfig | null,
  ): Promise<{ ok: boolean; error?: string }> {
    // eslint-disable-next-line no-console
    console.info('[hand] loadCustomRing: resolved model URL =', url);
    try {
      const scene = await loadGltfScene(url);
      let meshCount = 0;
      scene.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) meshCount++;
      });
      // eslint-disable-next-line no-console
      console.info(`[hand] GLB loaded OK (${meshCount} mesh${meshCount === 1 ? '' : 'es'})`);
      if (meshCount === 0) throw new Error('GLB contains no meshes');
      dressImportedModel(scene, {
        metal: this.metalMat,
        gem: this.gemMat,
        metalTags: config?.metal,
        stoneTags: config?.stone,
        label: 'hand',
      });
      this.swapRingModel(scene);
      this.customRing = true;
      // eslint-disable-next-line no-console
      console.info('[hand] rendering: LOADED GLB (attached to hand anchor)');
      return { ok: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.error('[hand] GLB load/setup FAILED. error:', err);
      return { ok: false, error };
    }
  }

  /**
   * Normalise a loaded ring into the procedural local convention: hole axis
   * along +Y, band radius ≈ 1 (so the per-frame `scale.setScalar(r)` makes the
   * world band radius ≈ r). The hole axis is taken as the model's THINNEST
   * bounding-box axis (a band/torus is thin through its hole), then rotated to
   * +Y; the band diameter is the larger of the remaining two extents.
   */
  private swapRingModel(obj: THREE.Object3D): void {
    // Centre the model's content at the origin.
    const box = new THREE.Box3().setFromObject(obj);
    if (box.isEmpty()) throw new Error('loaded ring has an empty bounding box');
    const center = box.getCenter(new THREE.Vector3());
    obj.position.sub(center);

    const wrap = new THREE.Group();
    wrap.add(obj);

    // Rotate the thinnest axis (the hole) to local +Y.
    const size = box.getSize(new THREE.Vector3());
    const minAxis = size.x <= size.y && size.x <= size.z ? 'x' : size.y <= size.z ? 'y' : 'z';
    if (minAxis === 'x') wrap.rotation.z = Math.PI / 2; // x → y
    else if (minAxis === 'z') wrap.rotation.x = -Math.PI / 2; // z → y

    // Scale so the band radius ≈ 1 (band diameter = max extent in the XZ plane).
    wrap.updateMatrixWorld(true);
    const box2 = new THREE.Box3().setFromObject(wrap);
    const s2 = box2.getSize(new THREE.Vector3());
    const bandDia = Math.max(s2.x, s2.z) || 1;
    wrap.scale.setScalar(2 / bandDia); // diameter → 2 ⇒ radius → 1

    wrap.renderOrder = 1;
    wrap.traverse((o) => (o.renderOrder = 1));

    // eslint-disable-next-line no-console
    console.info('[hand] ring model normalised', {
      holeAxis: minAxis,
      modelSize: { x: +size.x.toFixed(3), y: +size.y.toFixed(3), z: +size.z.toFixed(3) },
      bandDiameter: +bandDia.toFixed(3),
      localScale: +(2 / bandDia).toFixed(3),
    });

    for (const child of [...this.ring.group.children]) this.ring.group.remove(child);
    this.ring.group.add(wrap);
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
      // Hole axis runs ALONG the finger (13→14), tilted out of screen so the
      // band reads as an ellipse; orientAlong maps the band's local +Y to it.
      const fdir = normalize2(pip.x - mcp.x, pip.y - mcp.y);
      this.axis.set(fdir.x, fdir.y, RING_TILT).normalize();
      // Scale the band diameter to the finger width. Proxy = ring-finger MCP to
      // pinky MCP (13↔17), which spans ≈ one finger; band radius ≈ half of that.
      const fingerW = dist(mcp, pinky);
      const r = this.customRing ? fingerW * RING_FINGER_W : palmW * RING_W;
      this.ring.group.position.set(cx, cy, 0);
      this.orientAlong(this.ring.group);
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
