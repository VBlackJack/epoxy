*Version française : [fr/puzzle-encyclopedia.md](./fr/puzzle-encyclopedia.md)*

# Sanctuary Puzzle & Mechanism Encyclopedia

This encyclopedia catalogs the **14 canonical sanctuary puzzle archetypes** across 5 mechanical families, providing ASCII blueprints, design invariants, dead-end traps, and composition rules for building levels in Epoxy.

Every archetype blueprint documented here is machine-verified in `public/configs/excavation-encyclopedia.json` (`src/config/ExcavationEncyclopedia.test.ts`): each room compiles cleanly, passes `LevelValidator.validate` with zero issues, and replays its shortest solution to victory in `GameEngine`.

---

## 1. Taxonomy Overview

| ID | Archetype | Family | Tier | Core Mechanics |
|---|---|---|---|---|
| `boulder_sluice` | Single-Boulder Sluice | `sluice` | 1 | `dirt_block`, `water`, `dirt`, `socket` |
| `double_sluice` | Sequential Double-Trench Sluice | `sluice` | 2 | `dirt_block`, `water`, `dirt`, `socket` |
| `elemental_alchemy` | Elemental Fire-to-Water Sluice | `sluice` | 3 | `ice_block`, `dirt_block`, `fire`, `water`, `dirt` |
| `counterweight_hold` | Counterweight Hold-Plate | `extraction` | 1 | `dirt_block`, `pressure_plate_red`, `hold_door_red_closed` |
| `grappling_alcove` | Recessed Alcove Extraction | `extraction` | 2 | `boots_pull`, `dirt_block`, `pressure_plate_blue`, `hold_door_blue_closed` |
| `counterweight_swap` | Counterweight Bridge Swap | `extraction` | 3 | `boots_pull`, `dirt_block`, `water`, `pressure_plate_blue`, `hold_door_blue_closed` |
| `prism_slalom` | Multi-Prism Beam Slalom | `optics` | 2 | `laser_emitter_e`, `mirror_backslash`, `laser_receiver_red`, `laser_gate_red_closed` |
| `grappling_prism` | Recessed Alcove Prism | `optics` | 3 | `boots_pull`, `mirror_backslash`, `laser_emitter_s`, `laser_receiver_red`, `laser_gate_red_closed` |
| `crossed_beams` | Crossed Dual-Beam Matrix | `optics` | 4 | `laser_emitter_e`, `mirror_backslash`, `laser_receiver_red`, `laser_receiver_blue`, `laser_gate_red_closed`, `laser_gate_blue_closed` |
| `glacier_slide` | Glacier Slide & Corner Deflector | `kinetic` | 2 | `dirt_block`, `ice`, `ice_ne`, `pressure_plate_yellow`, `hold_door_yellow_closed` |
| `conveyor_sluice` | Current Sluice Conveyor | `kinetic` | 3 | `dirt_block`, `force_e`, `pressure_plate_green`, `hold_door_green_closed` |
| `clone_foundry` | Block Cloner Foundry | `kinetic` | 4 | `button_red`, `clone_machine`, `dirt_block`, `water`, `dirt` |
| `portal_islands` | Multi-Island Teleport Ferry | `network` | 3 | `dirt_block`, `teleport_red`, `teleport_blue`, `pressure_plate_red`, `hold_door_red_closed` |
| `signal_relay` | Dual-Chamber Signal Relay | `network` | 5 | `signal_plate`, `laser_receiver_red`, `signal_gate_and`, `hold_door_red_closed`, `dirt_block`, `mirror_backslash` |

---

## 2. Global Level-Design Invariants

Before combining mechanisms from this encyclopedia, enforce these four engine invariants so `LevelValidator` reports zero warnings or errors:

1. **No Socket Bypass (`socket_bypass`)**: Whenever a level has at least one pushable block entity and `chipsRequired > 0`, `LevelValidator` treats `water` and `fire` as potentially bridgeable. Always place a `socket` (`S`) or a closed gate (`hold_door_*_closed`, `laser_gate_*_closed`) on the final choke before `exit` (`E`), and seal side walls so the player cannot walk around the socket.
2. **No Collectible or Hint Covered by a Block (`hidden_by_block`)**: `LevelValidator` floods every cell that any block can ever reach. Never place a `chip` (`C`), `key_*`, `boots_*`, or `hint` (`H`) on a cell a block can be pushed onto. Protect collectibles and hints by placing them:
   - inside a **3-walled alcove** (where the cell behind the item is a wall `#`, so no pusher can stand behind the block to push it in), or
   - behind a **`dirt` (`d`) tile**, since `dirt` blocks entities (`passableByBlock: false`) until the player steps on it.
