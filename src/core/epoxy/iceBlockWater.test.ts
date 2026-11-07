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

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { GameEngine } from '../GameEngine';
import { CompiledLevel } from '../types';

const SIZE = 9;
const ROW = 4;
const PLAYER_X = 2;
const BLOCK_X = 3;
const WATER_X = 4;
/** Ticks run before each move so the move cooldown has elapsed. */
const COOLDOWN_TICKS = 12;
/** Upper bound of ticks a slide needs to settle in this small room. */
const SETTLE_TICKS = 80;

/** Walled room: player, a pushable block, one water cell, then floor. */
function room(blockType: string, hazard: string): CompiledLevel {
  const terrain: string[][] = Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x) => (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? 'wall' : 'floor'))
  );
  terrain[ROW][WATER_X] = hazard;
  return {
    id: 'ice_block_water',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    playerStart: { x: PLAYER_X, y: ROW, dir: 'E' },
    terrain,
    items: Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null)),
    entities: [{ x: BLOCK_X, y: ROW, type: blockType, dir: 'E' }],
    trapLinks: [],
    cloneLinks: []
  };
}

function push(engine: GameEngine): void {
  for (let i = 0; i < COOLDOWN_TICKS; i++) engine.tick();
  engine.attemptPlayerMove('E');
  for (let i = 0; i < SETTLE_TICKS; i++) engine.tick();
}

beforeEach(() => {
  loadTestConfigs();
});

describe('ice block pushed into water', () => {
  it('turns the water into ice, is used up, and leaves a cell the player can walk', () => {
    const engine = new GameEngine();
    engine.loadLevel(room('ice_block', 'water'));
    push(engine);
    expect(engine.getTerrain()[ROW][WATER_X]).toBe('ice');
    expect(engine.getEntities().filter((e) => e.type === 'ice_block')).toHaveLength(0);
    // Walk over the new ice: the player crosses it and stays alive.
    for (let i = 0; i < 4; i++) {
      for (let t = 0; t < COOLDOWN_TICKS; t++) engine.tick();
      engine.attemptPlayerMove('E');
      for (let t = 0; t < SETTLE_TICKS; t++) engine.tick();
    }
    expect(engine.getPlayer().alive).toBe(true);
    expect(engine.getPlayer().x).toBeGreaterThan(WATER_X);
  });

  it('still fills water with dirt for a dirt block', () => {
    const engine = new GameEngine();
    engine.loadLevel(room('dirt_block', 'water'));
    push(engine);
    expect(engine.getTerrain()[ROW][WATER_X]).toBe('dirt');
  });

  it('still melts fire into water for an ice block', () => {
    const engine = new GameEngine();
    engine.loadLevel(room('ice_block', 'fire'));
    push(engine);
    expect(engine.getTerrain()[ROW][WATER_X]).toBe('water');
    expect(engine.getEntities().filter((e) => e.type === 'ice_block')).toHaveLength(0);
  });
});
