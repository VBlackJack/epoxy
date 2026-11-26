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

vi.mock('../audio/AudioManager', () => ({
  AudioManager: { playSfx: vi.fn() }
}));

import { CclpEngine } from '../core/cclp/CclpEngine';
import { cclpPathView } from '../core/cclp/cclpPathView';
import { lynxLevel } from '../core/lynx/lynxTestMaps';
import { Pathfinder } from '../core/Pathfinder';
import { Direction, GridPoint, PlayerState } from '../core/types';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { endWalkStep, startWalkStep, WalkEngine, WalkPlan } from './cclpAutoWalk';

beforeAll(() => {
  loadTestConfigs();
});

const SILENT = { effect: () => undefined, step: () => undefined };
const WALK_TICKS = 400;
const SETTLE_TICKS = 30;
const OPEN_ROW = ['#####', '#@..#', '#####'];
const LONG_ROW = ['#######', '#@....#', '#######'];

function chipAt(x: number, y: number, over: Partial<PlayerState> = {}): PlayerState {
  return {
    x,
    y,
    dir: 'S',
    alive: true,
    deathReasonKey: null,
    isSliding: false,
    slideDir: null,
    moveCooldown: 0,
    slideCooldown: 0,
    inWater: false,
    keys: {},
    boots: new Set<string>(),
    ...over
  } as PlayerState;
}

/** A scripted engine: what Chip is, and whether he would take a press; it records the presses it receives. */
function fakeEngine(
  player: PlayerState,
  over: { paused?: boolean; takesInput?: boolean; accepts?: boolean } = {}
): WalkEngine & { presses: Direction[] } {
  const presses: Direction[] = [];
  return {
    presses,
    isPaused: () => over.paused === true,
    getPlayer: () => player,
    canChipTakeInput: () => over.takesInput !== false,
    attemptPlayerMove: (dir) => {
      presses.push(dir);
      return over.accepts !== false;
    }
  };
}

function cclpLevel(rows: string[], glyphs: Record<string, string> = {}) {
  return { ...lynxLevel(rows, { glyphs }), rulesProfile: 'cclp' as const };
}

function viewOf(rows: string[]) {
  const engine = new CclpEngine(SILENT);
  engine.loadLevel(cclpLevel(rows));
  return { engine, view: cclpPathView(engine) };
}

/** Lets the game run with nothing held: a press left stored by the walk would show as a step. */
function settle(engine: CclpEngine): void {
  for (let t = 0; t < SETTLE_TICKS; t++) {
    engine.holdPlayerDirections([]);
    engine.tick();
  }
}

/** The page's loop on a real CCLP engine; `cancelAtTick` drops the plan as a key or pad press does. */
function run(engine: CclpEngine, plan: { moves: Direction[]; points: GridPoint[] }, cancelAtTick = -1): void {
  const view = cclpPathView(engine);
  for (let t = 0; t < WALK_TICKS && plan.moves.length > 0; t++) {
    if (t === cancelAtTick) {
      plan.moves.length = 0;
      plan.points.length = 0;
      break;
    }
    engine.holdPlayerDirections([]);
    const start = startWalkStep(plan, engine, view);
    if (start.kind === 'stop') break;
    engine.tick();
    const end = endWalkStep(engine, start);
    if (end === 'advanced') {
      plan.moves.shift();
      plan.points.shift();
    } else if (end === 'stopped') {
      break;
    }
  }
}

const EAST_PLAN: WalkPlan = { moves: ['E', 'E'], points: [{ x: 2, y: 1 }, { x: 3, y: 1 }] };

describe('startWalkStep', () => {
  it('presses the next step when Chip can take it', () => {
    const { view } = viewOf(OPEN_ROW);
    const engine = fakeEngine(chipAt(1, 1));
    expect(startWalkStep(EAST_PLAN, engine, view)).toEqual({ kind: 'sent', target: { x: 2, y: 1 } });
    expect(engine.presses).toEqual(['E']);
  });

  it('waits without pressing while Chip is mid-step or sliding', () => {
    const { view } = viewOf(OPEN_ROW);
    for (const busy of [{ moveCooldown: 3 }, { isSliding: true }]) {
      const engine = fakeEngine(chipAt(1, 1, busy));
      expect(startWalkStep(EAST_PLAN, engine, view)).toEqual({ kind: 'idle' });
      expect(engine.presses).toEqual([]);
    }
  });

  it('stops without pressing when a forced move he may not override is due and he is neither sliding nor mid-step', () => {
    const { view } = viewOf(OPEN_ROW);
    const engine = fakeEngine(chipAt(1, 1), { takesInput: false });
    expect(startWalkStep(EAST_PLAN, engine, view)).toEqual({ kind: 'stop' });
    expect(engine.presses).toEqual([]);
  });

  it('stops and presses nothing while the game is paused', () => {
    const { view } = viewOf(OPEN_ROW);
    const engine = fakeEngine(chipAt(1, 1), { paused: true });
    expect(startWalkStep(EAST_PLAN, engine, view)).toEqual({ kind: 'stop' });
    expect(engine.presses).toEqual([]);
  });

  it('stops when the engine refuses the press', () => {
    const { view } = viewOf(OPEN_ROW);
    const engine = fakeEngine(chipAt(1, 1), { accepts: false });
    expect(startWalkStep(EAST_PLAN, engine, view)).toEqual({ kind: 'stop' });
    expect(engine.presses).toEqual(['E']);
  });

  it('stops when Chip is not where the plan left him', () => {
    const { view } = viewOf(OPEN_ROW);
    const engine = fakeEngine(chipAt(3, 1));
    expect(startWalkStep(EAST_PLAN, engine, view)).toEqual({ kind: 'stop' });
    expect(engine.presses).toEqual([]);
  });

  it('does nothing for an empty plan', () => {
    const { view } = viewOf(OPEN_ROW);
    const engine = fakeEngine(chipAt(1, 1));
    expect(startWalkStep({ moves: [], points: [] }, engine, view)).toEqual({ kind: 'idle' });
    expect(engine.presses).toEqual([]);
  });
});