3. **Perpendicular Release Cell for Grappling Gloves (`boots_pull`)**: While carrying `boots_pull`, stepping away from an adjacent block pulls that block into the player's previous cell. Every 1-tile pull lane must end in a 2-tile-wide pocket or T-junction so the player can step **perpendicularly** to detach from the block before walking around behind it.
4. **Laser Beam Backstops & Non-Lethal Return Paths**: Live laser beams are lethal to the player. Always place a wall `#` backstop behind a mirror's target cell so an unreflected beam does not cut across the exit corridor, and always align the farthest mirror before a nearer mirror whose deflected beam crosses the room.

---

## 3. Family 1: Hydraulic & Sluice Engineering (`sluice`)

### 3.1 Single-Boulder Sluice (`boulder_sluice`, Tier 1)
Push a stone boulder (`dirt_block`) into a 1-tile water channel (`W`) to turn it into `dirt` (`d`), then step onto the `dirt` tile to compact it into floor.

```text
#########
#P......#
#..$....#
###W#####
###d..C##
###...SE#
#########
```

- **Verified Solution**: `EESSSEEESE` (10 steps)
- **Invariants**:
  - Keep a walkable cell North of `$` so the player can align with column 3.
  - Seal `(7, 4)` with `#` so `E(7, 5)` can only be entered through `S(6, 5)`.
- **Dead-End Traps**: Pushing `$` West or East into a side wall locks the boulder.

### 3.2 Sequential Double-Trench Sluice (`double_sluice`, Tier 2)
Bridge a 2-tile water channel (`WW`) using two boulders. Because the first boulder turns the first `W` into `dirt` (`d`), and `dirt` blocks entities, the player must step onto the first bridged cell to compact it into `.` before returning to push the second boulder across.

```text
#########
#P......#
#..$..$.#
#.......#
###W#####
###W#####
###d..C##
###...SE#
#########
```

- **Verified Solution**: `EESSSNEEEENWWWNWSSSSSEEESE` (26 steps)
- **Invariants**: Leave a 3-row staging hall (`rows 1-3`) so the second boulder at `(6, 2)` can be pushed West to `(3, 2)` and then South down column 3.
- **Dead-End Traps**: Pushing the second boulder into column 3 before stepping on `d(3, 4)` jams both boulders.

### 3.3 Elemental Fire-to-Water Sluice (`elemental_alchemy`, Tier 3)
Two-stage alchemical reaction: push an `ice_block` (`I`) into `fire` (`F`) to melt both into `water` (`W`), then push a `dirt_block` (`$`) into the resulting `water` to create a `dirt` bridge.

```text
#########
#P......#
#..I..$.#
###.#####
###F#####
###d..C##
###...SE#
#########
```

- **Verified Solution**: `EESSNNEEEESWWWNWSSSSEEESE` (25 steps)
- **Invariants**: Stage `I` (`ice_block`) aligned with the `F` choke so the player naturally melts `F -> W` first, then routes `$` (`dirt_block`) into the same lane.

---

## 4. Family 2: Counterweights & Alcove Extraction (`extraction`)

### 4.1 Counterweight Hold-Plate (`counterweight_hold`, Tier 1)
Push a stone boulder (`$`) onto `pressure_plate_red` (`[`) to hold open `hold_door_red_closed` (`]`).

```text
#########
#P......#
#..$..[.#
#.......#
###]#####
###C..SE#
#########
```

- **Verified Solution**: `ESEEESWWSSEEEE` (14 steps)
- **Invariants**: `hold_door_<color>_closed` opens only while **all** `pressure_plate_<color>` tiles of that colour on the level are pressed.

### 4.2 Recessed Alcove Extraction (`grappling_alcove`, Tier 2)
Collect `boots_pull` (`G`) from a 3-walled alcove, pull a recessed boulder (`$`) out of its 3-walled alcove at `(2, 3)` East to `(5, 3)`, step North to `(6, 2)` to detach without re-pulling, then step West to `(5, 2)` and push `$` South onto `pressure_plate_blue` (`[`).

