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
 * The logic gates of Chip's Challenge 2 have no collision in Lexy's Labyrinth (tiletypes.js, logic_gate): every actor
 * walks through them. The converter places the passable `<gate>_cc2` forms; the native gates stay impassable.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { GameEngine } from '../GameEngine';
import type { CompiledLevel, Direction, SignalLink } from '../types';

const SIZE = 11;
const ROW = 5;
const MAX_WAIT_TICKS = 40;
const MAX_MONSTER_TICKS = 200;
const PLAYER_X = 2;
const GATE_X = 3;
const BEYOND_X = 4;
const MONSTER_X = 1;
const NATIVE_GATE = 'signal_gate_and';
const CC2_GATE = 'signal_gate_and_cc2';
const CC2_COUNTER = 'signal_counter_3_cc2';
const WIRED_GATE = 'signal_gate_or_cc2';
const PLATE = { x: 6, y: 5 };
const GATE_CELL = { x: 6, y: 3 };
const DOOR = { x: 8, y: 5 };
const OPEN_DOOR = 'hold_door_red_open';
const CLOSED_DOOR = 'hold_door_red_closed';
const PLATE_START = { x: 7, y: 5 };

/** A one-cell-wide lane along the row with one tile on it. */
function lane(tile: string, entities: CompiledLevel['entities'] = []): CompiledLevel {
  const terrain: string[][] = Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x) => (y === ROW && x > 0 && x < SIZE - 1 ? 'floor' : 'wall'))
  );
  terrain[ROW][GATE_X] = tile;
  return {
    id: 'cc2_logic_gates_lane',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    playerStart: { x: PLAYER_X, y: ROW, dir: 'E' },
    terrain,
    items: Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null)),
    entities,
    trapLinks: [],
    cloneLinks: []
  };
}

/** A walled room where a plate feeds a gate that opens a door. */
function wired(gate: string): CompiledLevel {
  const terrain: string[][] = Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x) => (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? 'wall' : 'floor'))
  );
  terrain[PLATE.y][PLATE.x] = 'signal_plate';
  terrain[GATE_CELL.y][GATE_CELL.x] = gate;
  terrain[DOOR.y][DOOR.x] = CLOSED_DOOR;
  const links: SignalLink[] = [
    { fromX: PLATE.x, fromY: PLATE.y, toX: GATE_CELL.x, toY: GATE_CELL.y, port: 'in0' },
    { fromX: GATE_CELL.x, fromY: GATE_CELL.y, toX: DOOR.x, toY: DOOR.y }
  ];
  return {
    id: 'cc2_logic_gates_wired',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    playerStart: { ...PLATE_START, dir: 'W' },
    terrain,
    items: Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null)),
    entities: [],
    trapLinks: [],
    cloneLinks: [],
    signalLinks: links
  };
}

function load(level: CompiledLevel): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(level);
  return engine;
}

function step(engine: GameEngine, dir: Direction): boolean {
  for (let waited = 0; waited <= MAX_WAIT_TICKS; waited++) {
    if (engine.getPlayer().moveCooldown === 0) return engine.attemptPlayerMove(dir);
    engine.tick();
  }
  throw new Error('the player never became able to move');
}

/** The furthest column a monster reaches in the lane, the player waiting at the far end. */
function furthestMonsterX(level: CompiledLevel): number {
  level.playerStart = { x: SIZE - 2, y: ROW, dir: 'W' };
  const engine = load(level);
  let furthest = 0;
  for (let i = 0; i < MAX_MONSTER_TICKS; i++) {
    engine.tick();
    furthest = Math.max(furthest, engine.getEntities().find((e) => e.kind === 'monster')?.x ?? 0);
  }
  return furthest;
}

beforeEach(() => {
  loadTestConfigs();
});

describe('CC2 logic gates let actors through', () => {
  it.each([CC2_GATE, CC2_COUNTER])('lets the player walk across %s', (gate) => {
    const engine = load(lane(gate));
    expect(step(engine, 'E')).toBe(true);
    expect(engine.getPlayer().x).toBe(GATE_X);
    expect(step(engine, 'E')).toBe(true);
    expect(engine.getPlayer().x).toBe(BEYOND_X);
  });

  it('lets a monster cross the gate, where it cannot cross a native gate', () => {
    expect(furthestMonsterX(lane(CC2_GATE, [{ type: 'glider', x: MONSTER_X, y: ROW, dir: 'E' }]))).toBeGreaterThan(GATE_X);
    expect(furthestMonsterX(lane(NATIVE_GATE, [{ type: 'glider', x: MONSTER_X, y: ROW, dir: 'E' }]))).toBeLessThan(GATE_X);
  });

  it('keeps the native gate impassable to the player', () => {
    const engine = load(lane(NATIVE_GATE));
    expect(step(engine, 'E')).toBe(false);
    expect(engine.getPlayer().x).toBe(PLAYER_X);
  });

  it('still carries the signal of its gate: a plate through the CC2 gate opens the door', () => {
    const engine = load(wired(WIRED_GATE));
    expect(engine.getTerrain()[DOOR.y][DOOR.x]).toBe(CLOSED_DOOR);
    expect(step(engine, 'W')).toBe(true);
    expect(engine.getPlayer()).toMatchObject(PLATE);
    expect(engine.getTerrain()[DOOR.y][DOOR.x]).toBe(OPEN_DOOR);
  });
});
