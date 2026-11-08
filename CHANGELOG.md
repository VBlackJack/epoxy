# Changelog

All notable changes to Epoxy are listed here. The format follows Keep a Changelog, and
versions follow Semantic Versioning.

## [Unreleased]

### Fixed

- CC3D conversion coverage is now measured: differential tests play the same scenario on the CC3D engine and on the converted Epoxy level, and promote bomb, plain gravel, trap, trap control, clone machine and switch, and the blue golem control to exact; every other approximate element now names the measured differences. Gravel next to a reflector is its own approximate key.
- CC2 import: railroad track curves were rotated by one bit (every imported curve pointed the wrong way) and are now read in the CC2 order; logic gate modifiers now decode the diode (played as a one-input OR) and the counter-clockwise latch instead of reporting unknown gates. Both CC2 latches now play as a data latch (see the logic gates entry below).
- Validator: far fewer false "exit unreachable" reports. A force floor (plain, turning or random) is a cell the player may step off sideways, as the engine allows, instead of a slide followed to its end; blocks are counted per hazard instead of being spent greedily on the first hazard reached. On the bundled CCLP 1-5 packs the false reports drop from 210 to 41, and no level is newly flagged. Two bundled levels (epoxy_c_3, epoxy_p_20) are now judged valid.
- CC1 `.DAT` import under the Epoxy rules: the unused codes 51-53 now read as walls and 54-56 as invisible walls, as under the Lynx rules, instead of floor (they are never written back). This changes three bundled CCLP2 levels: 71, 98 and 127.
- Share links: a pack holding imported Chip's Challenge 2 levels can no longer be shared by link (the button is disabled with an explanation), and an incoming link carrying such levels is refused; the converted levels stay on this device. The JSON and .ccl downloads are unchanged.
- CC2 import: a no-sign over a key or boots now plays as the matching forbid tile (empty no-signs as plain floor), and the pink button plays as the held pressure plate instead of the pulse button.
- Validator: fewer false "exit unreachable" reports. A green button, a bomb or a block cloner button that a monster or block can reach counts as triggered (toggle walls open, bomb removed, clone granted).
- CC1 `.DAT` import: under the Lynx rules the swimming Chip codes 0x3C-0x3F give the player start (facing kept, terrain below kept) when the level has no other start; the unused codes 0x33-0x3B and 112-255 are reported as import diagnostics; a level with no player start is flagged and fails validation instead of getting a start at the centre.

### Added

