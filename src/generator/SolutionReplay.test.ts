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

import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../audio/AudioManager', () => import('../test/silentAudio'));

import { ConfigRegistry } from '../config/ConfigRegistry';
import { GameEngine } from '../core/GameEngine';
import { ProceduralGenerator } from '../core/ProceduralGenerator';
import { CompiledLevel, TimedMove } from '../core/types';
import { collectDueMoves } from '../ui/replaySchedule';
import { timedSolution } from './SolutionReplay';
import { loadTestConfigs } from '../test/loadTestConfigs';

/** Upper bound on ticks a replay may take before it counts as failed. */
const MAX_REPLAY_TICKS = 200000;
const SAMPLE_SEED = 3;

/** Plays timed moves the way the game's replay loop does: due moves, then one tick. */
function replayLikeTheGame(level: CompiledLevel, moves: TimedMove[]): boolean {
  const engine = new GameEngine();
  engine.loadLevel(level);
  let index = 0;
  for (let i = 0; i < MAX_REPLAY_TICKS && !engine.isLevelCompleted(); i++) {
    const { due, nextIndex } = collectDueMoves(moves, index, engine.getTick());
    for (const move of due) engine.attemptPlayerMove(move.dir);
    index = nextIndex;
    engine.tick();
    if (!engine.getPlayer().alive) return false;
  }
  return engine.isLevelCompleted() && engine.getChipsRemaining() === 0;
}

describe('solution replay', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  it('every campaign level carries a solution the game replay wins', () => {
    for (const level of ConfigRegistry.getLevels()) {
      const moves = timedSolution(level);
      expect(moves, `${level.id} has no winning solution`).not.toBeNull();
      expect(replayLikeTheGame(level, moves as TimedMove[]), level.id).toBe(true);
    }
  });

  it('generated levels carry their proof as a replayable solution', () => {
    for (const n of [1, 4, 8]) {
      const level = ProceduralGenerator.generateLevel(n, SAMPLE_SEED);
      const moves = timedSolution(level);
      expect(moves, level.id).not.toBeNull();
      expect(replayLikeTheGame(level, moves as TimedMove[]), level.id).toBe(true);
    }
  });

  it('returns null for a level without a solution or with a stale one', () => {
    const level = { ...ConfigRegistry.getLevels()[0] };
    expect(timedSolution({ ...level, solution: undefined })).toBeNull();
    expect(timedSolution({ ...level, solution: 'N' })).toBeNull();
  });
});
