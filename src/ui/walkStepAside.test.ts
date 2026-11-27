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

import { ConfigRegistry } from '../config/ConfigRegistry';
import { CclpEngine } from '../core/cclp/CclpEngine';
import { GameEngine } from '../core/GameEngine';
import { lynxLevel } from '../core/lynx/lynxTestMaps';
import { Pathfinder } from '../core/Pathfinder';
import type { PlayEngine } from '../core/PlayEngine';
import { CompiledLevel, EntityPlacement } from '../core/types';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { pathEngineOf, startWalkStep, WalkEngine } from './cclpAutoWalk';
import { startEpoxyWalkStep, WalkWait } from './epoxyAutoWalk';
import { applyTimedMove, collectDueMoves } from './replaySchedule';
import { TappedWalk, WalkWatch } from './tappedWalk';
import { WalkForecaster } from './walkForecast';
import { stepAsideCandidates, walkStepAsideLimit, WalkDetour } from './walkStepAside';

beforeAll(() => {
  loadTestConfigs();
});

const SILENT = { effect: (): void => undefined, step: (): void => undefined };
const WALK_TICKS = 300;
const BALL = 'pink_ball';
/**
 * Chip walks east to (6, 2); a ball rolls west along his row towards water at its west end. Stepping east and standing still
 * are both deadly; the alcove north of Chip is safe, and once the ball has drowned the way east is clear.
 */
const ALCOVE = ['#########', '###.#####', '#W.@...b#', '#########'];
const BALL_START = { x: 7, y: 2 };
const GOAL = { x: 6, y: 2 };
/** A clock that never moves: the time budget never runs out, whatever the load of the machine running the test. */
const STOPPED_CLOCK = (): number => 0;

function alcoveCclp(): CclpEngine {
  const engine = new CclpEngine(SILENT);
  engine.loadLevel({ ...lynxLevel(ALCOVE, { glyphs: { b: { entity: { type: BALL, dir: 'W' } } } }), rulesProfile: 'cclp' });
  return engine;
}

/** Tile ids of the test glyphs; any other glyph is floor. */
const GLYPH_TILES: Record<string, string> = {
  '#': 'wall',
  W: 'water',
  I: 'ice',
  B: 'button_green',
  T: 'trap',
  P: 'teleport',
  O: 'toggle_wall_open',
  E: 'exit',
  C: 'clone_machine'
};
/** Glyphs that put an item on a floor cell. */
const GLYPH_ITEMS: Record<string, string> = { c: 'chip', b: 'bomb' };

/** An Epoxy level on the config grid, from rows of glyphs; `@` is Chip's start. */
function epoxyLevel(rows: string[], entities: EntityPlacement[]): CompiledLevel {
  const { mapWidth, mapHeight } = ConfigRegistry.getGame().grid;
  const glyph = (x: number, y: number): string => rows[y]?.[x] ?? '#';
  const terrain = Array.from({ length: mapHeight }, (_, y) => Array.from({ length: mapWidth }, (_, x) => GLYPH_TILES[glyph(x, y)] ?? 'floor'));
  const items = Array.from({ length: mapHeight }, (_, y) => Array.from({ length: mapWidth }, (_, x) => GLYPH_ITEMS[glyph(x, y)] ?? null));
  const y = rows.findIndex((row) => row.includes('@'));
  return {
    id: 'walk_step_aside',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    playerStart: { x: rows[y].indexOf('@'), y, dir: 'E' },
    terrain,
    items,
    entities,
    trapLinks: [],
    cloneLinks: []
  };
}

function epoxyEngineOf(rows: string[], entities: EntityPlacement[] = []): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(epoxyLevel(rows, entities));
  return engine;
}

function alcoveEpoxy(): GameEngine {
  return epoxyEngineOf(
    ALCOVE.map((row) => row.replace('b', '.')),
    [{ type: BALL, ...BALL_START, dir: 'W' }]
  );
}

interface AsideOutcome {
  end: 'arrived' | 'died' | 'danger' | 'blocked';
  x: number;
  y: number;
  tick: number;
  asides: number;
  waits: number;
  moves: string;
}

interface WalkOptions {
  /** Steps aside the walk may take; 0 turns them off. */
  limit: number;
  /** A tapped walk may step aside; a hint walk never does. */
  tapped?: boolean;
  wait?: WalkWait;
  forecaster?: WalkForecaster;
}

/**
 * The page's walk, ticked as the page ticks it: the one TappedWalk, before and after each engine tick, with the monster
 * watch and the step aside. Nothing of the walk is reimplemented here.
 */
