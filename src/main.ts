import './style.css';
import {
  fitToSize,
  GEMS,
  JewelryViewer,
  loadGltfScene,
  METALS,
  PIECE_NAMES,
  type GemKey,
  type MetalKey,
  type PieceKey,
} from './engine';
import { modelUrlForHandle } from './catalog/modelMap';
import { renderChips } from './ui/chips';

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const viewer = new JewelryViewer(canvas);

// Initial selection (procedural ring is the viewer default).
viewer.setPiece('ring');
viewer.setMetal('yellow');
viewer.setGem('diamond');

// Real catalog model hook: if ?handle maps to a .glb, load it instead of the
// procedural piece (falls back silently to procedural on miss or error).
const modelUrl = modelUrlForHandle(new URLSearchParams(location.search).get('handle'));
if (modelUrl) {
  loadGltfScene(modelUrl)
    .then((scene) => viewer.setCustomModel(fitToSize(scene, 2.4)))
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[viewer] custom model failed, using procedural piece:', err);
    });
}

// Build the control chips from the engine's catalogues.
const pieceLabels = PIECE_NAMES;
const metalLabels = Object.fromEntries(
  (Object.keys(METALS) as MetalKey[]).map((k) => [k, METALS[k].name]),
) as Record<MetalKey, string>;
const gemLabels = Object.fromEntries(
  (Object.keys(GEMS) as GemKey[]).map((k) => [k, GEMS[k].name]),
) as Record<GemKey, string>;

renderChips<PieceKey>('pieces', pieceLabels, 'ring', (k) => viewer.setPiece(k));
renderChips<MetalKey>('metals', metalLabels, 'yellow', (k) => viewer.setMetal(k));
renderChips<GemKey>('gems', gemLabels, 'diamond', (k) => viewer.setGem(k));

const exposure = document.getElementById('exposure') as HTMLInputElement;
exposure.addEventListener('input', () => viewer.setExposure(parseFloat(exposure.value)));
viewer.setExposure(parseFloat(exposure.value));

viewer.start();

// Hide the loading veil once the first frame is up.
window.setTimeout(() => {
  document.getElementById('loading')?.classList.add('hide');
}, 700);
