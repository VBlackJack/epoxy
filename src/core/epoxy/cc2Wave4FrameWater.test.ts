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
 * CC2 wave 4: water that swallows a frame (arrow) block becomes floor, not dirt (Lexy water.on_arrive). Other levels keep dirt.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { room, ROOM_ROW, type RoomMode } from '../../test/cc2Room';
import { GameEngine } from '../GameEngine';
import type { EpoxyWorld } from './epoxyWorld';

beforeEach(() => {
  loadTestConfigs();
});

const world = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;

const ICE_X = 5;

describe('CC2 engine: a frame block sunk in water leaves floor', () => {
  const FRAME = 'arrow_block_one';
  const WATER_X = ICE_X + 1;
  const PUSHER_X = ICE_X - 2;
  const PUSH_TURNS = 40;

  /** Pushes the block into the water and returns what the water became on the tick the block sank. */
  function pushIntoWater(mode: RoomMode, block: string): string {
    const level = room({
      mode,
      startX: PUSHER_X,
      terrain: { [`${WATER_X},${ROOM_ROW}`]: 'water' },
      entities: [{ type: block, x: ICE_X, y: ROOM_ROW, dir: 'E' }]
    });
    const engine = new GameEngine();
    engine.loadLevel(level);
    for (let i = 0; i < PUSH_TURNS; i += 1) {
      engine.attemptPlayerMove('E');
      engine.tick();
      if (!world(engine).entities.some((e) => e.type === block)) break;
    }
    return world(engine).terrain[ROOM_ROW][WATER_X];
  }

  it('turns the water into floor', () => {
    expect(pushIntoWater('cc2', FRAME)).toBe('floor');
  });

  it('leaves dirt for a dirt block, and for a frame block outside the CC2 engine', () => {
    expect(pushIntoWater('cc2', 'dirt_block')).not.toBe('floor');
    expect(pushIntoWater('native', FRAME)).not.toBe('floor');
    expect(pushIntoWater('cc', FRAME)).not.toBe('floor');
  });
});
