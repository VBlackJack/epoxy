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
import { loadTestConfigs } from '../test/loadTestConfigs';
import { searchShortestWinLean } from '../test/pilotLeanSearch';
import { hasNoCrushHazard, scanHazards } from '../test/pilotHazardScan';
import { searchCanWin, searchShortestWin } from '../test/pilotSearch';
import { exploreStateGraph } from '../test/pilotStateGraph';
import { ConfigRegistry } from './ConfigRegistry';

/** Generous search ceilings: the rooms are small, so a runaway proof fails loudly instead of hanging. */
const SEARCH_STATE_CAP = 400000;
const TEST_TIMEOUT_MS = 240000;

const FIREWALL_LEVEL = 'epoxy_p_31';
const FLIPPERS_LEVEL = 'epoxy_p_32';
const SLIDE_LEVEL = 'epoxy_p_33';
const TOBOGGAN_LEVEL = 'epoxy_p_34';
const KEY_ON_THE_FLY_LEVEL = 'epoxy_p_35';
const CHAPTER_THREE_LEVELS = [FIREWALL_LEVEL, FLIPPERS_LEVEL, SLIDE_LEVEL, TOBOGGAN_LEVEL, KEY_ON_THE_FLY_LEVEL];

const FIRE_BOOTS = 'boots_fire';
const WATER_BOOTS = 'boots_water';
const ICE_BOOTS = 'boots_ice';
const RED_KEY = 'key_red';
const RED_DOOR = 'door_red';
const DEATH_FIRE = 'hud.messages.death_fire';
const DEATH_WATER = 'hud.messages.death_water';

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

function playAll(engine: GameEngine, moves: string): void {
  for (const move of moves) expect(PieceSolver.play(engine, move as Direction), `move ${move} of ${moves}`).toBe(true);
}

function engineAfter(level: CompiledLevel, moves: string): GameEngine {
  const engine = engineFor(level);
  playAll(engine, moves);
  return engine;
}

function shortest(engine: GameEngine): number | null {
  return searchShortestWin(engine, { stateCap: SEARCH_STATE_CAP, allowDrops: true })?.length ?? null;
}

function where(engine: GameEngine): string {
  const { x, y } = engine.getPlayer();
  return `${x},${y}`;
}

function countTerrain(level: CompiledLevel, id: string): number {
  return level.terrain.flat().filter((t) => t === id).length;
}

function countItems(level: CompiledLevel, id: string): number {
  return level.items.flat().filter((t) => t === id).length;
}

/** The cells of one terrain id, as "x,y" in reading order. */
function cellsOf(level: CompiledLevel, id: string): string[] {
  const cells: string[] = [];
  level.terrain.forEach((row, y) => row.forEach((t, x) => t === id && cells.push(`${x},${y}`)));
  return cells;
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

describe('pilot chapter 3 every level', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  it.each(CHAPTER_THREE_LEVELS)('%s: the stored solution wins, the validator finds no error, and no block can hide an item', (id) => {
    const level = levelById(id);
    expect(storedSolutionWins(level)).toBe(true);
    const report = LevelValidator.validate(level, storedSolutionWins);
    expect(report.issues.filter((i) => i.severity === 'error')).toEqual([]);
    const hidden = report.issues.find((i) => i.i18nKey === 'validator.issues.hidden_by_block.label');
    expect(hidden?.params?.count ?? 0).toBe(0);
  });

  it.each(CHAPTER_THREE_LEVELS)('%s: no block can crush the player, in a scan that is complete, drops allowed', { timeout: TEST_TIMEOUT_MS }, (id) => {
    const scan = scanHazards(levelById(id), { allowDrops: true });
    expect(scan.truncated).toBe(false);
    expect(scan.unsettled).toBe(0);
    expect(scan.blockBounces).toBe(0);
    expect(hasNoCrushHazard(scan)).toBe(true);
  });

  it.each(CHAPTER_THREE_LEVELS)('%s: holds no ice boots and no creature, only the one block of the flippers level', (id) => {
    const level = levelById(id);
    expect(countItems(level, ICE_BOOTS)).toBe(0);
    const entityTypes = level.entities.map((e) => e.type);
    expect(entityTypes).toEqual(id === FLIPPERS_LEVEL ? ['dirt_block'] : []);
  });

  it('runs untimed, like every level before the first timed one', () => {
    for (const id of CHAPTER_THREE_LEVELS) expect(levelById(id).timeLimitSeconds).toBe(0);
  });
});

