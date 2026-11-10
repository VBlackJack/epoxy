/*
 * Copyright 2026 Julien Bombled
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { cc3dLinks } from './cc3dLinks';
import { isSupportedMonster } from './cc3dMonsterTraits';
import { CC3D_COLORS, topTerrain } from './model';
import { MAX_TOOLS } from './cc3dConstants';
import type { Cc3dCell, Cc3dColor, Cc3dItemKind, Cc3dLevel, Cc3dTerrain, Cc3dTerrainKind } from './model';

/**
 * Coverage of the CC3D elements by the native Epoxy engine: for one level, which elements Epoxy plays
 * exactly, approximately, or loses. The measuring stick that ranks engine work by the number of maps won.
 */

export type CoverageLevel = 'exact' | 'approx' | 'lost';

export interface CoverageEntry {
  level: CoverageLevel;
  reason: string;
}

export interface LevelCoverage {
  /** The worst level present in the level. */
  verdict: CoverageLevel;
  lost: string[];
  approx: string[];
}

/** Structural keys: properties of a cell rather than of one element. */
export const KEY_STACKED_TERRAIN = 'stacked_terrain';
export const KEY_STACKED_RUNTIME = 'stacked_runtime';
export const KEY_PANELS_ON_NONFLOOR = 'panels_on_nonfloor';
/** The red socket, as the key of one whose layer below is not plain floor (the plain one keeps its kind as key). */
export const KEY_SOCKET_RED = 'socket_red';
export const KEY_SOCKET_RED_STACKED = 'socket_red_stacked';
/** A trap no trap control works, on a map that has trap controls: CC3D keeps it shut, Epoxy opens an unlinked trap with any brown button. */
export const KEY_TRAP_UNWORKED = 'trap_unworked';
/** A level with plain gravel and a reflector: CC3D gravel refuses reflectors, the Epoxy one admits mirrors. */
export const KEY_GRAVEL_WITH_REFLECTOR = 'gravel_with_reflector';
/** More orb items on the map than the four tools CC3D lets the player hold: the oldest drops where Epoxy keeps every pair of boots. */
export const KEY_ORBS_OVER_CAP = 'orbs_over_cap';
/** An appearing wall on a map with a walking monster: the monster that reveals it turns round a step apart from the CC3D one. */
export const KEY_APPEARING_WALL_WITH_MONSTER = 'appearing_wall_with_monster';
/** A clone switch whose nearest machine holds no template Epoxy can clone. */
export const KEY_CLONE_SWITCH_EMPTY = 'clone_switch_empty';
/** A bomb layer in a cell whose item slot is already taken. */
export const KEY_BOMB_WITH_ITEM = 'bomb_with_item';
/** A laser shooter standing on an item or on a layer other than plain floor. */
export const KEY_LASER_SHOOTER_COVERED = 'laser_shooter_covered';

const KEY_SEPARATOR = '_';
const STACK_SEPARATOR = '+';
const MIN_STACKED_ENTRIES = 2;
const PLAIN_FLOOR = 'floor';
/** Terrain kinds whose colour is part of the key. */
const COLOR_KEY_KINDS: readonly string[] = ['plate', 'hold_door', 'toggle_door', 'toggle_control'];
const COLOR_MOB_KIND = 'block_color';

function entry(level: CoverageLevel, reason: string): CoverageEntry {
  return { level, reason };
}

const EXACT_REASON = 'Epoxy plays this element as CC3D does.';
const MONSTER_EVIDENCE =
  ' Measured in cc3dEvidenceMonsters.test.ts against the CC3D engine, state by state, in a maze and at water, fire, slime, dirt, gravel, sand, the exit, the gates, items, turtles, bombs, ice blocks, toggle controls, ice and force floors.';
const MONSTER_PACE_GAP =
  ' What differs without changing the path: entering ice or a force floor is a fast step in CC3D and a normal one in Epoxy, and a monster that reaches the player stands next to him in CC3D and on his cell in Epoxy.';
const ORB_CAP_NOTE =
  'The player holds at most four tools in CC3D (the speed orb is one of them) and a fifth drops the oldest on the cell, where Epoxy keeps every pair of boots (cc3dEvidenceOrbs.test.ts); a map with four orb items or fewer never reaches the cap, and a map with more is the key orbs_over_cap.';
const ORB_ICE_REASON = `Ice and force floors, fire and water behave as in CC3D with the orb in hand or not (cc3dEvidenceOrbs.test.ts). ${ORB_CAP_NOTE}`;
const ORB_FORCE_REASON = ORB_ICE_REASON;
const SLIME_ORBS_NOTE =
  'A player holding the fire and the water orb together is not hurt by slime and cleans it, as in CC3D (slime_3d, cc3dEvidenceTerrain.test.ts, cc3dEvidenceOrbs.test.ts).';
const ORB_FIRE_REASON = `The orb protects from fire and not from water, as in CC3D. ${ORB_CAP_NOTE} ${SLIME_ORBS_NOTE}`;
const ORB_WATER_REASON = `The orb protects from water and not from fire, as in CC3D. ${ORB_CAP_NOTE} ${SLIME_ORBS_NOTE}`;
const ORBS_OVER_CAP_REASON =
  'The map holds more than four orb items (speed included): a CC3D player who picks up a fifth tool drops the oldest on the cell, where Epoxy keeps every pair of boots (cc3dEvidenceOrbs.test.ts).';
