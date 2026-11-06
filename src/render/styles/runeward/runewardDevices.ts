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
 * Mechanisms of the Runeward style: thin walls, swivel doors, turn plates, machines, flame jets, lasers, shot launchers, the puppet control and turrets.
 * Every id listed in PENDING keeps the shared drawing until its painter is added to this module;
 * the dispatch in runewardTiles.ts reads the tables and PENDING, so no other file changes.
 */

import type { RunewardEntityPainter, RunewardTilePainter } from './runewardTiles';

/** Painters by tile ids; an id moves here from PENDING when its painter lands. */
export const TILES: Readonly<Record<string, RunewardTilePainter>> = {};

/** Painters by entity type; an id moves here from PENDING when its painter lands. */
export const ENTITIES: Readonly<Record<string, RunewardEntityPainter>> = {};

/** Ids this module will paint, still drawn by the shared drawing. */
export const PENDING: readonly string[] = [
  'thin_wall_n', 'thin_wall_e', 'thin_wall_s', 'thin_wall_w', 'thin_wall_se', 'thin_wall_ne',
  'thin_wall_nw', 'thin_wall_sw', 'thin_wall_ns', 'thin_wall_ew', 'thin_wall_nes', 'thin_wall_new',
  'thin_wall_nsw', 'thin_wall_esw', 'thin_wall_nesw', 'swivel_door_ne', 'swivel_door_se',
  'swivel_door_sw', 'swivel_door_nw', 'turn_plate_cw', 'turn_plate_ccw', 'transmogrifier',
  'clone_machine', 'flame_jet_off', 'flame_jet_on', 'laser_emitter_n', 'laser_emitter_e',
  'laser_emitter_s', 'laser_emitter_w', 'laser_receiver_red', 'laser_receiver_blue',
  'laser_gate_red_open', 'laser_gate_red_closed', 'laser_gate_blue_open', 'laser_gate_blue_closed',
  'shot_launcher_n', 'shot_launcher_e', 'shot_launcher_s', 'shot_launcher_w', 'shot_trigger',
  'puppet_control', 'turret_fixed', 'turret_cw', 'turret_ccw', 'turret_multi'
];
