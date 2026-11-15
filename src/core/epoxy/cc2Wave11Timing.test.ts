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
 * CC2 wave 11, wired sinks end to end: a chain of pink buttons and clone machines keeps the rhythm of Lexy (4, 4, 3 ticks per
 * three clones), a pink button pressed at a step end clones before the decisions of the pass that follows, and a clone machine fed
 * through a gate keeps waiting for the end of that tick. Lexy: the wire phase of a tic runs before its decisions (game.js:872-876);
 * an actor let out out of turn takes the frame of its release (game.js:2218-2242).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { buildTestLevel } from '../../test/buildTestLevel';
import { GameEngine } from '../GameEngine';
import type { Cc2LevelData, CompiledLevel, Direction, SignalLink } from '../types';

beforeEach(() => {
  loadTestConfigs();
});

const CC2_RECORD = { v: 1, sha256: 'ab'.repeat(32), file: 'one.c2m', order: 1, gridHash: 'x' } as Cc2LevelData;
const ROW = 1;
const PLATE = 'signal_plate';
const CLONE_MACHINE = 'clone_machine';
const GATE = 'signal_gate_and_cc2';
const BLOCK = 'dirt_block';

const CHAIN_LENGTH = 6;
/** Each stage is a plate and its clone machine one cell east; the clone lands on the next plate: 2 cells a stage. */
const STAGE_WIDTH = 2;
const FIRST_PLATE_X = 2;
const CHAIN_WIDTH = FIRST_PLATE_X + STAGE_WIDTH * CHAIN_LENGTH + 3;
const CHAIN_TICKS = 40;
/** The ticks between the arrivals of the clones of an avalnch-shaped chain (Lexy 4, 4, 3 per three clones, from tic 0). */
const CHAIN_INTERVALS: readonly number[] = [4, 3, 4, 4, 3];
const LANE_TICKS = 12;

const wall = (width: number): string => '#'.repeat(width);

/** A held pink plate at the head of a chain: each clone released onto the next plate wires the next clone machine. */
function chain(): CompiledLevel {
  const rows = [wall(CHAIN_WIDTH), `#@${'.'.repeat(CHAIN_WIDTH - 3)}#`, wall(CHAIN_WIDTH)];
  const plateXs = Array.from({ length: CHAIN_LENGTH }, (_, i) => FIRST_PLATE_X + STAGE_WIDTH * i);
  const templates = plateXs.map((x) => ({ type: BLOCK, x: x + 1, y: ROW, dir: 'E' as Direction }));
  const holder = { type: BLOCK, x: FIRST_PLATE_X, y: ROW, dir: 'E' as Direction };
  const built = buildTestLevel(rows, { entities: [...templates, holder] });
  const links: SignalLink[] = [];
  for (const x of plateXs) {
    built.terrain[ROW][x] = PLATE;
    built.terrain[ROW][x + 1] = CLONE_MACHINE;
    links.push({ fromX: x, fromY: ROW, toX: x + 1, toY: ROW });
  }
  return { ...built, signalLinks: links, cc2: CC2_RECORD };
}

function load(level: CompiledLevel): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(level);
  return engine;
}

describe('CC2 engine: a pink button and clone machine chain', () => {
  it('keeps the 4, 4, 3 rhythm of the clones', () => {
    const engine = load(chain());
    const arrivals: number[] = [];
    const seen = new Set<number>();
    for (let tick = 0; tick < CHAIN_TICKS; tick++) {
      engine.tick();
      for (let stage = 0; stage < CHAIN_LENGTH; stage++) {
        const cloneX = FIRST_PLATE_X + STAGE_WIDTH * stage + 2;
        if (!seen.has(stage) && engine.getEntities().some((e) => e.x === cloneX && e.y === ROW)) {
          seen.add(stage);
          arrivals.push(tick);
        }
      }
    }
    expect(arrivals).toHaveLength(CHAIN_LENGTH);
    expect(arrivals[0]).toBe(0);
    expect(arrivals.slice(1).map((tick, i) => tick - arrivals[i])).toEqual(CHAIN_INTERVALS);
  });
});

const CLONER_X = 5;
const CLONE_X = CLONER_X + 1;
const SOURCE_X = 2;
const GATE_X = 3;
const EMPTY_ROWS = ['#########', '#@......#', '#########'];

/** A pink plate wired to a clone machine, directly or through a gate; the player starts one step west of the plate. */
function pressLane(gated: boolean): CompiledLevel {
  const template = { type: BLOCK, x: CLONER_X, y: ROW, dir: 'E' as Direction };
  const built = buildTestLevel(EMPTY_ROWS, { entities: [template] });
  built.terrain[ROW][SOURCE_X] = PLATE;
  built.terrain[ROW][CLONER_X] = CLONE_MACHINE;
  const links: SignalLink[] = gated
    ? [
        { fromX: SOURCE_X, fromY: ROW, toX: GATE_X, toY: ROW, port: 'in0' },
        { fromX: GATE_X, fromY: ROW, toX: CLONER_X, toY: ROW }
      ]
    : [{ fromX: SOURCE_X, fromY: ROW, toX: CLONER_X, toY: ROW }];
  if (gated) built.terrain[ROW][GATE_X] = GATE;
  return { ...built, signalLinks: links, cc2: CC2_RECORD };
}

/** The arrival countdown of the clone on the tick it first appears: the earlier it is let out, the lower it is. */
function arrivalWhenCloned(gated: boolean): number {
  const engine = load(pressLane(gated));
  expect(engine.attemptPlayerMove('E')).toBe(true);
  for (let tick = 0; tick < LANE_TICKS; tick++) {
    engine.tick();
    const clone = engine.getEntities().find((e) => e.x === CLONE_X && e.y === ROW);
    if (clone !== undefined) return clone.arrivalTicks ?? 0;
  }
  throw new Error('the clone machine never fired');
}

describe('CC2 engine: where a wired press lands in the tick', () => {
  // A press at a step end fires its button-fed clone machine before the pass that follows (game.js:872-876), so that pass counts
  // the clone down at once; a clone machine fed through a gate (the Haunted shape) keeps the deferral to the end of the tick, as
  // before wave 11, and its clone waits one tick more.
  it('clones a pink button pressed at a step end before the pass, and keeps a gate-fed edge for the end of the tick', () => {
    const direct = arrivalWhenCloned(false);
    const gated = arrivalWhenCloned(true);
    expect(direct).toBeGreaterThan(0);
    expect(gated).toBe(direct + 1);
  });
});
