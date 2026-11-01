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

import { coreMonsterRules } from './monsterRules';
import { MonsterRule, RuleModule, TileRule } from './ruleApi';
import { coreTileRules } from './tileRules';

/** Every tile rule, monster rule and module the simulation consults. */
export interface RuleBook {
  tiles: ReadonlyMap<string, TileRule>;
  monsters: ReadonlyMap<string, MonsterRule>;
  modules: readonly RuleModule[];
}

function register<T>(target: Map<string, T>, entries: Readonly<Record<string, T>> | undefined, owner: string): void {
  for (const [id, rule] of Object.entries(entries ?? {})) {
    if (target.has(id)) throw new Error(`Lynx rule for "${id}" registered twice (by ${owner})`);
    target.set(id, rule);
  }
}

/** Merges the core rules with those of the modules. A second rule for one id is a programming error. */
export function buildRuleBook(modules: readonly RuleModule[]): RuleBook {
  const tiles = new Map<string, TileRule>();
  const monsters = new Map<string, MonsterRule>();
  register(tiles, coreTileRules(), 'core');
  register(monsters, coreMonsterRules(), 'core');
  for (const module of modules) {
    register(tiles, module.tiles, module.name);
    register(monsters, module.monsters, module.name);
  }
  return { tiles, monsters, modules };
}
