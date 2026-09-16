# Third-party assets

Everything below is vendored in the repo. The viewer fetches nothing from the internet.

## three.js r170
- Files: `viewer/vendor/three.module.min.js`, `viewer/vendor/src/**` (OrbitControls, GLTFLoader,
  BufferGeometryUtils, SkeletonUtils), and the converted classic-script copies
  `three.classic.js`, `three-addons.classic.js` made by `viewer/vendor/convert_to_classic.py`.
- Source: https://cdn.jsdelivr.net/npm/three@0.170.0/ (npm package `three`)
- Licence: MIT, see `viewer/vendor/LICENSE-three.txt`.

## Human characters — Quaternius "Ultimate Modular Men" and "Ultimate Modular Women" packs
- Files: `viewer/assets/humans/*.glb` (10 characters).
- Author: Quaternius (https://quaternius.com)
- Source pages: https://quaternius.com/packs/ultimatemodularcharacters.html and
  https://quaternius.com/packs/ultimatemodularwomen.html, glTF files from the official Google Drive
  folders linked there ("Individual Characters/glTF"), downloaded 2026-09-14.
- Licence: CC0 1.0 Universal (public domain). Licence text as shipped with the packs:
  `viewer/assets/humans/LICENSE-Quaternius-UltimateModular.txt`.
- Modifications: all animation clips except `Walk`, `Idle` and `Idle_Neutral` removed and converted from
  `.gltf` to `.glb` with `tools/prune_gltf.py`. Men's files prefixed `Man_`, women's `Woman_`.

| File | Original file |
|---|---|
| Man_Adventurer.glb | Men / Adventurer.gltf |
| Man_Casual_2.glb | Men / Casual_2.gltf |
| Man_Casual_Hoodie.glb | Men / Casual_Hoodie.gltf |
| Man_Suit.glb | Men / Suit.gltf |
| Man_Worker.glb | Men / Worker.gltf |
| Woman_Adventurer.glb | Women / Adventurer.gltf |
| Woman_Casual.glb | Women / Casual.gltf |
| Woman_Formal.glb | Women / Formal.gltf |
| Woman_Suit.glb | Women / Suit.gltf |
| Woman_Worker.glb | Women / Worker.gltf |

## Robot
Built from three.js primitives in `viewer/app.js` (TurtleBot 3 Burger look-alike). No external asset.
