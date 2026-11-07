*Version française : [fr/puzzle-encyclopedia.md](./fr/puzzle-encyclopedia.md)*

# Sanctuary Puzzle & Mechanism Encyclopedia

This encyclopedia catalogs the **25 canonical sanctuary puzzle archetypes** across 9 mechanical families, providing ASCII blueprints, design invariants, dead-end traps, and composition rules for building levels in Epoxy.

Every archetype blueprint documented here is machine-verified in `public/configs/excavation-encyclopedia.json` (`src/config/ExcavationEncyclopedia.test.ts`): each room compiles cleanly, passes `LevelValidator.validate` with zero issues, replays its shortest solution to victory in `GameEngine`, and proves non-bypassability for every puzzle entity, link, and item.

---

## 1. Taxonomy Overview

| ID | Archetype | Family | Tier | Core Mechanics |
|---|---|---|---|---|
| `boulder_sluice` | Single-Boulder Sluice | `sluice` | 1 | `dirt_block`, `water`, `dirt`, `socket` |
| `double_sluice` | Sequential Double-Trench Sluice | `sluice` | 2 | `dirt_block`, `water`, `dirt`, `socket` |
| `elemental_alchemy` | Elemental Fire-to-Water Sluice | `sluice` | 3 | `ice_block`, `dirt_block`, `fire`, `water`, `dirt`, `socket` |
| `counterweight_hold` | Counterweight Hold-Plate | `extraction` | 1 | `dirt_block`, `pressure_plate_red`, `hold_door_red_closed`, `socket` |
| `grappling_alcove` | Recessed Alcove Extraction | `extraction` | 2 | `boots_pull`, `dirt_block`, `pressure_plate_blue`, `hold_door_blue_closed`, `dirt`, `socket` |
| `counterweight_swap` | Counterweight Bridge Swap | `extraction` | 3 | `boots_pull`, `dirt_block`, `water`, `dirt`, `pressure_plate_blue`, `hold_door_blue_closed`, `socket` |
| `prism_slalom` | Multi-Prism Beam Slalom | `optics` | 2 | `laser_emitter_e`, `mirror_backslash`, `laser_receiver_red`, `laser_gate_red_closed`, `dirt`, `socket` |
| `grappling_prism` | Recessed Alcove Prism | `optics` | 3 | `boots_pull`, `mirror_backslash`, `laser_emitter_s`, `laser_receiver_red`, `laser_gate_red_closed`, `dirt`, `socket` |
| `crossed_beams` | Crossed Dual-Beam Matrix | `optics` | 4 | `laser_emitter_e`, `mirror_backslash`, `laser_receiver_red`, `laser_receiver_blue`, `laser_gate_red_closed`, `laser_gate_blue_closed`, `dirt`, `socket` |
| `glacier_slide` | Glacier Slide & Corner Deflector | `kinetic` | 2 | `dirt_block`, `ice`, `ice_ne`, `pressure_plate_yellow`, `hold_door_yellow_closed`, `socket` |
| `conveyor_sluice` | Current Sluice Conveyor | `kinetic` | 3 | `dirt_block`, `force_e`, `pressure_plate_green`, `hold_door_green_closed`, `socket` |
| `clone_foundry` | Block Cloner Foundry | `kinetic` | 4 | `button_red`, `clone_machine`, `dirt_block`, `water`, `dirt`, `socket` |
| `portal_islands` | Multi-Island Teleport Ferry | `network` | 3 | `dirt_block`, `teleport_red`, `teleport_blue`, `pressure_plate_red`, `hold_door_red_closed`, `socket` |
| `signal_relay` | Dual-Chamber Signal Relay | `network` | 5 | `signal_plate`, `laser_emitter_e`, `mirror_backslash`, `laser_receiver_red`, `signal_gate_and`, `hold_door_red_closed`, `dirt_block`, `dirt`, `socket` |
| `monster_clock` | Pink-Ball Escapement Clock | `automata` | 2 | `pink_ball`, `pressure_plate_red`, `hold_door_red_closed`, `socket` |
| `trap_escapement` | Bear-Trap Escapement Release | `automata` | 3 | `button_brown`, `trap`, `tank`, `pressure_plate_red`, `hold_door_red_closed`, `socket` |
| `tank_convoy` | Blue-Button Tank Convoy | `automata` | 4 | `button_blue`, `tank`, `pressure_plate_blue`, `hold_door_blue_closed`, `socket` |
| `rail_switchyard` | Railroad Switchyard Dispatch | `transit` | 3 | `button_green`, `button_brown`, `trap`, `tank`, `rail_ns`, `rail_switch_b`, `rail_ew`, `pressure_plate_red`, `hold_door_red_closed`, `socket` |
| `turning_force_distributor` | Turning Force Distributor | `transit` | 3 | `force_cycle`, `dirt_block`, `pressure_plate_green`, `hold_door_green_closed`, `socket` |
| `pocket_gate_shuttle` | Portable Pocket-Gate Shuttle | `transit` | 4 | `pocket_gate`, `pocket_gate_pad`, `dirt_block`, `pressure_plate_red`, `hold_door_red_closed`, `dirt`, `socket` |
| `blast_charge_breach` | Timed Blast-Charge Breach | `ballistics` | 3 | `charge`, `dirt_block`, `force_s`, `button_green`, `toggle_wall_closed`, `laser_emitter_e`, `laser_receiver_red`, `laser_gate_red_closed`, `dirt`, `socket` |
| `hurl_stone_ricochet` | Mirror-Ricochet Hurl Stone | `ballistics` | 3 | `hurl_stone`, `mirror_backslash`, `water`, `bomb`, `force_e`, `dirt`, `socket` |
| `ward_lurker_gambit` | Ward & Dormant Lurker Gambit | `ballistics` | 4 | `ward`, `lurker_dormant`, `thin_wall_e`, `pressure_plate_red`, `hold_door_red_closed`, `socket` |
| `toggle_parity_weave` | Dual-Channel Toggle Parity Weave | `parity` | 3 | `button_green`, `toggle_button_red`, `toggle_wall_closed`, `toggle_wall_red_closed`, `dirt_block`, `water`, `dirt`, `socket` |
| `thief_boot_toll` | Fire-Boot Sluice & Thief Toll | `parity` | 3 | `boots_fire`, `fire`, `dirt_block`, `water`, `thief`, `forbid_boots_fire`, `dirt`, `socket` |

