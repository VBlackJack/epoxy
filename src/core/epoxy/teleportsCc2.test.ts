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
import type { CompiledLevel, Direction } from '../types';
import type { EpoxyContext } from './epoxyWorld';

const GREEN = 'teleport_random';
const RED = 'teleport_red_cc2';
const SIZE = 13;
const MAX_WAIT_TICKS = 40;
const TIME_LIMIT_SECONDS = 200;
const START = { x: 2, y: 5 };
/** The pad the player walks onto, and the two others of its group (reading order: B, A, C). */
const PAD_A = { x: 3, y: 5 };
const PAD_B = { x: 8, y: 3 };
const PAD_C = { x: 8, y: 9 };
/** Draws of the green pad: the destination among the others (the ring is read forward: C, then B), then the side (N, E, S, W). */
const DRAW_FIRST_OTHER = 0;
const DRAW_SECOND_OTHER = 1;
const SIDE_N = 0;
const SIDE_E = 1;
const SIDE_S = 2;

type Cell = { x: number; y: number };
type Offset = [number, number];

function room(terrain: Array<[Cell, string]>, entities: CompiledLevel['entities'] = []): CompiledLevel {
  const grid: string[][] = Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x) => (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? 'wall' : 'floor'))
  );
  for (const [cell, id] of terrain) grid[cell.y][cell.x] = id;
  return {
    id: 'teleports_cc2_room',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: TIME_LIMIT_SECONDS,
    chipsRequired: 0,
    playerStart: { ...START, dir: 'E' },
    terrain: grid,
    items: Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null)),
    entities,
    trapLinks: [],
    cloneLinks: []
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

/** Scripts the next draws of the level generator (the real generator answers after them); returns the spy. */
function drawing(engine: GameEngine, values: number[]) {
  const rng = (engine as unknown as { ctx: EpoxyContext }).ctx.world.rng;
  const spy = vi.spyOn(rng, 'nextInt');
  for (const value of values) spy.mockReturnValueOnce(value);
  return spy;
}

const where = (engine: GameEngine): Cell => ({ x: engine.getPlayer().x, y: engine.getPlayer().y });
const wallsAround = (pad: Cell, sides: Offset[]): Array<[Cell, string]> =>
  sides.map(([dx, dy]): [Cell, string] => [{ x: pad.x + dx, y: pad.y + dy }, 'wall']);

const NORTH: Offset = [0, -1];
const EAST: Offset = [1, 0];
const SOUTH: Offset = [0, 1];
const WEST: Offset = [-1, 0];

beforeEach(() => {
  loadTestConfigs();
});