- Chip's Challenge 2 mirror players (Epoxy rules, pack format 13): mirror Chip and mirror Melinda copy every move the player of their character attempts (blocked ones included), follow that character's terrain rules, open the doors of their own key colour (green for Chip's, yellow for Melinda's), pick up keys and tools but not chips, push one block, press buttons, die on hazards without ending the level, and kill the player on contact. The CC2 import maps them. Both locales.
- Tools: `npm run import:cc3d` converts a folder of Chuck's Challenge 3D pack folders (XML levels) offline into one native CC3D pack and one Epoxy-rules pack per folder, with a coverage report per pack; level passwords can be carried over from older packs by map id (`CC3D_META_DIR`).
- Chip's Challenge 2 dynamite (Epoxy rules, pack format 13): set it down, then step off, and it lights; 85 ticks later it blasts a 5 x 5 area without its far corners, destroying walls, doors and most terrain (steel walls, sockets and logic gates resist), items and every creature caught in it, turning floor under a creature into fire. A blast does not set off other dynamite. The CC2 import now maps dynamite to it instead of the Epoxy charge, which is unchanged. Both locales.
- Chip's Challenge 2 railroad tracks (Epoxy rules, pack format 13): a track cell (`rail_junction` with a per-level `railTracks` entry) holds up to six segments; an actor enters only through an open side and leaves only along a track that joins its entry side, a refused step is turned (straight, right, left, back), a switch moves to the next track when something leaves along the active one or when it is pulsed, and the railroad sign lets its holder ignore the tracks. Every imported CC2 track uses them; native rails are unchanged. The editor shows and keeps imported tracks but cannot draw new ones. Both locales.
- Chip's Challenge 2 canopy and locked arrow block (Epoxy rules, pack format 13): a canopy (a cell edge flag) stops bugs and rovers from entering and a blob from moving between two canopy cells, and is drawn as a semi-opaque roof over the cell; the locked arrow block has no arrows, so nothing can push it, but it still slides and pushes like the other arrow blocks. The CC2 import maps both. Both locales.
- Chip's Challenge 2 logic (Epoxy rules, pack format 13): NAND gate, data latch (follows its data input while its clock input is on; the toggle latch is unchanged), counter 0-9 (counts up and down on rising edges, pulses on wrap, holds an underflow output), named gate ports (in0/in1, out0/out1) on signal wires, and the lightning bolt (while held, the player powers the wire nets fed by the floor they stand on; CC2 also asks the holder to stand still and powers nets through electrified floor, neither of which is played, so the bolt is marked approximate). The CC2 import maps them. Editor palette, drawings in every style, both locales.
- Chip's Challenge 2 no-signs for every item and on any terrain (Epoxy rules, pack format 13): item-layer signs `no_sign_<item>` (keys, every boot, speed and eye boots, ward, hiking boots, charge, pocket gate, hurl stone, toll token, steel foil, bribe, lightning bolt) bar a player carrying that item while the terrain under the sign keeps working; blocks pass, monsters do not. The CC2 import uses them for a no-sign over any other item or over non-floor terrain (approximate); a no-sign over a bonus or a toggle clock drops it. Drawings in every style, both locales.
- Chip's Challenge 2 monsters (Epoxy rules, pack format 13): the floor mimic (chases slowly, looks like floor), timid teeth (flee Chip, chase Melinda; ordinary teeth now flee Melinda, as in CC2), the ghost (passes walls, doors and thin walls but not steel walls, water, lily pads or clone machines; ice, force floors, bombs and traps do nothing to it) and the rover (imitates eight monsters in turn, switching every 32 decisions). The CC2 import maps them. Editor palette, drawings in every style, both locales.
- Chip's Challenge 2 items (Epoxy rules, pack format 13): steel foil (while held, bumping a wall turns it into a steel wall; the tools thief takes it), toggle clock (stays on the map; stepping on it pauses or resumes the level timer, with a PAUSED indicator in the HUD; blocks and monsters stay off it) and bribe (a thief takes one bribe instead of anything else). The CC2 import maps them. Editor palette, drawings in every style, both locales.
- A sliding block (on ice or a force floor) now pushes the resting block it reaches when it may chain into it, as in CC2, with the same chain rules as a push by the player (an ice block never pushes a dirt block directly); a block that is itself sliding is never pushed, and nothing is ever pushed onto the player.
- Chain pushing (CC2 rule, Epoxy rules, pack format 13): an ice block pushes ice blocks and arrow blocks, an arrow block pushes dirt, ice and arrow blocks, so a line of blocks moves in one push, and a wall, the map edge or a sliding block ahead refuses the whole push (new block field `chainPushes`). Puppets and pull boots never chain, and a block that is itself sliding is never pushed. Old replays (format 1 to 12) that pushed a block into another block could differ; the bundled solutions are unaffected.
- CC2 replay check: a CC2 engine (`CC2_REPLAY_ENGINE=cc2`, or `all` for every engine) built on the Lynx core with CC2 rule modules (steel wall, score items, stopwatches, hiking boots, green chips and bombs, CC2 swivel doors, key thief, ice blocks); it plays the stored replays only and is not offered for play yet. The replay report lists the ids each engine cannot play, per level and in a summary.
- Chip's Challenge 2 items and characters (Epoxy rules, pack format 13): the green chip and green bomb (`green_chip`, `green_bomb`; the green button turns every one into the other, a green chip counts toward the chips required), the steel wall (`steel_wall`, flagged blast-proof for future terrain-breaking blasts), hiking boots, a per-level `character` setting (Chip by default, left out of the file for Chip) that plays the level as Melinda (she does not slide on ice and needs hiking boots on dirt and gravel; the boots do nothing for Chip) and the Chip-only and Melinda-only signs, which stop only the other character and let monsters and blocks through. The validator follows all of them; editor palette entries, a character choice in the level settings and drawings in every style (a bow marks Melinda), both locales.
- Chip's Challenge 2 swivel doors (Epoxy rules, pack format 13, `swivel_door_cc2_*`): the closed sides stop entering only, and leaving through a closed side pushes the door round (clockwise when the next side clockwise is closed too, else counter-clockwise) while leaving through an open side does not turn it; the CC2 import now maps codes 0x48-0x4B to them (the official level "swivels" wins its stored replay), the native swivel doors are unchanged. Editor palette entry and drawings in every style, both locales.
- Wired devices (Epoxy rules, pack format 13): purple wall and floor flip on every change of the signal wired into them (a new `fires: 'flip_edges'` sink, not touched by the green button), toggle switch (flips its state at each arrival) and black button (powered unless pressed) as signal sources, a gray pulse button that pulses every wired device in its 5 x 5 square without wires (flips flip tiles, fires launchers and cloners once, holds hold doors, relay pads and wired traps on for one settle), a wired trap open while its signal is on or a brown button is held, and wired flame jets; each has an editor palette entry, en/fr texts, validator support and a drawing in every style.
- Import Chip's Challenge 2 levels (`.c2m` files and `.c2g` game scripts, or a whole folder): the levels become one pack in the order of the game script, with a coverage badge per level (exact, approximate, not playable), a banner on levels that use mechanics Epoxy does not play yet, and an import summary. The original files are kept on this device only and join an exported pack file only with the opt-in "Include the CC2 source files"; the `import:cc2` tool converts a whole folder offline. Both locales.
- Clockwork Citadel campaign (`epoxy_citadel`, `public/configs/citadel-levels.json` and `public/configs/citadel-campaign.json`): a new built-in campaign pack of 50 multi-chamber puzzle levels (`epoxy_k_1` to `epoxy_k_50`) across 5 chapters of 10 ("Outer Sluices & Counterweights", "Cryo Ducts & Boot Tolls", "Automata Escapements & Rail Foundries", "Prism Optics & Transit Networks", "Ballistic Sanctum & Parity Vaults"), synthesizing all 25 CC1, CC2, and CC3D puzzle archetypes with an isolated save slot, 0 validator issues, and verified stored solutions. Both locales.
- Two new playable characters in the Runeward style, the rune scribe and the adventurer mage, chosen in the Character setting (Runeward only; other styles draw the default). All three show the boots held, a ward ring, skating on ice and a fire, water or fainting death.

### Changed