---

## 2. Global Level-Design Invariants

Before combining mechanisms from this encyclopedia, enforce these four engine invariants so `LevelValidator` reports zero warnings or errors:

1. **No Socket Bypass (`socket_bypass`)**: Whenever a level has at least one pushable block entity and `chipsRequired > 0`, `LevelValidator` treats `water` and `fire` as potentially bridgeable. Always place a `socket` (`S`) or a closed gate (`hold_door_*_closed`, `laser_gate_*_closed`) on the final choke before `exit` (`E`), and seal side walls so the player cannot walk around the socket.
2. **No Collectible or Hint Covered by a Block (`hidden_by_block`)**: `LevelValidator` floods every cell that any block can ever reach. Never place a `chip` (`C`), `key_*`, `boots_*`, `pocket_gate`, `hurl_stone`, `charge`, `ward`, or `hint` (`H`) on a cell a block can be pushed onto. Protect collectibles and hints by placing them:
   - inside a **3-walled alcove** (where the cell behind the item is a wall `#`, so no pusher can stand behind the block to push it in), or
   - behind a **`dirt` (`d`) tile**, since `dirt` blocks entities (`passableByBlock: false`) until the player steps on it.
3. **Perpendicular Release Cell for Grappling Gloves (`boots_pull`)**: While carrying `boots_pull`, stepping away from an adjacent block pulls that block into the player's previous cell. Every 1-tile pull lane must end in a 2-tile-wide pocket or T-junction so the player can step **perpendicularly** to detach from the block before walking around behind it.
4. **Laser Beam Backstops & Non-Lethal Return Paths**: Live laser beams are lethal to the player. Always place a wall `#` backstop behind a mirror's target cell so an unreflected beam does not cut across the exit corridor, and always align the farthest mirror before a nearer mirror whose deflected beam crosses the room.

---

## 3. Family 1: Hydraulic & Sluice Engineering (`sluice`)

Water and elemental hazard trenches bridged by sequential boulders, ice blocks, and compacted dirt.

### 3.1 Single-Boulder Sluice (`boulder_sluice`, Tier 1)
Bridge a one-tile water channel by pushing a stone boulder into the trench and compacting the resulting dirt.

```text
#########
#P......#
#..$....#
###W#####
###d..C##
###...SE#
#########
```

- **Legend**: `P` = `floor, start: S`; `$` = `floor, entity: dirt_block`; `W` = `water`; `d` = `dirt`; `C` = `floor, item: chip`; `S` = `socket`; `E` = `exit`
- **Design Invariants**:
  - Keep at least one walkable floor cell behind the boulder on its push axis so the player can align with the trench.
  - Always place a socket or closed gate before the exit when a block exists on the map to prevent socket_bypass warnings.
  - Stepping onto the resulting dirt tile compacts it into standard floor.
- **Verified Solution**: `EESSSEEESE`

