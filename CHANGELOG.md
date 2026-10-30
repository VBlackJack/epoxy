# Changelog

All notable changes to Epoxy are listed here. The format follows Keep a Changelog, and
versions follow Semantic Versioning.

## [2.5.0] - 2026-10-30

### Changed

- Ice corners (`ice_nw`, `ice_ne`, `ice_sw`, `ice_se`) are drawn as rounded bends in both
  renderers: the walled corner of the cell stays solid, the open quadrant is a quarter disc of
  ice whose arc reaches both open edges, and a band along the slide path carries the specular
  streak. In HD Neon the glint runs along the curve, one way then the other on alternating
  cycles, so both travel directions through the bend get shown; the retro bend is static, as
  retro ice always was, and keeps the one-dot gutter of plain retro ice so the seam with the
  next ice cell is even. The geometry is derived from each tile's `blockedEntryDirections`
  (`src/render/iceBend.ts`), so the picture follows the engine's deflection rules; a test checks
  every corner against its `deflectionMap`. New palette keys `iceBendBand`, `modernIceBendBand`
  and `modernIceBendRim`. Editor palette icons follow, since they are drawn by the same code;
  the radar keeps one ice colour per cell.
- With reduced motion, the HD Neon ice glints (straight and along bends) rest, like the player
  hop, the item bob, the iris and the screen shake already did.

## [2.4.0] - 2026-10-30

### Added

- Inventory drop and selection. `E` or `X` (`keybindings.dropItem`) puts the selected key or
  pair of boots down on the player's cell when it holds no item; `C` or `Tab`
  (`keybindings.cycleItem`) selects the next held item, shown with an outline on its HUD slot,
  and a click on an owned slot drops that item. A dropped item is not picked up again until the
  player leaves the cell and comes back, since pickups only happen on arrival. Drops are
  recorded in the timed move history (`TimedMove.drop`), so high-score replays include them.
- Forbidden-item barriers (`TileDefinition.forbiddenItem`): `forbid_key_red`,
  `forbid_key_blue`, `forbid_key_yellow`, `forbid_key_green`, `forbid_boots_ice`,
  `forbid_boots_water`, `forbid_boots_fire` and `forbid_boots_force` refuse the player while
  they carry the named item and behave as floor otherwise. Drawn as the item's icon under a
  red crossed ring. The pathfinder treats them as walls while the item is held.
- Key thief (`stealsKeys`, tile `thief_keys`): entering it empties the player's keys, as the
  boot thief empties the boots.
- Transform on leave (`transformsToOnLeave`) and the `turtle` tile: a cell the player or a
  block has left turns into the named terrain, so a turtle sinks into water behind whoever
  crossed it.
- Every thin-wall combination: `thin_wall_ne`, `thin_wall_nw`, `thin_wall_sw`, `thin_wall_ns`,
  `thin_wall_ew`, `thin_wall_nes`, `thin_wall_new`, `thin_wall_nsw`, `thin_wall_esw` and
  `thin_wall_nesw` join the five existing panels; both renderers draw one bar per blocked edge
  read from `blockedEdges`.
- Colour teleporters (`teleportGroup`): `teleport_red`, `teleport_blue`, `teleport_yellow` and
  `teleport_green` chain only with teleporters of their own colour; the plain `teleport` keeps
  its single network. The pathfinder and the validator follow the same groups.
- Flame jets: `button_orange` (`buttonAction: "toggle_flames"`) swaps every tile that declares
  `flameTogglesTo`, so `flame_jet_off` and `flame_jet_on` trade places; a lit jet is fire that
  fire boots protect from, and lighting one under the player burns them.
- Bonus items (`collectible: "bonus"`): `score_10`, `score_100` and `score_1000` carry points
  (`scoreBonus`) that join the level score paid at the exit, `score_2x` doubles that level
  score (`scoreMultiplier`): base points, time bonus and flag points alike, so flags count in
  the high-score table. `stopwatch_bonus` and `stopwatch_penalty` add or take 10 seconds
  (`timeBonusSeconds`) in timed levels. Undo rolls all of them back.
- The boots that protect the player on their current cell cannot be dropped there (flippers in
  water, fire boots on fire, skates on ice, suction boots on a force floor).
- A teleporter never lands the player on a barrier against an item they carry; such an exit
  counts as blocked, like an occupied one.
- Lighting a flame jet under a block or a monster applies the fire rule: an ice block melts into
  water, a monster that is not immune dies.
- The level validator models `toggle_flames` buttons (a reachable button puts the jets out) and
  key thieves (a reachable one takes the keys); the objective locator skips barriers against a
  held item and offers the orange button while a jet is lit.
- `.CCL` export reports what the format cannot carry: colour teleporters are written as the
  plain teleporter, and the other new tiles become floor or are left out, each named in a
  notice after the download.
- A hand-made level that exercises every mechanic, `src/test/fixtures/mechanicsShowcase.json`,
  importable as a JSON pack and played through in `MechanicsShowcase.test.ts`; config tests check
  that every new tile resolves and that every tile reference names an existing tile.

