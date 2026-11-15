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
 * CC2 engine, wave 12 (RCH): each block of a chain push is pushed from its own cell, so a track under a member turns that
 * member's step (Lexy attempt_step of the pushed block redirects by its cell, game.js:2153-2168, and the push recurses through
 * can_actor_enter_cell, game.js:1801-1805). A chain the tracks bend back onto itself is refused (Lexy _being_pushed,
 * game.js:1941-1946); a frame block its own track turns keeps its arrows turned with it (frame_block on_rotate). Other levels
 * keep the straight line.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { ROOM_ROW, room, type RoomMode } from '../../test/cc2Room';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { playMove } from '../../test/cc2Play';
import { GameEngine } from '../GameEngine';
import { RAIL_JUNCTION_TILE_ID } from '../coreConstants';
import type { Direction, EntityPlacement, RailTrackCell } from '../types';
import type { EpoxyWorld } from './epoxyWorld';

const PLAYER_X = 4;
const FIRST_X = 5;
const SETTLE_TICKS = 40;
const ICE = 'ice_block';
const ONE_ARROW_BLOCK = 'arrow_block_one';
/** Segment bits of a track cell (index in RAIL_TRACK_SIDES): south-east, south-west and north-west. */
const SE = 1 << 1;
const SW = 1 << 2;
const NW = 1 << 3;

interface Track {
  x: number;
  y: number;
  mask: number;
  entry: Direction;
}

const world = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;

function load(mode: RoomMode, entities: EntityPlacement[], tracks: Track[]): GameEngine {
  const terrain: Record<string, string> = {};
  for (const t of tracks) terrain[`${t.x},${t.y}`] = RAIL_JUNCTION_TILE_ID;
  const base = room({ mode, startX: PLAYER_X, terrain, entities });
  const railTracks: RailTrackCell[] = tracks.map((t) => ({ x: t.x, y: t.y, mask: t.mask }));
  const engine = new GameEngine();
  engine.loadLevel({ ...base, railTracks });
  const w = world(engine);
  const width = w.terrain[0].length;
  // The side the last actor came in by: set to the side the push comes from, as a block pushed into the cell would leave it.
  for (const t of tracks) {
    const state = w.railCells.get(t.y * width + t.x);
    if (state) state.entry = t.entry;
  }
  return engine;
}

function pushEast(engine: GameEngine): void {
  for (let waited = 0; engine.getPlayer().moveCooldown !== 0 && waited < SETTLE_TICKS; waited++) engine.tick();
  playMove(engine, 'E');
  for (let i = 0; i < SETTLE_TICKS; i++) engine.tick();
}

const blocksOf = (engine: GameEngine, type: string) => engine.getEntities().filter((e) => e.type === type).sort((a, b) => a.uid - b.uid);

beforeEach(() => {
  loadTestConfigs();
});

describe('RCH: a chain push over a track', () => {
  const row = (type: string): EntityPlacement[] => [0, 1, 2].map((i) => ({ type, x: FIRST_X + i, y: ROOM_ROW, dir: 'E' }));
  const lastX = FIRST_X + 2;

  it('turns the last block of a row onto the track while the others go straight on', () => {
    const engine = load('cc2', row(ICE), [{ x: lastX, y: ROOM_ROW, mask: NW, entry: 'W' }]);
    pushEast(engine);
    const blocks = blocksOf(engine, ICE);
    // The last block stands on a track turning the east push north (Lexy game.js:2153-2168).
    expect(blocks[2]).toMatchObject({ x: lastX, y: ROOM_ROW - 1 });
    expect(blocks[1]).toMatchObject({ x: lastX, y: ROOM_ROW });
    expect(blocks[0]).toMatchObject({ x: lastX - 1, y: ROOM_ROW });
  });

  it('keeps the straight line outside the CC2 engine', () => {
    for (const mode of ['cc', 'native'] as RoomMode[]) {
      const engine = load(mode, row(ICE), [{ x: lastX, y: ROOM_ROW, mask: NW, entry: 'W' }]);
      pushEast(engine);
      const blocks = blocksOf(engine, ICE);
      // No block went north off its row (the old planning runs one straight line).
      expect(blocks.every((b) => b.y === ROOM_ROW), mode).toBe(true);
    }
  });

  it('refuses a push whose tracks bend the chain back onto itself, and terminates', () => {
    // A (5,5) -> B (6,5) turned north -> C (6,4) turned west -> D (5,4) turned south -> back onto A (game.js:1941-1946).
    const entities: EntityPlacement[] = [
      { type: ICE, x: 5, y: ROOM_ROW, dir: 'E' },
      { type: ICE, x: 6, y: ROOM_ROW, dir: 'E' },
      { type: ICE, x: 6, y: ROOM_ROW - 1, dir: 'E' },
      { type: ICE, x: 5, y: ROOM_ROW - 1, dir: 'E' }
    ];
    const engine = load('cc2', entities, [
      { x: 6, y: ROOM_ROW, mask: NW, entry: 'W' },
      { x: 6, y: ROOM_ROW - 1, mask: SW, entry: 'S' },
      { x: 5, y: ROOM_ROW - 1, mask: SE, entry: 'E' }
    ]);
    pushEast(engine);
    const blocks = blocksOf(engine, ICE);
    expect(blocks.map((b) => [b.x, b.y])).toEqual([
      [5, ROOM_ROW],
      [6, ROOM_ROW],
      [6, ROOM_ROW - 1],
      [5, ROOM_ROW - 1]
    ]);
    expect(engine.getPlayer().x).toBe(PLAYER_X);
  });

  it('turns the arrows of a frame block its own track turns, judged by the way its pusher goes', () => {
    const entities: EntityPlacement[] = [
      { type: ICE, x: FIRST_X, y: ROOM_ROW, dir: 'E' },
      { type: ONE_ARROW_BLOCK, x: FIRST_X + 1, y: ROOM_ROW, dir: 'E' }
    ];
    const engine = load('cc2', entities, [{ x: FIRST_X + 1, y: ROOM_ROW, mask: NW, entry: 'W' }]);
    pushEast(engine);
    // The east arrow allows the east push of the ice block; the track then turns the step north and the arrow with it.
    expect(blocksOf(engine, ONE_ARROW_BLOCK)[0]).toMatchObject({ x: FIRST_X + 1, y: ROOM_ROW - 1, facing: 'N' });
    expect(blocksOf(engine, ICE)[0]).toMatchObject({ x: FIRST_X + 1, y: ROOM_ROW });
  });
});
