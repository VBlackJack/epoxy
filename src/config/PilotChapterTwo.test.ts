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
import { LevelValidator } from '../core/LevelValidator';
import { CompiledLevel, Direction } from '../core/types';
import { PieceSolver } from '../generator/PieceSolver';
import { storedSolutionWins } from '../generator/SolutionReplay';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { analyseNaturalPlay } from '../test/pilotNaturalPlay';
import { pushWinExists, searchPushWin } from '../test/pilotPushSearch';
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
const EMBANKMENT_LEVEL = 'epoxy_p_21';
const TIDY_LEVEL = 'epoxy_p_22';
const METRONOME_LEVEL = 'epoxy_p_23';
const CROSSING_LEVEL = 'epoxy_p_24';
const WORKSHOP_LEVEL = 'epoxy_p_25';

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
 * The pure block room of a level with the blocks and the player where the caller says. The
 * solver's verdict is exact on such a room, and the level itself is one (floor, walls, targets
 * and a hint tile).
 */
function pureRoom(level: CompiledLevel, blocks: Array<[number, number]>, player: [number, number]): GameEngine {
  const room = structuredClone(level);
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
    expect(level.solution?.length).toBe(32);
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
    expect(win?.length).toBe(32);
  });
});

describe('pilot chapter 2 the ford', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  /** Walk to the wedged block and push it into the river: it sinks and leaves loose dirt. */
  const FILL_THE_FORD = 'SSEEESE';
  /** From the new dirt, fetch the second block: bring it north out of its corner, then east along the row of the ford. */
  const FETCH_THE_BLOCK = 'WWWWSSSEENNSSWWNNNEE';

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

  it('keeps the second block in a one-wide shaft that only lets it go north, before the dirt below it is trodden', () => {
    const level = levelById(FORD_LEVEL);
    expect(level.entities.some((e) => e.type === 'dirt_block' && e.x === 4 && e.y === 6)).toBe(true);
    expect(level.terrain[6][3]).toBe('wall');
    expect(level.terrain[6][5]).toBe('wall');
    // Dirt stops a block, so the push south is refused until the player has trodden it.
    expect(level.terrain[7][4]).toBe('dirt');
  });

  it('sends the wedged block into the water only: the river becomes fresh dirt and the block is gone', () => {
    const level = levelById(FORD_LEVEL);
    expect(level.terrain[5][5]).toBe('wall');
    const engine = engineAfter(level, FILL_THE_FORD);
    expect(engine.getTerrain()[4][6]).toBe('dirt');
    expect(blockCells(engine)).toEqual(['4,6']);
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

  it('is proven solvable by the block solver on the real level, which models its hint tile', () => {
    const level = levelById(RAILS_LEVEL);
    expect(BlockPuzzleSolver.verdict(engineFor(level))).toEqual({ kind: 'solved', pushes: 8 });
    const room = pureRoom(level, startBlocks(level), [level.playerStart.x, level.playerStart.y]);
    expect(BlockPuzzleSolver.verdict(room)).toEqual({ kind: 'solved', pushes: 8 });
  });

  it('is lost by a block pushed into a corner or against the top wall', () => {
    const level = levelById(RAILS_LEVEL);
    const player: [number, number] = [level.playerStart.x, level.playerStart.y];
    const [west, east] = startBlocks(level);
    // West block pushed west into the corner at the end of the row.
    expect(verdictKind(pureRoom(level, [[2, 4], east], player))).toBe('unsolvable');
    // East block pushed east into the corner at the other end.
    expect(verdictKind(pureRoom(level, [west, [9, 4]], player))).toBe('unsolvable');
    // A block pushed up onto the top wall can never come back down.
    expect(verdictKind(pureRoom(level, [[west[0], 3], east], player))).toBe('unsolvable');
  });
});

describe('pilot chapter 2 dead ends', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  const NOTCH_BLOCK = 1;
  const WALL_BLOCK = 0;
  const OVERSHOOT_BLOCK = 2;
  const SQUARE_BLOCK = 2;

  it('is won by its stored solution with three blocks on three targets', () => {
    const level = levelById(DEAD_ENDS_LEVEL);
    expect(level.winRule).toBe('targets');
    expect(level.blockBudget).toEqual({ waters: 0, targets: 3 });
    expect(pushesOf(level)).toBe(10);
  });

  it('is proven solvable by the block solver on the real level', { timeout: PURE_ROOM_TIMEOUT_MS }, () => {
    const level = levelById(DEAD_ENDS_LEVEL);
    expect(BlockPuzzleSolver.verdict(engineFor(level))).toEqual({ kind: 'solved', pushes: 10 });
    const room = pureRoom(level, startBlocks(level), [level.playerStart.x, level.playerStart.y]);
    expect(BlockPuzzleSolver.verdict(room)).toEqual({ kind: 'solved', pushes: 10 });
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

  it('is lost when the push that lines a block up overshoots to the east wall, where no target lies', { timeout: PURE_ROOM_TIMEOUT_MS }, () => {
    const level = levelById(DEAD_ENDS_LEVEL);
    const blocks = startBlocks(level);
    const player: [number, number] = [level.playerStart.x, level.playerStart.y];
    const [x, y] = blocks[OVERSHOOT_BLOCK];
    expect(level.terrain[y][x + 3]).toBe('wall');
    expect(level.terrain.some((row) => row[x + 2] === 'block_target')).toBe(false);
    const lined = blocks.map((b, i): [number, number] => (i === OVERSHOOT_BLOCK ? [x + 1, y] : b));
    expect(verdictKind(pureRoom(level, lined, player))).toBe('solved');
    const overshot = blocks.map((b, i): [number, number] => (i === OVERSHOOT_BLOCK ? [x + 2, y] : b));
    expect(verdictKind(pureRoom(level, overshot, player))).toBe('unsolvable');
    // Pushing the block of the west column up onto the top row is the same dead end.
    const [wx, wy] = blocks[WALL_BLOCK];
    expect(level.terrain[wy - 2][wx]).toBe('wall');
    const lifted = blocks.map((b, i): [number, number] => (i === WALL_BLOCK ? [wx, wy - 1] : b));
    expect(verdictKind(pureRoom(level, lifted, player))).toBe('unsolvable');
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
    expect(sy).toBe(bottom - 1);
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

  /** Walk to the first block and push it east along its row into the first water cell of the river. */
  const FIRST_BRIDGE = 'EESSSEE';
  /** Bring the second block up into the row of the first bridge and line it up to push it east. */
  const LINE_UP_SECOND = 'SSSWNNWN';

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
    expect(blockCells(engine)).toEqual(['5,4']);
    const standing = { x: engine.getPlayer().x, y: engine.getPlayer().y };
    playAll(engine, 'E');
    expectRefused(engine, standing, '5,4');
    expect(engine.getTerrain()[4][6]).toBe('dirt');
    // The refusal costs nothing: the level can still be won from here.
    expect(searchCanWin(engine, { stateCap: SEARCH_STATE_CAP })).toBe(true);
  });

  it('wins when both bridges are in the same row and the first one is trodden', { timeout: TEST_TIMEOUT_MS }, () => {
    const level = levelById(BRIDGE_LEVEL);
    const engine = engineAfter(level, `${FIRST_BRIDGE}EWSSSWNNWNEEE`);
    expect(engine.getTerrain()[4][6]).toBe('floor');
    expect(engine.getTerrain()[4][7]).toBe('dirt');
    expect(engine.getEntities().filter((e) => e.type === 'dirt_block')).toHaveLength(0);
    expect(searchCanWin(engine, { stateCap: SEARCH_STATE_CAP })).toBe(true);
  });

  it('loses when the two bridges are in different rows', { timeout: TEST_TIMEOUT_MS }, () => {
    const level = levelById(BRIDGE_LEVEL);
    // The first block bridges the top row, the second one sinks next to it in the row below.
    const engine = engineAfter(level, `${FIRST_BRIDGE}SSSWNWNEE`);
    expect(engine.getTerrain()[4][6]).toBe('dirt');
    expect(engine.getTerrain()[5][6]).toBe('dirt');
    expect(engine.getEntities().filter((e) => e.type === 'dirt_block')).toHaveLength(0);
    expect(searchCanWin(engine, { stateCap: SEARCH_STATE_CAP })).toBe(false);
  });
});

/** The player's, the blocks' and the ball's cells after each move of the stored solution. */
function trace(level: CompiledLevel): Array<{ player: { x: number; y: number }; block: { x: number; y: number } | null; ball: { x: number; y: number } | null }> {
  const engine = engineFor(level);
  const steps: Array<{ player: { x: number; y: number }; block: { x: number; y: number } | null; ball: { x: number; y: number } | null }> = [];
  for (const move of level.solution ?? '') {
    expect(PieceSolver.play(engine, (move === '.' ? 'WAIT' : move) as Direction)).toBe(true);
    const find = (type: string) => engine.getEntities().find((e) => e.type === type);
    const block = find('dirt_block');
    const ball = find('pink_ball');
    steps.push({
      player: { x: engine.getPlayer().x, y: engine.getPlayer().y },
      block: block ? { x: block.x, y: block.y } : null,
      ball: ball ? { x: ball.x, y: ball.y } : null
    });
  }
  expect(engine.isLevelCompleted()).toBe(true);
  return steps;
}

describe('pilot chapter 2 the embankment', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  /** Walk to the block beside the hint stair and push it east along row 3 into the river: a bridge in a row with no target. */
  const WRONG_ROW_BRIDGE = 'SESEEEEEE';

  it('is won by its stored solution: two blocks fill two river cells and two blocks cover the targets', { timeout: TEST_TIMEOUT_MS }, () => {
    const level = levelById(EMBANKMENT_LEVEL);
    expect(level.winRule).toBe('targets');
    expect(level.blockBudget).toEqual({ waters: 2, targets: 2 });
    expect(level.solution?.length).toBe(66);
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

  it('is proven solvable by the exact push search, with the fewest pushes and nothing to spare', { timeout: TEST_TIMEOUT_MS }, () => {
    const level = levelById(EMBANKMENT_LEVEL);
    // Nothing to spare: as many blocks as bridges plus targets.
    expect(level.entities.filter((e) => e.type === 'dirt_block')).toHaveLength(4);
    expect(searchPushWin(engineFor(level))).toEqual({ pushes: 30 });
    // Targets sit in rows 2 and 4 only; the other river rows lead to walls.
    expect(level.terrain[2][13]).toBe('block_target');
    expect(level.terrain[4][13]).toBe('block_target');
    expect(level.terrain[3][10]).toBe('wall');
  });

  it('is lost by a bridge in a row that holds no target: the block count no longer covers two bridges and two targets', { timeout: TEST_TIMEOUT_MS }, () => {
    const level = levelById(EMBANKMENT_LEVEL);
    const engine = engineAfter(level, WRONG_ROW_BRIDGE);
    expect(engine.getTerrain()[3][9]).toBe('dirt');
    expect(blockCells(engine)).toHaveLength(3);
    expect(pushWinExists(engine)).toBe(false);
    // The same moves in the right row leave the level winnable (the first bridge of the stored solution).
    expect(pushWinExists(engineFor(level))).toBe(true);
  });
});

describe('pilot chapter 2 tidying up', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  /** Where each block starts and the pushes that bring it to its own target. */
  const PLANS = [
    { at: [3, 2], pushes: 'WW' },
    { at: [2, 4], pushes: 'NW' },
    { at: [3, 4], pushes: 'WW' },
    { at: [7, 2], pushes: 'EE' },
    { at: [8, 4], pushes: 'NE' },
    { at: [7, 4], pushes: 'EE' }
  ] as Array<{ at: [number, number]; pushes: string }>;

  it('is won by its stored solution with six blocks on six targets, each two pushes from home', () => {
    const level = levelById(TIDY_LEVEL);
    expect(level.winRule).toBe('targets');
    expect(level.blockBudget).toEqual({ waters: 0, targets: 6 });
    expect(level.solution?.length).toBe(44);
    expect(pushesOf(level)).toBe(12);
  });

  it('cannot be stranded by the designer plan: from every state reached by pushing blocks along their own two-push routes, in any order, a finish exists', () => {
    const level = levelById(TIDY_LEVEL);
    const report = analyseNaturalPlay(engineFor(level), PLANS);
    expect(report.deadStates).toBe(0);
    expect(report.states).toBeGreaterThan(0);
    expect(report.shortest).toBe(level.solution);
  });

  it('is proven solvable by the block solver once the west blocks are home (the full six-block room did not finish in 500 s of exhaustive search, so the plan analysis above is its proof)', { timeout: PURE_ROOM_TIMEOUT_MS }, () => {
    const level = levelById(TIDY_LEVEL);
    const east = startBlocks(level).filter(([x]) => x > 5);
    const room = pureRoom(level, [[1, 2], [1, 3], [1, 4], ...east], [5, 6]);
    expect(BlockPuzzleSolver.verdict(room)).toEqual({ kind: 'solved', pushes: 6 });
  });
});

describe('pilot chapter 2 the metronome', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  /** The level with the block gone and its niche closed by a wall: the ball can only be dodged. */
  function withoutBlock(): CompiledLevel {
    const level = structuredClone(levelById(METRONOME_LEVEL));
    level.entities = level.entities.filter((e) => e.type !== 'dirt_block');
    level.terrain[2][11] = 'wall';
    return level;
  }

  it('starts the player outside a corridor of fourteen cells whose dead end holds the only chip, and stores a win that cuts it with the block', () => {
    const level = levelById(METRONOME_LEVEL);
    expect(level.terrain[3].filter((id) => id === 'floor')).toHaveLength(14);
    expect(level.items[3][1]).toBe('chip');
    expect(level.chipsRequired).toBe(1);
    // No cell beside the corridor to stand in: the corridor row is walled above (but for the entry and the niche) and below.
    expect(level.terrain[4].every((id) => id === 'wall')).toBe(true);
    expect(level.playerStart.y).toBe(1);
    expect(level.solution?.length).toBe(44);
    const steps = trace(level);
    const last = steps[steps.length - 1];
    expect(last.block).toEqual({ x: 11, y: 3 });
    // The ball ends east of the block, in the part of the corridor the player never uses.
    expect((last.ball as { x: number }).x).toBeGreaterThan(11);
    // The player stands on the corridor only after the block is in it.
    const firstOnCorridor = steps.findIndex((s) => s.player.y === 3);
    expect(steps[firstOnCorridor].block).toEqual({ x: 11, y: 3 });
  });

  it('has no shorter win than its stored solution, with drops allowed', { timeout: PURE_ROOM_TIMEOUT_MS }, () => {
    const level = levelById(METRONOME_LEVEL);
    const win = searchShortestWin(engineFor(level), { stateCap: 3000000, allowDrops: true });
    expect(win?.length).toBe(44);
  });

  it('cannot be won by dodging: with the block replaced by a wall no win exists, drops allowed', { timeout: PURE_ROOM_TIMEOUT_MS }, () => {
    expect(searchCanWin(engineFor(withoutBlock()), { stateCap: 3000000, allowDrops: true })).toBe(false);
  });
});

describe('pilot chapter 2 the crossing', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  it('is won by its stored solution, and no shorter win exists, drops allowed', { timeout: PURE_ROOM_TIMEOUT_MS }, () => {
    const level = levelById(CROSSING_LEVEL);
    expect(level.solution?.length).toBe(20);
    const win = searchShortestWin(engineFor(level), { stateCap: 3000000, allowDrops: true });
    expect(win?.length).toBe(20);
  });

  it('cannot be won without the block: with the lane closed by a wall in its place no win exists', { timeout: PURE_ROOM_TIMEOUT_MS }, () => {
    const level = structuredClone(levelById(CROSSING_LEVEL));
    level.entities = level.entities.filter((e) => e.type !== 'dirt_block');
    level.terrain[2][6] = 'wall';
    expect(searchCanWin(engineFor(level), { stateCap: 3000000, allowDrops: true })).toBe(false);
  });

  it('gives the gravel a job: as plain floor the ball would reach the cell the block drops on, and the shortest win changes', { timeout: PURE_ROOM_TIMEOUT_MS }, () => {
    const level = structuredClone(levelById(CROSSING_LEVEL));
    expect(level.terrain[4][6]).toBe('gravel');
    expect(level.terrain.flat().filter((id) => id === 'gravel')).toHaveLength(1);
    level.terrain[4][6] = 'floor';
    const win = searchShortestWin(engineFor(level), { stateCap: 3000000, allowDrops: true });
    expect(win?.length).not.toBe(20);
  });

  it('never lets the player stand on the ball corridor except behind the block, with the ball beyond it', () => {
    const level = levelById(CROSSING_LEVEL);
    const steps = trace(level);
    const onCorridor = steps.filter((s) => s.player.y === 4);
    expect(onCorridor.length).toBeGreaterThan(5);
    for (const step of onCorridor) {
      expect(step.block?.y).toBe(4);
      expect(step.block?.x).toBeGreaterThan(step.player.x);
      expect(step.ball?.x).toBeGreaterThan(step.block?.x ?? 0);
    }
  });
});

