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

import type { Direction } from '../types';
import { MONSTER_TRAITS } from './cc3dMonsterTraits';
import { planStep } from './cc3dMovement';
import { MobState, RuleContext, meltIceBlock, mobAt, neighbour, opposite, turnClockwise } from './cc3dWorld';
import type { Cc3dMobKind } from './model';

/**
 * Movement preferences of the monsters (02 section 2.6, all [U]): the
 * quarter turns clockwise from the current facing, tried in order; the first
 * direction the monster can enter is taken. Monsters walk at normal speed.
 */

const FORWARD = 0;
const RIGHT = 1;
const BACK = 2;
const LEFT = 3;

const PREFERENCES: Partial<Record<Cc3dMobKind, readonly number[]>> = {
  blinky: [FORWARD, LEFT, RIGHT, BACK],
  baby_blinky: [FORWARD, LEFT, RIGHT, BACK],
  limpa: [LEFT, FORWARD, RIGHT, BACK],
  limpy: [RIGHT, FORWARD, LEFT, BACK],
  bouncer: [FORWARD, BACK],
  screamer: [FORWARD, RIGHT, LEFT, BACK],
  baby_screamer: [FORWARD, RIGHT, LEFT, BACK],
  golem_blue: [FORWARD],
  // Plate-driven switching of the pattern is an open play question (07 section 7.5): base patterns only.
  legs_green: [FORWARD, RIGHT, LEFT, BACK],
  legs_red: [FORWARD, LEFT, RIGHT, BACK]
};

/** The walker goes straight on; when blocked it draws a random direction [U]. */
function walkerChoice(ctx: RuleContext, mob: MobState): Direction | null {
  if (canMove(ctx, mob, mob.dir)) return mob.dir;
  const drawn = ctx.randomDirection();
  return canMove(ctx, mob, drawn) ? drawn : null;
}

function canMove(ctx: RuleContext, mob: MobState, dir: Direction): boolean {
  const plan = planStep(ctx.world, mob, mob, dir);
  // An appearing wall looks like floor: a monster that tries to enter it reveals it (the step is then refused) [S, 10 item 16].
  return (plan.ok && plan.pushes.length === 0 && plan.shot === null) || plan.bump !== null;
}

/**
 * Snappy chases and Nibble flees [P colours, S ids; 10.1 item 1]. With (dx, dy) from the monster to the player's
 * claimed cell, the primary axis is x when |dx| >= |dy| (ties: horizontal first), else y. It steps towards (Snappy)
 * or away from (Nibble) the player along it; when blocked it tries the other axis only if it is not aligned with
 * the player on a row or a column; otherwise it waits.
 */
function axisChoice(ctx: RuleContext, mob: MobState, flee: boolean): Direction | null {
  const { player } = ctx.world;
  const dx = player.x - mob.x;
  const dy = player.y - mob.y;
  if (dx === 0 && dy === 0) return null;
  const horizontalFirst = Math.abs(dx) >= Math.abs(dy);
  const along = (horizontal: boolean): Direction => {
    const towards: Direction = horizontal ? (dx > 0 ? 'E' : 'W') : dy > 0 ? 'S' : 'N';
    return flee ? opposite(towards) : towards;
  };
  const first = along(horizontalFirst);
  if (canMove(ctx, mob, first)) return first;
  if (dx !== 0 && dy !== 0) {
    const second = along(!horizontalFirst);
    if (canMove(ctx, mob, second)) return second;
  }
  return null;
}

/** Omni draws a random direction each time it may move; a blocked draw is a wait (the caller charges the slow step) [U]. */
function omniChoice(ctx: RuleContext, mob: MobState): Direction | null {
  const drawn = ctx.randomDirection();
  return canMove(ctx, mob, drawn) ? drawn : null;
}

/** A screamer (adult or baby) trying to enter a cell holding an ice block removes it, the floor becomes water, and the screamer does not move [S, 10.1 item 5]. */
function meltIceAt(ctx: RuleContext, mob: MobState, dir: Direction): boolean {
  if (!MONSTER_TRAITS[mob.kind]?.meltsIce) return false;
  const at = neighbour(mob, dir);
  const block = mobAt(ctx.world, at, mob);
  if (!block || block.kind !== 'block_ice' || block.remaining > 0) return false;
  meltIceBlock(ctx.world, block);
  ctx.emitVisual('splash', at.x, at.y);
  return true;
}

/**
 * The direction a supported monster takes this turn, or null to wait. A monster
 * that melts an ice block uses its turn doing so.
 */
export function chooseMonsterDirection(ctx: RuleContext, mob: MobState): Direction | null {
  if (mob.kind === 'walker') return walkerChoice(ctx, mob);
  if (mob.kind === 'snappy') return axisChoice(ctx, mob, false);
  if (mob.kind === 'nibble') return axisChoice(ctx, mob, true);
  if (mob.kind === 'omni') return omniChoice(ctx, mob);
  const order = PREFERENCES[mob.kind];
  if (!order) return null;
  for (const turns of order) {
    const dir = turnClockwise(mob.dir, turns);
    if (meltIceAt(ctx, mob, dir)) return null;
    if (canMove(ctx, mob, dir)) return dir;
  }
  return null;
}
