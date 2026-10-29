# EPOXY - Grid Logic Puzzle Game

*Version française : [README.fr.md](./README.fr.md)*

**Play online:** [https://vblackjack.github.io/epoxy/](https://vblackjack.github.io/epoxy/)

**EPOXY** is a web-based tile puzzle game in the spirit of the handheld puzzlers of the Atari Lynx era, built with TypeScript, HTML5 Canvas, and the Web Audio API.

## Features

- **Hundreds of Levels Included**:
  - **Epoxy Campaign**: The hand-made Epoxy levels.
  - **Bundled Community Packs**: `Tile World Intro` and `CCLP 1` through `CCLP 5` (see [Credits](#credits)).
  - **`.DAT` / `.CCL` / `.JSON` Support**: Import and export level packs in the widely used CC1 `.DAT` binary format via drag-and-drop. Packs you own can be imported this way.
  - **Solvable Procedural Generator**: Generates multi-wing 32x32 dungeons verified by an automated BFS/Sokoban solver (`LevelValidator`).
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

## Tests

```bash
npm test
```

## Production Build

```bash
npm run build
```

## Credits

The bundled `CCLP 1` to `CCLP 5` packs are community-made level sets, and `Tile World Intro` ships with the Tile World project. All levels in these packs remain the work of their respective authors. Epoxy is not affiliated with the owners of any commercial game.

## License

Copyright 2026 Julien Bombled. The Epoxy source code is licensed under the [Apache License 2.0](./LICENSE). The bundled level packs are not covered by this license.
