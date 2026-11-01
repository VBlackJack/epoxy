# EPOXY - Grid Logic Puzzle Game

*Version française : [README.fr.md](./README.fr.md)*

**Play online:** [https://vblackjack.github.io/epoxy/](https://vblackjack.github.io/epoxy/)

**EPOXY** is a web-based tile puzzle game in the spirit of the handheld puzzlers of the Atari Lynx era, built with TypeScript, HTML5 Canvas, and the Web Audio API.

## Features

- **Hundreds of Levels Included**:
  - **Epoxy Campaign**: 30 hand-written levels in five chapters of six, each built around one idea and proven solvable by replaying its recorded solution in the game engine. They teach one mechanic per level, from chips, keys and boots to traps, cloners, creatures, thieves, item barriers, turtles and flame jets, and each chapter ends with a level that combines them. An originality test keeps every map unlike the bundled community levels.
  - **Bundled Community Packs**: `Tile World Intro` and `CCLP 1` through `CCLP 5` (see [Credits](#credits)).
  - **Community packs under the original handheld rules**: the bundled community packs (except CCLP 2) and imported `.DAT` files play under the original handheld (Lynx) rules on a dedicated engine. Help, tap-to-path, the objective marker, solution replay, item drop and the dead-end watch are unavailable there. The editor's `Rules` field switches a level between Epoxy and Lynx rules.
  - **`.DAT` / `.CCL` / `.JSON` Support**: Import and export level packs in the widely used CC1 `.DAT` binary format via drag-and-drop. Packs you own can be imported this way. Files larger than `import.maxFileBytes` (4 MiB) are refused before they are read. On export, a level smaller than the 32x32 format is closed with wall, and a level that does not fit is left out with a message instead of being written wrongly. The level author stored in a pack (field 9) is shown next to the title and kept on export, and the editor has an Author field.
  - **Sokoban collections (`.xsb` / `.sok`)**: drop a collection on the game and every level plays as Sokoban: it is won as soon as each target holds a block, with no exit to reach. Run-length rows (`4#`) are expanded, the outside of the room becomes wall, and a level the file breaks (no player, no target, fewer boxes than targets, a room open to the edge) is skipped with a count. Packs you own stay in your browser, like imported `.DAT` packs. In the editor, any level can use this rule (`Win Rule` field, `block_target` tile); such a level cannot be exported to `.DAT`. Help plays the next push and the dead-end watch covers these levels, up to `blockPuzzle.watchMaxCells` cells. Sokoban levels are drawn automatically with sprites from Kenney's Sokoban pack (cobble floor, brick walls, target marks, wooden crates) whatever graphics style is selected, while the player keeps the style's own sprite; a button next to the LCD toggle in Options > Advanced turns this skin off (on by default, saved).
  - **Levels of any size**: a `.json` level or custom pack sets its own width and height, from a 10x10 room to a 40x40 or 100x100 level (`grid.minLevelSize` to `grid.maxLevelSize` in `game.json`); the camera and the editor follow the level. The `.DAT` format and the procedural generator keep the classic 32x32 (`grid.mapWidth` / `grid.mapHeight`).
  - **Proven Procedural Generator**: Builds levels from hand-drawn puzzle pieces (`public/configs/motifs.json`), each proven fair and solvable by a solver that runs the real game engine. Every generated level is then replayed start to finish before it is offered, so it is always solvable and no puzzle can be skipped. Difficulty, focus and pacing grow with the level number. From level 3, levels are hubs with locked wings whose keys and boots lie in other wings; hub outlines (`procedural.hub.shapes` in `game.json`) and reward rooms vary, and with the biome set to Auto each level shows the theme of its main mechanic. Levels are laid out compactly, with few dead ends, and no two neighbouring levels of a pack share a main mechanic or hub outline. Each pack comes from a seed: **Endless mode** (or `N`) asks for one (empty means random) and the level to start at, and the seed of the pack being played is shown next to the pack selector with a Copy button.
  - **Endless mode**: aims at community-pack difficulty from its first level. Level 1 is already a timed hub of 6 hard pieces (up to tier 5), growing to 10 pieces and 6 motifs (`procedural.endless` in `game.json`). Only the level being played is built; the next one is prefetched in a Web Worker, and the dialog remembers the seed and the furthest level reached so a run can be resumed. The pack never ends; a run can start at any level up to `endlessUi.maxStartLevel` (10000), and `src/generator/EndlessFingerprint.test.ts` checks that a seed always builds the same levels. Hub wings can be chains of puzzles that return to the hub through a one-way force-floor strip (`hub.returnGate`), which allows irreversible pieces and removes the walk back. Keys are scarce (`hub.scarceGates`): a door colour can guard two wings while only one key is reachable at first, so the order in which wings are opened matters and the wrong door means restarting the level. Monsters appear in most levels (`procedural.endless.motifShares`). The open area of the hub is content, not bare floor: 1 to 3 monsters that move on fixed lines (`hub.openMonsters`), 3 to 8 chips scattered as route waypoints, one more per so many cells of the region (`hub.openChips`) and fire or water patches (`hub.openHazards`), with gravel aprons that keep the monsters out of the wings; the prover walks this region with a timed search. The region scales with the area the puzzles leave free: the hub outline grows by rows and columns of floor before the wings are placed (`hub.outlineGrowth`), so a level with fewer or smaller puzzles has a larger hub; the prover's region search heads for its target best first, so the proof cost follows the way, not the floor; `npm run report:hub` measures where the map area goes. Density rules keep puzzles fair: `minBoxCellsPerMonster` gives each monster room and `maxMonstersPerLevel` caps the level. Puzzles depend on one another (`hub.dependencies`): a piece exports a dirt block pushed out of its exit, which is pushed along a straight lane into the next piece, where it bridges the water that locks it; or a piece exports a key that only a door in another wing takes, so the wings must be visited in the right order. Pairs are declared in the pieces themselves (`exports` and `imports` in `motifs.json`), paired by the hub planner in loop-wing hubs only, and the whole level is replayed with the block pushed and the key carried. The library holds 91 pieces, including monster arenas, teleport networks, toggle-wall sequences, clone machines, and the exporter and consumer pieces of these pairs. `npm run report:levels` measures this mode against the community packs, `npm run report:dependencies` measures how many levels hold a dependency pair, and `src/generator/EndlessGuard.test.ts` keeps its width, branching, backtracking, monster presence, share of open floor near content, piece count and generation time above set floors. In block puzzles, the Help button plays the next push, and the game warns as soon as a dead end is proven (search budgets under `blockPuzzle` in `game.json`: a small one for the automatic watch, a larger one for the Help button).
  - **Solution** (`O`): every campaign and generated level stores the solution its proof replayed. The button restarts the level and plays that solution to the exit; watching it records no score.
- **Complete Tile & Monster Engine**:
  - Elemental hazards (`water`, `fire`, `ice` with corner deflectors, `force` conveyors that carry the player, blocks and monsters, `bomb`).
  - Interactive mechanisms (`button_green`, `button_red` clone machines, `button_brown` bear traps, `button_blue` tank reversers, `teleport` pads, `thief`).
  - Inventory drop: `E` puts the selected key or boots down on the current cell, `C` selects the next held item, and a click on a HUD slot drops that item. Pickups happen only on entering a cell, so a dropped item stays until you come back for it.
  - Forbidden-item barriers (`forbid_key_red`, `forbid_boots_fire`, ...): the cell refuses you while you carry the item and is floor once you have dropped it elsewhere. A key thief (`thief_keys`) takes every key, as the boot thief takes the boots.
  - Turtles (`turtle`) sink into water once the player or a block has left them, so a turtle bridge is crossed once.
  - All fifteen thin-wall combinations (`thin_wall_ns`, `thin_wall_nesw`, ...), colour teleporters that chain only with their own colour (`teleport_red` to `teleport_green`), flame jets toggled by `button_orange` (`flame_jet_off` / `flame_jet_on`, fire boots protect), and bonus items: score flags (`score_10`, `score_100`, `score_1000` join the level score paid at the exit; `score_2x` doubles that level score, flags included) and stopwatches (`stopwatch_bonus` adds 10 seconds, `stopwatch_penalty` takes 10). The boots that protect you on your current cell cannot be dropped there.
  - 9 creature movement patterns (`bug`, `fireball`, `pink_ball`, `tank`, `glider`, `teeth`, `walker`, `blob`, `paramecium`).
- **Visual & Tactile Enhancements**:
  - HD Neon, 16-Bit Retro and 32-Bit Retro pixel renderers (chosen in Options > Essential, or cycled with `G`) with 4 biome themes (`Cyber Neon`, `Arctic Lab`, `Magma Core`, `Lynx LCD`): walls join into continuous masses that cast soft shadows, light sources glow in HD Neon, 16-Bit Retro draws every tile and character as a 16x16 sprite in a 9-bit console palette (with an optional LCD grid), 32-Bit Retro uses 32x32 shaded sprites in 15-bit colour (lighting and shine are drawn on top), and the player and every monster are animated. A graphics quality setting (Auto by default) keeps the game smooth on slower devices.
  - **Hint** (`H`): dynamic objective locator and mechanism wire overlay; hovering a colour teleporter shows its own network, and hovering an orange button shows the flame jets it toggles.
  - Colour-blind glyphs on coloured doors, keys, buttons and colour teleporters.
  - Reduced motion: with the system setting on, the hop, bob, glints, flicker, blinking, particles and screen shake rest, and a change of the setting is followed live.
  - Keyboard: `Tab` moves focus between the controls, Ctrl/Cmd chords are left to the browser except undo (Ctrl/Cmd+Z), which follows the keyboard layout (AZERTY, QWERTY, Cyrillic...), and `?` opens the help.
  - Full smartphone touch support (Swipe/Hold virtual joystick, Tap-to-Pathfind, and thumb D-Pad with haptic feedback; the zoom is set in the options). The board always shows the chosen view as a square of N x N tiles, so a wide or landscape screen reveals no more of the level than a square one.
  - Full-featured Level Editor with live solver validation.
- **Music**: original music tracks (see [Credits](#credits)) and a synthesized soundtrack, with three modes, chosen in Options > Advanced (sound on/off stays in Options > Essential). **Default** follows the biome on screen (each biome names its track with `musicTrackId` in `game.json`). **Random** picks a new track for each new level and never repeats the previous one while two or more tracks exist. **Custom** does the same among the tracks you tick (at least one stays ticked). A restart, a retry after dying or a one-level wrap does not change the track, and in Random and Custom the biome (and the `B` key) no longer changes the music. The mode and the ticked tracks are saved.
  - The game ships seven original tracks: `8-bit Odyssey` for Cyber Neon, `Subterranean Pulse I` for Arctic Lab and `Subterranean Pulse III` for Magma Core (`Subterranean Pulse II` and `IV` are in Random and Custom). Retro Lynx LCD keeps its synthesized track.
  - In Default mode, the levels of an endless run play `Endless I` or `Endless II` instead of the biome track: a new level never repeats the track of the level before. The list is `endlessUi.musicTrackIds` in `game.json`. Random and Custom are unchanged.
- **Sound effects**: most effects play bundled CC0 audio files (see [Credits](#credits)), with the synthesized sound as fallback until a file is decoded or when it fails. Footsteps depend on the terrain the player steps onto (floor, force floor, ice, and water or fire with the protecting boots), mapped by `terrainStepEffects` in `audio.json`. Under the Lynx rules, only a step the player chooses makes a sound.

## Development

Requires Node.js 24 (see `.nvmrc`).

```bash
npm install
npm run dev
```

### Adding music tracks

Tracks are declared in `public/configs/audio.json` under `tracks`. A track is synthesized by default (notes and waveforms) or streamed from audio files:

```json
{
  "id": "my_track",
  "i18nKey": "app.music.my_track.label",
  "source": "file",
  "files": ["my_track.ogg", "my_track.mp3"],
  "gain": 0.8
}
```

- Put the files in `public/audio/music/` (the folder is `musicBaseUrl`). The browser plays the first file in `files` it can decode; the extension must have a MIME type in `fileMimeTypes` (`ogg` and `mp3` by default). `gain` scales the track against the music volume (1 when omitted).
- Add the track name to `src/locales/en.json` and `src/locales/fr.json` under `app.music.my_track.label`.
- Map it to a biome with `"musicTrackId": "my_track"` on the theme in `game.json`. Every track also takes part in the Random and Custom modes.
- `defaultTrackId` must stay a synthesized track: it plays when a file cannot be loaded. A file track that fails is skipped for the rest of the session.
- The configuration is checked when the game loads: duplicate ids, a file track without files, an unknown `musicTrackId` or an unknown `defaultMusicMode` stop the game with a clear message.

### Adding sound effects

Each effect is declared in `public/configs/audio.json` under `effects.<id>`. An effect is synthesized from `waveform` and `notes`, and can also play audio files:

```json
"teleport": {
  "files": ["sfx_movement_portal5.wav"],
  "maxDurationMs": 400,
  "fadeOutMs": 150,
  "gain": 0.4,
  "waveform": "sawtooth",
  "notes": [
    { "freq": 330, "durationMs": 35, "gain": 0.4 },
    { "freq": 495, "durationMs": 35, "gain": 0.4 },
    { "freq": 742, "durationMs": 45, "gain": 0.45 },
    { "freq": 1113, "durationMs": 60, "gain": 0.4 }
  ]
}
```

- Put the files in `public/audio/sfx/` (the folder is `sfxBaseUrl`, `./audio/sfx` when omitted) and list their names in `files`. With several files they play in turn, so the step alternates between its footsteps. A file that fails to load or decode is skipped.
- `gain` (1 when omitted) is the loudness against the master volume times the sfx volume; the shipped files use 0.4, except `blocked` (0.25) and the footsteps (0.2 to 0.45, calibrated so the quieter Kenney recordings play at about half the loudness of the other effects).
- `minIntervalMs` (no limit when omitted) skips a call made less than that long after the previous start of the same effect, on the audio clock; `blocked` ships at 250 so holding a key against a wall does not machine-gun.
- `maxDurationMs` stops the playback there. `fadeOutMs` adds a linear fade that ends at that cap; it requires `maxDurationMs` and cannot be larger than it.
- `waveform` and `notes` stay required: they are the fallback, played when no file is decoded yet (the first sounds right after the audio unlocks) or when a file is missing or fails.
- 17 of the 19 effects use files; `splash` and `burn` stay synthesized.
- `terrainStepEffects` maps a terrain to the effect id played for a step onto it. The key is the tile's `slideType` or `hazard` (`force`, `ice`, `water`, `fire`); any other tile, and a terrain without an entry or whose effect does not exist, plays `step`. Water and fire only count when the player wears the protecting boots; without them the tile keeps the normal step and the splash or burn sound follows on its own. A force floor counts even when the boots cancel its push.
- Safari versions that cannot decode Ogg Vorbis cannot play the footstep files and fall back to the synthesized step.
- `teleport` (400 ms cap, 150 ms fade), `thief` (500 ms cap, 150 ms fade) and the footsteps (`step` and `step_fire` 120 ms cap and 30 ms fade, `step_force` and `step_ice` 150 ms and 50 ms, `step_water` 180 ms and 60 ms) use a cap and a fade.

## Building a Campaign with the Generator

1. Open the **Level Editor**, set a **Difficulty**, leave **Seed** empty and press **Generate**. The seed used is written back, so the same level can be generated again.
2. Retouch the level, then **Test** it.
3. **Export JSON** and paste the exported object into the `levels` array of `public/configs/levels.json`. Exported levels load as they are; set `number` to the position you want.

A `.json` level is a blueprint: `terrain` (a grid of tile ids) or `rows` (legend strings, see `legend` in `levels.json`) gives the level its size, so rows of 40 characters make a 40-wide level; a blueprint with neither gets the default 32x32. The player start, entities and links must lie within that size.

Generator difficulty is derived from a profile (`src/generator/DifficultyProfile.ts`): `profileFor('pack' | 'endless', levelNumber, cfg)` gives the piece count, motif count, hardest tier, layout, timer and target length. Packs follow the learning curve of `procedural`; the endless mode follows `procedural.endless`. The campaign and pack mode are unchanged by the endless work.

The Epoxy campaign is written by hand in `public/configs/levels.json`. Each level's solution is described as a route in `tools/campaign-routes.json`: explicit moves (`N`, `E`, `S`, `W`, `.` to wait) for pushes and timing, and `@x,y` steps that walk to a cell along a path found by a search in the real engine. `npm run route:campaign` expands the routes and writes each solution into `levels.json` (`EPOXY_ROUTE_LEVEL=<id>` for one level). `npm test` replays every solution, checks that the exit stays out of reach without each item listed under `requires`, and checks the pacing in `tools/campaign-rhythm.json`: chapters, the level where each tile, item or entity first appears, and timer margins. To compare the campaign with a reference pack you own, run `EPOXY_REFERENCE_DAT=<path> npm run report:originality`; the closest pairs go to `local/originality.md`, which is never committed.

New puzzle pieces go in `public/configs/motifs.json`; run `npm run annotate:pieces` afterwards to precompute each piece's solution and reversibility into `public/configs/motif-annotations.json`, which the generator uses instead of searching in the browser.

Sokoban rooms: `npm run forge:sokoban` builds original ones backwards from their solution (blocks onto brown buttons that hold the exit traps open). `npm run import:sokoban` adapts a collection in the standard `.xsb` format (set `EPOXY_SOKOBAN_FILE` and `EPOXY_SOKOBAN_CREDIT`); only use collections whose licence allows reuse, and keep the credit. The entry and exit tunnels are carved on any side of the room, the exit opening where the player can stand once every box is home, and the import report lists why each rejected level was not kept. Both write candidates to `local/` for curation. `npm test` checks that each one is solvable in every orientation, that no block can escape through its ports, and that nothing in it is decorative; `npm run report:pieces` writes each piece's solution to `local/piece-probe.txt`.

## Tests

```bash
npm test
```

The suite includes `src/test/typographyGuard.test.ts`, which scans every tracked text file for banned typographic characters (dashes, curly quotes, one-character ellipsis, non-breaking spaces, ligatures).

`npm run report:levels` measures 200 generated levels against the bundled community packs and writes `reports/level-metrics.json`, including playfield metrics: fill (open cells over their bounding box), open share, dead ends, junctions, symmetry and monster presence. `npm run report:study` describes how the community packs combine mechanics, and `npm run mine:pieces` searches for harder puzzle pieces (about half an hour); both write to `local/`.

## Production Build

```bash
npm run build
```

## Credits

The bundled `CCLP 1` to `CCLP 5` packs are community-made level sets, and `Tile World Intro` ships with the Tile World project. All levels in these packs remain the work of their respective authors. Epoxy is not affiliated with the owners of any commercial game.

### Audio

Music: Julien Bombled (original tracks in `public/audio/music/`).

Sound effects: The Essential Retro Video Game Sound Effects Collection by Juhani Junkala, published by SubspaceAudio on OpenGameArt (https://opengameart.org/content/512-sound-effects-8-bit-style), CC0 1.0, licence verified 2026-11-01.

Files in `public/audio/sfx/` and the effect each one serves:

- `sfx_sounds_impact3.wav`: blocked
- `sfx_coin_single3.wav`: chip
- `sfx_coin_double1.wav`: item
- `sfx_movement_dooropen1.wav`: door
- `sfx_sounds_powerup15.wav`: socket
- `sfx_sounds_button10.wav`: button
- `sfx_movement_portal5.wav`: teleport
- `sfx_sounds_negative2.wav`: thief
- `sfx_exp_short_hard4.wav`: bomb
- `sfx_deathscream_android5.wav`: death
- `sfx_sounds_fanfare1.wav`: win
- `sfx_lowhealth_alarmloop6.wav`: timer_warn

Footsteps: Impact Sounds by Kenney (https://kenney.nl/assets/impact-sounds), CC0 1.0, licence verified 2026-11-01.

- `footstep_concrete_000.ogg`, `footstep_concrete_001.ogg`, `footstep_concrete_002.ogg`: step
- `impactMetal_heavy_000.ogg`, `impactMetal_medium_000.ogg`: step_force
- `footstep_snow_000.ogg`, `footstep_snow_002.ogg`: step_ice
- `footstep_grass_001.ogg`, `footstep_grass_004.ogg`: step_fire

Water step: "ocean splash" by Thimras on OpenGameArt (https://opengameart.org/content/ocean-splash), CC0 1.0, licence verified 2026-11-01.

- `cannon_miss.ogg`: step_water

### Graphics

Sokoban skin: Sokoban pack by Kenney (https://kenney.nl/assets/sokoban), CC0 1.0, licence verified 2026-11-01.

Files in `public/sprites/sokoban/` and the role of each one:

- `ground_06.png`: floor and target base
- `block_05.png`: wall
- `environment_06.png`: target marks
- `crate_02.png`: block
- `crate_12.png`: block on a target

## License

Copyright 2026 Julien Bombled. The Epoxy source code is licensed under the [Apache License 2.0](./LICENSE). The bundled level packs are not covered by this license.
