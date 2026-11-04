# EPOXY - Grid Logic Puzzle Game

*Version française : [README.fr.md](./README.fr.md)*

**Play online:** [https://vblackjack.github.io/epoxy/](https://vblackjack.github.io/epoxy/)

**EPOXY** is a web-based tile puzzle game in the spirit of the handheld puzzlers of the Atari Lynx era, built with TypeScript, HTML5 Canvas, and the Web Audio API.

## Features

- **Hundreds of Levels Included**:
  - **Epoxy Campaign**: 30 hand-written levels grouped in chapters (defined in `public/configs/campaign.json`), each built around one idea and proven solvable by replaying its recorded solution in the game engine. They teach one mechanic per level, from chips, keys and boots to traps, cloners, creatures, thieves, item barriers, turtles and flame jets, and each chapter ends with a level that combines them. An originality test keeps every map unlike the bundled community levels. The Levels dialog shows the campaign by chapter, each collapsible, with a progress bar and an overview strip that jumps to a chapter, and a chapter's title appears when you start its first level.
  - **Bundled Community Packs**: `Tile World Intro` and `CCLP 1` through `CCLP 5` (see [Credits](#credits)).
  - **Community packs under the original handheld rules**: the bundled community packs (except CCLP 2) and imported `.DAT` files play under the original handheld (Lynx) rules on a dedicated engine. Help, tap-to-path, the objective marker, solution replay, item drop and the dead-end watch are unavailable there. The editor's `Rules` field switches a level between Epoxy and Lynx rules.
  - **Chuck's Challenge 3D levels**: the import button also takes `.xml` level files from Chuck's Challenge 3D. Pick one or several at once and they become one pack, played on their own rules engine (`src/core/cc3d/`), beside the Lynx engine. A file that cannot be read is refused with a message that says why. The levels are not included with Epoxy: they must come from you, and they stay in your browser like other imported packs. They open in the level editor (see [Your packs and the level editor](#your-packs-and-the-level-editor)). Help, tap-to-path, the objective marker, solution replay, item drop and the dead-end watch are unavailable there.
  - **`.DAT` / `.CCL` / `.JSON` Support**: Import and export level packs in the widely used CC1 `.DAT` binary format via drag-and-drop. Packs you own can be imported this way. Files larger than `import.maxFileBytes` (4 MiB) are refused before they are read. On export, a level smaller than the 32x32 format is closed with wall, and a level that does not fit is left out with a message instead of being written wrongly. The level author stored in a pack (field 9) is shown next to the title and kept on export, and the editor has an Author field. A "Delete imported packs" button next to the import button removes every imported pack at once, after a confirmation; built-in packs and your own packs are kept. A pack exported as JSON from "My packs" keeps every engine and can be imported back under its name (see [Your packs and the level editor](#your-packs-and-the-level-editor)).
  - **Sokoban collections (`.xsb` / `.sok`)**: drop a collection on the game and every level plays as Sokoban: it is won as soon as each target holds a block, with no exit to reach. Run-length rows (`4#`) are expanded, the outside of the room becomes wall, and a level the file breaks (no player, no target, fewer boxes than targets, a room open to the edge) is skipped with a count. Packs you own stay in your browser, like imported `.DAT` packs. In the editor, any level can use this rule (`Win Rule` field, `block_target` tile); such a level cannot be exported to `.DAT`. Help plays the next push and the dead-end watch covers these levels, up to `blockPuzzle.watchMaxCells` cells. Sokoban levels are drawn automatically with sprites from Kenney's Sokoban pack (cobble floor, brick walls, target marks, wooden crates) whatever graphics style is selected, while the player keeps the style's own sprite; a button next to the LCD toggle in Options > Advanced turns this skin off (on by default, saved).
  - **Levels of any size**: a `.json` level or custom pack sets its own width and height, from a 10x10 room to a 40x40 or 100x100 level (`grid.minLevelSize` to `grid.maxLevelSize` in `game.json`); the camera and the editor follow the level. The `.DAT` format and the procedural generator keep the classic 32x32 (`grid.mapWidth` / `grid.mapHeight`).
  - **Proven Procedural Generator**: Builds levels from hand-drawn puzzle pieces (`public/configs/motifs.json`), each proven fair and solvable by a solver that runs the real game engine. Every generated level is then replayed start to finish before it is offered, so it is always solvable and no puzzle can be skipped. Difficulty, focus and pacing grow with the level number. From level 3, levels are hubs with locked wings whose keys and boots lie in other wings; hub outlines (`procedural.hub.shapes` in `game.json`) and reward rooms vary, and with the biome set to Auto each level shows the theme of its main mechanic. Levels are laid out compactly, with few dead ends, and no two neighbouring levels of a pack share a main mechanic or hub outline. Each pack comes from a seed: **Endless mode** (or `N`) asks for one (empty means random) and the level to start at, and the seed of the pack being played is shown next to the pack selector with a Copy button.
  - **Endless mode**: aims at community-pack difficulty from its first level. Level 1 is already a timed hub of 7 hard pieces (up to tier 5), growing to 10 pieces and 6 motifs (`procedural.endless` in `game.json`). Only the level being played is built; the next one is prefetched in a Web Worker, and the dialog remembers the seed and the furthest level reached so a run can be resumed. The pack never ends; a run can start at any level up to `endlessUi.maxStartLevel` (10000), and `src/generator/EndlessFingerprint.test.ts` checks that a seed always builds the same levels. Hub wings can be chains of puzzles that return to the hub through a one-way force-floor strip (`hub.returnGate`), which allows irreversible pieces and removes the walk back. Keys are scarce (`hub.scarceGates`): a door colour can guard two wings while only one key is reachable at first, so the order in which wings are opened matters and the wrong door means restarting the level. Monsters appear in most levels (`procedural.endless.motifShares`). The open area of the hub is content, not bare floor: 1 to 3 monsters that move on fixed lines (`hub.openMonsters`), 4 to 9 chips scattered as route waypoints, one more per so many cells of the region (`hub.openChips`) and fire or water patches (`hub.openHazards`), with gravel aprons that keep the monsters out of the wings; the prover walks this region with a timed search. The region scales with the area the puzzles leave free: the hub outline grows by rows and columns of floor before the wings are placed (`hub.outlineGrowth`), so a level with fewer or smaller puzzles has a larger hub; the prover's region search heads for its target best first, so the proof cost follows the way, not the floor; `npm run report:hub` measures where the map area goes. Density rules keep puzzles fair: `minBoxCellsPerMonster` gives each monster room and `maxMonstersPerLevel` caps the level. Puzzles depend on one another (`hub.dependencies`): a piece exports a dirt block pushed out of its exit, which is pushed along a straight lane into the next piece, where it bridges the water that locks it; or a piece exports a key that only a door in another wing takes, so the wings must be visited in the right order. Pairs are declared in the pieces themselves (`exports` and `imports` in `motifs.json`), paired by the hub planner in loop-wing hubs only, and the whole level is replayed with the block pushed and the key carried. The library holds 159 pieces (with a piece-reuse cooldown `avoidPiecesFor` in endless mode), including monster arenas, teleport networks, toggle-wall sequences, clone machines, dirt-barrier puzzles (`dirt` motif), Chip's Challenge 2 mechanics (`ice_block` alchemy, `button_orange` flame-jet airlocks, coloured teleporters, `forbid_*` gates with `thief_keys`, `recessed_wall`, `turtle` bridges, `slime` neutralizers, `button_gray` chip/bomb swaps), and the exporter and consumer pieces of these pairs (for both `dirt_block` and `ice_block`). `npm run report:levels` measures this mode against the community packs, `npm run report:dependencies` measures how many levels hold a dependency pair, and `src/generator/EndlessGuard.test.ts` keeps its width, branching, backtracking, monster presence, share of open floor near content, piece count and generation time above set floors. In block puzzles, the Help button plays the next push, and the game warns as soon as a dead end is proven (search budgets under `blockPuzzle` in `game.json`: a small one for the automatic watch, a larger one for the Help button).
  - **Solution** (`O`): every campaign and generated level stores the solution its proof replayed. The button restarts the level and plays that solution to the exit; watching it records no score.
- **Complete Tile & Monster Engine**:
  - Elemental hazards (`water`, `fire`, `ice` with corner deflectors, `force` conveyors that carry the player, blocks and monsters, `bomb`, `slime` neutralized into floor by any block).
  - Interactive mechanisms (`button_green`, `button_red` clone machines, `button_brown` bear traps, `button_blue` tank reversers, `button_gray` 5x5 chip/bomb swap, `teleport` pads, `thief`).
  - Inventory drop: `E` puts the selected key or boots down on the current cell, `C` selects the next held item, and a click on a HUD slot drops that item. Pickups happen only on entering a cell, so a dropped item stays until you come back for it.
  - Forbidden-item barriers (`forbid_key_red`, `forbid_boots_fire`, ...): the cell refuses you while you carry the item and is floor once you have dropped it elsewhere. A key thief (`thief_keys`) takes every key, as the boot thief takes the boots.
  - Turtles (`turtle`) sink into water once the player or a block has left them, so a turtle bridge is crossed once.
  - All fifteen thin-wall combinations (`thin_wall_ns`, `thin_wall_nesw`, ...), colour teleporters that chain only with their own colour (`teleport_red` to `teleport_green`), flame jets toggled by `button_orange` (`flame_jet_off` / `flame_jet_on`, fire boots protect), and bonus items: score flags (`score_10`, `score_100`, `score_1000` join the level score paid at the exit; `score_2x` doubles that level score, flags included) and stopwatches (`stopwatch_bonus` adds 10 seconds, `stopwatch_penalty` takes 10). The boots that protect you on your current cell cannot be dropped there.
  - 9 creature movement patterns (`bug`, `fireball`, `pink_ball`, `tank`, `glider`, `teeth`, `walker`, `blob`, `paramecium`).
  - Lasers (Epoxy rules only): emitters (`laser_emitter_n` to `laser_emitter_w`) cast a straight beam that kills the player and monsters; pushable mirrors (`mirror_slash`, `mirror_backslash`) turn it 90 degrees and refuse water; receivers (`laser_receiver_red`, `laser_receiver_blue`) hold the laser gates of their colour open while lit (`laser_gate_red_closed` / `_open`, same for blue). A level can be won by lighting every receiver (win rule `receivers`). Every tile declares whether the beam crosses it (`laserTransparent` in `tiles.json`). Lynx levels and DAT export refuse laser content.
- **Visual & Tactile Enhancements**:
  - An optional character skin (Options > Advanced > Character: Standard or Julien) redraws the player in every graphics style; Standard is the default and the choice is saved.
  - HD Neon, 16-Bit Retro and 32-Bit Retro pixel renderers (chosen in Options > Essential, or cycled with `G`) with 4 biome themes (`Cyber Neon`, `Arctic Lab`, `Magma Core`, `Lynx LCD`): walls join into continuous masses that cast soft shadows, light sources glow in HD Neon, 16-Bit Retro draws every tile and character as a 16x16 sprite in a 9-bit console palette (with an optional LCD grid), 32-Bit Retro uses 32x32 shaded sprites in 15-bit colour (lighting and shine are drawn on top), and the player and every monster are animated. A graphics quality setting (Auto by default) keeps the game smooth on slower devices.
  - Five Retro HD styles (Pocket 4-tone, Pastel, Blueprint, Sepia and Classic 90s) draw the same full-resolution scene as HD Neon with a palette of their own, flat colour bands instead of smooth gradients, no glow and a light texture on top (dot grid, grid lines, paper grain, scanlines). Fire, water, ice, traps, monsters, keys and doors keep their own colour family in each of them, so they stay easy to tell apart.
  - **Hint** (`H`): dynamic objective locator and mechanism wire overlay; hovering a colour teleporter shows its own network, and hovering an orange button shows the flame jets it toggles.
  - Colour-blind glyphs on coloured doors, keys, buttons and colour teleporters.
  - Reduced motion: with the system setting on, the hop, bob, glints, flicker, blinking, particles and screen shake rest, and a change of the setting is followed live.
  - Keyboard: `Tab` moves focus between the controls, Ctrl/Cmd chords are left to the browser except undo (Ctrl/Cmd+Z), which follows the keyboard layout (AZERTY, QWERTY, Cyrillic...), and `?` opens the help.
  - Full smartphone touch support (Swipe/Hold virtual joystick, Tap-to-Pathfind, and thumb D-Pad with haptic feedback; the zoom is set in the options). The board always shows the chosen view as a square of N x N tiles, so a wide or landscape screen reveals no more of the level than a square one.
  - Full-featured Level Editor with live solver validation, and your own level packs (see [Your packs and the level editor](#your-packs-and-the-level-editor)).
- **Music**: seven original music tracks by Julien Bombled (see [Credits](#credits)), with three modes, chosen in Options > Advanced (sound on/off stays in Options > Essential). **Default** follows the biome on screen (each biome names its track with `musicTrackId` in `game.json`). **Random** picks a new track for each new level and never repeats the previous one while two or more tracks exist. **Custom** does the same among the tracks you tick (at least one stays ticked). A restart, a retry after dying or a one-level wrap does not change the track, and in Random and Custom the biome (and the `B` key) no longer changes the music. The mode and the ticked tracks are saved.
  - The game ships seven original tracks: `8-bit Odyssey` for Cyber Neon, `Subterranean Pulse I` for Arctic Lab and `Subterranean Pulse III` for Magma Core (`Subterranean Pulse IV` is only in Random and Custom). Retro Lynx LCD plays `Subterranean Pulse II`. These seven tracks are the only music: nothing is synthesized any more.
  - Volume: two sliders in Options > Essential, "Effects volume" and "Music volume", from 0 to 100 % in steps of 5, each shown while its sound is on. 100 % is the loudness set in `audio.json`; the music slider applies to the playing track at once. Both values are saved.
  - In Default mode, the levels of an endless run play `Endless I` or `Endless II` instead of the biome track: a new level never repeats the track of the level before. The list is `endlessUi.musicTrackIds` in `game.json`. Random and Custom are unchanged.
- **Sound effects**: most effects play bundled CC0 audio files (see [Credits](#credits)), with the synthesized sound as fallback until a file is decoded or when it fails. Footsteps depend on the terrain the player steps onto (floor, force floor, ice, and water or fire with the protecting boots), mapped by `terrainStepEffects` in `audio.json`. Under the Lynx rules, only a step the player chooses makes a sound.

## Your packs and the level editor

- **My packs**: the "My packs" button in the header (also in the drawer, the Levels dialog and the editor's "Open...") lists your packs. Create and rename packs, then play, export or delete them. Levels are stored in your browser (IndexedDB).
- **Per level**: reorder, edit, play, duplicate, copy or move to another pack, delete. Badges show each level's engine (Epoxy, Lynx, CC3D, Sokoban). CC3D levels can be managed and edited.
- **Export**: a complete JSON file that keeps every engine, or a `.CCL` file. A JSON file exported this way can be imported back with its name.
- **Delete a pack**: asks for confirmation with the number of levels, and offers "Export first". "Delete imported packs" never touches your own packs.
- **Thumbnails and order**: every level and pack shows a small map. Drag a level by its handle to reorder it (mouse or touch; `Escape` cancels), or use the arrow buttons or the arrow keys on the handle.
- **Author and description**: each pack can carry an author and a description, edited in the pack header and kept in the JSON export.
- **Share a pack as a link**: "Copy share link" puts the whole pack in the link itself, after the `#`, so it is never sent to a server. Whoever opens it sees a preview (name, author, levels, engines, thumbnails) and chooses Import, Import and play or Cancel; nothing is stored before that. A pack already imported from the same link is recognised. Links are limited to `share.maxLinkChars` characters (a few levels); export the JSON file for bigger packs, since long links do not fit every chat app.
- **Imported level ids**: levels of an imported file get ids unique to their pack, so importing the same file twice, or a file named like a built-in pack, no longer mixes their records. Duplicates already stored are renamed once at load; the first copy keeps its records.
- **Your previous Custom levels** were moved automatically into a pack of yours ("My levels"); there is nothing to do.
- **Layout**: palette, canvas and level settings sit in three columns on wide screens, two on medium ones and one on narrow ones, where the palette becomes a horizontal strip. The canvas is scaled to fit the window; zoom with `-`, `+` or the zoom buttons, and `0` or "Fit" to fit again. A zoom keeps the cell under the pointer in place, the keyboard cursor scrolls a large map along, and undo and redo show where the change was and say what it was.
- **Tools**: Brush (`B`), Fill (`F`), Eraser (`E`) and Picker (`I`; Alt+click or middle click also picks). `R` rotates the facing of the selected creature or player start, and `Escape` cancels a wire that waits for its target.
- **Without a mouse**: focus the canvas, move the cursor with the arrow keys and paint with `Space` or `Enter`; a screen reader is told what the cell holds once the cursor stops.
- **Check badge**: shows Valid, the number of warnings or the number of errors for the level. The Issues section of the inspector lists them (errors first, up to 100) and updates as you edit; an issue that names a cell is a button that moves the cursor there and scrolls it into view.
- **Draft recovery**: while a level has unsaved changes, the editor keeps a draft of it in your browser (written a moment after you stop editing, and when the page is hidden). After a crash or a closed tab, the next visit offers to restore it, discard it or decide later; restoring on top of a stored level keeps undo going back to the stored version, and a warning says when the level changed in its pack meanwhile. A draft above `1 000 000` characters is skipped, with a message. Each tab keeps its own draft, so two open tabs never overwrite each other; the drafts of closed tabs are offered one at a time, newest first.
- **Level settings** come in sections: Level, Rules (with the engine), Size (resize a level) and Generate. Under Lynx rules the Epoxy-only items of the palette are disabled (lasers, mirrors and colour channel tiles: plates, hold doors, colour toggle walls and buttons, floating blocks, colour blocks), with a one-click "Switch this level to Epoxy". Undo and redo also cover the settings and the engine, and the unsaved mark clears when you undo back to the saved state.
- **New**: start from an empty room, an empty CC3D room, a Sokoban room or a laser puzzle (templates in `public/configs/templates.json`, Epoxy only; a pack made mostly of Lynx levels offers the empty rooms).
- **CC3D levels** open in the same editor, with their own palette (Floors, Devices, Blockers, Items, Creatures, Player; colour, corner and mirror choosers; the direction control sets facings). The eraser removes the topmost thing of a cell (creature, then item, then top layer) and `Shift`+eraser clears the whole cell. With the thin wall entry selected, a click toggles the side of the cell nearest the pointer (by keyboard, the side of the direction control). Hovering a device, or putting the cursor on it, draws its links (trap control to trap, teleport, clone switch to machine and template, laser controller to shooter, same-colour groups), and the status line says when an edit changes a link. The inspector lists the layers of the cursor cell, each with a remove button; the engine is read-only and the win rule and chips fields give way (chips are the fish on the map). Fill replaces a layer entry across a region, bounded by thin walls; the selection copies, cuts, pastes and moves rectangles (creatures keep their order, and links that change are reported); resize keeps the top-left corner. An Export XML button writes the level in Chuck's Challenge 3D's own XML format, and Import opens such a `.xml` file again; CCL export is refused for CC3D levels. Saving a CC3D level that has errors asks first.
- **Selection** (`S`): drag to select, `Shift`+arrows to extend, `Ctrl` (`Cmd`) + `C` / `X` / `V` to copy, cut and paste (a preview follows the pointer; click or `Enter` places it), `Delete` to clear, `Alt`+arrows or a drag inside the selection to move it. The player start is never duplicated, wires move with the selection when both ends are inside, and paste and move never touch the outer wall ring.
- **Test from here** (`T` or the button next to Test): plays the level with the player starting on the cursor cell; the level you edit is unchanged.
- **Blocks line of Check**: for a pure block puzzle (win rule "cover every target", only floor, walls, targets, chips and blocks, a playable area of at most `blockPuzzle.watchMaxCells` cells), Check also says "solved in N pushes", "no way to cover every target" or "not checked". The search runs in the background and stops when you edit. It never claims that a whole level can be won.
- **Where you are**: the editor shows the pack and the level it edits (Pack, Level n/N) with previous and next buttons.
- **Saving**: Save updates the level in its pack, also with Ctrl+S. A level from a built-in pack, a generated level or a file opened in the editor is saved with "Save into...": choose a pack, or create one in the same step. "Save a copy..." saves another level and keeps the original. The first save into an imported pack asks whether to modify it or save a copy. Saving never changes the pack you are playing.
- **Testing**: "Back to editor" returns from a test play, and the browser asks before the tab closes with unsaved work.
- **Validator**: new warnings for broken trap and clone wires, and for a player start on a wall or on a monster.

## Playtesting

Testers can turn on Playtest mode in Options > Advanced: it records how each level is played, on the device only, and exports one file the tester chooses to send. See the [tester guide](./docs/playtest.md) ([version française](./docs/fr/playtest.md)).

## Development

Requires Node.js 24 (see `.nvmrc`).

```bash
npm install
npm run dev
```

### Adding music tracks

Tracks are declared in `public/configs/audio.json` under `tracks`. A track is streamed from audio files (`"source": "file"`):

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
- A file track that fails to play is skipped until music is turned back on. When no track can play, music stays silent: there is no fallback tune.
- The configuration is checked when the game loads: duplicate ids, a track that is not a file track or has no files, an unknown `musicTrackId` or an unknown `defaultMusicMode` stop the game with a clear message.

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

The Epoxy campaign is written by hand in `public/configs/levels.json`. Each level's solution is described as a route in `tools/campaign-routes.json`: explicit moves (`N`, `E`, `S`, `W`, `.` to wait) for pushes and timing, and `@x,y` steps that walk to a cell along a path found by a search in the real engine. `npm run route:campaign` expands the routes and writes each solution into `levels.json` (`EPOXY_ROUTE_LEVEL=<id>` for one level). `npm test` replays every solution, checks that the exit stays out of reach without each item listed under `requires`, and checks the chapters in `public/configs/campaign.json` (every level in exactly one chapter, titles in both languages) and the pacing in `tools/campaign-rhythm.json`: the level where each tile, item or entity first appears, and timer margins. To compare the campaign with a reference pack you own, run `EPOXY_REFERENCE_DAT=<path> npm run report:originality`; the closest pairs go to `local/originality.md`, which is never committed. `npm test` also keeps every campaign level unlike every other one with a room fingerprint (the open cells, blocks and targets of the room; walls only bound it; any rotation, reflection and translation), threshold `maxRoomSimilarity` in `campaignGuard` of `game.json`. `maxSokobanSimilarity`, in the same section, applies only to the `EPOXY_REFERENCE_XSB` check below. The classic Sokoban collections cannot be bundled; to check the campaign rooms that have targets against a collection you own, set `EPOXY_REFERENCE_XSB=<.xsb/.sok/.txt file or folder>`: the otherwise skipped test in `CampaignRoomOriginality.test.ts` then runs, and `npm run report:originality` writes the closest matches to `local/originality-sokoban.md`, also never committed.

The Epoxy pilot pack is a second built-in pack used to try a rebuilt campaign on fresh players without touching the current campaign or its progress. Its levels are in `public/configs/pilot-levels.json` (ids start with `epoxy_p_`), its chapters in `public/configs/pilot-campaign.json`, its routes in `tools/pilot-routes.json` and its pacing in `tools/pilot-rhythm.json`. It is listed in the pack selector and the Levels dialog only while Playtest mode is on; turning the mode off while playing it returns to the campaign. `npm run route:pilot` expands its routes (the same tool as `route:campaign`, also reachable with `EPOXY_ROUTE_PACK=pilot`), `npm run report:difficulty:pilot` measures it, and `npm test` runs the same design and originality checks on it as on the campaign. A pilot level that deliberately reworks an old one carries `"reworkOf": "<old level id>"`, which exempts exactly that pair from the room comparison with the campaign; remove it once the level has changed enough to pass the comparison without it (the test pins the similarity). The pilot keeps its own resume point, so playing it never moves the campaign one. Chapter 2 (levels 16 to 20) teaches pushing blocks; a pilot level with blocks may declare `"blockBudget": { "waters": n, "targets": m }`, a design note that the level holds exactly n + m blocks (the waters to fill plus the targets to cover, none spare), checked by the tests.

New puzzle pieces go in `public/configs/motifs.json`; run `npm run annotate:pieces` afterwards to precompute each piece's solution and reversibility into `public/configs/motif-annotations.json`, which the generator uses instead of searching in the browser.

Sokoban rooms: `npm run forge:sokoban` builds original ones backwards from their solution (blocks onto brown buttons that hold the exit traps open). `npm run import:sokoban` adapts a collection in the standard `.xsb` format (set `EPOXY_SOKOBAN_FILE` and `EPOXY_SOKOBAN_CREDIT`); only use collections whose licence allows reuse, and keep the credit. The entry and exit tunnels are carved on any side of the room, the exit opening where the player can stand once every box is home, and the import report lists why each rejected level was not kept. Both write candidates to `local/` for curation. `npm test` checks that each one is solvable in every orientation, that no block can escape through its ports, and that nothing in it is decorative; `npm run report:pieces` writes each piece's solution to `local/piece-probe.txt`.

## Tests

```bash
npm test
```

The suite includes `src/test/typographyGuard.test.ts`, which scans every tracked text file for banned typographic characters (dashes, curly quotes, one-character ellipsis, non-breaking spaces, ligatures).

Tests run in Node by default. A test file that needs a DOM starts with `// @vitest-environment happy-dom` (shared helpers in `src/test/domFixture.ts`). Generation time budgets are measured as CPU time, so they hold when the whole suite runs in parallel.

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
