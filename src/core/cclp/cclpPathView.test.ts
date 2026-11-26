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

vi.mock('../../audio/AudioManager', () => ({
  AudioManager: { playSfx: vi.fn() }
}));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { applyTimedMove, collectDueMoves } from '../../ui/replaySchedule';
import { lynxLevel } from '../lynx/lynxTestMaps';
import { Pathfinder } from '../Pathfinder';
import { featuresFor } from '../RulesetFeatures';
import { CompiledLevel, Direction, GridPoint } from '../types';
import { endWalkStep, startWalkStep } from '../../ui/cclpAutoWalk';
import { CclpEngine } from './CclpEngine';
import { cclpPathView } from './cclpPathView';

beforeAll(() => {
  loadTestConfigs();
});

const SILENT = { effect: () => undefined, step: () => undefined };
/** Chip at (1,1); the only way to the chip at (7,1) goes down and around two wall stubs. */
const DETOUR = ['#########', '#@..#..i#', '#.#.#.#.#', '#.#...#.#', '#########'];
const DETOUR_MOVES: Direction[] = ['E', 'E', 'S', 'S', 'E', 'E', 'N', 'N', 'E', 'E'];
/** Chip at (1,1) facing a block at (2,1) that a wall at (3,1) holds. */
const STUCK_BLOCK = ['#####', '#@B##', '#...#', '#####'];
const WALK_TICKS = 400;

function cclpLevel(rows: string[]): CompiledLevel {
  return { ...lynxLevel(rows), rulesProfile: 'cclp' };
}

/** The page's per-tick walk on the CCLP engine, through the helper main.ts calls. */
function walk(engine: CclpEngine, moves: Direction[], points: GridPoint[]): { arrived: boolean; steps: number } {
  const queue = [...moves];
  const pts = [...points];
  const view = cclpPathView(engine);
  for (let t = 0; t < WALK_TICKS && queue.length > 0; t++) {
    engine.holdPlayerDirections([]);
    const start = startWalkStep({ moves: queue, points: pts }, engine, view);
    if (start.kind === 'stop') break;
    engine.tick();
    const end = endWalkStep(engine, start);
    if (end === 'advanced') {
      queue.shift();
      pts.shift();
    } else if (end === 'stopped') {
      break;
    }
  }
  return { arrived: queue.length === 0, steps: moves.length - queue.length };
}

/** The whole Lynx world of the engine (terrain, items, slots, random state, module data, tick, Chip), as the engine holds it. */
function worldOf(engine: CclpEngine): unknown {
  return (engine as unknown as { sim: { world: unknown } }).sim.world;
}

const FAKE_WALL_GLYPHS = { f: 'blue_wall_fake' };
/** A fake blue wall stands in the straight way to the chip at (3,1); the row below is free. */
const FAKE_WALL_AROUND = ['#####', '#@fi#', '#...#', '#####'];
/** The same wall is the only way. */
const FAKE_WALL_ONLY_WAY = ['#####', '#@fi#', '#####'];

