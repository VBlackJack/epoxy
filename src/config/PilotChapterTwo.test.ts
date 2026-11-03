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

import { BlockPuzzleSolver } from '../core/BlockPuzzleSolver';
import { GameEngine } from '../core/GameEngine';
import { CompiledLevel, Direction } from '../core/types';
import { PieceSolver } from '../generator/PieceSolver';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { searchCanWin, searchShortestWin } from '../test/pilotSearch';
import { ConfigRegistry } from './ConfigRegistry';

/** Generous search ceilings: the rooms are small, so a runaway proof fails loudly instead of hanging. */
const SEARCH_STATE_CAP = 200000;
const TEST_TIMEOUT_MS = 120000;
const PURE_ROOM_TIMEOUT_MS = 240000;

const BENDS_LEVEL = 'epoxy_p_16';
const FORD_LEVEL = 'epoxy_p_17';
const RAILS_LEVEL = 'epoxy_p_18';
const DEAD_ENDS_LEVEL = 'epoxy_p_19';
const BRIDGE_LEVEL = 'epoxy_p_20';

function levelById(id: string): CompiledLevel {
  const level = ConfigRegistry.getPilotLevels().find((l) => l.id === id);
  if (!level) throw new Error(`no pilot level ${id}`);
  return level;
}

function engineFor(level: CompiledLevel): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(level);
  return engine;
}

/** A refused push moves neither the player nor any block, and changes no terrain. */
function expectRefused(engine: GameEngine, standing: { x: number; y: number }, blockCell: string): void {
  expect({ x: engine.getPlayer().x, y: engine.getPlayer().y }).toEqual(standing);
  expect(blockCells(engine)).toEqual([blockCell]);
}

function playAll(engine: GameEngine, moves: string): void {
  for (const move of moves) expect(PieceSolver.play(engine, move as Direction), `move ${move} of ${moves}`).toBe(true);
}

function engineAfter(level: CompiledLevel, moves: string): GameEngine {
  const engine = engineFor(level);
  playAll(engine, moves);
  return engine;
}

function blockCells(engine: GameEngine): string[] {
  return engine
    .getEntities()
    .filter((e) => e.type === 'dirt_block')
    .map((e) => `${e.x},${e.y}`)
    .sort();
}

/** Walks the stored solution and counts the moves that shifted a block. */
function pushesOf(level: CompiledLevel): number {
  const engine = engineFor(level);
  let pushes = 0;
  for (const move of level.solution ?? '') {
    const before = blockCells(engine).join('|');
    expect(PieceSolver.play(engine, move as Direction)).toBe(true);
    if (before !== blockCells(engine).join('|')) pushes++;
  }
  expect(engine.isLevelCompleted()).toBe(true);
  return pushes;
}

/**
 * The room of a pure block level as the block solver models it: the loose dirt that closes
 * the start vestibule counts as floor (no block can reach it), the blocks and the player stand
 * where the caller says. The solver's verdict is exact on such a room.
 */
function pureRoom(level: CompiledLevel, blocks: Array<[number, number]>, player: [number, number]): GameEngine {
  const room = structuredClone(level);
  room.terrain = room.terrain.map((row) => row.map((id) => (id === 'dirt' ? 'floor' : id)));
  room.playerStart = { ...room.playerStart, x: player[0], y: player[1] };
  room.entities = blocks.map(([x, y]) => ({ type: 'dirt_block', x, y, dir: 'S' }) as CompiledLevel['entities'][number]);
  return engineFor(room);
}

function verdictKind(engine: GameEngine): string {
  return BlockPuzzleSolver.verdict(engine).kind;
}

function startBlocks(level: CompiledLevel): Array<[number, number]> {
  return level.entities.filter((e) => e.type === 'dirt_block').map((e) => [e.x, e.y]);
}

