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

/**
 * Names of the retro sprites the renderer composes, in one place. The sprite sheets and
 * RETRO_SPRITE_NAMES must define every name here; a test checks both ways, so renaming a sprite
 * on one side only fails the build.
 */

/** Single sprites by role. */
export const RETRO_SPRITE = {
  floor: 'floor',
  dirtBlock: 'dirt_block',
  wallTop: 'wall_top',
  wallFront: 'wall_front',
  wallRimN: 'wall_rim_n',
  wallRimW: 'wall_rim_w',
  wallRimE: 'wall_rim_e',
  blueWall: 'blue_wall',
  blueWallFakeMarker: 'blue_wall_fake_marker',
  trapOpen: 'trap_open',
  trapClosed: 'trap_closed',
  forbidSign: 'forbid_sign',
  flameJetNozzle: 'flame_jet_nozzle',
  turtle: 'turtle',
  door: 'door',
  button: 'button',
  key: 'key',
  boots: 'boots',
  gloves: 'gloves',
  flag: 'flag',
  blockOnTarget: 'block_on_target',
  lurkerTell: 'lurker_tell',
  laserReceiver: 'laser_receiver',
  laserGateClosed: 'laser_gate_closed',
  laserGateOpen: 'laser_gate_open',
  playerDead: 'player_dead'
} as const;

/** Prefixes of numbered or lettered sprite families. */
export const RETRO_SPRITE_PREFIX = {
  floorDetail: 'floor_detail_',
  arrowMark: 'arrow_mark_',
  thin: 'thin_',
  water: 'water_',
  fire: 'fire_',
  exit: 'exit_',
  teleport: 'teleport_',
  digit: 'digit_',
  char: 'char_',
  playerSwim: 'player_swim_',
  player: 'player_'
} as const;

/** Editor markers drawn over the floor of a hidden wall, by tile id. */
export const RETRO_HIDDEN_WALL_MARKERS: Readonly<Record<string, string>> = {
  invisible_wall: 'hidden_wall_marker',
  appearing_wall: 'appearing_wall_marker'
};

/** Signal tiles: a sprite of the same name, and the lit overlay drawn over it while the tile is powered. */
export const RETRO_SIGNAL_TILES: readonly string[] = [
  'signal_plate',
  'signal_button',
  'signal_gate_and',
  'signal_gate_or',
  'signal_gate_not',
  'signal_gate_xor',
  'signal_latch_off',
  'signal_latch_on'
];

/** Suffix of the overlay sprite of a powered signal tile. */
export const RETRO_SIGNAL_LIT_SUFFIX = '_lit';

/** Tiles drawn as the sprite of the same name over the floor. */
export const RETRO_PLAIN_OVERLAY_TILES: readonly string[] = [
  'recessed_wall',
  'dirt',
  'slime',
  'gravel',
  'socket',
  'hint',
  'thief',
  'thief_keys',
  'clone_machine',
  'transmogrifier',
  'turn_plate_cw',
  'turn_plate_ccw',
  'pocket_gate_pad',
  'block_target',
  'toggle_wall_closed',
  'toggle_wall_open',
  'ice',
  'ice_nw',
  'ice_ne',
  'ice_sw',
  'ice_se',
  'laser_emitter_n',
  'laser_emitter_e',
  'laser_emitter_s',
  'laser_emitter_w'
];
