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
import { GameEngine } from '../GameEngine';
import type { CompiledLevel, Direction, SignalLink } from '../types';

const SIZE = 11;
const TIME_LIMIT_SECONDS = 100;
const MAX_WAIT_TICKS = 40;
const DOOR = { x: 8, y: 5 };
const PLATE_A = { x: 2, y: 5 };
const PLATE_B = { x: 7, y: 5 };
const GATE = { x: 5, y: 2 };
const PLAYER_START = { x: 6, y: 5 };

type Cell = { x: number; y: number };
const index = (c: Cell): number => c.y * SIZE + c.x;
const link = (from: Cell, to: Cell): SignalLink => ({ fromX: from.x, fromY: from.y, toX: to.x, toY: to.y });

/** Two signal plates into an AND gate into a hold door; a block rests on plate A when `blockOnA`. */
function andLevel(blockOnA: boolean, withLinks: boolean = true): CompiledLevel {
  const terrain: string[][] = Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x) => (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? 'wall' : 'floor'))
  );
  terrain[DOOR.y][DOOR.x] = 'hold_door_red_closed';
  terrain[PLATE_A.y][PLATE_A.x] = 'signal_plate';
  terrain[PLATE_B.y][PLATE_B.x] = 'signal_plate';
  terrain[GATE.y][GATE.x] = 'signal_gate_and';
  const level: CompiledLevel = {
    id: 'signal_accessors_room',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: TIME_LIMIT_SECONDS,
    chipsRequired: 0,
    playerStart: { ...PLAYER_START, dir: 'E' },
    terrain,
    items: Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null)),
    entities: blockOnA ? [{ type: 'dirt_block', x: PLATE_A.x, y: PLATE_A.y, dir: 'N' }] : [],
    trapLinks: [],
    cloneLinks: []
  };
  if (withLinks) level.signalLinks = [link(PLATE_B, GATE), link(PLATE_A, GATE), link(GATE, DOOR)];
  return level;
}

function load(level: CompiledLevel): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(level);
  return engine;
}

/** Ticks until the player may move, then moves. */
function step(engine: GameEngine, dir: Direction): boolean {
  for (let waited = 0; waited <= MAX_WAIT_TICKS; waited++) {
    if (engine.getPlayer().moveCooldown === 0) return engine.attemptPlayerMove(dir);
    engine.tick();
  }
  throw new Error('the player never became able to move');
}

beforeEach(() => loadTestConfigs());

describe('signal read accessors of the engine', () => {
  it('answers undefined on a level without signals', () => {
    const engine = load(andLevel(false, false));
    expect(engine.getSignalLinks()).toBeUndefined();
    expect(engine.getPoweredSignalCells()).toBeUndefined();
  });

  it('returns the compiled links by cell coordinates, sorted, not in input order', () => {
    const engine = load(andLevel(true));
    expect(engine.getSignalLinks()).toEqual([link(GATE, DOOR), link(PLATE_A, GATE), link(PLATE_B, GATE)]);
  });

  it('powers a held plate at load, then the sink only once both plates are pressed', () => {
    const engine = load(andLevel(true));
    expect([...(engine.getPoweredSignalCells() as ReadonlySet<number>)]).toEqual([index(PLATE_A)]);
    // Plate A holds a block, so it is on; the gate and the sink wait for plate B.
    expect(step(engine, 'E')).toBe(true);
    expect(engine.getPlayer().x).toBe(PLATE_B.x);
    const powered = engine.getPoweredSignalCells() as ReadonlySet<number>;
    expect(powered.has(index(PLATE_A))).toBe(true);
    expect(powered.has(index(PLATE_B))).toBe(true);
    expect(powered.has(index(GATE))).toBe(true);
    expect(powered.has(index(DOOR))).toBe(true);
    expect(step(engine, 'W')).toBe(true);
    const after = engine.getPoweredSignalCells() as ReadonlySet<number>;
    expect(after.has(index(PLATE_B))).toBe(false);
    expect(after.has(index(GATE))).toBe(false);
    expect(after.has(index(DOOR))).toBe(false);
  });

  it('is read only: reading, or changing what was read, leaves the network state alone', () => {
    const engine = load(andLevel(true));
    step(engine, 'E');
    const before = engine.getSignalState();
    (engine.getPoweredSignalCells() as Set<number>).clear();
    engine.getSignalLinks();
    expect(engine.getSignalState()).toEqual(before);
    expect(engine.getPoweredSignalCells()?.has(index(GATE))).toBe(true);
  });
});