function walkOnPage(engine: PlayEngine, options: WalkOptions): AsideOutcome {
  const forecaster = options.forecaster ?? new WalkForecaster(STOPPED_CLOCK);
  let waits = 0;
  let asides = 0;
  const watch: WalkWatch = {
    judge: (e, plan) => {
      const verdict = forecaster.judge(e, plan);
      if (verdict === 'wait') waits++;
      return verdict;
    },
    stepAside: (e, candidates) => forecaster.stepAside(e, candidates)
  };
  const walk = new TappedWalk(watch, options.wait, new WalkDetour(options.limit));
  const view = pathEngineOf(engine);
  if (view === null) throw new Error('no path view');
  const path = Pathfinder.findPath(view, GOAL.x, GOAL.y);
  walk.begin(path.moves, path.points, options.tapped ?? true);
  forecaster.follow(engine);
  const outcome = (end: AsideOutcome['end']): AsideOutcome => {
    const p = engine.getPlayer();
    const moves = engine.getTimedMoveHistory().map((m) => `${m.tick}${m.dir}`).join(' ');
    return { end, x: p.x, y: p.y, tick: engine.getTick(), asides, waits, moves };
  };
  for (let t = 0; t < WALK_TICKS && walk.active; t++) {
    engine.holdPlayerDirections?.([]);
    const turn = walk.beforeTick(engine);
    if (turn.notice === 'aside') asides++;
    if (turn.cleared) return outcome(turn.notice === 'stop' ? 'danger' : 'blocked');
    engine.tick();
    (engine as GameEngine).flushPendingStepEnd?.();
    forecaster.follow(engine);
    const change = walk.afterTick(engine, turn);
    if (!engine.getPlayer().alive) return outcome('died');
    if (change.cleared) return outcome(change.notice === 'stop' ? 'danger' : 'blocked');
  }
  return outcome('arrived');
}

/** What the screen shows of a game: tick, Chip and every creature. */
function signature(engine: PlayEngine): string {
  const p = engine.getPlayer();
  const creatures = engine.getEntities().map((e) => `${e.type}@${e.x},${e.y}`).join(';');
  return `${engine.getTick()}|${p.x},${p.y}|${p.alive}|${p.moveCooldown}|${creatures}|${engine.getTimedMoveHistory().length}`;
}

/** The high score replay of the recorded moves on a fresh engine, up to `ticks`. */
function replay<E extends PlayEngine>(engine: E, level: CompiledLevel, ticks: number, moves: ReturnType<PlayEngine['getTimedMoveHistory']>): E {
  engine.loadLevel(level);
  let index = 0;
  while (engine.getTick() < ticks) {
    const { due, nextIndex } = collectDueMoves(moves, index, engine.getTick());
    for (const move of due) applyTimedMove(engine, move);
    index = nextIndex;
    engine.tick();
  }
  return engine;
}

describe('step aside candidates', () => {
  // Chip at (2, 2), planned step east; north floor, south ice, west a chip on the floor.
  const CROSS = ['#####', '##.##', '#c@.#', '##I##', '#####'];

  it('keeps plain ground only, never the planned step, an item or a sliding cell', () => {
    const engine = epoxyEngineOf(CROSS);
    expect(stepAsideCandidates(engine, 'E', { x: 3, y: 2 })).toEqual([{ dir: 'N', point: { x: 2, y: 1 } }]);
  });

  it('puts the cell closest to the goal first, N E S W on a tie', () => {
    const engine = epoxyEngineOf(['#####', '##.##', '#.@.#', '##.##', '#####']);
    expect(stepAsideCandidates(engine, 'E', { x: 0, y: 3 }).map((c) => c.dir)).toEqual(['S', 'W', 'N']);
    expect(stepAsideCandidates(engine, 'S', { x: 3, y: 2 }).map((c) => c.dir)).toEqual(['E', 'N', 'W']);
  });

  it('leaves out a cell a monster stands on', () => {
    const engine = epoxyEngineOf(['#####', '##.##', '#.@.#', '#####'], [{ type: BALL, x: 2, y: 1, dir: 'N' }]);
    expect(stepAsideCandidates(engine, 'E', { x: 3, y: 2 }).map((c) => c.dir)).toEqual(['W']);
  });

  // Chip at (2, 2), the cell north of him is the one under test; west and south are walls, east is the planned step.
  const NORTH = (glyph: string): string[] => ['#####', `##${glyph}##`, '##@.#', '#####'];

  it('takes a plain floor cell (the control of the classes below)', () => {
    expect(stepAsideCandidates(epoxyEngineOf(NORTH('.')), 'E', { x: 3, y: 2 }).map((c) => c.dir)).toEqual(['N']);
  });

  it.each([
    ['a button', 'B'],
    ['a trap', 'T'],
    ['a teleport', 'P'],
    ['a toggle floor', 'O'],
    ['the level exit', 'E'],
    ['a bomb', 'b']
  ])('never offers %s', (_name, glyph) => {
    expect(stepAsideCandidates(epoxyEngineOf(NORTH(glyph)), 'E', { x: 3, y: 2 })).toEqual([]);
  });
});

