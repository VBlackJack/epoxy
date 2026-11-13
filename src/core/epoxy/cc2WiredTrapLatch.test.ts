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
 * CC2 engine: a wired trap reads the power latched at the tick-phase settle (Lexy runs its wire phase after the decisions and
 * its trap opens by power with no ejection), so the settle that follows the player's move cannot close it before the trapped
 * monster decides; a trap whose wire is on at load is open from tick 0.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { ROOM_ROW, room } from '../../test/cc2Room';
import type { RoomMode } from '../../test/cc2Room';
import { GameEngine } from '../GameEngine';
import type { CompiledLevel } from '../types';

const PLATE = 'signal_plate';
const TRAP = 'trap_wired';
const MONSTER = 'glider';
const PLATE_X = 3;
const TRAP_X = 8;
const START_X = 2;
const SEED = 3;
const MAX_WAIT_TICKS = 40;
const SETTLE_TICKS = 6;

function level(mode: RoomMode, startX: number): CompiledLevel {
  const built = room({
    mode,
    startX,
    terrain: { [`${PLATE_X},${ROOM_ROW}`]: PLATE, [`${TRAP_X},${ROOM_ROW}`]: TRAP },
    entities: [{ type: MONSTER, x: TRAP_X, y: ROOM_ROW, dir: 'W' }]
  });
  built.signalLinks = [{ fromX: PLATE_X, fromY: ROOM_ROW, toX: TRAP_X, toY: ROOM_ROW }];
  return built;
}

function load(mode: RoomMode, startX: number): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(level(mode, startX), SEED);
  return engine;
}

const monsterX = (engine: GameEngine): number => engine.getEntities().find((e) => e.type === MONSTER)?.x ?? Number.NaN;

function waitForRest(engine: GameEngine): void {
  for (let waited = 0; waited < MAX_WAIT_TICKS && engine.getPlayer().moveCooldown > 0; waited++) engine.tick();
}

beforeEach(() => {
  loadTestConfigs();
});

describe('a wired trap on the CC2 engine', () => {
  it('lets the monster leave in tick 0 when its wire is on at load', () => {
    const engine = load('cc2', PLATE_X);
    expect(engine.isCellClosedTrap(TRAP_X, ROOM_ROW)).toBe(false);
    engine.tick();
    expect(monsterX(engine)).toBeLessThan(TRAP_X);
  });

  it('keeps the monster in while the wire is off', () => {
    const engine = load('cc2', START_X);
    for (let i = 0; i < SETTLE_TICKS; i++) engine.tick();
    expect(engine.isCellClosedTrap(TRAP_X, ROOM_ROW)).toBe(true);
    expect(monsterX(engine)).toBe(TRAP_X);
  });

  it('still releases the monster when the power is gone again in the same tick', () => {
    const engine = load('cc2', START_X);
    expect(engine.attemptPlayerMove('E')).toBe(true);
    waitForRest(engine);
    expect(engine.getPlayer().x).toBe(PLATE_X);
    // The tick that ended the step powered the trap at its settle; stepping off settles the wire off at once.
    expect(engine.attemptPlayerMove('E')).toBe(true);
    expect(monsterX(engine)).toBe(TRAP_X);
    engine.tick();
    expect(monsterX(engine)).toBeLessThan(TRAP_X);
  });

  it('is unchanged on a level that is not on the CC2 engine', () => {
    for (const mode of ['cc', 'native'] as const) {
      const engine = load(mode, PLATE_X);
      engine.tick();
      expect(monsterX(engine)).toBeLessThanOrEqual(TRAP_X);
      const stepping = load(mode, START_X);
      stepping.attemptPlayerMove('E');
      waitForRest(stepping);
      stepping.attemptPlayerMove('E');
      stepping.tick();
      expect(stepping.isCellClosedTrap(TRAP_X, ROOM_ROW)).toBe(true);
    }
  });
});
