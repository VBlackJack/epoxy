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
import { CompiledLevel, EntityDefinition } from './types';

/** The entity definition of an id, or undefined when it is unknown or the configs are not loaded yet. */
function definitionOf(type: string): EntityDefinition | undefined {
  try {
    return ConfigRegistry.getEntityDef(type);
  } catch {
    return undefined;
  }
}

/**
 * Whether a level can have one push move several blocks: a block whose definition lists `chainPushes` shares the
 * level with another block or a block cloner. A block made by a clone machine counts as a block. An older build
 * would refuse such a push, so a pack holding the level needs format 13. Deliberately an over-approximation (it
 * does not check which blocks can meet). False when the configs are not loaded.
 */
export function usesBlockChains(level: Pick<CompiledLevel, 'entities' | 'cloneLinks'>): boolean {
  const types = [...level.entities.map((e) => e.type), ...level.cloneLinks.map((link) => link.templateType)];
  const blocks = types.filter((type) => definitionOf(type)?.kind === 'block');
  if (!blocks.some((type) => definitionOf(type)?.chainPushes !== undefined)) return false;
  return blocks.length > 1 || level.cloneLinks.length > 0;
}
