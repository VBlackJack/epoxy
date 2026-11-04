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
import { assertNoWinWithCreatureAlive, creatureProof } from '../test/pilotCreatureProof';
import { hasNoCrushHazard, scanHazards } from '../test/pilotHazardScan';
import { searchShortestWinLean } from '../test/pilotLeanSearch';
import { applySearchAction, SearchAction, searchCanWin, searchShortestWin } from '../test/pilotSearch';
import { exploreStateGraph } from '../test/pilotStateGraph';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { ConfigRegistry } from './ConfigRegistry';

/** Generous search ceilings: the rooms are small, so a runaway proof fails loudly instead of hanging. */
const SEARCH_STATE_CAP = 400000;
const TEST_TIMEOUT_MS = 240000;

const DELIVERY_LEVEL = 'epoxy_p_36';
const BUG_LEVEL = 'epoxy_p_37';
const THAW_LEVEL = 'epoxy_p_38';
const CORK_LEVEL = 'epoxy_p_39';
const ELEMENT_LEVELS = [DELIVERY_LEVEL, BUG_LEVEL, THAW_LEVEL, CORK_LEVEL];

/** The creature or blocks each level holds, in entity order. */
const ENTITY_TYPES: Record<string, string[]> = {
  [DELIVERY_LEVEL]: ['dirt_block'],
  [BUG_LEVEL]: ['bug'],
  [THAW_LEVEL]: ['ice_block', 'dirt_block'],
  [CORK_LEVEL]: ['bug']
};

const DEATH_WATER = 'hud.messages.death_water';
const DEATH_FIRE = 'hud.messages.death_fire';
const DEATH_MONSTER = 'hud.messages.death_monster';
const CHIPS_PROVEN_WARNING = 'warning:validator.issues.unreachable_chips_proven.label';
const EXIT_PROVEN_WARNING = 'warning:validator.issues.unreachable_exit_proven.label';

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

function engineAfterActions(level: CompiledLevel, actions: SearchAction[]): GameEngine {
  const engine = engineFor(level);
  for (const action of actions) expect(applySearchAction(engine, action), `action ${action}`).toBe(true);
  return engine;
}

