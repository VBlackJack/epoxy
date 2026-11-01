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

import { Direction } from '../types';

/** Progress units in one step from a cell to the next. */
export const STEP_UNITS = 8;
/** Units a creature covers per tick at normal speed (a step takes 4 ticks). */
export const NORMAL_UNITS_PER_TICK = 2;
/** Factor applied to the speed on ice and force floors. */
export const FAST_FLOOR_SPEED_FACTOR = 2;

/** Chip always starts a Lynx level facing south. */
export const CHIP_START_FACING: Direction = 'S';
/** The tick number at which forced moves begin (never in tick 0). */
export const FIRST_FORCED_TICK = 1;

/** Remains last this many ticks when death tick plus phase offset is even; one more when odd. */
export const REMAINS_BASE_TICKS = 11;
/** The phase offset is an integer from 0 to this value. */
export const MAX_PHASE_OFFSET = 7;

/** Key counts wrap around at this modulus (a byte). */
export const KEY_COUNT_MODULUS = 256;

/** Walker generator: both state registers are bytes. */
export const BYTE_MODULUS = 256;
export const BYTE_HIGH_BIT = 128;
export const WALKER_SHIFT_BIT = 2;
export const WALKER_QUARTER_DIVISOR = 4;
/** Main generator (blobs): the linear congruential parameters. */
export const MAIN_MULTIPLIER = 1103515245;
export const MAIN_INCREMENT = 12345;
export const MAIN_MASK = 0x7fffffff;
export const MAIN_DIRECTION_SHIFT = 29;
export const MAIN_SEED_MODULUS = 0x80000000;

/** Ids of the tiles the core rules name. */
export const TILE = {
  floor: 'floor',
  wall: 'wall',
  dirt: 'dirt',
  gravel: 'gravel',
  fire: 'fire',
  invisibleWall: 'invisible_wall',
  thinWallPrefix: 'thin_wall_',
  water: 'water',
  hint: 'hint',
  bomb: 'bomb',
  chip: 'chip',
  keyBlue: 'key_blue',
  keyRed: 'key_red',
  keyGreen: 'key_green',
  keyPrefix: 'key_',
  doorPrefix: 'door_',
  bootsWater: 'boots_water',
  bootsFire: 'boots_fire',
  exit: 'exit',
  socket: 'socket'
} as const;

/** Ids of the entities the core rules name. */
export const ENTITY = {
  block: 'dirt_block',
  fireball: 'fireball'
} as const;

/** Sound effect ids (audio.json). */
export const SFX = {
  blocked: 'blocked',
  chip: 'chip',
  item: 'item',
  door: 'door',
  socket: 'socket',
  button: 'button',
  teleport: 'teleport',
  thief: 'thief',
  splash: 'splash',
  burn: 'burn',
  bomb: 'bomb',
  death: 'death',
  win: 'win',
  step: 'step'
} as const;

/** Colour keys of visual events. */
export const COLOR = {
  chip: 'green',
  boots: 'blue',
  socket: 'yellow',
  chipDeath: 'red',
  fallbackKey: 'yellow'
} as const;

/** Death reason i18n keys shown by the page. */
export const DEATH_KEY = {
  water: 'hud.messages.death_water',
  fire: 'hud.messages.death_fire',
  bomb: 'hud.messages.death_bomb',
  monster: 'hud.messages.death_monster',
  block: 'hud.messages.death_block',
  time: 'hud.messages.death_time'
} as const;

/** Slot index of Chip in the creature list: he is always first. */
export const CHIP_PLACE = 0;
/** First place that a new creature may take (Chip owns the first). */
export const FIRST_SPARE_PLACE = 1;