```text
#########
#P....#G#
#.###...#
##$.....#
###d#[###
###]#####
###C..SE#
#########
```

- **Verified Solution**: `EEEESEENSSWWWWEEENWSWWSSSEEEE` (29 steps)
- **Invariants**:
  - `G` (`boots_pull`) sits in a 3-walled alcove at `(7, 1)` so `$` can never be pushed onto `G`.
  - `d` at `(3, 4)` stops `$` from entering the door lane while allowing the player to walk through once `]` opens.

### 4.3 Counterweight Bridge Swap (`counterweight_swap`, Tier 3)
Spend the upper boulder (`$`) to bridge the water moat `W(3, 3)`, then use `boots_pull` (`G`) to extract the lower recessed boulder (`$`) at `(2, 4)` and push it onto `pressure_plate_blue` (`[`).

```text
#########
#P.d.G###
#..$#####
###W#...#
##$.....#
###d#[###
###]#####
###C..SE#
#########
```

- **Verified Solution**: `EEEEWWSSSEEENWSWWSSSEEEE` (24 steps)
- **Invariants**: The `d` tile at `(3, 1)` prevents the upper boulder from ever reaching `G(5, 1)`, eliminating `hidden_by_block` warnings.

---

## 5. Family 3: Prismatic Optics (`optics`)

