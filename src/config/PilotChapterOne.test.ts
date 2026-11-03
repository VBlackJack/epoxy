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

import { GameEngine } from '../core/GameEngine';
import { CompiledLevel, Direction } from '../core/types';
import { PieceSolver } from '../generator/PieceSolver';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { ConfigRegistry } from './ConfigRegistry';

const ORDER_TRAP_LEVEL = 'epoxy_p_4';
/** Walk to the key in the far west, then open the LEFT door (2,3) first. */
const LEFT_FIRST = 'SSWWWWEN';
/** Walk to the key, then open the RIGHT door (8,3) first. */
const RIGHT_FIRST = 'SSWWWWEEEEEEEN';
const DIRECTIONS: Direction[] = ['N', 'E', 'S', 'W'];
const SEARCH_STATE_CAP = 20000;

function levelById(id: string): CompiledLevel {
  const level = ConfigRegistry.getPilotLevels().find((l) => l.id === id);
  if (!level) throw new Error(`no pilot level ${id}`);
  return level;
}

function engineAfter(level: CompiledLevel, moves: string): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(level);
  for (const move of moves) expect(PieceSolver.play(engine, move as Direction), moves).toBe(true);
  return engine;
}

/** Exhaustive search of every state reachable from the engine's current one; true when one wins. */
function canStillWin(engine: GameEngine): boolean {
  const key = (): string => {
    const state = engine.captureState();
    const keys = Object.entries(state.player.keys)
      .filter(([, count]) => count > 0)
      .sort(([a], [b]) => a.localeCompare(b));
    return JSON.stringify([state.player.x, state.player.y, keys, state.chipsRemaining, state.terrain, state.items]);
  };
  const seen = new Set<string>([key()]);
  const queue = [engine.captureState()];
  while (queue.length > 0) {
    const from = queue.shift()!;
    for (const dir of DIRECTIONS) {
      engine.restoreState(from);
      if (!PieceSolver.play(engine, dir)) continue;
      if (engine.isLevelCompleted() && engine.getChipsRemaining() === 0) return true;
      const id = key();
      if (seen.has(id)) continue;
      seen.add(id);
      expect(seen.size).toBeLessThan(SEARCH_STATE_CAP);
      queue.push(engine.captureState());
    }
  }
  return false;
}

describe('pilot chapter 1 order trap', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  it('keeps the level solvable when the right attic is opened first', () => {
    const engine = engineAfter(levelById(ORDER_TRAP_LEVEL), RIGHT_FIRST);
    expect(canStillWin(engine)).toBe(true);
  });

  it('leaves the level unsolvable once the left door has used the only key in reach', () => {
    const engine = engineAfter(levelById(ORDER_TRAP_LEVEL), LEFT_FIRST);
    expect(engine.getTerrain()[3][2]).toBe('floor');
    expect(canStillWin(engine)).toBe(false);
  });
});