describe('endWalkStep', () => {
  it('follows what Chip did, not what the press promised', () => {
    const sent = { kind: 'sent', target: { x: 2, y: 1 } } as const;
    expect(endWalkStep(fakeEngine(chipAt(2, 1)), sent)).toBe('advanced');
    expect(endWalkStep(fakeEngine(chipAt(1, 1)), sent)).toBe('stopped');
    expect(endWalkStep(fakeEngine(chipAt(1, 1, { moveCooldown: 2 })), sent)).toBe('waiting');
    expect(endWalkStep(fakeEngine(chipAt(1, 1)), { kind: 'idle' })).toBe('waiting');
  });

  it('with the autoStepTarget missing (no press sent), the tick changes nothing and the plan is kept', () => {
    expect(endWalkStep(fakeEngine(chipAt(2, 1)), { kind: 'idle' })).toBe('waiting');
    expect(endWalkStep(fakeEngine(chipAt(2, 1)), { kind: 'stop' })).toBe('waiting');
  });
});

describe('the walk on the CCLP engine', () => {
  it('walks a plan to its end', () => {
    const { engine, view } = viewOf(OPEN_ROW);
    const plan = Pathfinder.findPath(view, 3, 1);
    run(engine, plan);
    expect(plan.moves).toEqual([]);
    expect(engine.getPlayer()).toMatchObject({ x: 3, y: 1 });
  });

  it('a refused push leaves Chip where he was, and no press stays stored for later', () => {
    const { engine, view } = viewOf(['#####', '#@B##', '#...#', '#####']);
    const plan = Pathfinder.findPath(view, 2, 1);
    expect(plan.moves).toEqual(['E']);
    run(engine, plan);
    expect(engine.getPlayer()).toMatchObject({ x: 1, y: 1 });
    const decided = engine.getTimedMoveHistory().length;
    settle(engine);
    expect(engine.getPlayer()).toMatchObject({ x: 1, y: 1 });
    expect(engine.getTimedMoveHistory().length).toBe(decided);
  });

  it('a cancel mid-walk stores no press: Chip ends the step he began and takes no other', () => {
    const { engine, view } = viewOf(LONG_ROW);
    const plan = Pathfinder.findPath(view, 5, 1);
    run(engine, plan, 2);
    settle(engine);
    const player = engine.getPlayer();
    expect(player.x).toBeLessThan(5);
    expect(engine.getTimedMoveHistory().length).toBe(player.x - 1);
  });

  it('a pause stops the walk, and the plan from before it is not resumed after it', () => {
    const { engine, view } = viewOf(LONG_ROW);
    const plan = Pathfinder.findPath(view, 5, 1);
    run(engine, { moves: plan.moves.slice(0, 1), points: plan.points.slice(0, 1) });
    expect(engine.getPlayer()).toMatchObject({ x: 2, y: 1 });
    engine.setPaused(true);
    const stale = { moves: plan.moves.slice(1), points: plan.points.slice(1) };
    expect(startWalkStep(stale, engine, view)).toEqual({ kind: 'stop' });
    engine.setPaused(false);
    settle(engine);
    expect(engine.getPlayer()).toMatchObject({ x: 2, y: 1 });
  });

  it('reads Chip as unable to take input while a step is under way', () => {
    const { engine, view } = viewOf(LONG_ROW);
    expect(engine.canChipTakeInput()).toBe(true);
    const plan = Pathfinder.findPath(view, 5, 1);
    expect(startWalkStep(plan, engine, view).kind).toBe('sent');
    engine.tick();
    expect(engine.getPlayer().moveCooldown).toBeGreaterThan(0);
    expect(engine.canChipTakeInput()).toBe(false);
  });

  it('stops without a stored press when a teleport exit carries Chip while he is neither sliding nor mid-step', () => {
    const level = cclpLevel(['#########', '#@.T.T..#', '#########'], { T: 'teleport' });
    const engine = new CclpEngine(SILENT);
    engine.loadLevel(level);
    const view = cclpPathView(engine);
    // Walk onto the teleport by ordinary presses until the exit move is due and Chip may not choose.
    let found = false;
    for (let t = 0; t < WALK_TICKS && !found; t++) {
      const player = engine.getPlayer();
      found = !player.isSliding && player.moveCooldown === 0 && !engine.canChipTakeInput();
      if (found) break;
      engine.holdPlayerDirections([]);
      if (player.moveCooldown === 0) engine.attemptPlayerMove('E');
      engine.tick();
    }
    expect(found).toBe(true);
    const decided = engine.getTimedMoveHistory().length;
    const at = engine.getPlayer();
    const plan = { moves: ['E'] as Direction[], points: [{ x: at.x + 1, y: at.y }] };
    expect(startWalkStep(plan, engine, view)).toEqual({ kind: 'stop' });
    // Nothing was stored by the refused start: the forced exit plays, then Chip stays where it leaves him.
    for (let t = 0; t < 4; t++) {
      engine.holdPlayerDirections([]);
      engine.tick();
    }
    const after = engine.getPlayer();
    settle(engine);
    expect(engine.getPlayer()).toMatchObject({ x: after.x, y: after.y });
    expect(engine.getTimedMoveHistory().length).toBe(decided);
  });
});
