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
import { LevelValidator } from '../core/LevelValidator';
import { CompiledLevel, Direction } from '../core/types';
import { PieceSolver } from '../generator/PieceSolver';
import { storedSolutionWins } from '../generator/SolutionReplay';
import { hasNoCrushHazard, scanHazards } from '../test/pilotHazardScan';
import { searchShortestWinLean } from '../test/pilotLeanSearch';
import { searchCanWin } from '../test/pilotSearch';
import { exploreStateGraph, StateGraph } from '../test/pilotStateGraph';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { ConfigRegistry } from './ConfigRegistry';

/** The alchemy room has about 478000 states; its analyses take minutes on a busy machine. */
const BIG_STATE_CAP = 1000000;
const LONG_TEST_TIMEOUT_MS = 900000;

const ALCHEMY_LEVEL = 'epoxy_p_39';
const DEATH_WATER = 'hud.messages.death_water';
const DEATH_FIRE = 'hud.messages.death_fire';

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

function engineAfter(level: CompiledLevel, moves: string): GameEngine {
  const engine = engineFor(level);
  for (let i = 0; i < moves.length; i++) {
    expect(PieceSolver.play(engine, moves[i] as Direction), `move ${i + 1} of ${moves}`).toBe(true);
  }
  return engine;
}

function where(engine: GameEngine): string {
  const { x, y } = engine.getPlayer();
  return `${x},${y}`;
}

function cellsOf(level: CompiledLevel, id: string): string[] {
  const cells: string[] = [];
  level.terrain.forEach((row, y) => row.forEach((t, x) => t === id && cells.push(`${x},${y}`)));
  return cells;
}

function itemCells(level: CompiledLevel, id: string): string[] {
  const cells: string[] = [];
  level.items.forEach((row, y) => row.forEach((item, x) => item === id && cells.push(`${x},${y}`)));
  return cells;
}

function entityCells(engine: GameEngine): string[] {
  return engine.getEntities().map((e) => `${e.type}@${e.x},${e.y}`);
}

function validatorIssues(level: CompiledLevel, withSolution = true): string[] {
  return LevelValidator.validate(level, withSolution ? storedSolutionWins : undefined).issues.map((i) => `${i.severity}:${i.i18nKey}`);
}

/** Plays the stored solution move by move, reporting the engine after each move (1-based). */
function replayStored(level: CompiledLevel, afterMove: (engine: GameEngine, move: number) => void): GameEngine {
  const engine = engineFor(level);
  const moves = level.solution ?? '';
  for (let i = 0; i < moves.length; i++) {
    expect(PieceSolver.play(engine, moves[i] as Direction), `move ${i + 1} of ${moves}`).toBe(true);
    afterMove(engine, i + 1);
  }
  expect(engine.isLevelCompleted()).toBe(true);
  return engine;
}

