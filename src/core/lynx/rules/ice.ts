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
import { opposite } from '../directions';
import { Creature } from '../model';
import { ArrivalEffect, RuleContext, RuleModule, StepAttempt, TileRule } from '../ruleApi';
import { ADMISSION } from '../tileRules';

/** The tiles.json slide type of every ice tile, corners included. */
const ICE_SLIDE_TYPE = 'ice';
/** Ice skates: Chip is neither forced, sped up nor turned by ice. */
const SKATES_ID = 'boots_ice';

function wearsSkates(ctx: RuleContext, creature: Creature): boolean {
  return creature.kind === 'chip' && ctx.world.chipState.boots.has(SKATES_ID);
}

function isIceTile(tileId: string): boolean {
  return ConfigRegistry.getTile(tileId).slideType === ICE_SLIDE_TYPE;
}

/** The facing a creature takes on the corner tile, or its own facing when the corner does not turn it. */
function deflected(tileId: string, dir: Direction): Direction {
  return ConfigRegistry.getTile(tileId).deflectionMap?.[dir] ?? dir;
}

/** A creature at rest on ice that is not Chip with skates is carried the way it faces (spec 5.1, 13.1). */
const turnOnArrival: ArrivalEffect = (ctx, creature) => {
  if (wearsSkates(ctx, creature)) return;
  creature.dir = deflected(ctx.tileIdAt(creature.x, creature.y), creature.dir);
};

function iceRule(tileId: string): TileRule {
  const blockedEntry = ConfigRegistry.getTile(tileId).blockedEntryDirections ?? [];
  const blockedExit = blockedEntry.map(opposite);
  return {
    admits: ADMISSION.everyone,
    mayEnter: (probe) => !blockedEntry.includes(probe.dir),
    mayLeave: (probe) => !blockedExit.includes(probe.dir),
    isFast: (ctx, mover) => !wearsSkates(ctx, mover),
    arrival: { chip: turnOnArrival, block: turnOnArrival, monster: turnOnArrival }
  };
}

function buildIceTiles(): Record<string, TileRule> {
  const rules: Record<string, TileRule> = {};
  for (const id of Object.keys(ConfigRegistry.getTiles().tiles)) {
    if (isIceTile(id)) rules[id] = iceRule(id);
  }
  return rules;
}

/** A refused step from ice reverses the creature, then the corner turn of its cell applies (spec 6.1, 13.1). */
function bounce(ctx: RuleContext, attempt: StepAttempt): void {
  const { creature, from } = attempt;
  if (attempt.outcome !== 'refused' || wearsSkates(ctx, creature)) return;
  const tileId = ctx.tileIdAt(from.x, from.y);
  if (!isIceTile(tileId)) return;
  creature.dir = deflected(tileId, opposite(attempt.dir));
}

/** Ice, ice corners, bounce and skates (spec section 13.1). */
export const iceRules: RuleModule = {
  name: 'ice',
  // Read on demand: the tile configs are loaded after this module is imported.
  get tiles() {
    return buildIceTiles();
  },
  forcedMove: (ctx, creature) => {
    if (wearsSkates(ctx, creature) || !isIceTile(ctx.tileIdAt(creature.x, creature.y))) return null;
    return { dir: creature.dir, intent: 'carried', chipMayChoose: false };
  },
  onStepAttempt: bounce
};
