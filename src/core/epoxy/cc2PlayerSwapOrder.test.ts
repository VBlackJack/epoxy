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
 * CC2 engine: the next player to control, on an exit or a swap, is the one before the current one in the actor list, wrapping to
 * the last (Lexy game.js:1377-1415, swap_players walks the list backwards). This applies on levels without the actor order too.
 * The classic and native rules keep the queue order.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { room, ROOM_ROW, type RoomMode } from '../../test/cc2Room';
import { GameEngine } from '../GameEngine';
import { dropExitedController, leaveThroughExit, rotatePlayers } from './epoxyWorld';
import type { EpoxyWorld } from './epoxyWorld';

beforeEach(() => {
  loadTestConfigs();
});

/** Columns of the four players in reading order: the controlled one is the third, the queue holds the other three. */
const CONTROLLED_X = 6;
const QUEUE_XS = [2, 4, 8];
const PREVIOUS_X = 4;
const FIRST_X = 2;
const LAST_X = 8;

const worldOf = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;

function fourPlayers(mode: RoomMode): EpoxyWorld {
  const engine = new GameEngine();
  const base = room({ mode, startX: CONTROLLED_X });
  engine.loadLevel({ ...base, extraPlayers: QUEUE_XS.map((x) => ({ x, y: ROOM_ROW, dir: 'W' as const, character: 'chip' as const })) });
  return worldOf(engine);
}

/** The controlled player leaves by an exit and control passes; returns the column of the new controlled player. */
function exitAndHandOver(w: EpoxyWorld): number {
  leaveThroughExit(w);
  expect(dropExitedController(w)).toBe(true);
  return w.player.x;
}

describe('control after an exit among four players', () => {
  it('passes to the player before the current one in list order on the CC2 engine, then on to the one before', () => {
    const w = fourPlayers('cc2');
    expect(exitAndHandOver(w)).toBe(PREVIOUS_X);
    expect(exitAndHandOver(w)).toBe(FIRST_X);
  });

  it('wraps to the last in the list when nobody is before the current one', () => {
    const w = fourPlayers('cc2');
    const first = w.parked.splice(w.parked.findIndex((p) => p.x === FIRST_X), 1)[0];
    w.parked.push(w.player);
    w.player = first;
    expect(exitAndHandOver(w)).toBe(LAST_X);
  });

  it('passes to the player before the current one on a swap too', () => {
    const w = fourPlayers('cc2');
    expect(rotatePlayers(w)).toBe(true);
    expect(w.player.x).toBe(PREVIOUS_X);
  });

  it('keeps the queue order on a classic-rules and a native level', () => {
    for (const mode of ['cc', 'native'] as const) {
      const w = fourPlayers(mode);
      expect(exitAndHandOver(w)).toBe(QUEUE_XS[0]);
    }
  });
});
