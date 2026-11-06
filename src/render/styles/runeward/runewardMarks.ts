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
 * Floor marks and small creatures of the Runeward style: gravel, dirt, hints, recessed walls, block targets, slime, turtles, thieves, floating blocks, buttons and the signal tiles.
 * Every id listed in PENDING keeps the shared drawing until its painter is added to this module;
 * the dispatch in runewardTiles.ts reads the tables and PENDING, so no other file changes.
 */

import type { RunewardTilePainter } from './runewardTiles';

/** Painters by tile ids; an id moves here from PENDING when its painter lands. */
export const TILES: Readonly<Record<string, RunewardTilePainter>> = {};

/** Ids this module will paint, still drawn by the shared drawing. */
export const PENDING: readonly string[] = [
  'gravel', 'dirt', 'hint', 'recessed_wall', 'block_target', 'slime', 'turtle', 'thief', 'thief_keys',
  'floating_block_red', 'floating_block_green', 'floating_block_blue', 'floating_block_yellow',
  'button_orange', 'button_gray', 'signal_plate', 'signal_gate_and', 'signal_gate_or',
  'signal_gate_not', 'signal_gate_xor', 'signal_latch_off', 'signal_latch_on'
];
