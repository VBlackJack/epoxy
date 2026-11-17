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

/**
 * CC2 wave 3, wired sinks (Lexy game.js recalculate_circuitry, tiletypes.js flame jets): every wired sink starts off at load,
 * except a sink fed by a button link; a wired flame jet flips on the rising edge only, except one an orange button works.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));
// The decision point of a tick has no hook in the engine: the real epoxyFrames, followed by the sampler of readAtDecisionAndAfter.
vi.mock('./epoxyFrames', async (importOriginal) => (await import('../../test/cc2DecisionProbe')).decisionSamplingFrames(await importOriginal<typeof import('./epoxyFrames')>()));

import { readAtDecisionAndAfter } from '../../test/cc2DecisionProbe';
import { playMove } from '../../test/cc2Play';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { buildTestLevel } from '../../test/buildTestLevel';
import { GameEngine } from '../GameEngine';
import type { Cc2LevelData, CompiledLevel, Direction, SignalLink } from '../types';

beforeEach(() => {
  loadTestConfigs();
});

const CC2_RECORD = { v: 1, sha256: 'ab'.repeat(32), file: 'one.c2m', order: 1, gridHash: 'x' } as Cc2LevelData;
const ROW = 1;
const SOURCE_X = 2;
const JET_X = 5;
const PLATE = 'signal_plate';
const ORANGE = 'button_orange_cc2';
const JET_OFF = 'flame_jet_cc2_off';
const JET_ON = 'flame_jet_cc2_on';
const BLOCK = 'dirt_block';
const EMPTY_ROWS = ['#########', '#@......#', '#########'];
/** Ticks run after the load; the first one is tick 0. */
const SETTLE_TICKS = 3;

type Mode = 'cc2' | 'native';

/** A lane with a source tile wired to a flame jet; a block rests on the source when `held`. */
function lane(mode: Mode, source: string, held: boolean): CompiledLevel {
  const entities = held ? [{ type: BLOCK, x: SOURCE_X, y: ROW, dir: 'E' as Direction }] : [];
  const built = buildTestLevel(EMPTY_ROWS, { entities });
  built.terrain[ROW][SOURCE_X] = source;
  built.terrain[ROW][JET_X] = JET_OFF;
  const link: SignalLink = { fromX: SOURCE_X, fromY: ROW, toX: JET_X, toY: ROW };
  const wired: CompiledLevel = { ...built, signalLinks: [link] };
  return mode === 'cc2' ? { ...wired, cc2: CC2_RECORD } : wired;
}

function load(level: CompiledLevel): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(level);
  return engine;
}

const jetAt = (engine: GameEngine): string => engine.getTerrain()[ROW][JET_X];
const MAX_WAIT_TICKS = 40;
/** Walks one step east (the input and the tick that plays it), waiting out the cooldown of the step before. */
function stepEast(engine: GameEngine): void {
  for (let waited = 0; waited <= MAX_WAIT_TICKS; waited++) {
    if (engine.getPlayer().moveCooldown === 0) {
      playMove(engine, 'E');
      return;
    }
    engine.tick();
  }
  throw new Error('the player never became able to move');
}
const run = (engine: GameEngine, ticks: number): void => {
  for (let i = 0; i < ticks; i++) engine.tick();
};

describe('CC2 engine: a wired sink starts off at load', () => {
  it('lights a wired flame jet whose wire is held at load, on tick 0', () => {
    const engine = load(lane('cc2', PLATE, true));
    expect(jetAt(engine)).toBe(JET_OFF);
    run(engine, SETTLE_TICKS);
    expect(jetAt(engine)).toBe(JET_ON);
  });

  it('keeps a jet fed by an orange button as it was primed', () => {
    const engine = load(lane('cc2', ORANGE, true));
    run(engine, SETTLE_TICKS);
    expect(jetAt(engine)).toBe(JET_OFF);
  });

  it('keeps the primed start on a level that is not CC2', () => {
    const engine = load(lane('native', PLATE, true));
    run(engine, SETTLE_TICKS);
    expect(jetAt(engine)).toBe(JET_OFF);
  });

  it('changes nothing when the wire is not held at load', () => {
    const engine = load(lane('cc2', PLATE, false));
    run(engine, SETTLE_TICKS);
    expect(jetAt(engine)).toBe(JET_OFF);
  });
});

