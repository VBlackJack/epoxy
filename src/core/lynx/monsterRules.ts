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

import { Direction, RelativeTurn } from '../types';
import { neighbour, relativeTo } from './directions';
import { Creature } from './model';
import { MonsterRule, RuleContext } from './ruleApi';

/** What a monster does when none of its candidate directions can be entered. */
export type BoxedInFacing = 'firstCandidate' | 'lastCandidate';

/**
 * Takes the first candidate (relative to the monster's facing) it may enter now.
 * The cell it settles on loses its remains at once, even if the step later
 * fails. When nothing can be entered, returns the candidate it will face.
 */
export function chooseFirstEnterable(
  ctx: RuleContext,
  monster: Creature,
  turns: readonly RelativeTurn[],
  boxedIn: BoxedInFacing
): Direction {
  const candidates = turns.map((turn) => relativeTo(monster.dir, turn));
  for (const dir of candidates) {
    if (ctx.canStep(monster, dir)) {
      const target = neighbour(monster, dir);
      ctx.eraseRemainsAt(target.x, target.y);
      return dir;
    }
  }
  return boxedIn === 'firstCandidate' ? candidates[0] : candidates[candidates.length - 1];
}

/** A monster that walks an ordered list of turns and faces its last candidate when boxed in. */
export function candidateListRule(turns: readonly RelativeTurn[], extras: Partial<MonsterRule> = {}): MonsterRule {
  return { ...extras, decide: (ctx, monster) => chooseFirstEnterable(ctx, monster, turns, 'lastCandidate') };
}

const BUG_TURNS: readonly RelativeTurn[] = ['LEFT', 'FORWARD', 'RIGHT', 'BACK'];
const PARAMECIUM_TURNS: readonly RelativeTurn[] = ['RIGHT', 'FORWARD', 'LEFT', 'BACK'];
const GLIDER_TURNS: readonly RelativeTurn[] = ['FORWARD', 'LEFT', 'RIGHT', 'BACK'];
const FIREBALL_TURNS: readonly RelativeTurn[] = ['FORWARD', 'RIGHT', 'LEFT', 'BACK'];
const PINK_BALL_TURNS: readonly RelativeTurn[] = ['FORWARD', 'BACK'];
const TANK_TURNS: readonly RelativeTurn[] = ['FORWARD'];

/** The monsters whose rule is a plain candidate list. Tank reversal, teeth, walker and blob live in modules. */
export function coreMonsterRules(): Record<string, MonsterRule> {
  return {
    bug: candidateListRule(BUG_TURNS),
    paramecium: candidateListRule(PARAMECIUM_TURNS),
    glider: candidateListRule(GLIDER_TURNS, { survivesWater: true }),
    fireball: candidateListRule(FIREBALL_TURNS),
    pink_ball: candidateListRule(PINK_BALL_TURNS),
    tank: candidateListRule(TANK_TURNS)
  };
}
