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

import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../audio/AudioManager', () => import('../test/silentAudio'));

import { GameEngine } from '../core/GameEngine';
import { CompiledLevel, GridPoint } from '../core/types';
import { replays } from '../test/levelChecks';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { LevelProver } from './LevelProver';
import { RouteSegment } from './LevelAssembler';
import { CompiledPiece } from './PieceTypes';

const CORRIDOR_LENGTH = 5;
const MIDDLE = 2;

/** A one-cell-wide corridor with `middle` terrain (and optionally an item) halfway along. */
function corridor(middle: string, item: string | null = null): CompiledLevel {
  const wall = Array.from({ length: CORRIDOR_LENGTH }, () => 'wall');
  const lane = Array.from({ length: CORRIDOR_LENGTH }, (_, x) => (x === MIDDLE ? middle : 'floor'));
  const items: (string | null)[] = Array.from({ length: CORRIDOR_LENGTH }, () => null);
  items[MIDDLE] = item;
  return {
    id: 'corridor',
    number: 1,
    password: 'AAAA',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    playerStart: { x: 0, y: 1, dir: 'E' },
    terrain: [wall, lane, wall],
    items: [wall.map(() => null), items, wall.map(() => null)],
    entities: [],
    trapLinks: [],
    cloneLinks: []
  };
}

describe('LevelProver safe path', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  const safePath = (level: CompiledLevel) => {
    const engine = new GameEngine();
    engine.loadLevel(level);
    const prover = LevelProver as unknown as {
      safePath: (e: GameEngine, target: { x: number; y: number }) => string[] | null;
    };
    return prover.safePath(engine, { x: CORRIDOR_LENGTH - 1, y: 1 });
  };

  it('walks plain floor', () => {
    expect(safePath(corridor('floor'))).toEqual(['E', 'E', 'E', 'E']);
  });

  it('refuses cells with a side effect: buttons, tiles that change when stepped on, items', () => {
    expect(safePath(corridor('button_green'))).toBeNull();
    expect(safePath(corridor('dirt'))).toBeNull();
    expect(safePath(corridor('floor', 'chip'))).toBeNull();
  });
});

const HUB_SIZE = 10;
const DOOR_X = HUB_SIZE + 1;
const DOOR_Y = 5;
const PIECE_WIDTH = 3;
const OPEN_WIDTH = DOOR_X + PIECE_WIDTH + 2;
const OPEN_HEIGHT = HUB_SIZE + 2;
const HUB_CHIPS: GridPoint[] = [
  { x: 9, y: 2 },
  { x: 3, y: 8 },
  { x: 8, y: 9 }
];
const HUB_BALLS = [
  { type: 'pink_ball', x: 5, y: 2, dir: 'E' as const },
  { type: 'pink_ball', x: 3, y: 5, dir: 'S' as const }
];

/** A hub with a door on the right wall leading to a one-row finale piece. */
function hubLevel(wallColumn: number | null = null): CompiledLevel {
  const terrain: string[][] = Array.from({ length: OPEN_HEIGHT }, (_, y) =>
    Array.from({ length: OPEN_WIDTH }, (_, x) =>
      x === 0 || y === 0 || x === OPEN_WIDTH - 1 || y === OPEN_HEIGHT - 1 ? 'wall' : 'floor'
    )
  );
  for (let y = 1; y < OPEN_HEIGHT - 1; y++) if (y !== DOOR_Y) terrain[y][DOOR_X] = 'wall';
  terrain[DOOR_Y][DOOR_X + PIECE_WIDTH - 1] = 'exit';
  for (let y = 1; y < OPEN_HEIGHT - 1; y++) {
    if (wallColumn !== null) terrain[y][wallColumn] = 'wall';
    if (y !== DOOR_Y) for (let x = DOOR_X + 1; x < OPEN_WIDTH - 1; x++) terrain[y][x] = 'wall';
  }
  const items = Array.from({ length: OPEN_HEIGHT }, () => new Array<string | null>(OPEN_WIDTH).fill(null));
  for (const c of HUB_CHIPS) items[c.y][c.x] = 'chip';
  return {
    id: 'hub_region',
    number: 1,
    password: 'HUBR',
    timeLimitSeconds: 0,
    chipsRequired: HUB_CHIPS.length,
    playerStart: { x: 1, y: 1, dir: 'S' },
    terrain,
    items,
    entities: HUB_BALLS.map((b) => ({ ...b })),
    trapLinks: [],
    cloneLinks: []
  };
}

