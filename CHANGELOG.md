# Changelog

All notable changes to Epoxy are listed here. The format follows Keep a Changelog, and
versions follow Semantic Versioning.

## [Unreleased]

### Added

- Inter-piece dependencies in endless hubs: a level is one puzzle rather than a sequence of
  rooms. A piece may declare `exports` or `imports` in `motifs.json` (`PieceExchange`,
  compiled into `CompiledPiece`): a block export ends with a dirt block pushed out through
  the exit port, a block import begins with that block pushed onto the water just inside the
  entry port; a key export is collected while solving, a key import is a door inside the piece
  with no key of its colour. `PieceSolver` solves and analyses both kinds (`toLevel`,
  `wins`, `withoutImports`), so `annotate:pieces` and the library tests cover them.
- `HubPlanner.addDependencies` swaps pairs into the puzzles of a loop-wing hub
  (`hub.dependencies` in `game.json`: `fromPieces`, `piecesPerPair`, `max`). A block pair is
  bonded in one wing, the consumer right after the exporter; a key pair puts the consumer at a
  later position, usually another wing. `HubPlanner.winningOrder` walks each wing's chain with
  the inventory: an imported key must be held (spent when the door consumes it), an exported
  key is gained, a block import must follow a block export. The colours a pair hands over are
  never used as wing locks. Exchange pieces are kept out of `ProgressionPlanner.playablePieces`,
  so pack mode and the campaign are unchanged (`PackBaseline.test.ts`).
- `HubAssembler` lays a bonded pair out with a straight lane from the exporter's exit port to
  the consumer's entry port, kept clear of rewards, and the route gets a `push` segment;
  `LevelProver` pushes the block along it and checks it rests on the consumer's entry port
  before replaying the consumer. Guards are unchanged.
- 10 pieces (91 in total): 3 block exporters (`block_out_lane`, `block_out_ford`,
  `block_out_twin_fords`), 3 block consumers (`block_in_moat`, `block_in_canal`,
  `block_in_pillar`), 2 key exporters (`key_out_yellow`, `key_out_green`) and 2 key consumers
  (`door_in_yellow`, `door_in_green`), each solvable in every orientation.
- `HubDependencies.test.ts` checks the library, the pairing (at least 80 percent of planned
  endless levels at levels 10 and 20 hold a pair, consumer after exporter in the proven order,
  block pairs adjacent in one wing, none in pack mode) and generated levels (replay, no bypass).
- `npm run report:dependencies` measures 20 seeds at levels 10 and 20 (share with a pair,
  pairs by kind, unproven, bypassable, generation time, quality floors) into
  `local/dependency-study.json`.
- `GeneratedLevel.dependencies` lists the pairs of a generated level.

## [2.2.0] - 2026-10-30

### Changed

- Generate Endless Puzzle reaches community-pack difficulty from level 1. The difficulty of a
  level now comes from `profileFor('pack' | 'endless', levelNumber, cfg)` in
  `DifficultyProfile.ts`. Endless level 1 is a timed hub of hard pieces up to tier
  `procedural.endless.maxTierMax`; the curve is in `procedural.endless` (pieces 6 to 10,
  motifs 4 to 6, tier 4 to 5, scorer target capped by `targetMovesMax`). Pack mode and the
  scripted campaign generate the same levels as before (`PackBaseline.test.ts`).
- Hub levels in endless mode use loop wings: a wing is a chain of up to
  `hub.maxPiecesPerWing` puzzles that returns to the hub through a one-way force-floor strip
  (`hub.returnGate`, `hub.loopModes`), which admits irreversible pieces and removes the walk
  back. Levels with loop wings contain no `boots_force`.
- Keys are scarce in endless hubs (`hub.scarceGates`): a door colour guards two wings while
  only one key of that colour is reachable at first, so the order in which wings are opened
  matters. Opening the wrong door first means restarting the level, as in the classic game;
  `hub.scarceRecovery` places a spare key instead. The winning order is found by a search over
  wing order and inventory, then replayed in the engine like every generated level.
- The monsters motif is asked for in a share of endless levels (`procedural.endless.motifShares`,
  0.8), drawn from the level's own random stream.
- `PieceSolver.solveInLevel` solves monster pieces in an isolated engine (a hub with six
  monster pieces: 3.9 s to 1.0 s mean).
- The endless dialog takes a seed and a free start level and builds only that level. The next
  level is prefetched in a Web Worker (`src/workers/generator.worker.ts`,
  `src/ui/endlessGenerator.ts`). The seed and the furthest level reached are remembered
  (`storage.lastEndlessKey`) and a run can be resumed. The endless pack never ends.