describe('pilot chapter 3 firewall', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  const FIRE_CELLS = ['1,2', '3,2'];
  const BOOTS_MOVE = 6;
  const FIRST_FIRE_MOVE = 15;

  it('is won by its stored solution, and no shorter win exists, drops allowed', { timeout: TEST_TIMEOUT_MS }, () => {
    const level = levelById(FIREWALL_LEVEL);
    expect(level.solution?.length).toBe(30);
    expect(shortest(engineFor(level))).toBe(30);
  });

  it('shows each chip behind one fire cell, with the only boots at the end of the other corridor', () => {
    const level = levelById(FIREWALL_LEVEL);
    expect(cellsOf(level, 'fire')).toEqual(FIRE_CELLS);
    expect(countItems(level, 'chip')).toBe(2);
    expect(level.items[1][1]).toBe('chip');
    expect(level.items[1][3]).toBe('chip');
    expect(countItems(level, FIRE_BOOTS)).toBe(1);
    expect(level.items[1][9]).toBe(FIRE_BOOTS);
    expect(level.chipsRequired).toBe(2);
  });

  it('puts the boots on in move 6 and steps into the first fire cell in move 15, so the boots come first', () => {
    const level = levelById(FIREWALL_LEVEL);
    let bootsMove = 0;
    let firstFireMove = 0;
    replayStored(level, (engine, move) => {
      const { x, y, boots } = engine.getPlayer();
      if (bootsMove === 0 && boots.has(FIRE_BOOTS)) bootsMove = move;
      if (firstFireMove === 0 && engine.getTerrain()[y][x] === 'fire') {
        firstFireMove = move;
        expect(boots.has(FIRE_BOOTS)).toBe(true);
      }
    });
    expect(bootsMove).toBe(BOOTS_MOVE);
    expect(firstFireMove).toBe(FIRST_FIRE_MOVE);
  });

  it('burns the player on either fire cell without the boots, and in no other way', { timeout: TEST_TIMEOUT_MS }, () => {
    const scan = scanHazards(levelById(FIREWALL_LEVEL), { allowDrops: true });
    expect(scan.states).toBe(2404);
    expect(scan.deaths.map((d) => `${d.reason}@${d.x},${d.y}`).sort()).toEqual([`${DEATH_FIRE}@1,2`, `${DEATH_FIRE}@3,2`]);
  });

  it('collects nothing before the boots: in every state reached without them both chips are still on the map and the socket stays shut', { timeout: TEST_TIMEOUT_MS }, () => {
    const level = levelById(FIREWALL_LEVEL);
    let leastChipsLeft = level.chipsRequired;
    let socketsShut = true;
    const visited = new Set<string>();
    exploreStateGraph(engineFor(level), {
      stateCap: SEARCH_STATE_CAP,
      allowDrops: true,
      expandIf: (engine) => !engine.getPlayer().boots.has(FIRE_BOOTS),
      onState: (engine) => {
        if (engine.getPlayer().boots.has(FIRE_BOOTS)) return;
        socketsShut = socketsShut && engine.getTerrain()[4][5] === 'socket' && !engine.isLevelCompleted();
        leastChipsLeft = Math.min(leastChipsLeft, engine.getChipsRemaining());
        visited.add(where(engine));
      }
    });
    expect(leastChipsLeft).toBe(2);
    expect(socketsShut).toBe(true);
    for (const cell of [...FIRE_CELLS, '1,1', '3,1']) expect(visited.has(cell), cell).toBe(false);
    // The hub and the corridor to the boots, up to the cell before them (standing on the boots cell is having them).
    expect([...visited].sort()).toEqual(['1,3', '2,3', '3,3', '4,3', '5,3', '6,3', '7,3', '8,3', '9,2', '9,3']);
  });

  it('the shortest way onto a fire cell takes 15 moves, boots in hand', { timeout: TEST_TIMEOUT_MS }, () => {
    const level = levelById(FIREWALL_LEVEL);
    const onFire = (engine: GameEngine): boolean => {
      const { x, y } = engine.getPlayer();
      return engine.getTerrain()[y][x] === 'fire';
    };
    const found = searchShortestWinLean(engineFor(level), { allowDrops: true, goal: onFire });
    expect(found?.length).toBe(FIRST_FIRE_MOVE);
    const engine = engineFor(level);
    for (const action of found?.actions ?? []) expect(PieceSolver.play(engine, action as Direction)).toBe(true);
    expect(engine.getPlayer().boots.has(FIRE_BOOTS)).toBe(true);
  });

  it('can always still be won by playing on: no state is a dead end unless the player puts the boots down beyond a fire cell', { timeout: TEST_TIMEOUT_MS }, () => {
    const level = levelById(FIREWALL_LEVEL);
    const noDrops = exploreStateGraph(engineFor(level), { stateCap: SEARCH_STATE_CAP, allowDrops: false });
    expect(noDrops.dead).toBe(0);
    // Dropping is a deliberate act (keys E and X): left on a chip cell behind the fire, the boots strand the player.
    const stranded: string[] = [];
    const withDrops = exploreStateGraph(engineFor(level), {
      stateCap: SEARCH_STATE_CAP,
      allowDrops: true,
      onDead: (engine) => {
        const { x, y, boots } = engine.getPlayer();
        const dropped = engine
          .getItems()
          .flatMap((row, iy) => row.flatMap((item, ix) => (item === FIRE_BOOTS ? [`${ix},${iy}`] : [])))
          .filter((cell) => cell !== '9,1');
        stranded.push(`player ${x},${y} boots ${boots.has(FIRE_BOOTS) ? 'worn' : 'off'} dropped ${dropped.join('|')}`);
      }
    });
    expect(withDrops.states).toBe(2404);
    expect(withDrops.dead).toBe(18);
    expect(stranded).toHaveLength(18);
    // Every dead state: the player stands beyond a fire cell (x 1 or 3, y 1 or 2), the boots are off his feet and lie on a chip cell behind the fire.
    for (const line of stranded) expect(line, line).toMatch(/^player [13],[12] boots off dropped [13],1$/);
  });
});

