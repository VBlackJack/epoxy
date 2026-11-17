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

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));
// The decision point of a tick has no hook in the engine: the real epoxyFrames, followed by the sampler of readAtDecisionAndAfter.
vi.mock('./epoxyFrames', async (importOriginal) => (await import('../../test/cc2DecisionProbe')).decisionSamplingFrames(await importOriginal<typeof import('./epoxyFrames')>()));

import { readAtDecisionAndAfter } from '../../test/cc2DecisionProbe';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { GameEngine } from '../GameEngine';
import { LIGHTNING_BOLT_ITEM_ID, SIGNAL_PLATE_TILE_ID } from '../coreConstants';
import type { Cc2LevelData, CompiledLevel, Direction, SignalLink } from '../types';

const SIZE = 13;
const MAX_WAIT_TICKS = 40;
/**
 * Ticks run after the input of the step that presses the plate or brings the bolt holder to rest. The step ends in tick 4; the wire phase
 * of that tic reads the actor at rest only in the next one (Lexy lanes flip_*, bolt_*), so the sink shows the flip at the end of tick 5
 * and at the decisions of tick 5 (before wave 19: tick 4).
 */
const SETTLE_TICKS = 5;
/** The tick that shows the flip, at its end and at its decisions. */
const FLIP_TICK = 5;
const START = { x: 2, y: 5 };
const SOURCE = { x: 3, y: 5 };
const SINK = { x: 8, y: 3 };
const WIRE_FLOOR = 'signal_wire_floor';
const GREEN_WALL_CLOSED = 'toggle_wall_closed';
const GREEN_WALL_OPEN = 'toggle_wall_open';
const CC2_STUB = { v: 1 } as unknown as Cc2LevelData;

type Cell = { x: number; y: number };

function room(source: string, sink: string, cc2: boolean): CompiledLevel {
  const terrain: string[][] = Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x) => (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? 'wall' : 'floor'))
  );
  terrain[SOURCE.y][SOURCE.x] = source;
  terrain[SINK.y][SINK.x] = sink;
  const signalLinks: SignalLink[] = [{ fromX: SOURCE.x, fromY: SOURCE.y, toX: SINK.x, toY: SINK.y }];
  return {
    id: 'wired_flip_room',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 200,
    chipsRequired: 0,
    playerStart: { ...START, dir: 'E' },
    terrain,
    items: Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null)),
    entities: [],
    trapLinks: [],
    cloneLinks: [],
    signalLinks,
    ...(cc2 ? { cc2: CC2_STUB } : {})
  };
}

function load(level: CompiledLevel): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(level);
  return engine;
}

function step(engine: GameEngine, dir: Direction): void {
  for (let waited = 0; waited <= MAX_WAIT_TICKS; waited++) {
    if (engine.getPlayer().moveCooldown === 0) {
      engine.attemptPlayerMove(dir);
      return;
    }
    engine.tick();
  }
  throw new Error('the player never became able to move');
}

const tileAt = (engine: GameEngine, cell: Cell): string => engine.getTerrain()[cell.y][cell.x];

function pressButton(sink: string, cc2: boolean): GameEngine {
  const engine = load(room(SIGNAL_PLATE_TILE_ID, sink, cc2));
  step(engine, 'E');
  for (let i = 0; i < SETTLE_TICKS; i++) engine.tick();
  return engine;
}

beforeEach(() => {
  loadTestConfigs();
});

/** The first tick whose end shows the sink changed from its first tile, and the first tick whose decisions see it changed. */
function flipView(engine: GameEngine, cell: Cell): { post: number; decision: number } {
  const initial = tileAt(engine, cell);
  let post = -1;
  let decision = -1;
  for (let i = 0; i < SETTLE_TICKS + 1; i++) {
    const seen = readAtDecisionAndAfter(() => engine.tick(), () => tileAt(engine, cell));
    if (decision < 0 && seen.decision !== undefined && seen.decision !== initial) decision = engine.getTick();
    if (post < 0 && seen.after !== initial) post = engine.getTick();
  }
  return { post, decision };
}

