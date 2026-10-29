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
import { CompiledLevel } from '../core/types';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { LevelProver } from './LevelProver';

const CORRIDOR_LENGTH = 5;
const MIDDLE = 2;

/** A one-cell-wide corridor with `middle` terrain (and optionally an item) halfway along. */
function corridor(middle: string, item: string | null = null): CompiledLevel {
  const wall = Array.from({ length: CORRIDOR_LENGTH }, () => 'wall');
  const lane = Array.from({ length: CORRIDOR_LENGTH }, (_, x) => (x === MIDDLE ? middle : 'floor'));
  const items: (string | null)[] = Array.from({ length: CORRIDOR_LENGTH }, () => null);
  items[MIDDLE] = item;
  return {
    id: 'corridor',
    number: 1,
    password: 'AAAA',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    playerStart: { x: 0, y: 1, dir: 'E' },
    terrain: [wall, lane, wall],
    items: [wall.map(() => null), items, wall.map(() => null)],
    entities: [],
    trapLinks: [],
    cloneLinks: []
  };
}

describe('LevelProver safe path', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  const safePath = (level: CompiledLevel) => {
    const engine = new GameEngine();
    engine.loadLevel(level);
    const prover = LevelProver as unknown as {
      safePath: (e: GameEngine, target: { x: number; y: number }) => string[] | null;
    };
    return prover.safePath(engine, { x: CORRIDOR_LENGTH - 1, y: 1 });
  };

  it('walks plain floor', () => {
    expect(safePath(corridor('floor'))).toEqual(['E', 'E', 'E', 'E']);
  });

  it('refuses cells with a side effect: buttons, tiles that change when stepped on, items', () => {
    expect(safePath(corridor('button_green'))).toBeNull();
    expect(safePath(corridor('dirt'))).toBeNull();
    expect(safePath(corridor('floor', 'chip'))).toBeNull();
  });
});
