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
import { cclpPathView } from '../core/cclp/cclpPathView';
import { GameEngine } from '../core/GameEngine';
import { lynxLevel } from '../core/lynx/lynxTestMaps';
import { Pathfinder } from '../core/Pathfinder';
import { CompiledLevel } from '../core/types';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { startEpoxyWalkStep, WalkWait } from './epoxyAutoWalk';
import { ObjectiveMarker } from './objectiveMarker';
import { maxWalkWaitTicks, walkForecastBudgetMs, walkLookaheadSteps } from './walkForecast';

beforeAll(() => {
  loadTestConfigs();
});

const SILENT = { effect: (): void => undefined, step: (): void => undefined };
const LINE = ['#######', '#@....#', '#######'];

function epoxyLine(): GameEngine {
  const { mapWidth, mapHeight } = ConfigRegistry.getGame().grid;
  const terrain = Array.from({ length: mapHeight }, (_, y) =>
    Array.from({ length: mapWidth }, (_, x) => ((LINE[y]?.[x] ?? '#') === '#' ? 'wall' : 'floor'))
  );
  const level: CompiledLevel = {
    id: 'walk_watch',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    playerStart: { x: 1, y: 1, dir: 'E' },
    terrain,
    items: terrain.map((row) => row.map(() => null)),
    entities: [],
    trapLinks: [],
    cloneLinks: []
  };
  const engine = new GameEngine();
  engine.loadLevel(level);
  return engine;
}

function cclp(rows: string[]): CclpEngine {
  const engine = new CclpEngine(SILENT);
  engine.loadLevel({ ...lynxLevel(rows), rulesProfile: 'cclp' });
  return engine;
}

describe('the limits come from game.json timing', () => {
  it('waits 5 seconds at 20 ticks a second, looks 2 steps ahead and spends 15 ms a decision', () => {
    expect(maxWalkWaitTicks()).toBe(100);
    expect(walkLookaheadSteps()).toBe(2);
    expect(walkForecastBudgetMs()).toBe(15);
  });
});

describe('WalkWait', () => {
  it('tells the first tick of a wait, counts up to the limit and then gives up', () => {
    const wait = new WalkWait(3);
    expect(wait.hold()).toEqual({ giveUp: false, first: true });
    expect(wait.hold()).toEqual({ giveUp: false, first: false });
    expect(wait.hold()).toEqual({ giveUp: false, first: false });
    expect(wait.ticks).toBe(3);
    expect(wait.hold()).toEqual({ giveUp: true, first: false });
    expect(wait.ticks).toBe(0);
    expect(wait.hold()).toEqual({ giveUp: false, first: true });
  });

  it('a step taken starts the next wait from zero', () => {
    const wait = new WalkWait(3);
    wait.hold();
    wait.hold();
    wait.clear();
    expect(wait.hold()).toEqual({ giveUp: false, first: true });
  });

  it('a monster that never passes ends the walk after exactly the game.json wait, five seconds of ticks', () => {
    const engine = epoxyLine();
    const plan = Pathfinder.findPath(engine, 5, 1);
    const wait = new WalkWait();
    let ticks = 0;
    for (;;) {
      const start = startEpoxyWalkStep(plan, engine, engine, () => 'wait');
      expect(start).toEqual({ kind: 'wait' });
      if (wait.hold().giveUp) break;
      engine.tick();
      ticks++;
    }
    expect(ticks).toBe(100);
    expect(ticks / ConfigRegistry.getGame().timing.ticksPerSecond).toBe(5);
    expect(engine.getPlayer()).toMatchObject({ x: 1, y: 1 });
    expect(engine.getTimedMoveHistory()).toEqual([]);
  });
});

describe('startEpoxyWalkStep', () => {
  it('a paused game does not walk: the plan is dropped and the watch is not asked', () => {
    const engine = epoxyLine();
    const plan = Pathfinder.findPath(engine, 5, 1);
    const judge = vi.fn(() => 'go' as const);
    engine.setPaused(true);
    expect(startEpoxyWalkStep(plan, engine, engine, judge)).toEqual({ kind: 'stop' });
    expect(judge).not.toHaveBeenCalled();
    expect(engine.getTimedMoveHistory()).toEqual([]);
    expect(engine.getPlayer()).toMatchObject({ x: 1, y: 1 });
  });

  it('asks the watch once Chip is free, and sends the press on go', () => {
    const engine = epoxyLine();
    const plan = Pathfinder.findPath(engine, 5, 1);
    const judge = vi.fn(() => 'go' as const);
    expect(startEpoxyWalkStep(plan, engine, engine, judge)).toEqual({ kind: 'sent', stored: false });
    expect(judge).toHaveBeenCalledTimes(1);
    expect(engine.getTimedMoveHistory().map((m) => m.dir)).toEqual(['E']);
  });

  it('does not ask the watch, or press, on wait and danger', () => {
    const engine = epoxyLine();
    const plan = Pathfinder.findPath(engine, 5, 1);
    expect(startEpoxyWalkStep(plan, engine, engine, () => 'wait')).toEqual({ kind: 'wait' });
    expect(startEpoxyWalkStep(plan, engine, engine, () => 'stop')).toEqual({ kind: 'danger' });
    expect(engine.getTimedMoveHistory()).toEqual([]);
  });

  it('keeps the plan while Chip is mid-step and does not ask the watch', () => {
    const engine = epoxyLine();
    const plan = Pathfinder.findPath(engine, 5, 1);
    const judge = vi.fn(() => 'wait' as const);
    engine.attemptPlayerMove('E');
    expect(startEpoxyWalkStep(plan, engine, engine, judge)).toEqual({ kind: 'idle' });
    expect(judge).not.toHaveBeenCalled();
  });
});