function shortest(engine: GameEngine): number | null {
  return searchShortestWin(engine, { stateCap: SEARCH_STATE_CAP, allowDrops: true })?.length ?? null;
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

function countHeldItems(level: CompiledLevel): number {
  return level.items.flat().filter((id) => id !== null && (id.startsWith('boots_') || id.startsWith('key_'))).length;
}

function entityCells(engine: GameEngine): string[] {
  return engine.getEntities().map((e) => `${e.type}@${e.x},${e.y}`);
}

function deathsOf(level: CompiledLevel): string[] {
  return scanHazards(level, { allowDrops: true })
    .deaths.map((d) => `${d.reason}@${d.x},${d.y}`)
    .sort();
}

function validatorIssues(level: CompiledLevel): string[] {
  return LevelValidator.validate(level, storedSolutionWins).issues.map((i) => `${i.severity}:${i.i18nKey}`);
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

describe('pilot chapter 3 elements, every level', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  it.each(ELEMENT_LEVELS)('%s: the stored solution wins, the validator finds no error, and no block can hide an item', (id) => {
    const level = levelById(id);
    expect(storedSolutionWins(level)).toBe(true);
    const report = LevelValidator.validate(level, storedSolutionWins);
    expect(report.issues.filter((i) => i.severity === 'error')).toEqual([]);
    const hidden = report.issues.find((i) => i.i18nKey === 'validator.issues.hidden_by_block.label');
    expect(hidden?.params?.count ?? 0).toBe(0);
  });

  it.each(ELEMENT_LEVELS)('%s: no block can crush the player, in a scan that is complete, drops allowed', { timeout: TEST_TIMEOUT_MS }, (id) => {
    const scan = scanHazards(levelById(id), { allowDrops: true });
    expect(scan.truncated).toBe(false);
    expect(scan.unsettled).toBe(0);
    expect(scan.blockBounces).toBe(0);
    expect(hasNoCrushHazard(scan)).toBe(true);
  });

  it.each(ELEMENT_LEVELS)('%s: holds no boots and no key at all, so there is nothing to drop, and only its own blocks and creature', (id) => {
    const level = levelById(id);
    expect(countHeldItems(level)).toBe(0);
    expect(level.entities.map((e) => e.type)).toEqual(ENTITY_TYPES[id]);
  });

  it.each(ELEMENT_LEVELS)('%s: runs untimed and keeps its texts in both languages', (id) => {
    const level = levelById(id);
    expect(level.timeLimitSeconds).toBe(0);
    expect(level.titleKey).toBe(`pilot.levels.level_${level.number}.title`);
    expect(level.hintKey).toBe(`pilot.levels.level_${level.number}.hint`);
  });

  it('puts the four levels at the end of chapter 3, in order', () => {
    const chapter = ConfigRegistry.getPilotChapters().find((c) => c.id === 'pilot_chapter_3');
    expect(chapter?.levels.slice(-4)).toEqual(ELEMENT_LEVELS);
  });
});

describe('pilot chapter 3 delivery', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  const WATER = '8,3';
  const ICE_LANE = ['4,3', '5,3', '6,3', '7,3'];
  /** From the start: round the block, up into the lane row, and the push that sends it onto the ice. */
  const FILLED_BY = 'ESSESSWNWNEE';
  /** Every cell where a block, once there, can no longer be delivered: the west column, the south wall and the entrance corridor. */
  const DEAD_BLOCK_CELLS = ['1,3', '1,4', '1,5', '2,1', '2,2', '2,5', '3,5'];

  it('is won by its stored solution, and no shorter win exists, drops allowed', { timeout: TEST_TIMEOUT_MS }, () => {
    const level = levelById(DELIVERY_LEVEL);
    expect(level.solution?.length).toBe(27);
    expect(shortest(engineFor(level))).toBe(27);
  });

  it('holds one block and a budget of one water, with a lane of four ice cells ending in that water', () => {
    const level = levelById(DELIVERY_LEVEL);
    expect(level.blockBudget).toEqual({ waters: 1, targets: 0 });
    expect(level.entities.map((e) => `${e.type}@${e.x},${e.y}`)).toEqual(['dirt_block@2,4']);
    expect(cellsOf(level, 'ice')).toEqual(ICE_LANE);
    expect(cellsOf(level, 'water')).toEqual([WATER]);
    expect(level.terrain[3][3]).toBe('floor');
  });

  it('puts every chip, the socket and the exit beyond the water, and the hint on the start cell', () => {
    const level = levelById(DELIVERY_LEVEL);
    expect(itemCells(level, 'chip')).toEqual(['9,1', '12,1', '12,5']);
    expect(level.chipsRequired).toBe(3);
    expect(cellsOf(level, 'socket')).toEqual(['13,3']);
    expect(cellsOf(level, 'exit')).toEqual(['14,3']);
    expect(cellsOf(level, 'hint')).toEqual(['1,1']);
    expect(`${level.playerStart.x},${level.playerStart.y}`).toBe('1,1');
  });

  it('delivers the block in move 12: it slides off the lane into the water, which becomes dirt, and the player follows over the ice in move 13', () => {
    const level = levelById(DELIVERY_LEVEL);
    expect(level.solution?.startsWith(FILLED_BY)).toBe(true);
    let deliveredMove = 0;
    replayStored(level, (engine, move) => {
      const water = engine.getTerrain()[3][8];
      if (deliveredMove === 0 && engine.getEntities().length === 0) {
        deliveredMove = move;
        expect(water).toBe('dirt');
        expect(where(engine)).toBe('3,3');
      } else if (deliveredMove === 0) {
        expect(water).toBe('water');
      }
      if (move === 13) expect(where(engine)).toBe(WATER);
    });
    expect(deliveredMove).toBe(12);
  });

  it('drowns the player only in the water at the end of the lane, five moves from the start, and in no other way', { timeout: TEST_TIMEOUT_MS }, () => {
    const scan = scanHazards(levelById(DELIVERY_LEVEL), { allowDrops: true });
    expect(scan.states).toBe(1339);
    expect(scan.deaths.map((d) => `${d.reason}@${d.x},${d.y}`)).toEqual([`${DEATH_WATER}@8,3`]);
    expect(scan.deaths[0].path.join('')).toBe('ESSEE');
  });

  it('cannot be won without the block, and the far side stays shut while the water is open: the player never gets past column 3 or takes a chip', { timeout: TEST_TIMEOUT_MS }, () => {
    const level = levelById(DELIVERY_LEVEL);
    const blockless = structuredClone(level);
    blockless.entities = [];
    expect(searchCanWin(engineFor(blockless), { stateCap: SEARCH_STATE_CAP, allowDrops: true })).toBe(false);
    let farthestEast = 0;
    let leastChipsLeft = level.chipsRequired;
    let openStates = 0;
    exploreStateGraph(engineFor(level), {
      stateCap: SEARCH_STATE_CAP,
      allowDrops: true,
      expandIf: (engine) => engine.getTerrain()[3][8] === 'water',
      onState: (engine) => {
        if (engine.getTerrain()[3][8] !== 'water') return;
        openStates++;
        farthestEast = Math.max(farthestEast, engine.getPlayer().x);
        leastChipsLeft = Math.min(leastChipsLeft, engine.getChipsRemaining());
      }
    });
    expect(openStates).toBe(431);
    // The lane is never stood on: a step onto it is a slide into the open water, which is a death and no settled state.
    expect(farthestEast).toBe(3);
    expect(leastChipsLeft).toBe(3);
  });

  it('can be lost only by leaving the block on the west column, the south wall or the entrance corridor, and every such state is a dead end', { timeout: TEST_TIMEOUT_MS }, () => {
    const level = levelById(DELIVERY_LEVEL);
    const deadCells = new Set<string>();
    const deadStates: string[] = [];
    const graph = exploreStateGraph(engineFor(level), {
      stateCap: SEARCH_STATE_CAP,
      allowDrops: true,
      onDead: (engine) => {
        const blocks = engine.getEntities();
        deadStates.push(blocks.map((b) => `${b.x},${b.y}`).join('|'));
        for (const b of blocks) deadCells.add(`${b.x},${b.y}`);
      }
    });
    expect(graph.states).toBe(1339);
    expect(graph.canWin).toBe(1047);
    expect(graph.dead).toBe(292);
    expect(deadStates).toHaveLength(292);
    expect([...deadCells].sort()).toEqual(DEAD_BLOCK_CELLS);
  });

  it('known limitation of the validator slide model: it cannot see a block filling the water (two warnings on 36)', () => {
    expect(validatorIssues(levelById(DELIVERY_LEVEL))).toEqual([CHIPS_PROVEN_WARNING, EXIT_PROVEN_WARNING]);
  });
});

