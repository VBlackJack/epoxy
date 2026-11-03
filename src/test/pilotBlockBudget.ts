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
import { BLOCK_TARGET_TILE_ID } from '../core/coreConstants';
import { CompiledLevel } from '../core/types';
import { storedSolutionWins } from '../generator/SolutionReplay';

const WATER_TILE_ID = 'water';

/**
 * Problems of a pilot level's `blockBudget` design note, empty when it holds:
 * the level must hold exactly `waters + targets` blocks (nothing spare), the
 * targets must match the block targets drawn, the waters to fill cannot
 * exceed the water drawn, and the stored solution must replay to a win. A
 * level without a budget has nothing to check and no problem.
 */
export function blockBudgetProblems(level: CompiledLevel): string[] {
  const budget = level.blockBudget;
  if (!budget) return [];
  const problems: string[] = [];
  const blockTypes = new Set(
    Object.values(ConfigRegistry.getMonsters().entities)
      .filter((def) => def.kind === 'block')
      .map((def) => def.id)
  );
  const blocks = level.entities.filter((e) => blockTypes.has(e.type)).length;
  const terrain = level.terrain.flat();
  const targets = terrain.filter((id) => id === BLOCK_TARGET_TILE_ID).length;
  const waters = terrain.filter((id) => id === WATER_TILE_ID).length;
  if (blocks !== budget.waters + budget.targets) {
    problems.push(`${blocks} blocks, but the budget is ${budget.waters} waters + ${budget.targets} targets`);
  }
  if (targets !== budget.targets) problems.push(`${targets} block targets drawn, the budget says ${budget.targets}`);
  if (budget.waters > waters) problems.push(`${waters} water cells drawn, the budget fills ${budget.waters}`);
  if (!storedSolutionWins(level)) problems.push('the stored solution does not replay to a win');
  return problems;
}
