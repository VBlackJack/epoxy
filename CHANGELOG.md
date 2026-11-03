# Changelog

All notable changes to Epoxy are listed here. The format follows Keep a Changelog, and
versions follow Semantic Versioning.

## [Unreleased]

### Added

- Level editor on large maps: a zoom keeps the pointed cell (else the cursor cell, else the middle) under
  the same screen spot, arrow keys scroll the map to keep the cursor in view with a cell of margin, and
  undo and redo keep the cursor, scroll to the change when it is out of view and say what they undid or
  redid (cells near a position, level settings, or the new size).
- Level editor draft autosave: unsaved work is kept in the browser while you edit (and when the page is
  hidden), and the next visit after a crash offers to restore it on top of the stored level, restore it as
  a new level, discard it or decide later; each tab keeps its own draft, and a warning says when the
  stored level changed meanwhile.
- Playtest mode (Options > Advanced, off by default): records per level, on the device only, the
  attempts, deaths, restarts, undos, hints, solution views, active time and move traces, asks for a
  short rating after a win or when a level is left unsolved, and exports one JSON file. See
  `docs/playtest.md`.
- The Levels dialog groups the Epoxy campaign by chapter, with each chapter's progress and a row
  of chapter buttons; a short banner names the chapter when you reach its first level.
- CC3D levels can be edited further: fill (layer entries, bounded by thin walls), selection with copy, cut,
  paste and move (creatures keep their order, changed links are reported), resize anchored top-left, and an
  Export XML button that writes Chuck's Challenge 3D's own format (CCL export is refused for them), which
  Import opens again.

### Fixed

- A recessed wall now rises when you leave its cell, instead of turning into a wall under you as
  soon as you step on it.

## [2.18.0] - 2026-11-03

### Added

- Share a pack as a link from "My packs": the pack travels in the link after the `#` (never sent to a
  server). Opening a link shows a preview with Import, Import and play or Cancel, and a pack already
  imported from the same link is recognised. Long packs are better exported as a JSON file.
- Level thumbnails in "My packs", drag to reorder levels (mouse or touch), and an author and a
  description for each pack, kept in the JSON export.
- Editor: a Select tool (S) with copy, cut, paste, clear and move; "Test from here" (T) starts a test
  play on the cursor cell; New offers an empty room, a Sokoban room or a laser puzzle.
