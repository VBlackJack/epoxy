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
 * CC2 engine: a light switch flipped by the step end that an input flushes is not read by the wire settle that runs before the
 * actor pass. The wired purple wall changes only at the tick the switch's own wire phase allows, never a tick early.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

vi.mock('./epoxyFrames', async (importOriginal) => (await import('../../test/cc2DecisionProbe')).decisionSamplingFrames(await importOriginal<typeof import('./epoxyFrames')>()));

import { readAtDecisionAndAfter } from '../../test/cc2DecisionProbe';
import { ROOM_ROW, room } from '../../test/cc2Room';
import { playMove } from '../../test/cc2Play';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { GameEngine } from '../GameEngine';
import type { SignalLink } from '../types';

beforeEach(() => {
  loadTestConfigs();
});

const SWITCH_OFF = 'toggle_switch_off';
const PURPLE_WALL = 'purple_wall';
const PURPLE_FLOOR = 'purple_floor';
const SEED = 3;
const START_X = 2;
const SWITCH_X = 3;
const WALL_X = 8;
const MAX_TICKS = 40;
const OBSERVED_TICKS = 12;

interface Trace {
  /** The tick counter at the first decision point that sees the wall cell changed from its form before the input (-1 when never). */
  firstDecisionTick: number;
  /** The tick counter at the first end of tick whose wall cell has changed (-1 when never). */
  firstEndTick: number;
  wallBefore: string;
  wallAfter: string;
  /** The player cell at the end of each observed tick, "x,y". */
  cells: string[];
}

function load(): GameEngine {
  const level = room({ mode: 'cc2', startX: START_X, terrain: { [`${SWITCH_X},${ROOM_ROW}`]: SWITCH_OFF, [`${WALL_X},${ROOM_ROW}`]: PURPLE_WALL } });
  const signalLinks: SignalLink[] = [{ fromX: SWITCH_X, fromY: ROOM_ROW, toX: WALL_X, toY: ROOM_ROW }];
  level.signalLinks = signalLinks;
  const engine = new GameEngine();
  engine.loadLevel(level, SEED);
  return engine;
}

const wall = (engine: GameEngine): string => engine.getTerrain()[ROOM_ROW][WALL_X];

function waitOut(engine: GameEngine): void {
  let guard = 0;
  while (engine.getPlayer().moveCooldown > 0 && guard++ < MAX_TICKS) engine.tick();
}

/** Steps onto the switch, waits the step out, then gives the input that flushes the step end; observes `OBSERVED_TICKS` ticks from it. */
function observe(engine: GameEngine, undoAndRedo: boolean): Trace {
  playMove(engine, 'E');
  waitOut(engine);
  if (undoAndRedo) {
    engine.attemptPlayerMove('E');
    expect(engine.undo()).toBe(true);
  }
  const wallBefore = wall(engine);
  const trace: Trace = { firstDecisionTick: -1, firstEndTick: -1, wallBefore, wallAfter: wallBefore, cells: [] };
  for (let i = 0; i < OBSERVED_TICKS; i++) {
    const seen = readAtDecisionAndAfter(
      () => {
        if (i === 0) engine.attemptPlayerMove('E');
        engine.tick();
      },
      () => wall(engine)
    );
    const p = engine.getPlayer();
    trace.cells.push(`${p.x},${p.y}`);
    if (trace.firstDecisionTick < 0 && seen.decision !== undefined && seen.decision !== wallBefore) trace.firstDecisionTick = engine.getTick();
    if (trace.firstEndTick < 0 && seen.after !== wallBefore) {
      trace.firstEndTick = engine.getTick();
      trace.wallAfter = seen.after;
    }
  }
  return trace;
}

/** Lexy lane lswitch_ply: the wall is open at the end of the tick the input is played in, and seen open at the decisions of the next one. */
const EXPECTED: Trace = {
  firstDecisionTick: 6,
  firstEndTick: 5,
  wallBefore: PURPLE_WALL,
  wallAfter: PURPLE_FLOOR,
  cells: Array.from({ length: OBSERVED_TICKS }, () => '4,5')
};

describe('CC2 engine: the wire settle before the actor pass does not read a light switch flipped at a step end', () => {
  it('opens the wired wall at the end of the input tick, and at the decisions of the tick after, not a tick early', () => {
    expect(observe(load(), false)).toEqual(EXPECTED);
  });

  it('gives the same ticks when the input is undone and given again', () => {
    expect(observe(load(), true)).toEqual(EXPECTED);
  });
});