describe('pilot chapter 2 the bends', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  it('is won by its stored solution with three pushes that tuck the blocks into the free cells', { timeout: TEST_TIMEOUT_MS }, () => {
    const level = levelById(BENDS_LEVEL);
    expect(level.solution?.length).toBe(34);
    expect(pushesOf(level)).toBe(3);
  });

  it('holds three blocks, none of them to fill water or cover a target, so it declares no budget', () => {
    const level = levelById(BENDS_LEVEL);
    expect(level.entities.filter((e) => e.type === 'dirt_block')).toHaveLength(3);
    expect(level.blockBudget).toBeUndefined();
    expect(level.winRule).toBeUndefined();
  });

  it('has no shorter win than its stored solution', { timeout: TEST_TIMEOUT_MS }, () => {
    const win = searchShortestWin(engineFor(levelById(BENDS_LEVEL)), { stateCap: SEARCH_STATE_CAP });
    expect(win?.length).toBe(34);
  });
});

describe('pilot chapter 2 the ford', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  /** Walk to the wedged block and push it into the river: it sinks and leaves loose dirt. */
  const FILL_THE_FORD = 'ESSEESE';
  /** From the new dirt, fetch the second block: bring it north out of its corner, then east along the row of the ford. */
  const FETCH_THE_BLOCK = 'WSSSWWNNWNEEE';

  it('is won by its stored solution, with the river filled once and the east pool filled once', { timeout: TEST_TIMEOUT_MS }, () => {
    const level = levelById(FORD_LEVEL);
    expect(level.blockBudget).toEqual({ waters: 2, targets: 0 });
    const engine = engineFor(level);
    let sunk = 0;
    for (const move of level.solution ?? '') {
      const before = engine.getEntities().length;
      expect(PieceSolver.play(engine, move as Direction)).toBe(true);
      if (engine.getEntities().length < before) sunk++;
    }
    expect(engine.isLevelCompleted()).toBe(true);
    expect(sunk).toBe(2);
  });

  it('sends the wedged block into the water only: the river becomes fresh dirt and the block is gone', () => {
    const level = levelById(FORD_LEVEL);
    expect(level.terrain[5][5]).toBe('wall');
    const engine = engineAfter(level, FILL_THE_FORD);
    expect(engine.getTerrain()[4][6]).toBe('dirt');
    expect(blockCells(engine)).toEqual(['2,6']);
  });

  it('refuses the second block on fresh dirt without punishing, and lets it through once the dirt is trodden', { timeout: TEST_TIMEOUT_MS }, () => {
    const level = levelById(FORD_LEVEL);
    const engine = engineAfter(level, `${FILL_THE_FORD}${FETCH_THE_BLOCK}`);
    expect(blockCells(engine)).toEqual(['5,4']);
    const standing = { x: engine.getPlayer().x, y: engine.getPlayer().y };
    playAll(engine, 'E');
    expectRefused(engine, standing, '5,4');
    expect(engine.getTerrain()[4][6]).toBe('dirt');
    // Nothing is lost: the level can still be won from this very state.
    expect(searchCanWin(engine, { stateCap: SEARCH_STATE_CAP })).toBe(true);
    // Walk round the stub to tread the dirt, come back behind the block and push it across (the search above spent that engine).
    const walker = engineAfter(level, `${FILL_THE_FORD}${FETCH_THE_BLOCK}E`);
    playAll(walker, 'NEESNWWSE');
    expect(walker.getTerrain()[4][6]).toBe('floor');
    expect(blockCells(walker)).toEqual(['6,4']);
  });
});

