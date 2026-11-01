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

import { SFX } from '../lynxConstants';
import { ADMISSION } from '../tileRules';
import { RuleModule } from '../ruleApi';

/** The tile id of the thief. */
const THIEF_TILE = 'thief';

/** The thief (spec 9.3): Chip arriving loses every pair of boots, keeps his keys; the tile stays. */
export const thiefRules: RuleModule = {
  name: 'thief',
  tiles: {
    [THIEF_TILE]: {
      admits: ADMISSION.chipOnly,
      arrival: {
        chip: (ctx) => {
          ctx.world.chipState.boots.clear();
          ctx.playSfx(SFX.thief);
        }
      }
    }
  }
};