describe('pilot chapter 3 a block for the flippers', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  /** From the start: down to the room, round the block, and push it east into the moat. */
  const MOAT_FILLED = 'SSESEEEE';
  /** From the start: round below the block and push it north, twice, into the puddle. */
  const PUDDLE_FILLED = 'SSESSENN';

  it('is won by its stored solution, and no shorter win exists, drops allowed', { timeout: TEST_TIMEOUT_MS }, () => {
    const level = levelById(FLIPPERS_LEVEL);
    expect(level.solution?.length).toBe(35);
    expect(shortest(engineFor(level))).toBe(35);
  });

  it('holds one block and a budget of one water to fill, among a moat, a puddle and a lake', () => {
    const level = levelById(FLIPPERS_LEVEL);
    expect(level.entities).toHaveLength(1);
    expect(level.blockBudget).toEqual({ waters: 1, targets: 0 });
    expect(cellsOf(level, 'water')).toEqual(['3,2', '10,3', '11,3', '7,4', '10,4', '11,4', '10,5', '11,5', '10,6', '11,6']);
    expect(countItems(level, WATER_BOOTS)).toBe(1);
    expect(level.items[4][8]).toBe(WATER_BOOTS);
  });

  it('fills the moat with the block in move 8 and the shortest win from there is exactly the 27 moves left', { timeout: TEST_TIMEOUT_MS }, () => {
    const level = levelById(FLIPPERS_LEVEL);
    const engine = engineAfter(level, MOAT_FILLED);
    expect(engine.getTerrain()[4][7]).toBe('dirt');
    expect(engine.getEntities()).toHaveLength(0);
    expect(level.solution?.startsWith(MOAT_FILLED)).toBe(true);
    expect(shortest(engine)).toBe(27);
  });

  it('is lost for good once the block is spent on the puddle: the moat can never be filled', { timeout: TEST_TIMEOUT_MS }, () => {
    const level = levelById(FLIPPERS_LEVEL);
    const engine = engineAfter(level, PUDDLE_FILLED);
    expect(engine.getTerrain()[2][3]).toBe('dirt');
    expect(engine.getEntities()).toHaveLength(0);
    expect(engine.getTerrain()[4][7]).toBe('water');
    expect(searchCanWin(engine, { stateCap: SEARCH_STATE_CAP, allowDrops: true })).toBe(false);
  });

  it('drowns the player only in the puddle and the moat when the flippers are never put down, and in the lake too once they are', { timeout: TEST_TIMEOUT_MS }, () => {
    const level = levelById(FLIPPERS_LEVEL);
    const deathsOf = (allowDrops: boolean): string[] =>
      scanHazards(level, { allowDrops })
        .deaths.map((d) => `${d.reason}@${d.x},${d.y}`)
        .sort();
    expect(deathsOf(false)).toEqual([`${DEATH_WATER}@3,2`, `${DEATH_WATER}@7,4`]);
    expect(deathsOf(true)).toEqual(
      ['3,2', '7,4', '10,3', '10,4', '10,5', '10,6', '11,3', '11,4', '11,5', '11,6'].map((cell) => `${DEATH_WATER}@${cell}`).sort()
    );
  });

  it('keeps the lake and both banks for the flippers: they lie right behind the moat, so no state reached without them has the player past column 7', { timeout: TEST_TIMEOUT_MS }, () => {
    const level = levelById(FLIPPERS_LEVEL);
    let farthestEast = 0;
    let leastChipsLeft = level.chipsRequired;
    exploreStateGraph(engineFor(level), {
      stateCap: SEARCH_STATE_CAP,
      allowDrops: true,
      expandIf: (engine) => !engine.getPlayer().boots.has(WATER_BOOTS),
      onState: (engine) => {
        if (engine.getPlayer().boots.has(WATER_BOOTS)) return;
        farthestEast = Math.max(farthestEast, engine.getPlayer().x);
        leastChipsLeft = Math.min(leastChipsLeft, engine.getChipsRemaining());
      }
    });
    // The filled moat is the last cell the player can stand on without the flippers. The one chip within reach before them
    // is the puddle's, and only by spending the block there, which loses the level (see above).
    expect(farthestEast).toBe(7);
    expect(leastChipsLeft).toBe(2);
  });

  it('puts the flippers on in move 10 of the stored solution, before the first step onto water that is still water', () => {
    const level = levelById(FLIPPERS_LEVEL);
    let flippersMove = 0;
    let firstWaterMove = 0;
    replayStored(level, (engine, move) => {
      const { x, y, boots } = engine.getPlayer();
      if (flippersMove === 0 && boots.has(WATER_BOOTS)) flippersMove = move;
      if (firstWaterMove === 0 && engine.getTerrain()[y][x] === 'water') {
        firstWaterMove = move;
        expect(boots.has(WATER_BOOTS)).toBe(true);
      }
    });
    expect(flippersMove).toBe(10);
    expect(firstWaterMove).toBe(17);
  });
});

