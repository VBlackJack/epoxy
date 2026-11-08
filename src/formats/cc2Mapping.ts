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

import { CC2_ID_PREFIX } from '../core/coreConstants';

/**
 * Static mapping of CC2 tile codes to Epoxy ids, with the coverage key each one stands for (see
 * src/core/cc2/cc2Coverage.ts). A code maps to an Epoxy id only where the mechanic exists in Epoxy (coverage exact or
 * approx); otherwise it maps to its reserved cc2_* id. Codes that need the modifier, the facing or their neighbours
 * (tracks, gates, directional blocks, thin walls, players, cloners) are handled by the converter itself.
 */
export interface Cc2TileMapping {
  /** Epoxy element id or reserved cc2_* id. */
  id: string;
  /** Coverage key of the CC2 element. */
  key: string;
}

/** Where a mapped id lands in the level: the terrain grid, the item grid or the entity list. */
export type Cc2Slot = 'terrain' | 'item' | 'entity';

function reserved(name: string): Cc2TileMapping {
  return { id: `${CC2_ID_PREFIX}${name}`, key: name };
}

function same(id: string, key: string = id): Cc2TileMapping {
  return { id, key };
}

/** Ids reused by several entries. */
export const FLOOR_ID = 'floor';
export const WALL_ID = 'wall';
export const CLONE_MACHINE_ID = 'clone_machine';
export const TRAP_ID = 'trap';
export const HINT_ID = 'hint';
export const SIGNAL_PLATE_ID = 'signal_plate';
export const TOGGLE_WALL_CLOSED_ID = 'toggle_wall_closed';
export const TOGGLE_WALL_OPEN_ID = 'toggle_wall_open';
export const BUTTON_RED_ID = 'button_red';
export const BUTTON_BROWN_ID = 'button_brown';
export const DIRT_BLOCK_ID = 'dirt_block';
export const UNKNOWN_ID = 'cc2_unknown';
export const BLUE_WALL_FAKE_ID = 'blue_wall_fake';

/** Wired forms of the devices a wire reaches (the unwired ones keep their plain ids above). */
export const WIRED_TRAP: Cc2TileMapping = { id: 'trap_wired', key: 'wired_trap' };
export const WIRED_FLAME_JET_OFF: Cc2TileMapping = { id: 'flame_jet_wired_off', key: 'wired_flame_jet' };
export const WIRED_FLAME_JET_ON: Cc2TileMapping = { id: 'flame_jet_wired_on', key: 'wired_flame_jet' };

/** Coverage keys the converter adds itself. */
export const KEY_TELEPORT_BLUE = 'teleport_blue';
export const KEY_TELEPORT_BLUE_WIRED = 'teleport_blue_wired';

/** Terrain codes: the cell terrain. */
export const TERRAIN_MAP: ReadonlyMap<number, Cc2TileMapping> = new Map<number, Cc2TileMapping>([
  [0x01, same('floor')],
  [0x02, same('wall')],
  [0x03, same('ice')],
  [0x04, same('ice_sw', 'ice_corner')],
  [0x05, same('ice_nw', 'ice_corner')],
  [0x06, same('ice_ne', 'ice_corner')],
  [0x07, same('ice_se', 'ice_corner')],
  [0x08, same('water')],
  [0x09, same('fire')],
  [0x0a, same('force_n', 'force_floor')],
  [0x0b, same('force_e', 'force_floor')],
  [0x0c, same('force_s', 'force_floor')],
  [0x0d, same('force_w', 'force_floor')],
  [0x0e, same('toggle_wall_closed')],
  [0x0f, same('toggle_wall_open')],
  [0x10, same('teleport_red')],
  [0x11, same('teleport_blue')],
  [0x12, same('teleport_yellow')],
  [0x13, same('teleport_green')],
  [0x14, same('exit')],
  [0x15, same('slime')],
  [0x1e, same('gravel')],
  [0x1f, same('button_green')],
  [0x20, same('button_blue')],
  [0x22, same('door_red')],
  [0x23, same('door_blue')],
  [0x24, same('door_yellow')],
  [0x25, same('door_green')],
  [0x2c, same('socket')],
  [0x2d, same('recessed_wall', 'popup_wall')],
  [0x2e, same('appearing_wall')],
  [0x2f, same('invisible_wall')],
  [0x30, same('blue_wall_real')],
  [0x31, same('blue_wall_fake')],
  [0x32, same('dirt')],
  [0x39, same('button_red')],
  [0x3a, same('button_brown')],
  [0x3f, same('thief', 'thief_tools')],
  [0x41, same('trap')],
  [0x42, same('trap')],
  [0x43, same('clone_machine')],
  [0x44, same('clone_machine')],
  [0x45, same('hint')],
  [0x46, same('force_cycle', 'force_floor_random')],
  // The CC2 gray button pulses the wire-capable devices of its 5 x 5 square: not the Epoxy gray button.
  [0x47, same('button_gray_area', 'button_gray')],
  [0x48, same('swivel_door_cc2_sw', 'swivel_door')],
  [0x49, same('swivel_door_cc2_nw', 'swivel_door')],
  [0x4a, same('swivel_door_cc2_ne', 'swivel_door')],
  [0x4b, same('swivel_door_cc2_se', 'swivel_door')],
  [0x4e, same('transmogrifier')],
  [0x50, same('steel_wall')],
  // The CC2 pink button is held: powered while an actor stands on it, which is the Epoxy pressure plate.
  [0x5e, same(SIGNAL_PLATE_ID, 'wire')],
  [0x5f, same('flame_jet_off', 'flame_jet')],
  [0x60, same('flame_jet_on', 'flame_jet')],
  [0x61, same('button_orange')],
  [0x64, same('puppet_control', 'button_yellow')],
  [0x6b, same('floor', 'custom_floor')],
  [0x70, same('wall')],
  [0x71, same('hint', 'letter')],
  [0x72, same('purple_floor')],
  [0x73, same('purple_wall')],
  [0x7d, same('wall', 'green_wall')],
  [0x7e, same('blue_wall_fake', 'green_wall_fake')],
  [0x87, same('black_button')],
  [0x88, same('toggle_switch_off', 'toggle_switch')],
  [0x89, same('toggle_switch_on', 'toggle_switch')],
  [0x8a, same('thief_keys')],
  [0x8d, same('turtle')]
]);