### Changed

- `Tab` now selects the next inventory item; the viewport zoom cycles with `V` and the wheel.
- The `.DAT` encoder writes floor for a terrain without a byte code and drops an item without
  one, so a JSON level using the new tiles exports without failing; the export notice lists
  what was replaced or lost.
- The hub region of an endless level scales with the area its puzzles leave free. The drawn
  outline (`hub.shapes`) now grows before the wings are placed: whole rows and columns of floor
  are added round it, toward the map edge the hub is shifted to first, until it covers
  `hub.outlineGrowth.freeAreaShare` of the free area (the map interior less the puzzle boxes
  and `cellsPerPiece` cells of corridor per puzzle), at most `maxCells` more than drawn
  (`src/generator/HubOutline.ts`). A level with more or larger puzzles grows its hub less. The
  grown outline is asked for on the first `growAttemptsPerTier` attempts (3) of each tier, the
  strict ones at most, so a plan that finds no room round the larger hub gets the drawn outline
  before any puzzle is dropped; an endless tier holds `endless.attemptsPerDroppedPiece` attempts
  (10, against `hub.attemptsPerDroppedPiece` 8 for packs), which keeps every planned puzzle at
  levels 20 and 50. The growth itself draws nothing from the random stream and does
  not apply to dead-end hubs, so pack mode and the campaign are unchanged; the wings do find
  other placements round the larger ring, so the levels differ. Measured
  against main on 20 seeds, each run alone (hub region median, content share median and
  minimum, planned pieces kept, generation median and p95): level 1 168 to 213 cells, share
  0.64 (0.54) to 0.70 (0.61), 20 of 20 kept, 0.54 to 0.61 s median and 1.12 to 1.23 s p95;
  level 10 99 to 135, 0.71 (0.62) to 0.85 (0.64), 20 of 20, 1.07 to 1.19 s and 2.47 to
  2.97 s; level 20 157 to 151, 0.80 (0.73) to 0.81 (0.68), 20 of 20, 1.51 to 2.24 s and 3.71
  to 5.05 s; level 50 103 to 132, 0.81 (0.73) to 0.79 (0.61), 19 to 20 of 20, 1.53 to 1.99 s
  and 4.12 to 4.07 s. No unproven or bypassable level. Level 20 costs the most: its 10-piece
  plans need 4.0 attempts on average against 2.6, the grown hub giving way after the third.
  Hub monsters per level sit at 1.4 to 1.5 at levels 20 and 50 against 1.85 and 1.65 on main,
  from the plans the layouts accept (longer lanes change nothing).
  Rejected on the same seeds: a higher fringe cap (`loopFringeCells` 400 gives 350 to 470 cell
  regions of bare floor that lose the candidate scoring, and the median falls), a smaller hub
  shift (`maxShift` 3 encloses the hub on every side), a second ring of floor on every
  outline (content share under 0.6 at level 1, generation time doubled), and a growth that
  gives way a quarter at a time over the strict attempts (fewer pieces kept at level 20, and
  slower).
- The chips of the hub region follow its size: at least one per `hub.openChips.regionCellsPerChip`
  cells (28), up to `openChips.max` (now 8), so a grown hub does not lower the share of its
  floor near content. `EndlessGuard.test.ts` now also holds the worst level of its sample at a
  content share of 0.5, and samples level 50 beside levels 1 and 25.
- The region search of the prover (`RegionSolver`) expands states best first, by moves made
  plus the grid distance left to the target, instead of breadth first. The way found is the
  same kind of way, confirmed by replay as before, but the states explored grow with the way
  rather than with the region: region search states, median (p95), main to
  branch, level 10 4006 (9767) to 1320 (2590), level 20 5608 (8345) to 935 (2402), level 50
  4050 (10699) to 866 (3035); on the same levels with the growth off, level 10 4006 to 790.
- `npm run report:hub` (`tools/hubAreaStudy.report.ts`) measures where the map area of endless
  levels goes: hub outline, region, wing floor, piece boxes, walls, unused pockets and the free
  land the region could still join. It writes `local/hub-area-study.<tag>.json` and ASCII maps
  of the first seeds to `local/hub-area-maps.<tag>.txt`; `HUB_STUDY_VARIANT` merges a JSON
  object over `procedural.hub` so levers are compared on the same seeds.

## [2.3.0] - 2026-10-30

### Added

- Content in the open area of endless hubs. The hub region now carries 1 to 3 deterministic
  monsters (`hub.openMonsters`: pink ball, glider, fireball, bug, paramecium), 3 to 6 chips
  scattered as route waypoints (`hub.openChips`), fire and water patches kept off the monster
  lanes (`hub.openHazards`) and wall dividers that cut the region into lanes. Gravel aprons
  (`hub.apronTerrain`) close the region at every gate and strip end so the monsters stay out of
  the wings and the pieces. `GeneratedLevel.open` exposes the region, aprons, monsters, lanes,
  chips, hazards and dividers.
