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
  AudioManager: { playSfx: vi.fn(), playStep: vi.fn() }
}));

import { CclpEngine } from '../core/cclp/CclpEngine';
import { createTwsPlayer, TwsReplayPlayer } from '../core/cclp/twsReplay';
import { lynxLevel } from '../core/lynx/lynxTestMaps';
import type { CompiledLevel } from '../core/types';
import { parseTwsIndex, TwsLimits } from '../formats/TwsCodec';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { oneByteMove, twsFileBytes, twsSolutionRecord } from '../test/twsTestBytes';
import { GAMEPAD_BUTTONS } from './uiConstants';
import { heldSetForTick, singlePadDirection } from './padDirections';
import { TwsRun } from './twsRun';

beforeAll(() => {
  loadTestConfigs();
});

const LIMITS: TwsLimits & { graceTicks: number } = { maxFileBytes: 4096, maxSolutionTicks: 100000, maxSetNameChars: 64, graceTicks: 20 };
const SILENT = { effect: () => undefined, step: () => undefined };

function player(): TwsReplayPlayer {
  const index = parseTwsIndex(twsFileBytes(1, [twsSolutionRecord({ number: 1, password: 'TEST', moves: new Array<number>(16).fill(oneByteMove(3, 0)) })]), LIMITS);
  const entry = index.entries.get(1);
  if (!entry) throw new Error('entry');
  return createTwsPlayer(index, entry, LIMITS);
}

describe('TwsRun', () => {
  it('is an ordinary run until a Tile World replay begins', () => {
    const run = new TwsRun();
    expect(run.player()).toBeNull();
    expect(run.replayActive(false)).toBe(false);
    expect(run.seeded()).toBe(false);
    expect(run.walkAidsAllowed()).toBe(true);
    expect(run.mayRecordWin(false, false)).toBe(true);
    expect(run.totalScoreToCarry()).toBeNull();
  });

  it('counts a Tile World replay as a replay, like the stored solution one', () => {
    const run = new TwsRun();
    expect(run.replayActive(true)).toBe(true);
    run.begin(player(), 120);
    expect(run.replayActive(false)).toBe(true);
    expect(run.replayActive(true)).toBe(true);
  });

  it('holds no keys, no pad direction and no board tap steering while a Tile World replay plays', () => {
    const run = new TwsRun();
    const pad = { axes: [0, 0], buttons: Array.from({ length: 16 }, (_unused, i) => ({ pressed: i === GAMEPAD_BUTTONS.DPAD_UP })) };
    const config = { stickPressThreshold: 0.5, stickReleaseThreshold: 0.3 };
    // Before the replay the same inputs steer.
    expect(heldSetForTick(['N'], 'S', ['E'], run.replayActive(false))).toEqual(['N']);
    expect(singlePadDirection(pad, config, run.replayActive(false))).toBe('N');
    run.begin(player(), 0);
    expect(heldSetForTick(['N'], 'S', ['E'], run.replayActive(false))).toEqual([]);
    expect(heldSetForTick([], 'S', [], run.replayActive(false))).toEqual([]);
    expect(heldSetForTick([], null, ['E', 'S'], run.replayActive(false))).toEqual([]);
    expect(singlePadDirection(pad, config, run.replayActive(false))).toBeNull();
    // A tap on the board takes the game back, and tapped walks stay off for the seeded run.
    expect(run.replayActive(false)).toBe(true);
    expect(run.walkAidsAllowed()).toBe(false);
  });

  it('keeps the run seeded after the player takes over, and still keeps it off the records', () => {
    const run = new TwsRun();
    run.begin(player(), 50);
    run.stopReplay();
    expect(run.player()).toBeNull();
    expect(run.replayActive(false)).toBe(false);
    expect(run.seeded()).toBe(true);
    expect(run.walkAidsAllowed()).toBe(false);
    expect(run.mayRecordWin(false, false)).toBe(false);
    expect(run.totalScoreToCarry()).toBe(50);
  });

  it('becomes an ordinary run again after a plain load (restart, other level)', () => {
    const run = new TwsRun();
    run.begin(player(), 50);
    run.clear();
    expect(run.seeded()).toBe(false);
    expect(run.walkAidsAllowed()).toBe(true);
    expect(run.mayRecordWin(false, false)).toBe(true);
    expect(run.totalScoreToCarry()).toBeNull();
  });

  it('keeps the mark through an undo, which only stops the replay', () => {
    const run = new TwsRun();
    run.begin(player(), 50);
    run.stopReplay();
    run.stopReplay();
    expect(run.seeded()).toBe(true);
  });

  it('never records a win of a replay or a test play, seeded or not', () => {
    const run = new TwsRun();
    expect(run.mayRecordWin(true, false)).toBe(false);
    expect(run.mayRecordWin(false, true)).toBe(false);
  });
});

describe('the total score of a Tile World run', () => {
  it('is put back to what it was when the run started, so a win of the replay does not raise it', () => {
    const level: CompiledLevel = { ...lynxLevel(['######', '#@..X#', '######'], { number: 3 }), rulesProfile: 'cclp' };
    const engine = new CclpEngine(SILENT);
    engine.carryTotalScore(70);
    const run = new TwsRun();
    const tws = player();
    tws.load(engine, level);
    run.begin(tws, engine.getTotalScore());
    expect(run.totalScoreToCarry()).toBe(70);
    while (!engine.isLevelCompleted() && !tws.isOver(engine.getTick())) {
      tws.beforeTick(engine);
      engine.tick();
    }
    expect(engine.isLevelCompleted()).toBe(true);
    // The win added the level score to the total; the page puts the total back, as its win callback does.
    expect(engine.getTotalScore()).toBeGreaterThan(70);
    const carried = run.totalScoreToCarry();
    if (carried !== null) engine.carryTotalScore(carried);
    expect(engine.getTotalScore()).toBe(70);
  });

  it('is read after the load: a level loaded again starts from the total it had at its start', () => {
    const level: CompiledLevel = { ...lynxLevel(['######', '#@..X#', '######'], { number: 3 }), rulesProfile: 'cclp' };
    const engine = new CclpEngine(SILENT);
    engine.loadLevel(level);
    engine.carryTotalScore(40);
    player().load(engine, level);
    expect(engine.getTotalScore()).toBe(40);
  });
});
