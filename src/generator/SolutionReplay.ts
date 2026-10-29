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

import { AudioManager } from '../audio/AudioManager';
import { GameEngine } from '../core/GameEngine';
import { CompiledLevel, TimedMove } from '../core/types';
import { decodeActions, PieceSolver, WAIT_ACTION } from './PieceSolver';

/**
 * Turns a level's written solution into the tick-stamped moves the game's
 * replay plays back. The solution is played silently in a fresh engine,
 * each move stamped with the tick it is made at, exactly as the replay will
 * apply it. Returns null when the solution does not win the level, so a
 * stale solution is never shown.
 */
export function timedSolution(level: CompiledLevel): TimedMove[] | null {
  if (!level.solution) return null;
  const actions = decodeActions(level.solution);
  return AudioManager.runSilently(() => {
    const engine = new GameEngine();
    engine.loadLevel(level);
    const moves: TimedMove[] = [];
    for (const action of actions) {
      if (action !== WAIT_ACTION) moves.push({ tick: engine.getTick(), dir: action });
      if (!PieceSolver.play(engine, action)) return null;
    }
    return engine.isLevelCompleted() ? moves : null;
  });
}
