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
import { mayLeaveCell, sidesAllow, terrainAdmits } from './cc3dTerrainRules';
import {
  Actor,
  Cell,
  MobState,
  World,
  actingTerrain,
  cellAt,
  isBlockKind,
  isMonsterKind,
  isPlayerAt,
  mobAt,
  neighbour,
  shotAt
} from './cc3dWorld';

/**
 * Whether a step is possible, without changing anything. One function answers
 * for the player, blocks and (lot C2) monsters, so a push, a teleport exit and
 * a monster move all ask the same question.
 */

export interface StepPlan {
  ok: boolean;
  /** Blocks that move with the actor, the farthest first. */
  pushes: MobState[];
  /** An appearing wall that was bumped and must turn into a wall. */
  bump: Cell | null;
  /** The monster standing on the destination (the player dies on contact). */
  hits: MobState | null;
  /** A monster's step ends on the player: he dies on contact. */
  hitsPlayer: boolean;
  /** A laser shot flying in the destination: whoever steps there dies and the shot vanishes. */
  shot: MobState | null;
  /** A monster in the way of a sliding ordinary block: it is crushed [U, 10 item 24]. */
  crushes: MobState | null;
}

function refused(bump: Cell | null = null): StepPlan {
  return { ok: false, pushes: [], bump, hits: null, hitsPlayer: false, shot: null, crushes: null };
}

const ALLOWED: StepPlan = { ok: true, pushes: [], bump: null, hits: null, hitsPlayer: false, shot: null, crushes: null };

/**
 * Plans a step of `actor` from the cell `from` (usually its own cell) in a direction.
 * `releasing` lifts the hold of a closed trap or a clone machine (a clone leaving its machine).
 */
export function planStep(world: World, actor: Actor, from: Cell, dir: Direction, releasing = false, sliding = false, chain = false): StepPlan {
  const to = neighbour(from, dir);
  const fromCell = cellAt(world, from.x, from.y);
  const toCell = cellAt(world, to.x, to.y);
  if (!fromCell || !toCell) return refused();
  if (!sidesAllow(fromCell, toCell, dir)) return refused();
  if (!releasing && !mayLeaveCell(fromCell)) return refused();
  if (!terrainAdmits(world, actor, toCell)) {
    return refused(actingTerrain(toCell).kind === 'appearing_wall' ? to : null);
  }
  return planOccupancy(world, actor, to, dir, sliding, chain);
}

function planOccupancy(world: World, actor: Actor, to: Cell, dir: Direction, sliding: boolean, chain: boolean): StepPlan {
  // A shot flying in a cell, a reflector's included (it is inside the cell for its two ticks): a player or
  // monster stepping in dies and the shot is spent; a block is refused [U, 08 section 8.6].
  const shot = world.shots.length > 0 ? shotAt(world, to) : undefined;
  if (shot) return actor.kind !== 'player' && isBlockKind(actor.kind) ? refused() : { ...ALLOWED, shot };
  if (actor.kind !== 'player' && isPlayerAt(world, to)) {
    // A monster that steps onto the player kills him; any other mover is refused.
    return isBlockKind(actor.kind) ? refused() : { ...ALLOWED, hitsPlayer: true };
  }
  const occupant = mobAt(world, to, actor);
  if (!occupant) return ALLOWED;
  if (actor.kind === 'player') {
    if (occupant.floating) return ALLOWED;
    if (isBlockKind(occupant.kind)) return planPush(world, occupant, to, dir);
    if (occupant.kind === 'laser_shooter') return refused();
    return { ...ALLOWED, hits: occupant };
  }
  // A yellow golem pushes a block the way the player does (07 section 7.4 and 7.9, 12).
  if (actor.kind === 'golem_yellow' && isBlockKind(occupant.kind) && !occupant.floating) {
    return planPush(world, occupant, to, dir);
  }
  // An ice block pushes a chain of any blocks, reflectors and bots [S, 10 item 23].
  // Every block of the chain pushes the next one along.
  if ((actor.kind === 'block_ice' || chain) && isBlockKind(occupant.kind) && !occupant.floating) {
    return planPush(world, occupant, to, dir, true);
  }
  // A sliding ordinary block crushes a monster in its way [U, 10 item 24]; a pushed one is refused.
  if (sliding && isBlockKind(actor.kind) && actor.kind !== 'block_ice' && isMonsterKind(occupant.kind)) {
    return { ...ALLOWED, crushes: occupant };
  }
  return refused();
}

function planPush(world: World, block: MobState, at: Cell, dir: Direction, chain = false): StepPlan {
  if (block.remaining > 0 || block.floating) return refused();
  const ahead = planStep(world, block, at, dir, false, false, chain);
  if (!ahead.ok || ahead.hits) return refused(ahead.bump);
  return { ...ALLOWED, pushes: [...ahead.pushes, block] };
}
