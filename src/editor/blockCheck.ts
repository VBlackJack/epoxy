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

import { BlockPuzzleSolver, BlockPuzzleVerdict } from '../core/BlockPuzzleSolver';
import { GameEngine } from '../core/GameEngine';
import { CompiledLevel } from '../core/types';

/** A message key and its parameters, ready for `t()`. */
export interface BlockCheckLine {
  key: string;
  params?: Record<string, number>;
}

const BLOCK_CHECK_KEYS: Record<BlockPuzzleVerdict['kind'], string> = {
  solved: 'editor.check.blocks.solved',
  unsolvable: 'editor.check.blocks.unsolvable',
  not_checked: 'editor.check.blocks.not_checked',
  none: 'editor.check.blocks.none'
};

/** The Check line that states a block verdict. */
export function describeBlockVerdict(verdict: BlockPuzzleVerdict): BlockCheckLine {
  const key = BLOCK_CHECK_KEYS[verdict.kind];
  return verdict.kind === 'solved' ? { key, params: { count: verdict.pushes } } : { key };
}

/**
 * The block puzzle verdict of a level for the Check button, or null when the
 * line does not apply: only the Epoxy rules play the block puzzles the solver
 * models (a Lynx or CC3D level is not judged), and a start outside the map
 * cannot be loaded. The search is bounded by `requestedSearchBudget`, so it
 * runs synchronously; it only runs when the designer asks for a Check.
 */
export function checkBlocks(level: CompiledLevel): BlockPuzzleVerdict | null {
  if (level.ruleset !== undefined && level.ruleset !== 'epoxy') return null;
  const { x, y } = level.playerStart;
  const insideMap =
    Number.isInteger(x) &&
    Number.isInteger(y) &&
    y >= 0 &&
    y < level.terrain.length &&
    x >= 0 &&
    x < (level.terrain[0]?.length ?? 0);
  if (!insideMap) return null;
  const engine = new GameEngine();
  engine.loadLevel(level);
  return BlockPuzzleSolver.verdict(engine);
}
