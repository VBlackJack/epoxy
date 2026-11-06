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
 * Items of the Runeward style: boots, the slow-time item, the bomb, score tokens, stopwatches and the forbidden markers.
 * Every id listed in PENDING keeps the shared drawing until its painter is added to this module;
 * the dispatch in runewardTiles.ts reads the tables and PENDING, so no other file changes.
 */

import type { RunewardItemPainter } from './runewardTiles';

/** Painters by item ids; an id moves here from PENDING when its painter lands. */
export const ITEMS: Readonly<Record<string, RunewardItemPainter>> = {};

/** Ids this module will paint, still drawn by the shared drawing. */
export const PENDING: readonly string[] = [
  'boots_water', 'boots_fire', 'boots_ice', 'boots_force', 'boots_speed', 'boots_eye', 'boots_pull', 'slow_time',
  'bomb', 'score_10', 'score_100', 'score_1000', 'score_2x', 'stopwatch_bonus', 'stopwatch_penalty',
  'forbid_key_red', 'forbid_key_blue', 'forbid_key_yellow', 'forbid_key_green', 'forbid_boots_ice',
  'forbid_boots_water', 'forbid_boots_fire', 'forbid_boots_force'
];
