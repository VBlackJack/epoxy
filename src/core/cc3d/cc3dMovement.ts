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
  isPlayerAt,
  mobAt,
  neighbour
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
}

function refused(bump: Cell | null = null): StepPlan {
  return { ok: false, pushes: [], bump, hits: null, hitsPlayer: false };
}

const ALLOWED: StepPlan = { ok: true, pushes: [], bump: null, hits: null, hitsPlayer: false };

/**
 * Plans a step of `actor` from the cell `from` (usually its own cell) in a direction.
 * `releasing` lifts the hold of a closed trap or a clone machine (a clone leaving its machine).
 */
export function planStep(world: World, actor: Actor, from: Cell, dir: Direction, releasing = false): StepPlan {
  const to = neighbour(from, dir);
  const fromCell = cellAt(world, from.x, from.y);
  const toCell = cellAt(world, to.x, to.y);
  if (!fromCell || !toCell) return refused();
  if (!sidesAllow(fromCell, toCell, dir)) return refused();
  if (!releasing && !mayLeaveCell(fromCell)) return refused();
  if (!terrainAdmits(world, actor, toCell)) {
    return refused(actingTerrain(toCell).kind === 'appearing_wall' ? to : null);
  }
  return planOccupancy(world, actor, to, dir);
}

function planOccupancy(world: World, actor: Actor, to: Cell, dir: Direction): StepPlan {
  if (actor.kind !== 'player' && isPlayerAt(world, to)) {
    // A monster that steps onto the player kills him; any other mover is refused.
    return isBlockKind(actor.kind) ? refused() : { ...ALLOWED, hitsPlayer: true };
  }
  const occupant = mobAt(world, to, actor);
  if (!occupant) return ALLOWED;
  if (actor.kind === 'player') {
    if (occupant.floating) return ALLOWED;
    if (isBlockKind(occupant.kind)) return planPush(world, occupant, to, dir);
    return { ok: true, pushes: [], bump: null, hits: occupant, hitsPlayer: false };
  }
  // An ice block pushes the ice block ahead of it, a chain [U].
  if (actor.kind === 'block_ice' && occupant.kind === 'block_ice' && !occupant.floating) {
    return planPush(world, occupant, to, dir);
  }
  return refused();
}

function planPush(world: World, block: MobState, at: Cell, dir: Direction): StepPlan {
  if (block.remaining > 0 || block.floating) return refused();
  const ahead = planStep(world, block, at, dir);
  if (!ahead.ok || ahead.hits) return refused(ahead.bump);
  return { ok: true, pushes: [...ahead.pushes, block], bump: null, hits: null, hitsPlayer: false };
}
