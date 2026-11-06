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

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => ({
  AudioManager: { playSfx: vi.fn(), playStep: vi.fn() }
}));

import { GameEngine } from '../GameEngine';
import { BlockPuzzleSolver } from '../BlockPuzzleSolver';
import { CompiledLevel, Direction } from '../types';
import { loadTestConfigs } from '../../test/loadTestConfigs';

function room(width = 9, height = 7): CompiledLevel {
  return {
    id: 'pull_room',
    number: 1,
    password: 'PULL',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    playerStart: { x: 2, y: 2, dir: 'E' },
    terrain: Array.from({ length: height }, (_, y) =>
      Array.from({ length: width }, (_, x) =>
        x === 0 || y === 0 || x === width - 1 || y === height - 1 ? 'wall' : 'floor'
      )
    ),
    items: Array.from({ length: height }, () => Array.from({ length: width }, () => null)),
    entities: [],
    trapLinks: [],
    cloneLinks: []
  };
}

function step(engine: GameEngine, dir: Direction): void {
  for (let i = 0; i < 20; i++) engine.tick();
  expect(engine.attemptPlayerMove(dir)).toBe(true);
  engine.tick();
}

describe('boots_pull (Grappling Gloves)', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('pulls a stationary block behind the player when stepping away while holding boots_pull', () => {
    const lvl = room();
    lvl.playerStart = { x: 2, y: 2, dir: 'E' };
    lvl.items[2][3] = 'boots_pull';
    lvl.entities = [{ x: 1, y: 2, type: 'dirt_block', dir: 'S' }];

    const engine = new GameEngine();
    engine.loadLevel(lvl);

    // Step onto boots_pull at (3, 2): picking up the boots on this step does NOT pull the block at (1, 2).
    step(engine, 'E');
    expect(engine.getPlayer().boots.has('boots_pull')).toBe(true);
    expect(engine.getEntities()[0]).toMatchObject({ x: 1, y: 2 });

    // Step W back to (2, 2) adjacent to the block at (1, 2), then step E to (3, 2) to pull it to (2, 2).
    step(engine, 'W');
    step(engine, 'E');
    expect(engine.getPlayer()).toMatchObject({ x: 3, y: 2 });
    expect(engine.getEntities()[0]).toMatchObject({ x: 2, y: 2 });
  });

  it('does not pull when boots_pull are stolen by a thief on arrival', () => {
    const lvl = room();
    lvl.playerStart = { x: 2, y: 2, dir: 'E' };
    lvl.terrain[2][3] = 'thief';
    lvl.entities = [{ x: 1, y: 2, type: 'dirt_block', dir: 'S' }];

    const engine = new GameEngine();
    engine.loadLevel(lvl);
    engine.getPlayer().boots.add('boots_pull');

    step(engine, 'E');
    expect(engine.getPlayer().boots.has('boots_pull')).toBe(false);
    expect(engine.getEntities()[0]).toMatchObject({ x: 1, y: 2 });
  });

  it('does not pull a block that rests on a matching pressure plate, signal plate, brown button, or block target', () => {
    for (const lockedTerrain of ['pressure_plate_red', 'signal_plate', 'button_brown', 'block_target'] as const) {
      const lvl = room();
      lvl.playerStart = { x: 2, y: 2, dir: 'E' };
      lvl.terrain[2][1] = lockedTerrain;
      lvl.entities = [{ x: 1, y: 2, type: 'dirt_block', dir: 'S' }];

      const engine = new GameEngine();
      engine.loadLevel(lvl);
      engine.getPlayer().boots.add('boots_pull');

      step(engine, 'E');
      expect(engine.getEntities()[0], lockedTerrain).toMatchObject({ x: 1, y: 2 });
    }
  });

  it('still pulls a colour block off a mismatched pressure plate', () => {
    const lvl = room();
    lvl.playerStart = { x: 2, y: 2, dir: 'E' };
    lvl.terrain[2][1] = 'pressure_plate_red';
    lvl.entities = [{ x: 1, y: 2, type: 'color_block_blue', dir: 'S' }];

    const engine = new GameEngine();
    engine.loadLevel(lvl);
    engine.getPlayer().boots.add('boots_pull');

    step(engine, 'E');
    expect(engine.getEntities()[0]).toMatchObject({ x: 2, y: 2 });
  });

  it('does not pull when stepping onto a teleporter', () => {
    const lvl = room();
    lvl.playerStart = { x: 2, y: 2, dir: 'E' };
    lvl.terrain[2][3] = 'teleport';
    lvl.terrain[4][5] = 'teleport';
    lvl.entities = [{ x: 1, y: 2, type: 'dirt_block', dir: 'S' }];

    const engine = new GameEngine();
    engine.loadLevel(lvl);
    engine.getPlayer().boots.add('boots_pull');

    step(engine, 'E');
    expect(engine.getEntities()[0]).toMatchObject({ x: 1, y: 2 });
  });

  it('skips BlockPuzzleSolver dead-end watch and hint when pull boots are held or placed', () => {
    const lvl = room();
    lvl.terrain[2][5] = 'button_brown';
    lvl.items[4][4] = 'boots_pull';
    lvl.entities = [{ x: 1, y: 1, type: 'dirt_block', dir: 'S' }];

    const engine = new GameEngine();
    engine.loadLevel(lvl);
    expect(BlockPuzzleSolver.isStuck(engine)).toBe(false);
    expect(BlockPuzzleSolver.hint(engine)).toBeNull();
  });
});
