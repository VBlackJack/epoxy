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

vi.mock('../../audio/AudioManager', () => ({
  AudioManager: { playSfx: vi.fn(), playStep: vi.fn() }
}));

import { parseTwsIndex, TwsIndex, TwsLimits } from '../../formats/TwsCodec';
import { oneByteMove, twsFileBytes, twsSolutionRecord, TwsTestRecord } from '../../test/twsTestBytes';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { lynxLevel } from '../lynx/lynxTestMaps';
import { CompiledLevel } from '../types';
import { CclpEngine } from './CclpEngine';
import { countPlayableLevels, createTwsPlayer, isTwsLevel, isTwsLoadTarget, matchTwsRecord, twsVerdict } from './twsReplay';

beforeAll(() => {
  loadTestConfigs();
});

const LIMITS: TwsLimits & { graceTicks: number } = { maxFileBytes: 4096, maxSolutionTicks: 100000, maxSetNameChars: 64, graceTicks: 20 };
const SILENT = { effect: () => undefined, step: () => undefined };
/** The test map password (lynxTestMaps). */
const PASSWORD = 'TEST';
const EAST_NEXT_TICK = oneByteMove(3, 0);

function index(ruleset: number, records: TwsTestRecord[]): TwsIndex {
  return parseTwsIndex(twsFileBytes(ruleset, records), LIMITS);
}

function cclp(level: CompiledLevel): CompiledLevel {
  return { ...level, rulesProfile: 'cclp' };
}

describe('matchTwsRecord', () => {
  const level = cclp(lynxLevel(['###', '#@#', '###'], { number: 7 }));

  it('plays the record of the same number and password, whatever the case of the password', () => {
    expect(matchTwsRecord(index(1, [twsSolutionRecord({ number: 7, password: PASSWORD, moves: [] })]), level).kind).toBe('playable');
    expect(matchTwsRecord(index(1, [twsSolutionRecord({ number: 7, password: 'test', moves: [] })]), level).kind).toBe('playable');
  });

  it('says why nothing plays: other engine, MS file, no record, other password, password only, mouse moves', () => {
    const ok = twsSolutionRecord({ number: 7, password: PASSWORD, moves: [] });
    expect(matchTwsRecord(index(1, [ok]), lynxLevel(['###', '#@#', '###'], { number: 7 })).kind).toBe('not_cclp');
    expect(matchTwsRecord(index(2, [ok]), level).kind).toBe('ms_ruleset');
    expect(matchTwsRecord(index(1, [twsSolutionRecord({ number: 8, password: PASSWORD, moves: [] })]), level).kind).toBe('no_record');
    expect(matchTwsRecord(index(1, [twsSolutionRecord({ number: 7, password: 'ABCD', moves: [] })]), level).kind).toBe('password_mismatch');
    expect(matchTwsRecord(index(1, [{ passwordOnly: { number: 7, password: PASSWORD } }]), level).kind).toBe('no_solution');
    const mouse = twsSolutionRecord({ number: 7, password: PASSWORD, moves: [0x13 | (4 << 5), 24] });
    expect(matchTwsRecord(index(1, [mouse]), level).kind).toBe('mouse_moves');
  });

  it('counts the levels of a pack a file plays', () => {
    const levels = [1, 2, 3].map((number) => cclp(lynxLevel(['###', '#@#', '###'], { number })));
    const file = index(1, [
      twsSolutionRecord({ number: 1, password: PASSWORD, moves: [] }),
      twsSolutionRecord({ number: 2, password: 'ABCD', moves: [] }),
      twsSolutionRecord({ number: 3, password: PASSWORD, moves: [] })
    ]);
    expect(countPlayableLevels(file, levels)).toBe(2);
  });

  it('knows a CCLP engine level from any other', () => {
    expect(isTwsLevel(cclp(lynxLevel(['###', '#@#', '###'])))).toBe(true);
    expect(isTwsLevel(lynxLevel(['###', '#@#', '###']))).toBe(false);
  });
});