const PLATE_REASON =
  'Measured in cc3dEvidenceDevices.test.ts: the plates and hold doors of each colour agree with CC3D for the player, the dirt, ice and colour blocks (a colour block only on its own colour), every plate of the colour needed at once, a door closing on its occupant, and a golem walking over a plate, with the same door changes in the same order. At rest the walker, limpa, limpy, bouncer, omni, snappy, nibble, the baby blinky, the baby screamer, both legs, both golems and the four bots press as in CC3D, and the blinky and the screamer press in neither.';
const BLOCK_GAPS =
  'The dirt block is dirt_block_3d, which refuses fire and items and makes dirt_3d in water, as the CC3D one does.';
const COLOR_BLOCK_REASON =
  'Plates (its own colour only), fire and items (both refused), dirt (entered and cleared, dirt_3d), slime, bombs, gravel, sand, ice, force floors, water (it floats, and no second block is pushed onto it), the open blue gate (it clears it) and the exit behave as in CC3D (cc3dEvidenceBlocks.test.ts, cc3dEvidenceTerrain.test.ts).';
const BLOCK_DIRT_REASON =
  'Epoxy plays the CC3D dirt block as dirt_block_3d. Plates, dirt (entered and cleared, dirt_3d), slime, bombs, gravel, sand, ice, force floors, the open blue gate (it clears it), the exit and the security gates behave as in CC3D. Water makes dirt_3d, which a second block enters and clears, and fire and any item cell refuse the block (cc3dEvidenceBlocks.test.ts, cc3dEvidenceTerrain.test.ts).';
const BLOCK_ICE_REASON =
  'Epoxy plays the CC3D ice block as ice_block_3d. Fire (it melts into water), water (it freezes), slime, bombs, gravel, sand, ice, force floors, plates, the exit and items behave as in CC3D, and so do the rules that set it apart: it slides over dirt without clearing it, over both security gates, pushes a whole chain of blocks (dirt and colour blocks included), and the open blue gate is entered and cleared (cc3dEvidenceBlocks.test.ts, cc3dEvidenceTerrain.test.ts).';
const WATER_REASON =
  'A dirt block makes dirt_3d, an ice block ice and a colour block a bridge the player walks over, and the player drowns unless he holds the water orb, as in CC3D (cc3dEvidenceTerrain.test.ts). A second block pushed onto the dirt_3d enters it and clears it, and is refused onto a floating colour block, as in CC3D. The Epoxy walker and the blue golem refuse water, as the CC3D ones do, and the yellow golem steered into it is lost, as in CC3D (cc3dEvidenceMonsters.test.ts, cc3dEvidenceDevices.test.ts, cc3dEvidenceYellowGolem.test.ts).';
const TURTLE_REASON =
  'The turtle sinks into water behind the player or the block that leaves it, as in CC3D (cc3dEvidenceTerrain.test.ts). The Epoxy walker and both golems cross a turtle and sink it, as the CC3D ones do (cc3dEvidenceMonsters.test.ts, cc3dEvidenceDevices.test.ts, cc3dEvidenceYellowGolem.test.ts).';
const DIRT_REASON =
  'Epoxy plays CC3D dirt as dirt_3d: the player clears it by walking into it, monsters are stopped by it, a block that enters it clears it, and the ice block slides over it without clearing it, as in CC3D (cc3dEvidenceTerrain.test.ts, cc3dEvidenceBlocks.test.ts). Mirrors and turrets are refused, as in CC3D. The dirt a dirt block makes in water is dirt_3d too.';
const SLIME_REASON =
  'Epoxy plays CC3D slime as slime_3d: it kills the player and is cleaned away with any block that enters it, and a player holding the fire and the water orb together survives it and cleans it, as in CC3D (cc3dEvidenceTerrain.test.ts). The Epoxy walker and the blue golem refuse slime, as the CC3D ones do (cc3dEvidenceMonsters.test.ts, cc3dEvidenceDevices.test.ts). The trail an omni leaves is slime_3d too.';
const APPEARING_WALL_REASON =
  'Epoxy plays CC3D appearing wall as appearing_wall_any: the player bumping it and a block pushed into it turn it into a wall, from any side, as in CC3D (cc3dEvidenceTerrain.test.ts). The two differences that remain involve a walking monster, and a map that has one is the key appearing_wall_with_monster.';
const APPEARING_WALL_WITH_MONSTER_REASON =
  'Epoxy plays CC3D appearing wall as appearing_wall_any (cc3dEvidenceTerrain.test.ts), but the map has a walking monster: the monster that reveals it turns round a step apart from the CC3D one afterwards, and the yellow golem, which Epoxy steers rather than lets walk, leaves the wall as it is where the CC3D golem makes it a wall (cc3dEvidenceYellowGolem.test.ts).';
const GATE_TOOLS_REASON =
  'The gate takes every tool of the player who enters it, nothing from an empty-handed one, refuses ordinary blocks and monsters and is slid over by the ice block (ice_block_3d), as in CC3D (cc3dEvidenceTerrain.test.ts).';
const GATE_KEYS_REASON =
  'The gate takes every key of the player who enters it, the green one included, refuses ordinary blocks and is slid over by the ice block (ice_block_3d), as in CC3D (cc3dEvidenceTerrain.test.ts).';
