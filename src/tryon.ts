import './tryon.css';
import { FaceLandmarkerController, TryOnError } from './tracking/faceLandmarker';
import { FaceTryOn } from './tracking/FaceTryOn';

const video = document.getElementById('video') as HTMLVideoElement;
const canvas = document.getElementById('cam') as HTMLCanvasElement;
const statusEl = document.getElementById('status')!;
const statusGlyph = document.getElementById('statusGlyph')!;
const statusText = document.getElementById('statusText')!;
const statusHint = document.getElementById('statusHint')!;
const startBtn = document.getElementById('startBtn') as HTMLButtonElement;
const dot = document.getElementById('dot')!;
const hudText = document.getElementById('hudText')!;
const itemNecklace = document.getElementById('itemNecklace') as HTMLButtonElement;
const itemEarrings = document.getElementById('itemEarrings') as HTMLButtonElement;

const controller = new FaceLandmarkerController(video);
let tryOn: FaceTryOn | null = null;
let necklaceOn = true;
let earringsOn = true;

function setBusy(text: string, hint: string): void {
  statusGlyph.outerHTML = '<div class="spinner" id="statusGlyph"></div>';
  statusText.textContent = text;
  statusHint.textContent = hint;
  startBtn.style.display = 'none';
}

function showError(err: unknown): void {
  statusEl.classList.remove('hidden');
  const glyph = document.getElementById('statusGlyph');
  if (glyph) glyph.outerHTML = '<div class="glyph" id="statusGlyph">⚠️</div>';
  statusText.textContent = 'تعذّر التشغيل';
  statusHint.textContent =
    err instanceof TryOnError
      ? err.userMessage
      : 'حدث خطأ غير متوقع. أعد تحميل الصفحة وحاول مرة أخرى.';
  // Offer a retry. Call start() directly within the click so the camera request
  // happens inside a user gesture (some browsers require this).
  const retry = document.createElement('button');
  retry.className = 'btn primary';
  retry.textContent = '↻ حاول مجدداً';
  retry.onclick = () => {
    retry.remove();
    void start();
  };
  statusEl.appendChild(retry);
  // eslint-disable-next-line no-console
  console.error('[try-on]', err);
}

async function start(): Promise<void> {
  setBusy('جارٍ تجهيز المرآة الذكية…', 'نطلب إذن الكاميرا ونحمّل محرّك التتبّع — لحظات.');
  try {
    await controller.init();
  } catch (err) {
    showError(err);
    return;
  }

  tryOn = new FaceTryOn(canvas, video);
  tryOn.setActive(necklaceOn, earringsOn);
  window.addEventListener('resize', () => tryOn?.resize());

  // Enable the tray now that the engine is live.
  itemNecklace.disabled = false;
  itemEarrings.disabled = false;

  statusEl.classList.add('hidden');
  dot.classList.remove('off');

  controller.start((frame) => {
    const tracked = tryOn!.update(frame);
    dot.classList.toggle('off', !tracked);
    hudText.textContent = tracked ? 'متتبَّع · حرّك رأسك' : 'ابحث عنك… واجه الكاميرا';
  });
}

function toggle(btn: HTMLButtonElement, which: 'necklace' | 'earrings'): void {
  const on = !btn.classList.contains('active');
  btn.classList.toggle('active', on);
  if (which === 'necklace') necklaceOn = on;
  else earringsOn = on;
  tryOn?.setActive(necklaceOn, earringsOn);
}

startBtn.addEventListener('click', start);
itemNecklace.addEventListener('click', () => toggle(itemNecklace, 'necklace'));
itemEarrings.addEventListener('click', () => toggle(itemEarrings, 'earrings'));

// Shopify deep-link: ?piece=earring|necklace pre-selects that piece and opens
// the camera directly. (?piece=ring|view is handled on the viewer page.)
const piece = new URLSearchParams(location.search).get('piece');
if (piece === 'earring' || piece === 'necklace') {
  necklaceOn = piece === 'necklace';
  earringsOn = piece === 'earring';
  itemNecklace.classList.toggle('active', necklaceOn);
  itemEarrings.classList.toggle('active', earringsOn);
  // Open directly in AR. If the browser blocks the camera without a gesture,
  // showError() falls back to a "tap to start" button.
  void start();
}
