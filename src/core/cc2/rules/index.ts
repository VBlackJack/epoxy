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

import { RuleModule } from '../../lynx/ruleApi';
import { greenItemRules } from './greenItems';
import { iceBlockRules } from './iceBlocks';
import { itemRules } from './items';
import { keyThiefRules } from './keyThief';
import { swivelRules } from './swivels';

/**
 * The CC2 rule modules, added to the Lynx modules by createCc2Engine. A module
 * may give a rule to an id the Lynx core does not play; it may not override a
 * core Lynx id (the rule book refuses a second rule for one id).
 */
export const CC2_RULE_MODULES: readonly RuleModule[] = [
  // The ice blocks are placed at load; the green items flag the creatures standing on a green button at load,
  // so they must run after the ice blocks or a block that starts on a button would press it at tick 0.
  iceBlockRules,
  itemRules,
  greenItemRules,
  swivelRules,
  keyThiefRules
];
