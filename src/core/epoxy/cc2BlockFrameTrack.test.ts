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
 * CC2 engine: a frame (arrow) block on a track cell is judged on its arrows for the way it was pushed, then the track
 * turns it, and the arrows turn with it (Lexy frame_block on_rotate; game.js redirect_exit). Other levels judge the
 * redirected way and leave the arrows alone.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { ROOM_ROW, room, type RoomMode } from '../../test/cc2Room';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { GameEngine } from '../GameEngine';
import { RAIL_JUNCTION_TILE_ID } from '../coreConstants';
import type { CompiledLevel, Direction, RailTrackCell } from '../types';

const BLOCK_X = 4;
const PLAYER_X = 3;
const MAX_WAIT_TICKS = 40;
const SETTLE_TICKS = 60;
/** Segment bits of a track cell: east-west and north-south. */
const EW = 1 << 4;
const NS = 1 << 5;
const ONE_ARROW_BLOCK = 'arrow_block_one';

function level(mode: RoomMode, blockType: string, facing: Direction): CompiledLevel {
  const track: RailTrackCell = { x: BLOCK_X, y: ROOM_ROW, mask: NS | EW };
  const base = room({
    mode,
    startX: PLAYER_X,
    terrain: { [`${BLOCK_X},${ROOM_ROW}`]: RAIL_JUNCTION_TILE_ID },
    entities: [{ type: blockType, x: BLOCK_X, y: ROOM_ROW, dir: facing }]
  });
  return { ...base, railTracks: [track] };
}

function pushEast(mode: RoomMode, blockType: string, facing: Direction) {
  const engine = new GameEngine();
  engine.loadLevel(level(mode, blockType, facing));
  for (let waited = 0; engine.getPlayer().moveCooldown !== 0; waited++) {
    if (waited > MAX_WAIT_TICKS) throw new Error('the player never became able to move');
    engine.tick();
  }
  engine.attemptPlayerMove('E');
  for (let i = 0; i < SETTLE_TICKS; i++) engine.tick();
  return engine.getEntities().find((e) => e.type === blockType);
}

beforeEach(() => {
  loadTestConfigs();
});

describe('CC2 engine: a frame block on a track', () => {
  it('is judged on the way pushed, moves where the track turns it, and its arrows turn with it', () => {
    // The track turns the east push south (a quarter turn clockwise); the block has an east arrow only.
    const block = pushEast('cc2', ONE_ARROW_BLOCK, 'E');
    expect(block).toMatchObject({ x: BLOCK_X, y: ROOM_ROW + 1, facing: 'S' });
  });

  it('is refused when its arrows do not allow the way pushed, whatever the track would do', () => {
    // Facing north, the single arrow does not point east: the push is refused before the track is asked.
    const block = pushEast('cc2', ONE_ARROW_BLOCK, 'N');
    expect(block).toMatchObject({ x: BLOCK_X, y: ROOM_ROW });
  });

  it('keeps the old judgement outside the CC2 engine: the redirected way is judged, the arrows stay', () => {
    for (const mode of ['cc', 'native'] as RoomMode[]) {
      // The redirect sends the push south, where the east arrow does not allow it.
      expect(pushEast(mode, ONE_ARROW_BLOCK, 'E'), mode).toMatchObject({ x: BLOCK_X, y: ROOM_ROW });
      // Facing south the arrow allows the redirected way, and the block moves with its facing unturned.
      expect(pushEast(mode, ONE_ARROW_BLOCK, 'S'), mode).toMatchObject({ x: BLOCK_X, y: ROOM_ROW + 1, facing: 'S' });
    }
  });
});