### 3.2 Sequential Double-Trench Sluice (`double_sluice`, Tier 2)
Bridge a two-tile water trench with two boulders, compacting the first dirt bridge tile before pushing the second boulder across.

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

- **Legend**: `P` = `floor, start: S`; `$` = `floor, entity: dirt_block`; `W` = `water`; `d` = `dirt`; `C` = `floor, item: chip`; `S` = `socket`; `E` = `exit`
- **Design Invariants**:
  - A dirt_block sinking into water creates a dirt tile, which blocks subsequent entities until the player steps on it.
  - The player must step onto the first bridged cell and return to the staging room before pushing the second boulder.
  - Provide a loop or wide staging room so the second boulder can be routed into the same column.
- **Verified Solution**: `EESSSNEEEENWWWNWSSSSSEEESE`

### 3.3 Elemental Fire-to-Water Sluice (`elemental_alchemy`, Tier 3)
Push an ice block into a fire barrier to transmute it into water, then bridge the water with a stone boulder.

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

- **Legend**: `P` = `floor, start: S`; `I` = `floor, entity: ice_block`; `$` = `floor, entity: dirt_block`; `F` = `fire`; `d` = `dirt`; `C` = `floor, item: chip`; `S` = `socket`; `E` = `exit`
- **Design Invariants**:
  - An ice_block pushed into fire melts both the block and the fire into a water tile.
  - A dirt_block pushed into raw fire stops or fails to bridge; the ice_block must always enter first.
  - Stage the ice_block closer to the fire choke or in a parallel lane so both blocks can be sequenced cleanly.
- **Verified Solution**: `EESSNNEEEESWWWNWSSSSEEESE`

---

## 4. Family 2: Counterweights & Alcove Extraction (`extraction`)

Pressure-plate hold gates, counterweight swaps, and recessed boulders extracted with grappling gloves.

### 4.1 Counterweight Hold-Plate (`counterweight_hold`, Tier 1)
Park a stone boulder on a colour-coded pressure plate to keep a linked hold door open.

```text
#########
#P......#
#..$..[.#
#.......#
###]#####
###C..SE#
#########
```

- **Legend**: `P` = `floor, start: S`; `$` = `floor, entity: dirt_block`; `[` = `pressure_plate_red`; `]` = `hold_door_red_closed`; `C` = `floor, item: chip`; `S` = `socket`; `E` = `exit`
- **Design Invariants**:
  - A hold_door_<color>_closed tile opens only while every pressure_plate_<color> of the same colour on the map is pressed.
  - Place the pressure plate at the end of a push lane or with a wall backstop so the boulder stops squarely on the plate.
  - Never start a hold door in the open state unless all plates of its colour start pressed.
- **Verified Solution**: `ESEEESWWSSEEEE`

### 4.2 Recessed Alcove Extraction (`grappling_alcove`, Tier 2)
Use grappling gloves to pull a boulder out of a three-walled recess, then step perpendicularly to release it before pushing.

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

- **Legend**: `P` = `floor, start: S`; `G` = `floor, item: boots_pull`; `$` = `floor, entity: dirt_block`; `d` = `dirt`; `[` = `pressure_plate_blue`; `]` = `hold_door_blue_closed`; `C` = `floor, item: chip`; `S` = `socket`; `E` = `exit`
- **Design Invariants**:
  - With boots_pull equipped, stepping away from an adjacent block pulls that block into the player's previous cell.
  - Always provide a perpendicular side cell at the end of a pull corridor so the player can step sideways without re-pulling the block.
  - Keep collectible items inside a 3-walled alcove or behind a dirt tile so pulled blocks cannot cover them.
- **Verified Solution**: `EEEESEENSSWWWWEEENWSWWSSSEEEE`

### 4.3 Counterweight Bridge Swap (`counterweight_swap`, Tier 3)
Spend a first boulder to bridge a water moat, then extract a recessed second boulder with grappling gloves to weight the hold plate.

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

- **Legend**: `P` = `floor, start: S`; `G` = `floor, item: boots_pull`; `$` = `floor, entity: dirt_block`; `W` = `water`; `d` = `dirt`; `[` = `pressure_plate_blue`; `]` = `hold_door_blue_closed`; `C` = `floor, item: chip`; `S` = `socket`; `E` = `exit`
- **Design Invariants**:
  - Separate the upper boulder from the grappling gloves with a dirt tile so the upper boulder cannot cover the gloves.
  - The water moat forces the first boulder to be consumed as a bridge, proving the recessed second boulder is required for the plate.
  - Provide a 2-row release pocket on the far side of the lower corridor so the player can step North and get behind the pulled boulder.