- Region search: `RegionSolver` plays the hub region in the isolated engine with a timed
  search, and `LevelProver` walks the open chips in a fixed order as waypoints, so a level with
  wandering monsters is still proven by replay.
- Density rules: `minBoxCellsPerMonster` (one monster per 20 box cells) and
  `maxMonstersPerLevel` are enforced by the planner, in the selection and in the pool of
  smaller sister pieces used when fitting the area. Six over-dense pieces were removed from the
  library.
- Content guard in `EndlessGuard.test.ts`: at least 0.6 of the outside floor (walkable cells
  outside every piece box) lies within 4 steps of a chip, a monster lane or a hazard cell.
  `src/test/openAreaMetrics.ts` measures it and `src/test/openAreaChecks.ts` holds the
  per-level rules of the open area.
- `tools/levelMetrics.report.ts` reports the open area of the endless sample (outside floor,
  content share, hub monsters, open chips, region cells, dependency pairs) and runs the
  open-area rules on 40 levels (20 seeds at levels 10 and 20).

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
  later position, usually another wing. A level gets one block pair at most while key pairs are
  available, and the second half of each attempt tier plans key pairs only, before a puzzle is
  dropped. The puzzles a pair replaces are chosen so the level stays within
  `hub.puzzleAreaBudget` whenever a choice allows it, and `fitToArea` may swap an exchange
  piece for a smaller one with the same export or import. `HubPlanner.winningOrder` walks each
  wing's chain with
  the inventory: an imported key must be held (spent when the door consumes it), an exported
  key is gained, a block import must follow a block export. The colours a pair hands over are
  never used as wing locks. Exchange pieces are kept out of `ProgressionPlanner.playablePieces`,
  so pack mode and the campaign are unchanged (`PackBaseline.test.ts`).
- `HubLoopAssembler` lays a bonded pair out with a straight lane from the exporter's exit port
  to the consumer's entry port, kept clear of rewards, and only offers exporter placements
  with room for a lane and a consumer straight beyond the exit; wings holding a lane are placed
  first. The route gets a `push` segment, and `LevelProver` pushes the block along it and checks
  it rests on the consumer's entry port before replaying the consumer. Guards are unchanged.
- The layout's hottest helpers (`HubGrid.corridorFits`, the claimed-cell test of a placement
  search) address cells by arithmetic instead of allocating points; generated levels are
  unchanged.
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
- Measured on 20 seeds: every level at levels 10 and 20 holds a pair, none is unproven or
  bypassable, every planned piece is kept (without pairs, 0.80 of the levels at level 20),
  median walkable cells 487 and 457, revisit 1.22 and 1.23, junction share 0.63 and 0.57,
  monsters in 0.95 of the levels. Generation p95 is 2.8 s at level 10 and 3.4 s at level 20 on
  a loaded machine; interleaved with main in one process, the branch costs 1.39 times main's
  CPU on levels 25 and 50, of which the hub assembler split alone accounts for about 1.25.
- Levels of variable dimensions. A `.json` level or a custom pack sets its own width and
  height: `compileBlueprint` takes the size from `terrain` or from the legend `rows` (their
  count and the widest row), within `grid.minLevelSize` to `grid.maxLevelSize` in `game.json`
  (1 to 128); a blueprint with neither keeps the default `grid.mapWidth` x `grid.mapHeight`.
  Stored custom levels and imported packs are accepted at any rectangular size within those
  bounds (`isCompiledLevelShape` checks the terrain grid, the matching items grid and the
  player start against the level's own size). The engine, the camera, the screen-to-cell
  conversion, the radar and the level editor use the loaded level's dimensions. The `.DAT`
  codec and the procedural generator keep 32x32.

### Changed

- The walkable-cell floor of the endless guard moves from 450 to 300. 450 had been reached
  with empty bays, which is bare floor and not content; with monsters, chips and patches in the
  hub the median is about 340 to 390 walkable cells, of which 0.76 of the outside floor is
  within 4 steps of content (it was 0.24). The junction-share floor moves from 0.55 to 0.45 for
  the same reason (dividers and aprons; median 0.48 on the guard sample). Per-level generation
  time grows from a median of 1.2 s to 2 s at level 10 (p95 2.9 s to 5.3 s) because the prover
  searches the region.
- Bay tuning: four settings of `hub.loopBayCells` and `hub.loopFringeCells` ((60, 120),
  (90, 150), (120, 180), (150, 120)) were measured on 20 seeds at levels 10 and 20; none
  changes the walkable median, the content share or the kept pieces, so the values stay at
  60 and 120.
- `HubOpenArea.test.ts` shares one 8-level sample (about 15 s instead of 190 s); its 40-level
  checks run in `npm run report:levels`.

### Fixed

- Imported packs were lost on reload: the IndexedDB store was read before `game.json` was
  loaded, so the read failed and every stored pack was dropped. The store is now read once the
  configs are installed.

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