describe('pilot chapter 3 slide', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  it('is won by its stored solution, and no shorter win exists, drops allowed', { timeout: TEST_TIMEOUT_MS }, () => {
    const level = levelById(SLIDE_LEVEL);
    expect(level.solution?.length).toBe(18);
    expect(shortest(engineFor(level))).toBe(18);
  });

  it('has three ice corridors: the top one ends on a chip, the bottom one has a floor stop halfway, the middle one ends on a wall', () => {
    const level = levelById(SLIDE_LEVEL);
    expect(countTerrain(level, 'ice')).toBe(7 + 8 + 3 + 3);
    expect(level.terrain[1][8]).toBe('ice');
    expect(level.terrain[1][9]).toBe('floor');
    expect(level.items[1][9]).toBe('chip');
    expect(level.terrain[7].slice(1, 10)).toEqual(['floor', 'ice', 'ice', 'ice', 'floor', 'ice', 'ice', 'ice', 'floor']);
    expect(level.items[7][9]).toBe('chip');
    expect(level.terrain[4][9]).toBe('ice');
    expect(level.terrain[4][10]).toBe('wall');
    expect(level.items[4][5]).toBe('chip');
  });

  it('bounces off the wall at the end of the middle corridor harmlessly: one move out and back, chip taken, back on the start cell', () => {
    const level = levelById(SLIDE_LEVEL);
    const engine = engineFor(level);
    expect(where(engine)).toBe('1,4');
    expect(engine.getChipsRemaining()).toBe(3);
    expect(PieceSolver.play(engine, 'E')).toBe(true);
    expect(engine.getPlayer().alive).toBe(true);
    expect(engine.getPlayer().isSliding).toBe(false);
    expect(where(engine)).toBe('1,4');
    expect(engine.getChipsRemaining()).toBe(2);
    expect(engine.getStepsCount()).toBe(1);
  });

  it('slides on to the chip at the end of a corridor and back to the hub in one move each way', () => {
    const level = levelById(SLIDE_LEVEL);
    const engine = engineAfter(level, 'NNN');
    expect(where(engine)).toBe('1,1');
    playAll(engine, 'E');
    expect(where(engine)).toBe('9,1');
    expect(engine.getChipsRemaining()).toBe(2);
    playAll(engine, 'W');
    expect(where(engine)).toBe('1,1');
  });

  it('stops a slide on the floor halfway down the bottom corridor, and a second press carries on to the chip', () => {
    const level = levelById(SLIDE_LEVEL);
    const engine = engineAfter(level, 'SSS');
    expect(where(engine)).toBe('1,7');
    playAll(engine, 'E');
    expect(where(engine)).toBe('5,7');
    expect(engine.getChipsRemaining()).toBe(3);
    playAll(engine, 'E');
    expect(where(engine)).toBe('9,7');
    expect(engine.getChipsRemaining()).toBe(2);
    playAll(engine, 'W');
    expect(where(engine)).toBe('5,7');
    playAll(engine, 'W');
    expect(where(engine)).toBe('1,7');
  });

  it('cannot kill or trap: the scan is complete with no death, and every state can still win', { timeout: TEST_TIMEOUT_MS }, () => {
    const level = levelById(SLIDE_LEVEL);
    const scan = scanHazards(level, { allowDrops: true });
    expect(scan.states).toBe(274);
    expect(scan.deaths).toEqual([]);
    const graph = exploreStateGraph(engineFor(level), { stateCap: SEARCH_STATE_CAP, allowDrops: true });
    expect(graph.states).toBe(274);
    expect(graph.dead).toBe(0);
  });
});