- Check tells whether a pure block puzzle can be solved ("solved in N pushes", "no way to cover every
  target" or "not checked"), searching in the background.

### Fixed

- Importing the same file twice, or a file named like a built-in pack, gave levels the same ids, so
  editing one copy could erase the other copy's best record. Imported levels now get ids unique to
  their pack, and duplicates already stored are renamed once at load (the first copy keeps its
  records).
- Imported files and links are checked more strictly, and their level texts are cut to the limits in
  `game.json`; levels already stored are read as before.

## [2.17.0] - 2026-11-03

### Added

- "My packs" (header button, drawer, Levels dialog and the editor's "Open..."): create and rename
  your own level packs, then play, export (complete JSON that keeps every engine, or .CCL) or
  delete them. Deleting asks for confirmation with the level count and offers "Export first". A
  pack exported as JSON can be imported back under its name.
- Per level in a pack: reorder, edit, play, duplicate, copy or move to another pack, and delete.
  Badges show the engine (Epoxy, Lynx, CC3D, Sokoban); CC3D levels can be managed but not edited.
- The editor shows the pack and level it edits (Pack, Level n/N) with previous and next buttons.
  "Save into..." stores a level from a built-in pack, a generated level or an opened file in a pack
  of your choice, or in a new one created in the same step; "Save a copy..." keeps the original.
  Ctrl+S saves, "Back to editor" returns from a test play, and the browser asks before the tab
  closes with unsaved work.
- The level checker warns about broken trap and clone wires, and about a player start on a wall or
  on a monster.
- The level editor is reworked: palette, canvas and level settings side by side on wide screens
  (two columns, then one with a horizontal palette strip on narrow ones). The canvas fits the window,
  with zoom out, in and fit (`-`, `+`, `0`).
- Editor tools: Brush (B), Fill (F), Eraser (E) and Picker (I); R rotates the facing, Escape cancels
  a wire, and the arrow keys with Space or Enter edit without a mouse.
- A Check badge shows whether the level is valid or has warnings or errors. Level settings are in
  sections: Level, Rules (with the engine), Size to resize a level, and Generate.
- Under Lynx rules the Epoxy-only palette items are disabled, with a one-click "Switch this level to
  Epoxy".

### Changed

- Undo and redo in the editor also cover the level settings and the engine, and the unsaved mark
  clears when you undo back to the saved state.
- Your previous "Custom" levels are moved automatically into a pack of yours ("My levels"). Nothing
  to do; they stay in your browser.
- Saving in the editor updates the level in its pack, and never changes the pack you are playing.
  The first save into an imported pack asks whether to modify it or save a copy.
- "Delete imported packs" never deletes your own packs.

## [2.16.4] - 2026-11-02

### Added

- A "Delete imported packs" button removes every imported pack and its levels in one go, after a
  confirmation. Built-in packs, the Epoxy campaign and your own levels are kept.

## [2.16.3] - 2026-11-02

### Changed

- Chuck's Challenge 3D levels follow more of the original rules: nothing moves before the player's
  first step; Snappy chases and Nibble flees; security bots run on their own; clone machines and
  their switches work; shots no longer relay through shooters and a shot on a reflector's back
  destroys both; monsters stay off items, security gates and the exit; blocks slide on ice and
  ride force floors, and an ice block pushes a whole row.

## [2.16.2] - 2026-11-02

### Fixed

- Chuck's Challenge 3D levels: a trap control now works the next trap after it in reading order,
  and a trap that no control works stays closed.

## [2.16.1] - 2026-11-02

### Fixed

- Chuck's Challenge 3D levels: a teleport now sends the mob to the previous teleport of its colour
  in reading order, and a yellow golem steered into water is lost instead of refusing the move.

## [2.16.0] - 2026-11-02

### Added

- Import of Chuck's Challenge 3D levels. The import button accepts `.xml` level files; several
  files selected together become one pack. A file that cannot be imported is refused with a
  message that names the problem (malformed XML, unknown tile type, a tile off the grid, a
  missing or repeated player). The levels are never bundled with Epoxy.
- A dedicated rules engine for these levels (`src/core/cc3d/`), separate from the Lynx engine:
  blocks that float or freeze water, pressure plates and the doors they hold, four colour toggle
  channels, traps, cloners, and monsters including fleeing, chasing and steered ones, plus Omni
  and the speed orb. Laser shooters fire a shot that reflectors turn and that relays from shooter
  to shooter; security bots project a short lethal beam, some of them turning. These lasers are
  separate from Epoxy's own. The Epoxy play aids stay off on these levels.
- A guard test that fails on any change to the Lynx engine sources, so work on the new engine
  cannot alter Chip's Challenge play.

## [2.15.0] - 2026-11-02

### Added

- Lasers on the Epoxy rules. Emitters cast a straight beam that kills the player and monsters.
  Pushable mirrors (`/` and `\`) turn it 90 degrees; they refuse water, survive fire and are
  destroyed by bombs. Receivers hold the laser gates of their colour (red, blue) open while lit;
  a gate follows its receivers one step later and never closes on someone standing in it.
- A `receivers` win rule: the level ends once every receiver is lit with its mirrors at rest. The
  HUD counts lit receivers.
- Editor checks for laser levels: an emitter and a receiver are required on a receivers level, and
  a warning flags a gate standing on a beam and an exit on a receivers level.

### Changed

- The block hint and the dead-end watch are off on laser levels, the objective marker is off on
  receivers levels, and tap-to-path never walks into a beam.
- Lynx levels refuse laser content, the editor keeps laser levels on the Epoxy rules, and DAT
  export refuses them.

## [2.14.0] - 2026-11-02

### Added

- Slime and the gray button. Slime kills the player and monsters that step on it; a block pushed
  onto it is lost and turns it into floor. The gray button swaps chips and bombs in the 5x5 square
  around it (`GRAY_BUTTON_RADIUS`); the number of chips the exit asks for does not change. Both are
  drawn in every graphics style, and the editor's check treats slime like water: a block must fill
  it first.
- The generator holds 159 proven pieces instead of 85: a new `dirt` motif, CCLP-inspired
  pieces for traps, ice, bombs, force floors, cloners, monsters and thieves, 18 Sokoban and block
  counterweight pieces, and 17 tier 5 pieces built on ice blocks, flame jets, coloured teleporters,
  recessed walls, turtles, clone machines, slime and the gray button (the key thief piece stays out
  of endless hubs). Ice blocks can
  now be handed from one piece to the next, like dirt blocks.
- Neighbouring endless levels rotate through each motif's pieces instead of drawing the same rooms
  again: the first `procedural.endless.cooldownAttemptsPerTier` attempts (1) of each tier keep clear
  of the pieces its neighbours use, and later attempts draw from the whole pool.

### Changed

- Endless mode starts at tier 5 with 7 pieces per level (was tier 4 and 6): it is meant for players
  who finished the campaigns. Pieces with a solution shorter than 6 moves are avoided.
- Endless hubs spread their wings over the four sides, keep their bays close to the hub, and fill
  the open area with more chips, hazards and dividers. Wing rewards are never dropped for bonus
  chips.
- Endless levels and the passwords of every generated pack change for a given seed. Passwords no
  longer repeat systematically between seeds (seed 1 level 2 used to share the password of seed 2
  level 1).
- Previous level (button and key) does nothing on the first level of an endless run instead of
  restarting it, and its button is disabled there and in a pack of one level.

### Fixed

- A key thief inside an endless hub could take a key that another puzzle needed. Key thieves are now
  kept out of endless hubs, and a plan that no order of wings can win is dropped before it is laid
  out.
- Leaving an endless run while its first level was being built no longer shows a generation error.

## [2.13.0] - 2026-11-02

### Changed

- Only the seven original tracks by Julien Bombled remain. The three synthesized tracks (Cyber Pulse,
  Arctic Synth, Magma Drive) and the synthesized music engine are removed, so the Custom list and the
  Random mode offer the same tracks. Retro Lynx LCD now plays Subterranean Pulse II. When no track
  can play (decoding failure, every track excluded), the music stays silent instead of falling back
  to a synthesized tune; a track that failed gets another chance when music is turned back on.
  `defaultTrackId`, the `music` block and the synth keys of `musicMix` are gone from `audio.json`;
  every track must now be a file track with files. Sound effects keep their synthesized fallback.

### Added

- Two volume sliders in Options > Essential, "Effects volume" and "Music volume", from 0 to 100 % in
  steps of 5. Each shows while its sound is on. 100 % is the loudness of `audio.json`, so the default
  changes nothing. The music slider applies at once, also during the fade-in. Both values are saved
  with the other settings.

## [2.12.0] - 2026-11-02

### Changed

- The five derived graphics styles (Pocket 4-tone, Pastel, Blueprint, Sepia, Classic 90s) are now
  "Retro HD": they draw the same full-resolution scene as HD Neon instead of recolouring the 16-bit
  and 32-bit sprites, so fire, water, ice, traps, monsters, keys and doors stay easy to tell apart.
  Each style recolours the palette and the themes by colour family (`renderStylePalettes` holds one
  ramp per family, `renderStyleFamilies` the colours whose family is set by hand), cuts gradients into
  flat bands, drops the glow and lays a light texture over the board (dot grid, grid lines, paper
  grain and vignette, scanlines; skipped at the lowest quality). Pocket no longer offers the LCD
  toggle, its dot grid is part of the style. Style names and saved settings are unchanged; 16-Bit
  Retro, 32-Bit Retro and HD Neon are untouched.

## [2.11.0] - 2026-11-02

### Added

- Five graphics styles, cycled with `G` like the others: Pocket 4-tone (a four-green handheld
  look), Pastel (soft, lightened colours), Blueprint (blue and white), Sepia (old photo) and
  Classic 90s (flat tiles in a 16-colour early-90s PC palette). They recolour the 16-Bit or 32-Bit
  sprites with a fixed palette (`renderStylePalettes` in `game.json`); keys, doors, Sokoban targets
  and blocks keep distinct colours in every style. All the art is Epoxy's own.
- Character option in Options > Advanced: Standard or Julien (short dark hair, salt-and-pepper
  beard, thin glasses, navy t-shirt), drawn in every graphics style. Saved per player.

### Changed

- Options drawer split into Essential (graphics style, zoom, sound effects, music, language) and a
  folded Advanced section (graphics quality, biome, LCD screen, Sokoban skin, music mode,
  character) whose open state is remembered.
- Phones: the menu button opens the options drawer directly, with the navigation first (pack,
  play or editor, levels, endless mode, import, help, seed). The same navigation shows in desktop
  fullscreen.
- Desktop header in two rows; "Levels & Scores" is now "Levels".
- Level picker: the score column is gone, the time column hides when no level is timed, and pack
  export and delete move to the footer.
- Help dialog: the essentials first, the full shortcut list and rules folded below.
- Each action has one name everywhere (HUD, touch pad, overlay card, onboarding, help), in both
  languages. Keyboard shortcuts left the button labels and live in tooltips and in the help.
- Sound toggles say on or off in text; the music mode row hides while music is off. The disabled
  LCD toggle shows its reason under the button.
- The password badge looks like the button it is.
- The Sokoban Skin option is now shown only while a Sokoban level is played (or tested from the
  editor) and hidden on other levels; its saved setting is kept. Its hint now says what it does.

### Fixed

- Keyboard focus in dialogs reaches a folded section's title and skips the content of a closed
  one, so Tab no longer gets stuck.
- In mobile portrait the HUD Solution button is hidden, since the touch pad already has one.

## [2.10.0] - 2026-11-01

### Added

- Lynx rules engine: the bundled Tile World Intro and CCLP 1, 3, 4 and 5 packs and imported .DAT
  files now play under the original handheld Lynx rules, on a dedicated engine (20 ticks to the
  second, the original move order, blocks, doors, keys, boots, water, fire, bombs, buttons, traps,
  clone machines, teleports, ice, force floors, special walls, the thief and every monster; a block
  standing on a hidden or blue wall is pushed off it, then the wall appears and Chip stays). Levels
  now record their ruleset. CCLP 2, a set designed for the Microsoft rules, stays on the Epoxy
  rules. One buffered input direction is kept for touch play, which the original game does not do.
  Help, tap-to-path, the objective marker, solution replay, item drop and the dead-end watch are off
  on Lynx levels.
- Lynx DAT decoding: imported community .DAT files are decoded with the Lynx rules: directional
  blocks are cloners only on a clone machine, the plain block faces north, the lower layer only
  gives the floor (terrain or item) under a creature, the monster list is ignored and unused codes
  become wall, invisible wall or water.
- Rules field in the editor, next to the Win Rule: it switches a level between the Epoxy and Lynx
  rules, so an Epoxy level exported to .DAT and imported again can be set back to Epoxy. A level
  won by covering block targets is Epoxy only.
- Seven original music tracks (`public/audio/music/`): `8-bit Odyssey` for Cyber Neon,
  `Subterranean Pulse I` for Arctic Lab and `III` for Magma Core in the Default music mode,
  `Endless I` and `II` for endless runs (a new level never repeats the previous track, list in
  `endlessUi.musicTrackIds`, checked at load), and all of them in Random and Custom. Music: Julien
  Bombled.
- Music modes in Options > Audio: Default (the track follows the biome, as before), Random (a new
  track for each new level, never the same twice in a row) and Custom (the same among the tracks
  you tick, at least one stays ticked). Restarting a level, retrying after a death or wrapping a
  one-level pack keeps the track. In Random and Custom the biome and the `B` key no longer change
  the music. The mode and the ticked tracks are saved.
- Terrain footsteps: the step sound depends on the terrain the player steps onto (normal floor,
  force floor, ice, and water or fire when wearing the protecting boots). `audio.json` maps a tile
  `slideType` or `hazard` to an effect through `terrainStepEffects`; the step files are now Ogg
  Vorbis (Kenney Impact Sounds, CC0). It covers both engines; under the Lynx rules, only a step the
  player chooses makes a sound; a slide or a force floor carry stays silent.
- Sound effects from audio files: an effect in `audio.json` can list `files` (in `sfxBaseUrl`,
  `./audio/sfx` by default) played in turn, with an optional `gain`, `maxDurationMs` and a linear
  `fadeOutMs` ending at the cap. Files are fetched and decoded once the audio context exists; the
  synthesized `waveform` and `notes` stay as the fallback until a file is decoded or when it fails.
  17 of the 19 effects now use bundled CC0 files (Juhani Junkala, via SubspaceAudio on
  OpenGameArt, and Kenney Impact Sounds for the footsteps); `splash` and `burn` stay synthesized. Credits added to both READMEs. An effect can
  set `minIntervalMs` to skip repeats that come too soon after its last start; `blocked` uses 250 so
  holding a key against a wall no longer machine-guns.
- Sokoban skin: levels using the `targets` win rule (`.xsb` / `.sok` imports and editor levels) are
  drawn with sprites from Kenney's Sokoban pack (CC0) whatever graphics style is selected: cobble
  floor, brick walls, target marks, a light crate and a darker one on a target. The player keeps the
  style's sprite. A display toggle next to the LCD toggle turns it off (on by default, saved). The
  mapping lives in `graphics.sokobanSkin` of `game.json`; in the 16-Bit and 32-Bit styles, Sokoban
  levels are drawn at full resolution so the sprites stay sharp.
- Level author: the optional author field (9) of a `.DAT` pack is read, shown next to the level
  title in the HUD, kept on export, and editable in the editor (Author field).
- Audio-file music tracks: `audio.json` can declare a track with `source: "file"`, a list of
  `files` (the first one the browser can play is used) and a `gain`, loaded from `musicBaseUrl`. The
  file is streamed, never decoded in memory, created only when the track plays, faded in, and paused
  while the tab is hidden. A track that cannot play is skipped for the session and the synthesized
  default track takes over. `audio.json` is validated at load (unique ids, a synthesized
  `defaultTrackId`, files for file tracks, biome and mode references).

### Changed

- The biome-to-track mapping moved from the source code to `game.json` (`musicTrackId` on each
  theme).
- The help text of the `B` key says that it cycles the biome, and its music only in Default mode.
- .DAT export now always writes the clone machine under a cloner block, and writes Chip with the
  standard codes, so other programs and the Lynx import read exported files correctly.
- High scores and replays recorded earlier on the packs now marked Lynx may not replay.

## [2.9.0] - 2026-11-01

### Added

- 32-Bit Retro render style: 32x32 sprites derived from the 16-Bit sheet with pre-rendered relief
  shading, smooth 8-tone gradients and light ordered dithering. The sprites use 15-bit colour;
  the lighting and the shine are drawn on top of them. Light sources (the existing ones) add
  light to the scene, and items and blocks get a slow shine, which is off on Low quality and with
  reduced motion.

### Changed

- The board always shows the chosen View as a square N x N, whatever the screen shape, so wide
  screens no longer reveal more of the level.
- The HUD fits landscape phones without scrolling: keys and boots sit side by side, the action
  buttons use three columns and the HUD column is wider.
- The render style is now chosen from a select in Options > Display, and the `G` key cycles HD Neon,
  16-Bit Retro and 32-Bit Retro. The choice is saved. The LCD grid toggle only applies to 16-Bit
  Retro.
- Internal: render styles are declared in a render style registry, and a pixel snapshot test
  guards the 16-Bit Retro output.
- The options drawer is grouped into Display, Audio, Language and Navigation sections. Navigation
  (levels, endless run, import, help) only appears in fullscreen, where the top bar is hidden. The
  LCD grid button is disabled in HD Neon style, where the grid is not drawn.
- The options button of the HUD is also shown in fullscreen, on every screen size.
- The viewport zoom can only be changed in the options (Options > Display > View). The mouse wheel, the `V` key,
  the two-finger pinch and the mobile zoom button were removed, because zooming during play removed
  difficulty.
- The header subtitle no longer names the Atari Lynx II, and the level code placeholder example is
  now ABCD. The HUD code badge now has an accessible name ("Enter a level code").
- 16-Bit Retro is redrawn in the style of 16-bit home consoles: every tile, item, monster and the
  player is a 16x16 pixel sprite with hard dark outlines, two to four tones lit from the top-left
  and dithered shadows. The scene is drawn at 16 pixels per tile and enlarged in one step without
  smoothing, so the whole board shares one pixel grid; the optional LCD grid now follows that
  grid. Colours use the 9-bit console palette (8 levels per channel, at most 15 colours per
  sprite), and each of the four themes now tints the retro floors and walls. Sprites live in
  `src/render/retro/sprites/`, palettes in `retroPalettes` of `game.json`; both are checked by
  tests. With reduced motion, retro animations show a still frame.
- HUD and editor icons follow the theme in 16-Bit Retro. HD Neon is unchanged, which a draw-call
  snapshot test now guards.

### Removed

- The decorative handheld shell (side grips, power LED, A/B and option buttons, bezel title), its
  toggle, its `L` shortcut and its saved setting. The board and HUD layout is the one that was
  shown with the shell off. Older saved settings still load.
- The tactical radar (minimap) of the HUD.
- The duplicate "Enter Password" buttons of the HUD and the options drawer: the code badge of the
  HUD opens the same dialog.

### Fixed

- 16-Bit Retro no longer accumulates invisible particles and shockwaves that all played at once
  after switching back to HD Neon.
- A pushable block now hides what lies under it, in both render styles: the terrain under it is
  drawn as plain floor, so fire or water no longer shows as a rim around the block, and tiles,
  items and lights under it no longer glow through. Hovering the block names only the block, and
  mechanism wires to a cell under a block are hidden until the block moves.
- The suction boots (force floor boots) are drawn in green on the board, in the HUD inventory and
  in the editor palette, in every render style. They were yellow, too close to the orange fire boots.
- With suction boots, walking on a force floor, against it included, is no faster than walking on
  plain floor: the short move cooldown that lets a force floor carry the player now applies only
  when the floor actually pushes.

## [2.8.0] - 2026-10-31

### Added

- Native Sokoban levels: a level with `winRule: "targets"` is won as soon as every `block_target`
  tile holds a block at rest, with no exit. The validator checks targets and blocks instead of the
  exit, the block puzzle Help and dead-end watch aim at the targets, and the Help objective points
  at a free target. The editor has the tile and a win condition field.
- `.xsb` and `.sok` Sokoban collections import by drag and drop or from the import button, as
  native levels kept in the browser like imported `.DAT` packs. Run-length rows are expanded, the
  outside of the room becomes wall, and broken levels are skipped with a count.
- `blockPuzzle.watchMaxCells` in `game.json`: the automatic dead-end watch is skipped on larger
  levels so a big Sokoban level never freezes the page.
- A "How to play" dialog opens once on the first launch (moves, undo, restart, help), and again
  from the help dialog. A help button sits in the top bar, and on a computer the keys are recalled
  under the board.
- Levels won by targets show a TARGETS counter instead of chips, and say their goal when they start.

### Changed

- The board fits the window height, so the hint banner and the lower rows stay visible on a
  1024x768 screen.
- Player-facing wording: the dead-end message speaks of targets on target levels, the end of a pack
  names the pack, a lost level is titled as such, untimed levels show no time bonus or best time,
  the import button reads "Import a pack..." and explains the accepted files, imported packs keep
  their file name, and community packs have plainer names.
- Controls that cannot work are hidden or disabled with a reason: the solution button on a level
  without a solution, level codes in packs that have none, and pack export when no level can be
  exported.
- Confirmations (show solution, delete a pack, reload the editor) use the game's own dialog instead
  of the browser's.
- `.DAT` export refuses a level won by targets, with a message, instead of writing its targets as
  floor.
- The `.xsb` importer (`npm run import:sokoban`) carves its entry and exit tunnels through the
  rock on any side of the room instead of a shaft from the top and a trap column at the bottom.
  The traps run along the exit tunnel, so a room no longer loses one row of height per box, and a
  layout that only fits the other way round is transposed.
- The entry opens into the area the level starts the player in, and the exit into a pocket where
  the player can stand once every box is home, found by a Sokoban search: a last push that leaves
  the player in a corner no longer loses the level. Tunnels a box could be pushed out through are
  tried last.
- `local/sokoban-import.txt` now counts the rejections by reason and names the reason of each
  rejected level.

## [2.7.0] - 2026-10-31

### Changed

- The Epoxy campaign is rewritten by hand: 30 levels in five chapters of six (Foundations,
  Mechanisms, Creatures, Contraband, Core), each level built around one idea, taught first and
  turned later. It covers chips and sockets, keys, blocks and water, boots, ice, force floors,
  toggle walls, traps, bombs, colour teleporters, thin walls and dirt, bugs, balls, tanks, chasing
  teeth, hidden walls, cloners, boot and key thieves, item barriers, turtles, flame jets,
  stopwatches and a key economy. Levels 1 to 12 are untimed; from level 13 the limit is about
  eight times the proven solution, except two race levels (18 and 27).
- Campaign levels have new ids (`epoxy_c_<n>`), so campaign records and medals start over. Old
  records stay stored under the old ids and are never replayed on the new maps.
- An untimed level no longer shows a medal: without a time limit every finish was gold. The record
  itself is kept.
- Maps smaller than the view are drawn centred instead of in the top-left corner.

### Added

- `npm run route:campaign` expands each level's route in `tools/campaign-routes.json` (explicit
  moves and `@x,y` steps found by a search in the real engine) into the solution kept in
  `levels.json`.
- Design tests for the campaign: every required item is needed to reach the exit, every tile,
  item and entity first appears where `tools/campaign-rhythm.json` says, timer margins, hint
  tiles, texts in both languages, chapters.
- An originality test: no campaign map may resemble a level of the bundled community packs,
  compared by fingerprints of small windows under rotation and mirroring (`campaignGuard` in
  `game.json`). `npm run report:originality` runs the same comparison against any `.DAT` file
  named by `EPOXY_REFERENCE_DAT` and writes the closest pairs to `local/`, outside the repository.
- Tests that campaign ids, numbers and passwords are unique, and that level sizes stay within
  `grid.minLevelSize` and `grid.maxLevelSize`.

### Fixed

- Four campaign passwords were shared by two levels each, so five levels could not be reached by
  password.

### Removed

- `tools/campaign-script.json` and `npm run build:campaign`: the campaign is no longer generated.

## [2.6.0] - 2026-10-30

### Added

- Colour teleporters show the same colour-blind glyph as doors and keys, in both renderers.
- Imported files larger than `import.maxFileBytes` (4 MiB) are refused with a message instead of
  being read.
- The endless start level is capped by `endlessUi.maxStartLevel` (10000); the dialog proposes
  and accepts nothing above it and names the limit.
- When every regular candidate fails to build an endless level, up to
  `procedural.scoring.fallbackCandidates` (2) extra candidates are tried. Levels that build today
  are unchanged, and so are their ids.
- Block puzzle search budgets live under `blockPuzzle` in `game.json`: a small one for the
  automatic dead-end watch, a larger one for the hint the player asks for.
- A typography test scans every tracked text file for banned typographic characters.

### Changed

- The "next held item" key is `C` only. `Tab` is left to the browser, so keyboard players can
  reach the HUD buttons and the options again.
- Ctrl, Alt and Cmd chords (Ctrl+R, Ctrl+P, Alt+Left...) are no longer captured by the game.
  Undo with Ctrl or Cmd+Z now follows the keyboard layout instead of the physical key.
- The game no longer advances while a dialog or the options drawer is open.
- With reduced motion, the light flicker, the minimap objective blink, particle bursts and
  shockwaves are off, and a change of the system setting is followed live.
- Starting an endless run at a high level is fast: replaying the variety draws for level 10000
  takes about 0.1 s instead of about 5 s, with identical levels for every seed.
- The unused `slidesOnFloor` monster setting is removed; `destroyedByBomb` is now honoured.
- The deploy workflow runs the type check before the tests.

### Fixed

- A monster arriving from a teleporter kills the player on the exit, and drowns, burns, explodes
  or presses buttons like a normal step; a teleported block sinks, melts or detonates the same
  way and uses the block entry rule.
- Teleporter exits respect thin walls and ice-corner entry rules, for the player, monsters and
  blocks.
- Monsters created by a cloner react to the cell they appear on.
- Force floors carry monsters; a random force floor draws from the level's random generator.
- Click-to-move no longer routes through a closed trap.
- The level validator no longer reports a false unreachable exit when a key thief sits near the
  start.
- The block puzzle hint and dead-end watch respect thin walls and use less memory.
- DAT packs that reuse a level number no longer produce duplicate level ids (which reset the
  score on the next level). Ids of uniquely numbered levels are unchanged.
- .CCL export keeps a block cloner's direction, closes levels smaller than 32x32 with wall and
  says so, refuses levels that do not fit instead of exporting them wrongly, reports what a
  stacked cell cannot store, and downloads nothing when no level could be written.
- An imported or stored level with a non-text title or hint no longer stops the game from
  starting; the bad field is dropped and the level kept. A fractional saved level index or an
  unknown saved graphics style is ignored.
- Imported levels with missing or repeated ids get unique ids.
- When browser storage is full or blocked, saving a level or importing a pack says it only lasts
  for this session, and the editor keeps the level marked unsaved.
- One corrupt high score record no longer wipes every high score. New records no longer store
  the unused untimed replay copy.
- The player no longer keeps walking after the window loses focus.
- A mouse click on a play-area or header button, or on the pack menu, hands the keys back to the
  game; keyboard focus is kept.
- Undo and the editor's redo work on non-Latin layouts such as Cyrillic and Greek, and on AZERTY
  `?` opens the help instead of toggling the sound.
- A gamepad button held while a dialog closes no longer counts as a fresh press.
- The editor accepts 0 as an untimed level, and an empty or invalid time or chip field keeps its
  value.
- The LCD, shell, sound and music toggles and the Play/Editor buttons expose their state to
  screen readers.
- Clicking a cell on a map smaller than the view picks the cell under the cursor.
- Hovering a colour teleporter highlights only its own network; hovering a flame button shows
  the flame jets it controls.
- Moving the window to a screen with another pixel density resizes the canvas.
- Audio resumes after an iOS interruption and unlocks on touchend and click.
- Starting a new endless run abandons the generation still pending from the previous run.
- A generator worker that dies after working is restarted once; a second crash reports an error
  instead of rerunning the request on the page.

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