function trivialPiece(): CompiledPiece {
  return {
    id: 'trivial',
    motif: 'trivial',
    tier: 1,
    width: PIECE_WIDTH,
    height: 1,
    terrain: [['floor', 'floor', 'exit']],
    items: [[null, null, null]],
    entities: [],
    trapLinks: [],
    cloneLinks: [],
    entry: { x: 0, y: 0 },
    exit: { x: PIECE_WIDTH - 1, y: 0 },
    requires: [],
    rotatable: false,
    oneShot: false,
    deadEnds: 0,
    solution: ['E', 'E'],
    orientation: { quarterTurns: 0, mirrored: false }
  } as CompiledPiece;
}

function hubRoute(): RouteSegment[] {
  return [
    ...HUB_CHIPS.map((target): RouteSegment => ({ kind: 'goto', target })),
    { kind: 'goto', target: { x: DOOR_X, y: DOOR_Y } },
    { kind: 'piece', piece: trivialPiece(), origin: { x: DOOR_X, y: DOOR_Y }, isFinale: true }
  ];
}

function hubRegion(): GridPoint[] {
  const cells: GridPoint[] = [];
  for (let y = 1; y <= HUB_SIZE; y++) for (let x = 1; x <= HUB_SIZE; x++) cells.push({ x, y });
  cells.push({ x: DOOR_X, y: DOOR_Y });
  return cells;
}

describe('LevelProver with a monster region', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  it('collects the open chips among wandering monsters and reaches the exit', () => {
    const level = hubLevel();
    const proof = LevelProver.prove(level, hubRoute(), hubRegion());
    expect(proof.solved).toBe(true);
    expect(proof.regionStates).toBeGreaterThan(0);
    expect(replays(level, proof.moves)).toBe(true);
  });

  it('without the region argument keeps the frozen walk and reports no region states', () => {
    const proof = LevelProver.prove(hubLevel(), hubRoute());
    expect(proof.regionStates).toBe(0);
    // The frozen walk ignores the balls: whatever it returns, a claimed solution must replay.
    if (proof.solved) expect(replays(hubLevel(), proof.moves)).toBe(true);
  });

  it('fails cleanly when a wall cuts the area so a chip cannot be reached', () => {
    const level = hubLevel(6);
    const proof = LevelProver.prove(level, hubRoute(), hubRegion());
    expect(proof.solved).toBe(false);
  });

  it('fails cleanly when a monster blocks the only path at every tick', () => {
    const length = 9;
    const wall = Array.from({ length }, () => 'wall');
    const lane = Array.from({ length }, (_, x) => (x === 0 || x === length - 1 ? 'wall' : 'floor'));
    const items: (string | null)[] = new Array<string | null>(length).fill(null);
    items[length - 2] = 'chip';
    const level: CompiledLevel = {
      id: 'blocked_lane',
      number: 1,
      password: 'BLCK',
      timeLimitSeconds: 0,
      chipsRequired: 1,
      playerStart: { x: 1, y: 1, dir: 'E' },
      terrain: [wall, lane, wall],
      items: [wall.map(() => null), items, wall.map(() => null)],
      entities: [{ type: 'pink_ball', x: 4, y: 1, dir: 'E' }],
      trapLinks: [],
      cloneLinks: []
    };
    const region: GridPoint[] = Array.from({ length: length - 2 }, (_, i) => ({ x: i + 1, y: 1 }));
    const route: RouteSegment[] = [{ kind: 'goto', target: { x: length - 2, y: 1 } }];
    const proof = LevelProver.prove(level, route, region);
    expect(proof.solved).toBe(false);
    expect(proof.regionStates).toBeGreaterThan(0);
  });
});