describe('pilot chapter 3 toboggan', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  const PAD = '6,4';
  /** Each launch from the pad and the cell where its slide ends. */
  const LANDINGS: Array<[Direction, string]> = [
    ['N', '9,1'],
    ['E', '9,7'],
    ['S', '3,7'],
    ['W', '3,1']
  ];
  /** The slide that takes each landing back to the pad. */
  const RETURNS: Record<string, Direction> = { '9,1': 'W', '9,7': 'N', '3,7': 'E', '3,1': 'S' };

  it('is won by its stored solution, and no shorter win exists, drops allowed', { timeout: TEST_TIMEOUT_MS }, () => {
    const level = levelById(TOBOGGAN_LEVEL);
    expect(level.solution?.length).toBe(9);
    expect(shortest(engineFor(level))).toBe(9);
  });

  it('holds exactly four turns, one of each kind, and four tracks that leave the pad', () => {
    const level = levelById(TOBOGGAN_LEVEL);
    for (const turn of ['ice_nw', 'ice_ne', 'ice_sw', 'ice_se']) expect(countTerrain(level, turn), turn).toBe(1);
    expect(cellsOf(level, 'hint')).toEqual([PAD]);
    expect(`${level.playerStart.x},${level.playerStart.y}`).toBe(PAD);
  });

  it('lands each of the four launches on a different cell, and every landing slides back to the pad', () => {
    const level = levelById(TOBOGGAN_LEVEL);
    const landed: string[] = [];
    for (const [launch, landing] of LANDINGS) {
      const engine = engineAfter(level, launch);
      expect(engine.getPlayer().alive).toBe(true);
      expect(where(engine)).toBe(landing);
      landed.push(where(engine));
      playAll(engine, RETURNS[landing]);
      expect(where(engine)).toBe(PAD);
    }
    expect(new Set(landed).size).toBe(4);
  });

  it('reaches the exit from only one landing: with the chips already in hand, the other three still need the slide back to the pad', { timeout: TEST_TIMEOUT_MS }, () => {
    const level = levelById(TOBOGGAN_LEVEL);
    // The socket opens at once, so only the distance to the exit counts.
    const chipless = structuredClone(level);
    chipless.chipsRequired = 0;
    chipless.items = chipless.items.map((row) => row.map(() => null));
    expect(shortest(engineFor(chipless))).toBe(3);
    const remaining: Record<string, number | null> = {};
    for (const [launch, landing] of LANDINGS) remaining[landing] = shortest(engineAfter(chipless, launch));
    expect(remaining).toEqual({ '9,1': 4, '9,7': 4, '3,7': 4, '3,1': 2 });
  });

  it('puts one chip on each of the three wrong landings and the socket beside the right one', () => {
    const level = levelById(TOBOGGAN_LEVEL);
    expect(countItems(level, 'chip')).toBe(3);
    for (const landing of ['9,1', '9,7', '3,7']) {
      const [x, y] = landing.split(',').map(Number);
      expect(level.items[y][x], landing).toBe('chip');
    }
    expect(level.terrain[1][2]).toBe('socket');
    expect(level.terrain[1][1]).toBe('exit');
  });

  it('cannot kill or trap: the scan is complete with no death, and every state can still win', { timeout: TEST_TIMEOUT_MS }, () => {
    const level = levelById(TOBOGGAN_LEVEL);
    const scan = scanHazards(level, { allowDrops: true });
    expect(scan.states).toBe(97);
    expect(scan.deaths).toEqual([]);
    const graph = exploreStateGraph(engineFor(level), { stateCap: SEARCH_STATE_CAP, allowDrops: true });
    expect(graph.states).toBe(97);
    expect(graph.dead).toBe(0);
  });
});

