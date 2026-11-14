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

/**
 * CC2 engine, wave 10 (PCTT): the block slap refuses a block whose terrain bars the player, judged on the terrain alone
 * (Lexy can_actor_enter_cell checks the tiles before the pushables, game.js:1813-1935). Other levels are unchanged.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { ROOM_ROW, room, type RoomMode } from '../../test/cc2Room';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { GameEngine } from '../GameEngine';
import type { EpoxyContext, EpoxyWorld } from './epoxyWorld';
import { slapBlockAhead } from './epoxyPlayer';

const BLOCK_X = 3;
const BLOCK = 'ice_block';
const CLOSED_TOGGLE_WALL = 'toggle_wall_closed';

beforeEach(() => {
  loadTestConfigs();
});

const world = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;
const contextOf = (engine: GameEngine): EpoxyContext => (engine as unknown as { ctx: EpoxyContext }).ctx;

function load(mode: RoomMode, terrainUnderBlock: string | null): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(
    room({
      mode,
      terrain: terrainUnderBlock === null ? {} : { [`${BLOCK_X},${ROOM_ROW}`]: terrainUnderBlock },
      entities: [{ type: BLOCK, x: BLOCK_X, y: ROOM_ROW, dir: 'E' }]
    })
  );
  while (engine.getPlayer().moveCooldown !== 0) engine.tick();
  return engine;
}

const blockOf = (engine: GameEngine) => world(engine).entities.find((e) => e.type === BLOCK)!;

describe('slapBlockAhead terrain guard', () => {
  it('pushes a block on plain floor', () => {
    const engine = load('cc2', null);
    expect(slapBlockAhead(contextOf(engine), 'E')).toBe(true);
    expect(blockOf(engine).x).toBeGreaterThan(BLOCK_X);
  });

  it('does not slap a block whose terrain bars the player (closed toggle wall)', () => {
    const engine = load('cc2', CLOSED_TOGGLE_WALL);
    slapBlockAhead(contextOf(engine), 'E');
    expect(blockOf(engine).x).toBe(BLOCK_X);
  });

  it('leaves the judgement of other levels to the push itself (the guard is CC2 only)', () => {
    const engine = load('cc', CLOSED_TOGGLE_WALL);
    slapBlockAhead(contextOf(engine), 'E');
    // Measured on the unguarded path: the block moves, as it did before wave 10.
    expect(blockOf(engine).x).toBeGreaterThan(BLOCK_X);
  });
});
