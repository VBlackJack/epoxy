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
 * Wave 12, ROV and DG: the CC2 rover is outside Lexy's monster_typical collision set (defs.js:104-107), so CC2 dirt, the tool thief
 * and the blue fake wall do not bar it (dirt 822-849, fake_floor 542-560, thief_tools 1236-1250, rover 2972-2977); a native or CC1 rover
 * stays barred. The rolling ball reveals the blue fake wall on arrival through the same opening step.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { room, ROOM_ROW, type RoomMode } from '../../test/cc2Room';
import { GameEngine } from '../GameEngine';

beforeEach(() => {
  loadTestConfigs();
});

const ROVER_CELL = { x: 6, y: ROOM_ROW };
const AHEAD_CELL = { x: 7, y: ROOM_ROW };
/** The rover imitates the fireball: it goes straight on while it may. */
const FIREBALL_EMULATEE = 5;
/** Two steps of the slowest rover (native: interval + 1 ticks, CC2: 8 ticks) plus slack. */
const RUN_TICKS = 40;

interface Outcome {
  reachedAhead: boolean;
  terrainAhead: string;
}

function run(mode: RoomMode, type: string, aheadTile: string): Outcome {
  const engine = new GameEngine();
  engine.loadLevel(room({ mode, terrain: { [`${AHEAD_CELL.x},${AHEAD_CELL.y}`]: aheadTile }, entities: [{ type, x: ROVER_CELL.x, y: ROVER_CELL.y, dir: 'E' }] }));
  const rover = engine.getEntities().find((e) => e.type === type);
  if (rover === undefined) throw new Error('the monster is missing');
  if (type === 'rover') {
    rover.emulatee = FIREBALL_EMULATEE;
    rover.emulationMoves = 0;
  }
  let reachedAhead = false;
  for (let tick = 0; tick < RUN_TICKS; tick++) {
    engine.tick();
    const now = engine.getEntities().find((e) => e.type === type);
    if (now?.x === AHEAD_CELL.x && now.y === AHEAD_CELL.y) reachedAhead = true;
  }
  return { reachedAhead, terrainAhead: engine.getTerrain()[AHEAD_CELL.y][AHEAD_CELL.x] };
}

describe('a rover on the CC2 engine crosses the tiles that do not bar it', () => {
  it('packs CC2 dirt down as it steps on it (Lexy dirt blocks only player2: tiletypes.js:822-849)', () => {
    const out = run('cc2', 'rover', 'dirt_cc2');
    expect(out.reachedAhead).toBe(true);
    expect(out.terrainAhead).toBe('floor');
  });

  it('reveals a blue fake wall as it steps on it (fake_floor is a bump reveal, rover can_reveal_walls: tiletypes.js:542-560 on_bumped)', () => {
    const out = run('cc2', 'rover', 'blue_wall_fake');
    expect(out.reachedAhead).toBe(true);
    expect(out.terrainAhead).toBe('floor');
  });

  it('walks onto the tool thief (the thief takes a bribe, it does not block: tiletypes.js:1236-1250, 2972-2977)', () => {
    const out = run('cc2', 'rover', 'thief');
    expect(out.reachedAhead).toBe(true);
  });

  it('stays barred by CC2 dirt, the thief and the blue fake wall on a native level', () => {
    for (const tile of ['dirt_cc2', 'thief', 'blue_wall_fake']) {
      const out = run('native', 'rover', tile);
      expect(out.reachedAhead, tile).toBe(false);
      expect(out.terrainAhead, tile).toBe(tile);
    }
  });

  it('stays barred by them on a classic (CC1) level too', () => {
    for (const tile of ['dirt_cc2', 'thief', 'blue_wall_fake']) {
      const out = run('cc', 'rover', tile);
      expect(out.reachedAhead, tile).toBe(false);
      expect(out.terrainAhead, tile).toBe(tile);
    }
  });

  it('keeps a native rover on the tiles it always crossed (dirt)', () => {
    const out = run('native', 'rover', 'dirt');
    expect(out.reachedAhead).toBe(true);
    expect(out.terrainAhead).toBe('floor');
  });
});

describe('a rolling ball on the CC2 engine reveals the blue fake wall (DG)', () => {
  it('steps onto it and leaves floor behind (the ball is COLLISION.bowling_ball, outside the fake wall bar: tiletypes.js:542-560)', () => {
    const out = run('cc2', 'rolling_ball', 'blue_wall_fake');
    expect(out.reachedAhead).toBe(true);
    expect(out.terrainAhead).toBe('floor');
  });
});

describe('a rolling ball on the CC2 engine crosses a pop-up wall (DG)', () => {
  it('walks in and the wall pops up behind it (the ball is admitted by popup_wall_cc2, the cell turns to wall once it has left)', () => {
    const out = run('cc2', 'rolling_ball', 'popup_wall_cc2');
    expect(out.reachedAhead).toBe(true);
    expect(out.terrainAhead).toBe('wall');
  });
});
