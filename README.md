# EPOXY - Grid Logic Puzzle Game

*Version française : [README.fr.md](./README.fr.md)*

**Play online:** [https://vblackjack.github.io/epoxy/](https://vblackjack.github.io/epoxy/)

**EPOXY** is a web-based tile puzzle game in the spirit of the handheld puzzlers of the Atari Lynx era, built with TypeScript, HTML5 Canvas, and the Web Audio API.

## Features

- **Hundreds of Levels Included**:
  - **Epoxy Campaign**: The hand-made Epoxy levels.
  - **Bundled Community Packs**: `Tile World Intro` and `CCLP 1` through `CCLP 5` (see [Credits](#credits)).
  - **`.DAT` / `.CCL` / `.JSON` Support**: Import and export level packs in the widely used CC1 `.DAT` binary format via drag-and-drop. Packs you own can be imported this way.
  - **Proven Procedural Generator**: Builds levels from hand-drawn puzzle pieces (`public/configs/motifs.json`), each proven fair and solvable by a solver that runs the real game engine. Every generated level is then replayed start to finish before it is offered, so it is always solvable and no puzzle can be skipped. Difficulty, focus and pacing grow with the level number.
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

New puzzle pieces go in `public/configs/motifs.json`. `npm test` checks that each one is solvable in every orientation, that no block can escape through its ports, and that nothing in it is decorative; `npm run report:pieces` writes each piece's solution to `local/piece-probe.txt`.

## Tests

```bash
npm test
```

`npm run report:levels` measures 200 generated levels against the bundled community packs and writes `reports/level-metrics.json`.

## Production Build

```bash
npm run build
```

## Credits

The bundled `CCLP 1` to `CCLP 5` packs are community-made level sets, and `Tile World Intro` ships with the Tile World project. All levels in these packs remain the work of their respective authors. Epoxy is not affiliated with the owners of any commercial game.

## License

Copyright 2026 Julien Bombled. The Epoxy source code is licensed under the [Apache License 2.0](./LICENSE). The bundled level packs are not covered by this license.