describe('pilot chapter 3 alchemy', () => {
  let graph: StateGraph;
  /** Dead states by kind, filled by the classifier while the one shared graph is explored. */
  const kinds: Record<string, number> = {};

  beforeAll(() => {
    loadTestConfigs();
    const level = levelById(ALCHEMY_LEVEL);
    const hazards = [14, 15];
    const alcoves = new Set(level.entities.map((b) => `${b.x},${b.y === 2 ? 1 : 5}`));
    graph = exploreStateGraph(engineFor(level), {
      stateCap: BIG_STATE_CAP,
      allowDrops: true,
      trackDepth: true,
      onDead: (engine) => {
        const terrain = engine.getTerrain();
        const cells = hazards.map((x) => terrain[3][x]);
        const needIce = cells.filter((c) => c === 'fire').length;
        const needDirt = needIce + cells.filter((c) => c === 'water').length;
        const blocks = engine.getEntities();
        const onFire = blocks.some((b) => b.y === 3 && hazards.includes(b.x) && terrain[3][b.x] === 'fire');
        const pushedBack = blocks.some((b) => alcoves.has(`${b.x},${b.y}`));
        const usable = blocks.filter((b) => !alcoves.has(`${b.x},${b.y}`) && !(b.y === 3 && hazards.includes(b.x)));
        const ice = usable.filter((b) => b.type === 'ice_block').length;
        const dirt = usable.filter((b) => b.type === 'dirt_block').length;
        const lane = blocks.filter((b) => b.y === 3 && !hazards.includes(b.x)).sort((a, b) => b.x - a.x);
        const nextNeedsIce = cells.find((c) => c === 'fire' || c === 'water') === 'fire';
        const head = lane[0];
        let kind = 'unexplained';
        if (onFire) kind = 'dirt jammed on a fire';
        else if (pushedBack) kind = 'block pushed back into its alcove';
        else if (ice < needIce || dirt < needDirt) kind = 'fewer blocks than the hazards still need';
        else if (lane.length >= 1 && cells.includes('dirt')) kind = 'block sent before the fresh dirt was trodden';
        else if (lane.length >= 2) kind = 'two blocks queued in the lane';
        else if (head && ((nextNeedsIce && head.type === 'dirt_block') || (!nextNeedsIce && head.type === 'ice_block' && needDirt > 0))) {
          kind = 'wrong block at the head of the lane';
        }
        kinds[kind] = (kinds[kind] ?? 0) + 1;
      }
    });
  }, LONG_TEST_TIMEOUT_MS);

  /** Where the four hazard cells and the lane lie. */
  const FIRE_ONE = '14,3';
  const FIRE_TWO = '15,3';
  /** The stored solution up to the first block pushed into the first fire, and the moves of each of its five parts. */
  const MELT_ONE = 'SEEEEEENNESWSEEEEEE';
  const FILL_ONE = 'WWWWWWWWSSENWNEEEEEEEEE';
  const MELT_TWO = 'WWWWWSSENWNEEEEE';
  const FILL_TWO = 'WWWWWWWWWWWNNESWSEEEEEEEEEEEEE';
  const FINISH = 'NESEE';

  it('is won by its stored solution in 93 moves, and the whole state graph holds no shorter win, drops allowed', () => {
    const level = levelById(ALCHEMY_LEVEL);
    expect(level.solution).toBe(MELT_ONE + FILL_ONE + MELT_TWO + FILL_TWO + FINISH);
    expect(level.solution?.length).toBe(93);
    // The depth is the breadth-first depth of the one graph explored in beforeAll, which is complete (no state cap was hit).
    expect(graph.shortestWin).toBe(93);
  });

  it('holds two ice blocks and two dirt blocks for two fires, one of each pair for each fire and none to spare, with four bays and no water', () => {
    const level = levelById(ALCHEMY_LEVEL);
    expect(level.entities.map((e) => `${e.type}@${e.x},${e.y}`)).toEqual([
      'dirt_block@4,2',
      'dirt_block@6,4',
      'ice_block@8,2',
      'ice_block@10,4'
    ]);
    expect(cellsOf(level, 'fire')).toEqual([FIRE_ONE, FIRE_TWO]);
    expect(cellsOf(level, 'water')).toEqual([]);
    // Each bay holds its block under a pocket of fresh dirt, so a block cannot be pushed back up before its first use.
    expect(cellsOf(level, 'dirt')).toEqual(['4,1', '8,1', '6,5', '10,5']);
    expect(itemCells(level, 'chip')).toEqual(['16,2', '17,2']);
    expect(level.chipsRequired).toBe(2);
    expect(cellsOf(level, 'hint')).toEqual(['1,2']);
    expect(`${level.playerStart.x},${level.playerStart.y}`).toBe('1,2');
  });

  it('takes exactly its four blocks: with any one block removed no win exists, drops allowed', { timeout: LONG_TEST_TIMEOUT_MS }, () => {
    const level = levelById(ALCHEMY_LEVEL);
    level.entities.forEach((removed, index) => {
      const fewer = structuredClone(level);
      fewer.entities = level.entities.filter((_, i) => i !== index);
      expect(fewer.entities).toHaveLength(3);
      const win = searchShortestWinLean(engineFor(fewer), { stateCap: BIG_STATE_CAP, allowDrops: true });
      expect(win, `without ${removed.type}@${removed.x},${removed.y}`).toBeNull();
    });
  });

  it('melts the first fire in move 19, fills it in move 41 and treads it in move 42, then melts, fills and treads the second in moves 58, 86 and 87', () => {
    const level = levelById(ALCHEMY_LEVEL);
    const states: Record<string, number> = {};
    const note = (name: string, move: number): void => {
      if (states[name] === undefined) states[name] = move;
    };
    replayStored(level, (engine, move) => {
      const one = engine.getTerrain()[3][14];
      const two = engine.getTerrain()[3][15];
      if (one === 'water') note('one melted', move);
      if (one === 'dirt') note('one filled', move);
      if (states['one filled'] !== undefined && one === 'floor') note('one trodden', move);
      if (two === 'water') note('two melted', move);
      if (two === 'dirt') note('two filled', move);
      if (states['two filled'] !== undefined && two === 'floor') note('two trodden', move);
    });
    expect(states).toEqual({
      'one melted': 19,
      'one filled': 41,
      'one trodden': 42,
      'two melted': 58,
      'two filled': 86,
      'two trodden': 87
    });
  });

  it('kills only on the two fires and on the water they leave, no block can crush the player, and the scan is complete, drops allowed', { timeout: LONG_TEST_TIMEOUT_MS }, () => {
    const level = levelById(ALCHEMY_LEVEL);
    const scan = scanHazards(level, { allowDrops: true, maxStates: BIG_STATE_CAP });
    expect(scan.truncated).toBe(false);
    expect(scan.unsettled).toBe(0);
    expect(scan.blockBounces).toBe(0);
    expect(hasNoCrushHazard(scan)).toBe(true);
    expect(scan.states).toBe(477949);
    expect(scan.deaths.map((d) => `${d.reason}@${d.x},${d.y}`).sort()).toEqual(
      [`${DEATH_FIRE}@14,3`, `${DEATH_FIRE}@15,3`, `${DEATH_WATER}@14,3`, `${DEATH_WATER}@15,3`].sort()
    );
  });

  it('sends the first block of dirt at the first fire and loses: the dirt jams the fire for good', { timeout: LONG_TEST_TIMEOUT_MS }, () => {
    const level = levelById(ALCHEMY_LEVEL);
    // The nearest block is dirt: down its bay, round to the west of it, and ten pushes to the fire.
    const dropped = engineAfter(level, 'SEENNESWS');
    expect(entityCells(dropped)).toEqual(['dirt_block@4,3', 'dirt_block@6,4', 'ice_block@8,2', 'ice_block@10,4']);
    const dropGraph = exploreStateGraph(dropped, { stateCap: BIG_STATE_CAP, allowDrops: true });
    expect(dropGraph.canWin).toBe(0);
    expect(dropGraph.dead).toBe(dropGraph.states);
    expect(dropGraph.states).toBe(84312);
    const jammed = engineAfter(level, 'SEENNESWS' + 'E'.repeat(10));
    expect(entityCells(jammed)).toEqual(['dirt_block@14,3', 'dirt_block@6,4', 'ice_block@8,2', 'ice_block@10,4']);
    expect(jammed.getTerrain()[3][14]).toBe('fire');
    const jamGraph = exploreStateGraph(jammed, { stateCap: BIG_STATE_CAP, allowDrops: true });
    expect(jamGraph.canWin).toBe(0);
    expect(jamGraph.states).toBe(33415);
  });

  it('sends the second ice block into the water the first one left and loses: the ice vanishes and the water stays', { timeout: LONG_TEST_TIMEOUT_MS }, () => {
    const level = levelById(ALCHEMY_LEVEL);
    const melted = engineAfter(level, MELT_ONE);
    expect(melted.getTerrain()[3][14]).toBe('water');
    expect(entityCells(melted)).toEqual(['dirt_block@4,2', 'dirt_block@6,4', 'ice_block@10,4']);
    // The nearest block to the lane is the second ice block, and it looks like the one to fill the water.
    const dropped = engineAfter(level, MELT_ONE + 'WWWWSSENWN');
    expect(entityCells(dropped)).toEqual(['dirt_block@4,2', 'dirt_block@6,4', 'ice_block@10,3']);
    const dropGraph = exploreStateGraph(dropped, { stateCap: BIG_STATE_CAP, allowDrops: true });
    expect(dropGraph.canWin).toBe(0);
    expect(dropGraph.states).toBe(24406);
    const sunk = engineAfter(level, MELT_ONE + 'WWWWSSENWNEEEE');
    expect(entityCells(sunk)).toEqual(['dirt_block@4,2', 'dirt_block@6,4']);
    expect(sunk.getTerrain()[3][14]).toBe('water');
    const sunkGraph = exploreStateGraph(sunk, { stateCap: BIG_STATE_CAP, allowDrops: true });
    expect(sunkGraph.canWin).toBe(0);
    expect(sunkGraph.states).toBe(9066);
  });

  it('sends a block of dirt at the second fire before its ice and loses', { timeout: LONG_TEST_TIMEOUT_MS }, () => {
    const level = levelById(ALCHEMY_LEVEL);
    const prefix = MELT_ONE + FILL_ONE;
    const filled = engineAfter(level, prefix);
    expect(filled.getTerrain()[3][14]).toBe('floor');
    expect(filled.getTerrain()[3][15]).toBe('fire');
    expect(entityCells(filled)).toEqual(['dirt_block@4,2', 'ice_block@10,4']);
    const dropped = engineAfter(level, prefix + 'WWWWWWWWWWW' + 'NNESWS');
    expect(entityCells(dropped)).toEqual(['dirt_block@4,3', 'ice_block@10,4']);
    const dropGraph = exploreStateGraph(dropped, { stateCap: BIG_STATE_CAP, allowDrops: true });
    expect(dropGraph.canWin).toBe(0);
    expect(dropGraph.states).toBe(2626);
    const jammed = engineAfter(level, prefix + 'WWWWWWWWWWW' + 'NNESWS' + 'E'.repeat(11));
    expect(entityCells(jammed)).toEqual(['dirt_block@15,3', 'ice_block@10,4']);
    const jamGraph = exploreStateGraph(jammed, { stateCap: BIG_STATE_CAP, allowDrops: true });
    expect(jamGraph.canWin).toBe(0);
    expect(jamGraph.states).toBe(637);
  });

  it('sends the second ice block down the lane before the fresh dirt is trodden and loses: a block cannot cross fresh dirt, and it shuts the lane', { timeout: LONG_TEST_TIMEOUT_MS }, () => {
    const level = levelById(ALCHEMY_LEVEL);
    // The dirt block fills the first fire (move 41) and the player stands beside the fresh dirt; the next block is brought first.
    const fresh = engineAfter(level, MELT_ONE + 'WWWWWWWWSSENWNEEEEEEEE');
    expect(fresh.getTerrain()[3][14]).toBe('dirt');
    expect(where(fresh)).toBe('13,3');
    const stuck = engineAfter(level, MELT_ONE + 'WWWWWWWWSSENWNEEEEEEEE' + 'WWWWSSENWNEEE');
    expect(entityCells(stuck)).toEqual(['dirt_block@4,2', 'ice_block@13,3']);
    expect(stuck.getTerrain()[3][14]).toBe('dirt');
    const stuckGraph = exploreStateGraph(stuck, { stateCap: BIG_STATE_CAP, allowDrops: true });
    expect(stuckGraph.canWin).toBe(0);
    expect(stuckGraph.states).toBe(677);
    // Treading the dirt first is the move that saves the level: the stored solution does it in move 42.
    expect(searchCanWin(engineAfter(level, MELT_ONE + FILL_ONE), { stateCap: BIG_STATE_CAP, allowDrops: true })).toBe(true);
  });

  it('has only six kinds of dead end, and each is a block that was sent wrong, pushed back, or queued behind another', () => {
    expect(graph.states).toBe(477949);
    expect(graph.expanded).toBe(477949);
    expect(graph.canWin).toBe(21309);
    expect(graph.dead).toBe(456640);
    expect(kinds).toEqual({
      'dirt jammed on a fire': 70584,
      'block pushed back into its alcove': 166220,
      'fewer blocks than the hazards still need': 8628,
      'block sent before the fresh dirt was trodden': 7232,
      'two blocks queued in the lane': 192682,
      'wrong block at the head of the lane': 11294
    });
    expect(Object.values(kinds).reduce((sum, n) => sum + n, 0)).toBe(graph.dead);
  });

  it('the validator reports no issue on level 39, with and without the stored solution', () => {
    expect(validatorIssues(levelById(ALCHEMY_LEVEL))).toEqual([]);
    expect(validatorIssues(levelById(ALCHEMY_LEVEL), false)).toEqual([]);
  });
});

