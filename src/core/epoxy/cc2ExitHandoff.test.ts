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
 * On a CC2-engine level with several players, the controlled player who leaves by an exit hands control to the next one only
 * when the exit step ends (Lexy's Labyrinth tiletypes.js exit on_arrive, game.js:1377-1420): the new player waits one walking
 * step before he can decide. The classic and native rules hand control over at once.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { room, ROOM_ROW, type RoomMode } from '../../test/cc2Room';
import { playMove } from '../../test/cc2Play';
import { GameEngine } from '../GameEngine';
import { playerWalkCooldown } from './epoxyPlayer';
import type { EpoxyWorld } from './epoxyWorld';

beforeEach(() => {
  loadTestConfigs();
});

const EXIT_X = 4;
const OTHER_X = 9;
/** Ticks of the wait already counted down by the tick that played the exit step. */
const PLAYED_TICKS = 1;

const world = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;

/** Two players: the controlled one stands next to an exit, the other one further along the row. */
function twoPlayers(mode: RoomMode): GameEngine {
  const engine = new GameEngine();
  const base = room({ mode, startX: EXIT_X - 1, terrain: { [`${EXIT_X},${ROOM_ROW}`]: 'exit' } });
  engine.loadLevel({ ...base, extraPlayers: [{ x: OTHER_X, y: ROOM_ROW, dir: 'W', character: 'chip' }] });
  return engine;
}

describe('control after an exit', () => {
  it('passes to the next player one walking step later on a CC2-engine level', () => {
    const engine = twoPlayers('cc2');
    const wait = playerWalkCooldown(world(engine));
    expect(playMove(engine, 'E').accepted).toBe(true);
    expect(engine.getPlayer().x).toBe(OTHER_X);
    expect(engine.getPlayer().moveCooldown).toBe(wait - PLAYED_TICKS);
    expect(engine.isLevelCompleted()).toBe(false);
    // The new player cannot decide until the exit step has ended.
    expect(engine.attemptPlayerMove('W')).toBe(false);
    for (let t = 0; t < wait; t++) engine.tick();
    expect(engine.getPlayer().moveCooldown).toBe(0);
    expect(engine.attemptPlayerMove('W')).toBe(true);
  });

  it('passes at once on a classic-rules level', () => {
    const engine = twoPlayers('cc');
    expect(engine.attemptPlayerMove('E')).toBe(true);
    expect(engine.getPlayer().x).toBe(OTHER_X);
    expect(engine.getPlayer().moveCooldown).toBe(0);
    expect(engine.attemptPlayerMove('W')).toBe(true);
  });

  it('passes at once on a native level', () => {
    const engine = twoPlayers('native');
    expect(engine.attemptPlayerMove('E')).toBe(true);
    expect(engine.getPlayer().x).toBe(OTHER_X);
    expect(engine.getPlayer().moveCooldown).toBe(0);
  });

  it('does not delay the end of the level when the last player leaves', () => {
    const engine = new GameEngine();
    engine.loadLevel(room({ mode: 'cc2', startX: EXIT_X - 1, terrain: { [`${EXIT_X},${ROOM_ROW}`]: 'exit' } }));
    expect(playMove(engine, 'E').accepted).toBe(true);
    expect(engine.isLevelCompleted()).toBe(true);
  });
});
