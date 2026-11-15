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
import { ROOM_ROW, room, type RoomMode } from '../../test/cc2Room';
import { playMove } from '../../test/cc2Play';
import { GameEngine } from '../GameEngine';

beforeEach(() => {
  loadTestConfigs();
});

const PLAYER_X = 2;
const PUSHED_X = 3;
const NEXT_X = 4;
/** A floor the player and monsters walk and no block enters (a custom wall for blocks). */
const CUSTOM_WALL = 'block_barrier_floor';
const TOOL = 'boots_water';
/** Where the blocks end on a non-CC2 level with the wall cell: the guard does not apply there. */
const CHAIN_OVER_WALL_BLOCK_XS = { cc: [PUSHED_X, NEXT_X + 1], native: [PUSHED_X, NEXT_X + 1] };

interface ChainResult {
  moved: boolean;
  blockXs: number[];
}

/** Pushes a chain of two ice blocks east; the second stands on the given terrain and item. */
function pushChain(mode: RoomMode, terrain?: string, item?: string): ChainResult {
  const engine = new GameEngine();
  const cell = `${NEXT_X},${ROOM_ROW}`;
  engine.loadLevel(
    room({
      mode,
      startX: PLAYER_X,
      terrain: terrain === undefined ? undefined : { [cell]: terrain },
      items: item === undefined ? undefined : { [cell]: item },
      entities: [
        { type: 'ice_block', x: PUSHED_X, y: ROOM_ROW, dir: 'E' },
        { type: 'ice_block', x: NEXT_X, y: ROOM_ROW, dir: 'E' }
      ]
    })
  );
  const moved = playMove(engine, 'E').moved;
  return { moved, blockXs: engine.getEntities().map((block) => block.x) };
}

describe('CC2 push chain terrain guard', () => {
  it('pushes a chain over plain floor', () => {
    expect(pushChain('cc2')).toEqual({ moved: true, blockXs: [PUSHED_X + 1, NEXT_X + 1] });
  });

  it('refuses a chain whose next block stands where the pusher is not let in (the ARTIC2 shape)', () => {
    expect(pushChain('cc2', CUSTOM_WALL)).toEqual({ moved: false, blockXs: [PUSHED_X, NEXT_X] });
  });

  it('still pushes a next block that stands on a tool (the item layer is not read)', () => {
    expect(pushChain('cc2', undefined, TOOL)).toEqual({ moved: true, blockXs: [PUSHED_X + 1, NEXT_X + 1] });
  });

  it('leaves a classic and a native level as they were: the wall cell changes nothing there', () => {
    for (const mode of ['cc', 'native'] as const) {
      expect(pushChain(mode, CUSTOM_WALL).blockXs, mode).toEqual(CHAIN_OVER_WALL_BLOCK_XS[mode]);
    }
  });
});