describe('pilot chapter 2 the workshop', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  it('is won by its stored solution with three blocks in a bay of three targets', () => {
    const level = levelById(WORKSHOP_LEVEL);
    expect(level.winRule).toBe('targets');
    expect(level.blockBudget).toEqual({ waters: 0, targets: 3 });
    expect(level.solution?.length).toBe(100);
    expect(pushesOf(level)).toBe(41);
  });

  it('is proven solvable by the block solver on the real level', { timeout: PURE_ROOM_TIMEOUT_MS }, () => {
    const level = levelById(WORKSHOP_LEVEL);
    expect(BlockPuzzleSolver.verdict(engineFor(level), 3000000)).toEqual({ kind: 'solved', pushes: 41 });
  });

  it('is lost when the first block rests on the lit top target and a second one is brought right above it', { timeout: PURE_ROOM_TIMEOUT_MS }, () => {
    const level = levelById(WORKSHOP_LEVEL);
    const [, , c] = startBlocks(level);
    // Nobody can stand above the second block to push the first one down, and the second cannot go round it.
    expect(verdictKind(pureRoom(level, [[1, 8], [1, 7], c], [1, 6]))).toBe('unsolvable');
    // The same blocks one step earlier, the first pushed down to the bottom, are fine.
    expect(verdictKind(pureRoom(level, [[1, 10], [1, 7], c], [1, 6]))).toBe('solved');
  });

  it('forces the block wedged in the bay shaft to go first: the others cannot get past it', { timeout: PURE_ROOM_TIMEOUT_MS }, () => {
    const level = levelById(WORKSHOP_LEVEL);
    const [a, wedged, c] = startBlocks(level);
    // The bay is a one-wide shaft with no other way in.
    expect(level.terrain[wedged[1]][wedged[0] + 1]).toBe('wall');
    expect(level.terrain[8][2]).toBe('wall');
    // The bottom target filled, the wedged block treated as part of the wall: the other two cannot reach the rest of the bay.
    const blocked = structuredClone(level);
    blocked.terrain[wedged[1]][wedged[0]] = 'wall';
    blocked.playerStart = { ...blocked.playerStart, x: 15, y: 1 };
    blocked.entities = [a, c, [1, 10]].map(([x, y]) => ({ type: 'dirt_block', x, y, dir: 'S' }) as CompiledLevel['entities'][number]);
    expect(verdictKind(engineFor(blocked))).toBe('unsolvable');
    // The same room with the corridor open is solvable, so it is the wedged block that stands in the way.
    blocked.terrain[wedged[1]][wedged[0]] = 'floor';
    expect(verdictKind(engineFor(blocked))).toBe('solved');
  });

  it('is lost by pushing the east block up onto the top wall, where it can only slide along the wall', { timeout: PURE_ROOM_TIMEOUT_MS }, () => {
    const level = levelById(WORKSHOP_LEVEL);
    const [a, b, c] = startBlocks(level);
    expect(level.terrain[a[1] - 2][a[0]]).toBe('wall');
    expect(pushWinExists(pureRoom(level, [a, b, c], [level.playerStart.x, level.playerStart.y]))).toBe(true);
    expect(verdictKind(pureRoom(level, [[a[0], a[1] - 1], b, c], [a[0], a[1]]))).toBe('unsolvable');
  });
});

describe('pilot pack hidden items', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  /**
   * The level whose chip lies at the dead end of a ball corridor the block is pushed into: the
   * validator, which lets a block travel the corridor from the cell it lands on, cannot see that
   * the block can only be pushed that far by a player standing in the corridor. Every other level
   * must be silent.
   */
  const KNOWN_CORRIDOR_CHIP = new Set([METRONOME_LEVEL]);

  it('has no error and no item or hint a block can cover in any pilot level', () => {
    for (const level of ConfigRegistry.getPilotLevels()) {
      const report = LevelValidator.validate(level, storedSolutionWins);
      const errors = report.issues.filter((i) => i.severity === 'error');
      expect({ id: level.id, errors }).toEqual({ id: level.id, errors: [] });
      const hidden = report.issues.some((i) => i.i18nKey === 'validator.issues.hidden_by_block.label');
      expect({ id: level.id, hidden }).toEqual({ id: level.id, hidden: KNOWN_CORRIDOR_CHIP.has(level.id) });
    }
  });
});
