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
import { MobState, RuleContext, mobAt, neighbour, removeMob, turnClockwise } from './cc3dWorld';
import type { Cc3dMobKind } from './model';

/**
 * Movement preferences of the monsters of P1 (02 section 2.6, all [U]): the
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

/** Tie order of the flee and chase rules: forward, right, left, back (07 section 7.2). */
const TIE_ORDER = [FORWARD, RIGHT, LEFT, BACK];

/** The walker goes straight on; when blocked it draws a random direction [U]. */
function walkerChoice(ctx: RuleContext, mob: MobState): Direction | null {
  if (canMove(ctx, mob, mob.dir)) return mob.dir;
  const drawn = ctx.randomDirection();
  return canMove(ctx, mob, drawn) ? drawn : null;
}

function canMove(ctx: RuleContext, mob: MobState, dir: Direction): boolean {
  const plan = planStep(ctx.world, mob, mob, dir);
  return plan.ok && plan.pushes.length === 0;
}

function distanceToPlayer(ctx: RuleContext, at: { x: number; y: number }): number {
  const { player } = ctx.world;
  return Math.abs(at.x - player.x) + Math.abs(at.y - player.y);
}

/**
 * Snappy flees [U]: among the free directions, one that increases the Manhattan
 * distance to the player's current (claimed) cell, ties in the order forward,
 * right, left, back; otherwise it waits. Nibble chases: the free direction with
 * the smallest distance, same tie order (07 sections 7.2, 7.3, 7.9 item 6).
 */
function distanceChoice(ctx: RuleContext, mob: MobState, flee: boolean): Direction | null {
  const current = distanceToPlayer(ctx, mob);
  let best: Direction | null = null;
  let bestDistance = flee ? current : Number.POSITIVE_INFINITY;
  for (const turns of TIE_ORDER) {
    const dir = turnClockwise(mob.dir, turns);
    if (!canMove(ctx, mob, dir)) continue;
    const distance = distanceToPlayer(ctx, neighbour(mob, dir));
    if (flee ? distance > bestDistance : distance < bestDistance) {
      best = dir;
      bestDistance = distance;
    }
  }
  return best;
}

/** Omni draws a random direction each time it may move; a blocked draw is a wait (the caller charges the slow step) [U]. */
function omniChoice(ctx: RuleContext, mob: MobState): Direction | null {
  const drawn = ctx.randomDirection();
  return canMove(ctx, mob, drawn) ? drawn : null;
}

/** A screamer touching an ice block melts it [U: the block is simply removed]. */
function meltIceAt(ctx: RuleContext, mob: MobState, dir: Direction): boolean {
  if (!MONSTER_TRAITS[mob.kind]?.meltsIce) return false;
  const at = neighbour(mob, dir);
  const block = mobAt(ctx.world, at, mob);
  if (!block || block.kind !== 'block_ice' || block.remaining > 0) return false;
  removeMob(ctx.world, block);
  ctx.emitVisual('splash', at.x, at.y);
  return true;
}

/**
 * The direction a supported monster takes this turn, or null to wait. A monster
 * that melts an ice block uses its turn doing so.
 */
export function chooseMonsterDirection(ctx: RuleContext, mob: MobState): Direction | null {
  if (mob.kind === 'walker') return walkerChoice(ctx, mob);
  if (mob.kind === 'snappy') return distanceChoice(ctx, mob, true);
  if (mob.kind === 'nibble') return distanceChoice(ctx, mob, false);
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