### 5.1 Multi-Prism Beam Slalom (`prism_slalom`, Tier 2)
Route an East-firing `laser_emitter_e` (`>`) beam around a central pillar using two `mirror_backslash` (`\`) prisms into `laser_receiver_red` (`R`), opening `laser_gate_red_closed` (`:`).

```text
#########
#P...d:C#
#...\.#S#
#>...##E#
#.....###
#..\..R.#
#########
```

- **Verified Solution**: `EEEESWNWSNEEEESS` (16 steps)
- **Invariants**: Stage the upper mirror at `(4, 2)` North of the horizontal beam so pushing it South to `(4, 3)` keeps the player in the safe upper lane.

### 5.2 Recessed Alcove Prism (`grappling_prism`, Tier 3)
Pick up `boots_pull` (`G`), pull `mirror_backslash` (`\`) out of its 3-walled alcove at `(2, 3)`, detach via the North release pocket `(5, 2)`, walk behind the mirror via `(3, 2) -> (3, 3)`, and push it East into the vertical beam from `laser_emitter_s` (`v`) at `(6, 3)` so it reflects East into `R(7, 3)`.

```text
#########
#P....dG#
#.#...v##
##\....R#
###d#####
###:#####
###C..SE#
#########
```

- **Verified Solution**: `EEEEEEWWSSWWEENWWSEENWSWSSSEEEE` (31 steps)
- **Invariants**: Because the player pushes `\` East from `(5, 3)` into `(6, 3)`, the player never steps onto the live beam cell `(6, 3)`.

### 5.3 Crossed Dual-Beam Matrix (`crossed_beams`, Tier 4)
Two horizontal emitters on rows 3 and 4 cross paths through two `mirror_backslash` (`\`) prisms to light both `laser_receiver_red` (`R`) and `laser_receiver_blue` (`B`), opening the series lock `:` + `;`.

```text
#########
#P...d:;#
#..\.\#C#
#>....#S#
#>....#E#
#..R.B###
#########
```

- **Verified Solution**: `EESNEESSNNEESSS` (15 steps)
- **Invariants**: Both mirrors start on row 2 (North of the two horizontal beams) so the player pushes them South into their respective beams while remaining in the safe upper lane.

---

## 6. Family 4: Kinetic & Cryo Routing (`kinetic`)

### 6.1 Glacier Slide & Corner Deflector (`glacier_slide`, Tier 2)
Push a boulder (`$`) East onto an `ice` strip (`I`) terminated by an `ice_ne` (`2`) corner wall so it deflects South onto `pressure_plate_yellow` (`[`), opening `hold_door_yellow_closed` (`]`).

```text
#########
#P......#
#.$II2..#
#....I..#
###]#[###
###d.#SE#
###C...##
#########
```

- **Verified Solution**: `SESESSSEEEENE` (13 steps)
- **Invariants**: Placing a wall `#` at `(5, 5)` immediately South of `[` stops the sliding boulder on the plate and prevents the player from sliding through `[` into the lower chamber without the boulder.

### 6.2 Current Sluice Conveyor (`conveyor_sluice`, Tier 3)
Push a boulder (`$`) East onto a `force_e` (`>`) conveyor belt so the stream carries it onto `pressure_plate_green` (`[`), opening `hold_door_green_closed` (`]`).

```text
#########
#P......#
#.$>>>[.#
#.......#
###]#####
###C..SE#
#########
```

- **Verified Solution**: `SESESSEEEE` (10 steps)
- **Invariants**: The conveyor stream terminates directly on `[` at `(6, 2)`.

### 6.3 Block Cloner Foundry (`clone_foundry`, Tier 4)
Step on `button_red` (`+`) linked via `cloneLinks` to a `clone_machine` (`M`) holding a `dirt_block` template facing East, then push the spawned boulder at `(3, 2)` South into `W(3, 3)`.

```text
#########
#P+.....#
#.M.....#
###W#####
###d..C##
###...SE#
#########
```

- **Verified Solution**: `EESSSEEESE` (10 steps)
- **Invariants**: `templateDir: "E"` spawns the boulder at `(3, 2)` with `(3, 1)` open North of it so the player can push it South into `W(3, 3)`.

---

## 7. Family 5: Network & Logic Sanctuaries (`network`)

### 7.1 Multi-Island Teleport Ferry (`portal_islands`, Tier 3)
Push a boulder (`$`) South into `teleport_red` (`O`) at `(3, 3)` so it emerges from the lower `teleport_red` (`O`) at `(3, 5)` moving South onto `pressure_plate_red` (`[`) at `(3, 6)`, then follow via `teleport_blue` (`o`) at `(6, 2) -> (6, 5)` and cross the open `hold_door_red_closed` (`]`).

```text
#########
#P......#
#..$..o.#
#..O....#
#########
#..O.#o.#
#..[###]#
####ESC.#
#########
```

- **Verified Solution**: `EESEEESSWWW` (11 steps)
- **Invariants**: Walled flanks around `o(6, 5)` ensure the player can only reach the lower corridor by crossing `](7, 6)` once `[(3, 6)` is held down by the teleported boulder.

### 7.2 Dual-Chamber Signal Relay (`signal_relay`, Tier 5)
Push `$` onto `signal_plate` (`!`) at `(4, 1)` AND push `\` South into the laser beam on row 3 so it illuminates `laser_receiver_red` (`R`) at `(4, 4)`. Both sources feed `signal_gate_and` (`&`) at `(2, 5)`, whose output drives `hold_door_red_closed` (`]`) at `(7, 1)`.

```text
#########
#P$.!..]#
#...\.#C#
#>....#S#
#...R.#E#
##&######
#########
```

- **Verified Solution**: `SEENESWWWNEESEENEESSS` (21 steps)
- **Signal Wiring (`signalLinks`)**:
  - `(4, 1) -> (2, 5)` (`signal_plate` to `signal_gate_and`)
  - `(4, 4) -> (2, 5)` (`laser_receiver_red` to `signal_gate_and`)
  - `(2, 5) -> (7, 1)` (`signal_gate_and` to `hold_door_red_closed`)

---

## 8. Chaining & Multi-Room Sanctuary Composition

To build a full 15x15 to 25x25 sanctuary level by chaining archetypes from this encyclopedia:

1. **Hub-and-Wings Layout**: Place a central sanctuary hall containing the final vault gate (`hold_door_*_closed`, `laser_gate_*_closed`, or `socket` + `exit`), flanked by 2 to 4 wing chambers that each house one archetype (`boulder_sluice`, `grappling_alcove`, `prism_slalom`, `elemental_alchemy`).
2. **Tool Progression Chain**: Place `boots_pull` ("Grappling Gloves") as the reward of an early wing (`boulder_sluice` or `prism_slalom`), unlocking recessed boulders and mirrors in subsequent wings (`grappling_alcove`, `counterweight_swap`, `grappling_prism`).
3. **Cross-Wing Dependencies**:
   - **Block Ferry**: Export a boulder from a `grappling_alcove` or `clone_foundry` wing across a `portal_islands` or `conveyor_sluice` lane into a `double_sluice`.
   - **Dual-Lock Finale**: Wire two wings (one `counterweight_hold` / `signal_plate` wing and one `prism_slalom` / `laser_receiver_*` wing) into a `signal_gate_and` (`signal_relay`) to open the central sanctuary vault.
