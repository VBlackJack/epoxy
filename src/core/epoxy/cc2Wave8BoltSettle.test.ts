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

import { beforeEach, describe, expect, it } from 'vitest';

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { LIGHTNING_BOLT_ITEM_ID } from '../coreConstants';
import { GameEngine } from '../GameEngine';
import type { Cc2LevelData, CompiledLevel, Direction, SignalLink } from '../types';

const SIZE = 13;
const MAX_WAIT_TICKS = 40;
const SETTLE_TICKS = 4;
const START = { x: 2, y: 5 };
const SOURCE = { x: 3, y: 5 };
const SINK = { x: 8, y: 3 };
const WIRE_FLOOR = 'signal_wire_floor';
const WALL_A = 'purple_wall';
const WALL_B = 'purple_floor';
const CC2_STUB = { v: 1 } as unknown as Cc2LevelData;

function room(cc2: boolean): CompiledLevel {
  const terrain: string[][] = Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x) => (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? 'wall' : 'floor'))
  );
  terrain[SOURCE.y][SOURCE.x] = WIRE_FLOOR;
  terrain[SINK.y][SINK.x] = WALL_A;
  const signalLinks: SignalLink[] = [{ fromX: SOURCE.x, fromY: SOURCE.y, toX: SINK.x, toY: SINK.y }];
  return {
    id: 'bolt_settle_room',
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

function settle(engine: GameEngine): void {
  for (let i = 0; i < MAX_WAIT_TICKS && engine.getPlayer().moveCooldown !== 0; i++) engine.tick();
  for (let i = 0; i < SETTLE_TICKS; i++) engine.tick();
}

const sinkTile = (engine: GameEngine): string => engine.getTerrain()[SINK.y][SINK.x];

function powered(cc2: boolean): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(room(cc2));
  engine.getPlayer().boots.add(LIGHTNING_BOLT_ITEM_ID);
  step(engine, 'E');
  settle(engine);
  return engine;
}

beforeEach(() => {
  loadTestConfigs();
});

describe('CC2 lightning bolt holder keeps its level through the move settle', () => {
  it('rising edge: the source stays unpowered right after the step onto the wire, powered once settled', () => {
    const engine = new GameEngine();
    engine.loadLevel(room(true));
    engine.getPlayer().boots.add(LIGHTNING_BOLT_ITEM_ID);
    step(engine, 'E');
    expect(sinkTile(engine)).toBe(WALL_A);
    settle(engine);
    expect(sinkTile(engine)).toBe(WALL_B);
  });

  it('falling edge: the source stays powered right after the step off the wire, drops once settled', () => {
    const engine = powered(true);
    expect(sinkTile(engine)).toBe(WALL_B);
    step(engine, 'E');
    expect(sinkTile(engine)).toBe(WALL_B);
    settle(engine);
    expect(sinkTile(engine)).toBe(WALL_A);
  });

  it('falling edge on a native level: the power drops right after the move, as before', () => {
    const engine = powered(false);
    expect(sinkTile(engine)).toBe(WALL_B);
    step(engine, 'E');
    expect(sinkTile(engine)).toBe(WALL_A);
  });
});