describe('pilot chapter 3 the bug', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  const PLUG = '9,2';
  const POOL = '10,2';
  /** Everything the scan finds: one drowning in the pool, and the bug's kills along its corridor and on the plug. */
  const EXPECTED_DEATHS = [
    `${DEATH_WATER}@10,2`,
    `${DEATH_MONSTER}@3,1`,
    `${DEATH_MONSTER}@4,1`,
    `${DEATH_MONSTER}@5,1`,
    `${DEATH_MONSTER}@6,1`,
    `${DEATH_MONSTER}@7,1`,
    `${DEATH_MONSTER}@8,1`,
    `${DEATH_MONSTER}@9,1`,
    `${DEATH_MONSTER}@9,2`
  ].sort();

  it('is won by its stored solution, and no shorter win exists, drops allowed', { timeout: TEST_TIMEOUT_MS }, () => {
    const level = levelById(BUG_LEVEL);
    expect(level.solution?.length).toBe(26);
    expect(shortest(engineFor(level))).toBe(26);
  });

  it('is a left-wall follower in a one-wide corridor with a dirt plug at its east end, a pool beyond the plug and the socket at its west end', () => {
    const level = levelById(BUG_LEVEL);
    const bug = ConfigRegistry.getEntityDef('bug');
    expect(bug?.movementPattern).toBe('left_wall');
    expect(bug?.moveIntervalTicks).toBe(5);
    expect(level.entities.map((e) => `${e.type}@${e.x},${e.y}`)).toEqual(['bug@5,1']);
    for (let x = 3; x <= 9; x++) {
      expect(level.terrain[0][x], `north of ${x}`).toBe('wall');
      expect(level.terrain[2][x], `south of ${x}`).toBe(x === 9 ? 'dirt' : 'wall');
    }
    expect(level.terrain[1].slice(3, 10)).toEqual(Array(7).fill('floor'));
    expect(level.terrain[1][10]).toBe('wall');
    expect(level.terrain[1][2]).toBe('socket');
    expect(level.terrain[1][1]).toBe('exit');
    expect(cellsOf(level, 'dirt')).toEqual([PLUG]);
    expect(cellsOf(level, 'water')).toEqual([POOL]);
    // The pool is closed on every other side, so the bug has nowhere else to go once it is in.
    expect(level.terrain[1][10]).toBe('wall');
    expect(level.terrain[2][11]).toBe('wall');
    expect(level.terrain[3][10]).toBe('wall');
  });

  it('cannot be won with the bug alive, with drops on or off, and the level is winnable', { timeout: TEST_TIMEOUT_MS }, () => {
    const level = levelById(BUG_LEVEL);
    expect(shortest(engineFor(level))).toBe(26);
    expect(() => assertNoWinWithCreatureAlive(level, { stateCap: SEARCH_STATE_CAP })).not.toThrow();
    const proof = creatureProof(level, { stateCap: SEARCH_STATE_CAP });
    expect(proof.withDrops).toBeNull();
    expect(proof.withoutDrops).toBeNull();
  });

  it('cannot be won with the dirt plug left in place: the plug has to be trodden', { timeout: TEST_TIMEOUT_MS }, () => {
    const level = levelById(BUG_LEVEL);
    const plugIntact = (engine: GameEngine): boolean => engine.getTerrain()[2][9] === 'dirt';
    expect(searchShortestWin(engineFor(level), { stateCap: SEARCH_STATE_CAP, allowDrops: true, accept: plugIntact })).toBeNull();
    const trodden = searchShortestWin(engineFor(level), { stateCap: SEARCH_STATE_CAP, allowDrops: true, accept: (e) => !plugIntact(e) });
    expect(trodden?.length).toBe(26);
  });

  it('treads the plug in move 3 with the bug still two cells from the plug, and the bug is gone, drowned in the pool, by move 9', () => {
    const level = levelById(BUG_LEVEL);
    let plugMove = 0;
    let onPlugMove = 0;
    let goneMove = 0;
    replayStored(level, (engine, move) => {
      if (plugMove === 0 && engine.getTerrain()[2][9] !== 'dirt') {
        plugMove = move;
        expect(entityCells(engine)).toEqual(['bug@7,1']);
      }
      if (onPlugMove === 0 && entityCells(engine).includes('bug@9,2')) onPlugMove = move;
      if (goneMove === 0 && engine.getEntities().length === 0) {
        goneMove = move;
        expect(engine.getTerrain()[2][10]).toBe('water');
      }
    });
    expect(plugMove).toBe(3);
    expect(onPlugMove).toBe(8);
    expect(goneMove).toBe(9);
  });

  it('keeps the bug shut in its corridor while the plug stands, and the bug dies only after the plug is trodden, in the pool', { timeout: TEST_TIMEOUT_MS }, () => {
    const level = levelById(BUG_LEVEL);
    let sealedStates = 0;
    let bugless = 0;
    exploreStateGraph(engineFor(level), {
      stateCap: SEARCH_STATE_CAP,
      allowDrops: true,
      onState: (engine) => {
        const bugs = engine.getEntities();
        if (engine.getTerrain()[2][9] === 'dirt') {
          sealedStates++;
          expect(bugs).toHaveLength(1);
          expect(bugs[0].y).toBe(1);
          expect(bugs[0].x).toBeGreaterThanOrEqual(3);
          expect(bugs[0].x).toBeLessThanOrEqual(9);
        }
        if (bugs.length === 0) {
          bugless++;
          expect(engine.getTerrain()[2][9]).toBe('floor');
          expect(engine.getTerrain()[2][10]).toBe('water');
        }
      }
    });
    expect(sealedStates).toBe(5346);
    expect(bugless).toBe(605);
  });

  it('kills only by the bug along its corridor and on the plug, and by the pool; and no state is a dead end', { timeout: TEST_TIMEOUT_MS }, () => {
    const level = levelById(BUG_LEVEL);
    const scan = scanHazards(level, { allowDrops: true });
    expect(scan.states).toBe(11675);
    expect(deathsOf(level)).toEqual(EXPECTED_DEATHS);
    const graph = exploreStateGraph(engineFor(level), { stateCap: SEARCH_STATE_CAP, allowDrops: true });
    expect(graph.states).toBe(11675);
    expect(graph.dead).toBe(0);
  });

  it('opens with no known validator issue', () => {
    expect(validatorIssues(levelById(BUG_LEVEL))).toEqual([]);
  });
});