const GOLEM_BLUE_REASON =
  'Epoxy plays the blue golem as a monster of its own: straight on, never turning by itself, stopping at walls and at everything that blocks a monster, turning round at its control, a four-tick step, carried by ice and force floors, refusing water, fire and slime, entering turtles and sinking the one it leaves, pressing plates and switches.' +
  ' Measured in cc3dEvidenceDevices.test.ts against the CC3D engine, state by state, in corridors with each of these, with a second golem, a golem control, an open blue gate and a clone machine. What differs without changing the path: a golem reaching the player stands next to him in CC3D and on his cell in Epoxy, and entering ice or a force floor is a fast step in CC3D and a normal one in Epoxy, and the Epoxy golem makes its first step three ticks after the CC3D one.' +
  ' A golem trying to enter an appearing wall makes it a wall, as in CC3D (appearing_wall_any).';
const SAND_REASON =
  'Epoxy plays CC3D sand as its own sand floor: the player, every block and the yellow golem may enter it, other monsters may not (cc3dEvidenceYellowGolem.test.ts, cc3dEvidenceMonsters.test.ts).';
const SOCKET_RED_REASON = 'Epoxy plays the CC3D red socket as its socket: the player only, open at no chips left, floor once entered.';
const SOCKET_RED_STACKED_REASON = 'CC3D re-plans a red socket against the layer below it, which Epoxy does not model [unverified].';
const FISH_EXTRA_REASON = 'Epoxy plays the extra fish as a chip. The chips needed count the plain fish only, and every fish of either kind lowers the count, as CC3D does [unverified].';
const GRAVEL_REASON = 'Epoxy gravel admits mirrors, where CC3D gravel refuses reflectors (cc3dEvidenceTerrain.test.ts).';
const BOT_REASON =
  'Epoxy plays a bot as a turret: the beam and its turn period are close to CC3D, with a beam length and a period that are guesses, and Epoxy makes no turn at the first step.';
const GOLEM_YELLOW_REASON =
  'Epoxy plays the yellow golem as a monster of its own, steered by the puppet control: it stands still and, each time the player ends a move on a control, takes one step the way he moved, front first along that direction, pushing one block, stopped by walls, dirt, gravel, the exit, the gates, items, monsters and a second block, not carried by ice or force floors (a random force floor does not turn it), walking over sand and turtles (sinking the one it leaves), lost in water, fire, slime and bombs, pressing plates and switches.' +
  ' Measured in cc3dEvidenceYellowGolem.test.ts against the CC3D engine, state by state after each press, in corridors with each of these, with a line of golems, a golem on another row, a clone machine copy, a teleport and a plate, and with a player pressing every 4 to 8 ticks.' +
  ' What differs without changing the path: a CC3D golem walks its cell in four ticks, from a tick after the player settles, where the Epoxy one steps in the tick of the press; a CC3D yellow golem trying to enter an appearing wall makes it a wall, where Epoxy leaves the wall as it is (see the appearing wall).' +
  ` The blocks it pushes carry the gaps of the Epoxy blocks: ${BLOCK_GAPS} The CC3D engine reads some of these rules from play only [unverified].`;
const GOLEM_CONTROL_YELLOW_REASON =
  'Epoxy plays the yellow golem control as the puppet control: only the player works it, and a golem or block entering it does nothing, as in CC3D (cc3dEvidenceYellowGolem.test.ts). The control is the puppet control, so it also steers the Epoxy puppets.';
const LASER_CONTROLLER_REASON =
  'Epoxy plays the laser controller as its shot trigger, linked to the shooters it fires (the nearest shooter in CC3D); any mob works it in CC3D, and Epoxy lets whatever steps on it work it; in Epoxy a trigger hidden under a removable top acts only once revealed [unverified].';
const LASER_SHOOTER_REASON =
  'Epoxy plays the shooter as a shot launcher: a wall-like terrain tile that fires the way it faces, so the terrain under the shooter is flattened; a shot crosses cells at the CC3D pace but its opacity follows Epoxy laser transparency, and the exit differs; the order of the first cell hit differs [unverified].';
const NIBBLE_REASON =
  'Epoxy plays the nibble as a monster of its own: it steps away from the player along the axis of the greater distance (horizontal on a tie), tries the other axis only when not lined up, and waits otherwise, with its rest folded into an eight-tick step.' +
  MONSTER_EVIDENCE +
  MONSTER_PACE_GAP +
  ' The rest rule of the CC3D engine is itself [unverified].';
const TELEPORT_RED_REASON =
  'Epoxy plays the red teleporter as its turning teleporter: the target is the previous red teleporter in reading order, and the exit of the player, a block or a monster is forward, then right, then left, then back, as in CC3D (cc3dEvidenceMovers.test.ts).';
const TELEPORT_BLUE_REASON =
  'Epoxy plays the blue teleporter as its forward teleporter: the target is the previous blue teleporter in reading order, and the exit of the player, a block or a monster is forward only, as in CC3D (cc3dEvidenceMovers.test.ts).';
const FISH_GATE_REASON =
  'Epoxy plays the blue socket as its fish gate: shut while a chip is left, then open to the player, a block or a monster, and the first to enter turns it into floor, as in CC3D (cc3dEvidenceMovers.test.ts).';
const LEGS_PATTERN_GAP =
  ' The real game switches the pattern of the legs with the plates; neither the CC3D engine nor Epoxy models it, both play the base pattern [unverified].';
const LEGS_GREEN_REASON =
  'Epoxy plays the green legs as a monster of their own: the fireball turn order (straight, right, left, back), a four-tick step, no immunity, and they press plates and switches.' +
  MONSTER_EVIDENCE +
  MONSTER_PACE_GAP +
  LEGS_PATTERN_GAP;
