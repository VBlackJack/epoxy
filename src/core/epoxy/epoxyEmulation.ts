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
import { EntityDefinition, RuntimeEntity } from '../types';

/** Behaviour state a monster starts with at the first of the `emulates` list. */
const FIRST_EMULATEE = 0;
const NO_MOVES_YET = 0;

/**
 * The emulation fields a new monster of this definition carries. Only a monster that emulates others has any, so
 * the entities of a level without one keep exactly the fields they had before.
 */
export function initialEmulationState(def: EntityDefinition | undefined): Pick<RuntimeEntity, 'emulatee' | 'emulationMoves'> {
  return def?.emulates === undefined ? {} : { emulatee: FIRST_EMULATEE, emulationMoves: NO_MOVES_YET };
}

/** The definition whose behaviour a monster that emulates others follows now, without counting a decision. */
export function emulatedDef(entity: RuntimeEntity, def: EntityDefinition | undefined): EntityDefinition | undefined {
  const list = def?.emulates;
  if (def === undefined || list === undefined || list.length === 0) return def;
  return ConfigRegistry.getEntityDef(list[entity.emulatee ?? FIRST_EMULATEE]) ?? def;
}

/**
 * Counts one step decision of a monster that emulates others and returns the definition whose behaviour decides
 * this step. After `emulationSwitchAttempts` decisions the monster moves on to the next behaviour of the list
 * (wrapping round) and the count restarts; the decision that reaches the limit already follows the new behaviour.
 * A monster that emulates nobody is returned as it is. The state lives on the entity (two plain numbers), so an
 * undo snapshot puts it back and the simulation hash covers it.
 */
export function advanceEmulation(entity: RuntimeEntity, def: EntityDefinition | undefined): EntityDefinition | undefined {
  const list = def?.emulates;
  if (def === undefined || list === undefined || list.length === 0) return def;
  const limit = def.emulationSwitchAttempts ?? 1;
  let index = entity.emulatee ?? FIRST_EMULATEE;
  let moves = (entity.emulationMoves ?? NO_MOVES_YET) + 1;
  if (moves >= limit) {
    moves = NO_MOVES_YET;
    index = (index + 1) % list.length;
  }
  entity.emulatee = index;
  entity.emulationMoves = moves;
  return ConfigRegistry.getEntityDef(list[index]) ?? def;
}
