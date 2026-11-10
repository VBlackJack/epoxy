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

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { GameEngine } from '../GameEngine';
import type { CompiledLevel } from '../types';

/**
 * A sliding block of the CC3D kind (stopsAtWall) is refused by the player in its way and stops in front of him, as in
 * CC3D; the native blocks keep crushing him. The CC3D side of the same rule is played in cc3dEvidenceBlockGaps.test.ts.
 */

const SIZE = 9;
const ROW = 4;
const PLAYER_X = 2;
const SLIDER_X = 6;
const MAX_TICKS = 40;

const CC3D_BLOCKS = ['dirt_block_3d', 'ice_block_3d', 'color_block_3d_red'] as const;
const NATIVE_BLOCKS = ['dirt_block', 'ice_block', 'color_block_red'] as const;

beforeEach(() => {
  loadTestConfigs();
});

function level(blockType: string): CompiledLevel {
  const terrain: string[][] = Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x) => {
      if (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1) return 'wall';
      return y === ROW && x >= PLAYER_X + 1 ? 'ice' : 'floor';
    })
  );
  return {
    id: 'stop_at_player',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 100,
    chipsRequired: 0,
    playerStart: { x: PLAYER_X, y: ROW, dir: 'E' },
    terrain,
    items: Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null)),
    entities: [{ type: blockType, x: SLIDER_X, y: ROW, dir: 'W' }],
    trapLinks: [],
    cloneLinks: []
  };
}

function slidingWest(blockType: string): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(level(blockType));
  const block = engine.getEntities().find((e) => e.kind === 'block');
  if (!block) throw new Error('no block');
  block.isSliding = true;
  block.dir = 'W';
  block.cooldownTicks = 0;
  return engine;
}

function blockOf(engine: GameEngine) {
  const block = engine.getEntities().find((e) => e.kind === 'block');
  if (!block) throw new Error('the block is gone');
  return block;
}

describe('a sliding block against the player', () => {
  for (const type of CC3D_BLOCKS) {
    it(`${type} on ice stops in front of the standing player`, () => {
      const engine = slidingWest(type);
      for (let i = 0; i < MAX_TICKS; i++) engine.tick();
      expect(engine.getPlayer().alive).toBe(true);
      expect(blockOf(engine).x).toBe(PLAYER_X + 1);
      expect(blockOf(engine).isSliding).toBe(false);
    });

    it(`${type} on ice stops in front of the player who steps into its path`, () => {
      const engine = slidingWest(type);
      // The player is out of the lane until the block is near, then steps in front of it.
      engine.getPlayer().y = ROW - 1;
      engine.tick();
      engine.tick();
      engine.getPlayer().y = ROW;
      for (let i = 0; i < MAX_TICKS; i++) engine.tick();
      expect(engine.getPlayer().alive).toBe(true);
      expect(blockOf(engine).x).toBe(PLAYER_X + 1);
    });
  }

  for (const type of NATIVE_BLOCKS) {
    it(`${type} is unchanged: it still crushes the player`, () => {
      const engine = slidingWest(type);
      for (let i = 0; i < MAX_TICKS; i++) engine.tick();
      expect(engine.getPlayer().alive).toBe(false);
    });
  }
});