/** The plate lane, observed tick by tick from the input of the step: the flip of `sink` as flipView reports it. */
function pressedFlipView(sink: string): { post: number; decision: number } {
  const engine = load(room(SIGNAL_PLATE_TILE_ID, sink, true));
  step(engine, 'E');
  return flipView(engine, SINK);
}

describe('CC2 wired flip tiles', () => {
  // Lexy lanes flip_force_floor_n, flip_green_wall, flip_swivel: the plate is read once the player is at rest (end of the step in tick 4),
  // the sink flips in the wire phase after it: shown at the end of the next tic and at its frame-2 decisions, both tick 5. A step decided
  // there onto the force floor or the green wall enters (lanes beh_force_k4, beh_gwall_k4, cc2WireFramePhases.test.ts).
  it('reverses a wired force floor', () => {
    expect(tileAt(pressButton('force_n', true), SINK)).toBe('force_s');
    expect(tileAt(pressButton('force_e', true), SINK)).toBe('force_w');
    expect(pressedFlipView('force_n')).toEqual({ post: FLIP_TICK, decision: FLIP_TICK });
  });

  it('flips a wired green toggle wall', () => {
    expect(tileAt(pressButton(GREEN_WALL_CLOSED, true), SINK)).toBe(GREEN_WALL_OPEN);
    expect(pressedFlipView(GREEN_WALL_CLOSED)).toEqual({ post: FLIP_TICK, decision: FLIP_TICK });
  });

  it('turns a wired swivel door clockwise', () => {
    expect(tileAt(pressButton('swivel_door_cc2_ne', true), SINK)).toBe('swivel_door_cc2_se');
    expect(tileAt(pressButton('swivel_door_cc2_se', true), SINK)).toBe('swivel_door_cc2_sw');
    expect(pressedFlipView('swivel_door_cc2_ne')).toEqual({ post: FLIP_TICK, decision: FLIP_TICK });
  });

  it('leaves a native level as it was: the link to a force floor or a swivel is dropped', () => {
    expect(tileAt(pressButton('force_n', false), SINK)).toBe('force_n');
    expect(tileAt(pressButton('swivel_door_cc2_ne', false), SINK)).toBe('swivel_door_cc2_ne');
    expect(tileAt(pressButton(GREEN_WALL_CLOSED, false), SINK)).toBe(GREEN_WALL_OPEN);
  });
});

describe('CC2 lightning bolt', () => {
  function bolt(cc2: boolean): { engine: GameEngine; afterMove: string; settled: string } {
    const engine = load(room(WIRE_FLOOR, GREEN_WALL_CLOSED, cc2));
    engine.getPlayer().boots.add(LIGHTNING_BOLT_ITEM_ID);
    step(engine, 'E');
    const afterMove = tileAt(engine, SINK);
    for (let i = 0; i < MAX_WAIT_TICKS && engine.getPlayer().moveCooldown !== 0; i++) engine.tick();
    for (let i = 0; i < SETTLE_TICKS; i++) engine.tick();
    return { engine, afterMove, settled: tileAt(engine, SINK) };
  }

  // Lexy lane bolt_green_wall: the holder is at rest at the end of tic t3 and the sink shows the wire at the end of t4 and at its decisions.
  it('powers the wire under the player only once he stands still on a CC2 level', () => {
    const cc2 = bolt(true);
    expect(cc2.afterMove).toBe(GREEN_WALL_CLOSED);
    expect(cc2.settled).toBe(GREEN_WALL_OPEN);
    const lane = load(room(WIRE_FLOOR, GREEN_WALL_CLOSED, true));
    lane.getPlayer().boots.add(LIGHTNING_BOLT_ITEM_ID);
    step(lane, 'E');
    expect(flipView(lane, SINK)).toEqual({ post: FLIP_TICK, decision: FLIP_TICK });
  });

  it('powers it right after the move on a native level, as before', () => {
    expect(bolt(false).afterMove).toBe(GREEN_WALL_OPEN);
  });
});