describe('pilot chapter 2 the rails', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  it('is won by its stored solution, with every target covered and no exit to take', () => {
    const level = levelById(RAILS_LEVEL);
    expect(level.winRule).toBe('targets');
    expect(level.blockBudget).toEqual({ waters: 0, targets: 2 });
    expect(level.terrain.flat().filter((id) => id === 'exit')).toHaveLength(0);
    expect(pushesOf(level)).toBe(8);
  });

  it('is proven solvable by the block solver, which models its hint tile', () => {
    const level = levelById(RAILS_LEVEL);
    const room = pureRoom(level, startBlocks(level), [level.playerStart.x, level.playerStart.y]);
    expect(BlockPuzzleSolver.verdict(room)).toEqual({ kind: 'solved', pushes: 8 });
  });

  it('is lost by a block pushed into a corner or against the top wall', () => {
    const level = levelById(RAILS_LEVEL);
    const player: [number, number] = [level.playerStart.x, level.playerStart.y];
    const [west, east] = startBlocks(level);
    // West block pushed west into the corner at the end of the row.
    expect(verdictKind(pureRoom(level, [[4, 2], east], player))).toBe('unsolvable');
    // East block pushed east into the corner at the other end.
    expect(verdictKind(pureRoom(level, [west, [10, 2]], player))).toBe('unsolvable');
    // A block pushed up onto the top wall can never come back down.
    expect(verdictKind(pureRoom(level, [[west[0], 1], east], player))).toBe('unsolvable');
  });
});

describe('pilot chapter 2 dead ends', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  const NOTCH_BLOCK = 1;
  const WALL_BLOCK = 0;
  const SQUARE_BLOCK = 2;

  it('is won by its stored solution with three blocks on three targets', () => {
    const level = levelById(DEAD_ENDS_LEVEL);
    expect(level.winRule).toBe('targets');
    expect(level.blockBudget).toEqual({ waters: 0, targets: 3 });
    expect(pushesOf(level)).toBe(19);
  });

  it('is proven solvable by the block solver', { timeout: PURE_ROOM_TIMEOUT_MS }, () => {
    const level = levelById(DEAD_ENDS_LEVEL);
    const room = pureRoom(level, startBlocks(level), [level.playerStart.x, level.playerStart.y]);
    expect(BlockPuzzleSolver.verdict(room)).toEqual({ kind: 'solved', pushes: 19 });
  });

  it('is lost by the corner push of the block beside the notch', { timeout: PURE_ROOM_TIMEOUT_MS }, () => {
    const level = levelById(DEAD_ENDS_LEVEL);
    const blocks = startBlocks(level);
    const player: [number, number] = [level.playerStart.x, level.playerStart.y];
    const [x, y] = blocks[NOTCH_BLOCK];
    // The cell east of the block is the notch: a wall above it and a wall to its east.
    expect(level.terrain[y - 1][x + 1]).toBe('wall');
    expect(level.terrain[y][x + 2]).toBe('wall');
    expect(verdictKind(pureRoom(level, blocks, player))).toBe('solved');
    const pushed = blocks.map((b, i): [number, number] => (i === NOTCH_BLOCK ? [x + 1, y] : b));
    expect(verdictKind(pureRoom(level, pushed, player))).toBe('unsolvable');
  });

  it('is lost by pushing the block under the top wall up against it, where no target lies', { timeout: PURE_ROOM_TIMEOUT_MS }, () => {
    const level = levelById(DEAD_ENDS_LEVEL);
    const blocks = startBlocks(level);
    const player: [number, number] = [level.playerStart.x, level.playerStart.y];
    const [x, y] = blocks[WALL_BLOCK];
    expect(y).toBe(2);
    expect(level.terrain[y - 2][x]).toBe('wall');
    expect(level.terrain[y - 1].some((id) => id === 'block_target')).toBe(false);
    const pushed = blocks.map((b, i): [number, number] => (i === WALL_BLOCK ? [x, y - 1] : b));
    expect(verdictKind(pureRoom(level, pushed, player))).toBe('unsolvable');
  });

  it('is lost by a block pushed beside a block already resting on the bottom wall, a square of two blocks and two walls', { timeout: PURE_ROOM_TIMEOUT_MS }, () => {
    const level = levelById(DEAD_ENDS_LEVEL);
    const blocks = startBlocks(level);
    const player: [number, number] = [level.playerStart.x, level.playerStart.y];
    const targets: Array<[number, number]> = [];
    level.terrain.forEach((row, y) => row.forEach((id, x) => id === 'block_target' && targets.push([x, y])));
    const bottom = targets[0][1];
    const resting = targets[1];
    const [sx, sy] = blocks[SQUARE_BLOCK];
    expect(level.terrain[bottom + 1][resting[0]]).toBe('wall');
    // Same room, the other block one push above the cell beside the resting one.
    const before = blocks.map((b, i): [number, number] =>
      i === NOTCH_BLOCK ? resting : i === SQUARE_BLOCK ? [resting[0] + 1, bottom - 1] : b
    );
    expect(sx).toBe(resting[0] + 1);
    expect(sy).toBeLessThan(bottom - 1);
    expect(verdictKind(pureRoom(level, before, player))).toBe('solved');
    const after = before.map((b, i): [number, number] => (i === SQUARE_BLOCK ? [resting[0] + 1, bottom] : b));
    expect(verdictKind(pureRoom(level, after, player))).toBe('unsolvable');
    // The same push is harmless while the neighbour has not settled yet.
    const early = blocks.map((b, i): [number, number] => (i === SQUARE_BLOCK ? [resting[0] + 1, bottom] : b));
    expect(verdictKind(pureRoom(level, early, player))).toBe('solved');
  });
});

