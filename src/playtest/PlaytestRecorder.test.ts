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

import { describe, expect, it } from 'vitest';
import type { PlaytestConfig } from '../core/types';
import { PlaytestLevelInfo, PlaytestRecorder } from './PlaytestRecorder';

const LIMITS: PlaytestConfig = {
  maxSessions: 3,
  maxTraceLength: 10,
  maxDeathsPerSession: 2,
  maxStoredBytes: 100000,
  noteMaxLength: 20,
  ratingMin: 1,
  ratingMax: 5
};

const VERSION = '9.9.9';

function level(id: string, packId = 'campaign'): PlaytestLevelInfo {
  return {
    packId,
    levelId: id,
    levelNumber: 1,
    ruleset: 'epoxy',
    assists: { hintAvailable: true, solutionAvailable: false, deadEndWatch: true }
  };
}

function recorder(): PlaytestRecorder {
  return new PlaytestRecorder(LIMITS, VERSION);
}

describe('PlaytestRecorder events', () => {
  it('starts a session with one attempt and the context of the level', () => {
    const rec = recorder();
    rec.beginLevel(level('a'), 1000);
    const left = rec.leave('level_change', 2000, 'NE');
    expect(left).toMatchObject({
      packId: 'campaign',
      levelId: 'a',
      ruleset: 'epoxy',
      appVersion: VERSION,
      attempts: 1,
      startedAt: 1000,
      endedAt: 2000,
      assists: { hintAvailable: true, solutionAvailable: false, deadEndWatch: true }
    });
  });

  it('counts restarts, undos, hints, solution views and dead-end triggers', () => {
    const rec = recorder();
    rec.beginLevel(level('a'), 0);
    rec.observeSteps(3);
    rec.restart(10, 'NNN');
    rec.undo();
    rec.hint();
    rec.hint();
    rec.deadEndTriggered();
    rec.solutionView();
    rec.replayStarted(20, 'E');
    const session = rec.leave('level_change', 30, 'ignored');
    expect(session).toMatchObject({
      attempts: 2,
      restarts: 1,
      undos: 1,
      hintUses: 2,
      deadEndTriggers: 1,
      solutionViews: 1
    });
  });

  it('records each death once, with cause and cell, until undo or restart', () => {
    const rec = recorder();
    rec.beginLevel(level('a'), 0);
    rec.death(5, { cause: 'hud.messages.death_water', x: 3, y: 4 });
    rec.death(6, { cause: 'hud.messages.death_water', x: 3, y: 4 });
    rec.undo();
    rec.death(7, { cause: 'hud.messages.death_fire', x: 1, y: 2 });
    rec.restart(8, 'N');
    rec.death(9, { cause: 'hud.messages.death_block', x: 0, y: 0 });
    const session = rec.leave('level_change', 10, '');
    expect(session?.deathCount).toBe(3);
    // The list is bounded; the count is not.
    expect(session?.deaths).toHaveLength(LIMITS.maxDeathsPerSession);
    expect(session?.deaths[0]).toMatchObject({ attempt: 1, cause: 'hud.messages.death_water', x: 3, y: 4 });
  });

  it('keeps the winning trace apart from the last one', () => {
    const rec = recorder();
    rec.beginLevel(level('a'), 0);
    rec.observeSteps(4);
    rec.restart(10, 'NNNN');
    rec.observeSteps(2);
    const won = rec.win(20, 'EE');
    expect(won?.outcome).toEqual({ kind: 'win', attempt: 2, moves: 2, activeMs: 0 });
    expect(won?.winTrace).toBe('EE');
    expect(won?.lastTrace).toBe('EE');
    expect(won?.totalMoves).toBe(6);
    expect(rec.hasOpenSession()).toBe(false);
  });

  it('keeps the last attempt trace of an unsolved level and no winning trace', () => {
    const rec = recorder();
    rec.beginLevel(level('a'), 0);
    rec.observeSteps(2);
    const left = rec.leave('tab_close', 5, 'NE');
    expect(left?.outcome).toEqual({ kind: 'leave', reason: 'tab_close' });
    expect(left?.winTrace).toBeNull();
    expect(left?.lastTrace).toBe('NE');
    expect(left?.totalMoves).toBe(2);
  });

  it('tells a pack change from a level change when the next level begins', () => {
    const rec = recorder();
    rec.beginLevel(level('a'), 0);
    const sameClose = rec.beginLevel(level('b'), 10);
    expect(sameClose?.outcome).toEqual({ kind: 'leave', reason: 'level_change' });
    const packClose = rec.beginLevel(level('c', 'other'), 20);
    expect(packClose?.outcome).toEqual({ kind: 'leave', reason: 'pack_change' });
  });

  it('does not record the moves or the win of a solution replay', () => {
    const rec = recorder();
    rec.beginLevel(level('a'), 0);
    rec.observeSteps(2);
    rec.solutionView();
    rec.replayStarted(5, 'NE');
    rec.observeSteps(40);
    expect(rec.win(9, 'SOLUTION')).toBeNull();
    rec.death(9, { cause: null, x: 0, y: 0 });
    const left = rec.leave('level_change', 10, 'SOLUTION');
    expect(left?.lastTrace).toBe('NE');
    expect(left?.totalMoves).toBe(2);
    expect(left?.deathCount).toBe(0);
  });

  it('records moves again once the level restarts after a solution view', () => {
    const rec = recorder();
    rec.beginLevel(level('a'), 0);
    rec.solutionView();
    rec.replayStarted(5, '');
    rec.restart(6, 'IGNORED');
    rec.observeSteps(1);
    expect(rec.win(7, 'N')?.winTrace).toBe('N');
  });

  it('leaves no session behind when only a replay was watched', () => {
    const rec = recorder();
    rec.beginLevel(level('a'), 0);
    rec.replayStarted(1, '');
    expect(rec.leave('level_change', 2, '')).toBeNull();
    expect(rec.getSessions()).toHaveLength(0);
    expect(rec.hasOpenSession()).toBe(false);
  });

  it('snapshots the series in progress without ending it', () => {
    const rec = recorder();
    rec.beginLevel(level('a'), 0);
    rec.setActive(true, 0);
    rec.observeSteps(2);
    const copy = rec.snapshot(400, 'NE');
    expect(copy).toMatchObject({ outcome: { kind: 'in_progress' }, activeMs: 400, totalMoves: 2, lastTrace: 'NE', endedAt: 400 });
    expect(rec.hasOpenSession()).toBe(true);
    const final = rec.leave('level_change', 500, 'NES');
    expect(final?.id).toBe(copy?.id);
    expect(final?.activeMs).toBe(500);
    expect(copy?.activeMs).toBe(400);
  });

  it('drops the oldest finished session on request', () => {
    const rec = recorder();
    for (const id of ['a', 'b']) {
      rec.beginLevel(level(id), 0);
      rec.leave('level_change', 1, '');
    }
    expect(rec.dropOldest()).toBe(true);
    expect(rec.getSessions().map((s) => s.levelId)).toEqual(['b']);
    rec.dropOldest();
    expect(rec.dropOldest()).toBe(false);
  });

  it('ignores every event without an open session', () => {
    const rec = recorder();
    rec.restart(0, 'N');
    rec.undo();
    rec.hint();
    rec.death(0, { cause: null, x: 0, y: 0 });
    expect(rec.win(0, 'N')).toBeNull();
    expect(rec.leave('tab_close', 0, null)).toBeNull();
    expect(rec.getSessions()).toHaveLength(0);
  });

  it('attaches a rating to a finished session only', () => {
    const rec = recorder();
    rec.beginLevel(level('a'), 0);
    const session = rec.leave('level_change', 1, '');
    const rating = { difficulty: 3, fun: 4, aha: true, note: 'ok' };
    expect(rec.attachRating(session!.id, rating)).toBe(true);
    expect(rec.getSessions()[0].rating).toEqual(rating);
    expect(rec.attachRating('missing', rating)).toBe(false);
  });
});