describe('the tapped walk on the page loop, CCLP engine', () => {
  it('without a step aside, the watch stops the walk on the spot', () => {
    expect(walkOnPage(alcoveCclp(), { limit: 0 })).toEqual({ end: 'danger', x: 3, y: 2, tick: 1, asides: 0, waits: 1, moves: '' });
  });

  it('steps into the alcove, lets the ball pass and walks on to the goal', () => {
    expect(walkOnPage(alcoveCclp(), { limit: 2 })).toEqual({ end: 'arrived', x: 6, y: 2, tick: 30, asides: 1, waits: 13, moves: '1N 17S 21E 25E 29E' });
  });

  it('records ordinary presses: the high score replay reaches the same game', () => {
    const engine = alcoveCclp();
    walkOnPage(engine, { limit: 2 });
    const again = replay(new CclpEngine(SILENT), engine.getLevel(), engine.getTick(), engine.getTimedMoveHistory());
    expect(signature(again)).toBe(signature(engine));
  });

  it('a block puzzle hint walk (not tapped) never steps aside, a monster or not', () => {
    expect(walkOnPage(alcoveCclp(), { limit: 2, tapped: false })).toEqual({ end: 'danger', x: 3, y: 2, tick: 1, asides: 0, waits: 1, moves: '' });
  });

  it('a step aside search leaves the game on screen unchanged', () => {
    const engine = alcoveCclp();
    const forecaster = new WalkForecaster(STOPPED_CLOCK);
    forecaster.follow(engine);
    const before = signature(engine);
    const view = pathEngineOf(engine);
    if (view === null) throw new Error('no path view');
    expect(forecaster.stepAside(engine, stepAsideCandidates(view, 'E', GOAL))).toEqual({ dir: 'N', point: { x: 3, y: 1 } });
    expect(signature(engine)).toBe(before);
  });

  it('a step aside press the engine refuses ends the walk as a danger, and a taken one is an aside', () => {
    const engine = alcoveEpoxy();
    const plan = { moves: ['E' as const], points: [{ x: 4, y: 2 }] };
    const aside = { dir: 'N' as const, point: { x: 3, y: 1 } };
    const refusing: WalkEngine = { isPaused: () => false, getPlayer: () => engine.getPlayer(), canChipTakeInput: () => true, attemptPlayerMove: () => false };
    const taking: WalkEngine = { ...refusing, attemptPlayerMove: () => true };
    expect(startWalkStep(plan, refusing, engine, () => 'stop', () => aside)).toEqual({ kind: 'danger' });
    expect(startWalkStep(plan, taking, engine, () => 'stop', () => aside)).toEqual({ kind: 'aside', dir: 'N', target: { x: 3, y: 1 } });
  });
});

describe('the tapped walk on the page loop, Epoxy engine', () => {
  it('without a step aside, the watch stops the walk on the spot', () => {
    expect(walkOnPage(alcoveEpoxy(), { limit: 0 })).toEqual({ end: 'danger', x: 4, y: 2, tick: 6, asides: 0, waits: 2, moves: '0E' });
  });

  it('steps back west, then into the alcove, lets the ball pass and walks on to the goal', () => {
    expect(walkOnPage(alcoveEpoxy(), { limit: 2 })).toEqual({ end: 'arrived', x: 6, y: 2, tick: 43, asides: 2, waits: 18, moves: '0E 6W 12N 30S 34E 38E 42E' });
  });

  it('stops for good once the walk has used its steps aside', () => {
    expect(walkOnPage(alcoveEpoxy(), { limit: 1 })).toMatchObject({ end: 'danger', x: 3, y: 2, asides: 1 });
  });

  it('a block puzzle hint walk (not tapped) never steps aside, a monster or not', () => {
    expect(walkOnPage(alcoveEpoxy(), { limit: 2, tapped: false })).toEqual({ end: 'danger', x: 4, y: 2, tick: 6, asides: 0, waits: 2, moves: '0E' });
  });

  it('records ordinary presses: the high score replay reaches the same game', () => {
    const engine = alcoveEpoxy();
    walkOnPage(engine, { limit: 2 });
    const again = replay(new GameEngine(), engine.getLevel(), engine.getTick(), engine.getTimedMoveHistory());
    expect(signature(again)).toBe(signature(engine));
  });

  it('a step aside press the engine refuses (a wall) ends the walk as a danger', () => {
    const engine = alcoveEpoxy();
    const plan = { moves: ['E' as const], points: [{ x: 4, y: 2 }] };
    // South of Chip is a wall: the engine refuses the press.
    expect(startEpoxyWalkStep(plan, engine, engine, () => 'stop', () => ({ dir: 'S', point: { x: 3, y: 3 } }))).toEqual({ kind: 'danger' });
  });
});

