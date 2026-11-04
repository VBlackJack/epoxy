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
import { blockBudgetProblems } from '../test/pilotBlockBudget';
import { hasNoCrushHazard, scanHazards } from '../test/pilotHazardScan';
import { searchShortestWinLean } from '../test/pilotLeanSearch';
import { searchCanWin, searchShortestWin } from '../test/pilotSearch';
import { exploreStateGraph } from '../test/pilotStateGraph';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { ConfigRegistry } from './ConfigRegistry';

/** Ceilings: the rooms are small, so a runaway proof fails loudly instead of hanging. */
const SEARCH_STATE_CAP = 400000;
const BIG_STATE_CAP = 1000000;
const TEST_TIMEOUT_MS = 240000;
/** The alchemy room has about 478000 states; its full analyses take minutes on a busy machine. */
const LONG_TEST_TIMEOUT_MS = 900000;

const ALCHEMY_LEVEL = 'epoxy_p_39';
const BRAKE_LEVEL = 'epoxy_p_40';
const SWIM_LEVEL = 'epoxy_p_41';
const COASTER_LEVEL = 'epoxy_p_42';
const PEAK_LEVELS = [ALCHEMY_LEVEL, BRAKE_LEVEL, SWIM_LEVEL, COASTER_LEVEL];

/** The blocks each level holds, in entity order; none of these levels holds a creature. */
const ENTITY_TYPES: Record<string, string[]> = {
  [ALCHEMY_LEVEL]: ['dirt_block', 'dirt_block', 'ice_block', 'ice_block'],
  [BRAKE_LEVEL]: [],
  [SWIM_LEVEL]: ['ice_block'],
  [COASTER_LEVEL]: []
};

const FIRE_BOOTS = 'boots_fire';
const WATER_BOOTS = 'boots_water';
const ICE_BOOTS = 'boots_ice';
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

function countItems(level: CompiledLevel, id: string): number {
  return level.items.flat().filter((item) => item === id).length;
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

function shortestLength(level: CompiledLevel, cap = SEARCH_STATE_CAP): number | null {
  return searchShortestWin(engineFor(level), { stateCap: cap, allowDrops: true })?.length ?? null;
}

function deathsOf(level: CompiledLevel): string[] {
  return scanHazards(level, { allowDrops: true })
    .deaths.map((d) => `${d.reason}@${d.x},${d.y}`)
    .sort();
}

/** A copy of the level with some terrain cells replaced. */
function withTerrain(level: CompiledLevel, changes: Array<[number, number, string]>): CompiledLevel {
  const copy = structuredClone(level);
  for (const [x, y, id] of changes) copy.terrain[y][x] = id;
  return copy;
}

describe('pilot chapter 3 peak, every level', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  it.each(PEAK_LEVELS)('%s: the stored solution wins, the validator finds no error, and no block can hide an item', (id) => {
    const level = levelById(id);
    expect(storedSolutionWins(level)).toBe(true);
    const report = LevelValidator.validate(level, storedSolutionWins);
    // Level 41 swims through melted water, which the validator does not credit: with its stored solution it
    // reports two warnings, see the known validator limit below.
    expect(report.issues.filter((i) => i.severity === 'error')).toEqual([]);
    const hidden = report.issues.find((i) => i.i18nKey === 'validator.issues.hidden_by_block.label');
    expect(hidden?.params?.count ?? 0).toBe(0);
  });

  // The alchemy room is scanned once, in its own tests below, because its scan takes about a minute.
  it.each([BRAKE_LEVEL, SWIM_LEVEL, COASTER_LEVEL])(
    '%s: no block can crush the player, in a scan that is complete, drops allowed',
    { timeout: TEST_TIMEOUT_MS },
    (id) => {
      const scan = scanHazards(levelById(id), { allowDrops: true });
      expect(scan.truncated).toBe(false);
      expect(scan.unsettled).toBe(0);
      expect(scan.blockBounces).toBe(0);
      expect(hasNoCrushHazard(scan)).toBe(true);
    }
  );

  it.each(PEAK_LEVELS)('%s: holds no ice boots and no creature, only its own blocks', (id) => {
    const level = levelById(id);
    expect(countItems(level, ICE_BOOTS)).toBe(0);
    expect(level.entities.map((e) => e.type)).toEqual(ENTITY_TYPES[id]);
  });

  it.each(PEAK_LEVELS)('%s: runs untimed and keeps its texts in both languages', (id) => {
    const level = levelById(id);
    expect(level.timeLimitSeconds).toBe(0);
    expect(level.titleKey).toBe(`pilot.levels.level_${level.number}.title`);
    expect(level.hintKey).toBe(`pilot.levels.level_${level.number}.hint`);
  });

  it('declares no block budget: levels 39 and 41 hold fires, which the budget cannot express, and levels 40 and 42 hold no block', () => {
    for (const id of PEAK_LEVELS) {
      const level = levelById(id);
      expect(level.blockBudget, id).toBeUndefined();
      expect(blockBudgetProblems(level), id).toEqual([]);
    }
    // The budget counts a block as the filler of one water; an ice block melts a fire instead, and the meltwater
    // is filled by a second block or swum through, so the two counts do not describe these rooms.
    expect(cellsOf(levelById(ALCHEMY_LEVEL), 'fire')).toEqual(['14,3', '15,3']);
    expect(cellsOf(levelById(SWIM_LEVEL), 'fire')).toEqual(['12,4']);
  });

  it('puts the four levels at the end of chapter 3, in order', () => {
    const chapter = ConfigRegistry.getPilotChapters().find((c) => c.id === 'pilot_chapter_3');
    expect(chapter?.levels.slice(-4)).toEqual(PEAK_LEVELS);
  });
});

