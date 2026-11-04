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

import { ConfigRegistry } from '../config/ConfigRegistry';
import { isTurretEntityType } from '../core/RulesetFeatures';

/** True when the facing of an Epoxy entity matters: a creature that moves on its own, a steerable puppet, or a turret. Blocks and mirrors stay put. */
export function entityHasFacing(type: string): boolean {
  const def = ConfigRegistry.getEntityDef(type);
  return Boolean(def?.movementPattern) || def?.steeredBy !== undefined || isTurretEntityType(type);
}
