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
 * On an engine that reads one key, the pad does not steer while a replay plays: the replay ends where it ends with no pad
 * at all. The harness follows pollGamepad (src/main.ts): the pad is read through singlePadDirection with the replay flag.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../audio/AudioManager', () => import('../test/silentAudio'));

import { GameEngine } from '../core/GameEngine';
import type { PlayEngine } from '../core/PlayEngine';
import type { Direction, TimedMove } from '../core/types';
import { room } from '../test/cc2Room';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { gamepadConfigFrom, PadSnapshot, singlePadDirection } from './padDirections';
import { applyTimedMove, collectDueMoves } from './replaySchedule';

beforeAll(() => {
  loadTestConfigs();
});

const TICKS = 40;
const BUTTON_COUNT = 17;
const CONFIG = gamepadConfigFrom(undefined);

function padPushing(axes: [number, number]): PadSnapshot {
  return { axes, buttons: Array.from({ length: BUTTON_COUNT }, () => ({ pressed: false })) };
}

const NO_PAD = padPushing([0, 0]);
const PAD_SOUTH = padPushing([0, 1]);
const PAD_EAST = padPushing([1, 0]);

function fresh(): GameEngine {
  const e = new GameEngine();
  e.loadLevel(room({ mode: 'native', startX: 3 }));
  return e;
}

function endState(engine: PlayEngine): unknown {
  const p = engine.getPlayer();
  return { at: [p.x, p.y, p.dir], alive: p.alive, tick: engine.getTick() };
}

/** pollGamepad on a single-key engine: the direction the pad reads, sent as a move (the page's steerWithGamepad). */
function poll(engine: PlayEngine, pad: PadSnapshot, replaying: boolean, attempts: Direction[]): void {
  const direction = singlePadDirection(pad, CONFIG, replaying);
  if (direction !== null) {
    attempts.push(direction);
    engine.attemptPlayerMove(direction);
  }
}

function playReplay(engine: PlayEngine, moves: readonly TimedMove[], pad: PadSnapshot, attempts: Direction[]): void {
  let index = 0;
  for (let t = 0; t < TICKS; t++) {
    poll(engine, pad, true, attempts);
    const { due, nextIndex } = collectDueMoves(moves, index, engine.getTick());
    for (const move of due) applyTimedMove(engine, move);
    index = nextIndex;
    engine.tick();
  }
}

function recordedMoves(): TimedMove[] {
  const engine = fresh();
  for (let t = 0; t < TICKS; t++) {
    if (t === 2 || t === 12) engine.attemptPlayerMove('E');
    engine.tick();
  }
  const moves = engine.getTimedMoveHistory();
  expect(moves.length).toBeGreaterThan(0);
  return [...moves];
}

describe('the pad on a single-key engine', () => {
  it('while a replay plays, no pad direction is read and no move is attempted', () => {
    expect(singlePadDirection(PAD_SOUTH, CONFIG, true)).toBeNull();
    const attempts: Direction[] = [];
    playReplay(fresh(), recordedMoves(), PAD_SOUTH, attempts);
    expect(attempts).toEqual([]);
  });

  it('a replay with the pad pushed ends in the state of a replay with no pad input', () => {
    const moves = recordedMoves();
    const bare = fresh();
    playReplay(bare, moves, NO_PAD, []);
    for (const pad of [PAD_SOUTH, PAD_EAST]) {
      const padded = fresh();
      playReplay(padded, moves, pad, []);
      expect(endState(padded)).toEqual(endState(bare));
      expect(padded.getTimedMoveHistory()).toEqual(bare.getTimedMoveHistory());
    }
  });

  it('outside a replay the reading is unchanged', () => {
    expect(singlePadDirection(PAD_SOUTH, CONFIG)).toBe('S');
    expect(singlePadDirection(PAD_SOUTH, CONFIG, false)).toBe('S');
    expect(singlePadDirection(PAD_EAST, CONFIG, false)).toBe('E');
    expect(singlePadDirection(NO_PAD, CONFIG, false)).toBeNull();
    const attempts: Direction[] = [];
    poll(fresh(), PAD_SOUTH, false, attempts);
    expect(attempts).toEqual(['S']);
  });
});
