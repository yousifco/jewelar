export { JewelryViewer } from './JewelryViewer';
export {
  METALS,
  GEMS,
  makeMetalMaterial,
  makeGemMaterial,
  applyMetal,
  applyGem,
  type MetalKey,
  type GemKey,
} from './materials';
export { buildPiece, buildNecklace, PIECE_NAMES, type PieceKey, type BuiltPiece } from './models';
export { createStudioEnvironment } from './environment';
export { loadGltfScene, fitToSize } from './gltf';