describe('pilot chapter 3 thaw', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  const FIRE = '6,4';
  /** Where the stored solution pushes the ice block, then the dirt block, onto the fire cell. */
  const ICE_MELTS_MOVE = 7;
  const DIRT_FILLS_MOVE = 15;

  it('is won by its stored solution, and no shorter win exists, drops allowed', { timeout: TEST_TIMEOUT_MS }, () => {
    const level = levelById(THAW_LEVEL);
    expect(level.solution?.length).toBe(20);
    expect(shortest(engineFor(level))).toBe(20);
  });

  it('holds one ice block and one dirt block, one fire and no water, with the hint on the start cell', () => {
    const level = levelById(THAW_LEVEL);
    expect(level.entities.map((e) => `${e.type}@${e.x},${e.y}`)).toEqual(['ice_block@2,4', 'dirt_block@6,2']);
    expect(cellsOf(level, 'fire')).toEqual([FIRE]);
    expect(cellsOf(level, 'water')).toEqual([]);
    expect(level.blockBudget).toBeUndefined();
    expect(cellsOf(level, 'hint')).toEqual(['1,1']);
    expect(`${level.playerStart.x},${level.playerStart.y}`).toBe('1,1');
  });

  it('melts the fire into water with the ice block in move 7, and fills that water with the dirt block in move 15', () => {
    const level = levelById(THAW_LEVEL);
    let meltMove = 0;
    let fillMove = 0;
    replayStored(level, (engine, move) => {
      const cell = engine.getTerrain()[4][6];
      if (meltMove === 0 && cell !== 'fire') {
        meltMove = move;
        expect(cell).toBe('water');
        expect(entityCells(engine)).toEqual(['dirt_block@6,2']);
      } else if (meltMove !== 0 && fillMove === 0 && cell !== 'water') {
        fillMove = move;
        expect(cell).toBe('dirt');
        expect(engine.getEntities()).toHaveLength(0);
      }
    });
    expect(meltMove).toBe(ICE_MELTS_MOVE);
    expect(fillMove).toBe(DIRT_FILLS_MOVE);
  });

  it('burns the player on the fire and drowns him in the water it leaves, and in no other way', { timeout: TEST_TIMEOUT_MS }, () => {
    const level = levelById(THAW_LEVEL);
    const scan = scanHazards(level, { allowDrops: true });
    expect(scan.states).toBe(1251);
    expect(deathsOf(level)).toEqual([`${DEATH_FIRE}@6,4`, `${DEATH_WATER}@6,4`].sort());
  });

  it('cannot be won with the fire left as it is, and the far side stays shut until the water is filled: the player never stands past column 6 before', { timeout: TEST_TIMEOUT_MS }, () => {
    const level = levelById(THAW_LEVEL);
    const stillFire = (engine: GameEngine): boolean => engine.getTerrain()[4][6] === 'fire';
    expect(searchShortestWin(engineFor(level), { stateCap: SEARCH_STATE_CAP, allowDrops: true, accept: stillFire })).toBeNull();
    let farthestEast = 0;
    let leastChipsLeft = level.chipsRequired;
    exploreStateGraph(engineFor(level), {
      stateCap: SEARCH_STATE_CAP,
      allowDrops: true,
      expandIf: (engine) => engine.getTerrain()[4][6] !== 'dirt',
      onState: (engine) => {
        if (engine.getTerrain()[4][6] === 'dirt') return;
        farthestEast = Math.max(farthestEast, engine.getPlayer().x);
        leastChipsLeft = Math.min(leastChipsLeft, engine.getChipsRemaining());
      }
    });
    expect(farthestEast).toBe(6);
    expect(leastChipsLeft).toBe(1);
  });

  it('is lost for good once the dirt block is pushed onto the fire: the ice can no longer reach it, and no state with the dirt block there can win', { timeout: TEST_TIMEOUT_MS }, () => {
    const level = levelById(THAW_LEVEL);
    const dirtOnFire = (engine: GameEngine): boolean => engine.getEntities().some((e) => e.type === 'dirt_block' && e.x === 6 && e.y === 4);
    const wrong = searchShortestWinLean(engineFor(level), { allowDrops: true, goal: dirtOnFire });
    // Straight from the start: east along the top, down the dirt lane, onto the fire (the ice block never moves).
    expect(wrong?.actions.join('')).toBe('EEEEESS');
    const engine = engineAfterActions(level, wrong?.actions ?? []);
    expect(engine.getTerrain()[4][6]).toBe('fire');
    expect(entityCells(engine)).toEqual(['ice_block@2,4', 'dirt_block@6,4']);
    expect(searchCanWin(engine, { stateCap: SEARCH_STATE_CAP, allowDrops: true })).toBe(false);

    let onFireStates = 0;
    let onFireDead = 0;
    exploreStateGraph(engineFor(level), {
      stateCap: SEARCH_STATE_CAP,
      allowDrops: true,
      onState: (e) => {
        if (dirtOnFire(e)) onFireStates++;
      },
      onDead: (e) => {
        if (dirtOnFire(e)) onFireDead++;
      }
    });
    expect(onFireStates).toBe(316);
    expect(onFireDead).toBe(316);
  });

  it('has exactly two kinds of dead end: the dirt block on the fire, or the ice block pushed against the west wall', { timeout: TEST_TIMEOUT_MS }, () => {
    const level = levelById(THAW_LEVEL);
    const kinds: Record<string, number> = {};
    const graph = exploreStateGraph(engineFor(level), {
      stateCap: SEARCH_STATE_CAP,
      allowDrops: true,
      onDead: (engine) => {
        const ice = engine.getEntities().find((e) => e.type === 'ice_block');
        const dirt = engine.getEntities().find((e) => e.type === 'dirt_block');
        const kind = dirt?.x === 6 && dirt.y === 4 ? 'dirt on the fire' : ice?.x === 1 && ice.y === 4 ? 'ice against the west wall' : 'other';
        kinds[kind] = (kinds[kind] ?? 0) + 1;
      }
    });
    expect(graph.states).toBe(1251);
    expect(graph.canWin).toBe(838);
    expect(graph.dead).toBe(413);
    expect(kinds).toEqual({ 'dirt on the fire': 316, 'ice against the west wall': 97 });
  });

  it('known limitation of the validator slide model: it cannot see a block melting a fire (two warnings on 38)', () => {
    expect(validatorIssues(levelById(THAW_LEVEL))).toEqual([CHIPS_PROVEN_WARNING, EXIT_PROVEN_WARNING]);
  });
});

