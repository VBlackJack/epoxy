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

import { ConfigRegistry } from '../../config/ConfigRegistry';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { GameEngine } from '../GameEngine';
import type { CompiledLevel, Direction, SignalLink } from '../types';

const SIZE = 11;
const MAX_WAIT_TICKS = 40;
const OPEN_DOOR = 'hold_door_red_open';
const CLOSED_DOOR = 'hold_door_red_closed';
const DOOR = { x: 8, y: 5 };
const PLATE_A = { x: 2, y: 5 };
const PLATE_B = { x: 7, y: 5 };
const GATE = { x: 5, y: 2 };
const PLAYER_START = { x: 6, y: 5 };

const link = (from: { x: number; y: number }, to: { x: number; y: number }): SignalLink => ({
  fromX: from.x,
  fromY: from.y,
  toX: to.x,
  toY: to.y
});

/** Two signal plates into an AND gate into a red hold door; a block rests on plate A when `blockOnA`. */
function andLevel(blockOnA: boolean): CompiledLevel {
  const terrain: string[][] = Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x) => (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? 'wall' : 'floor'))
  );
  terrain[DOOR.y][DOOR.x] = CLOSED_DOOR;
  terrain[PLATE_A.y][PLATE_A.x] = 'signal_plate';
  terrain[PLATE_B.y][PLATE_B.x] = 'signal_plate';
  terrain[GATE.y][GATE.x] = 'signal_gate_and';
  return {
    id: 'signal_tiles_room',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 100,
    chipsRequired: 0,
    playerStart: { ...PLAYER_START, dir: 'E' },
    terrain,
    items: Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null)),
    entities: blockOnA ? [{ type: 'dirt_block', x: PLATE_A.x, y: PLATE_A.y, dir: 'N' }] : [],
    trapLinks: [],
    cloneLinks: [],
    signalLinks: [link(PLATE_A, GATE), link(PLATE_B, GATE), link(GATE, DOOR)]
  };
}

/** Ticks until the player may move, then moves. */
function step(engine: GameEngine, dir: Direction): boolean {
  for (let waited = 0; waited <= MAX_WAIT_TICKS; waited++) {
    if (engine.getPlayer().moveCooldown === 0) return engine.attemptPlayerMove(dir);
    engine.tick();
  }
  throw new Error('the player never became able to move');
}

function load(level: CompiledLevel): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(level);
  return engine;
}

beforeEach(() => loadTestConfigs());

describe('shipped signal tiles', () => {
  it('defines a passable laser-transparent plate and impassable opaque gates', () => {
    const plate = ConfigRegistry.getTile('signal_plate');
    expect(plate.signalSource).toBe('held');
    expect(plate.passableByPlayer && plate.passableByMonster && plate.passableByBlock && plate.laserTransparent).toBe(true);
    const gates: Record<string, string> = {
      signal_gate_and: 'and',
      signal_gate_or: 'or',
      signal_gate_not: 'not',
      signal_gate_xor: 'xor',
      signal_latch_off: 'latch',
      signal_latch_on: 'latch'
    };
    for (const [id, logic] of Object.entries(gates)) {
      const tile = ConfigRegistry.getTile(id);
      expect(tile.signalGate, id).toBe(logic);
      expect(tile.category, id).toBe('mechanisms');
      expect(tile.passableByPlayer || tile.passableByMonster || tile.passableByBlock || tile.laserTransparent, id).toBe(false);
    }
    expect(ConfigRegistry.getTile('signal_latch_on').signalLatchStartsOn).toBe(true);
    expect(ConfigRegistry.getTile('signal_latch_off').signalLatchStartsOn).toBeUndefined();
  });
});

describe('two signal plates into an AND gate into a hold door', () => {
  it('opens the door only while both plates are occupied', () => {
    const both = load(andLevel(true));
    expect(both.getTerrain()[DOOR.y][DOOR.x]).toBe(CLOSED_DOOR);
    expect(step(both, 'E')).toBe(true);
    expect(both.getPlayer().x).toBe(PLATE_B.x);
    expect(both.getTerrain()[DOOR.y][DOOR.x]).toBe(OPEN_DOOR);
    expect(step(both, 'W')).toBe(true);
    expect(both.getTerrain()[DOOR.y][DOOR.x]).toBe(CLOSED_DOOR);

    const alone = load(andLevel(false));
    expect(step(alone, 'E')).toBe(true);
    expect(alone.getTerrain()[DOOR.y][DOOR.x]).toBe(CLOSED_DOOR);
  });
});