const LEGS_RED_REASON =
  'Epoxy plays the red legs as a monster of their own: the glider turn order (straight, left, right, back), a four-tick step, no immunity, and they press plates and switches.' +
  MONSTER_EVIDENCE +
  MONSTER_PACE_GAP +
  LEGS_PATTERN_GAP;
const BOUNCER_REASON =
  'Epoxy plays the bouncer as a monster of its own: straight on, back when blocked, a four-tick step, refusing water, fire and slime, pressing plates and switches.' + MONSTER_EVIDENCE + MONSTER_PACE_GAP;
const BLINKY_REASON =
  'Epoxy plays the blinky as a monster of its own: straight, left, right, back, a four-tick step, immune to water, not carried by ice or force floors, pressing no plate and working no switch, crossing turtles without sinking them.' +
  MONSTER_EVIDENCE +
  MONSTER_PACE_GAP;
const BABY_BLINKY_REASON =
  'Epoxy plays the baby blinky as a monster of its own: straight, left, right, back, a four-tick step, immune to water only, carried by ice and force floors, pressing plates and switches, crossing turtles without sinking them.' +
  MONSTER_EVIDENCE +
  MONSTER_PACE_GAP;
const LIMPY_REASON =
  'Epoxy plays the limpy as a monster of its own: right, straight, left, back, a four-tick step, refusing water, fire and slime, pressing plates and switches.' + MONSTER_EVIDENCE + MONSTER_PACE_GAP;
const LIMPA_REASON =
  'Epoxy plays the limpa as a monster of its own: left, straight, right, back, a four-tick step, refusing water, fire and slime, pressing plates and switches.' + MONSTER_EVIDENCE + MONSTER_PACE_GAP;
const SCREAMER_REASON =
  'Epoxy plays the screamer as a monster of its own: straight, right, left, back, a four-tick step, immune to fire, not carried by ice or force floors, melting the ice blocks it meets (the floor becomes water), pressing no plate and working no switch.' +
  MONSTER_EVIDENCE +
  MONSTER_PACE_GAP;
const BABY_SCREAMER_REASON =
  'Epoxy plays the baby screamer as a monster of its own: straight, right, left, back, a four-tick step, immune to fire only, carried by ice and force floors, melting the ice blocks it meets, pressing plates and switches.' +
  MONSTER_EVIDENCE +
  MONSTER_PACE_GAP;
const SNAPPY_REASON =
  'Epoxy plays the snappy as a monster of its own: it steps towards the player along the axis of the greater distance (horizontal on a tie), tries the other axis only when not lined up, and waits otherwise, with its rest folded into an eight-tick step.' +
  MONSTER_EVIDENCE +
  MONSTER_PACE_GAP +
  ' The rest rule of the CC3D engine is itself [unverified].';
const WALKER_REASON =
  'Epoxy plays the walker as a monster of its own: straight on, and when blocked one draw among the four ways with a blocked draw a wait, a four-tick step, refusing water, fire and slime, pressing plates and switches, crossing turtles and sinking them. Measured in cc3dEvidenceMonsters.test.ts on corridors, where the path is fixed whatever is drawn: the same cells in the same order at water, fire, slime, dirt, gravel, sand, the exit, turtles, bombs and toggle controls. The draws of the two engines come from different random sequences, so a walker in an open room cannot be matched step by step [unverified].';
const OMNI_REASON =
  'Epoxy plays the omni as a monster of its own: it draws one direction at random, waits when the draw is blocked, steps in eight ticks, refuses water and fire, is not hurt by slime and leaves slime on the bare floor it steps out of once it has stood on slime (cc3dEvidenceMonsters.test.ts agrees on a corridor it cannot leave, the trail included). The trail is slime_3d, so a player holding the fire and the water orb together survives it as in CC3D. The draws of the two engines come from different random sequences, so a roaming omni cannot be matched step by step [unverified].';
const TRAP_UNWORKED_REASON =
  'No trap control works this trap, on a map that has trap controls: CC3D keeps it shut, where Epoxy opens an unlinked trap with any brown button (cc3dEvidenceDevices.test.ts). An Epoxy trap link has no empty form, so the converter cannot say "worked by nothing". A map without any trap control has no brown button either, and the trap stays shut in both engines (cc3dEvidenceDevices.test.ts).';
const CLONE_SWITCH_EMPTY_REASON =
  'The nearest clone machine of this switch holds no template Epoxy can clone (none, or a laser shooter): CC3D does nothing, and a switch left unlinked would fire every machine in Epoxy, so the converter drops the switch link.';
const BOMB_WITH_ITEM_REASON =
  'A bomb layer shares its cell with an item: Epoxy holds one item per cell, so the bomb is dropped and the item stays.';
const LASER_SHOOTER_COVERED_REASON =
  'The shooter stands on an item or on a layer other than plain floor (a device, a machine, ground): the Epoxy launcher replaces the whole cell, so what was there is dropped, and a shooter used as a clone template is not cloned.';
const GRAVEL_PLAIN_REASON =
  'Epoxy plays plain gravel as CC3D does: the player and every block may enter it, monsters may not (cc3dEvidenceTerrain.test.ts).';
const BOMB_REASON =
  'Epoxy plays the bomb as CC3D does: it kills the player who steps on it, boots or not, and is spent with any block or monster that enters it (cc3dEvidenceTerrain.test.ts). A monster is drawn on the bomb cell for a step in CC3D before it goes, where the Epoxy one goes as it enters.';
