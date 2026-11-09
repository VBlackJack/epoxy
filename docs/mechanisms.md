*Version française : [fr/mechanisms.md](./fr/mechanisms.md)*

# Mechanisms Reference for Level Authors

This page lists the mechanisms added after the Sanctuary archetypes of the [Puzzle & Mechanism Encyclopedia](./puzzle-encyclopedia.md), grouped by origin: Chip's Challenge 2 (CC2), Chuck's Challenge 3D (CC3D) and Epoxy itself. For each one it says what it does and how to place and configure it in the level editor. Every statement follows the engine, the tile and entity descriptions of the locale files (`src/locales/en.json`) and the [changelog](../CHANGELOG.md).

## 0. Before you start

- **Epoxy rules only.** Every mechanism below is played by the Epoxy engine. A Lynx level cannot hold them (the editor's `Rules` field switches a level between Epoxy and Lynx), and a native CC3D level has its own palette. The CC3D conversion and the CC2 import produce Epoxy-rules levels that use these mechanisms.
- **Pack formats 13 and 14.** Levels that use them are written with pack format 13 (`PACK_JSON_VERSION_V13`); the CC2 mechanisms of section 1.14 need pack format 14.
- **Placing.** Pick the entry in the editor palette (the search field lists every variant by name) and paint it. Entries that come in variants (no-signs, counters, swivel doors, CC2 swivel doors, toggle switch) take one palette entry each: `R` cycles the brush through the family, the entry shows the variant in hand, and the eyedropper picks the variant under the cursor.
- **Turning.** `R` rotates the brush clockwise (or goes to the next variant). `Shift+R` turns the creature or turret under the cursor, a floating stamp, or, for a track cell, its tracks a quarter turn.
- **Linking.** `K` starts or ends a link from the device under the cursor. The Connections section of the inspector lists what the device controls and what controls it, and the "How mechanisms work" card sums up how the parts of each mechanism find each other.
- **Cell inspector.** The Cell section of the inspector shows the cell under the cursor. The track cell adds its own section there.
- **Validator.** The validator follows all of these mechanisms; the specific warnings are named in the entries below.

## 1. From Chip's Challenge 2

The CC2 import (`.c2m` files, `.c2g` game scripts or a whole folder) maps these mechanisms, and gives each level a coverage badge: exact, approximate or not playable.

### 1.1 Track cells and the railroad sign

- **What it does.** A track cell (`rail_junction` with a per-level `railTracks` entry) holds up to six segments: four bends (north-east, south-east, south-west, north-west) and two straights (east-west, north-south). Whatever enters (player, block or monster) must come in through a side that a segment opens, and leaves only along a segment that joins the side it came in by. A refused step is turned: straight, right, left, back. A cell with a switch uses one segment at a time (the open segment) and moves to the next when something leaves along the active one, or when it is pulsed. Blocks may back out. The railroad sign, once picked up, makes track cells stop limiting where its holder comes in or out; a thief takes it with the other boots. Native rails are unchanged.
- **Placing.** The track cell is in the Rails group of the palette and starts as a north-south straight.
- **Configuring.** A section of the Cell inspector, "Track cell at (x, y)", has one toggle per segment, a choice of the open segment of the switch (or "No switch"), and a Clear action. `Shift+R` turns all the tracks of the cell a quarter turn.
- **Validator.** It warns about a track cell with no segment (nobody can enter it). Its reach walk enters a track cell only through an open side and leaves along a segment joining the entry side; a reachable railroad sign opens every track.

### 1.2 Canopy and locked arrow block

- **Canopy.** A cell edge flag, drawn as a semi-opaque roof over the cell. It stops bugs and rovers from entering, and a blob cannot move between two canopy cells.
  - **Placing.** The Canopy brush is in the Terrain tab. A click toggles the canopy on a cell and keeps its thin walls. A drag applies the choice made on the first cell to the whole stroke. The eraser clears it. A canopy cannot fill a selection (`Shift+F` is refused): draw it with the brush.
- **Locked arrow block.** An arrow block with no arrow (`arrow_block_none`): no push moves it, whether from the player, a monster or another block. It still slides on ice or a force floor and still pushes like the other arrow blocks. Place it from the palette like any block.

### 1.3 Chain pushing

- **What it does.** An ice block pushes ice blocks and arrow blocks; an arrow block pushes dirt, ice and arrow blocks. A line of blocks moves in one push. A wall, the map edge or a sliding block ahead refuses the whole push. A block that is itself sliding is never pushed, and nothing is ever pushed onto the player. A sliding block (on ice or a force floor) pushes the resting block it reaches under the same chain rules. Puppets and pull boots never chain. An ice block never pushes a dirt block directly.
- **Configuring.** There is nothing to place: the rule is a per-block field (`chainPushes`). Levels are laid out with plain blocks. Old replays (pack formats 1 to 12) that pushed a block into another block could differ; the bundled solutions are unaffected.
- **Related rule.** An ice block pushed into water turns the water into ice (Epoxy rules); pushed into fire it still melts it into water. The validator counts an ice block as a filler for water.

### 1.4 Dynamite

- **What it does.** Pick it up and set it down; it lights when you step off its cell. 85 ticks later it blasts a 5 x 5 area without its four far corners. The blast destroys walls, doors and most terrain, items, and every creature caught in it, and turns the floor under a creature into fire. Steel walls, sockets and logic gates resist. A blast does not set off other dynamite. Lit dynamite blocks nothing and cannot be picked up.
- **Placing.** Palette entry `Dynamite`. The CC2 import maps dynamite to it; the Epoxy blast charge is unchanged.

### 1.5 Green chips, green bombs, steel walls, steel foil

- **Green chip and green bomb.** The green chip counts as a chip (and toward the chips required); the green bomb explodes like a bomb. Every press of a green button turns every one into the other.
- **Steel wall.** A wall no blast can destroy.
- **Steel foil.** Pick it up and keep it: bumping into a plain wall turns that wall into a steel wall; you do not move and the foil is not used up. A thief takes it.
- **Placing.** Palette entries; nothing else to configure.

### 1.6 Characters: Melinda, hiking boots, signs, transmogrifier

- **Character.** A per-level `character` setting (Chip by default, left out of the file for Chip), chosen in the level settings, plays the level as Melinda. She does not slide on ice and needs hiking boots on dirt and gravel; the boots do nothing for Chip.
- **Signs.** The Chip-only and Melinda-only signs stop only the other character; monsters and blocks pass.
- **Transmogrifier.** Stepping on it switches the player between Chip and Melinda, with the rules of the current character following; undo restores it. The validator treats a level with a transmogrifier as playable by either character.
- **Teeth.** Ordinary teeth flee Melinda; timid teeth flee Chip and chase Melinda.

### 1.7 No-signs

- **What it does.** Item-layer signs `no_sign_<item>` (keys, every boot, speed and eye boots, ward, hiking boots, blast charge, dynamite, pocket gate, hurl stone, toll token, steel foil, bribe, lightning bolt). The item cannot be picked up there, and a player carrying that item cannot enter the cell. The terrain under the sign keeps working; blocks pass, monsters do not.
- **Placing.** One palette entry for the family; `R` cycles the variants. The CC2 import uses them for a no-sign over any other item or over non-floor terrain (approximate); over a bonus or a toggle clock the sign is dropped.

### 1.8 CC2 swivel doors

- **What it does.** `swivel_door_cc2_*`: the closed sides stop entering only. Leaving through a closed side pushes the door round (clockwise when the next side clockwise is closed too, else counter-clockwise); leaving through an open side does not turn it. The native swivel doors are unchanged.
- **Placing.** One palette entry; `R` cycles the four corner variants.

### 1.9 Items

- **Toggle clock.** Stays on the map. Stepping on it pauses the level timer; stepping on it again resumes it (a PAUSED indicator shows in the HUD). Monsters and blocks cannot enter its cell. It does nothing on a level without a time limit.
- **Bribe.** Pick it up and keep it. Each time you step on a thief, one bribe is spent and nothing is taken. It cannot be set down, and a thief never takes it.
- **Lightning bolt.** While the player holds it, the wire floor they stand on powers its signal nets. CC2 also asks the holder to stand still and powers nets through electrified floor; neither is played, so the bolt is marked approximate.

### 1.10 Logic: NAND, data latch, counter, named ports

- **NAND gate.** Sends a signal unless every signal linked into it is sending.
- **Data latch.** Remembers the signal on its data link (port `in0`) while its clock link (port `in1`) is sending, and sends what it remembers. Both CC2 latches play as a data latch; the toggle latch is unchanged.
- **Counter (0 to 9).** Counts up on each start of its first input (`in0`) and down on each start of its second (`in1`), from 0 to 9. Wrapping past 9 sends a short pulse on `out0`; wrapping below 0 sends on `out1` until the next count. One palette entry; `R` cycles the starting value.
- **Ports.** Gate ports (`in0`/`in1`, `out0`/`out1`) are carried by the signal links. See section 3.3 for how to see and swap them in the editor.

### 1.11 Monsters

- **Floor mimic.** Chases the player like teeth but four times slower, and looks almost like plain floor (only a faint mark shows in the editor). Kills on contact.
- **Timid teeth.** Run away from Chip and chase Melinda.
- **Ghost.** Walks through walls, doors, sockets and thin walls, but not steel walls, clone machines, water or lily pads. Ice, force floors, rails, traps, bombs, fire and slime do nothing to it; it walks over items without picking them up and works the buttons it crosses.
- **Rover.** Moves like teeth, glider, bug, pink ball, timid teeth, fireball, paramecium and walker in turn, changing every 32 decisions.
- **Placing.** Palette entries; `Shift+R` turns the creature under the cursor.

### 1.12 Mirror players

- **What they do.** Mirror Chip and mirror Melinda copy every move the player of their character attempts (blocked moves included) and do nothing while the other character is the player. They follow that character's terrain rules, open the doors of their own key colour (green for Chip's, yellow for Melinda's) without using the key, pick up keys and tools but not chips, push one block, press buttons, and die on hazards without ending the level. Touching one kills the player.
- **Placing.** Palette entries `Mirror Chip` and `Mirror Melinda`; `Shift+R` turns the creature under the cursor.

### 1.13 Several players in one level

- **What it does** (Epoxy rules). One player is controlled at a time and a swap passes control to the next. The others take no step of their own but still slide and can be killed. Each player keeps its own keys, tools and character; chips are shared. A player reaching an exit leaves play, and every player must exit to win. Undo and recorded moves include swaps. Levels with one player are unchanged.
- **Placing.** The Second Player tool places extra player starts (up to 7 more); the direction control sets the facing, `R` or `Shift+R` turns one, and the eraser removes it. The Cell inspector picks each one's character (Chip or Melinda) or removes it. Extras follow every edit (eraser, cut, paste, move, resize, undo), and the level settings show the player count. A second player cannot start on the player start cell. Epoxy rules only.
- **Playing.** `V` (rebindable in the game config) or the touch button swaps to the next player. The HUD shows the controlled character with its portrait, how many players remain and how many are out, and a ring marks the controlled player. Swaps are announced and replayed; a stored solution can contain a swap (letter `P`).
- **Import and validator.** Packs store these levels (format 13) in an `extraPlayers` list. The CC2 import places every player (CC2 multi-player levels are approximate instead of lost). The validator floods from every start, reports a player who cannot reach an exit, and warns about two starts on one cell.

### 1.14 CC2 elements added in pack format 14

- **CC2 slime.** Kills every monster but the ghost and the blob. A dirt block or an ice block pushed onto it clears the slime and survives. A blob that stood on slime spreads it. The boulder is not modelled.
- **CC2 turtle.** A lily pad that monsters may enter. It bars fireballs and ghosts, and turns to water behind whoever leaves it (a glider leaves it afloat).
- **CC2 flame jet and orange button.** The jet burns whoever stands in it while it is lit; fire boots protect, and monsters may walk in. An orange button toggles the jet it is connected to when it is pressed and again when it is released. The CC2 import places the button as a pressure plate and links it to the jet CC2 would connect (the first jet found by a search in growing diamonds around the button, east first, counterclockwise). Two buttons on one jet, or a button and a wire, are ORed: a known approximation.
- **Block barrier floor.** The CC2 popdown floor: the player and the monsters walk over it, every block is barred.
- **Cross arrow block.** The directional block with four arrows. Any push moves it. It does not yet push other blocks along when it slides.
- **CC2 transmogrifier.** Swaps actors by the CC2 pairs. The blob turns into a random monster of the CC2 pool, drawn from a seeded generator. Known gaps: a blue tank becomes a yellow tank (Epoxy has one tank), items are not swapped, and a wire does not switch it.
- **Random teleporter.** The green pad: the destination is drawn among the other green pads from a seeded generator, so replays stay deterministic.
- **CC2 red teleporter.** The red pad with its own exit order. The wire that switches it off and the player override of the red pad are deferred.
- **Helmet.** An item that shields its holder from the contact of monsters and blocks for as long as it is held. It does not stop a bowling ball.
- **Placing.** Palette entries. Under a no-sign the helmet imports as the ward, because no sign exists for the helmet.

## 2. From Chuck's Challenge 3D

The CC3D conversion (the "Convert to Epoxy" button, and `npm run import:cc3d` for whole folders offline) uses these mechanisms instead of look-alikes, and reports the coverage per pack.

### 2.1 Fish gate and teleporters

- **Fish gate.** A socket that stays shut while a chip is left. Once the last chip is in, the player, a block or a monster may enter, and the first one through turns it into floor. Needs: chips to collect.
- **Forward teleporter.** Chains only with other forward teleporters and sends whatever enters (player, block or monster) out of the previous one in reading order, straight ahead only.
- **Turning teleporter.** Same chain, but tries ahead, then right, then left, then back. A pad holding something is skipped.
- **Placing.** Palette entries, in the Teleports group. Each needs a second pad of its own kind. The socket and both teleporters are exact in the conversion.

### 2.2 Monsters

Palette entries, one per monster; `Shift+R` turns the creature under the cursor. Baby monsters and legs press plates.

| Monster | Movement (from its description) |
|---|---|
| Bouncer | Straight, turns back when blocked; avoids water, fire, slime |
| Snappy | Chases along the axis of greater distance, rests a step after each step |
| Nibble | Runs away along the axis of greater distance, rests a step after each step |
| Blinky | Straight, else left, right, back; water does not stop it; presses no plate, works no switch |
| Baby Blinky | Like Blinky, but ice and force floors carry it, and it works plates and switches |
| Limpy / Limpa | Follow the wall on their right / left |
| Omni | Slow, random direction; once it stood on slime it leaves slime behind |
| Walker (CC3D) | Straight; random direction when blocked; steps in four ticks |
| Green Legs / Red Legs | Straight, else right, left, back / straight, else left, right, back |
| Screamer | Fire does not stop it; melts the ice block in its way; presses no plate |
| Baby Screamer | Like Screamer, but ice and force floors carry it, and it works plates |

The CC3D-origin monsters kill on contact.

## 3. From Epoxy

### 3.1 Wired devices

Signal links drive these devices; the validator and the "How mechanisms work" card follow them.

- **Purple wall and purple floor.** Flip on every change of the signal wired into them, whether it starts or stops sending (not touched by the green button).
- **Toggle switch.** A signal source that flips its state each time something steps on it (one palette entry, `R` picks off or on).
- **Black button.** A signal source that is on all the time, except while something stands on it.
- **Gray pulse button.** Each time something steps on it, it pulses every wired device within two cells (a 5 x 5 area) with no link from the button: flip tiles flip, launchers and clone machines fire once, hold doors, relay pads and wired traps open for one moment.
- **Signal bear trap.** Holds whatever steps in; opens while its signal is on or while a brown button is held.
- **Signal flame jet.** Lights each time its signal changes; the orange button does not touch it.
- **Placing and linking.** Palette entries. Link each source to its devices with `K` (or the Link button of the Connections section). The CC2 import maps its purple walls and floors, toggle switches, black buttons, gray buttons and traps reached by a wire to these, and its flame jets (wired or not) to the CC2 flame jets of section 1.14; the wired trap, wired CC2 flame jet and gray button are reported as approximate.

### 3.2 Several players

See section 1.13: the rule is CC2's, played under Epoxy rules, and the editor, play controls, import and validator all support it.

### 3.3 Gate ports in the editor

- **Connections rows.** The rows of a data latch or counter name the role of each link: data, clock, count up, count down, overflow, underflow.
- **Swap ports.** A "Swap inputs" / "Swap outputs" button exchanges the ports of the device (undoable).
- **Overlay.** The device overlay tags each arrow with its port (D, CK, +, -, OV, UN).
- **Validator.** It warns about a data latch without clock or data, and about a counter that only counts down with no link on its underflow output.

### 3.4 Variant families in the palette

Variant families take one entry each: no-signs, counters, swivel doors, CC2 swivel doors, toggle switch. `R` cycles the brush through the family, the entry shows the variant in hand, the eyedropper picks the variant, and search still lists every variant.

## 4. Quick table

| Mechanism | Origin | Editor control |
|---|---|---|
| Track cell, railroad sign | CC2 | Rails group, Cell inspector section, `Shift+R` |
| Canopy | CC2 | Canopy brush, Terrain tab |
| Locked arrow block, chain push | CC2 | Palette / rule on blocks |
| Dynamite, green chip and bomb, steel wall and foil | CC2 | Palette |
| Melinda, hiking boots, signs, transmogrifier | CC2 | Level settings (Character), palette |
| No-signs, CC2 swivel doors | CC2 | Palette family, `R` |
| Toggle clock, bribe, lightning bolt | CC2 | Palette |
| NAND, data latch, counter | CC2 | Palette, Connections rows, Swap ports |
| Floor mimic, timid teeth, ghost, rover, mirror players | CC2 | Palette, `Shift+R` |
| CC2 slime, turtle, flame jet and orange button, block barrier floor, cross arrow block, CC2 transmogrifier, random and CC2 red teleporters, helmet | CC2 | Palette, `K` for the orange button |
| Fish gate, forward and turning teleporters | CC3D | Palette |
| Bouncer, snappy, nibble, blinky family, limpy, limpa, omni, walker, legs, screamer family | CC3D | Palette, `Shift+R` |
| Purple wall and floor, toggle switch, black button, gray pulse button, signal trap and flame jet | Epoxy | Palette, `K` |
| Several players | CC2 rule | Second Player tool, Cell inspector, `R` / `Shift+R`, `V` to swap in play |
