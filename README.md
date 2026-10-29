# EPOXY - Grid Logic Puzzle Game

*Version française : [README.fr.md](./README.fr.md)*

**Play online:** [https://vblackjack.github.io/epoxy/](https://vblackjack.github.io/epoxy/)

**EPOXY** is a web-based tile puzzle game in the spirit of the handheld puzzlers of the Atari Lynx era, built with TypeScript, HTML5 Canvas, and the Web Audio API.

## Features

- **Hundreds of Levels Included**:
  - **Epoxy Campaign**: 20 Epoxy levels, scripted in `tools/campaign-script.json` and each proven solvable: they teach one mechanic at a time, open into hubs with locked wings from level 3, and bring in Sokoban-style block rooms from level 13.
  - **Bundled Community Packs**: `Tile World Intro` and `CCLP 1` through `CCLP 5` (see [Credits](#credits)).
  - **`.DAT` / `.CCL` / `.JSON` Support**: Import and export level packs in the widely used CC1 `.DAT` binary format via drag-and-drop. Packs you own can be imported this way.
  - **Proven Procedural Generator**: Builds levels from hand-drawn puzzle pieces (`public/configs/motifs.json`), each proven fair and solvable by a solver that runs the real game engine. Every generated level is then replayed start to finish before it is offered, so it is always solvable and no puzzle can be skipped. Difficulty, focus and pacing grow with the level number. From level 3, levels are hubs with locked wings whose keys and boots lie in other wings; hub outlines (`procedural.hub.shapes` in `game.json`) and reward rooms vary, and with the biome set to Auto each level shows the theme of its main mechanic. In block puzzles, the Help button plays the next push, and the game warns as soon as a dead end is proven.
  - **Show Solution** (`O`): every campaign and generated level stores the solution its proof replayed. The button restarts the level and plays that solution to the exit; watching it records no score.
- **Complete Tile & Monster Engine**:
  - Elemental hazards (`water`, `fire`, `ice` with corner deflectors, `force` conveyors, `bomb`).
  - Interactive mechanisms (`button_green`, `button_red` clone machines, `button_brown` bear traps, `button_blue` tank reversers, `teleport` pads, `thief`).
  - 9 creature movement patterns (`bug`, `fireball`, `pink_ball`, `tank`, `glider`, `teeth`, `walker`, `blob`, `paramecium`).
- **Visual & Tactile Enhancements**:
  - HD Neon and 16-Bit Retro pixel renderers with 4 biome themes (`Cyber Neon`, `Arctic Lab`, `Magma Core`, `Lynx LCD`).
  - Dynamic objective locator and mechanism wire overlay (`H`).
  - Full smartphone touch support (Swipe/Hold virtual joystick, Tap-to-Pathfind, Pinch-to-Zoom, and thumb D-Pad with haptic feedback).
  - Full-featured 32x32 Level Editor with live solver validation.

## Development

Requires Node.js 24 (see `.nvmrc`).

```bash
npm install
npm run dev
```

## Building a Campaign with the Generator

1. Open the **Level Editor**, set a **Difficulty**, leave **Seed** empty and press **Generate**. The seed used is written back, so the same level can be generated again.
2. Retouch the level, then **Test** it.
3. **Export JSON** and paste the exported object into the `levels` array of `public/configs/levels.json`. Exported levels load as they are; set `number` to the position you want.

The Epoxy campaign itself is described level by level in `tools/campaign-script.json` (motifs to teach, puzzle count, hardest tier); `npm run build:campaign` generates each level, proves it and rewrites `public/configs/levels.json` as readable legend rows.

New puzzle pieces go in `public/configs/motifs.json`; run `npm run annotate:pieces` afterwards to precompute each piece's solution and reversibility into `public/configs/motif-annotations.json`, which the generator uses instead of searching in the browser.

Sokoban rooms: `npm run forge:sokoban` builds original ones backwards from their solution (blocks onto brown buttons that hold the exit traps open). `npm run import:sokoban` adapts a collection in the standard `.xsb` format (set `EPOXY_SOKOBAN_FILE` and `EPOXY_SOKOBAN_CREDIT`); only use collections whose licence allows reuse, and keep the credit. Both write candidates to `local/` for curation. `npm test` checks that each one is solvable in every orientation, that no block can escape through its ports, and that nothing in it is decorative; `npm run report:pieces` writes each piece's solution to `local/piece-probe.txt`.

## Tests

```bash
npm test
```

`npm run report:levels` measures 200 generated levels against the bundled community packs and writes `reports/level-metrics.json`. `npm run report:study` describes how the community packs combine mechanics, and `npm run mine:pieces` searches for harder puzzle pieces (about half an hour); both write to `local/`.

## Production Build

```bash
npm run build
```

## Credits

The bundled `CCLP 1` to `CCLP 5` packs are community-made level sets, and `Tile World Intro` ships with the Tile World project. All levels in these packs remain the work of their respective authors. Epoxy is not affiliated with the owners of any commercial game.

## License

Copyright 2026 Julien Bombled. The Epoxy source code is licensed under the [Apache License 2.0](./LICENSE). The bundled level packs are not covered by this license.
