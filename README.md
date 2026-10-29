# EPOXY - Atari Lynx II Grid Logic Puzzle Game

**Play online:** [https://vblackjack.github.io/epoxy/](https://vblackjack.github.io/epoxy/)

**EPOXY** is a modern web-based tribute to the Atari Lynx II classic *Chip's Challenge*, built with TypeScript, HTML5 Canvas, and Web Audio API.

## Features

- **900+ Levels Included**:
  - **Epoxy + Ultimate Campaign**: Built-in campaign combined with iconic levels from the *Chip's Challenge Ultimate Package*.
  - **7 Complete `.DAT` Level Packs**: Original `CHIPS` (149 levels), `Tile World Intro`, and `CCLP 1` through `CCLP 5`.
  - **Native `.DAT` / `.CCL` / `.JSON` Support**: Import and export standard *Chip's Challenge* binary level packs via drag-and-drop.
  - **Solvable Procedural Generator**: Generates multi-wing 32x32 dungeons verified by an automated BFS/Sokoban solver (`LevelValidator`).
- **Complete Tile & Monster Engine**:
  - Elemental hazards (`water`, `fire`, `ice` with corner deflectors, `force` conveyors, `bomb`).
  - Interactive mechanisms (`button_green`, `button_red` clone machines, `button_brown` bear traps, `button_blue` tank reversers, `teleport` pads, `thief`).
  - 9 classic creature movement patterns (`bug`, `fireball`, `pink_ball`, `tank`, `glider`, `teeth`, `walker`, `blob`, `paramecium`).
- **Visual & Tactile Enhancements**:
  - HD Neon and 16-Bit Retro pixel renderers with 4 biome themes (`Cyber Neon`, `Arctic Lab`, `Magma Core`, `Lynx LCD`).
  - Dynamic objective locator and mechanism wire overlay (`H`).
  - Full smartphone touch support (Swipe/Hold virtual joystick, Tap-to-Pathfind, Pinch-to-Zoom, and thumb D-Pad with haptic feedback).
  - Full-featured 32x32 Level Editor with live solver validation.

## Development

```bash
npm install
npm run dev
```

## Production Build

```bash
npm run build
```

## License

Copyright 2026 Julien Bombled. Licensed under the [Apache License 2.0](./LICENSE).
