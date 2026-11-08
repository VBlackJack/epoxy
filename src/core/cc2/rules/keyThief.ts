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

import { SFX } from '../../lynx/lynxConstants';
import { RuleModule } from '../../lynx/ruleApi';
import { ADMISSION } from '../../lynx/tileRules';

/** The tile id of the key thief. */
const KEY_THIEF_TILE = 'thief_keys';

/** The key thief: Chip arriving loses every key and keeps his boots; the tile stays. */
export const keyThiefRules: RuleModule = {
  name: 'cc2KeyThief',
  tiles: {
    [KEY_THIEF_TILE]: {
      admits: ADMISSION.chipOnly,
      arrival: {
        chip: (ctx) => {
          const keys = ctx.world.chipState.keys;
          for (const id of Object.keys(keys)) keys[id] = 0;
          ctx.playSfx(SFX.thief);
        }
      }
    }
  }
};
