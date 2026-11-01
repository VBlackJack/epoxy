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

import { opposite } from '../directions';
import { RuleModule } from '../ruleApi';

/** The monster id of the tank. Its forward-only movement is the core's rule. */
export const TANK_TYPE = 'tank';

/**
 * The key in creature.data that a blue button sets (to MARKED) on a tank it
 * affects. A tank marked twice in a tick is unmarked by the button's own
 * logic. This module is the only owner of the turn: it reads the mark, turns
 * the tank, and removes the mark.
 */
export const TANK_TURN_MARK = 'tankTurnMark';
const MARKED = 1;

/**
 * Tanks (spec 10, 11.2). At the start of a tick (phase A) every marked tank at
 * rest turns around; every mark is removed, so a tank that was mid-step
 * ignores the press.
 */
export const tankRules: RuleModule = {
  name: 'tanks',
  onTickStart: (ctx) => {
    for (const tank of ctx.creatures()) {
      if (tank.kind !== 'monster' || tank.type !== TANK_TYPE) continue;
      if (tank.data[TANK_TURN_MARK] === MARKED && ctx.isAtRest(tank)) tank.dir = opposite(tank.dir);
      delete tank.data[TANK_TURN_MARK];
    }
  }
};
