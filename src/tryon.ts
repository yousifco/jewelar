import './tryon.css';
import { FaceLandmarkerController, TryOnError } from './tracking/faceLandmarker';
import { HandLandmarkerController } from './tracking/handLandmarker';
import { FaceTryOn } from './tracking/FaceTryOn';
import { HandTryOn } from './tracking/HandTryOn';
import { modelConfigForHandle, modelUrlForHandle } from './catalog/modelMap';

type Mode = 'face' | 'hand';
type Piece = 'necklace' | 'earrings' | 'ring' | 'bracelet';

const $ = (id: string) => document.getElementById(id)!;
const video = $('video') as HTMLVideoElement;
const camFace = $('cam') as HTMLCanvasElement;
const camHand = $('camHand') as HTMLCanvasElement;
const statusEl = $('status');
const statusText = $('statusText');
const statusHint = $('statusHint');
const startBtn = $('startBtn') as HTMLButtonElement;
const dot = $('dot');
const hudText = $('hudText');

const items: Record<Piece, HTMLButtonElement> = {
  necklace: $('itemNecklace') as HTMLButtonElement,
  earrings: $('itemEarrings') as HTMLButtonElement,
  ring: $('itemRing') as HTMLButtonElement,
  bracelet: $('itemBracelet') as HTMLButtonElement,
};
const PIECE_MODE: Record<Piece, Mode> = {
  necklace: 'face',
  earrings: 'face',
  ring: 'hand',
  bracelet: 'hand',
};

const params = new URLSearchParams(location.search);
const pieceParam = params.get('piece');
const handleParam = params.get('handle');
const modelUrl = modelUrlForHandle(handleParam);
// eslint-disable-next-line no-console
console.info('[tryon] deep-link resolution', {
  piece: pieceParam,
  handle: handleParam,
  modelUrl: modelUrl ?? '(none → procedural)',
});

/**
 * On-screen debug overlay for the ring model (point 3): a fixed text panel that
 * shows the received handle, the resolved model URL, and the ring source —
 * "loaded GLB OK" / "GLB FAILED -> …" / "using procedural (no model URL
 * matched)". Visible on mobile where the console isn't.
 */
function setRingDebug(status: string): void {
  let el = document.getElementById('ringDebug');
  if (!el) {
    el = document.createElement('div');
    el.id = 'ringDebug';
    el.style.cssText =
      'position:fixed;left:8px;top:8px;z-index:99999;max-width:92vw;padding:6px 9px;' +
      'background:rgba(0,0,0,.74);color:#fff;font:12px/1.45 ui-monospace,Menlo,monospace;' +
      'white-space:pre-wrap;border-radius:7px;pointer-events:none;direction:ltr;text-align:left';
    document.body.appendChild(el);
  }
  el.textContent =
    `RING: ${status}\nhandle = ${handleParam ?? '(none)'}\nurl = ${modelUrl ?? '(no model URL matched)'}`;
}

// Show the resolution immediately for the hand pieces so a handle/URL mismatch
// is visible even before the camera starts.
if (pieceParam === 'ring' || pieceParam === 'bracelet') {
  setRingDebug(modelUrl ? 'resolving…' : 'using procedural (no model URL matched)');
}

// What's selected (rendered when its mode is active).
const active: Record<Piece, boolean> = {
  necklace: true,
  earrings: true,
  ring: false,
  bracelet: false,
};

let mode: Mode | null = null;
let faceCtl: FaceLandmarkerController | null = null;
let handCtl: HandLandmarkerController | null = null;
let faceScene: FaceTryOn | null = null;
let handScene: HandTryOn | null = null;
let busy = false;

function setBusy(text: string, hint: string): void {
  statusEl.classList.remove('hidden');
  const g = document.getElementById('statusGlyph');
  if (g && g.tagName !== 'DIV') g.outerHTML = '<div class="spinner" id="statusGlyph"></div>';
  statusText.textContent = text;
  statusHint.textContent = hint;
  startBtn.style.display = 'none';
  statusEl.querySelector('.retry')?.remove();
}

function hideStatus(): void {
  statusEl.classList.add('hidden');
  dot.classList.remove('off');
}

function showError(err: unknown): void {
  statusEl.classList.remove('hidden');
  const g = document.getElementById('statusGlyph');
  if (g) g.outerHTML = '<div class="glyph" id="statusGlyph">⚠️</div>';
  statusText.textContent = 'تعذّر التشغيل';
  statusHint.textContent =
    err instanceof TryOnError
      ? err.userMessage
      : 'حدث خطأ غير متوقع. أعد المحاولة أو حدّث الصفحة.';
  const retry = document.createElement('button');
  retry.className = 'btn primary retry';
  retry.textContent = '↻ حاول مجدداً';
  retry.onclick = () => {
    retry.remove();
    void ensureMode(mode ?? pendingMode());
  };
  statusEl.appendChild(retry);
  // eslint-disable-next-line no-console
  console.error('[try-on]', err);
}

function showCanvas(m: Mode): void {
  camFace.classList.toggle('cam-hidden', m !== 'face');
  camHand.classList.toggle('cam-hidden', m !== 'hand');
}

