# Changelog

All notable changes to Epoxy are listed here. The format follows Keep a Changelog, and
versions follow Semantic Versioning.

## [Unreleased]

### Changed

- Walls join into continuous masses, seen slightly from the south: a lit rim along the
  edges facing the floor, a darker interior and a front face, in both renderers (brick
  bond in 16-Bit Retro). Walls, doors and blue walls throw a soft shadow on the floor
  south and east of them (dithered in Retro), and some floor cells show a seam, a vent
  or a scuff. Shapes, depths and the tiles that join or cast shadows are set in the
  `graphics` block of `game.json`.
- New player sprite, seen from the front, back or side, with a two-frame stride and a
  small hop on each step.
- Each monster has its own silhouette and a two-frame animation; bugs, paramecia,
  gliders, tanks and fireballs turn to face where they go, the others look there.
  Pushable blocks get a front face like the walls; items float over a ground shadow.

## [2.0.0] - 2026-10-29

### Breaking

- The original `CHIPS.DAT` pack is no longer shipped. Owners of the game can still import
  their own copy by drag-and-drop.
- The campaign is now the Epoxy campaign only, rebuilt from scratch: progress saved on
  the old campaign does not carry over. Community packs stay available separately.

### Added

- Procedural generator built from hand-drawn puzzle pieces, each proven solvable by a
  solver running the real game engine. Every generated level is replayed start to finish
  before it is offered, and checked so that no puzzle can be skipped.
- Hub levels from level 3: wings locked by doors or hazard strips, whose keys and boots
  lie in other wings; seven hub outlines and reward rooms for variety.
- Sokoban-style block rooms, built backwards from their solution.
- Block puzzle helper: the game warns as soon as a dead end is proven, and the Help
  button plays the next push.
- Show Solution button (`O`, also on the mobile pad): restarts the level and plays its
  proven solution to the exit. Watching it records no score.
- A theme per level, with an "Auto" biome setting that follows it.
- Level editor: generate a proven level from a difficulty and a seed, then retouch it.
- Epoxy campaign of 20 scripted, proven levels (`tools/campaign-script.json`,
  `npm run build:campaign`).
- Tooling: level metrics against the community packs, community pattern study, piece
  miner, Sokoban forge and `.xsb` importer (licensed collections only, with credit).
- Vitest test suite and continuous integration on every branch and pull request.
- French README and credits for the bundled community packs.

### Changed

- Rendering caches static terrain and uses real elapsed time.
- Dialogs are accessible and every user-facing text goes through translations.
- Vite upgraded to version 7.

### Fixed

- Game rules corrected and runs made deterministic; the level validator is stricter.
- `.DAT` decoding hardened, including ice corners that were read with the wrong
  orientation.
- Pack storage in IndexedDB hardened; fetched configs and imported levels are validated.
- Editor no longer loses unsaved work.
- Audio unlocks reliably on the first interaction.