- Measured on 20 seeds before and after the hub work: median walkable cells 282 to 512
  (10 seeds) and 298 to 473 (20 seeds), revisit ratio 1.71 to 1.23, junction share 0.59 to
  0.64, generation p95 11 s to 1.2 s (10 seeds) and 7 s to 2.4 s (20 seeds).

### Added

- 21 puzzle pieces (81 in total): 12 monster arenas with 2 to 4 monsters (6 of tier 5), 3
  teleport networks, 3 toggle-wall sequences and a `cloner` motif with 3 pieces. `teleport`
  and `toggle_walls` may appear twice in a level.
- `report:levels` measures an `endless` sample (seeds 1 to 10 at levels 1, 10, 25 and 50, with
  a sub-summary per level number): planned and kept pieces, generation time, share of levels
  with monsters, motif usage, replay and bypass checks.
- `EndlessGuard.test.ts` asserts floors on endless levels: median walkable cells, revisit
  ratio and junction share, proof and no bypass, generation time, planned pieces kept and
  the share of levels with monsters.

## [2.1.0] - 2026-10-30

### Changed

- Procedural levels are denser and less stringy: boots lie on the corridor instead of a side
  alcove, hubs are bigger and widen into the gaps around them (`hub.bayCells`), wings and
  chain pieces are placed against a bounding-box cost, and the most compact of several
  layouts is kept (`layoutSamples`). Pieces with few dead ends are preferred
  (`maxPieceDeadEnds`) and reward rooms are at least two cells deep.
- Procedural packs vary: no two levels within `noRepeatWindow` share a lead motif or a hub
  outline, both derived from the pack seed, so a level can still be rebuilt on its own.
  Level 1 is a single tier-1 puzzle before the exit, never one of the motifs listed in
  `firstLevelExcludedMotifs` (monsters, teleport, trap, thief), and puzzles that can be
  failed for good come first in a level. A level gives up its preferred motif and outline
  before it gives up a puzzle.
- The Sokoban forge ranks rooms by effective pushes (pushes minus forced opening pushes and
  the trivial tail where each box goes straight home), then by box lines and box changes,
  and can cluster the goals; rooms go up to 6x5 with 3 or 4 blocks.
- The level scorer also weighs dead ends on the playfield and the walking between pieces
  against the moves spent inside them (`scoring` in `game.json`).
- `report:levels` adds playfield metrics (fill, open share, dead share, junction share,
  symmetry, monster presence) and walk per decision.
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
- HD Neon lighting: the scene is slightly darkened away from light sources (the player,
  exits, fire, teleporters, hints, chips, keys, fireballs and gliders), each light adds
  a tinted glow, and a vignette darkens the corners. Light sources, reach and colours
  are set in `lightSources` (`game.json`).
- Water sparkles, flames sway in pairs and give off embers, and glints sweep over ice;
  neighbouring cells animate out of step.
- An iris opens on the player when a level starts or restarts (skipped with reduced
  motion).
- The side panel follows the biome colour; the chip counter and inventory slots pop
  when a chip or an item is picked up.

### Added

- Procedural pack dialog (button, drawer or `N`): type a seed or leave it empty for a
  random one, and choose the level to start at. The seed of the pack being played is shown
  next to the pack selector with a Copy button, so a good pack can be shared or replayed.
- Five Sokoban rooms with 3 or 4 blocks and four monster rooms (a pink ball lane with
  recesses, gliders circling a pillar ring, a tank and its blue button, a bug patrolling a
  hall). Monster rooms stay winnable however long the player waits at the entry, which the
  tests check.
- "LCD Screen" option: a pixel grid over the 16-Bit Retro view, saved with the other
  settings.
- Graphics quality option (Auto, High, Medium, Low). Medium drops the coloured glows and
  draws the darkness coarser; Low turns lighting and the vignette off. Auto starts high
  and steps down one level, with a message, whenever 90 frames in a row average more
  than 12 ms to render. Presets and budget are set in `qualityPresets`, `frameBudgetMs`
  and `frameBudgetWindow` (`game.json`).
- `game.json` is checked at load: a light colour missing from the palette, a joined or
  shadow-casting tile missing from `tiles.json`, or an unknown quality preset or setting
  stops loading with a clear error.

### Fixed

- Portrait fullscreen on phones no longer cuts off the top of the board: the board stays
  at the top of the screen and the side panel scrolls below the controls.

### Accessibility

- With reduced motion requested by the system, the player no longer hops, items no
  longer bob, explosions no longer shake the screen and the opening iris is skipped.

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