describe('Pathfinder.findReachableObjective', () => {
  it('skips a goal no path reaches for the next one a path does', () => {
    const view = cclpPathView(cclp(['#######', '#@iWX##', '#######']));
    expect(Pathfinder.findNextObjective(view)).toEqual({ x: 4, y: 1 });
    expect(Pathfinder.findReachableObjective(view)).toEqual({ x: 2, y: 1 });
  });

  it('is null when no goal is reachable', () => {
    const view = cclpPathView(cclp(['#####', '#@WX#', '#####']));
    expect(Pathfinder.findNextObjective(view)).toEqual({ x: 3, y: 1 });
    expect(Pathfinder.findReachableObjective(view)).toBeNull();
  });
});

describe('ObjectiveMarker', () => {
  const TICKS_PER_SECOND = 20;

  it('spends one shared budget of search steps over its tries, then shows the first goal unmarked', () => {
    const timing = ConfigRegistry.getGame().timing;
    expect(timing.walkObjectiveExpansionBudget).toBe(1200);
    const view = cclpPathView(cclp(['#######', '#@iWX##', '#######']));
    const outcome = { exhausted: false };
    expect(Pathfinder.findReachableObjective(view, 1, outcome)).toBeNull();
    expect(outcome.exhausted).toBe(true);
    expect(Pathfinder.findReachableObjective(view, 1000, outcome)).toEqual({ x: 2, y: 1 });
    expect(outcome.exhausted).toBe(false);
    const saved = timing.walkObjectiveExpansionBudget;
    timing.walkObjectiveExpansionBudget = 1;
    try {
      const marker = new ObjectiveMarker();
      expect(marker.get(view, 0, TICKS_PER_SECOND)).toEqual({ point: { x: 4, y: 1 }, reachable: false });
      expect(marker.budgetHits).toBe(1);
    } finally {
      timing.walkObjectiveExpansionBudget = saved;
    }
  });

  it('marks the reachable goal, then the goal beyond what the path refuses, flagged', () => {
    const marker = new ObjectiveMarker();
    expect(marker.get(cclpPathView(cclp(['#######', '#@iWX##', '#######'])), 0, TICKS_PER_SECOND)).toEqual({
      point: { x: 2, y: 1 },
      reachable: true
    });
    expect(marker.get(cclpPathView(cclp(['#####', '#@WX#', '#####'])), 0, TICKS_PER_SECOND)).toEqual({
      point: { x: 3, y: 1 },
      reachable: false
    });
  });

  it('asks the search once for the same level, cell and second, and again when any of them changes', () => {
    const marker = new ObjectiveMarker();
    const engine = cclp(['#######', '#@....X', '#######']);
    const view = cclpPathView(engine);
    marker.get(view, 0, TICKS_PER_SECOND);
    marker.get(view, 19, TICKS_PER_SECOND);
    expect(marker.searches).toBe(1);
    marker.get(view, 20, TICKS_PER_SECOND);
    expect(marker.searches).toBe(2);
    engine.attemptPlayerMove('E');
    for (let t = 0; t < 8; t++) engine.tick();
    marker.get(view, 20, TICKS_PER_SECOND);
    expect(marker.searches).toBe(3);
  });

  it('forget clears the answer: the next ask searches again at the same tick and cell', () => {
    const marker = new ObjectiveMarker();
    const view = cclpPathView(cclp(['#######', '#@....X', '#######']));
    marker.get(view, 0, TICKS_PER_SECOND);
    marker.forget();
    marker.get(view, 0, TICKS_PER_SECOND);
    expect(marker.searches).toBe(2);
  });

  it('a level that reuses the id of the one before (the editor test play) is a new level, not a cache hit', () => {
    const marker = new ObjectiveMarker();
    const engine = new CclpEngine(SILENT);
    const first: CompiledLevel = { ...lynxLevel(['#######', '#@....X', '#######']), rulesProfile: 'cclp' };
    const second: CompiledLevel = { ...lynxLevel(['#####', '#@.X#', '#####']), rulesProfile: 'cclp' };
    expect(second.id).toBe(first.id);
    engine.loadLevel(first);
    const view = cclpPathView(engine);
    expect(marker.get(view, 0, TICKS_PER_SECOND)?.point).toEqual({ x: 6, y: 1 });
    engine.loadLevel(second);
    expect(marker.get(cclpPathView(engine), 0, TICKS_PER_SECOND)?.point).toEqual({ x: 3, y: 1 });
    expect(marker.searches).toBe(2);
  });
});