describe('PlaytestRecorder active time', () => {
  it('counts only the time the clock runs', () => {
    const rec = recorder();
    rec.beginLevel(level('a'), 0);
    rec.setActive(true, 100);
    rec.setActive(false, 400);
    rec.setActive(false, 900);
    rec.setActive(true, 1000);
    rec.setActive(true, 1100);
    const session = rec.leave('level_change', 1500, '');
    expect(session?.activeMs).toBe(300 + 500);
  });

  it('keeps the winning attempt time separate from the series time', () => {
    const rec = recorder();
    rec.beginLevel(level('a'), 0);
    rec.setActive(true, 0);
    rec.restart(1000, 'N');
    rec.observeSteps(1);
    const won = rec.win(1600, 'E');
    expect(won?.activeMs).toBe(1600);
    expect(won?.outcome).toMatchObject({ kind: 'win', activeMs: 600 });
  });

  it('stamps a death with the active time so far', () => {
    const rec = recorder();
    rec.beginLevel(level('a'), 0);
    rec.setActive(true, 0);
    rec.death(250, { cause: null, x: 1, y: 1 });
    expect(rec.leave('level_change', 300, '')?.deaths[0].atActiveMs).toBe(250);
  });

  it('never counts a negative step when the clock goes backwards', () => {
    const rec = recorder();
    rec.beginLevel(level('a'), 1000);
    rec.setActive(true, 1000);
    rec.setActive(false, 900);
    expect(rec.leave('level_change', 1000, '')?.activeMs).toBe(0);
  });
});

describe('PlaytestRecorder bounds', () => {
  it('drops the oldest sessions first', () => {
    const rec = recorder();
    for (let i = 0; i < LIMITS.maxSessions + 2; i += 1) {
      rec.beginLevel(level(`l${i}`), i);
      rec.leave('level_change', i, '');
    }
    expect(rec.getSessions().map((s) => s.levelId)).toEqual(['l2', 'l3', 'l4']);
  });

  it('keeps only the newest restored sessions', () => {
    const source = recorder();
    for (let i = 0; i < 3; i += 1) {
      source.beginLevel(level(`l${i}`), i);
      source.leave('level_change', i, '');
    }
    const restored = new PlaytestRecorder({ ...LIMITS, maxSessions: 2 }, VERSION, source.getSessions());
    expect(restored.getSessions().map((s) => s.levelId)).toEqual(['l1', 'l2']);
  });

  it('cuts a trace at the configured length and says so', () => {
    const rec = recorder();
    rec.beginLevel(level('a'), 0);
    const left = rec.leave('level_change', 1, 'N'.repeat(LIMITS.maxTraceLength + 5));
    expect(left?.lastTrace).toHaveLength(LIMITS.maxTraceLength);
    expect(left?.tracesTruncated).toBe(true);
  });

  it('does not flag a trace that fits', () => {
    const rec = recorder();
    rec.beginLevel(level('a'), 0);
    expect(rec.leave('level_change', 1, 'N'.repeat(LIMITS.maxTraceLength))?.tracesTruncated).toBe(false);
  });
});