describe('CCLP aids, batch 1', () => {
  it('offers the tapped path and the objective marker on a CCLP level, nothing else', () => {
    const f = featuresFor({ ruleset: 'lynx', rulesProfile: 'cclp' });
    expect(f).toEqual({
      tapToPath: true,
      objectiveMarker: true,
      blockHint: false,
      deadEndWatch: false,
      solutionReplay: false,
      itemDrop: false,
      highScoreReplay: true,
      turnInPlace: false
    });
    expect(featuresFor({ ruleset: 'lynx' }).tapToPath).toBe(false);
    expect(featuresFor({ ruleset: 'lynx' }).objectiveMarker).toBe(false);
  });

  it('points to the chip and plans the detour through the view', () => {
    const engine = new CclpEngine(SILENT);
    engine.loadLevel(cclpLevel(DETOUR));
    const view = cclpPathView(engine);
    expect(Pathfinder.findNextObjective(view)).toEqual({ x: 7, y: 1 });
    expect(Pathfinder.findPath(view, 7, 1).moves).toEqual(DETOUR_MOVES);
  });

  it('reads without touching the simulation', () => {
    const engine = new CclpEngine(SILENT);
    engine.loadLevel(cclpLevel(DETOUR));
    const view = cclpPathView(engine);
    const before = structuredClone(worldOf(engine));
    Pathfinder.findNextObjective(view);
    Pathfinder.findPath(view, 7, 1);
    Pathfinder.isNextStepSafe(view, 'E', false);
    expect(structuredClone(worldOf(engine))).toEqual(before);
    expect(engine.getTick()).toBe(0);
    expect(engine.getTimedMoveHistory()).toEqual([]);
    expect(engine.getPlayer()).toMatchObject({ x: 1, y: 1, moveCooldown: 0 });
  });

  it('walks the path as ordinary presses, and the high score replay plays them back to the same state', () => {
    const level = cclpLevel(DETOUR);
    const engine = new CclpEngine(SILENT);
    engine.loadLevel(level);
    const chipsBefore = engine.getChipsRemaining();
    const path = Pathfinder.findPath(cclpPathView(engine), 7, 1);
    expect(walk(engine, path.moves, path.points)).toEqual({ arrived: true, steps: 10 });
    expect(engine.getPlayer()).toMatchObject({ x: 7, y: 1 });
    expect(engine.getChipsRemaining()).toBe(Math.max(0, chipsBefore - 1));
    const moves = engine.getTimedMoveHistory();
    expect(moves.map((m) => m.dir)).toEqual(DETOUR_MOVES);

    const again = new CclpEngine(SILENT);
    again.loadLevel(level);
    let index = 0;
    while (again.getTick() < engine.getTick()) {
      again.holdPlayerDirections([]);
      const { due, nextIndex } = collectDueMoves(moves, index, again.getTick());
      for (const move of due) applyTimedMove(again, move);
      index = nextIndex;
      again.tick();
    }
    expect(again.getPlayer()).toEqual(engine.getPlayer());
    expect(again.getTimedMoveHistory()).toEqual(moves);
  });

  it('stops the walk when Lynx refuses the step instead of running the rest of the path from the wrong cell', () => {
    const engine = new CclpEngine(SILENT);
    engine.loadLevel(cclpLevel(STUCK_BLOCK));
    const path = Pathfinder.findPath(cclpPathView(engine), 2, 1);
    expect(path.moves).toEqual(['E']);
    expect(walk(engine, [...path.moves, 'S'], [...path.points, { x: 2, y: 2 }])).toEqual({ arrived: false, steps: 0 });
    expect(engine.getPlayer()).toMatchObject({ x: 1, y: 1 });
  });

  it('leaves the world untouched when the path and the objective are read on a board with stepped-on state', () => {
    const engine = new CclpEngine(SILENT);
    engine.loadLevel(cclpLevel(DETOUR));
    for (let t = 0; t < 3; t++) {
      engine.holdPlayerDirections(['E']);
      engine.tick();
    }
    const before = structuredClone(worldOf(engine));
    const view = cclpPathView(engine);
    Pathfinder.findNextObjective(view);
    Pathfinder.findPath(view, 7, 1);
    Pathfinder.isNextStepSafe(view, 'E', true);
    expect(engine.canChipTakeInput()).toBeTypeOf('boolean');
    expect(structuredClone(worldOf(engine))).toEqual(before);
  });

  it('plans around a fake blue wall, which looks like any wall to the player', () => {
    const engine = new CclpEngine(SILENT);
    engine.loadLevel({ ...lynxLevel(FAKE_WALL_AROUND, { glyphs: FAKE_WALL_GLYPHS }), rulesProfile: 'cclp' });
    const view = cclpPathView(engine);
    expect(Pathfinder.findPath(view, 3, 1).moves).toEqual(['S', 'E', 'E', 'N']);
    expect(Pathfinder.findNextObjective(view)).toEqual({ x: 3, y: 1 });
  });

  it.each(['blue_wall_fake', 'blue_wall_real', 'invisible_wall', 'appearing_wall'])(
    'reports no path and no objective when only a %s leads to the chip',
    (wall) => {
      const engine = new CclpEngine(SILENT);
      engine.loadLevel({ ...lynxLevel(FAKE_WALL_ONLY_WAY, { glyphs: { f: wall } }), rulesProfile: 'cclp' });
      const view = cclpPathView(engine);
      expect(Pathfinder.findPath(view, 3, 1)).toEqual({ moves: [], points: [] });
      expect(Pathfinder.findNextObjective(view)).toBeNull();
    }
  );
});
