import { type Landmark, smoothLandmarks } from './mapping';

/**
 * MediaPipe Tasks Vision controller for the face try-on (BUILD_SPEC §3).
 *
 * Runs TWO models per frame:
 *  - FaceLandmarker (VIDEO, numFaces 1, outputFacialTransformationMatrixes) for
 *    the ears + head pose (earrings).
 *  - PoseLandmarker (VIDEO, numPoses 1, lite) for the shoulders/neck
 *    (landmarks 11/12) so the necklace can be anchored to the BODY — which does
 *    not move when the head turns, unlike any face landmark.
 *
 * Opens a user-facing camera (the page CSS-mirrors it) and EMA-smooths both
 * landmark sets (§4). Library + models load from a CDN at runtime (no bundled
 * WASM). Camera access requires a secure context (HTTPS or localhost).
 */

const TASKS_VERSION = '0.10.12';
const CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VERSION}`;
const FACE_MODEL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const POSE_MODEL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

// Minimal structural types for the bits of tasks-vision we use (loaded via a
// runtime CDN import, so it has no bundled type declarations).
interface TransformMatrix {
  data: number[];
}
interface FaceResult {
  faceLandmarks: Landmark[][];
  facialTransformationMatrixes?: TransformMatrix[];
}
interface PoseResult {
  landmarks: Landmark[][];
}
interface FaceLandmarkerInstance {
  detectForVideo(video: HTMLVideoElement, timestampMs: number): FaceResult;
}
interface PoseLandmarkerInstance {
  detectForVideo(video: HTMLVideoElement, timestampMs: number): PoseResult;
}
interface VisionModule {
  FilesetResolver: { forVisionTasks(wasmPath: string): Promise<unknown> };
  FaceLandmarker: {
    createFromOptions(fileset: unknown, options: unknown): Promise<FaceLandmarkerInstance>;
  };
  PoseLandmarker: {
    createFromOptions(fileset: unknown, options: unknown): Promise<PoseLandmarkerInstance>;
  };
}

export interface FaceFrame {
  /** Smoothed face landmarks (normalised, y-down) or null when no face found. */
  landmarks: Landmark[] | null;
  /** Column-major 4x4 head-pose matrix, or null when unavailable. */
  matrix: number[] | null;
  /** Smoothed pose landmarks (33-point BlazePose) or null when no body found. */
  pose: Landmark[] | null;
}

export type FaceFrameHandler = (frame: FaceFrame) => void;

export class FaceLandmarkerController {
  private face: FaceLandmarkerInstance | null = null;
  private posey: PoseLandmarkerInstance | null = null;
  private stream: MediaStream | null = null;
  private running = false;
  private prevFace: Landmark[] | null = null;
  private prevPose: Landmark[] | null = null;
  private lastTs = 0;

  constructor(private readonly video: HTMLVideoElement) {}

  /** Load the models + open the camera. Throws a typed Error on failure. */
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

    // 2) Load the vision engine + models from the CDN.
    try {
      const vision = (await import(/* @vite-ignore */ CDN)) as VisionModule;
      const fileset = await vision.FilesetResolver.forVisionTasks(`${CDN}/wasm`);
      this.face = await vision.FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: FACE_MODEL, delegate: 'GPU' },
        runningMode: 'VIDEO',
        numFaces: 1,
        outputFacialTransformationMatrixes: true,
      });
      this.posey = await vision.PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: POSE_MODEL, delegate: 'GPU' },
        runningMode: 'VIDEO',
        numPoses: 1,
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
    if (!this.face) throw new Error('FaceLandmarkerController.init() not called');
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
    if (!this.face || v.readyState < 2 || !v.videoWidth) {
      return { landmarks: null, matrix: null, pose: null };
    }
    // Timestamps must be strictly increasing for VIDEO mode.
    const ts = Math.max(performance.now(), this.lastTs + 1);
    this.lastTs = ts;

    const faceRes = this.face.detectForVideo(v, ts);
    const rawFace = faceRes.faceLandmarks?.[0] ?? null;
    let landmarks: Landmark[] | null = null;
    let matrix: number[] | null = null;
    if (rawFace) {
      landmarks = smoothLandmarks(rawFace, this.prevFace);
      this.prevFace = landmarks;
      matrix = faceRes.facialTransformationMatrixes?.[0]?.data ?? null;
    } else {
      this.prevFace = null;
    }

    let pose: Landmark[] | null = null;
    if (this.posey) {
      const rawPose = this.posey.detectForVideo(v, ts).landmarks?.[0] ?? null;
      if (rawPose) {
        pose = smoothLandmarks(rawPose, this.prevPose);
        this.prevPose = pose;
      } else {
        this.prevPose = null;
      }
    }

    return { landmarks, matrix, pose };
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
