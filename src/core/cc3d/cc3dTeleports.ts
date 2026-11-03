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
import { SFX } from './cc3dConstants';
import { teleportCandidatesBefore, teleportCells } from './cc3dLinks';
import { planStep } from './cc3dMovement';
import { Actor, Cell, RuleContext, cellAt, isPlayerAt, mobAt, moveActor, turnClockwise } from './cc3dWorld';

/**
 * Teleports, red and blue. Isolated on purpose, so it can be replaced as a whole.
 * Observed in play (05 session 3, 08 section 8.7): on blue, the mover goes to the
 * PREVIOUS teleport of the colour in reading order, the first sending it to the
 * last [P]; red follows the same order [U]. Red leaves in the first free
 * direction: its own, then right [observed], then left and back [U]. Blue leaves
 * only in its own direction [U beyond the observed case], and tries the teleport
 * before when that way is blocked [U].
 */

export type TeleportKind = 'teleport_red' | 'teleport_blue';

/** Quarter turns clockwise from the mover's facing. */
const FORWARD = 0;
const RIGHT = 1;
const BACK = 2;
const LEFT = 3;
const RED_EXIT_TURNS = [FORWARD, RIGHT, LEFT, BACK];
const BLUE_EXIT_TURNS = [FORWARD];

function exitOrder(kind: TeleportKind, facing: Direction): Direction[] {
  const turns = kind === 'teleport_red' ? RED_EXIT_TURNS : BLUE_EXIT_TURNS;
  return turns.map((t) => turnClockwise(facing, t));
}

/**
 * The other teleports of the kind, the previous one in reading order first, then the ones before it, wrapping
 * from the first to the last [P blue, 05 session 3 and 08 section 8.7; red follows blue, U].
 */
export function candidatesBefore(ctx: RuleContext, entered: Cell, kind: TeleportKind): Cell[] {
  const { world } = ctx;
  const toCell = (index: number): Cell => ({ x: index % world.width, y: Math.floor(index / world.width) });
  const origin = entered.y * world.width + entered.x;
  return teleportCandidatesBefore(teleportCells(world.cells, kind), origin).map(toCell);
}

function isFree(ctx: RuleContext, actor: Actor, at: Cell): boolean {
  return mobAt(ctx.world, at, actor) === undefined && (actor.kind === 'player' || !isPlayerAt(ctx.world, at));
}

function firstOpenExit(ctx: RuleContext, actor: Actor, at: Cell, kind: TeleportKind): Direction | null {
  for (const dir of exitOrder(kind, actor.dir)) {
    const plan = planStep(ctx.world, actor, at, dir);
    if (plan.ok && plan.pushes.length === 0 && plan.hits === null && !plan.hitsPlayer && plan.shot === null && plan.crushes === null) return dir;
  }
  return null;
}

/** Called when an actor has arrived on a teleport: moves it to another one when one is usable. */
export function teleportOnArrival(ctx: RuleContext, actor: Actor, kind: TeleportKind): void {
  const origin: Cell = { x: actor.x, y: actor.y };
  for (const target of candidatesBefore(ctx, origin, kind)) {
    if (!cellAt(ctx.world, target.x, target.y) || !isFree(ctx, actor, target)) continue;
    const exit = firstOpenExit(ctx, actor, target, kind);
    if (exit === null) continue;
    ctx.emitVisual('teleport', origin.x, origin.y);
    moveActor(ctx.world, actor, target.x, target.y);
    actor.drift = null;
    actor.exitDir = exit;
    ctx.emitVisual('teleport', target.x, target.y);
    ctx.playSfx(SFX.teleport);
    return;
  }
}
