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
 * A block of a CC2-engine level that lands on a slide cell carries the cc2SlideArrived marker (Lexy current_slide_mode,
 * game.js:187), and loses it once it lands elsewhere. Other levels never set it.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { ROOM_ROW, room, type RoomMode } from '../../test/cc2Room';
import { GameEngine } from '../GameEngine';

beforeEach(() => {
  loadTestConfigs();
});

const START_X = 2;
const BLOCK_X = 3;
const ICE_X = 4;
/** Ticks that outlast the push and the slide off the ice. */
const MAX_TICKS = 60;

interface Trace {
  onIce: boolean | undefined;
  afterIce: boolean | undefined;
  left: boolean;
  everSet: boolean;
}

/** Pushes a dirt block east onto one ice cell and records the marker while it stands there and once it has left. */
function trace(mode: RoomMode): Trace {
  const engine = new GameEngine();
  engine.loadLevel(
    room({ mode, startX: START_X, terrain: { [`${ICE_X},${ROOM_ROW}`]: 'ice' }, entities: [{ type: 'dirt_block', x: BLOCK_X, y: ROOM_ROW, dir: 'E' }] })
  );
  engine.attemptPlayerMove('E');
  const result: Trace = { onIce: undefined, afterIce: undefined, left: false, everSet: false };
  for (let t = 0; t < MAX_TICKS; t++) {
    engine.tick();
    const block = engine.getEntities()[0];
    if (block.cc2SlideArrived !== undefined) result.everSet = true;
    if (block.x === ICE_X) result.onIce = block.cc2SlideArrived;
    if (block.x > ICE_X) {
      result.left = true;
      result.afterIce = block.cc2SlideArrived;
    }
  }
  return result;
}

describe('cc2SlideArrived on a block', () => {
  it('is set when a CC2-engine block lands on ice and deleted when it lands on floor', () => {
    const result = trace('cc2');
    expect(result.left).toBe(true);
    expect(result.onIce).toBe(true);
    expect(result.afterIce).toBeUndefined();
  });

  it('is never set on a classic-rules or a native level', () => {
    for (const mode of ['cc', 'native'] as const) expect(trace(mode).everSet, mode).toBe(false);
  });
});
