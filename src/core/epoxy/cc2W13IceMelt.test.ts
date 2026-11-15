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
 * CC2 engine: a fireball whose forced ice slide bumps an ice block melts it, and the step stays blocked and bounces (Lexy
 * ice_block.on_after_bumped, tiletypes.js:1386-1395; game.js:1166-1200 bonk). Not modelled: the double bonk, where a bounce that an ice
 * block also blocks melts the second block too (game.js:1197-1200).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { ROOM_ROW, room, type RoomMode } from '../../test/cc2Room';
import { GameEngine } from '../GameEngine';
import type { EpoxyWorld } from './epoxyWorld';

beforeEach(() => {
  loadTestConfigs();
});

const FIREBALL_X = 5;
const BLOCK_X = FIREBALL_X + 1;
const ICE_TICKS = 6;
const ICE_BLOCK = 'ice_block';

const world = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;

/** A fireball facing east on ice with an ice block resting in the next cell. */
function slide(mode: RoomMode): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(
    room({
      mode,
      startX: 1,
      terrain: { [`${FIREBALL_X},${ROOM_ROW}`]: 'ice' },
      entities: [
        { type: 'fireball', x: FIREBALL_X, y: ROOM_ROW, dir: 'E' },
        { type: ICE_BLOCK, x: BLOCK_X, y: ROOM_ROW, dir: 'E' }
      ]
    })
  );
  for (const loaded of engine.getEntities()) delete loaded.atLoadCell;
  return engine;
}

describe('fireball forced on an ice block', () => {
  it('melts the block it bumps on ice and stays blocked (tiletypes.js:1386-1395)', () => {
    const engine = slide('cc2');
    for (let i = 0; i < ICE_TICKS && world(engine).entities.some((e) => e.type === ICE_BLOCK); i++) engine.tick();
    expect(world(engine).entities.some((e) => e.type === ICE_BLOCK)).toBe(false);
    expect(world(engine).terrain[ROOM_ROW][BLOCK_X]).not.toBe('floor');
    // The step was blocked: the fireball bounced back off the ice, it never reached the melted cell.
    const fireball = world(engine).entities.find((e) => e.type === 'fireball');
    expect(fireball?.x).toBeLessThan(BLOCK_X);
  });

  it('a classic-rules level and a native level keep the block', () => {
    for (const mode of ['cc', 'native'] as const) {
      const engine = slide(mode);
      for (let i = 0; i < ICE_TICKS; i++) engine.tick();
      expect(world(engine).entities.some((e) => e.type === ICE_BLOCK)).toBe(true);
    }
  });
});
