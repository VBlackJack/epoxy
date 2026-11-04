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

  it('lists chapter 3 as levels 31 to 42, in order, the four last ones being these', () => {
    const chapter = ConfigRegistry.getPilotChapters().find((c) => c.id === 'pilot_chapter_3');
    expect(chapter?.levels).toEqual(Array.from({ length: 12 }, (_, i) => `epoxy_p_${31 + i}`));
    expect(chapter?.levels.slice(8)).toEqual(PEAK_LEVELS);
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
    let bootsTaken = 0;
    let chipTaken = 0;
    const graph = exploreStateGraph(engineFor(noFlippers), {
      stateCap: BIG_STATE_CAP,
      allowDrops: true,
      onState: (engine) => {
        if (engine.getPlayer().boots.has(FIRE_BOOTS)) bootsTaken++;
        if (engine.getChipsRemaining() < level.chipsRequired) chipTaken++;
      }
    });
    // Every state of the flipper-less room can be explored, none of them wins, and none takes the boots or a chip.
    expect(graph.states).toBe(38);
    expect(graph.canWin).toBe(0);
    expect(graph.dead).toBe(graph.states);
    expect(bootsTaken).toBe(0);
    expect(chipTaken).toBe(0);
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
    let melted = 0;
    let pastTheLake = 0;
    const graph = exploreStateGraph(engineFor(noFlippers), {
      stateCap: SEARCH_STATE_CAP,
      allowDrops: true,
      onState: (engine) => {
        if (engine.getTerrain()[4][12] !== 'fire') melted++;
        const { x, y } = engine.getPlayer();
        // The walk to the flippers runs along the bottom row; the room with the ice lies east of the lake, above it.
        if (x >= 7 && y <= 6) pastTheLake++;
      }
    });
    expect(graph.states).toBe(66);
    expect(graph.canWin).toBe(0);
    expect(graph.dead).toBe(graph.states);
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

  it('is lost only by the ice block pushed up into the corner of its shaft', { timeout: TEST_TIMEOUT_MS }, () => {
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
