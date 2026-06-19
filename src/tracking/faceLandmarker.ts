import { type Landmark, smoothLandmarks } from './mapping';

/**
 * MediaPipe Tasks Vision FaceLandmarker controller (BUILD_SPEC §3).
 *
 * - Runs in VIDEO mode, numFaces 1, with `outputFacialTransformationMatrixes`
 *   so we get a 4x4 head-pose matrix for 3D anchoring.
 * - Opens the camera as a user-facing stream (the page CSS-mirrors it).
 * - Applies EMA smoothing to the landmarks (§4) before handing them back.
 *
 * The tasks-vision library + its WASM + the model asset are loaded from a CDN at
 * runtime (matching the seed prototype) so we don't have to bundle/copy WASM.
 * Camera access requires a secure context (HTTPS or localhost).
 */

const TASKS_VERSION = '0.10.12';
const CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VERSION}`;
const FACE_MODEL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

// Minimal structural types for the bits of tasks-vision we use (loaded via a
// runtime CDN import, so it has no bundled type declarations).
interface TransformMatrix {
  data: number[];
}
interface FaceResult {
  faceLandmarks: Landmark[][];
  facialTransformationMatrixes?: TransformMatrix[];
}
interface FaceLandmarkerInstance {
  detectForVideo(video: HTMLVideoElement, timestampMs: number): FaceResult;
}
interface VisionModule {
  FilesetResolver: {
    forVisionTasks(wasmPath: string): Promise<unknown>;
  };
  FaceLandmarker: {
    createFromOptions(fileset: unknown, options: unknown): Promise<FaceLandmarkerInstance>;
  };
}

export interface FaceFrame {
  /** Smoothed landmarks (normalised, y-down) or null when no face is found. */
  landmarks: Landmark[] | null;
  /** Column-major 4x4 head-pose matrix, or null when unavailable. */
  matrix: number[] | null;
}

export type FaceFrameHandler = (frame: FaceFrame) => void;

export class FaceLandmarkerController {
  private landmarker: FaceLandmarkerInstance | null = null;
  private stream: MediaStream | null = null;
  private running = false;
  private prev: Landmark[] | null = null;
  private lastTs = 0;

  constructor(private readonly video: HTMLVideoElement) {}

  /** Load the model + open the camera. Throws a typed Error on failure. */
  async init(): Promise<void> {
    if (!window.isSecureContext) {
      throw new TryOnError(
        'camera',
        'يتطلب تشغيل الكاميرا اتصالاً آمناً (HTTPS). افتح الصفحة عبر رابط https.',
      );
    }

    // 1) Camera first, so a permission denial fails fast with a clear message.
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: 1280, height: 960 },
        audio: false,
      });
      this.video.srcObject = this.stream;
      await this.video.play();
    } catch (err) {
      throw new TryOnError(
        'camera',
        'تعذّر فتح الكاميرا. تأكد من السماح بالوصول للكاميرا، وأن الرابط يستخدم HTTPS.',
        err,
      );
    }

    // 2) Load the vision engine + face model from the CDN.
    try {
      const vision = (await import(/* @vite-ignore */ CDN)) as VisionModule;
      const fileset = await vision.FilesetResolver.forVisionTasks(`${CDN}/wasm`);
      this.landmarker = await vision.FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: FACE_MODEL, delegate: 'GPU' },
        runningMode: 'VIDEO',
        numFaces: 1,
        outputFacialTransformationMatrixes: true,
      });
    } catch (err) {
      throw new TryOnError(
        'engine',
        'تعذّر تحميل محرّك التتبّع. تحقّق من الاتصال بالإنترنت وافتح في متصفّح حديث.',
        err,
      );
    }
  }

  /** Start the per-frame detection loop, invoking `onFrame` each animation tick. */
  start(onFrame: FaceFrameHandler): void {
    if (!this.landmarker) throw new Error('FaceLandmarkerController.init() not called');
    this.running = true;
    const loop = (): void => {
      if (!this.running) return;
      onFrame(this.detect());
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  private detect(): FaceFrame {
    const v = this.video;
    if (!this.landmarker || v.readyState < 2 || !v.videoWidth) {
      return { landmarks: null, matrix: null };
    }
    // Timestamps must be strictly increasing for VIDEO mode.
    const ts = Math.max(performance.now(), this.lastTs + 1);
    this.lastTs = ts;
    const res = this.landmarker.detectForVideo(v, ts);
    const raw = res.faceLandmarks?.[0];
    if (!raw) {
      this.prev = null;
      return { landmarks: null, matrix: null };
    }
    const smoothed = smoothLandmarks(raw, this.prev);
    this.prev = smoothed;
    const matrix = res.facialTransformationMatrixes?.[0]?.data ?? null;
    return { landmarks: smoothed, matrix };
  }

  stop(): void {
    this.running = false;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }
}

export type TryOnErrorKind = 'camera' | 'engine';

/** Error carrying an Arabic, user-facing message + a failure category. */
export class TryOnError extends Error {
  constructor(
    readonly kind: TryOnErrorKind,
    readonly userMessage: string,
    readonly cause?: unknown,
  ) {
    super(userMessage);
    this.name = 'TryOnError';
  }
}