describe('pilot chapter 3 key on the fly', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  const DOOR_CELL = '9,4';

  it('is won by its stored solution, and no shorter win exists, drops allowed', { timeout: TEST_TIMEOUT_MS }, () => {
    const level = levelById(KEY_ON_THE_FLY_LEVEL);
    expect(level.solution?.length).toBe(15);
    expect(shortest(engineFor(level))).toBe(15);
  });

  it('lays the only key on the ice, one cell before the only door, which is the one way to the exit', () => {
    const level = levelById(KEY_ON_THE_FLY_LEVEL);
    expect(countItems(level, RED_KEY)).toBe(1);
    expect(level.items[4][8]).toBe(RED_KEY);
    expect(level.terrain[4][8]).toBe('ice');
    expect(cellsOf(level, RED_DOOR)).toEqual([DOOR_CELL]);
    expect(level.terrain[4][10]).toBe('floor');
    expect(level.terrain[4][11]).toBe('socket');
    expect(level.terrain[4][12]).toBe('exit');
  });

  it('picks the key up and spends it in the same move: the key is never in hand once a move has settled', { timeout: TEST_TIMEOUT_MS }, () => {
    const level = levelById(KEY_ON_THE_FLY_LEVEL);
    let mostKeysHeld = 0;
    let doorOpenStates = 0;
    const graph = exploreStateGraph(engineFor(level), {
      stateCap: SEARCH_STATE_CAP,
      allowDrops: true,
      onState: (engine) => {
        mostKeysHeld = Math.max(mostKeysHeld, engine.getPlayer().keys[RED_KEY] ?? 0);
        if (engine.getTerrain()[4][9] !== RED_DOOR) doorOpenStates++;
      }
    });
    expect(graph.states).toBe(286);
    expect(mostKeysHeld).toBe(0);
    expect(doorOpenStates).toBe(180);
    expect(graph.dead).toBe(0);
  });

  it('opens the door in the one slide that crosses the key cell: key on the map and door shut before it, both gone and the player on the door cell after it', () => {
    const level = levelById(KEY_ON_THE_FLY_LEVEL);
    const engine = engineFor(level);
    let openingMove = 0;
    const moves = level.solution ?? '';
    for (let i = 0; i < moves.length; i++) {
      const doorBefore = engine.getTerrain()[4][9];
      const keyBefore = engine.getItems()[4][8];
      const at = where(engine);
      expect(PieceSolver.play(engine, moves[i] as Direction)).toBe(true);
      if (doorBefore === RED_DOOR && engine.getTerrain()[4][9] !== RED_DOOR) {
        openingMove = i + 1;
        expect(keyBefore).toBe(RED_KEY);
        expect(at).toBe('7,4');
        expect(moves[i]).toBe('E');
        expect(engine.getItems()[4][8]).toBeNull();
        expect(engine.getPlayer().keys[RED_KEY] ?? 0).toBe(0);
        expect(where(engine)).toBe(DOOR_CELL);
        expect(engine.getPlayer().isSliding).toBe(false);
      }
    }
    expect(openingMove).toBe(12);
    expect(engine.isLevelCompleted()).toBe(true);
  });

  it('keeps the exit shut until that slide: no state reached with the door closed has the player on the door row east of column 7', { timeout: TEST_TIMEOUT_MS }, () => {
    const level = levelById(KEY_ON_THE_FLY_LEVEL);
    let farthestEastOnTheDoorRow = 0;
    let leastChipsLeft = level.chipsRequired;
    exploreStateGraph(engineFor(level), {
      stateCap: SEARCH_STATE_CAP,
      allowDrops: true,
      expandIf: (engine) => engine.getTerrain()[4][9] === RED_DOOR,
      onState: (engine) => {
        if (engine.getTerrain()[4][9] !== RED_DOOR) return;
        if (engine.getPlayer().y === 4) farthestEastOnTheDoorRow = Math.max(farthestEastOnTheDoorRow, engine.getPlayer().x);
        leastChipsLeft = Math.min(leastChipsLeft, engine.getChipsRemaining());
      }
    });
    // The stone before the lane is the farthest the player gets on that row; every chip is still within reach beforehand.
    expect(farthestEastOnTheDoorRow).toBe(7);
    expect(leastChipsLeft).toBe(0);
  });

  it('cannot kill or trap: the scan is complete with no death and no slide that never ends', { timeout: TEST_TIMEOUT_MS }, () => {
    const scan = scanHazards(levelById(KEY_ON_THE_FLY_LEVEL), { allowDrops: true });
    expect(scan.states).toBe(286);
    expect(scan.deaths).toEqual([]);
    expect(scan.unsettled).toBe(0);
  });

  it('known limitation of the validator slide model: doors and sockets are never entered by a slide (warning on 35)', () => {
    const level = levelById(KEY_ON_THE_FLY_LEVEL);
    const report = LevelValidator.validate(level, storedSolutionWins);
    expect(report.issues.map((i) => `${i.severity}:${i.i18nKey}`)).toEqual(['warning:validator.issues.unreachable_exit_proven.label']);
  });
});