describe('the wait of a walk is counted once, steps aside included', () => {
  // The alcove walk waits 2 ticks, steps aside, waits 2, steps aside, waits 14 more, then goes: 18 ticks of waiting in all.
  it('a walk whose total waiting is within the limit gets there', () => {
    expect(walkOnPage(alcoveEpoxy(), { limit: 2, wait: new WalkWait(18) })).toMatchObject({ end: 'arrived', waits: 18 });
  });

  it('a step aside does not give the walk more time: past the limit in all, the walk ends', () => {
    // 14 waits come after the last step aside: counted from there alone they would fit in 17.
    const outcome = walkOnPage(alcoveEpoxy(), { limit: 2, wait: new WalkWait(17) });
    expect(outcome.end).toBe('danger');
    expect(outcome.waits).toBe(18);
  });
});

describe('WalkDetour', () => {
  it('only an armed walk may step aside, up to its limit', () => {
    const detour = new WalkDetour(2);
    expect(detour.allowed()).toBe(false);
    detour.arm(GOAL);
    expect(detour.allowed()).toBe(true);
    detour.stepped();
    detour.stepped();
    expect(detour.taken).toBe(2);
    expect(detour.allowed()).toBe(false);
  });

  it('a hint walk disarms it, and clear forgets the goal, the count and the pending plan', () => {
    const detour = new WalkDetour(2);
    detour.arm(GOAL);
    detour.stepped();
    detour.disarm();
    expect(detour.allowed()).toBe(false);
    expect(detour.pending).toBe(false);
    expect(detour.taken).toBe(0);
    detour.arm(GOAL);
    detour.stepped();
    expect(detour.pending).toBe(true);
    detour.clear();
    expect(detour.allowed()).toBe(false);
    expect(detour.pending).toBe(false);
    expect(detour.taken).toBe(0);
  });

  it('a new tapped walk starts its count again', () => {
    const detour = new WalkDetour(1);
    detour.arm(GOAL);
    detour.stepped();
    expect(detour.allowed()).toBe(false);
    detour.arm(GOAL);
    expect(detour.allowed()).toBe(true);
  });

  it('plans again to the goal once, then has nothing pending', () => {
    const engine = epoxyEngineOf(['#######', '#@....#', '#######']);
    const detour = new WalkDetour(1);
    detour.arm({ x: 4, y: 1 });
    detour.stepped();
    expect(detour.pending).toBe(true);
    expect(detour.resume(engine)).toEqual({ moves: ['E', 'E', 'E'], points: [{ x: 2, y: 1 }, { x: 3, y: 1 }, { x: 4, y: 1 }] });
    expect(detour.pending).toBe(false);
    expect(detour.resume(engine)).toBeNull();
  });

  it('goes around a monster that stays put (on a clone machine) when the level offers a way', () => {
    const engine = epoxyEngineOf(['#######', '#.....#', '#@.C..#', '#######'], [{ type: BALL, x: 3, y: 2, dir: 'E' }]);
    const detour = new WalkDetour(1);
    detour.arm({ x: 5, y: 2 });
    detour.stepped();
    const plan = detour.resume(engine);
    expect(plan).not.toBeNull();
    expect(plan?.points[plan.points.length - 1]).toEqual({ x: 5, y: 2 });
    expect(plan?.points.some((p) => p.x === 3 && p.y === 2)).toBe(false);
    // Straight through the monster would be 4 steps: the way round is longer.
    expect(plan?.moves.length).toBeGreaterThan(4);
  });

  it('plans through the monsters only when the level offers no other way', () => {
    const engine = epoxyEngineOf(['#######', '#@....#', '#######'], [{ type: BALL, x: 3, y: 1, dir: 'E' }]);
    expect(Pathfinder.findPath(engine, 5, 1).moves).toEqual([]);
    const detour = new WalkDetour(1);
    detour.arm({ x: 5, y: 1 });
    detour.stepped();
    expect(detour.resume(engine)?.moves).toEqual(['E', 'E', 'E', 'E']);
  });

  it('reads its limit from game.json timing, which is 2', () => {
    expect(ConfigRegistry.getGame().timing.walkStepAsideLimit).toBe(2);
    expect(walkStepAsideLimit()).toBe(2);
    const detour = new WalkDetour();
    detour.arm(GOAL);
    detour.stepped();
    expect(detour.allowed()).toBe(true);
    detour.stepped();
    expect(detour.allowed()).toBe(false);
  });
});

