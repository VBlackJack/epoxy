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

import { GameEngine } from '../core/GameEngine';
import { CompiledLevel } from '../core/types';
import { PieceSolver, SolverAction } from '../generator/PieceSolver';

/** Plays the winning moves in a fresh engine, independently of the generator's own proof. */
export function replays(level: CompiledLevel, moves: SolverAction[]): boolean {
  const engine = new GameEngine();
  engine.loadLevel(level);
  for (const action of moves) {
    if (!PieceSolver.play(engine, action)) return false;
  }
  return engine.isLevelCompleted() && engine.getChipsRemaining() === 0;
}

export { cellReachableWithout } from '../generator/GuardCheck';