- A transmogrifier now also switches the player between Chip and Melinda when stepped on (CC2 rule), with Melinda's rules (no sliding on ice, hiking boots on dirt and gravel, gender signs, teeth fleeing her) following the current character; undo restores it. The validator treats a level with a transmogrifier as playable by either character. No bundled level or stored solution changes.
- CC2 import: green chips and bombs, steel walls, hiking boots and the male and female signs now play as their Epoxy elements (exact), a level whose only player is Melinda is imported with the melinda character, green chips count toward the chips required, and a steel wall next to dynamite is approximate instead of lost.
- CC2 import: purple walls and floors, toggle switches, black buttons, gray buttons (as the 5 x 5 area button), and traps and flame jets that a wire reaches now play as their Epoxy wired forms and are linked by signal wires instead of being lost; the wired trap, wired flame jet and gray button are reported as approximate.
- Epoxy rules: an ice block pushed into water now turns the water into ice (as in Chip's Challenge 2) instead of vanishing and leaving the water; an ice block pushed into fire still melts it into water. Lynx and CC3D rules are unchanged, and the validator counts an ice block as a filler for water.
- The Ward now has its own drawing in every style: a small round shield with a glowing rune, instead of a boot with a badge.
- Refined default Runeward mage (four facings, boots, skating pose, deaths by cause); old saved Character settings stay valid.
- Faster endless level generation (corridor search of the loop wings uses typed arrays and groups pieces by entry side); the generated levels are identical for every seed.
- Runeward loose dirt tile now reads as a patch of earth covering the cell with grain, clods and pebbles, instead of a small lump on the paving.

## [2.25.0] - 2026-11-07

### Added

- Sanctuary Puzzle & Mechanism Encyclopedia (`public/configs/excavation-encyclopedia.json`, `src/config/excavationEncyclopedia.ts`, `docs/puzzle-encyclopedia.md` and `docs/fr/puzzle-encyclopedia.md`): 25 machine-verified puzzle archetypes across 9 families (`sluice`, `extraction`, `optics`, `kinetic`, `network`, `automata`, `transit`, `ballistics`, `parity`) with ASCII blueprints, design invariants, dead-end traps, chaining rules and verified shortest solutions, plus 9 sanctuary starter templates in the level editor (`boulder_sluice`, `counterweight_hold`, `grappling_alcove`, `prism_slalom`, `elemental_alchemy`, `rail_switchyard`, `monster_clock`, `turning_force`, `hurl_stone_ricochet` in `public/configs/templates.json`) and 10 Tier-5 sanctuary pieces in the procedural generator (`public/configs/motifs.json`, 169 pieces in total). Both locales.
- Wired flip: a signal wire can end on a green toggle wall or a rail switch; that one cell flips each time the signal starts sending (not when it stops), and the green button still flips it too (Epoxy rules).
- Relay pad (`relay_pad_dark`, `relay_pad_lit`): a pad a signal wire ends on lights while its signal is on and goes dark when it is off, a lit pad is a teleporter of its own group that sends whoever steps on it to the previous lit relay pad in reading order (blocks and monsters too), and a pad no wire ends on keeps the form it was placed in; Epoxy rules, pack format 11 ids.
- Toll Token (`toll_token`): pick it up and a boot thief or a key thief that would take something is paid with one token instead and takes nothing; a thief with nothing to take leaves it alone, and it cannot be set down (Epoxy rules). Pack format 11 now also covers levels whose wires flip a tile, and this build reads format 11.

### Changed

- Phone layout (full screen, touch): a floating joystick appears under the thumb, a status strip tops the board, the level panel (left) and a new game menu (right) are drawers opened from the strip tabs, and Undo plus the drop buttons sit in the corner of the chosen pad side. The fixed pad stays available through the new Touch control setting; vibration can be turned off.
- Relay pads (lit and dark) have their own look in every style, a plug marks a green toggle wall or rail switch that a signal wire ends on, and the 16-Bit Toll Token is now drawn (it was invisible).

## [2.24.0] - 2026-11-07

### Added

- Wisp: a monster that drifts straight through walls, doors, water, fire, ice and force floors, stopped only by thin walls, the map edge and other entities; it turns round once when blocked and cannot be cloned (Epoxy rules). Pack format 10.
- Pocket Gate: carry a teleporter pad and set it down where you want; pads you set down link with each other (Epoxy rules). Pack format 8.
- Hurl Stone: pick it up and throw it at what is in front of you; it kills a monster, sets off a bomb, melts an ice block and is turned by a mirror, then is used up (Epoxy rules). Solution letter T. Pack format 10.
- Rails: straight and bent rail pieces only let you in and out through their open sides; rail switches flip with the green button (Epoxy rules). Pack format 9.
- Level editor: rotate rail pieces while placing them; a note when rail switches have no green button.

### Changed

- Rails have their own look in every style; a rail switch shows its other position faded.
- Playtest: the level rating opens from a button in the level-complete panel instead of by itself.
- Converter: the CC3D random force floor becomes the Turning Force Floor, which plays the same. Converted levels that use it are saved as pack format 7, which builds older than 2.23.0 cannot read.

### Fixed

- CCLP 2 levels: chips and exits stacked over another tile in the original files now play as intended. Chips over walls can be taken and the wall closes behind you (level 17, level 85), and an exit under a chip socket appears when it opens (level 15). A few stacked tiles under water or floor are still dropped.

## [2.23.0] - 2026-11-06

### Added

- Blast Charge: pick it up, drop it where you want, and three seconds later it destroys the monsters and blocks around it (Epoxy rules). Pack format 7.
- Ward: a one-time shield that destroys the first monster you touch (Epoxy rules).
- Lurker: a monster hidden in the floor that wakes when you arrive on or slide through a cell next to it, then after a short pause chases you slowly (Epoxy rules).
- Turning Force Floor: a force floor that pushes east, south, west, then north in turn, one shared turn per level (Epoxy rules).
- Level editor: a signal link can also be started from a shot launcher or a clone machine.

### Fixed

- Level validator: levels whose clone machines or shot launchers are driven by signals no longer get false unreachable chip or exit reports.

### Changed

- Grappling Gloves now look like gloves in every style.
- Narrow landscape screens: the keys and boots slots use two columns in the side panel; in phone full screen they wrap as one strip and shrink on short screens.

## [2.22.0] - 2026-11-06

### Added

- Buried Sanctuaries campaign (`epoxy_excavation`): a new built-in pack of 20 excavation levels in 5 chapters, with its own save slot. Multi-room 15x13 sanctuary maps chain boulder sluices, pressure plates, grappling alcoves and prism optics; every level is proven solvable with 0 validator issues. Both locales.
- Grappling Gloves (`boots_pull`), an Epoxy-only item: stepping away from a resting block pulls it behind you, unless it rests on an active plate, button or block target.
- Diggy's Adventure import: light sensor beacons become laser puzzles and boulder beacons become coloured plate puzzles; browser `.har` captures and `CommandSynchronize` envelopes are unwrapped directly.
- Level editor: signal links can be removed with the Unlink button in the Connections panel.
- Signals: pulse buttons, and signal links that fire launchers and clone machines on a rising edge (pack format version 6).
- Signals: pulse buttons and launcher/clone links can be placed and linked in the level editor, with their own look in every render style.

### Changed

- Phone full screen: the HUD and the Pause, Undo and Menu buttons move beside the d-pad, off the board, with a lighter look.

## [2.21.0] - 2026-11-06

### Added

- Buried Sanctuaries campaign (`epoxy_excavation`, `public/configs/excavation-levels.json` and `excavation-campaign.json`): 12 hand-crafted subterranean puzzle levels across 3 chapters ("Strata & Sluices", "Counterweights & Grappling", "Subterranean Optics") built around earth-vein excavation (`dirt`), boulder trenches (`dirt_block` and `water`), pressure plates and hold doors (`pressure_plate_*` and `hold_door_*`), grappling extraction from wall alcoves (`boots_pull`), and buried laser prism optics (`laser_emitter_*`, `mirror_slash` / `mirror_backslash`, `laser_receiver_*` and `laser_gate_*`), each proven solvable with 0 validator issues, non-bypassable mechanics and a dedicated save slot. Both locales.
- Runeward render styles are complete and no longer a preview: blocks, mirrors, monsters and shots, thin walls, swivel doors, turn plates, lasers, launchers, turrets, boots, bonuses, forbidden-item markers, floor marks and signal devices are drawn in the Runeward and Runeward Parchment styles; only tiles of imported CC3D levels keep the shared drawing. Both locales.

## [2.20.0] - 2026-11-06

### Added

- Level editor: link signal plates, gates, laser receivers and hold doors with K and a tap on each partner, on desktop and touch; cycles are refused. Both locales.
- Grappling gloves (`boots_pull`, Epoxy rules only): a pair of boots that pulls a block at rest behind the player when stepping away from it, unless the block stands on an active pressure plate, brown button or block target; a thief takes them, the block solver knows them, and every style draws them. Lynx levels and DAT export refuse them. Both locales.
- Diggy's Adventure floor importer (`src/formats/DiggyCodec.ts`): the import button and drag-and-drop now accept `floors_*.json` (or `.diggy.json`) files as well as `.har` network captures and `CommandSynchronize` envelopes from Diggy's Adventure, one or several at once, and convert each floor into a playable Epoxy level. Both legacy (`blocked` `"row_col"` and `backgrounds` `"row,col"`) and newer (`blocked_tiles` `"col,row"`) floor layouts are decoded, along with optional runtime `tiles` diggable dirt, teleport beacons (`teleport_red` to `teleport_green` and `teleport`), lever beacons (`key_*` and `door_*`), light sensor beacons (`laser_emitter_*`, `mirror_slash` / `mirror_backslash`, `laser_receiver_*` and `laser_gate_*`), boulder beacons (`dirt_block` pushed or pulled with `boots_pull` onto `pressure_plate_*` opening `hold_door_*`, or into `water`), loot chips (`chip`, `socket` and `exit`), and player spawn and exit markers. Every imported floor is verified end-to-end by a BFS solver in `GameEngine`, and its solution is stored for replay (`O`). Both locales.
- Signal tiles (Epoxy only): a signal plate and AND, OR, NOT, XOR and latch gates that drive coloured hold doors through signal links, with validator checks for signal wiring (one input per door, NOT with one input, no cycles, no inverting loops through a laser receiver). Both locales.
- Signal tiles are drawn in every style with their powered state, and signal links show with the other mechanism links.
- Runeward render styles (preview): two new graphics styles, Runeward, with drawn stone floors and walls, animated water and lava, a glowing exit and a mage player, and Runeward Parchment, the same dungeon drawn as ink on aged paper with hatched shadows and warm torchlight. Tiles they do not draw yet use a recoloured version of the existing drawing. Both locales.
- Runeward render styles: doors, hold doors, toggle walls, plates, buttons, keys and chips are drawn in the Runeward and Runeward Parchment styles, with colour-blind glyphs kept.
- Runeward render styles: traps, teleports, ice and force floors are drawn in the Runeward and Runeward Parchment styles; ice corners and force floors keep their direction readable.
- Phone full screen overlay layout: the board fills the screen, a translucent HUD shows time, chips, level and held items, and a large translucent directional pad floats over the board, on the left or right as chosen in Options (the HUD and pause button move to the other side); the camera keeps the player clear of the pad, safe areas are respected, and panels turn opaque with high contrast or reduced transparency. Both locales.
- Turn plates: two Epoxy-only floor tiles that turn an arrow block a quarter turn, clockwise or counter-clockwise, each time it arrives on them by a push, a slide, a teleport or a clone machine; nothing else turns. The block puzzle check and the dead-end watch follow the turn, the validator notes plates on a level without arrow blocks, the .DAT export refuses levels that hold them, and every style draws them. Both locales.
- Arrow blocks: four Epoxy-only pushable blocks (one way, two ways, corner, three ways) that move under a push only toward a side showing an arrow; slides, teleports and clone machines move them whatever their arrows and never turn them. The editor rotates them with the direction control, the block puzzle check and the dead-end watch know their arrows, and the validator adds a note when every arrow side of a block is walled for good. Both locales.

### Changed

- The play board is now landscape on desktop, in the mobile landscape layout and in the phone full screen overlay (the mobile portrait layout keeps a square board): the zoom option sets the rows shown, a level smaller than the view is zoomed up to 1.5 times without hiding any of it (on a phone it fills the space beside the pad), and the space around a level shows a darkened wall colour of the current style instead of black. Both locales.
- Validator: a level with fewer keys than doors of a colour now gets a warning instead of an error, so winnable levels with spare doors can be saved; a real shortage is still reported as unreachable chips or exit.

### Fixed

- Runeward render styles: sockets, gravel, dirt and hint tiles no longer look like plain floor; sockets get their own seal drawing.
- The CC3D Connections panel no longer calls a device under a door, socket or false wall dead: it says the device works only if the player opens that cell and then steps onto it.

## [2.19.0] - 2026-11-05

### Added

- Level editor touch editing, lot 2: on a touch screen a finger held still for half a second on a paint stroke (brush, eraser, fill) takes that stroke back and picks the cell like the eyedropper, keeping the tool and showing "Nothing to pick here" when the cell holds nothing to pick; the cell under a finger stays described in the coordinates badge and the Connections section after the lift; and the padding around a small map now takes part in two-finger pan and pinch (one finger there paints nothing). Mouse and pen behave as before.
- Level editor touch editing, lot 1: on a touch screen one finger paints, erases or selects as the mouse does, and a second finger turns the touch into a pan (the map follows the midpoint of the two fingers) and a pinch zoom (one zoom step each time the fingers part or close by a quarter, around the midpoint, within the zoom limits). A stroke less than a quarter of a second old when the second finger lands is taken back entirely (the level, the history and the status line are as before); an older one is kept as one step. Once the gesture ends, no remaining finger paints until all are lifted. A floating paste is placed, and a partner in a link session is linked or unlinked, when the finger lifts as a tap, not when it lands: the paste preview follows a dragging finger and a finger that travels in a link session does nothing. A finger resting beside a pen or mouse stroke is ignored. Mouse and pen are unchanged; the canvas no longer opens the system callout or selects text on a long press. No new text.
- Level editor palette keyboard navigation: the palette grid (Epoxy, search results and CC3D) is now a single Tab stop, the entry that last had focus, else the one in hand, else the first; the arrow keys move along the entries in reading order (Right and Down forward, Left and Up back), Home and End jump to the first and last, with no wrap, skipping the Mechanisms sub-headings and the no-match line. Greyed Lynx entries stay reachable, the stop survives redraws, and Up on the first search result returns to the search field. These keys no longer reach the window shortcuts. Both locales for the help line.
- Level editor hover description and wheel zoom: the coordinates badge now names what the cell under the pointer holds ("Tile (3, 4): Door, hides Water", the clone machine's template, the CC3D layers of a CC3D cell) on one line with the full text as its tooltip, and goes back to "--" when the pointer leaves the map; it is not a live region, so a screen reader is not read to on every move. `Ctrl` or `Cmd` + wheel over the map zooms in and out around the pointer (small trackpad deltas add up to one step, a notched wheel makes one step per notch, and nothing is stored past the zoom limits), a plain wheel still scrolls, and the help lists it. Both locales.
- Level editor Connections and "How mechanisms work" on CC3D levels: the Connections section is now shown for CC3D levels and lists, for the cell under the pointer or the cursor, what it controls and what controls it, read from the same derived links the map arrows use (trap control to the next trap and back, teleport to the cell an arrival would use, clone switch to the nearest machine, machine to the template standing on it, laser controller to the nearest shooter, toggle controls and doors and plates and hold doors by colour, golem controls to the golems of their kind), with notes for what a device still needs (no trap, no machine, no template, no shooter, no door or control of its colour, a lone teleport, a trap no control works) and a note for an entry device buried under another layer, which the engine ignores (toggle control, clone switch, laser controller, golem control, teleport). A line says CC3D links come from where things stand; rows have a go-to button but no Unlink, Link... is hidden, and K starts nothing and says CC3D links come from where things stand. The closed card shows one row per CC3D mechanism (trap, teleport, clone, laser, toggle, hold, blue and yellow golem) and the top layer rule instead of the Epoxy rows. Both locales.
- Level editor palette search: a field above the palette (focused by `/` outside text fields) filters the entries of every tab at once by name and description, ignoring case and accents ("piege" finds the French trap; every word must match, name matches first). Results are the ordinary palette buttons, so entries a Lynx level cannot use stay visible and greyed with their reason; the tabs dim while a query is on and clicking one ends the search. `Enter` picks the first usable match and returns to the map, `Down Arrow` goes to the results, `Esc` clears then leaves the field; a screen reader hears how many entries match once typing pauses. CC3D levels search their own palette by name. Both locales, and the help lists the key.
- Level editor issue markers on the map: every cell the last validator report names gets a mark in its top left corner (a filled square with an x for errors, a filled triangle with ! for warnings, a small hollow circle for hints, the worst severity of the cell, the number of issues written beside it on large tiles), on Epoxy, Lynx and CC3D levels alike. On small tiles a coloured cell border replaces the mark (errors and warnings only). A report that lags an edit is drawn dimmed and outlined until the check catches up; nothing is drawn before a report or after another level loads, and a language switch keeps the markers at full strength. The new Markers toolbar button (pressed by default) and the `M` key hide or show them for the session; the cell description spoken at the keyboard cursor adds "1 error, 2 warnings here" for a current report. Both locales, and the help lists the key.
- Level editor test run returns to the editor: when a test run is won or lost the end overlay hides Next and Replay and offers a focused "Back to editor" button (Enter or Escape also return; Retry and Undo stay on a loss), and the editor status line reports "Test: won in N moves" or "Test: lost (reason)". The level in the editor is unchanged. Normal play is unchanged.
- Level editor shortcuts on ?: pressing ? in the editor (outside text fields) or the new Shortcuts toolbar button opens the help with the More section expanded and the editor shortcuts heading focused. Play-mode ? is unchanged. Both locales.
- Level editor mechanism stamps: a Stamps... button next to Fill selection (Epoxy and Lynx levels, hidden on CC3D) opens a short list of ready-made linked pairs, a brown button and a trap, a red button and a clone machine holding a block, and (Epoxy rules only) a shot trigger and a launcher, each laid out as button, one floor cell, device. Choosing one floats it like a paste (preview, outer ring, Lynx rules, one undo step and the link status are the paste's own) without touching the copied clipboard; `Shift`+`R` turns a floating stamp between side by side and stacked, and the launcher faces away from its trigger (place it with floor in front, or the validator warns that it faces a wall) so the shot never crosses the cell the player presses the trigger from.
- Level editor selection carries its internal links: copy and cut take the trap, clone (with their stored template) and shot links whose two ends are inside the selection and off the outer ring, and paste writes them at their new place when both ends land on cells it wrote and still hold the right device, so a cut then paste no longer loses them. Links crossing the selection are never carried (the copy says how many were left out), a link that cannot be pasted is counted, Lynx drops shot links and keeps only the first trap and clone link of a button, and the cut message no longer counts the links the clip carries as dropped. A paste is still one undo step.
- Level editor .CCL export warns when a level holds more trap links (25) or clone links (31) than the .DAT format keeps, with the number left out.
- Level editor "How mechanisms work" card (Epoxy rules): a closed section of the inspector, after Connections, with one row per mechanism (named like the Connections rows) saying how its parts find each other (an explicit link made with K or Link..., the same colour or group, or the whole level) and what happens when a part has no partner, then the keys K, T, L, Shift+R and Shift+F and a line on Lynx levels. Both locales; hidden for CC3D levels.
- Level editor Connections says what a device still needs and K is visible: a pressure plate, hold door, toggle button or wall, lone teleporter, laser receiver or gate, puppet control or puppet, and orange button or flame jet with no partner on the level shows a note saying what it needs (read from the cell's relations and the engine's rules, in both locales); the problems of the last Check that point at the shown cell are listed under the note; the Link button's title reads "Link to a partner (K)" and the ready status names K, T and L; after a brush stroke or key paint that places exactly one unlinked linkable device (brown or red button, trap, clone machine, shot trigger or launcher), the status line says to press K or Link... and what the device does unlinked (Lynx wording under Lynx rules), staying quiet for fills, erases, strokes that change several cells, linked devices and a repeat for the same kind of device.
- Level editor palette descriptions: hovering a palette entry shows "name: description" as its title (and as its accessible description), and choosing it puts the same line on the status line (the Thin Wall entry keeps its own, more specific status). Every Mechanisms entry, every Epoxy-only tile and creature, the swivel doors, the boots, the player start and the thin wall say what they do and what they need (for example, a hold door needs a pressure plate of its colour; a shot trigger needs launchers linked with K or Link...). The texts live in `tiles.<id>.desc.label` and `entities.<id>.desc.label` in both locales, and a contract test requires one for every such entry.
- Level editor Connections section (Epoxy rules): the inspector lists what the device under the pointer after a short pause, or else under the keyboard cursor, controls and what controls it (explicit links, colour channels, level-wide rules), with a note where the engine falls back (an unlinked trap opens with any brown button, an unlinked red button fires every clone machine that holds a creature). A link row has an Unlink button (one undo step) and a button that goes to the other cell; "Link..." on either end of a link starts a link session (see below). The map draws colour-coded arrows for the hovered and cursor cells, and the list holds still while the focus or the pointer is inside it or a stroke runs. The cell description now says a clone machine with no link is fired by any red button without a link instead of 0 buttons.
- Level editor link sessions: "Link..." in the Connections section, on a brown or red button, a trap, a clone machine, a shot trigger or a shot launcher (and the K key on the cell under the cursor), opens a session on that device without touching the tool or the brush. The device is outlined, the partners it can link to are outlined in the mechanism colour and its current links are drawn as arrows; a click (or Space or Enter) on a partner links or unlinks it, on another device of the same kind moves the session there, and on an empty floor cell places a new partner (a trap, a clone machine, a launcher facing the direction control, or a brown button, red button or shot trigger) already linked, each change being one undo step. The Connections section stays on the device and Link... reads Done; Escape, Done, clicking the device, another tool or palette entry, a paste, a resize or a load ends the session, while undo and redo keep it and end it only when the device is gone. Under Lynx rules traps and clone machines can be linked (a button holds one link per mechanism, so a new link replaces the old one) and shot devices are refused. The cell description says how many launchers a trigger fires and how many triggers fire a launcher.
- Level editor beam preview (Epoxy rules): the Beams button or the L key overlays where the laser beams run on the level at tick 0 with the turrets armed (emitter and mirror paths, lit receivers, the later facings of a turning turret dimmed, a marker on each gate about to open); it follows edits after a short pause, announces a summary for screen readers when it changes, and is unavailable on Lynx and CC3D levels. The game's beam drawing is now shared through a public `drawBeamCells`.
- Level editor Mechanisms palette sub-headings: the tab groups its entries under headings (buttons and wiring, teleports, lasers and mirrors, colour channels, blocks and turrets, flames and toggles), derived from the tile and entity config so a new engine id lands in a group by itself.
- Level editor facing and clone templates (Epoxy rules): Shift+R turns the creature or turret under the cursor a quarter turn clockwise as one undo step; a clone machine shows the creature it clones, with its facing, as a corner badge; the cell description speaks a turret's facing and what a clone machine clones; palette icons of creatures and turrets follow the direction control; linking a red button to a clone machine with no creature warns that the default block is used.
- Level editor resize anchor: a 3 x 3 picker in the Size section chooses which part of the level stays fixed when it is resized (cells, links, thin walls, hidden terrain and CC3D creatures move with it), on Epoxy, Lynx and CC3D levels; the default stays top-left.
- Level editor hidden terrain polish: the hint now says a key door or a socket can also hide a socket, dirt, a fake wall, a toggle wall, a hold door or a plate, and a small square (filled closed, outlined open) shows the stored state of a hidden toggle wall or hold door.
- Level editor Hidden terrain list (Epoxy rules): in the Layers section, a list sets or clears the terrain hidden under a door, socket or similar tile at the cursor cell, as one undo step (not available under Lynx).
- Level editor fill selection: Shift+F (or the Fill selection button) fills the selected rectangle with the chosen
  palette entry as one undo step, on Epoxy, Lynx and CC3D levels; choosing a palette entry on the Select tool now
  keeps the selection.
- Level editor thin wall tool (Epoxy rules): the Terrain tab ends with a Thin Wall entry; a click toggles the side
  of the cell nearest the pointer (keyboard: the side of the direction control), with a bar showing the side
  first. A wall shared by two cells is removed from both. The cell description spoken to screen readers lists
  the closed sides.
- Level editor screen reader support: once the keyboard cursor stops (about 300 ms), a polite live region
  speaks the cell: its coordinates, tile, item, creature and facing, player start, or the CC3D stack from the
  bottom up. Pointer hover, selection resizing and paste previews stay silent.
- Level editor issues list: an Issues section in the inspector lists the validator's errors and warnings
  (errors first, up to 100) and follows the Check badge; an issue that names a cell is a button that moves
  the keyboard cursor there, scrolls it into view and focuses the canvas. A held Enter or Space on the
  canvas now paints once instead of repeating.
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
- Colour channels (Epoxy rules only): pressure plates and hold doors in red, green, blue and yellow (`pressure_plate_*`, `hold_door_*`), where a door stays open while every plate of its colour is pressed, by the player, a block at rest, or a colour block of the same colour only; colour blocks (`color_block_*`) that float in water as walkable floating blocks (`floating_block_*`); and red, blue and yellow toggle walls with their own toggle buttons (`toggle_wall_*`, `toggle_button_*`). Play aids are off on levels that use them. Lynx levels and DAT export refuse them.
- Thin walls on any terrain (Epoxy rules only): a level can block cell edges on water, ice, force floors and the rest, not only with the standalone thin wall tiles (level field `cellEdges`). Pack JSON is written as version 2 only when a level uses them. Lynx levels and DAT export refuse them.
- Terrain hidden under removable tops (Epoxy rules only): a level can hide ice, water, a wall or the exit under a key door, a socket, a blue fake wall or dirt, revealed when the top is removed (level field `underlays`). Pack JSON is written as version 3 when a level uses them. Lynx levels and DAT export refuse them.
- Slow-time charm (`slow_time`, Epoxy rules only): carried like boots, it makes every monster take twice as long per step while held; the player, blocks, timer and lasers keep their speed, and a thief takes it. A fifth HUD slot appears only on levels that place it. Lynx levels and DAT export refuse it.
- Turrets (Epoxy rules only): pushable blocks that fire a 3-cell beam killing the first player or monster it reaches (`turret_fixed`, `turret_cw`, `turret_ccw`, `turret_multi`). The rotating ones turn a quarter every 60 ticks, the four-way one fires in all directions, a turret faces the way a player pushes it, and turrets fire only after the player's first step. Lynx levels and DAT export refuse them.
- Swivel doors (`swivel_door_ne`, `swivel_door_se`, `swivel_door_sw`, `swivel_door_nw`, Epoxy rules only): named by their closed sides like the thin walls, an actor (player, monster, pushed block or steered puppet) enters and leaves only through the two open sides, and when it leaves the door turns a quarter turn so the side it came in by is closed. Closed sides stop lasers and turret shots like thin walls. The turn is part of undo. Levels that use them turn off tap-to-path, block hints and the dead-end watch, and the validator counts a swivel as open on every side for reachability. The editor palette lists them under Flames and toggles. Lynx levels and DAT export refuse them.
- Speed boots (`boots_speed`, Epoxy rules only): carried like boots, they halve the player's walking cooldown (4 ticks to 2) while held; ice and force floor timings are unchanged, slow time stays independent, and a thief takes them. Their HUD slot appears only on levels that place them. Lynx levels and DAT export refuse them.
- Truesight boots (`boots_eye`, Epoxy rules only): while held, invisible walls and appearing walls are drawn with the editor's hidden-wall marker in every render style (purely visual: the fake blue wall stays hidden, nothing under removable tops is shown, and no engine rule changes), and a thief takes them. Their HUD slot appears only on levels that place them. Lynx levels and DAT export refuse them.
- Transmogrifier (`transmogrifier`, Epoxy rules only): a terrain tile that swaps a monster arriving on it (step, slide, teleport exit or clone spawn) for its paired kind: bug and paramecium, glider and fireball, teeth and skitter, pink ball and walker. There is no random outcome; tanks, blobs, puppets, the player and blocks are unchanged, a monster already on it at level start is not swapped, and only the kind changes (position, direction and step countdown are kept). It sits under Flames and toggles in the editor palette. Lynx levels and DAT export refuse it.
- Puppets and skitters (Epoxy rules only): a puppet (`puppet`) never moves by itself; when the player's step ends on a puppet control (`puppet_control`, worked only by the player), every puppet tries one step in the player's move direction, front first so a line moves together. A puppet pushes one block, presses plates, kills on contact, and dies in water, fire and slime like other monsters. A skitter (`skitter`) flees the player along the axis where it is farther away (horizontal on a tie), then the other. Tap-to-path, block hints and the dead-end watch are off on levels with puppets. The validator warns about a control without a puppet and a puppet without a control. Lynx levels and DAT export refuse them.
- Shot launchers (Epoxy rules only): `shot_launcher_n`, `shot_launcher_e`, `shot_launcher_s` and `shot_launcher_w` fire one shot each time a linked shot trigger (`shot_trigger`, worked by anything that steps on it) is pressed; a trigger with no link fires nothing. The links are stored in the level field `launcherLinks` (pack JSON is written as version 4 only when a level uses them). A shot flies one cell every 2 ticks, stops where a laser beam stops, kills the player and monsters, sets off a bomb item, melts an ice block, destroys a turret and is deflected by mirrors; undo restores shots in flight. One-sided mirrors (`one_sided_mirror_ne`, `one_sided_mirror_nw`, `one_sided_mirror_se`, `one_sided_mirror_sw`) are pushable: their front faces reflect shots and beams, a shot hitting the back destroys the mirror and the shot, and beams stop at the back. The validator warns about a trigger with no link, a launcher never linked and a launcher facing a wall. Lynx levels and DAT export refuse them.
- CC3D to Epoxy converter: a "Convert to Epoxy" button on CC3D level rows in My packs turns a Chuck's Challenge 3D level into a native Epoxy level. A report dialog says how many elements play exactly as in CC3D, how many are approximated and how many are lost, with each reason in plain words, warns that the rules differ and the converted level may not be solvable, and lists the validator errors of the result. Continue goes through Save into (any editable pack, the remembered destination preselected, or a new pack); the copy is titled "<name> (Epoxy)" and the original is never written; Open in editor is then offered. On the 485 community maps no element is lost.
- Terrain hidden under doors, for the last CC3D maps: `underlays` may now also hold a socket, dirt, a blue fake wall, a toggle wall (green or colour channel), a hold door or a pressure plate, only under a key door or a socket; every underlay accepted before is still accepted and no pack version changes. A key door that reveals a socket with no chips left opens in the same step, otherwise the key is spent and the move is refused. A covered toggle wall follows its channel's presses, a revealed hold door takes the form of a visible hold door of its colour, and a covered plate counts in its colour's total but is never pressed. The hidden terrain picker of the editor offers these kinds.

### Fixed

- Validator reachability: ice slides now open doors and sockets as the engine does, a water reached by a slide needs a block that fills it, an unprotected fire is crossed with an ice block plus a filling block, and a fire melted by an ice block can be swum with flippers, so these levels no longer get a false "exit unreachable".
- Hidden flame jets and laser gates now appear in their current state (following the orange button and their receivers), and a cell reveals its hidden terrain only once.
- The level editor now keeps the links between shot triggers and shot launchers (`launcherLinks`) through opening, editing, copy, move, resize, undo, autosave and saving, drops a link when either end is overwritten or erased, and locks the Lynx option for a level that has some.
- The level editor no longer freezes on large block puzzle levels while checking: the automatic check, the Check button and the check before Test run in a worker, the badge says when a check is running, was skipped as too slow, was interrupted (editor left) or failed, and Test plays without the check if it takes too long.
- The level editor now keeps the template of a clone link in step with the creature standing on its clone machine: painting, filling or turning a creature there updates the stored type and facing (the engine spawns the stored copy, so a rotated turret no longer cloned the old facing), and the status line says so. Stored levels are not rewritten on load.
- The level editor no longer lets a Lynx level be painted with colour channel tiles (pressure plates, hold doors, colour toggle walls and buttons, floating blocks, colour blocks), which the Lynx engine plays wrongly: they are greyed out and skipped on paste like lasers, and a stored Lynx level that holds some is switched to Epoxy on open.
- The level editor no longer deletes the thin walls (`cellEdges`) of an Epoxy level on save, autosave or any edit: they are kept through paint, erase, copy, cut, move, paste and resize, drawn on the map, and a level that has some cannot be switched to Lynx.
- The level editor no longer deletes the terrain hidden under a door, socket or similar tile (`underlays`) of an Epoxy level: it is kept through save, autosave, copy, cut, move, paste and resize, marked on the map, spoken with the cell, and removed with an announcement when the tile on top is changed to one that cannot hide it.
- A recessed wall now rises when you leave its cell, instead of turning into a wall under you as
  soon as you step on it.

### Changed

- A monster standing on a colour pressure plate now presses it, except flying monsters (glider and fireball, new entity field `flying`); an explicit `pressesPlates` still wins, and blocks and brown buttons are unchanged. The validator follows the same rule.
- Validator: a new `info` severity for advice that is neither a warning nor an error (it never affects validity, the Check badge or saving); new Epoxy-only checks for a brown button with no trap, a red button with nothing to clone, a trap no brown button can open, a lone teleporter, a laser gate with no receiver, flame jets with no orange button, and a sealed swivel door; mechanism issues now carry the first offending cell and a count; the door-order search retries other door orders when scarce keys run out, ranks key doors by what they really open, and has a deeper mode (used by the editor's Check and Test); the "exit reachable without the socket" check no longer walks through unprotected water or fire; and the targets block search is bounded, so `targets_unsolvable` is issued only on a proof and the editor no longer freezes on large block-target levels.
- Level editor touch: a second finger landing after the grace period now also takes back the first finger's stroke when that finger never left its first cell (a pinch or pan that started a little slowly), with no history step, no unsaved change and no draft; a stroke whose finger reached another cell is still kept as one step.
- Level editor on a portrait tablet: a view between 680 and 1099 px wide that is at least 1.15 times taller than wide (a tablet held upright, or a narrow tall window) now shows one column instead of two, so the map keeps the full width, and the one-column map area is 60% of the screen height instead of 50% on portrait screens 600 px wide or more; landscape and wide layouts are unchanged.
- Level editor Issues list and the Problems here block of Connections no longer say the severity twice: the message loses its own leading severity word and colon when the row already shows the severity badge (validator messages are unchanged).
- French wording: the coordinates badge of the level editor now puts a space before the colon ("Case (3, 4) : Porte", English unchanged) through a locale template, and the brown button is called "bouton brun" everywhere instead of "bouton marron" in nine messages (checks, hints, level hints), as in the palette.
- Exporting a whole pack as .CCL now warns, in one line with the other lossy-export notices, how many levels lose trap or clone links past the .DAT caps and how many links in total.
- Level editor wording: the editor says "link" everywhere. "{count} wires were removed" is now "links" (French "fils" is now "liens"), "see what it is wired to" and "nothing is wired to this gate yet" read "linked", the laser emitter note reads "Linked to nothing", the palette group "Buttons and wiring" is "Buttons and links", and the swivel door corner names read "Swivel Door (North-East)" and so on, like the other directional names (French "Porte Pivotante (Nord-Est)"). A locale test keeps wire and fil wording out of the editor strings.
- Game wording follows the editor: the objective hint messages and the default hint say "links" (French "liens") instead of "wires" ("câbles"), and a second locale test keeps wire and câble wording out of the HUD and hint strings.
- Level editor: the Check button and the Test pre-check use the deeper door-order search (the automatic check keeps the fast one), so they no longer report false door errors on levels such as converted CC3D maps; the worker request carries the search options, and a default report is not reused for a deep check.
- Level editor: the three Wire entries of the Mechanisms palette (brown button to trap, red button to clone machine, shot trigger to launchers) are gone; link sessions (K or Link...) replace them, and they also link from the trap, the clone machine and the launcher end.
- The Epoxy engine is split from one file into modules under `src/core/epoxy/` (world, player, blocks, monsters, devices, teleports, lasers) behind the same `GameEngine` API, with no behaviour change.
- Developer tools: `engineSimHash` hashes a tick-by-tick play of every shipped Epoxy level and compares it with a golden file named by `EPOXY_SIM_GOLDEN`; `epoxyCoverage` classifies each Chuck's Challenge 3D element as exact, approximate or lost on the Epoxy engine and can write a corpus report (`CC3D_CORPUS_DIR`, `CC3D_COVERAGE_REPORT`). On the 485 community maps, maps with a lost element went from 404 to 93.

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