/** Item codes: the cell item. Codes absent here and listed in ITEM_LOST_KEYS have no Epoxy or reserved id. */
export const ITEM_MAP: ReadonlyMap<number, Cc2TileMapping> = new Map<number, Cc2TileMapping>([
  [0x26, same('key_red')],
  [0x27, same('key_blue')],
  [0x28, same('key_yellow')],
  [0x29, same('key_green')],
  [0x2a, same('chip')],
  // The extra chip does not count toward the socket (the converter counts the 0x2A chips only); it plays as a chip.
  [0x2b, same('chip', 'extra_chip')],
  [0x3b, same('boots_ice', 'cleats')],
  [0x3c, same('boots_force', 'suction_boots')],
  [0x3d, same('boots_fire', 'fire_boots')],
  [0x3e, same('boots_water', 'flippers')],
  [0x40, same('bomb')],
  [0x4c, same('stopwatch_bonus', 'time_bonus')],
  [0x4d, same('toggle_clock')],
  [0x51, same('charge', 'dynamite')],
  [0x52, same('ward', 'helmet')],
  [0x59, same('hiking_boots')],
  [0x62, same('lightning_bolt')],
  [0x68, same('hurl_stone', 'bowling_ball')],
  [0x6a, same('stopwatch_penalty', 'time_penalty')],
  [0x6f, reserved('railroad_sign')],
  [0x7a, same('score_10', 'bonus_flag_10')],
  [0x7b, same('score_100', 'bonus_flag_100')],
  [0x7c, same('score_1000', 'bonus_flag_1000')],
  [0x80, same('score_2x', 'bonus_flag_2x')],
  [0x83, same('green_bomb')],
  [0x84, same('green_chip')],
  [0x8c, same('steel_foil')],
  [0x8e, same('boots_eye', 'secret_eye')],
  [0x8f, same('bribe')],
  [0x90, same('boots_speed', 'speed_boots')],
  [0x92, same('boots_pull', 'hook')]
]);

/** Coverage keys of the no-sign (code 0x7F), a layer over the cell that bars the item shown under it. */
export const KEY_NO_SIGN = 'no_sign';
export const KEY_NO_SIGN_EMPTY = 'no_sign_empty';
export const KEY_NO_SIGN_KEY = 'no_sign_key';
export const KEY_NO_SIGN_BOOTS = 'no_sign_boots';
/** A no-sign over an item the player can carry, on the item layer (any item, or a key or boots off plain floor). */
export const KEY_NO_SIGN_ITEM = 'no_sign_item';
/** A no-sign over a bonus, a time item or the toggle clock: nothing can bar it, so the item is dropped and cannot be picked up. */
export const KEY_NO_SIGN_BONUS = 'no_sign_bonus';
/** Terrain ids a no-sign has no meaning on: nobody stands there, so the sign is not placed. */
export const NO_SIGN_BLOCKED_TERRAIN: ReadonlySet<string> = new Set(['wall', 'steel_wall']);
/** Items a no-sign makes impossible to pick up without ever barring anyone: Epoxy drops them. */
export const NO_SIGN_INERT_ITEMS: ReadonlySet<string> = new Set([
  'score_10',
  'score_100',
  'score_1000',
  'score_2x',
  'stopwatch_bonus',
  'stopwatch_penalty',
  'toggle_clock'
]);

