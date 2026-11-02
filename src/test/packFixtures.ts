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
import { CompiledLevel, LevelBlueprint, LevelPack } from '../core/types';

/** A compiled level under this id; the registry must hold the test configs. */
export function makeLevel(id: string, overrides: Partial<LevelBlueprint> = {}): CompiledLevel {
  return ConfigRegistry.compileBlueprint({
    id,
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 100,
    chipsRequired: 0,
    playerStart: { x: 1, y: 1, dir: 'S' },
    entities: [],
    trapLinks: [],
    cloneLinks: [],
    ...overrides
  });
}

/** A pack the player owns, holding one level per id. */
export function makeUserPack(id: string, levelIds: string[]): LevelPack {
  return {
    id,
    name: id,
    builtIn: false,
    userCreated: true,
    levels: levelIds.map((levelId, index) => ({ ...makeLevel(levelId), number: index + 1 }))
  };
}