const TRAP_REASON =
  'Epoxy plays the trap as CC3D does: it holds the player or the block that enters it until a control works it, each control works the next trap after it in reading order, wrapping from the last cell to the first, and any of several controls before a trap opens it (cc3dEvidenceDevices.test.ts). A trap no control works is its own key (trap_unworked).';
const TRAP_CONTROL_REASON =
  'Epoxy plays the trap control as CC3D does, linked to the next trap after it in reading order (cc3dEvidenceDevices.test.ts).';
const CLONE_MACHINE_REASON =
  'Epoxy plays the clone machine as CC3D does for a block or a golem as template: the copy leaves in the direction of the machine (the template direction when the machine has none), a new template stays, a blocked exit does nothing, and the player cannot enter the machine (cc3dEvidenceDevices.test.ts). Other monster templates carry the approximation of their monster.';
const CLONE_SWITCH_REASON =
  'Epoxy plays the clone switch as CC3D does: it works the nearest machine, whether the player or a block steps onto it (cc3dEvidenceDevices.test.ts). A switch whose machine holds nothing to clone is its own key (clone_switch_empty).';
const GOLEM_CONTROL_BLUE_REASON =
  'Epoxy plays the blue golem control as CC3D does: every golem turns round when the player, a block or a golem steps onto it (cc3dEvidenceDevices.test.ts). Other monsters stepping onto it were not measured.';
const HOLD_DOOR_REASON = 'Epoxy plays the hold door as CC3D does: all plates of its colour, occupant may leave, nobody may enter.';

const EXACT_KEYS: readonly string[] = [
  'floor', 'wall', 'fire', 'ice', 'ice_corner', 'force', 'force_random', 'exit', 'turtle', 'sand', 'fish_extra', 'socket', KEY_SOCKET_RED, 'push_up_wall', 'false_wall', 'door',
  'fish', 'key', 'appearing_wall', 'orb_ice', 'orb_force', 'orb_fire', 'orb_water', 'toggle_door_green', 'toggle_control_green', 'toggle_door_red', 'toggle_door_blue',
  'toggle_door_yellow', 'toggle_control_red', 'toggle_control_blue', 'toggle_control_yellow',
  // Measured against the CC3D engine by the coverage evidence tests (src/core/cc3d/cc3dEvidence*.test.ts).
  'gravel', 'bomb', 'trap', 'trap_control', 'clone_machine', 'clone_switch', 'golem_control_blue', 'golem_control_yellow', 'teleport_blue', 'teleport_red',
  // Cell edges carry the panels of any terrain, read from both sides as CC3D does.
  KEY_PANELS_ON_NONFLOOR,
  // A stack Epoxy holds exactly: see classifyStack.
  KEY_STACKED_TERRAIN,
  // The CC3D monsters that have an Epoxy monster of their own, measured by cc3dEvidenceMonsters.test.ts.
  'bouncer', 'blinky', 'baby_blinky', 'limpy', 'limpa', 'screamer', 'baby_screamer', 'snappy', 'nibble', 'golem_blue', 'golem_yellow',
  // Format 15 and 16: the CC3D-rule twins (dirt_3d, slime_3d, ice_block_3d, dirt_block_3d), water, the dirt block, the security gates the ice block crosses, and the colour blocks.
  'water', 'block_dirt', 'dirt', 'slime', 'block_ice', 'gate_tools', 'gate_keys', 'block_color_red', 'block_color_green', 'block_color_blue', 'block_color_yellow'
];

/** Exact keys that carry their own reason instead of the generic one. */
const EXACT_REASONS: Readonly<Record<string, string>> = {
  turtle: TURTLE_REASON,
  appearing_wall: APPEARING_WALL_REASON,
  orb_ice: ORB_ICE_REASON,
  orb_force: ORB_FORCE_REASON,
  orb_fire: ORB_FIRE_REASON,
  orb_water: ORB_WATER_REASON,
  force_random:
    'Epoxy plays the CC3D random force floor as the Turning Force Floor: one counter per level, advanced by every arrival of the player, a block or a monster (boots included), pushing east, south, west, north in turn from the start. Epoxy turns every monster on arrival, where the CC3D monsters immune to force are not turned: the blinky, the screamer and the yellow golem are not turned in Epoxy either (cc3dEvidenceMonsters.test.ts, cc3dEvidenceYellowGolem.test.ts).',
  sand: SAND_REASON,
  fish_extra: FISH_EXTRA_REASON,
  socket: FISH_GATE_REASON,
  teleport_blue: TELEPORT_BLUE_REASON,
  teleport_red: TELEPORT_RED_REASON,
  [KEY_SOCKET_RED]: SOCKET_RED_REASON,
  gravel: GRAVEL_PLAIN_REASON,
  bomb: BOMB_REASON,
  trap: TRAP_REASON,
  trap_control: TRAP_CONTROL_REASON,
  clone_machine: CLONE_MACHINE_REASON,
  clone_switch: CLONE_SWITCH_REASON,
  golem_control_blue: GOLEM_CONTROL_BLUE_REASON,
  bouncer: BOUNCER_REASON,
  blinky: BLINKY_REASON,
  baby_blinky: BABY_BLINKY_REASON,
  limpy: LIMPY_REASON,
  limpa: LIMPA_REASON,
  screamer: SCREAMER_REASON,
  baby_screamer: BABY_SCREAMER_REASON,
  snappy: SNAPPY_REASON,
  nibble: NIBBLE_REASON,
  golem_blue: GOLEM_BLUE_REASON,
  golem_yellow: GOLEM_YELLOW_REASON,
  golem_control_yellow: GOLEM_CONTROL_YELLOW_REASON,
  water: WATER_REASON,
  block_dirt: BLOCK_DIRT_REASON,
  dirt: DIRT_REASON,
  slime: SLIME_REASON,
  block_ice: BLOCK_ICE_REASON,
  gate_tools: GATE_TOOLS_REASON,
  gate_keys: GATE_KEYS_REASON,
  block_color_red: COLOR_BLOCK_REASON,
  block_color_green: COLOR_BLOCK_REASON,
  block_color_blue: COLOR_BLOCK_REASON,
  block_color_yellow: COLOR_BLOCK_REASON
};

