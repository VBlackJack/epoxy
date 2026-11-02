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
import { planStep } from './cc3dMovement';
import { Actor, Cell, RuleContext, cellAt, isPlayerAt, mobAt, moveActor, turnClockwise } from './cc3dWorld';

/**
 * Teleports, red and blue. Isolated on purpose: their real behaviour is
 * unresolved (05, teleports are inconclusive), so this follows 02 section 2.3
 * as written [U] and can be replaced as a whole.
 *
 * Red: the mover goes to another red teleport (reading order, starting after
 * the one it entered) and leaves in the first free direction, its own first,
 * then right, left, back. Blue: it leaves only in its own direction, and tries
 * the next blue teleport when that way is blocked.
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

/** The other teleports of the kind, in reading order starting after `entered`, wrapping around. */
function candidatesAfter(ctx: RuleContext, entered: Cell, kind: TeleportKind): Cell[] {
  const { world } = ctx;
  const all: Cell[] = [];
  world.cells.forEach((cell, index) => {
    if (cell.terrain[cell.terrain.length - 1].kind === kind) {
      all.push({ x: index % world.width, y: Math.floor(index / world.width) });
    }
  });
  const here = all.findIndex((c) => c.x === entered.x && c.y === entered.y);
  const rotated = [...all.slice(here + 1), ...all.slice(0, Math.max(here, 0))];
  return rotated.filter((c) => c.x !== entered.x || c.y !== entered.y);
}

function isFree(ctx: RuleContext, actor: Actor, at: Cell): boolean {
  return mobAt(ctx.world, at, actor) === undefined && (actor.kind === 'player' || !isPlayerAt(ctx.world, at));
}

function firstOpenExit(ctx: RuleContext, actor: Actor, at: Cell, kind: TeleportKind): Direction | null {
  for (const dir of exitOrder(kind, actor.dir)) {
    const plan = planStep(ctx.world, actor, at, dir);
    if (plan.ok && plan.pushes.length === 0 && plan.hits === null && !plan.hitsPlayer) return dir;
  }
  return null;
}

/** Called when an actor has arrived on a teleport: moves it to another one when one is usable. */
export function teleportOnArrival(ctx: RuleContext, actor: Actor, kind: TeleportKind): void {
  const origin: Cell = { x: actor.x, y: actor.y };
  for (const target of candidatesAfter(ctx, origin, kind)) {
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
