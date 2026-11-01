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

import { Direction } from '../../types';
import { neighbour, turnClockwise } from '../directions';
import { Creature } from '../model';
import { RuleContext, RuleModule } from '../ruleApi';

/** Quarter turns in a full circle: the walker draw is reduced to this many values. */
const QUARTER_TURNS_PER_CIRCLE = 4;
/** A blob covers one unit per tick: a step takes 8 ticks (spec 2). */
const BLOB_UNITS_PER_TICK = 1;

/** Takes the cell of a decided step: remains there are erased even if the step later fails. */
function settleOn(ctx: RuleContext, monster: Creature, dir: Direction): Direction {
  if (ctx.canStep(monster, dir)) {
    const target = neighbour(monster, dir);
    ctx.eraseRemainsAt(target.x, target.y);
  }
  return dir;
}

/**
 * Walker (spec 10, 14.1): forward when it may. Only when forward is refused does
 * it draw once from the walker generator, turn that many quarter turns
 * clockwise, and try that direction once.
 */
function decideWalker(ctx: RuleContext, walker: Creature): Direction {
  if (ctx.canStep(walker, walker.dir)) return settleOn(ctx, walker, walker.dir);
  const turns = ctx.drawWalker() % QUARTER_TURNS_PER_CIRCLE;
  return settleOn(ctx, walker, turnClockwise(walker.dir, turns));
}

/** Blob (spec 10, 14.2): one absolute direction from the main generator, tried once. */
function decideBlob(ctx: RuleContext, blob: Creature): Direction {
  return settleOn(ctx, blob, ctx.drawMainDirection());
}

/** Walker and blob: the monsters that draw random numbers. Traps and forced moves are handled by the core. */
export const walkerBlobRules: RuleModule = {
  name: 'walkerBlob',
  monsters: {
    walker: { decide: decideWalker },
    blob: { unitsPerTick: BLOB_UNITS_PER_TICK, decide: decideBlob }
  }
};
