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
import { LIGHTNING_BOLT_ITEM_ID, SIGNAL_PLATE_TILE_ID } from '../coreConstants';
import type { Cc2LevelData, CompiledLevel, Direction, SignalLink } from '../types';

const SIZE = 13;
const MAX_WAIT_TICKS = 40;
const SETTLE_TICKS = 4;
const START = { x: 2, y: 5 };
const SOURCE = { x: 3, y: 5 };
const SINK = { x: 8, y: 3 };
const WIRE_FLOOR = 'signal_wire_floor';
const GREEN_WALL_CLOSED = 'toggle_wall_closed';
const GREEN_WALL_OPEN = 'toggle_wall_open';
const CC2_STUB = { v: 1 } as unknown as Cc2LevelData;

type Cell = { x: number; y: number };

function room(source: string, sink: string, cc2: boolean): CompiledLevel {
  const terrain: string[][] = Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x) => (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? 'wall' : 'floor'))
  );
  terrain[SOURCE.y][SOURCE.x] = source;
  terrain[SINK.y][SINK.x] = sink;
  const signalLinks: SignalLink[] = [{ fromX: SOURCE.x, fromY: SOURCE.y, toX: SINK.x, toY: SINK.y }];
  return {
    id: 'wired_flip_room',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 200,
    chipsRequired: 0,
    playerStart: { ...START, dir: 'E' },
    terrain,
    items: Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null)),
    entities: [],
    trapLinks: [],
    cloneLinks: [],
    signalLinks,
    ...(cc2 ? { cc2: CC2_STUB } : {})
  };
}

function load(level: CompiledLevel): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(level);
  return engine;
}

function step(engine: GameEngine, dir: Direction): void {
  for (let waited = 0; waited <= MAX_WAIT_TICKS; waited++) {
    if (engine.getPlayer().moveCooldown === 0) {
      engine.attemptPlayerMove(dir);
      return;
    }
    engine.tick();
  }
  throw new Error('the player never became able to move');
}

const tileAt = (engine: GameEngine, cell: Cell): string => engine.getTerrain()[cell.y][cell.x];

function pressButton(sink: string, cc2: boolean): GameEngine {
  const engine = load(room(SIGNAL_PLATE_TILE_ID, sink, cc2));
  step(engine, 'E');
  for (let i = 0; i < SETTLE_TICKS; i++) engine.tick();
  return engine;
}

beforeEach(() => {
  loadTestConfigs();
});

describe('CC2 wired flip tiles', () => {
  it('reverses a wired force floor', () => {
    expect(tileAt(pressButton('force_n', true), SINK)).toBe('force_s');
    expect(tileAt(pressButton('force_e', true), SINK)).toBe('force_w');
  });

  it('flips a wired green toggle wall', () => {
    expect(tileAt(pressButton(GREEN_WALL_CLOSED, true), SINK)).toBe(GREEN_WALL_OPEN);
  });

  it('turns a wired swivel door clockwise', () => {
    expect(tileAt(pressButton('swivel_door_cc2_ne', true), SINK)).toBe('swivel_door_cc2_se');
    expect(tileAt(pressButton('swivel_door_cc2_se', true), SINK)).toBe('swivel_door_cc2_sw');
  });

  it('leaves a native level as it was: the link to a force floor or a swivel is dropped', () => {
    expect(tileAt(pressButton('force_n', false), SINK)).toBe('force_n');
    expect(tileAt(pressButton('swivel_door_cc2_ne', false), SINK)).toBe('swivel_door_cc2_ne');
    expect(tileAt(pressButton(GREEN_WALL_CLOSED, false), SINK)).toBe(GREEN_WALL_OPEN);
  });
});

describe('CC2 lightning bolt', () => {
  function bolt(cc2: boolean): { engine: GameEngine; afterMove: string; settled: string } {
    const engine = load(room(WIRE_FLOOR, GREEN_WALL_CLOSED, cc2));
    engine.getPlayer().boots.add(LIGHTNING_BOLT_ITEM_ID);
    step(engine, 'E');
    const afterMove = tileAt(engine, SINK);
    for (let i = 0; i < MAX_WAIT_TICKS && engine.getPlayer().moveCooldown !== 0; i++) engine.tick();
    for (let i = 0; i < SETTLE_TICKS; i++) engine.tick();
    return { engine, afterMove, settled: tileAt(engine, SINK) };
  }

  it('powers the wire under the player only once he stands still on a CC2 level', () => {
    const cc2 = bolt(true);
    expect(cc2.afterMove).toBe(GREEN_WALL_CLOSED);
    expect(cc2.settled).toBe(GREEN_WALL_OPEN);
  });

  it('powers it right after the move on a native level, as before', () => {
    expect(bolt(false).afterMove).toBe(GREEN_WALL_OPEN);
  });
});
