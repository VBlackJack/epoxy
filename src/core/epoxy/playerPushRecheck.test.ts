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

/** The player's push is judged again once the block has moved: a button it pressed may have closed the target cell. */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { GameEngine } from '../GameEngine';
import type { CompiledLevel } from '../types';

const SIZE = 9;
const CENTER = 4;
const MAX_WAIT_TICKS = 40;

function room(terrain: Array<[number, number, string]>): CompiledLevel {
  const grid: string[][] = Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x) => (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? 'wall' : 'floor'))
  );
  for (const [x, y, id] of terrain) grid[y][x] = id;
  return {
    id: 'player_push_recheck_room',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    playerStart: { x: CENTER - 1, y: CENTER, dir: 'E' },
    terrain: grid,
    items: Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null)),
    entities: [{ type: 'dirt_block', x: CENTER, y: CENTER, dir: 'E' }],
    trapLinks: [],
    cloneLinks: []
  };
}

function step(engine: GameEngine, dir: 'E'): boolean {
  for (let waited = 0; waited <= MAX_WAIT_TICKS; waited++) {
    if (engine.getPlayer().moveCooldown === 0) return engine.attemptPlayerMove(dir);
    engine.tick();
  }
  throw new Error('the player never became able to move');
}

beforeEach(() => {
  loadTestConfigs();
});

describe('player push re-check', () => {
  it('stays out of a cell that its own push has just closed, and the block stays pushed', () => {
    const engine = new GameEngine();
    engine.loadLevel(
      room([
        [CENTER, CENTER, 'toggle_wall_open'],
        [CENTER + 1, CENTER, 'button_green']
      ])
    );
    expect(step(engine, 'E')).toBe(false);
    expect(engine.getTerrain()[CENTER][CENTER]).toBe('toggle_wall_closed');
    expect(engine.getPlayer().x).toBe(CENTER - 1);
    const block = engine.getEntities().find((e) => e.type === 'dirt_block');
    expect(block?.x).toBe(CENTER + 1);
    // The bump is recorded for the replay, and the move is undoable.
    expect(engine.getTimedMoveHistory().length).toBe(1);
    expect(engine.getMoveHistory().length).toBe(0);
  });

  it('still walks into the cell when the push leaves it open (control)', () => {
    const engine = new GameEngine();
    engine.loadLevel(room([]));
    expect(step(engine, 'E')).toBe(true);
    expect(engine.getPlayer().x).toBe(CENTER);
  });
});
