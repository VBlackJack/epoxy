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

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../audio/AudioManager', () => import('../test/silentAudio'));

import { ConfigRegistry } from '../config/ConfigRegistry';
import { CclpEngine } from '../core/cclp/CclpEngine';
import { cclpPathView } from '../core/cclp/cclpPathView';
import { GameEngine } from '../core/GameEngine';
import { LynxEngine } from '../core/lynx/LynxEngine';
import { lynxLevel } from '../core/lynx/lynxTestMaps';
import { Pathfinder } from '../core/Pathfinder';
import type { PlayEngine } from '../core/PlayEngine';
import { CompiledLevel, Direction, EntityPlacement } from '../core/types';
import { room } from '../test/cc2Room';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { endWalkStep, startWalkStep, WalkPlan } from './cclpAutoWalk';
import { startEpoxyWalkStep } from './epoxyAutoWalk';
import { applyTimedMove, collectDueMoves } from './replaySchedule';
import { WalkForecaster } from './walkForecast';
import { CclpSandbox, EpoxySandbox } from './walkSandbox';

beforeAll(() => {
  loadTestConfigs();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const SILENT = { effect: (): void => undefined, step: (): void => undefined };
const WALK_TICKS = 300;
const BALL = 'pink_ball';
/** Chip walks east along row 2 to (7, 2); a ball bounces up and down column 4 and crosses his path. */
const CROSSING = ['#########', '####.####', '#@......#', '####.####', '####.####', '#########'];
const BALL_START = { x: 4, y: 4 };
const GOAL = { x: 7, y: 2 };
/** A dead end: the ball rolls west at Chip, nothing he does saves him. */
const DEAD_END = ['#######', '#@...b#', '#######'];
/** No monster at all: a forecast on it always ends alive. */
const EMPTY_ROW = ['#########', '#@......#', '#########'];
/** One step from the exit: a forecast that plays the step wins the level. */
const NEAR_EXIT = ['#####', '#@.X#', '#####'];
const IDLE_SHORT = 200;
const IDLE_LONG = 2000;
/** A clock that never moves: the time budget never runs out, whatever the load of the machine running the test. */
const STOPPED_CLOCK = (): number => 0;

function cclpEngine(rows: string[], glyphs: Record<string, { entity: { type: string; dir: Direction } }> = {}): CclpEngine {
  const engine = new CclpEngine(SILENT);
  engine.loadLevel({ ...lynxLevel(rows, { glyphs }), rulesProfile: 'cclp' });
  return engine;
}

function crossingCclp(): CclpEngine {
  const rows = CROSSING.map((row, y) => (y === BALL_START.y ? `${row.slice(0, BALL_START.x)}b${row.slice(BALL_START.x + 1)}` : row));
  return cclpEngine(rows, { b: { entity: { type: BALL, dir: 'N' } } });
}

function epoxyLevel(rows: string[], entities: EntityPlacement[]): CompiledLevel {
  const { mapWidth, mapHeight } = ConfigRegistry.getGame().grid;
  const terrain = Array.from({ length: mapHeight }, (_, y) =>
    Array.from({ length: mapWidth }, (_, x) => ((rows[y]?.[x] ?? '#') === '#' ? 'wall' : 'floor'))
  );
  const y = rows.findIndex((row) => row.includes('@'));
  return {
    id: 'walk_forecast',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    playerStart: { x: rows[y].indexOf('@'), y, dir: 'E' },
    terrain,
    items: terrain.map((row) => row.map(() => null)),
    entities,
    trapLinks: [],
    cloneLinks: []
  };
}

function crossingEpoxy(): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(epoxyLevel(CROSSING, [{ type: BALL, ...BALL_START, dir: 'N' }]));
  return engine;
}

interface WalkOutcome {
  end: 'arrived' | 'died' | 'danger' | 'stopped';
  x: number;
  y: number;
  tick: number;
  waits: number;
  moves: string;
}

function outcome(engine: PlayEngine, end: WalkOutcome['end'], waits: number): WalkOutcome {
  const p = engine.getPlayer();
  const moves = engine.getTimedMoveHistory().map((m) => `${m.tick}${m.dir}`).join(' ');
  return { end, x: p.x, y: p.y, tick: engine.getTick(), waits, moves };
}

/** The page's CCLP walk (startWalkStep / endWalkStep, the copy followed after each tick), with or without the monster watch. */
function walkCclp(engine: CclpEngine, watch: boolean, forecaster = new WalkForecaster(STOPPED_CLOCK)): WalkOutcome {
  const view = cclpPathView(engine);
  const plan = Pathfinder.findPath(view, GOAL.x, GOAL.y);
  let waits = 0;
  forecaster.follow(engine);
  for (let t = 0; t < WALK_TICKS && plan.moves.length > 0; t++) {
    engine.holdPlayerDirections([]);
    const start = startWalkStep(plan, engine, view, watch ? (p) => forecaster.judge(engine, p) : undefined);
    if (start.kind === 'danger') return outcome(engine, 'danger', waits);
    if (start.kind === 'wait') waits++;
    engine.tick();
    forecaster.follow(engine);
    if (endWalkStep(engine, start) === 'advanced') {
      plan.moves.shift();
      plan.points.shift();
    }
    if (!engine.getPlayer().alive) return outcome(engine, 'died', waits);
  }
  return outcome(engine, 'arrived', waits);
}

/** The page's Epoxy walk (startEpoxyWalkStep, then the turn of the tick for a stored step), with or without the watch. */
function walkEpoxy(engine: GameEngine, watch: boolean, goal = GOAL, forecaster = new WalkForecaster(STOPPED_CLOCK)): WalkOutcome {
  const plan = Pathfinder.findPath(engine, goal.x, goal.y);
  let waits = 0;
  for (let t = 0; t < WALK_TICKS && plan.moves.length > 0; t++) {
    const start = startEpoxyWalkStep(plan, engine, engine, watch ? (p) => forecaster.judge(engine, p) : undefined);
    if (start.kind === 'danger') return outcome(engine, 'danger', waits);
    if (start.kind === 'stop') return outcome(engine, 'stopped', waits);
    if (start.kind === 'wait') waits++;
    if (start.kind === 'sent' && !start.stored) {
      plan.moves.shift();
      plan.points.shift();
    }
    engine.tick();
    if (start.kind === 'sent' && start.stored) {
      if (engine.getLastPlayerTurn()?.moved === true) {
        plan.moves.shift();
        plan.points.shift();
      } else if (!engine.getPlayer().isSliding && engine.getPlayer().moveCooldown === 0) {
        plan.moves.length = 0;
      }
    }
    engine.flushPendingStepEnd();
    if (!engine.getPlayer().alive) return outcome(engine, 'died', waits);
  }
  return outcome(engine, 'arrived', waits);
}

/** What the screen shows of a game: tick, Chip and every creature. */
function signature(engine: PlayEngine): string {
  const p = engine.getPlayer();
  const creatures = engine.getEntities().map((e) => `${e.type}@${e.x},${e.y}`).join(';');
  return `${engine.getTick()}|${p.x},${p.y}|${p.alive}|${p.moveCooldown}|${creatures}|${engine.getTimedMoveHistory().length}`;
}

/** Every view of a game that the walk or the screen reads. */
function fullView(engine: PlayEngine): string {
  const p = engine.getPlayer();
  return JSON.stringify({
    tick: engine.getTick(),
    player: { ...p, boots: [...p.boots].sort() },
    chips: engine.getChipsRemaining(),
    terrain: engine.getTerrain(),
    items: engine.getItems(),
    entities: engine.getEntities(),
    moves: engine.getTimedMoveHistory(),
    completed: engine.isLevelCompleted()
  });
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

describe('WalkForecaster on the CCLP engine', () => {
  it('without the watch, the walk runs into the ball', () => {
    expect(walkCclp(crossingCclp(), false)).toEqual({ end: 'died', x: 3, y: 2, tick: 9, waits: 0, moves: '0E 4E 8E' });
  });

  it('with the watch, Chip waits for the ball to pass and arrives, the copy built once and never wrong', () => {
    const forecaster = new WalkForecaster(STOPPED_CLOCK);
    expect(walkCclp(crossingCclp(), true, forecaster)).toEqual({
      end: 'arrived',
      x: 7,
      y: 2,
      tick: 30,
      waits: 9,
      moves: '0E 4E 17E 21E 25E 29E'
    });
    expect(forecaster.stats()).toMatchObject({ rebuilds: 1, mismatches: 0, timeouts: 0 });
  });

  it('the watched walk replays to the same end on a fresh engine', () => {
    const engine = crossingCclp();
    walkCclp(engine, true);
    const again = replay(new CclpEngine(SILENT), engine.getLevel(), engine.getTick(), engine.getTimedMoveHistory());
    expect(signature(again)).toBe(signature(engine));
  });

  it('says stop when standing still is deadly too, without a press and without a rebuild', () => {
    const engine = cclpEngine(DEAD_END, { b: { entity: { type: BALL, dir: 'W' } } });
    const view = cclpPathView(engine);
    const plan = Pathfinder.findPath(view, 3, 1);
    const forecaster = new WalkForecaster(STOPPED_CLOCK);
    const judge = (p: WalkPlan): ReturnType<WalkForecaster['judge']> => forecaster.judge(engine, p);
    forecaster.follow(engine);
    expect(startWalkStep(plan, engine, view, judge)).toEqual({ kind: 'wait' });
    engine.tick();
    forecaster.follow(engine);
    expect(startWalkStep(plan, engine, view, judge)).toEqual({ kind: 'danger' });
    expect(engine.getPlayer()).toMatchObject({ x: 1, y: 1, alive: true });
    expect(engine.getTimedMoveHistory()).toEqual([]);
    expect(forecaster.stats()).toMatchObject({ rebuilds: 1, mismatches: 0 });
  });

  it('a forecast leaves the game on screen as it was', () => {
    const engine = crossingCclp();
    const forecaster = new WalkForecaster(STOPPED_CLOCK);
    forecaster.follow(engine);
    for (let t = 0; t < 5; t++) {
      engine.tick();
      forecaster.follow(engine);
    }
    const before = fullView(engine);
    forecaster.judge(engine, Pathfinder.findPath(cclpPathView(engine), GOAL.x, GOAL.y));
    expect(fullView(engine)).toBe(before);
  });

  it('the copy equals the game on screen in every view, tick after tick, through a walk with presses', () => {
    const live = crossingCclp();
    const sandbox = new CclpSandbox(live);
    sandbox.follow();
    const route: Direction[] = ['E', 'E', 'E', 'E', 'E'];
    let next = 0;
    for (let t = 0; t < 60; t++) {
      if (next < route.length && live.canChipTakeInput() && live.attemptPlayerMove(route[next])) next++;
      live.tick();
      sandbox.follow();
      expect(fullView(sandbox.copy)).toBe(fullView(live));
      expect(sandbox.matchesLive()).toBe(true);
    }
    expect(sandbox.rebuilds).toBe(1);
    expect(sandbox.mismatches).toBe(0);
  });

  it('a forecast on the copy is taken back exactly, a stay forecast included, and the copy goes on matching', () => {
    const live = crossingCclp();
    const sandbox = new CclpSandbox(live);
    sandbox.follow();
    for (let t = 0; t < 12; t++) {
      live.tick();
      sandbox.follow();
    }
    for (const press of [true, false]) {
      const before = fullView(sandbox.copy);
      const fork = sandbox.open();
      expect(fork).not.toBeNull();
      if (press) expect(fork?.attemptPlayerMove('E')).toBe(true);
      for (let t = 0; t < 30; t++) fork?.tick();
      expect(fullView(sandbox.copy)).not.toBe(before);
      sandbox.close();
      expect(fullView(sandbox.copy)).toBe(before);
    }
    for (let t = 0; t < 20; t++) {
      live.tick();
      sandbox.follow();
      expect(fullView(sandbox.copy)).toBe(fullView(live));
    }
    expect(sandbox.rebuilds).toBe(1);
    expect(sandbox.mismatches).toBe(0);
  });

  it.each([IDLE_SHORT, IDLE_LONG])('after %i idle ticks a decision plays the same few ticks, not the history', (idle) => {
    const engine = cclpEngine(EMPTY_ROW);
    const forecaster = new WalkForecaster(STOPPED_CLOCK);
    forecaster.follow(engine);
    for (let t = 0; t < idle; t++) {
      engine.tick();
      forecaster.follow(engine);
    }
    const spy = vi.spyOn(CclpEngine.prototype, 'tick');
    const verdict = forecaster.judge(engine, Pathfinder.findPath(cclpPathView(engine), 7, 1));
    expect(verdict).toBe('go');
    expect(spy.mock.calls.length).toBe(9);
    expect(forecaster.stats()).toMatchObject({ rebuilds: 1, mismatches: 0 });
  });

  it('an undo of the game on screen rebuilds the copy, which then matches it again', () => {
    const engine = crossingCclp();
    const forecaster = new WalkForecaster(STOPPED_CLOCK);
    walkCclp(engine, true, forecaster);
    expect(engine.undo()).toBe(true);
    forecaster.reset();
    const plan = Pathfinder.findPath(cclpPathView(engine), GOAL.x, GOAL.y);
    expect(forecaster.judge(engine, plan)).toBe(new WalkForecaster(STOPPED_CLOCK).judge(engine, plan));
    expect(forecaster.stats()).toMatchObject({ rebuilds: 2, mismatches: 0 });
  });

  it('an undo nobody told the copy about is caught, the copy being ahead of the game', () => {
    const engine = crossingCclp();
    const forecaster = new WalkForecaster(STOPPED_CLOCK);
    walkCclp(engine, true, forecaster);
    expect(engine.undo()).toBe(true);
    const plan = Pathfinder.findPath(cclpPathView(engine), GOAL.x, GOAL.y);
    expect(forecaster.judge(engine, plan)).toBe(new WalkForecaster(STOPPED_CLOCK).judge(engine, plan));
    expect(forecaster.stats().rebuilds).toBe(2);
  });

  it('a restart rebuilds the copy from the level start', () => {
    const engine = crossingCclp();
    const forecaster = new WalkForecaster(STOPPED_CLOCK);
    walkCclp(engine, true, forecaster);
    engine.loadLevel(engine.getLevel());
    forecaster.reset();
    forecaster.follow(engine);
    expect(forecaster.stats().rebuilds).toBe(2);
    expect(walkCclp(engine, true, forecaster)).toMatchObject({ end: 'arrived', x: 7, y: 2, tick: 30 });
    expect(forecaster.stats()).toMatchObject({ rebuilds: 2, mismatches: 0 });
  });

  it('a forecast that wins the level answers go and leaves the copy where it was', () => {
    const engine = cclpEngine(NEAR_EXIT);
    const forecaster = new WalkForecaster(STOPPED_CLOCK);
    forecaster.follow(engine);
    const plan = Pathfinder.findPath(cclpPathView(engine), 3, 1);
    expect(forecaster.judge(engine, plan)).toBe('go');
    expect(engine.isLevelCompleted()).toBe(false);
    engine.tick();
    forecaster.follow(engine);
    expect(forecaster.judge(engine, plan)).toBe('go');
    expect(forecaster.stats()).toMatchObject({ rebuilds: 1, mismatches: 0 });
  });

  it('a copy that cannot be made to match answers go, as the walk did without the watch', () => {
    const engine = cclpEngine(DEAD_END, { b: { entity: { type: BALL, dir: 'W' } } });
    const forecaster = new WalkForecaster(STOPPED_CLOCK);
    const plan = Pathfinder.findPath(cclpPathView(engine), 3, 1);
    expect(forecaster.judge(engine, plan)).toBe('wait');
    // The game on screen takes a step the history no longer shows: no replay of the history can match it.
    expect(engine.attemptPlayerMove('E')).toBe(true);
    engine.tick();
    vi.spyOn(engine, 'getTimedMoveHistory').mockReturnValue([]);
    forecaster.follow(engine);
    expect(forecaster.judge(engine, plan)).toBe('go');
    expect(forecaster.stats().mismatches).toBe(1);
  });

  it('after an undo late in a long level, the copy catches up at most the cap per call and gives no answer until then', () => {
    const live = cclpEngine(EMPTY_ROW);
    const sandbox = new CclpSandbox(live);
    sandbox.follow();
    const LATE = 400;
    for (let t = 0; t < LATE; t++) {
      live.tick();
      sandbox.follow();
    }
    const cap = ConfigRegistry.getGame().timing.walkCatchUpTicks ?? 0;
    expect(cap).toBe(40);
    sandbox.reset();
    expect(sandbox.caughtUp()).toBe(false);
    expect(sandbox.open()).toBeNull();
    sandbox.reset();
    let calls = 0;
    while (!sandbox.caughtUp()) {
      const before = sandbox.copy.getTick();
      sandbox.follow();
      calls++;
      expect(sandbox.copy.getTick() - before).toBeLessThanOrEqual(cap);
      expect(calls).toBeLessThan(100);
    }
    expect(calls).toBe(LATE / cap);
    expect(sandbox.open()).not.toBeNull();
    sandbox.close();
    expect(sandbox.matchesLive()).toBe(true);
  });

  it('a single follow call plays no more than the cap after a reset at a high tick', () => {
    const live = cclpEngine(EMPTY_ROW);
    const sandbox = new CclpSandbox(live);
    sandbox.follow();
    for (let t = 0; t < 300; t++) {
      live.tick();
      sandbox.follow();
    }
    sandbox.reset();
    const spy = vi.spyOn(CclpEngine.prototype, 'tick');
    sandbox.follow();
    expect(spy.mock.calls.length).toBeLessThanOrEqual(40);
  });

  it('a copy that still differs after its one rebuild is left alone until the next reset', () => {
    const live = cclpEngine(DEAD_END, { b: { entity: { type: BALL, dir: 'W' } } });
    const sandbox = new CclpSandbox(live);
    sandbox.follow();
    expect(live.attemptPlayerMove('E')).toBe(true);
    live.tick();
    vi.spyOn(live, 'getTimedMoveHistory').mockReturnValue([]);
    sandbox.follow();
    expect(sandbox.open()).toBeNull();
    expect(sandbox.open()).toBeNull();
    expect(sandbox.open()).toBeNull();
    expect(sandbox.mismatches).toBe(1);
    expect(sandbox.rebuilds).toBe(2);
  });

  it('hand play (held key, two-key hold, two-key press) keeps the copy equal to the game on screen every tick', () => {
    const live = cclpEngine(['########', '#@.....#', '#......#', '#......#', '#......#', '########']);
    const sandbox = new CclpSandbox(live);
    sandbox.follow();
    const script: { keys: Direction[]; press?: Direction[] }[] = [
      ...Array.from({ length: 10 }, () => ({ keys: ['E' as Direction] })),
      ...Array.from({ length: 10 }, () => ({ keys: ['S' as Direction, 'E' as Direction] })),
      { keys: [], press: ['E', 'S'] },
      ...Array.from({ length: 8 }, () => ({ keys: [] as Direction[] })),
      ...Array.from({ length: 10 }, () => ({ keys: ['W' as Direction, 'N' as Direction] }))
    ];
    for (const step of script) {
      live.holdPlayerDirections(step.keys);
      if (step.press) live.attemptPlayerMoveHeld(step.press);
      live.tick();
      sandbox.follow();
      expect(sandbox.matchesLive()).toBe(true);
    }
    expect(live.getTimedMoveHistory().some((m) => m.alt !== undefined)).toBe(true);
    expect(fullView(sandbox.copy)).toBe(fullView(live));
    expect(sandbox.mismatches).toBe(0);
    expect(sandbox.rebuilds).toBe(1);
  });

  it('a decision that runs out of its time budget answers go', () => {
    const budget = ConfigRegistry.getGame().timing.walkForecastBudgetMs ?? 0;
    expect(budget).toBe(15);
    const engine = cclpEngine(DEAD_END, { b: { entity: { type: BALL, dir: 'W' } } });
    const plan = Pathfinder.findPath(cclpPathView(engine), 3, 1);
    let now = 0;
    const slow = new WalkForecaster(() => (now += budget + 1));
    expect(slow.judge(engine, plan)).toBe('go');
    expect(slow.stats()).toMatchObject({ timeouts: 1, decisions: 1 });
    const fast = new WalkForecaster(() => 0);
    expect(fast.judge(engine, plan)).toBe('wait');
    expect(fast.stats()).toMatchObject({ timeouts: 0, decisions: 1 });
  });
});

describe('WalkForecaster on the Epoxy engine', () => {
  it('without the watch, the walk runs into the ball', () => {
    expect(walkEpoxy(crossingEpoxy(), false)).toEqual({ end: 'died', x: 4, y: 2, tick: 12, waits: 0, moves: '0E 4E 8E' });
  });

  it('with the watch, Chip waits for the ball to pass and arrives', () => {
    expect(walkEpoxy(crossingEpoxy(), true)).toEqual({ end: 'arrived', x: 7, y: 2, tick: 31, waits: 10, moves: '0E 4E 18E 22E 26E 30E' });
  });

  it('the watched walk replays to the same end on a fresh engine', () => {
    const engine = crossingEpoxy();
    walkEpoxy(engine, true);
    const again = replay(new GameEngine(), engine.getLevel(), engine.getTick(), engine.getTimedMoveHistory());
    expect(signature(again)).toBe(signature(engine));
    expect(JSON.stringify(again.captureState())).toBe(JSON.stringify(engine.captureState()));
  });

  it('a forecast leaves the game on screen as it was', () => {
    const engine = crossingEpoxy();
    for (let t = 0; t < 5; t++) engine.tick();
    const before = JSON.stringify(engine.captureState());
    new WalkForecaster(STOPPED_CLOCK).judge(engine, Pathfinder.findPath(engine, GOAL.x, GOAL.y));
    expect(JSON.stringify(engine.captureState())).toBe(before);
  });

  it('the copy holds the captured state of the game on screen, whole, each time it is opened', () => {
    const live = crossingEpoxy();
    const sandbox = new EpoxySandbox(live);
    for (let t = 0; t < 14; t++) {
      if (t === 3) live.attemptPlayerMove('E');
      live.tick();
      sandbox.open();
      expect(JSON.stringify(sandbox.copy.captureState())).toBe(JSON.stringify(live.captureState()));
      sandbox.close();
    }
  });

  it('a restart or an undo is followed because the copy is set to the game before each forecast', () => {
    const engine = crossingEpoxy();
    const forecaster = new WalkForecaster(STOPPED_CLOCK);
    walkEpoxy(engine, true, GOAL, forecaster);
    engine.loadLevel(engine.getLevel());
    forecaster.reset();
    expect(walkEpoxy(engine, true, GOAL, forecaster)).toMatchObject({ end: 'arrived', x: 7, y: 2, tick: 31, waits: 10 });
  });

  it('plays a level with the CC2 actor order: the step is stored, and the walk waits and arrives', () => {
    const level = room({ mode: 'cc2', startX: 2, entities: [{ type: BALL, x: 6, y: 9, dir: 'N' }] });
    const engine = new GameEngine();
    engine.loadLevel(level);
    expect(engine.playsInActorOrder()).toBe(true);
    const without = walkEpoxy(engine, false, { x: 10, y: 5 });
    expect(without.end).toBe('died');
    const again = new GameEngine();
    again.loadLevel(level);
    const forecaster = new WalkForecaster(STOPPED_CLOCK);
    const watched = walkEpoxy(again, true, { x: 10, y: 5 }, forecaster);
    expect(watched).toMatchObject({ end: 'arrived', x: 10, y: 5 });
    expect(watched.waits).toBeGreaterThan(0);
    expect(forecaster.stats().timeouts).toBe(0);
    const replayed = replay(new GameEngine(), level, again.getTick(), again.getTimedMoveHistory());
    expect(JSON.stringify(replayed.captureState())).toBe(JSON.stringify(again.captureState()));
  });

  it('a decision that runs out of its time budget answers go', () => {
    const engine = crossingEpoxy();
    for (let t = 0; t < 6; t++) engine.tick();
    const plan = Pathfinder.findPath(engine, GOAL.x, GOAL.y);
    let now = 0;
    const slow = new WalkForecaster(() => (now += (ConfigRegistry.getGame().timing.walkForecastBudgetMs ?? 0) + 1));
    expect(slow.judge(engine, plan)).toBe('go');
    expect(slow.stats().timeouts).toBe(1);
  });
});

describe('WalkForecaster elsewhere', () => {
  it('answers go on an engine it cannot copy, as the walk did before', () => {
    const engine = new LynxEngine(SILENT);
    engine.loadLevel(lynxLevel(DEAD_END.map((row) => row.replace('b', '.'))));
    expect(new WalkForecaster(STOPPED_CLOCK).judge(engine, { moves: ['E'], points: [{ x: 2, y: 1 }] })).toBe('go');
  });
});
