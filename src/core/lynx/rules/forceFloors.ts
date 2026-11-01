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
import { Direction } from '../../types';
import { opposite, turnClockwise } from '../directions';
import { Creature, ForcedMove } from '../model';
import { RuleContext, RuleModule, StepAttempt, TileRule } from '../ruleApi';
import { ADMISSION } from '../tileRules';

/** The tiles.json slide types and direction marker. */
const FORCE_SLIDE_TYPE = 'force';
const ICE_SLIDE_TYPE = 'ice';
const RANDOM_FORCE = 'RANDOM';
/** Suction boots: Chip is neither forced, sped up nor held back by force floors. */
const SUCTION_BOOTS_ID = 'boots_force';
const SKATES_ID = 'boots_ice';
/** Key of Chip's slide permission in creature.data (creature.data stores numbers only). */
const PERMISSION_KEY = 'slidePermission';
const PERMISSION_HELD = 1;
const PERMISSION_LACKING = 0;

function wearsSuctionBoots(ctx: RuleContext, creature: Creature): boolean {
  return creature.kind === 'chip' && ctx.world.chipState.boots.has(SUCTION_BOOTS_ID);
}

function isForceTile(tileId: string): boolean {
  return ConfigRegistry.getTile(tileId).slideType === FORCE_SLIDE_TYPE;
}

/** The direction a floor pushes right now; the random floor reads the shared direction without turning it. */
function pushOf(ctx: RuleContext, tileId: string): Direction | null {
  const marker = ConfigRegistry.getTile(tileId).forceDirection;
  if (marker === undefined) return null;
  return marker === RANDOM_FORCE ? ctx.world.randomForceDir : marker;
}

function forceRule(tileId: string): TileRule {
  return {
    admits: ADMISSION.everyone,
    mayLeave: (probe) =>
      wearsSuctionBoots(probe.ctx, probe.mover) || probe.dir !== opposite(pushOf(probe.ctx, tileId) ?? probe.dir),
    isFast: (ctx, mover) => !wearsSuctionBoots(ctx, mover)
  };
}

function buildForceTiles(): Record<string, TileRule> {
  const rules: Record<string, TileRule> = {};
  for (const id of Object.keys(ConfigRegistry.getTiles().tiles)) {
    if (isForceTile(id)) rules[id] = forceRule(id);
  }
  return rules;
}

function holdsPermission(chip: Creature): boolean {
  return (chip.data[PERMISSION_KEY] ?? PERMISSION_LACKING) === PERMISSION_HELD;
}

/** The floor's move for a creature at rest on it, or null. The random floor shows its next direction. */
function forcedMove(ctx: RuleContext, creature: Creature): ForcedMove | null {
  const tileId = ctx.tileIdAt(creature.x, creature.y);
  if (!isForceTile(tileId) || wearsSuctionBoots(ctx, creature)) return null;
  const push = pushOf(ctx, tileId);
  if (push === null) return null;
  const isRandom = ConfigRegistry.getTile(tileId).forceDirection === RANDOM_FORCE;
  return {
    dir: isRandom ? turnClockwise(push) : push,
    intent: 'carried',
    chipMayChoose: creature.kind === 'chip' && holdsPermission(creature)
  };
}

/** Chip's slide permission follows his attempts (spec 13.3). */
function updatePermission(ctx: RuleContext, attempt: StepAttempt): void {
  const { creature, from } = attempt;
  if (creature.kind !== 'chip' || wearsSuctionBoots(ctx, creature)) return;
  const tileId = ctx.tileIdAt(from.x, from.y);
  if (isForceTile(tileId)) {
    if (attempt.intent === 'carried') creature.data[PERMISSION_KEY] = PERMISSION_HELD;
    else if (attempt.intent === 'chosen') creature.data[PERMISSION_KEY] = PERMISSION_LACKING;
    return;
  }
  const onIce = ConfigRegistry.getTile(tileId).slideType === ICE_SLIDE_TYPE;
  const skated = ctx.world.chipState.boots.has(SKATES_ID);
  if (!onIce || skated) creature.data[PERMISSION_KEY] = PERMISSION_LACKING;
}

/** Force floors, the random floor and the slide permission (spec sections 13.2 to 13.4, 14.3). */
export const forceFloorRules: RuleModule = {
  name: 'forceFloors',
  // Read on demand: the tile configs are loaded after this module is imported.
  get tiles() {
    return buildForceTiles();
  },
  forcedMove,
  onForcedMove: (ctx, creature, forced) => {
    if (ConfigRegistry.getTile(ctx.tileIdAt(creature.x, creature.y)).forceDirection === RANDOM_FORCE) {
      ctx.world.randomForceDir = forced.dir;
    }
  },
  onStepAttempt: updatePermission
};