const APPROX_ENTRIES: Record<string, string> = {
  [KEY_GRAVEL_WITH_REFLECTOR]: GRAVEL_REASON,
  [KEY_SOCKET_RED_STACKED]: SOCKET_RED_STACKED_REASON,
  orb_speed: 'Epoxy slow-time boots slow the monsters only, where the CC3D speed orb also slows the blocks monsters push.',
  [KEY_ORBS_OVER_CAP]: ORBS_OVER_CAP_REASON,
  [KEY_APPEARING_WALL_WITH_MONSTER]: APPEARING_WALL_WITH_MONSTER_REASON,
  plate_red: PLATE_REASON,
  plate_green: PLATE_REASON,
  plate_blue: PLATE_REASON,
  plate_yellow: PLATE_REASON,
  reflector:
    'Epoxy plays a reflector as a one-sided mirror that turns shots and beams from its two reflecting faces and destroys the shot from behind (the converter maps it by its reflecting faces, not by reading the letters: LU to one_sided_mirror_sw, DL to one_sided_mirror_nw, UR to one_sided_mirror_se, RD to one_sided_mirror_ne); the existing Epoxy mirrors are two-faced; bounce timing differs from CC3D.',
  walker: WALKER_REASON,
  legs_green: LEGS_GREEN_REASON,
  legs_red: LEGS_RED_REASON,
  omni: OMNI_REASON,
  bot_static: BOT_REASON,
  bot_cw: BOT_REASON,
  bot_ccw: BOT_REASON,
  bot_multi: BOT_REASON,
  laser_controller: LASER_CONTROLLER_REASON,
  laser_shooter: LASER_SHOOTER_REASON
};

const LOST_ENTRIES: Record<string, string> = {
  [KEY_TRAP_UNWORKED]: TRAP_UNWORKED_REASON,
  [KEY_CLONE_SWITCH_EMPTY]: CLONE_SWITCH_EMPTY_REASON,
  [KEY_BOMB_WITH_ITEM]: BOMB_WITH_ITEM_REASON,
  [KEY_LASER_SHOOTER_COVERED]: LASER_SHOOTER_COVERED_REASON,
  [KEY_STACKED_RUNTIME]:
    'The stack has a layer that acts while covered under a top that is not a door or a socket, or more layers than a removable top and the one it hides, which Epoxy flattens.'
};

/** Coloured elements Epoxy plays as CC3D does, one entry per colour. */
const EXACT_COLORED_GROUPS: ReadonlyArray<{ prefix: string; colors: readonly Cc3dColor[]; reason: string }> = [
  { prefix: 'hold_door', colors: CC3D_COLORS, reason: HOLD_DOOR_REASON }
];

function buildTable(): Record<string, CoverageEntry> {
  const table: Record<string, CoverageEntry> = {};
  for (const key of EXACT_KEYS) table[key] = entry('exact', EXACT_REASONS[key] ?? EXACT_REASON);
  for (const [key, reason] of Object.entries(APPROX_ENTRIES)) table[key] = entry('approx', reason);
  for (const [key, reason] of Object.entries(LOST_ENTRIES)) table[key] = entry('lost', reason);
  for (const group of EXACT_COLORED_GROUPS) {
    for (const color of group.colors) table[`${group.prefix}${KEY_SEPARATOR}${color}`] = entry('exact', group.reason);
  }
  return table;
}

/** Coverage of every element key. */
export const EPOXY_COVERAGE: Readonly<Record<string, CoverageEntry>> = Object.freeze(buildTable());

function withColor(kind: string, color: Cc3dColor | undefined): string {
  if (color === undefined) throw new Error(`CC3D coverage: ${kind} has no colour`);
  return `${kind}${KEY_SEPARATOR}${color}`;
}

function terrainKey(terrain: Cc3dTerrain): string {
  return COLOR_KEY_KINDS.includes(terrain.kind) ? withColor(terrain.kind, terrain.color) : terrain.kind;
}

/**
 * The entries of a cell that are not plain floor, bottom first. A cell stack is [base, devices..., blockers...]
 * (see normalizeCell in model.ts), and the base is plain floor unless the cell is water, fire, ice and so on.
 * Epoxy holds one terrain per cell, so a cell is "stacked" exactly when this list has two or more entries:
 * water+trap, ice+bomb and fire+wall count, [floor, trap] does not (one entry), and [floor, bomb, door] does.
 */
function nonFloorLayers(cell: Cc3dCell): Cc3dTerrain[] {
  return cell.terrain.filter((layer) => layer.kind !== PLAIN_FLOOR);
}

