# EPOXY - Grid Logic Puzzle Game

*Version française : [README.fr.md](./README.fr.md)*

**Play online:** [https://vblackjack.github.io/epoxy/](https://vblackjack.github.io/epoxy/)

**EPOXY** is a web-based tile puzzle game in the spirit of the handheld puzzlers of the Atari Lynx era, built with TypeScript, HTML5 Canvas, and the Web Audio API.

## Features

- **Hundreds of Levels Included**:
  - **Epoxy Campaign**: 20 Epoxy levels, scripted in `tools/campaign-script.json` and each proven solvable: they teach one mechanic at a time, open into hubs with locked wings from level 3, and bring in Sokoban-style block rooms from level 13.
  - **Bundled Community Packs**: `Tile World Intro` and `CCLP 1` through `CCLP 5` (see [Credits](#credits)).
  - **`.DAT` / `.CCL` / `.JSON` Support**: Import and export level packs in the widely used CC1 `.DAT` binary format via drag-and-drop. Packs you own can be imported this way.
  - **Levels of any size**: a `.json` level or custom pack sets its own width and height, from a 10x10 room to a 40x40 or 100x100 level (`grid.minLevelSize` to `grid.maxLevelSize` in `game.json`); the camera, the radar and the editor follow the level. The `.DAT` format and the procedural generator keep the classic 32x32 (`grid.mapWidth` / `grid.mapHeight`).
  - **Proven Procedural Generator**: Builds levels from hand-drawn puzzle pieces (`public/configs/motifs.json`), each proven fair and solvable by a solver that runs the real game engine. Every generated level is then replayed start to finish before it is offered, so it is always solvable and no puzzle can be skipped. Difficulty, focus and pacing grow with the level number. From level 3, levels are hubs with locked wings whose keys and boots lie in other wings; hub outlines (`procedural.hub.shapes` in `game.json`) and reward rooms vary, and with the biome set to Auto each level shows the theme of its main mechanic. Levels are laid out compactly, with few dead ends, and no two neighbouring levels of a pack share a main mechanic or hub outline. Each pack comes from a seed: **Generate Endless Puzzle** (or `N`) asks for one (empty means random) and the level to start at, and the seed of the pack being played is shown next to the pack selector with a Copy button.
  - **Endless mode**: aims at community-pack difficulty from its first level. Level 1 is already a timed hub of 6 hard pieces (up to tier 5), growing to 10 pieces and 6 motifs (`procedural.endless` in `game.json`). Only the level being played is built; the next one is prefetched in a Web Worker, and the dialog remembers the seed and the furthest level reached so a run can be resumed. The pack never ends. Hub wings can be chains of puzzles that return to the hub through a one-way force-floor strip (`hub.returnGate`), which allows irreversible pieces and removes the walk back. Keys are scarce (`hub.scarceGates`): a door colour can guard two wings while only one key is reachable at first, so the order in which wings are opened matters and the wrong door means restarting the level. Monsters appear in most levels (`procedural.endless.motifShares`). The open area of the hub is content, not bare floor: 1 to 3 monsters that move on fixed lines (`hub.openMonsters`), 3 to 6 chips scattered as route waypoints (`hub.openChips`) and fire or water patches (`hub.openHazards`), with gravel aprons that keep the monsters out of the wings; the prover walks this region with a timed search. Density rules keep puzzles fair: `minBoxCellsPerMonster` gives each monster room and `maxMonstersPerLevel` caps the level. Puzzles depend on one another (`hub.dependencies`): a piece exports a dirt block pushed out of its exit, which is pushed along a straight lane into the next piece, where it bridges the water that locks it; or a piece exports a key that only a door in another wing takes, so the wings must be visited in the right order. Pairs are declared in the pieces themselves (`exports` and `imports` in `motifs.json`), paired by the hub planner in loop-wing hubs only, and the whole level is replayed with the block pushed and the key carried. The library holds 91 pieces, including monster arenas, teleport networks, toggle-wall sequences, clone machines, and the exporter and consumer pieces of these pairs. `npm run report:levels` measures this mode against the community packs, `npm run report:dependencies` measures how many levels hold a dependency pair, and `src/generator/EndlessGuard.test.ts` keeps its width, branching, backtracking, monster presence, share of open floor near content, piece count and generation time above set floors. In block puzzles, the Help button plays the next push, and the game warns as soon as a dead end is proven.
  - **Show Solution** (`O`): every campaign and generated level stores the solution its proof replayed. The button restarts the level and plays that solution to the exit; watching it records no score.
- **Complete Tile & Monster Engine**:
  - Elemental hazards (`water`, `fire`, `ice` with corner deflectors, `force` conveyors, `bomb`).
  - Interactive mechanisms (`button_green`, `button_red` clone machines, `button_brown` bear traps, `button_blue` tank reversers, `teleport` pads, `thief`).
  - Inventory drop: `E` puts the selected key or boots down on the current cell, `C` or `Tab` selects the next held item, and a click on a HUD slot drops that item. Pickups happen only on entering a cell, so a dropped item stays until you come back for it.
  - Forbidden-item barriers (`forbid_key_red`, `forbid_boots_fire`, ...): the cell refuses you while you carry the item and is floor once you have dropped it elsewhere. A key thief (`thief_keys`) takes every key, as the boot thief takes the boots.
  - Turtles (`turtle`) sink into water once the player or a block has left them, so a turtle bridge is crossed once.
  - All fifteen thin-wall combinations (`thin_wall_ns`, `thin_wall_nesw`, ...), colour teleporters that chain only with their own colour (`teleport_red` to `teleport_green`), flame jets toggled by `button_orange` (`flame_jet_off` / `flame_jet_on`, fire boots protect), and bonus items: score flags (`score_10`, `score_100`, `score_1000`, `score_2x` doubles the level score at the exit) and stopwatches (`stopwatch_bonus` adds 10 seconds, `stopwatch_penalty` takes 10).
  - 9 creature movement patterns (`bug`, `fireball`, `pink_ball`, `tank`, `glider`, `teeth`, `walker`, `blob`, `paramecium`).
- **Visual & Tactile Enhancements**:
  - HD Neon and 16-Bit Retro pixel renderers with 4 biome themes (`Cyber Neon`, `Arctic Lab`, `Magma Core`, `Lynx LCD`): walls join into continuous masses that cast soft shadows, light sources glow in HD Neon, an optional LCD grid covers 16-Bit Retro, and the player and every monster are animated. A graphics quality setting (Auto by default) keeps the game smooth on slower devices.
  - Dynamic objective locator and mechanism wire overlay (`H`).
  - Full smartphone touch support (Swipe/Hold virtual joystick, Tap-to-Pathfind, Pinch-to-Zoom, and thumb D-Pad with haptic feedback).
  - Full-featured Level Editor with live solver validation.

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

A `.json` level is a blueprint: `terrain` (a grid of tile ids) or `rows` (legend strings, see `legend` in `levels.json`) gives the level its size, so rows of 40 characters make a 40-wide level; a blueprint with neither gets the default 32x32. The player start, entities and links must lie within that size.

Generator difficulty is derived from a profile (`src/generator/DifficultyProfile.ts`): `profileFor('pack' | 'endless', levelNumber, cfg)` gives the piece count, motif count, hardest tier, layout, timer and target length. Packs follow the learning curve of `procedural`; the endless mode follows `procedural.endless`. The scripted campaign and pack mode are unchanged by the endless work.

The Epoxy campaign itself is described level by level in `tools/campaign-script.json` (motifs to teach, puzzle count, hardest tier); `npm run build:campaign` generates each level, proves it and rewrites `public/configs/levels.json` as readable legend rows.

New puzzle pieces go in `public/configs/motifs.json`; run `npm run annotate:pieces` afterwards to precompute each piece's solution and reversibility into `public/configs/motif-annotations.json`, which the generator uses instead of searching in the browser.

Sokoban rooms: `npm run forge:sokoban` builds original ones backwards from their solution (blocks onto brown buttons that hold the exit traps open). `npm run import:sokoban` adapts a collection in the standard `.xsb` format (set `EPOXY_SOKOBAN_FILE` and `EPOXY_SOKOBAN_CREDIT`); only use collections whose licence allows reuse, and keep the credit. Both write candidates to `local/` for curation. `npm test` checks that each one is solvable in every orientation, that no block can escape through its ports, and that nothing in it is decorative; `npm run report:pieces` writes each piece's solution to `local/piece-probe.txt`.

## Tests

```bash
npm test
```

`npm run report:levels` measures 200 generated levels against the bundled community packs and writes `reports/level-metrics.json`, including playfield metrics: fill (open cells over their bounding box), open share, dead ends, junctions, symmetry and monster presence. `npm run report:study` describes how the community packs combine mechanics, and `npm run mine:pieces` searches for harder puzzle pieces (about half an hour); both write to `local/`.

## Production Build

```bash
npm run build
```

## Credits

The bundled `CCLP 1` to `CCLP 5` packs are community-made level sets, and `Tile World Intro` ships with the Tile World project. All levels in these packs remain the work of their respective authors. Epoxy is not affiliated with the owners of any commercial game.

## License

Copyright 2026 Julien Bombled. The Epoxy source code is licensed under the [Apache License 2.0](./LICENSE). The bundled level packs are not covered by this license.
