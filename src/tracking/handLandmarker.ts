import { type Landmark, smoothLandmarks } from './mapping';
import { TryOnError } from './faceLandmarker';

/**
 * MediaPipe Tasks Vision HandLandmarker controller (BUILD_SPEC §3) for the hand
 * try-on (ring + bracelet). Mirrors the face controller but tracks one hand and
 * needs no pose/transformation matrix.
 *
 * Opens a user-facing camera (the page CSS-mirrors it) and EMA-smooths the 21
 * landmarks (§4). Library + model load from a CDN at runtime (no bundled WASM).
 * Camera access requires a secure context (HTTPS or localhost).
 */

const TASKS_VERSION = '0.10.12';
const CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VERSION}`;
const HAND_MODEL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

interface HandCategory {
  categoryName: string;
}
interface HandResult {
  landmarks: Landmark[][];
  /** Per-hand handedness categories (newer field name). */
  handednesses?: HandCategory[][];
  /** Per-hand handedness categories (older field name). */
  handedness?: HandCategory[][];
}
interface HandLandmarkerInstance {
  detectForVideo(video: HTMLVideoElement, timestampMs: number): HandResult;
}
interface VisionModule {
  FilesetResolver: { forVisionTasks(wasmPath: string): Promise<unknown> };
  HandLandmarker: {
    createFromOptions(fileset: unknown, options: unknown): Promise<HandLandmarkerInstance>;
  };
}

export interface HandFrame {
  /** Smoothed hand landmarks (21, normalised, y-down) or null when no hand. */
  landmarks: Landmark[] | null;
  /** MediaPipe handedness of the detected hand (raw selfie frame), or null. */
  handedness: 'Left' | 'Right' | null;
}

export type HandFrameHandler = (frame: HandFrame) => void;

export class HandLandmarkerController {
  private hand: HandLandmarkerInstance | null = null;
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
    try {
      const vision = (await import(/* @vite-ignore */ CDN)) as VisionModule;
      const fileset = await vision.FilesetResolver.forVisionTasks(`${CDN}/wasm`);
      this.hand = await vision.HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: HAND_MODEL, delegate: 'GPU' },
        runningMode: 'VIDEO',
        numHands: 1,
      });
    } catch (err) {
      throw new TryOnError(
        'engine',
        'تعذّر تحميل محرّك تتبّع اليد. تحقّق من الاتصال بالإنترنت وافتح في متصفّح حديث.',
        err,
      );
    }
  }

  start(onFrame: HandFrameHandler): void {
    if (!this.hand) throw new Error('HandLandmarkerController.init() not called');
    this.running = true;
    const loop = (): void => {
      if (!this.running) return;
      onFrame(this.detect());
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  private detect(): HandFrame {
    const v = this.video;
    if (!this.hand || v.readyState < 2 || !v.videoWidth)
      return { landmarks: null, handedness: null };
    const ts = Math.max(performance.now(), this.lastTs + 1);
    this.lastTs = ts;
    const result = this.hand.detectForVideo(v, ts);
    const raw = result.landmarks?.[0] ?? null;
    if (!raw) {
      this.prev = null;
      return { landmarks: null, handedness: null };
    }
    const label = (result.handednesses ?? result.handedness)?.[0]?.[0]?.categoryName;
    const handedness = label === 'Left' || label === 'Right' ? label : null;
    const smoothed = smoothLandmarks(raw, this.prev);
    this.prev = smoothed;
    return { landmarks: smoothed, handedness };
  }

  stop(): void {
    this.running = false;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.prev = null;
  }
}