describe('a wired flame jet flips on the rising edge only on a CC2 level', () => {
  /** The player steps onto the source (jet on), off it, and the lane settles. */
  function overAndOff(mode: Mode, source: string): GameEngine {
    const engine = load(lane(mode, source, false));
    stepEast(engine);
    run(engine, MAX_WAIT_TICKS);
    expect(jetAt(engine)).toBe(JET_ON);
    stepEast(engine);
    stepEast(engine);
    run(engine, MAX_WAIT_TICKS);
    expect(engine.getPlayer().x).toBeGreaterThan(SOURCE_X);
    return engine;
  }

  it('keeps the jet lit when the wire falls', () => {
    expect(jetAt(overAndOff('cc2', PLATE))).toBe(JET_ON);
  });

  it('puts the jet out when the wire falls on a level that is not CC2', () => {
    expect(jetAt(overAndOff('native', PLATE))).toBe(JET_OFF);
  });

  it('toggles a jet worked by an orange button on release too', () => {
    expect(jetAt(overAndOff('cc2', ORANGE))).toBe(JET_OFF);
  });
});

describe('the CC2 pink button reads only an actor at rest', () => {
  it('lights the jet once the player has settled on the button, not at the end of his step', () => {
    const engine = load(lane('cc2', PLATE, false));
    stepEast(engine);
    expect(engine.getPlayer().x).toBe(SOURCE_X);
    expect(jetAt(engine)).toBe(JET_OFF);
    expect(engine.getPlayer().moveCooldown).toBeGreaterThan(0);
    run(engine, MAX_WAIT_TICKS);
    expect(engine.getPlayer().moveCooldown).toBe(0);
    expect(jetAt(engine)).toBe(JET_ON);
  });

  it('lights the jet at the end of the step on a level that is not CC2', () => {
    const engine = load(lane('native', PLATE, false));
    stepEast(engine);
    expect(jetAt(engine)).toBe(JET_ON);
  });

  // Lexy button_orange toggles on_arrive at the end of the arriving step (tiletypes.js:2332-2341, game.js:2350-2357), so the jet
  // is still off while the step runs.
  it('reads the player on an orange button once his step has ended, not the moment he starts it', () => {
    const engine = load(lane('cc2', ORANGE, false));
    stepEast(engine);
    expect(engine.getPlayer().moveCooldown).toBeGreaterThan(0);
    expect(jetAt(engine)).toBe(JET_OFF);
    run(engine, MAX_WAIT_TICKS);
    expect(engine.getPlayer().moveCooldown).toBe(0);
    expect(jetAt(engine)).toBe(JET_ON);
  });
});

const CLONER_X = 5;
const CLONE_X = CLONER_X + 1;
const CLONE_MACHINE = 'clone_machine';

/** A lane with a source wired to a clone machine holding a block template facing east; a block rests on the source when `held`. */
function cloneLane(mode: Mode, source: string, held: boolean): CompiledLevel {
  const template = { type: BLOCK, x: CLONER_X, y: ROW, dir: 'E' as Direction };
  const entities = held ? [template, { type: BLOCK, x: SOURCE_X, y: ROW, dir: 'E' as Direction }] : [template];
  const built = buildTestLevel(EMPTY_ROWS, { entities });
  built.terrain[ROW][SOURCE_X] = source;
  built.terrain[ROW][CLONER_X] = CLONE_MACHINE;
  const wired: CompiledLevel = { ...built, signalLinks: [{ fromX: SOURCE_X, fromY: ROW, toX: CLONER_X, toY: ROW }] };
  return mode === 'cc2' ? { ...wired, cc2: CC2_RECORD } : wired;
}

const clonesAt = (engine: GameEngine): number => engine.getEntities().filter((e) => e.x === CLONE_X && e.y === ROW).length;
const deferredCount = (engine: GameEngine): number => engine.getCc2WaveState()?.deferredSinkEdges?.length ?? 0;
const cloneOf = (engine: GameEngine) => engine.getEntities().find((e) => e.x === CLONE_X && e.y === ROW);
/** Ticks the clone gets, once it appears, to finish its step. */
const LANDING_TICKS = 20;
/**
 * The tick (engine tick count after it ran) in which the clone lands: the one where its arrival countdown and its held-arrival
 * fields are both gone. A clone let out by a press of frame 0 or 1 ends its 12-frame out-of-turn step at p + 11, a tick later than
 * the countdown alone says (game.js:2218-2242; MAP123 t24-t26, map045 t1541).
 */