describe('TappedWalk', () => {
  const NEVER_ASIDE: WalkWatch = { judge: () => 'go', stepAside: () => null };

  it('a tapped walk arms the detour, a hint walk disarms it, clear forgets everything', () => {
    const walk = new TappedWalk(NEVER_ASIDE, new WalkWait(), new WalkDetour(2));
    walk.begin(['E'], [{ x: 2, y: 1 }], true);
    expect(walk.detour.allowed()).toBe(true);
    walk.begin(['E'], [{ x: 2, y: 1 }], false);
    expect(walk.detour.allowed()).toBe(false);
    walk.begin(['E'], [{ x: 2, y: 1 }], true);
    walk.detour.stepped();
    walk.clear();
    expect(walk.active).toBe(false);
    expect(walk.detour.allowed()).toBe(false);
    expect(walk.detour.pending).toBe(false);
    expect(walk.detour.taken).toBe(0);
  });

  it('a new walk waits from zero', () => {
    const wait = new WalkWait(5);
    const walk = new TappedWalk(NEVER_ASIDE, wait, new WalkDetour(2));
    wait.hold();
    expect(wait.ticks).toBe(1);
    walk.begin(['E'], [{ x: 2, y: 1 }], true);
    expect(wait.ticks).toBe(0);
  });
});

describe('the time budget of a step aside', () => {
  /** The alcove walk after the watch stopped it at tick 6: Chip stands at (4, 2), the ball is close. */
  function stoppedEpoxy(): GameEngine {
    const engine = alcoveEpoxy();
    expect(walkOnPage(engine, { limit: 0 }).end).toBe('danger');
    return engine;
  }

  it('finds the step back west on a clock that does not move', () => {
    const engine = stoppedEpoxy();
    const forecaster = new WalkForecaster(STOPPED_CLOCK);
    expect(forecaster.stepAside(engine, stepAsideCandidates(engine, 'E', GOAL))).toEqual({ dir: 'W', point: { x: 3, y: 2 } });
    expect(forecaster.stats()).toMatchObject({ asideSearches: 1, asideTimeouts: 0 });
  });

  it('gives no step aside when the search runs out of its budget (a clock that advances past it)', () => {
    const engine = stoppedEpoxy();
    const budget = ConfigRegistry.getGame().timing.walkForecastBudgetMs ?? 0;
    expect(budget).toBe(15);
    let now = 0;
    const forecaster = new WalkForecaster(() => (now += budget + 1));
    expect(forecaster.stepAside(engine, stepAsideCandidates(engine, 'E', GOAL))).toBeNull();
    expect(forecaster.stats()).toMatchObject({ asideSearches: 1, asideTimeouts: 1 });
  });

  it('spends what the judge left of the one budget of the decision', () => {
    const engine = stoppedEpoxy();
    const candidates = stepAsideCandidates(engine, 'E', GOAL);
    let now = 0;
    const forecaster = new WalkForecaster(() => now);
    // The judge began at 0; the clock reads 100 when the step aside begins: the budget of the decision is spent.
    forecaster.judge(engine, { moves: ['E'], points: [{ x: 5, y: 2 }] });
    now = 100;
    expect(forecaster.stepAside(engine, candidates)).toBeNull();
    expect(forecaster.stats().asideTimeouts).toBe(1);
    // The same search with its own start has the whole budget.
    expect(forecaster.stepAside(engine, candidates, 100)).toEqual({ dir: 'W', point: { x: 3, y: 2 } });
    // And an explicit start in the past is spent too.
    expect(forecaster.stepAside(engine, candidates, 0)).toBeNull();
  });

  it('finds none when no candidate is given, or when the press of the only one is refused', () => {
    const engine = alcoveEpoxy();
    const forecaster = new WalkForecaster(STOPPED_CLOCK);
    expect(forecaster.stepAside(engine, [])).toBeNull();
    // South of Chip is a wall: the press is refused, so the step is not taken.
    expect(forecaster.stepAside(engine, [{ dir: 'S', point: { x: 3, y: 3 } }])).toBeNull();
  });
});