/** Key of one layer of a cell: its kind and colour, except that a red socket stacked on anything but plain floor is its own key. */
function coverageKeyOf(cell: Cc3dCell, layer: Cc3dTerrain, index: number): string {
  if (layer.kind === KEY_SOCKET_RED && cell.terrain[index - 1]?.kind !== PLAIN_FLOOR) return KEY_SOCKET_RED_STACKED;
  return terrainKey(layer);
}

/** Tops the player removes by walking into them: what they hide shows once they are gone (Epoxy underlays). */
const REMOVABLE_TOP_KINDS: readonly Cc3dTerrainKind[] = ['door', 'socket', 'false_wall'];
/** Tops that stay as they are or turn into another blocker: whatever is under them is never seen. */
const PERMANENT_TOP_KINDS: readonly Cc3dTerrainKind[] = ['wall', 'push_up_wall', 'appearing_wall', 'toggle_door', 'hold_door'];
/** Tops a key or the chips open: nothing turns back into them, so Epoxy can hide live devices under them. */
const OPENING_TOP_KINDS: readonly Cc3dTerrainKind[] = ['door', 'socket'];
/**
 * What Epoxy can hide under any removable top and play exactly: ground that only acts when someone stands
 * on it, a wall, or a toggle control (inert until revealed).
 */
const UNDER_KINDS: readonly Cc3dTerrainKind[] = [
  'water', 'fire', 'ice', 'ice_corner', 'force', 'force_random', 'exit', 'slime', 'turtle', 'gravel', 'sand',
  'teleport_blue', 'teleport_red', 'wall', 'toggle_control'
];
/**
 * What Epoxy hides only under a door or a socket (see OPENING_TOP_KINDS): a socket, dirt, a permanent
 * blocker or an appearing wall (shown by the reveal), a laser controller (the shot trigger, working once
 * revealed), and the devices whose state the engine keeps while they are covered (toggle doors through the
 * toggle parity, hold doors and plates through the plates of their colour).
 */
const UNDER_OPENING_TOP_KINDS: readonly Cc3dTerrainKind[] = [
  'socket', 'socket_red', 'dirt', 'push_up_wall', 'appearing_wall', 'laser_controller', 'toggle_door', 'hold_door', 'plate'
];
/** Layers that act on the cell, or on a trap, a clone machine or a door, even while another layer covers them. */
const LIVE_WHILE_COVERED_KINDS: readonly Cc3dTerrainKind[] = [
  'plate', 'trap', 'trap_control', 'clone_machine', 'clone_switch', 'golem_control_blue', 'golem_control_yellow',
  'laser_controller', 'gate_tools', 'gate_keys'
];
const BOMB_KIND: Cc3dTerrainKind = 'bomb';
const SHOOTER_KIND = 'laser_shooter';
const GRAVEL_KIND: Cc3dTerrainKind = 'gravel';
const REFLECTOR_KIND = 'reflector';
const APPEARING_WALL_KIND: Cc3dTerrainKind = 'appearing_wall';
/** The items that take a tool slot of the player (keys and chips do not). */
const ORB_ITEM_KINDS: readonly Cc3dItemKind[] = ['orb_ice', 'orb_force', 'orb_fire', 'orb_water', 'orb_speed'];
/** Tops that are a socket: a socket over another one is one socket, whichever colour. */
const SOCKET_KINDS: readonly Cc3dTerrainKind[] = ['socket', 'socket_red'];

/** How Epoxy holds the terrain stack of one cell. */
export type StackKind = 'plain' | 'flattened' | 'underlay' | 'runtime';

/**
 * Classifies the terrain stack of a cell. A stack is stacked when two or more entries are not plain floor
 * (see nonFloorLayers). A bomb layer becomes the cell's item when the item slot is free. What is left is
 * played exactly when it is
 *  - under a top that is never removed, with nothing live under it: the covered layers are inert, so they
 *    are dropped ('flattened');
 *  - a removable top over exactly one layer Epoxy can hide ('underlay'), the wider set only under a door or a socket.
 * Anything else ('runtime') needs a layer that acts while covered, or a deeper stack, and is lost.
 */
export function classifyStack(cell: Cc3dCell): StackKind {
  let layers = nonFloorLayers(cell);
  if (layers.length < MIN_STACKED_ENTRIES) return 'plain';
  if (cell.item === null && layers.filter((layer) => layer.kind === BOMB_KIND).length === 1) {
    layers = layers.filter((layer) => layer.kind !== BOMB_KIND);
    if (layers.length < MIN_STACKED_ENTRIES) return 'flattened';
  }
  const top = layers[layers.length - 1];
  const below = layers.slice(0, -1);
  // A red socket over a socket of either colour is one socket: the lower one is never seen.
  if (top.kind === KEY_SOCKET_RED && below.length === 1 && SOCKET_KINDS.includes(below[0].kind)) return 'flattened';
  if (PERMANENT_TOP_KINDS.includes(top.kind)) {
    return below.some((layer) => LIVE_WHILE_COVERED_KINDS.includes(layer.kind)) ? 'runtime' : 'flattened';
  }
  if (REMOVABLE_TOP_KINDS.includes(top.kind) && below.length === 1) {
    const hidden = below[0].kind;
    if (UNDER_KINDS.includes(hidden)) return 'underlay';
    if (OPENING_TOP_KINDS.includes(top.kind) && UNDER_OPENING_TOP_KINDS.includes(hidden)) return 'underlay';
  }
  return 'runtime';
}