describe('TwsReplayPlayer', () => {
  function playerOf(records: TwsTestRecord[], number = 1): ReturnType<typeof createTwsPlayer> {
    const file = index(1, records);
    const entry = file.entries.get(number);
    if (!entry) throw new Error('entry');
    return createTwsPlayer(file, entry, LIMITS);
  }

  it('loads with the record stepping, raw force floor start and seed, then holds each move on its tick only', () => {
    const player = playerOf([twsSolutionRecord({ number: 1, state: (6 << 3) | 3, seed: 4242, moves: [0x41, 0x0d] })]);
    const calls: string[] = [];
    let tick = 0;
    const engine = {
      setReplayOptions: (o: unknown) => calls.push(`opts ${JSON.stringify(o)}`),
      loadLevel: (_l: unknown, seed: number) => calls.push(`load ${seed}`),
      holdPlayerDirections: (d: readonly string[]) => calls.push(`hold ${d.join('')}`),
      getTick: () => tick
    };
    player.load(engine, lynxLevel(['###', '#@#', '###']));
    for (tick = 0; tick < 5; tick++) player.beforeTick(engine);
    expect(calls).toEqual(['opts {"phaseOffset":6,"randomForceStart":"E"}', 'load 4242', 'hold ', 'hold ', 'hold N', 'hold E', 'hold ']);
  });

  it('is over once the last move plus the grace has passed', () => {
    const player = playerOf([twsSolutionRecord({ number: 1, moves: [0x41, 0x0d] })]);
    // The moves land on ticks 2 and 3, so the record ends at tick 4.
    expect(player.isOver(4 + LIMITS.graceTicks - 1)).toBe(false);
    expect(player.isOver(4 + LIMITS.graceTicks)).toBe(true);
  });

  it('counts the steps played: none at tick 0, all of them at the end tick', () => {
    const player = playerOf([twsSolutionRecord({ number: 1, moves: [0x41, 0x0d] })]);
    expect(player.progress(0)).toEqual({ step: 0, total: 2 });
    expect(player.progress(3)).toEqual({ step: 1, total: 2 });
    expect(player.progress(4)).toEqual({ step: 2, total: 2 });
  });

  it('holds the same keys on a tick asked again (the game is paused)', () => {
    const player = playerOf([twsSolutionRecord({ number: 1, moves: [0x41, 0x0d] })]);
    expect(player.directionsAt(3)).toEqual(['E']);
    expect(player.directionsAt(3)).toEqual(['E']);
    expect(player.directionsAt(3)).toEqual(['E']);
    expect(player.directionsAt(4)).toEqual([]);
  });

  it('walks Chip to the exit on the CCLP engine', () => {
    const wide = cclp(lynxLevel(['######', '#@..X#', '######']));
    const player = playerOf([twsSolutionRecord({ number: 1, password: PASSWORD, moves: new Array<number>(16).fill(EAST_NEXT_TICK) })]);
    const engine = new CclpEngine(SILENT);
    expect(isTwsLoadTarget(engine)).toBe(true);
    player.load(engine, wide);
    while (!engine.isLevelCompleted() && !player.isOver(engine.getTick())) {
      player.beforeTick(engine);
      engine.tick();
    }
    expect(engine.isLevelCompleted()).toBe(true);
  });
});

describe('twsVerdict', () => {
  const file = index(1, [twsSolutionRecord({ number: 1, moves: [0x41] })]);
  const entry = file.entries.get(1);
  if (!entry) throw new Error('entry');
  const player = createTwsPlayer(file, entry, LIMITS);

  it('runs while Chip is alive, before the end of the grace', () => {
    expect(twsVerdict(player, { tick: 5, alive: true, completed: false })).toBe('running');
  });

  it('ends at once on a death, with no grace for a dead Chip', () => {
    expect(twsVerdict(player, { tick: 5, alive: false, completed: false })).toBe('died');
  });

  it('ends at the end of the moves plus the grace', () => {
    expect(twsVerdict(player, { tick: entry.endTick + LIMITS.graceTicks, alive: true, completed: false })).toBe('over');
  });

  it('reports a win before anything else', () => {
    expect(twsVerdict(player, { tick: entry.endTick + LIMITS.graceTicks, alive: false, completed: true })).toBe('won');
  });
});