describe('teleport_random: the green pad of Chip\'s Challenge 2', () => {
  const pads = (extra: Array<[Cell, string]> = []): Array<[Cell, string]> => [
    [PAD_A, GREEN],
    [PAD_B, GREEN],
    [PAD_C, GREEN],
    ...extra
  ];

  it('draws a pad among the others and a side, and leaves by that side', () => {
    const engine = load(room(pads()));
    const spy = drawing(engine, [DRAW_FIRST_OTHER, SIDE_S]);
    step(engine, 'E');
    expect(spy).toHaveBeenCalledTimes(2);
    expect(where(engine)).toEqual({ x: PAD_C.x, y: PAD_C.y + 1 });
    expect(engine.getPlayer().dir).toBe('S');
    const second = load(room(pads()));
    drawing(second, [DRAW_SECOND_OTHER, SIDE_E]);
    step(second, 'E');
    expect(where(second)).toEqual({ x: PAD_B.x + 1, y: PAD_B.y });
  });

  it('turns right, back and left from the drawn side when it is shut, not from the facing of the mover', () => {
    const engine = load(room(pads(wallsAround(PAD_B, [NORTH]))));
    drawing(engine, [DRAW_SECOND_OTHER, SIDE_N]);
    step(engine, 'E');
    expect(where(engine)).toEqual({ x: PAD_B.x + 1, y: PAD_B.y });
    const blocked = load(room(pads(wallsAround(PAD_B, [NORTH, EAST, SOUTH]))));
    drawing(blocked, [DRAW_SECOND_OTHER, SIDE_N]);
    step(blocked, 'E');
    expect(where(blocked)).toEqual({ x: PAD_B.x - 1, y: PAD_B.y });
  });

  it('goes on around the ring when the pad it drew has no exit', () => {
    const engine = load(room(pads(wallsAround(PAD_C, [NORTH, EAST, SOUTH, WEST]))));
    drawing(engine, [DRAW_FIRST_OTHER, SIDE_N]);
    step(engine, 'E');
    expect(where(engine)).toEqual({ x: PAD_B.x, y: PAD_B.y - 1 });
  });

  it('skips a pad another block stands on', () => {
    const engine = load(room(pads(), [{ type: 'dirt_block', x: PAD_C.x, y: PAD_C.y, dir: 'S' }]));
    drawing(engine, [DRAW_FIRST_OTHER, SIDE_N]);
    step(engine, 'E');
    expect(where(engine)).toEqual({ x: PAD_B.x, y: PAD_B.y - 1 });
  });

  it('with two pads, always leaves from the other one', () => {
    const engine = load(room([[PAD_A, GREEN], [PAD_B, GREEN]]));
    const spy = drawing(engine, [0, SIDE_S]);
    step(engine, 'E');
    expect(spy).toHaveBeenCalledTimes(2);
    expect(where(engine)).toEqual({ x: PAD_B.x, y: PAD_B.y + 1 });
  });

  it('a lone pad yields itself forward and draws nothing', () => {
    const engine = load(room([[PAD_A, GREEN]]));
    const spy = drawing(engine, []);
    step(engine, 'E');
    expect(spy).not.toHaveBeenCalled();
    expect(where(engine)).toEqual({ x: PAD_A.x + 1, y: PAD_A.y });
  });

  it('draws only when a pad is used, and an undo brings the same exit back', () => {
    const engine = load(room(pads()));
    const spy = drawing(engine, []);
    for (let i = 0; i < 5; i++) engine.tick();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    step(engine, 'E');
    const first = where(engine);
    expect(engine.undo()).toBe(true);
    step(engine, 'E');
    expect(where(engine)).toEqual(first);
  });

  it('sends a block pushed onto the pad out of another pad by the drawn side', () => {
    const engine = load(room(pads(), [{ type: 'dirt_block', x: START.x, y: START.y, dir: 'E' }]));
    engine.getPlayer().x = START.x - 1;
    drawing(engine, [DRAW_FIRST_OTHER, SIDE_S]);
    expect(step(engine, 'E')).toBe(true);
    const block = engine.getEntities().find((e) => e.type === 'dirt_block');
    expect(block).toMatchObject({ x: PAD_C.x, y: PAD_C.y + 1 });
  });
});

describe('teleport_red_cc2: the red pad of Chip\'s Challenge 2', () => {
  const pads = (extra: Array<[Cell, string]> = []): Array<[Cell, string]> => [
    [PAD_A, RED],
    [PAD_B, RED],
    [PAD_C, RED],
    ...extra
  ];

  it('leaves the next pad of the ring forward, with no draw', () => {
    const engine = load(room(pads()));
    const spy = drawing(engine, []);
    step(engine, 'E');
    expect(spy).not.toHaveBeenCalled();
    expect(where(engine)).toEqual({ x: PAD_C.x + 1, y: PAD_C.y });
    expect(engine.getPlayer().dir).toBe('E');
  });

  it('tries forward, right, back and left of the facing', () => {
    const expected: Array<[Offset[], Cell]> = [
      [[EAST], { x: PAD_C.x, y: PAD_C.y + 1 }],
      [[EAST, SOUTH], { x: PAD_C.x - 1, y: PAD_C.y }],
      [[EAST, SOUTH, WEST], { x: PAD_C.x, y: PAD_C.y - 1 }]
    ];
    for (const [shut, cell] of expected) {
      const engine = load(room(pads(wallsAround(PAD_C, shut))));
      step(engine, 'E');
      expect(where(engine)).toEqual(cell);
    }
  });

  it('goes on to the next pad when one is shut, and ends on the pad it entered, forward', () => {
    const all = [NORTH, EAST, SOUTH, WEST];
    const engine = load(room(pads(wallsAround(PAD_C, all))));
    step(engine, 'E');
    expect(where(engine)).toEqual({ x: PAD_B.x + 1, y: PAD_B.y });
    const sealed = load(room(pads([...wallsAround(PAD_C, all), ...wallsAround(PAD_B, all)])));
    step(sealed, 'E');
    expect(where(sealed)).toEqual({ x: PAD_A.x + 1, y: PAD_A.y });
  });

  it('keeps its own group apart from the green pads', () => {
    const engine = load(room([[PAD_A, RED], [PAD_B, GREEN], [PAD_C, RED]]));
    step(engine, 'E');
    expect(where(engine)).toEqual({ x: PAD_C.x + 1, y: PAD_C.y });
  });
});