/**
 * Epoxy forbid tile that plays a no-sign over an item (by Epoxy item id): the player cannot enter the cell while
 * carrying the item, and the item itself is not placed, so it cannot be picked up.
 */
export const NO_SIGN_FORBID_MAP: ReadonlyMap<string, Cc2TileMapping> = new Map<string, Cc2TileMapping>([
  ['key_red', { id: 'forbid_key_red', key: KEY_NO_SIGN_KEY }],
  ['key_blue', { id: 'forbid_key_blue', key: KEY_NO_SIGN_KEY }],
  ['key_yellow', { id: 'forbid_key_yellow', key: KEY_NO_SIGN_KEY }],
  ['key_green', { id: 'forbid_key_green', key: KEY_NO_SIGN_KEY }],
  ['boots_ice', { id: 'forbid_boots_ice', key: KEY_NO_SIGN_BOOTS }],
  ['boots_water', { id: 'forbid_boots_water', key: KEY_NO_SIGN_BOOTS }],
  ['boots_fire', { id: 'forbid_boots_fire', key: KEY_NO_SIGN_BOOTS }],
  ['boots_force', { id: 'forbid_boots_force', key: KEY_NO_SIGN_BOOTS }]
]);

/** Item codes with no Epoxy and no reserved id: the item is dropped and the key is lost. */
export const ITEM_LOST_KEYS: ReadonlyMap<number, string> = new Map<number, string>();

/** Actor codes that become an Epoxy entity (blocks and monsters). */
export const ENTITY_MAP: ReadonlyMap<number, Cc2TileMapping> = new Map<number, Cc2TileMapping>([
  [0x17, same('dirt_block')],
  [0x18, same('walker')],
  [0x19, same('glider')],
  [0x1a, same('ice_block')],
  [0x21, same('tank')],
  [0x33, same('bug')],
  [0x34, same('paramecium')],
  [0x35, same('pink_ball')],
  [0x36, same('blob')],
  [0x37, same('teeth')],
  [0x38, same('fireball')],
  [0x57, same('timid_teeth')],
  [0x63, same('puppet', 'yellow_tank')],
  [0x69, same('rover')],
  [0x82, same('floor_mimic')],
  [0x8b, same('ghost')]
]);

/** Player actors: Chip, Melinda and their mirror images. */
export const CC2_CODE_MELINDA = 0x56;
/** Coverage key of a level whose only player is Melinda: Epoxy plays it with the melinda character. */
export const KEY_MELINDA_PLAYER = 'melinda_player';
export const CC2_CODE_MIRROR_CHIP = 0x65;
export const CC2_CODE_MIRROR_MELINDA = 0x66;
/** Reserved entities for the players Epoxy does not drive. */
export const RESERVED_PLAYER_ENTITIES: ReadonlyMap<number, Cc2TileMapping> = new Map<number, Cc2TileMapping>([
  [CC2_CODE_MELINDA, reserved('melinda')],
  [CC2_CODE_MIRROR_CHIP, reserved('mirror_chip')],
  [CC2_CODE_MIRROR_MELINDA, reserved('mirror_melinda')]
]);

/** Terrain-coded gender signs: the male sign stops Melinda, the female sign stops Chip (terrain tiles in Epoxy). */
export const GENDER_SIGN_MAP: ReadonlyMap<number, Cc2TileMapping> = new Map<number, Cc2TileMapping>([
  [0x5a, same('sign_chip_only', 'gender_sign_male')],
  [0x5b, same('sign_melinda_only', 'gender_sign_female')]
]);

/** The key of the lost placeholder for a code the table does not know. */
export const UNKNOWN_KEY = 'unknown';

/** Track junction placeholder (terrain). */
export const TRACK_JUNCTION = reserved('track_junction');
/** Reserved ids of the logic gates, kept for packs written before Epoxy played them (the converter no longer places them). */
export const NAND_GATE = reserved('nand_gate');
export const COUNTER_GATE = reserved('counter_gate');