describe('pilot chapter 3 the cork', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  const CORK = '7,1';
  const PLUG = '5,2';
  const POOL = '5,3';
  const EXPECTED_DEATHS = [
    `${DEATH_WATER}@5,3`,
    `${DEATH_MONSTER}@1,1`,
    `${DEATH_MONSTER}@2,1`,
    `${DEATH_MONSTER}@3,1`,
    `${DEATH_MONSTER}@4,1`,
    `${DEATH_MONSTER}@5,1`,
    `${DEATH_MONSTER}@5,2`,
    `${DEATH_MONSTER}@6,1`,
    `${DEATH_MONSTER}@7,1`,
    `${DEATH_MONSTER}@7,2`
  ].sort();

  it('is won by its stored solution, and no shorter win exists, drops allowed', { timeout: TEST_TIMEOUT_MS }, () => {
    const level = levelById(CORK_LEVEL);
    expect(level.solution?.length).toBe(21);
    expect(shortest(engineFor(level))).toBe(21);
  });

  it('shuts the bug in a one-cell dead end under a chip, with a plugged side pool two cells down the corridor', () => {
    const level = levelById(CORK_LEVEL);
    expect(level.entities.map((e) => `${e.type}@${e.x},${e.y}`)).toEqual(['bug@7,2']);
    expect(level.items[1][7]).toBe('chip');
    expect(itemCells(level, 'chip')).toEqual(['2,1', '3,1', CORK]);
    expect(level.terrain[2][7]).toBe('floor');
    expect(level.terrain[3][7]).toBe('socket');
    expect(level.terrain[4][7]).toBe('exit');
    expect(level.terrain[2][6]).toBe('wall');
    expect(level.terrain[2][8]).toBe('wall');
    expect(cellsOf(level, 'dirt')).toEqual([PLUG]);
    expect(cellsOf(level, 'water')).toEqual([POOL]);
    expect(cellsOf(level, 'hint')).toEqual(['1,1']);
    expect(level.chipsRequired).toBe(3);
  });

  it('cannot be won with the bug alive, with drops on or off, and the level is winnable', { timeout: TEST_TIMEOUT_MS }, () => {
    const level = levelById(CORK_LEVEL);
    expect(shortest(engineFor(level))).toBe(21);
    expect(() => assertNoWinWithCreatureAlive(level, { stateCap: SEARCH_STATE_CAP })).not.toThrow();
    const proof = creatureProof(level, { stateCap: SEARCH_STATE_CAP });
    expect(proof.withDrops).toBeNull();
    expect(proof.withoutDrops).toBeNull();
  });

  it('treads the plug in move 7, takes the chip that frees the bug in move 10, and the bug is drowned by move 17', () => {
    const level = levelById(CORK_LEVEL);
    let plugMove = 0;
    let corkMove = 0;
    let goneMove = 0;
    replayStored(level, (engine, move) => {
      if (plugMove === 0 && engine.getTerrain()[2][5] !== 'dirt') {
        plugMove = move;
        expect(engine.getItems()[1][7]).toBe('chip');
        expect(entityCells(engine)).toEqual(['bug@7,2']);
      }
      if (corkMove === 0 && engine.getItems()[1][7] === null) {
        corkMove = move;
        expect(engine.getTerrain()[2][5]).toBe('floor');
        expect(where(engine)).toBe(CORK);
      }
      if (goneMove === 0 && engine.getEntities().length === 0) {
        goneMove = move;
        expect(engine.getTerrain()[3][5]).toBe('water');
        expect(corkMove).toBeGreaterThan(plugMove);
      }
    });
    expect(plugMove).toBe(7);
    expect(corkMove).toBe(10);
    expect(goneMove).toBe(17);
  });

  it('keeps the bug on its cell while the chip lies on the map, then lets it out to the west, along the corridor and into the plug cell', { timeout: TEST_TIMEOUT_MS }, () => {
    const level = levelById(CORK_LEVEL);
    let corkedStates = 0;
    exploreStateGraph(engineFor(level), {
      stateCap: SEARCH_STATE_CAP,
      allowDrops: true,
      onState: (engine) => {
        if (engine.getItems()[1][7] !== 'chip') return;
        corkedStates++;
        expect(entityCells(engine)).toEqual(['bug@7,2']);
      }
    });
    expect(corkedStates).toBe(165);
  });

  it('is lost for good when the chip is taken before the plug is trodden: every such state is a dead end', { timeout: TEST_TIMEOUT_MS }, () => {
    const level = levelById(CORK_LEVEL);
    const corkTakenPlugShut = (engine: GameEngine): boolean => engine.getItems()[1][7] === null && engine.getTerrain()[2][5] === 'dirt';
    const wrong = searchShortestWinLean(engineFor(level), { allowDrops: true, goal: corkTakenPlugShut });
    // Five steps east, one wait to let the bug's step fall behind the player's, and onto the cork.
    expect(wrong?.actions.join(' ')).toBe('E E E E E WAIT E');
    const engine = engineAfterActions(level, wrong?.actions ?? []);
    expect(where(engine)).toBe(CORK);
    expect(searchCanWin(engine, { stateCap: SEARCH_STATE_CAP, allowDrops: true })).toBe(false);

    let wrongStates = 0;
    let wrongDead = 0;
    let rightOrderDead = 0;
    const rightOrderSpots: string[] = [];
    exploreStateGraph(engineFor(level), {
      stateCap: SEARCH_STATE_CAP,
      allowDrops: true,
      onState: (e) => {
        if (corkTakenPlugShut(e)) wrongStates++;
      },
      onDead: (e) => {
        if (corkTakenPlugShut(e)) {
          wrongDead++;
        } else {
          rightOrderDead++;
          rightOrderSpots.push(`${where(e)} ${entityCells(e).join('|')}`);
        }
      }
    });
    expect(wrongStates).toBe(47);
    expect(wrongDead).toBe(47);
    // The only other dead ends are the player standing on the plug cell when the bug is on the corridor cell beside it.
    expect(rightOrderDead).toBe(6);
    for (const spot of rightOrderSpots) expect(spot, spot).toMatch(/^5,2 bug@[56],1$/);
  });

  it('kills only by the bug along the corridor, on the plug and under the cork, and by the pool', { timeout: TEST_TIMEOUT_MS }, () => {
    const level = levelById(CORK_LEVEL);
    const scan = scanHazards(level, { allowDrops: true });
    expect(scan.states).toBe(326);
    expect(deathsOf(level)).toEqual(EXPECTED_DEATHS);
    const graph = exploreStateGraph(engineFor(level), { stateCap: SEARCH_STATE_CAP, allowDrops: true });
    expect(graph.states).toBe(326);
    expect(graph.canWin).toBe(273);
    expect(graph.dead).toBe(53);
  });

  it('opens with no known validator issue', () => {
    expect(validatorIssues(levelById(CORK_LEVEL))).toEqual([]);
  });
});
