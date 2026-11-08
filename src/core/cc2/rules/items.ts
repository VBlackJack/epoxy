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

import { ConfigRegistry } from '../../../config/ConfigRegistry';
import { COLOR, SFX } from '../../lynx/lynxConstants';
import { ArrivalEffect, RuleModule, TileRule } from '../../lynx/ruleApi';
import { ADMISSION } from '../../lynx/tileRules';

/** Tile ids of the CC2 items and walls that need no more than a pickup or a wall. */
const STEEL_WALL = 'steel_wall';
const SCORE_ITEMS: readonly string[] = ['score_10', 'score_100', 'score_1000', 'score_2x'];
const STOPWATCH_ITEMS: readonly string[] = ['stopwatch_bonus', 'stopwatch_penalty'];
/** Chip does not need the hiking boots (only Melinda does); they are a plain pickup. */
const HIKING_BOOTS = 'hiking_boots';
/** A level with no time limit has none to extend. */
const NO_TIME_LIMIT = 0;
/** A stopwatch never takes a timed level below one second. */
const MIN_TIME_LIMIT_SECONDS = 1;

/** Picked up by Chip alone: the item leaves the cell, and a stopwatch moves the time limit of the level. */
const pickUp: ArrivalEffect = (ctx, chip) => {
  const seconds = ConfigRegistry.getTile(ctx.tileIdAt(chip.x, chip.y)).timeBonusSeconds ?? 0;
  if (seconds !== 0 && ctx.level.timeLimitSeconds > NO_TIME_LIMIT) {
    ctx.level.timeLimitSeconds = Math.max(MIN_TIME_LIMIT_SECONDS, ctx.level.timeLimitSeconds + seconds);
  }
  ctx.setItem(chip.x, chip.y, null);
  ctx.emitVisual('item', chip.x, chip.y, COLOR.fallbackKey);
  ctx.playSfx(SFX.item);
};

const pickupRule: TileRule = { admits: ADMISSION.chipOnly, arrival: { chip: pickUp } };

/**
 * The steel wall and the pickups that do not move a creature. A stopwatch
 * extends (or cuts) the time limit of the level, so the engine that runs this
 * module must own a copy of the level (createCc2Engine does). Scores are not
 * applied: the Lynx world has no score a module may change, and a replay is won
 * or lost by the board.
 */
export const itemRules: RuleModule = {
  name: 'cc2Items',
  tiles: {
    [STEEL_WALL]: { admits: ADMISSION.nobody },
    ...Object.fromEntries([...SCORE_ITEMS, ...STOPWATCH_ITEMS, HIKING_BOOTS].map((id) => [id, pickupRule]))
  }
};