/** The orb items of a level, speed included: each one takes a tool slot in CC3D. */
function countOrbItems(level: Cc3dLevel): number {
  return level.cells.filter((cell) => cell.item !== null && ORB_ITEM_KINDS.includes(cell.item.kind)).length;
}

/** True when a shooter's cell holds an item or a layer other than plain floor. */
function isShooterCovered(cell: Cc3dCell | undefined): boolean {
  return cell !== undefined && (cell.item !== null || nonFloorLayers(cell).length > 0);
}

/**
 * The keys that come from how elements relate to one another rather than from one element: a trap nobody works,
 * a clone switch with nothing to clone, a bomb sharing its cell with an item, a covered shooter, gravel in a level
 * with a reflector.
 */
function relationKeys(level: Cc3dLevel): string[] {
  const keys: string[] = [];
  const links = cc3dLinks(level);
  const worked = new Set<number>();
  for (const link of links.trapControls) if (link.to !== null) worked.add(link.to);
  const traps = level.cells.flatMap((cell, index) => (cell.terrain.some((layer) => layer.kind === 'trap') ? [index] : []));
  // A map without any trap control has no brown button either: the trap stays shut in both engines.
  if (links.trapControls.length > 0 && traps.some((index) => !worked.has(index))) keys.push(KEY_TRAP_UNWORKED);
  const templates = new Map<number, number | null>(links.cloneMachines.map((link) => [link.from, link.to]));
  const emptySwitch = links.cloneSwitches.some((link) => {
    if (link.to === null) return false;
    const template = templates.get(link.to);
    return template === null || template === undefined || level.mobs[template].kind === SHOOTER_KIND;
  });
  if (emptySwitch) keys.push(KEY_CLONE_SWITCH_EMPTY);
  if (level.cells.some((cell) => cell.item !== null && cell.terrain.some((layer) => layer.kind === BOMB_KIND))) {
    keys.push(KEY_BOMB_WITH_ITEM);
  }
  const shooterCells = new Set<number>();
  let covered = false;
  for (const mob of level.mobs) {
    if (mob.kind !== SHOOTER_KIND) continue;
    const index = mob.y * level.width + mob.x;
    // A second shooter in one cell is dropped by the converter, so it counts as covered too.
    if (shooterCells.has(index) || isShooterCovered(level.cells[index])) covered = true;
    shooterCells.add(index);
  }
  if (covered) keys.push(KEY_LASER_SHOOTER_COVERED);
  // A reflector may be pushed toward any gravel of the level, so the pair is enough to put the difference in play.
  if (level.mobs.some((mob) => mob.kind === REFLECTOR_KIND) && level.cells.some((cell) => cell.terrain.some((layer) => layer.kind === GRAVEL_KIND))) {
    keys.push(KEY_GRAVEL_WITH_REFLECTOR);
  }
  if (countOrbItems(level) > MAX_TOOLS) keys.push(KEY_ORBS_OVER_CAP);
  if (
    level.cells.some((cell) => cell.terrain.some((layer) => layer.kind === APPEARING_WALL_KIND)) &&
    level.mobs.some((mob) => isSupportedMonster(mob.kind))
  ) {
    keys.push(KEY_APPEARING_WALL_WITH_MONSTER);
  }
  return keys;
}

/** The element keys of a level, structural ones included. */
export function elementKeys(level: Cc3dLevel): Set<string> {
  const keys = new Set<string>(relationKeys(level));
  for (const cell of level.cells) {
    cell.terrain.forEach((layer, index) => keys.add(coverageKeyOf(cell, layer, index)));
    if (cell.item) keys.add(cell.item.kind);
    const stack = classifyStack(cell);
    if (stack === 'flattened' || stack === 'underlay') keys.add(KEY_STACKED_TERRAIN);
    if (stack === 'runtime') keys.add(KEY_STACKED_RUNTIME);
    if (cell.panels.length > 0 && topTerrain(cell).kind !== PLAIN_FLOOR) keys.add(KEY_PANELS_ON_NONFLOOR);
  }
  for (const mob of level.mobs) keys.add(mob.kind === COLOR_MOB_KIND ? withColor(mob.kind, mob.color) : mob.kind);
  return keys;
}

/** Classifies a level; throws on a key the table does not know. */
export function classifyLevel(level: Cc3dLevel): LevelCoverage {
  const lostKeys: string[] = [];
  const approxKeys: string[] = [];
  for (const key of [...elementKeys(level)].sort()) {
    const found = EPOXY_COVERAGE[key];
    if (!found) throw new Error(`CC3D coverage: no entry for ${key}`);
    if (found.level === 'lost') lostKeys.push(key);
    else if (found.level === 'approx') approxKeys.push(key);
  }
  const verdict: CoverageLevel = lostKeys.length > 0 ? 'lost' : approxKeys.length > 0 ? 'approx' : 'exact';
  return { verdict, lost: lostKeys, approx: approxKeys };
}

/** Counts, over stacked cells (see nonFloorLayers), the stack "base+device+blocker" bottom to top, base kind included, with colours. */
export function stackedPairs(level: Cc3dLevel): Map<string, number> {
  const counts = new Map<string, number>();
  for (const cell of level.cells) {
    const above = nonFloorLayers(cell);
    if (above.length < MIN_STACKED_ENTRIES) continue;
    const key = above.map(terrainKey).join(STACK_SEPARATOR);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}
