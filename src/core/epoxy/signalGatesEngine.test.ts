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
import { serializePack } from '../../packs/packJson';
import { GameEngine } from '../GameEngine';
import { usesSignalPorts } from '../signalLinks';
import type { CompiledLevel, Direction, SignalLink } from '../types';

const SIZE = 11;
const MAX_WAIT_TICKS = 40;
const OPEN_DOOR = 'hold_door_red_open';
const CLOSED_DOOR = 'hold_door_red_closed';
const DOOR = { x: 8, y: 5 };
const BUTTON = { x: 5, y: 5 };
const COUNTER = { x: 5, y: 2 };
const NAND = { x: 5, y: 3 };
const WIRE_FLOOR = { x: 3, y: 5 };
const BOLT = { x: 4, y: 5 };
const PLAYER_START = { x: 6, y: 5 };
const PACK_FORMAT_PORTS = 13;
const PACK_FORMAT_PLAIN_SIGNALS = 6;

type Point = { x: number; y: number };
const link = (from: Point, to: Point, port?: string): SignalLink => ({
  fromX: from.x,
  fromY: from.y,
  toX: to.x,
  toY: to.y,
  ...(port === undefined ? {} : { port })
});

function room(terrain: Array<[Point, string]>, signalLinks: SignalLink[], items: Array<[Point, string]> = []): CompiledLevel {
  const grid: string[][] = Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x) => (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? 'wall' : 'floor'))
  );
  for (const [p, id] of terrain) grid[p.y][p.x] = id;
  const itemGrid: (string | null)[][] = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null));
  for (const [p, id] of items) itemGrid[p.y][p.x] = id;
  return {
    id: 'signal_gates_room',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 100,
    chipsRequired: 0,
    playerStart: { ...PLAYER_START, dir: 'W' },
    terrain: grid,
    items: itemGrid,
    entities: [],
    trapLinks: [],
    cloneLinks: [],
    signalLinks
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

const doorTile = (engine: GameEngine): string => engine.getTerrain()[DOOR.y][DOOR.x];

beforeEach(() => {
  loadTestConfigs();
});

describe('lightning bolt', () => {
  function boltLevel(): CompiledLevel {
    return room([[DOOR, CLOSED_DOOR], [WIRE_FLOOR, 'signal_wire_floor']], [link(WIRE_FLOOR, DOOR)], [[BOLT, 'lightning_bolt']]);
  }

  it('powers the wire network of the floor the player stands on only while holding the bolt', () => {
    const engine = load(boltLevel());
    expect(doorTile(engine)).toBe(CLOSED_DOOR);
    // Standing on the wire floor without the bolt does nothing.
    const bare = load(room([[DOOR, CLOSED_DOOR], [WIRE_FLOOR, 'signal_wire_floor']], [link(WIRE_FLOOR, DOOR)]));
    for (let i = 0; i < PLAYER_START.x - WIRE_FLOOR.x; i++) step(bare, 'W');
    expect(bare.getPlayer().x).toBe(WIRE_FLOOR.x);
    expect(doorTile(bare)).toBe(CLOSED_DOOR);

    expect(step(engine, 'W')).toBe(true);
    expect(step(engine, 'W')).toBe(true);
    expect(engine.getPlayer().x).toBe(BOLT.x);
    // Holding the bolt but not on the wire floor yet.
    expect(doorTile(engine)).toBe(CLOSED_DOOR);
    expect(step(engine, 'W')).toBe(true);
    expect(engine.getPlayer().x).toBe(WIRE_FLOOR.x);
    expect(doorTile(engine)).toBe(OPEN_DOOR);
    // Stepping off the wire floor drops the power.
    expect(step(engine, 'E')).toBe(true);
    expect(doorTile(engine)).toBe(CLOSED_DOOR);
  });

  it('is an item the player keeps: it is held after the pickup', () => {
    const engine = load(boltLevel());
    step(engine, 'W');
    step(engine, 'W');
    expect(engine.getPlayer().boots.has('lightning_bolt')).toBe(true);
  });
});

describe('counter gate in the engine', () => {
  function counterLevel(): CompiledLevel {
    return room(
      [[BUTTON, 'signal_plate'], [COUNTER, 'signal_counter_9'], [DOOR, CLOSED_DOOR]],
      [link(BUTTON, COUNTER, 'in0'), link(COUNTER, DOOR, 'out0')]
    );
  }

  it('wraps on the first count and pulses its overflow output, then restores the count on undo', () => {
    const engine = load(counterLevel());
    const before = engine.getSignalState();
    const counterIndex = (values: number[] | undefined): number => (values ?? []).findIndex((value) => value === 9);
    expect(counterIndex(before?.counterValues)).toBeGreaterThanOrEqual(0);

    expect(step(engine, 'W')).toBe(true);
    expect(engine.getPlayer().x).toBe(BUTTON.x);
    const after = engine.getSignalState();
    expect(after?.counterValues?.every((value) => value === 0)).toBe(true);
    expect(engine.getSignalEdgeCounts()?.rising).toBe(1);

    expect(engine.undo()).toBe(true);
    expect(counterIndex(engine.getSignalState()?.counterValues)).toBeGreaterThanOrEqual(0);
  });

  it('puts the counter fields in the snapshot only when the network has a counter', () => {
    const withCounter = load(counterLevel());
    expect(withCounter.captureState().signals?.counterValues).toBeDefined();
    const plain = load(room([[BUTTON, 'signal_plate'], [NAND, 'signal_gate_or'], [DOOR, CLOSED_DOOR]], [link(BUTTON, NAND), link(NAND, DOOR)]));
    expect(plain.captureState().signals?.counterValues).toBeUndefined();
    expect(plain.captureState().signals?.counterUnderflow).toBeUndefined();
  });
});

describe('NAND gate in the engine', () => {
  it('holds a door open until the plate is pressed', () => {
    const level = room([[BUTTON, 'signal_plate'], [NAND, 'signal_gate_nand'], [DOOR, CLOSED_DOOR]], [link(BUTTON, NAND), link(NAND, DOOR)]);
    const engine = load(level);
    expect(doorTile(engine)).toBe(OPEN_DOOR);
    expect(step(engine, 'W')).toBe(true);
    expect(doorTile(engine)).toBe(CLOSED_DOOR);
  });
});

describe('pack format 13 for ports', () => {
  it('writes a level whose links name a port as format 13, and a level without ports as before', () => {
    const ported = room([[BUTTON, 'signal_plate'], [NAND, 'floor'], [DOOR, CLOSED_DOOR]], [link(BUTTON, DOOR, 'in1')]);
    expect(usesSignalPorts(ported)).toBe(true);
    expect(JSON.parse(serializePack('ported', [ported])).version).toBe(PACK_FORMAT_PORTS);

    const plain = room([[BUTTON, 'signal_plate'], [DOOR, CLOSED_DOOR]], [link(BUTTON, DOOR)]);
    expect(usesSignalPorts(plain)).toBe(false);
    expect(JSON.parse(serializePack('plain', [plain])).version).toBeLessThan(PACK_FORMAT_PORTS);
    expect(JSON.parse(serializePack('plain', [plain])).version).toBeGreaterThanOrEqual(PACK_FORMAT_PLAIN_SIGNALS - 1);
  });

  it('writes a level with any of the new ids as format 13', () => {
    for (const id of ['signal_gate_nand', 'signal_gate_dlatch', 'signal_counter_4', 'signal_wire_floor']) {
      const level = room([[NAND, id]], []);
      expect(JSON.parse(serializePack('ids', [level])).version, id).toBe(PACK_FORMAT_PORTS);
    }
    const bolt = room([], [], [[BOLT, 'lightning_bolt']]);
    expect(JSON.parse(serializePack('bolt', [bolt])).version).toBe(PACK_FORMAT_PORTS);
  });
});
