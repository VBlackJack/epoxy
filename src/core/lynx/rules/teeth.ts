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
import { neighbour } from '../directions';
import { Creature } from '../model';
import { RuleContext, RuleModule } from '../ruleApi';

/** Teeth decide only in the first half of each cycle of ticks (spec 10). */
const TEETH_CYCLE_TICKS = 8;
const TEETH_ACTIVE_TICKS = 4;

/** The directions toward Chip, in the order teeth prefer them; empty when on his cell. */
function chaseChoices(teeth: Creature, target: { x: number; y: number }): Direction[] {
  const dx = target.x - teeth.x;
  const dy = target.y - teeth.y;
  const horizontal: Direction[] = dx === 0 ? [] : [dx > 0 ? 'E' : 'W'];
  const vertical: Direction[] = dy === 0 ? [] : [dy > 0 ? 'S' : 'N'];
  return Math.abs(dx) > Math.abs(dy) ? [...horizontal, ...vertical] : [...vertical, ...horizontal];
}

function decideTeeth(ctx: RuleContext, teeth: Creature): Direction | null {
  if ((ctx.tick + ctx.world.phaseOffset) % TEETH_CYCLE_TICKS >= TEETH_ACTIVE_TICKS) return null;
  const choices = chaseChoices(teeth, ctx.world.chip);
  for (const dir of choices) {
    if (!ctx.canStep(teeth, dir)) continue;
    const target = neighbour(teeth, dir);
    ctx.eraseRemainsAt(target.x, target.y);
    return dir;
  }
  return choices[0] ?? null;
}

/** Teeth: half speed, chase Chip's logical cell, face the first choice when boxed in. */
export const teethRules: RuleModule = {
  name: 'teeth',
  monsters: { teeth: { decide: decideTeeth } }
};