function landingTick(engine: GameEngine): number {
  for (let waited = 0; waited < LANDING_TICKS; waited++) {
    const clone = cloneOf(engine);
    if (clone !== undefined && clone.arrivalTicks === undefined && clone.cc2ArrivalWait === undefined && clone.cc2ArrivalFrame === undefined) return engine.getTick();
    engine.tick();
  }
  throw new Error(`the clone never landed ${JSON.stringify(cloneOf(engine))}`);
}
/** The landing tick of a clone released by a press in mid-level (the test below), and of the two clones released at the player's turn. */
const LANDING_TICK_MID_LEVEL = 12;
const LANDING_TICK_AT_TURN = 9;
/** The tick the clone is in its exit cell, at the end of the tick and at the decisions inside it: the tick of the release. */
const CLONE_OUT_TICK_MID_LEVEL = 8;
const CLONE_OUT_TICK_AT_TURN = 5;

/**
 * Ticks until the clone is on the floor, checking every tick before it: no clone at the end of the tick nor at its decisions, and what
 * the player's step is doing. The tick of the release, whether the decisions of that tick already saw the clone, and the cooldown of the
 * player at the end of the tick before it.
 */
function untilCloneOut(engine: GameEngine): { tick: number; atDecision: boolean; cooldownBefore: number } {
  let cooldownBefore = engine.getPlayer().moveCooldown;
  for (let waited = 0; waited < MAX_WAIT_TICKS; waited++) {
    const seen = readAtDecisionAndAfter(() => engine.tick(), () => clonesAt(engine));
    if (seen.after > 0) return { tick: engine.getTick(), atDecision: (seen.decision ?? 0) > 0, cooldownBefore };
    expect(seen.decision).toBe(0);
    cooldownBefore = engine.getPlayer().moveCooldown;
  }
  throw new Error('the clone was never released');
}

describe('CC2 engine: a wire-fired clone machine acts before the pass that follows its edge', () => {
  // Lexy runs the wire phase of tic 0 before its decisions (game.js:872-876): the load edge fires before the pass of tick 0.
  it('fires the edge of the load before the pass of tick 0', () => {
    const engine = load(cloneLane('cc2', PLATE, true));
    engine.tick();
    expect(clonesAt(engine)).toBe(1);
    expect(deferredCount(engine)).toBe(0);
  });

  // A press made in mid-level: the pink plate reads the player once his step has ended, the wire phase of that tick end raises the
  // edge, and the clone machine acts before the decisions of the next pass (game.js:872-876, the wire phase before the decisions; the edge
  // of a press is read at the end of the step, game.js:2350-2357). The clone is in the exit cell at the decisions of the tick of its
  // release already (Lexy lane wdirect: out at the decisions and at the end of that tic alike).
  it('fires an edge made in mid-level before the pass that follows it', () => {
    const engine = load(cloneLane('cc2', PLATE, false));
    run(engine, SETTLE_TICKS);
    stepEast(engine);
    const out = untilCloneOut(engine);
    expect(out.cooldownBefore).toBe(0);
    expect(out.tick).toBe(CLONE_OUT_TICK_MID_LEVEL);
    expect(out.atDecision).toBe(true);
    expect(clonesAt(engine)).toBe(1);
    expect(deferredCount(engine)).toBe(0);
    expect(landingTick(engine)).toBe(LANDING_TICK_MID_LEVEL);
  });

  // The turn of the player is stored for the tick; the pink plate raises its edge at the end of the tick in which his step ends
  // (it reads an actor at rest), and the clone machine acts before the pass of the next tick (game.js:872-876, 2350-2357).
  it.each([PLATE, ORANGE])("fires an edge made at the player's turn, from %s, before the pass of the tick after his step ends", (source) => {
    const engine = load(cloneLane('cc2', source, false));
    expect(engine.attemptPlayerMove('E')).toBe(true);
    expect(clonesAt(engine)).toBe(0);
    expect(deferredCount(engine)).toBe(0);
    const out = untilCloneOut(engine);
    expect(out.cooldownBefore).toBe(0);
    expect(out.tick).toBe(CLONE_OUT_TICK_AT_TURN);
    expect(out.atDecision).toBe(true);
    expect(clonesAt(engine)).toBe(1);
    expect(deferredCount(engine)).toBe(0);
    expect(landingTick(engine)).toBe(LANDING_TICK_AT_TURN);
  });

  it('fires at once, in the phase of the edge, on a level that is not CC2', () => {
    const engine = load(cloneLane('native', ORANGE, false));
    stepEast(engine);
    expect(clonesAt(engine)).toBe(1);
    expect(deferredCount(engine)).toBe(0);
  });
});
