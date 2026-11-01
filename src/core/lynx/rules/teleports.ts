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

import { Cell, sameCell } from '../directions';
import { SFX } from '../lynxConstants';
import { Creature } from '../model';
import { RuleContext, RuleModule } from '../ruleApi';
import { ADMISSION } from '../tileRules';

/*
 * Teleports (spec section 12). Phase D sends on every live creature at rest on
 * a teleport; the creature that landed is forced out in its facing next tick.
 */

const TELEPORT_TILE = 'teleport';
/** `creature.data` flag: it landed on a teleport and must step out next tick. */
const LANDED_FLAG = 'teleportLanded';
const FLAG_SET = 1;

function cellOfIndex(ctx: RuleContext, index: number): Cell {
  return { x: index % ctx.width, y: Math.floor(index / ctx.width) };
}

/** The teleport the creature lands on, or null. Candidates run backwards in reading order, the source last. */
function findLanding(ctx: RuleContext, creature: Creature): Cell | null {
  const total = ctx.width * ctx.height;
  const source = creature.y * ctx.width + creature.x;
  for (let offset = 1; offset <= total; offset++) {
    const index = (((source - offset) % total) + total) % total;
    const candidate = cellOfIndex(ctx, index);
    if (ctx.tileIdAt(candidate.x, candidate.y) !== TELEPORT_TILE) continue;
    const occupant = ctx.occupantAt(candidate.x, candidate.y);
    if (occupant && occupant !== creature) continue;
    if (ctx.canStep(creature, creature.dir, candidate)) return candidate;
  }
  return null;
}

function sendOn(ctx: RuleContext, creature: Creature): void {
  const landing = findLanding(ctx, creature);
  if (landing === null) {
    if (creature.kind === 'chip') ctx.world.chipState.stuck = true;
    return;
  }
  if (!sameCell(landing, creature)) ctx.relocate(creature, landing);
  creature.data[LANDED_FLAG] = FLAG_SET;
  ctx.emitVisual('teleport', landing.x, landing.y);
  if (creature.kind === 'chip') ctx.playSfx(SFX.teleport);
}

export const teleportRules: RuleModule = {
  name: 'teleports',
  tiles: { [TELEPORT_TILE]: { admits: ADMISSION.everyone } },
  forcedMove: (_ctx, creature) =>
    creature.data[LANDED_FLAG] === FLAG_SET ? { dir: creature.dir, intent: 'teleportExit', chipMayChoose: false } : null,
  onForcedMove: (_ctx, creature) => {
    delete creature.data[LANDED_FLAG];
  },
  onMovementEnd: (ctx) => {
    const sendable = ctx
      .creatures()
      .filter((c) => ctx.isAtRest(c) && ctx.tileIdAt(c.x, c.y) === TELEPORT_TILE)
      .reverse();
    for (const creature of sendable) {
      if (creature.kind === 'chip' && ctx.world.chipState.stuck) continue;
      sendOn(ctx, creature);
    }
  }
};