- **Verified Solution**: `EEEEWWSSSEEENWSWWSSSEEEE`

---

## 5. Family 3: Prismatic Optics (`optics`)

Laser emitters routed around pillars and across shared chambers through movable diagonal mirrors.

### 5.1 Multi-Prism Beam Slalom (`prism_slalom`, Tier 2)
Route a laser beam around a stone pillar using two movable diagonal mirrors to illuminate a receiver and open its laser gate.

```text
#########
#P...d:C#
#...\.#S#
#>...##E#
#.....###
#..\..R.#
#########
```

- **Legend**: `P` = `floor, start: S`; `>` = `laser_emitter_e`; `\` = `floor, entity: mirror_backslash`; `R` = `laser_receiver_red`; `:` = `laser_gate_red_closed`; `d` = `dirt`; `C` = `floor, item: chip`; `S` = `socket`; `E` = `exit`
- **Design Invariants**:
  - Place a solid wall backstop behind the first mirror's target cell so the unreflected beam never cuts the player's exit route.
  - Stage movable mirrors one cell outside the active beam line so the player pushes them into the beam without stepping onto a live beam cell.
  - Shield the exit corridor with a dirt tile so mirrors cannot be pushed onto the chip or socket.
- **Verified Solution**: `EEEESWNWSNEEEESS`

### 5.2 Recessed Alcove Prism (`grappling_prism`, Tier 3)
Extract a diagonal mirror from a three-walled recess using grappling gloves, release it via a side step, and push it into a laser beam.

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

- **Legend**: `P` = `floor, start: S`; `G` = `floor, item: boots_pull`; `v` = `laser_emitter_s`; `\` = `floor, entity: mirror_backslash`; `R` = `laser_receiver_red`; `:` = `laser_gate_red_closed`; `d` = `dirt`; `C` = `floor, item: chip`; `S` = `socket`; `E` = `exit`
- **Design Invariants**:
  - Confine the live unreflected laser beam to a 1-tile pocket against a wall so the player never crosses the beam while pulling the mirror.
  - Pull the mirror out of the alcove to a safe staging cell, step North into the release pocket, then push the mirror East into the beam.
  - Protect the exit corridor and the grappling gloves alcove with dirt tiles so the mirror cannot cover collectibles.
- **Verified Solution**: `EEEEEEWWSSWWEENWWSEENWSWSSSEEEE`

### 5.3 Crossed Dual-Beam Matrix (`crossed_beams`, Tier 4)
Route two orthogonal laser beams across a shared chamber into red and blue receivers to unlock a dual-stage laser gate vault.

```text
#########
#P...d:;#
#..\.\#C#
#>....#S#
#>....#E#
#..R.B###
#########
```

- **Legend**: `P` = `floor, start: S`; `>` = `laser_emitter_e`; `\` = `floor, entity: mirror_backslash`; `R` = `laser_receiver_red`; `B` = `laser_receiver_blue`; `:` = `laser_gate_red_closed`; `;` = `laser_gate_blue_closed`; `d` = `dirt`; `C` = `floor, item: chip`; `S` = `socket`; `E` = `exit`
- **Design Invariants**:
  - Stage both mirrors one cell North of their beam rows so pushing them South into the beams keeps the player in the safe upper lane.
  - Two laser beams may cross orthogonally on an open floor cell without interfering with each other.
  - Chain laser_gate_red_closed and laser_gate_blue_closed in series so both receivers must remain lit simultaneously.
- **Verified Solution**: `EESNEESSNNEESSS`

---

## 6. Family 4: Kinetic & Cryo Routing (`kinetic`)

Frictionless ice slides, corner deflectors, conveyor currents, and block cloner foundries.

### 6.1 Glacier Slide & Corner Deflector (`glacier_slide`, Tier 2)
Launch a stone boulder across frictionless ice into a curved corner wall so it slides onto a distant pressure plate.

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

- **Legend**: `2` = `ice_ne`; `P` = `floor, start: S`; `$` = `floor, entity: dirt_block`; `I` = `ice`; `[` = `pressure_plate_yellow`; `]` = `hold_door_yellow_closed`; `d` = `dirt`; `C` = `floor, item: chip`; `S` = `socket`; `E` = `exit`
- **Design Invariants**:
  - A block pushed onto ice slides until it hits a non-ice tile, a wall, or a corner deflector.
  - Use ice_ne (deflects E to S and N to W) at the top-right corner of the slide lane so an East-pushed block turns South onto the plate.
  - Place a wall immediately South of the target pressure plate so the sliding block stops on the plate and cannot enter the lower chamber.
- **Verified Solution**: `SESESSSEEEENE`

### 6.2 Current Sluice Conveyor (`conveyor_sluice`, Tier 3)
Push a boulder onto a one-way force current so the stream carries it into a distant water sluice or hold plate.

```text
#########
#P......#
#.$>>>[.#
#.......#
###]#####
###C..SE#
#########
```

- **Legend**: `P` = `floor, start: S`; `$` = `floor, entity: dirt_block`; `>` = `force_e`; `[` = `pressure_plate_green`; `]` = `hold_door_green_closed`; `C` = `floor, item: chip`; `S` = `socket`; `E` = `exit`
- **Design Invariants**:
  - A block pushed onto a force floor slides automatically in the force direction on each tick until it reaches a normal tile.
  - Terminate the force belt directly on a pressure plate or water trench with a wall behind it so the block settles cleanly.
  - Keep the player's approach perpendicular to the belt entry so the player never steps onto the one-way current.
- **Verified Solution**: `SESESSEEEE`

### 6.3 Block Cloner Foundry (`clone_foundry`, Tier 4)
Trigger a red clone button to stamp stone boulders from a clone machine and bridge a multi-tile water channel.

```text
#########
#P+.....#
#.M.....#
###W#####
###d..C##
###...SE#
#########
```

- **Legend**: `P` = `floor, start: S`; `+` = `button_red`; `M` = `clone_machine, entity: dirt_block (E)`; `W` = `water`; `d` = `dirt`; `C` = `floor, item: chip`; `S` = `socket`; `E` = `exit`
- **Design Invariants**:
  - Every clone_machine needs both an explicit cloneLink from a button_red and a template entity placed on the machine cell.
  - Orient the template entity so it spawns into an open push lane where the player can get behind the spawned block.
  - After pushing the first cloned block into water, compact the resulting dirt before spawning and pushing a second block.
- **Verified Solution**: `EESSSEEESE`

---

## 7. Family 5: Network & Logic Sanctuaries (`network`)

Multi-island teleport ferries and dual-chamber boolean signal relays.

### 7.1 Multi-Island Teleport Ferry (`portal_islands`, Tier 3)
Push a boulder through a colour-coded teleport ring to a disconnected island so it lands on a hold plate, then follow through a second portal.

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

- **Legend**: `P` = `floor, start: S`; `$` = `floor, entity: dirt_block`; `O` = `teleport_red`; `o` = `teleport_blue`; `[` = `pressure_plate_red`; `]` = `hold_door_red_closed`; `C` = `floor, item: chip`; `S` = `socket`; `E` = `exit`
- **Design Invariants**:
  - Every teleport group on a level must have at least two teleporters of the same colour to avoid teleport_alone warnings.
  - An entity or player entering a teleporter in direction D exits the destination teleporter one tile in direction D.
  - Seal unused sides of the player's arrival teleporter with walls so a closed hold door on the exit side cannot be bypassed via fallback directions.
- **Verified Solution**: `EESEEESSWWW`

### 7.2 Dual-Chamber Signal Relay (`signal_relay`, Tier 5)
Charge both a signal pressure plate and a laser receiver wired through an AND logic gate to unlock a central vault hold door.

```text
#########
#P$.!..]#
#...\.#C#
#>....#S#
#...R.#E#
##&######
#########
```

- **Legend**: `P` = `floor, start: S`; `$` = `floor, entity: dirt_block`; `!` = `signal_plate`; `&` = `signal_gate_and`; `>` = `laser_emitter_e`; `\` = `floor, entity: mirror_backslash`; `R` = `laser_receiver_red`; `]` = `hold_door_red_closed`; `d` = `dirt`; `C` = `floor, item: chip`; `S` = `socket`; `E` = `exit`
- **Design Invariants**:
  - A signal_gate_and requires two incoming signalLinks from valid sources (signal_plate or laser_receiver_*) and one outgoing link to a sink (hold_door_*_closed).
  - When a hold_door_<color>_closed is driven by a signal link, it ignores standalone pressure plates and opens only when its signal source is high.
  - Stage the mirror one cell North of the emitter beam so pushing it South into the beam keeps the player in the safe upper lane.
- **Verified Solution**: `SEENESWWWNEESEENEESSS`

---

## 8. Family 6: Autonomous Monster & Tank Automata (`automata`)

Sealed pink-ball escapement clocks, bear-trap release gates, and blue-button tank convoys driving remote pressure plates.

### 8.1 Pink-Ball Escapement Clock (`monster_clock`, Tier 2)
Time your passage through a hold door pulsed open by a pink ball bouncing inside a sealed clock chamber.

```text
#########
#P..#o.[#
#...#####
###]#####
###C..SE#
#########
```

- **Legend**: `P` = `floor, start: S`; `o` = `floor, entity: pink_ball (E)`; `[` = `pressure_plate_red`; `]` = `hold_door_red_closed`; `C` = `floor, item: chip`; `S` = `socket`; `E` = `exit`
- **Design Invariants**:
  - A pink_ball moves straight until hitting a wall and reverses 180 degrees without turning into side corridors.
  - Walking monsters press colour pressure plates while standing on them, allowing a sealed chamber to pulse a hold door.
  - Keep the clock track 2 to 3 cells long so the hold door opens at a predictable rhythm without long waits.
- **Verified Solution**: `EES.SSEEEE`

### 8.2 Bear-Trap Escapement Release (`trap_escapement`, Tier 3)
Hold a brown trap button to release a captive tank down a sealed track onto a hold plate.

```text
#########
#P..#T.[#
#.b.#####
###]#####
###C..SE#
#########
```

- **Legend**: `P` = `floor, start: S`; `b` = `button_brown`; `T` = `trap, entity: tank (E)`; `[` = `pressure_plate_red`; `]` = `hold_door_red_closed`; `C` = `floor, item: chip`; `S` = `socket`; `E` = `exit`
- **Design Invariants**:
  - A brown button holds its linked trap open only while an actor stands on the button; wait on the button until the captive monster steps out.
  - A tank released onto a straight track stops against the far wall and holds the terminal pressure plate indefinitely.
  - Every trap holding an entity should have an explicit trapLink from a reachable brown button.
- **Verified Solution**: `SE..E.SSEEEE`

### 8.3 Blue-Button Tank Convoy (`tank_convoy`, Tier 4)
Press a blue tank-reversal button to turn a parked tank 180 degrees and march it onto a sealed hold plate.

```text
#########
#P..#[.t#
#.u.#####
###]#####
###C..SE#
#########
```

- **Legend**: `P` = `floor, start: S`; `u` = `button_blue`; `t` = `floor, entity: tank (E)`; `[` = `pressure_plate_blue`; `]` = `hold_door_blue_closed`; `C` = `floor, item: chip`; `S` = `socket`; `E` = `exit`
- **Design Invariants**:
  - Unlike other monsters, a tank stops completely when facing a wall and reverses direction only when a button_blue is pressed.
  - Start the tank facing a wall at one end of a sealed chamber and place the target pressure plate against the opposite wall.
  - Pressing button_blue an even number of times before the tank reaches the plate reverses it back away from the target.
- **Verified Solution**: `SE..E.SSEEEE`

---

## 9. Family 7: Railroad Switchyards & Transit Networks (`transit`)

Guided railroad tracks, green-button track switches, turning force distributors, and portable pocket-gate pads.

### 9.1 Railroad Switchyard Dispatch (`rail_switchyard`, Tier 3)
Flip a railroad track switch with a green button before releasing a captive tank so it curves onto the eastern spur plate.

```text
#########
#P..#?-[#
#gb.#|###
#...#T###
###]#####
###C..SE#
#########
```

- **Legend**: `P` = `floor, start: S`; `g` = `button_green`; `b` = `button_brown`; `T` = `trap, entity: tank (N)`; `|` = `rail_ns`; `?` = `rail_switch_b`; `-` = `rail_ew`; `[` = `pressure_plate_red`; `]` = `hold_door_red_closed`; `C` = `floor, item: chip`; `S` = `socket`; `E` = `exit`
- **Design Invariants**:
  - A rail_switch_b connects South and West by default and flips to rail_switch_a (South and East) when a button_green is pressed.
  - Always include at least one button_green or signal flip wire on a map with rail switches to avoid rail_switch_no_button validator notes.
  - Forward-moving monsters such as tanks automatically turn to follow the open exit side of each rail piece.
- **Verified Solution**: `SE..ES..SSEEEE`

### 9.2 Turning Force Distributor (`turning_force_distributor`, Tier 3)
Prime the level's shared turning force cycle on a wall-backed pad so the next boulder pushed onto a distributor pad is deflected South onto a hold plate.

```text
#########
#P@#....#
#..#.$@.#
#.....#[#
###]#####
###C..SE#
#########
```

- **Legend**: `P` = `floor, start: S`; `@` = `force_cycle`; `$` = `floor, entity: dirt_block`; `[` = `pressure_plate_green`; `]` = `hold_door_green_closed`; `C` = `floor, item: chip`; `S` = `socket`; `E` = `exit`
- **Design Invariants**:
  - All force_cycle pads on a level share a single global turn counter cycling through E, S, W, N on each actor arrival.
  - Stepping onto a priming force_cycle pad backed by an East wall consumes the initial East push (turn 0) so the next arrival pushes South (turn 1).
  - Place a wall East of the distributor pad so an unprimed boulder push (turn 0, East) stalls instead of reaching the South plate.
- **Verified Solution**: `SESEENEENESWSWWSSEEEE`

### 9.3 Portable Pocket-Gate Shuttle (`pocket_gate_shuttle`, Tier 4)
Collect a portable pocket gate, set it down in a boulder push lane, and teleport a stone boulder into a sealed hold-plate vault.

```text
#########
#Pgd.#o[#
#.d$.####
#.......#
###]#####
###C..SE#
#########
```

- **Legend**: `P` = `floor, start: S`; `g` = `floor, item: pocket_gate`; `o` = `pocket_gate_pad`; `$` = `floor, entity: dirt_block`; `d` = `dirt`; `[` = `pressure_plate_red`; `]` = `hold_door_red_closed`; `C` = `floor, item: chip`; `S` = `socket`; `E` = `exit`
- **Design Invariants**:
  - A level using pocket gates needs at least two total pads (carried pocket_gate items plus placed pocket_gate_pad tiles) to link in the validator.
  - Dropping a pocket_gate (action G) requires plain empty floor under the player and converts that cell into a pocket_gate_pad.
  - Seal the destination pocket_gate_pad on three sides so a block pushed East into the dropped pad exits East onto the pressure plate.
- **Verified Solution**: `EEESGNWWSESSSEEEE`

---

## 10. Family 8: Ballistics, Demolition & Wards (`ballistics`)

Timed blast charges clearing stone barricades, mirror-ricocheted hurl stones disarming bombs, and protective wards against dormant lurkers.

### 10.1 Timed Blast-Charge Breach (`blast_charge_breach`, Tier 3)
Push a boulder onto a one-way green button pocket to open a toggle wall in a laser lane, then detonate a timed blast charge across the wall to vaporize the boulder.

```text
#########
#Pxd..:C#
#..d$.#S#
####+v#E#
#>.+.gR##
#########
```

- **Legend**: `P` = `floor, start: S`; `x` = `floor, item: charge`; `$` = `floor, entity: dirt_block`; `v` = `force_s`; `g` = `button_green`; `+` = `toggle_wall_closed`; `>` = `laser_emitter_e`; `R` = `laser_receiver_red`; `:` = `laser_gate_red_closed`; `d` = `dirt`; `C` = `floor, item: chip`; `S` = `socket`; `E` = `exit`
- **Design Invariants**:
  - A lit charge (action X) detonates after 60 ticks (15 wait steps) and destroys all blocks and monsters in a 3x3 square, even across a 1-tile wall.
  - Place a toggle_wall_closed in the laser row so the beam is blocked until the boulder slides down force_s onto button_green.
  - Retreat at least 2 cells away in X or Y after lighting the charge so the player stands outside the 3x3 blast square.
- **Verified Solution**: `EESENESWSXNWW...............NEEEEESS`

### 10.2 Mirror-Ricochet Hurl Stone (`hurl_stone_ricochet`, Tier 3)
Push a diagonal mirror to the head of a water channel and hurl a stone East so it ricochets 90 degrees South into a bomb guarding the exit chute.

```text
#########
#Phd.\..#
#####.W##
#####>*d#
#######C#
#######S#
#######E#
#########
```

- **Legend**: `P` = `floor, start: S`; `h` = `floor, item: hurl_stone`; `\` = `floor, entity: mirror_backslash`; `W` = `water`; `>` = `force_e`; `*` = `floor, item: bomb`; `d` = `dirt`; `C` = `floor, item: chip`; `S` = `socket`; `E` = `exit`
- **Design Invariants**:
  - A thrown hurl_stone (action T) travels along laser-transparent tiles, reflects off the reflective face of a mirror, and detonates a bomb item on contact.
  - Placing water directly South of the mirror's corner prevents the player from turning South at that cell without drowning, forcing the mirror ricochet.
  - Wait one step after throwing the stone so the projectile reaches and clears the bomb before stepping onto the force_e entry chute.
- **Verified Solution**: `EEEET.SSESSS`

### 10.3 Ward & Dormant Lurker Gambit (`ward_lurker_gambit`, Tier 4)
Wake a sleeping lurker across a thin wall so it steps onto a hold plate, then cross the open hold door and absorb the lurker's contact with a protective ward.

```text
#########
#Pw.|L###
#...][C.#
######SE#
#########
```

- **Legend**: `P` = `floor, start: S`; `w` = `floor, item: ward`; `|` = `thin_wall_e`; `L` = `floor, entity: lurker_dormant (S)`; `[` = `pressure_plate_red`; `]` = `hold_door_red_closed`; `C` = `floor, item: chip`; `S` = `socket`; `E` = `exit`
- **Design Invariants**:
  - Every lurker_dormant and lurker must be placed on plain floor terrain to satisfy the lurker_not_on_floor validator check.
  - A lurker_dormant wakes into a chasing lurker whenever the player ends a step at Manhattan distance 1, even across a thin wall.
  - Equipping a ward absorbs exactly one monster contact, allowing the player to step through the lurker on the hold plate after crossing the hold door.
- **Verified Solution**: `EEEWEWSEEEES`

---

## 11. Family 9: Toggle Parity & Toll Sanctuaries (`parity`)

Dual-channel green and red toggle-wall parity weaves and boot-consuming sluices followed by thief and forbid-boot tolls.

### 11.1 Dual-Channel Toggle Parity Weave (`toggle_parity_weave`, Tier 3)
Alternate green and red toggle buttons to weave a stone boulder through opposite-phase toggle walls and bridge a water moat.

```text
#########
#P.g.r..#
#.$.+.%.#
######W##
######dC#
######SE#
#########
```

- **Legend**: `P` = `floor, start: S`; `g` = `button_green`; `r` = `toggle_button_red`; `+` = `toggle_wall_closed`; `%` = `toggle_wall_red_closed`; `$` = `floor, entity: dirt_block`; `W` = `water`; `d` = `dirt`; `C` = `floor, item: chip`; `S` = `socket`; `E` = `exit`
- **Design Invariants**:
  - Green buttons toggle only green toggle_wall_open / toggle_wall_closed tiles; red toggle buttons toggle only toggle_wall_red_open / toggle_wall_red_closed tiles.
  - Both buttons must be reachable so LevelValidator can open both toggle channels during reachability analysis.
  - Provide a side bypass around the boulder lane so the player can reach the buttons and re-align behind the boulder after each gate opens.
- **Verified Solution**: `EEWWSEEENEWSENEWESSSES`

### 11.2 Fire-Boot Sluice & Thief Toll (`thief_boot_toll`, Tier 3)
Equip fire boots to step onto a fire cell and push a boulder into water, then surrender your boots to a thief so you can pass a forbid-fire-boots toll gate.

```text
#########
#PfdF..T#
###.$...#
####W####
####d####
####!C.S#
#######E#
#########
```

- **Legend**: `P` = `floor, start: S`; `f` = `floor, item: boots_fire`; `F` = `fire`; `T` = `thief`; `!` = `forbid_boots_fire`; `$` = `floor, entity: dirt_block`; `W` = `water`; `d` = `dirt`; `C` = `floor, item: chip`; `S` = `socket`; `E` = `exit`
- **Design Invariants**:
  - Placing fire on the only cell behind the boulder forces the player to collect and wear boots_fire before pushing the boulder into water.
  - A forbid_boots_fire tile blocks entry while the player holds boots_fire, requiring a visit to a thief tile after the boulder push.
  - Keep the thief tile in a side alcove off the main corridor so the player does not accidentally strip boots_fire before pushing the boulder.
- **Verified Solution**: `EEESNEEESWWWSSSEEES`

---

## 12. Chaining & Multi-Room Sanctuary Composition

To build a full 15x15 to 25x25 sanctuary level by chaining archetypes from this encyclopedia:

1. **Hub-and-Wings Layout**: Place a central sanctuary hall containing the final vault gate (`hold_door_*_closed`, `laser_gate_*_closed`, or `socket` + `exit`), flanked by 2 to 4 wing chambers that each house one archetype (`boulder_sluice`, `grappling_alcove`, `prism_slalom`, `rail_switchyard`, `tank_convoy`).
2. **Tool Progression Chain**: Place `boots_pull`, `pocket_gate`, `hurl_stone`, or `charge` as the reward of an early wing, unlocking recessed boulders, remote switches, or barricades in subsequent wings.
3. **Procedural Sanctuary Pieces (`public/configs/motifs.json`)**: 10 Tier-5 `sanctuary_*` pieces (`sanctuary_sluice_double_trench`, `sanctuary_alchemy_fire_water_sluice`, `sanctuary_counterweight_trap_bridge`, `sanctuary_glacier_corner_sluice`, `sanctuary_conveyor_sluice`, `sanctuary_portal_ferry_sluice`, `sanctuary_toggle_parity_sluice`, `sanctuary_thief_fire_sluice`, `sanctuary_tank_reversal_bridge`, `sanctuary_trap_release_sluice`) bring these sanctuary mechanisms directly into procedural packs and Endless mode.