function refreshItems(): void {
  for (const name of Object.keys(items) as Piece[]) {
    // Only the current mode's selected pieces read as active.
    items[name].classList.toggle('active', mode === PIECE_MODE[name] && active[name]);
  }
}

function applySceneActive(): void {
  if (mode === 'face') faceScene?.setActive(active.necklace, active.earrings);
  else if (mode === 'hand') handScene?.setActive(active.ring, active.bracelet);
}

function pendingMode(): Mode {
  if (pieceParam === 'ring' || pieceParam === 'bracelet') return 'hand';
  return 'face';
}

/** Start (or switch to) a tracking mode: opens the camera + the right scene. */
async function ensureMode(target: Mode): Promise<void> {
  if (busy) return;
  if (mode === target) {
    applySceneActive();
    refreshItems();
    return;
  }
  busy = true;
  faceCtl?.stop();
  handCtl?.stop();
  showCanvas(target);
  setBusy(
    'جارٍ تجهيز المرآة الذكية…',
    target === 'hand'
      ? 'نطلب إذن الكاميرا ونحمّل محرّك تتبّع اليد — لحظات.'
      : 'نطلب إذن الكاميرا ونحمّل محرّك التتبّع — لحظات.',
  );
  try {
    if (target === 'face') {
      faceCtl ??= new FaceLandmarkerController(video);
      await faceCtl.init();
      faceScene ??= new FaceTryOn(camFace, video);
      faceScene.setActive(active.necklace, active.earrings);
      if (modelUrl && (pieceParam === 'necklace' || pieceParam === 'earring')) {
        void faceScene.loadCustomModel(pieceParam === 'necklace' ? 'necklace' : 'earrings', modelUrl);
      }
      faceCtl.start((frame) => {
        const tracked = faceScene!.update(frame);
        dot.classList.toggle('off', !tracked);
        hudText.textContent = tracked ? 'متتبَّع · حرّك رأسك' : 'واجه الكاميرا…';
      });
    } else {
      const freshHand = !handScene;
      handCtl ??= new HandLandmarkerController(video);
      await handCtl.init();
      // When a model URL resolved, build with NO procedural ring — only the GLB
      // is shown (or nothing, if it fails). Same loader + dressing as the viewer.
      handScene ??= new HandTryOn(camHand, video, !!modelUrl);
      handScene.setActive(active.ring, active.bracelet);
      if (freshHand) {
        if (modelUrl) {
          // eslint-disable-next-line no-console
          console.info('[tryon] requesting custom ring model →', modelUrl);
          setRingDebug('loading GLB…');
          void handScene.loadCustomRing(modelUrl, modelConfigForHandle(handleParam)).then((res) => {
            if (res.ok && res.info) {
              const i = res.info;
              setRingDebug(
                `loaded GLB OK (${i.materialsMode} materials)\n` +
                  `meshes=${i.meshes} materials=${i.materials}\n` +
                  `bbox=${i.bbox.x}×${i.bbox.y}×${i.bbox.z}  holeAxis=${i.holeAxis}\n` +
                  `rotation(deg)=${i.rotationDeg.x},${i.rotationDeg.y},${i.rotationDeg.z}  ` +
                  `normScale=${i.normalizeScale.toFixed(3)}`,
              );
            } else {
              setRingDebug(`GLB FAILED -> ${res.error}`);
            }
          });
        } else {
          // eslint-disable-next-line no-console
          console.info('[tryon] no model for handle=%s → procedural ring', handleParam);
          setRingDebug('using procedural (no model URL matched)');
        }
      }
      handCtl.start((frame) => {
        const tracked = handScene!.update(frame);
        dot.classList.toggle('off', !tracked);
        hudText.textContent = tracked ? 'متتبَّع · حرّك يدك' : 'ارفع يدك أمام الكاميرا…';
      });
    }
    mode = target;
    for (const b of Object.values(items)) b.disabled = false;
    hideStatus();
    refreshItems();
  } catch (err) {
    showError(err);
  } finally {
    busy = false;
  }
}

function onItem(name: Piece): void {
  const m = PIECE_MODE[name];
  if (m !== mode) {
    // Switching mode: this piece on (keep the other piece of that mode as-is).
    active[name] = true;
    void ensureMode(m);
  } else {
    active[name] = !active[name];
    applySceneActive();
    refreshItems();
  }
}

for (const name of Object.keys(items) as Piece[]) {
  items[name].addEventListener('click', () => onItem(name));
}
startBtn.addEventListener('click', () => void ensureMode(pendingMode()));
window.addEventListener('resize', () => {
  faceScene?.resize();
  handScene?.resize();
});

// Deep-link pre-selection. ?piece=earring|necklace → face; ring|bracelet → hand.
if (pieceParam === 'earring') {
  active.necklace = false;
  active.earrings = true;
} else if (pieceParam === 'necklace') {
  active.necklace = true;
  active.earrings = false;
} else if (pieceParam === 'ring') {
  active.ring = true;
  active.bracelet = false;
} else if (pieceParam === 'bracelet') {
  active.bracelet = true;
  active.ring = false;
}
if (pieceParam && pieceParam !== 'view') {
  // Open the camera directly in the right mode.
  void ensureMode(pendingMode());
}
