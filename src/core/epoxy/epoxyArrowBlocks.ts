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

import { ConfigRegistry } from '../../config/ConfigRegistry';
import { relativeTo } from '../lynx/directions';
import { Direction, EntityDefinition, RuntimeEntity } from '../types';

/**
 * Whether an entity of this definition carries a runtime facing: a turret fires the way it faces and an
 * arrow block reads its arrows from it. Other entities keep `facing` undefined, so their hash is untouched.
 */
export function hasEntityFacing(def: EntityDefinition | undefined): boolean {
  return def?.turretBeam !== undefined || def?.pushArrows !== undefined;
}

/**
 * The absolute directions an arrow block may be pushed toward: its arrows read relative to its facing.
 * Undefined for an entity without arrows, which a push moves in any direction.
 */
export function allowedPushDirs(entity: RuntimeEntity, def: EntityDefinition | undefined): Direction[] | undefined {
  if (def?.pushArrows === undefined) return undefined;
  const facing = entity.facing ?? entity.dir;
  return def.pushArrows.map((turn) => relativeTo(facing, turn));
}

/** Whether a push toward a direction may move the block: always, unless it is an arrow block with no arrow there. */
export function isPushAllowed(block: RuntimeEntity, dir: Direction): boolean {
  const allowed = allowedPushDirs(block, ConfigRegistry.getEntityDef(block.type));
  return allowed === undefined || allowed.includes(dir);
}