describe('pilot chapter 2 the trodden bridge', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  /** Walk to the first block and push it east along the top row into the first water cell of the river. */
  const FIRST_BRIDGE = 'EESEE';
  /** Bring the second block up into the row of the first bridge and line it up to push it east. */
  const LINE_UP_SECOND = 'SSSSSWNNNNWN';

  it('is won by its stored solution, with two blocks filling the two water cells of one row', { timeout: TEST_TIMEOUT_MS }, () => {
    const level = levelById(BRIDGE_LEVEL);
    expect(level.blockBudget).toEqual({ waters: 2, targets: 0 });
    const engine = engineFor(level);
    let sunk = 0;
    for (const move of level.solution ?? '') {
      const before = engine.getEntities().length;
      expect(PieceSolver.play(engine, move as Direction)).toBe(true);
      if (engine.getEntities().length < before) sunk++;
    }
    expect(engine.isLevelCompleted()).toBe(true);
    expect(sunk).toBe(2);
  });

  it('makes the second block wait for the first bridge cell to be trodden', { timeout: TEST_TIMEOUT_MS }, () => {
    const level = levelById(BRIDGE_LEVEL);
    const engine = engineAfter(level, `${FIRST_BRIDGE}${LINE_UP_SECOND}E`);
    expect(blockCells(engine)).toEqual(['5,2']);
    const standing = { x: engine.getPlayer().x, y: engine.getPlayer().y };
    playAll(engine, 'E');
    expectRefused(engine, standing, '5,2');
    expect(engine.getTerrain()[2][6]).toBe('dirt');
    // The refusal costs nothing: the level can still be won from here.
    expect(searchCanWin(engine, { stateCap: SEARCH_STATE_CAP })).toBe(true);
  });

  it('wins when both bridges are in the same row and the first one is trodden', { timeout: TEST_TIMEOUT_MS }, () => {
    const level = levelById(BRIDGE_LEVEL);
    const engine = engineAfter(level, `${FIRST_BRIDGE}EWSSSSSWNNNNWNEEE`);
    expect(engine.getTerrain()[2][6]).toBe('floor');
    expect(engine.getTerrain()[2][7]).toBe('dirt');
    expect(engine.getEntities().filter((e) => e.type === 'dirt_block')).toHaveLength(0);
    expect(searchCanWin(engine, { stateCap: SEARCH_STATE_CAP })).toBe(true);
  });

  it('loses when the two bridges are in different rows', { timeout: TEST_TIMEOUT_MS }, () => {
    const level = levelById(BRIDGE_LEVEL);
    // The first block bridges the top row, the second one sinks next to it in the row below.
    const engine = engineAfter(level, `${FIRST_BRIDGE}SSSSSWNNNWNEE`);
    expect(engine.getTerrain()[2][6]).toBe('dirt');
    expect(engine.getTerrain()[3][6]).toBe('dirt');
    expect(engine.getEntities().filter((e) => e.type === 'dirt_block')).toHaveLength(0);
    expect(searchCanWin(engine, { stateCap: SEARCH_STATE_CAP })).toBe(false);
  });
});
