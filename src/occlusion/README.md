# src/occlusion

Depth-only occluder meshes that give jewellery the "worn" look (Phases 2–3):

- Face/neck/jaw occluder transformed by the facial transformation matrix.
- Finger + wrist cylinder occluders fitted from hand landmarks.

Occluders write depth only (`colorWrite:false`, `depthWrite:true`) and render
before the jewellery. See `BUILD_SPEC.md` §5.