describe('pilot chapter 3 alchemy', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  /** Where the four hazard cells and the lane lie. */
  const FIRE_ONE = '14,3';
  const FIRE_TWO = '15,3';
  /** The stored solution up to the first block pushed into the first fire, and the moves of each of its five parts. */
  const MELT_ONE = 'SEEEEEENNESWSEEEEEE';
  const FILL_ONE = 'WWWWWWWWSSENWNEEEEEEEEE';
  const MELT_TWO = 'WWWWWSSENWNEEEEE';
  const FILL_TWO = 'WWWWWWWWWWWNNESWSEEEEEEEEEEEEE';
  const FINISH = 'NESEE';

  it('is won by its stored solution in 93 moves, and no shorter win exists anywhere in its 478000 states, drops allowed', { timeout: LONG_TEST_TIMEOUT_MS }, () => {
    const level = levelById(ALCHEMY_LEVEL);
    expect(level.solution).toBe(MELT_ONE + FILL_ONE + MELT_TWO + FILL_TWO + FINISH);
    expect(level.solution?.length).toBe(93);
    const win = searchShortestWinLean(engineFor(level), { stateCap: BIG_STATE_CAP * 2, allowDrops: true });
    expect(win?.length).toBe(93);
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

  it('has only six kinds of dead end, and each is a block that was sent wrong, pushed back, or queued behind another', { timeout: LONG_TEST_TIMEOUT_MS }, () => {
    const level = levelById(ALCHEMY_LEVEL);
    const hazards = [14, 15];
    const alcoves = new Set(level.entities.map((b) => `${b.x},${b.y === 2 ? 1 : 5}`));
    const kinds: Record<string, number> = {};
    const graph = exploreStateGraph(engineFor(level), {
      stateCap: BIG_STATE_CAP,
      allowDrops: true,
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
    expect(graph.states).toBe(477949);
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
  });

  it('the validator reports no issue on level 39, with and without the stored solution', () => {
    expect(validatorIssues(levelById(ALCHEMY_LEVEL))).toEqual([]);
    expect(validatorIssues(levelById(ALCHEMY_LEVEL), false)).toEqual([]);
  });
});

describe('pilot chapter 3 the brake', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  const WATER_ONE = '4,5';
  const FIRE_ONE = '7,7';
  const WATER_TWO = '7,9';
  const WATER_THREE = '11,11';

  it('is won by its stored solution in 47 moves, and no shorter win exists, drops allowed', { timeout: TEST_TIMEOUT_MS }, () => {
    const level = levelById(BRAKE_LEVEL);
    expect(level.solution?.length).toBe(47);
    expect(searchShortestWinLean(engineFor(level), { stateCap: BIG_STATE_CAP * 2, allowDrops: true })?.length).toBe(47);
  });

  it('puts a brake cell on each ice lane, a side pocket at each, and the boots where the other brake guards them', () => {
    const level = levelById(BRAKE_LEVEL);
    expect(cellsOf(level, 'water')).toEqual([WATER_ONE, WATER_TWO, WATER_THREE]);
    expect(cellsOf(level, 'fire')).toEqual([FIRE_ONE]);
    expect(itemCells(level, WATER_BOOTS)).toEqual(['1,10']);
    expect(itemCells(level, FIRE_BOOTS)).toEqual(['4,4']);
    expect(itemCells(level, 'chip')).toEqual(['4,1', '10,7', '11,8', '9,9']);
    expect(level.chipsRequired).toBe(4);
    // Each brake cell sits in the middle of an ice lane, so the slide runs on through it for a player without the boots.
    expect(level.terrain[5].slice(2, 7)).toEqual(['ice', 'ice', 'water', 'ice', 'ice']);
    expect([6, 8, 10].map((y) => level.terrain[y][7])).toEqual(['ice', 'ice', 'ice']);
    expect(level.terrain[7][7]).toBe('fire');
    expect(level.terrain[9][7]).toBe('water');
    expect(level.terrain[11].slice(8, 13)).toEqual(['ice', 'ice', 'ice', 'water', 'ice']);
    // Every side pocket opens on its brake cell only.
    expect(level.terrain[7].slice(8, 11)).toEqual(['floor', 'floor', 'floor']);
    expect(level.terrain[9].slice(8, 10)).toEqual(['floor', 'floor']);
  });

  it('takes the flippers first, the fire boots from the pocket the first water guards, and stops on each brake cell', () => {
    const level = levelById(BRAKE_LEVEL);
    const stops: string[] = [];
    let flippersMove = 0;
    let fireBootsMove = 0;
    replayStored(level, (engine, move) => {
      const boots = engine.getPlayer().boots;
      if (flippersMove === 0 && boots.has(WATER_BOOTS)) flippersMove = move;
      if (fireBootsMove === 0 && boots.has(FIRE_BOOTS)) fireBootsMove = move;
      const at = where(engine);
      if ([WATER_ONE, FIRE_ONE, WATER_TWO, WATER_THREE].includes(at)) stops.push(`${at}@${move}`);
    });
    expect(flippersMove).toBe(9);
    expect(fireBootsMove).toBe(16);
    // Each brake cell is reached once on the way in and once on the way back from its pocket; none is passed.
    expect(stops).toEqual(['4,5@15', '4,5@23', '7,7@25', '7,7@31', '7,9@32', '7,9@36', '11,11@38', '11,11@44']);
  });

  it('carries a player without the boots to death: the fire, the first water, the second water and the third water each kill', { timeout: TEST_TIMEOUT_MS }, () => {
    const scan = scanHazards(levelById(BRAKE_LEVEL), { allowDrops: true });
    expect(scan.truncated).toBe(false);
    expect(scan.states).toBe(137845);
    expect(scan.deaths.map((d) => `${d.reason}@${d.x},${d.y}`).sort()).toEqual(
      [`${DEATH_WATER}@4,5`, `${DEATH_FIRE}@7,7`, `${DEATH_WATER}@7,9`, `${DEATH_WATER}@11,11`].sort()
    );
    const first = scan.deaths.find((d) => d.x === 4 && d.y === 5);
    // Straight down the west corridor and into the first lane with nothing on the feet.
    expect(first?.path.join('')).toBe('SSSSE');
  });

  it('needs every brake cell: with any one of them turned into plain ice, no win exists', { timeout: TEST_TIMEOUT_MS }, () => {
    const level = levelById(BRAKE_LEVEL);
    expect(searchCanWin(engineFor(level), { stateCap: BIG_STATE_CAP, allowDrops: true })).toBe(true);
    for (const [x, y] of [[4, 5], [7, 7], [7, 9], [11, 11]]) {
      const plain = withTerrain(level, [[x, y, 'ice']]);
      expect(searchCanWin(engineFor(plain), { stateCap: BIG_STATE_CAP, allowDrops: true }), `ice at ${x},${y}`).toBe(false);
    }
  });

  it('keeps the fire boots out of reach without the flippers: no state reached without them ever takes the boots', { timeout: TEST_TIMEOUT_MS }, () => {
    const level = levelById(BRAKE_LEVEL);
    const noFlippers = structuredClone(level);
    noFlippers.items[10][1] = null;
    let states = 0;
    let bootsTaken = 0;
    exploreStateGraph(engineFor(noFlippers), {
      stateCap: BIG_STATE_CAP,
      allowDrops: true,
      onState: (engine) => {
        states++;
        if (engine.getPlayer().boots.has(FIRE_BOOTS) || engine.getChipsRemaining() < level.chipsRequired) bootsTaken++;
      }
    });
    expect(states).toBeGreaterThan(1);
    expect(bootsTaken).toBe(0);
  });

  it('can be lost only by putting a boot down where it can no longer be fetched, and never while holding both', { timeout: TEST_TIMEOUT_MS }, () => {
    const level = levelById(BRAKE_LEVEL);
    const original: Record<string, string> = { [FIRE_BOOTS]: '4,4', [WATER_BOOTS]: '1,10' };
    let holdingBoth = 0;
    let bothAtHome = 0;
    const graph = exploreStateGraph(engineFor(level), {
      stateCap: BIG_STATE_CAP,
      allowDrops: true,
      onDead: (engine) => {
        const boots = engine.getPlayer().boots;
        if (boots.has(FIRE_BOOTS) && boots.has(WATER_BOOTS)) holdingBoth++;
        const state = engine.captureState();
        const lying: Record<string, string> = {};
        state.items.forEach((row, y) => row.forEach((id, x) => id && original[id] !== undefined && (lying[id] = `${x},${y}`)));
        const moved = [FIRE_BOOTS, WATER_BOOTS].filter((id) => !boots.has(id) && lying[id] !== original[id]);
        if (moved.length === 0) bothAtHome++;
      }
    });
    expect(graph.states).toBe(137845);
    expect(graph.canWin).toBe(136598);
    expect(graph.dead).toBe(1247);
    expect(holdingBoth).toBe(0);
    expect(bothAtHome).toBe(0);
  });

  it('the validator reports no issue on level 40, with and without the stored solution', () => {
    expect(validatorIssues(levelById(BRAKE_LEVEL))).toEqual([]);
    expect(validatorIssues(levelById(BRAKE_LEVEL), false)).toEqual([]);
  });
});

describe('pilot chapter 3 melt and swim', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  const FIRE = '12,4';
  const LAKE = ['4,4', '5,4', '6,4'];
  const FLIPPERS = '9,7';
  /** The corner the ice block is pushed up into: the one cell of its shaft from which it can never come back down. */
  const CORNER = 'ice_block@8,1';

  it('is won by its stored solution in 50 moves, and no shorter win exists, drops allowed', { timeout: TEST_TIMEOUT_MS }, () => {
    const level = levelById(SWIM_LEVEL);
    expect(level.solution?.length).toBe(50);
    expect(shortestLength(level)).toBe(50);
  });

  it('holds one ice block and no dirt, one fire in the corridor, a lake of three water cells and the flippers at the end of a long walk', () => {
    const level = levelById(SWIM_LEVEL);
    expect(level.entities.map((e) => `${e.type}@${e.x},${e.y}`)).toEqual(['ice_block@8,2']);
    expect(cellsOf(level, 'fire')).toEqual([FIRE]);
    expect(cellsOf(level, 'water')).toEqual(LAKE);
    expect(itemCells(level, WATER_BOOTS)).toEqual([FLIPPERS]);
    expect(itemCells(level, 'chip')).toEqual(['13,3', '15,3', '14,5']);
    expect(level.chipsRequired).toBe(3);
    expect(cellsOf(level, 'hint')).toEqual(['1,1']);
  });

  it('melts the fire into water with the ice block, and swims across that water with the flippers, no filler block anywhere', () => {
    const level = levelById(SWIM_LEVEL);
    let flippersMove = 0;
    let meltMove = 0;
    let swimMove = 0;
    replayStored(level, (engine, move) => {
      if (flippersMove === 0 && engine.getPlayer().boots.has(WATER_BOOTS)) flippersMove = move;
      const cell = engine.getTerrain()[4][12];
      if (meltMove === 0 && cell !== 'fire') {
        meltMove = move;
        expect(cell).toBe('water');
        expect(engine.getEntities()).toHaveLength(0);
      }
      if (swimMove === 0 && where(engine) === FIRE) {
        swimMove = move;
        expect(cell).toBe('water');
        expect(engine.getPlayer().boots.has(WATER_BOOTS)).toBe(true);
      }
    });
    expect(flippersMove).toBe(14);
    expect(meltMove).toBe(39);
    expect(swimMove).toBe(40);
  });

  it('kills only in the fire, in the lake without the flippers, and in the meltwater without them', { timeout: TEST_TIMEOUT_MS }, () => {
    const level = levelById(SWIM_LEVEL);
    const scan = scanHazards(level, { allowDrops: true });
    expect(scan.states).toBe(28271);
    expect(deathsOf(level)).toEqual([`${DEATH_FIRE}@12,4`, `${DEATH_WATER}@12,4`, `${DEATH_WATER}@4,4`, `${DEATH_WATER}@6,4`].sort());
  });

  it('needs the flippers before the ice moves: without them the fire never melts and no win exists', { timeout: TEST_TIMEOUT_MS }, () => {
    const level = levelById(SWIM_LEVEL);
    const noFlippers = structuredClone(level);
    noFlippers.items[7][9] = null;
    expect(searchCanWin(engineFor(noFlippers), { stateCap: SEARCH_STATE_CAP, allowDrops: true })).toBe(false);
    let states = 0;
    let melted = 0;
    let pastTheLake = 0;
    exploreStateGraph(engineFor(noFlippers), {
      stateCap: SEARCH_STATE_CAP,
      allowDrops: true,
      onState: (engine) => {
        states++;
        if (engine.getTerrain()[4][12] !== 'fire') melted++;
        const { x, y } = engine.getPlayer();
        // The walk to the flippers runs along the bottom row; the room with the ice lies east of the lake, above it.
        if (x >= 7 && y <= 6) pastTheLake++;
      }
    });
    expect(states).toBeGreaterThan(1);
    expect(melted).toBe(0);
    expect(pastTheLake).toBe(0);
  });

  it('needs the melt: with the fire left as it is, no win exists', { timeout: TEST_TIMEOUT_MS }, () => {
    const level = levelById(SWIM_LEVEL);
    const stillFire = (engine: GameEngine): boolean => engine.getTerrain()[4][12] === 'fire';
    expect(searchShortestWin(engineFor(level), { stateCap: SEARCH_STATE_CAP, allowDrops: true, accept: stillFire })).toBeNull();
    const melted = searchShortestWin(engineFor(level), { stateCap: SEARCH_STATE_CAP, allowDrops: true, accept: (e) => !stillFire(e) });
    expect(melted?.length).toBe(50);
  });

  it('is lost only by the ice block pushed up into the corner of its shaft, or by the flippers put down in the lake: every dead state holds the block there', { timeout: TEST_TIMEOUT_MS }, () => {
    const level = levelById(SWIM_LEVEL);
    const shapes = new Set<string>();
    const graph = exploreStateGraph(engineFor(level), {
      stateCap: SEARCH_STATE_CAP,
      allowDrops: true,
      onDead: (engine) => shapes.add(entityCells(engine).join('|'))
    });
    expect(graph.states).toBe(28271);
    expect(graph.canWin).toBe(26662);
    expect(graph.dead).toBe(1609);
    expect([...shapes]).toEqual([CORNER]);
  });

  it('known validator limit: melt-then-swim is not credited, a fire always costs an ice block plus a filler block', () => {
    const level = levelById(SWIM_LEVEL);
    // With the stored solution the replay proves the chips and the exit reachable, so the two findings are downgraded to warnings.
    expect(validatorIssues(level)).toEqual(['warning:validator.issues.unreachable_chips_proven.label', 'warning:validator.issues.unreachable_exit_proven.label']);
    expect(validatorIssues(level, false)).toEqual(['error:validator.issues.unreachable_chips.label', 'error:validator.issues.unreachable_exit.label']);
    // The cause: the validator wants a filler block for the water a fire leaves, whatever boots the player holds. Give the
    // same room a spare dirt block in the lane, beyond the lake, and it finds the chips and the exit. A spare block west of
    // the lake does not help: the count spends it on the lake, which the flippers cross for free.
    const lane = structuredClone(level);
    lane.entities.push({ type: 'dirt_block', x: 11, y: 4, dir: 'S' });
    expect(LevelValidator.validate(lane).issues.filter((i) => i.severity === 'error')).toEqual([]);
    const west = structuredClone(level);
    west.entities.push({ type: 'dirt_block', x: 1, y: 2, dir: 'S' });
    expect(LevelValidator.validate(west).issues.filter((i) => i.severity === 'error').map((i) => i.i18nKey)).toEqual([
      'validator.issues.unreachable_chips.label',
      'validator.issues.unreachable_exit.label'
    ]);
  });
});

describe('pilot chapter 3 roller coaster', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  const CHIPS = ['3,3', '9,2', '7,1', '6,4', '4,5'];

  it('is won by its stored solution in 14 moves, and no shorter win exists, drops allowed', { timeout: TEST_TIMEOUT_MS }, () => {
    const level = levelById(COASTER_LEVEL);
    expect(level.solution?.length).toBe(14);
    expect(shortestLength(level)).toBe(14);
  });

  it('is a figure eight of ice: two lobes that cross on one cell, four bends, five chips on the track and a floor stop at each end', () => {
    const level = levelById(COASTER_LEVEL);
    expect(cellsOf(level, 'ice').length).toBe(15);
    expect(cellsOf(level, 'ice_nw')).toEqual(['6,1']);
    expect(cellsOf(level, 'ice_ne')).toEqual(['9,1']);
    expect(cellsOf(level, 'ice_se')).toEqual(['9,3', '6,5']);
    expect(cellsOf(level, 'ice_sw')).toEqual([]);
    expect([...CHIPS].sort()).toEqual(itemCells(level, 'chip').sort());
    expect(level.chipsRequired).toBe(5);
    for (const cell of CHIPS) {
      const [x, y] = cell.split(',').map(Number);
      expect(level.terrain[y][x].startsWith('ice'), cell).toBe(true);
    }
    // The crossing cell is plain ice with ice on all four sides.
    expect(level.terrain[3][6]).toBe('ice');
    expect([level.terrain[2][6], level.terrain[4][6], level.terrain[3][5], level.terrain[3][7]].every((t) => t === 'ice')).toBe(true);
    expect(level.terrain[3][1]).toBe('floor');
    expect(level.terrain[5][2]).toBe('floor');
  });

  it('collects the five chips in a single entry: one move from either end of the track takes them all and ends on the floor at the other end', () => {
    const level = levelById(COASTER_LEVEL);
    const queue = 'WWWWWWWWNN';
    const forward = engineAfter(level, queue + 'NN');
    expect(where(forward)).toBe('1,3');
    expect(forward.getChipsRemaining()).toBe(5);
    expect(PieceSolver.play(forward, 'E')).toBe(true);
    expect(forward.getChipsRemaining()).toBe(0);
    expect(where(forward)).toBe('2,5');
    const stored = engineAfter(level, queue + 'E');
    expect(where(stored)).toBe('2,5');
    expect(stored.getChipsRemaining()).toBe(5);
    expect(PieceSolver.play(stored, 'E')).toBe(true);
    expect(stored.getChipsRemaining()).toBe(0);
    expect(where(stored)).toBe('1,3');
  });

  it('has no dead end and no death at all: every state can still be won, and the slide always ends on solid ground', { timeout: TEST_TIMEOUT_MS }, () => {
    const level = levelById(COASTER_LEVEL);
    const graph = exploreStateGraph(engineFor(level), { stateCap: SEARCH_STATE_CAP, allowDrops: true });
    expect(graph.states).toBe(154);
    expect(graph.dead).toBe(0);
    expect(graph.canWin).toBe(154);
    const scan = scanHazards(level, { allowDrops: true });
    expect(scan.deaths).toEqual([]);
    expect(scan.unsettled).toBe(0);
  });

  it('the validator reports no issue on level 42, with and without the stored solution', () => {
    expect(validatorIssues(levelById(COASTER_LEVEL))).toEqual([]);
    expect(validatorIssues(levelById(COASTER_LEVEL), false)).toEqual([]);
  });
});
