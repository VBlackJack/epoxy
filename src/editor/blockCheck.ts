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

/** The Check line that states a block verdict; null when there is nothing to judge, so no line shows. */
export function describeBlockVerdict(verdict: BlockPuzzleVerdict): BlockCheckLine | null {
  switch (verdict.kind) {
    case 'solved':
      return { key: 'editor.check.blocks.solved', params: { count: verdict.pushes } };
    case 'unsolvable':
      return { key: 'editor.check.blocks.unsolvable' };
    case 'not_checked':
      return { key: 'editor.check.blocks.not_checked' };
    case 'none':
      return null;
  }
}

/** True when the Blocks line applies to the level: only the Epoxy rules play the block puzzles the solver models. */
export function blockCheckApplies(level: CompiledLevel): boolean {
  return level.ruleset === undefined || level.ruleset === 'epoxy';
}

/**
 * The block puzzle verdict of a level, or null when the line does not apply
 * (a Lynx or CC3D level, or a start outside the map that cannot be loaded).
 * The search is exhaustive up to `requestedSearchBudget` layouts and can take
 * seconds on a large open room: the page runs it in a worker, never inline.
 */
export function evaluateBlocks(level: CompiledLevel): BlockPuzzleVerdict | null {
  if (!blockCheckApplies(level)) return null;
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
