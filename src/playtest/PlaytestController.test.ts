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

import { describe, expect, it, vi } from 'vitest';
import type { CompiledLevel, PlayerState, PlaytestConfig, TimedMove } from '../core/types';
import {
  assistsFor,
  compactTrace,
  PlaytestController,
  PlaytestEngineView,
  PlaytestRatingContext
} from './PlaytestController';
import type { PlaytestRating } from './PlaytestRecorder';
import { PlaytestStorage, PlaytestStore } from './PlaytestStore';

const LIMITS: PlaytestConfig = {
  maxSessions: 10,
  maxTraceLength: 50,
  maxDeathsPerSession: 5,
  noteMaxLength: 20,
  ratingMin: 1,
  ratingMax: 5
};
const PLAYING = { playing: true, replaying: false };

class MemoryStorage implements PlaytestStorage {
  public data = new Map<string, string>();
  public getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  public setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
  public removeItem(key: string): void {
    this.data.delete(key);
  }
}

function makeLevel(id: string): CompiledLevel {
  return { id, number: 3, solution: 'NE' } as unknown as CompiledLevel;
}

class FakeEngine implements PlaytestEngineView {
  public moves: TimedMove[] = [];
  public paused = false;
  public completed = false;
  public player = { x: 1, y: 2, alive: true, deathReasonKey: null as string | null };
  public constructor(public level: CompiledLevel) {}
  public getTimedMoveHistory(): TimedMove[] {
    return this.moves;
  }
  public getStepsCount(): number {
    return this.moves.length;
  }
  public getPlayer(): PlayerState {
    return this.player as unknown as PlayerState;
  }
  public isPaused(): boolean {
    return this.paused;
  }
  public isLevelCompleted(): boolean {
    return this.completed;
  }
  public getLevel(): CompiledLevel {
    return this.level;
  }
  public move(dir: TimedMove['dir']): void {
    this.moves.push({ tick: this.moves.length, dir });
  }
}

function setup(enabled = true) {
  const storage = new MemoryStorage();
  const keys = { enabledKey: 'on', sessionsKey: 'sessions' };
  const store = new PlaytestStore(storage, keys, LIMITS);
  if (enabled) store.setEnabled(true);
  const engine = new FakeEngine(makeLevel('a'));
  const clock = { now: 0 };
  const visible = { value: true };
  const asked: PlaytestRatingContext[] = [];
  const rating: { answer: PlaytestRating | null } = { answer: null };
  const onChange = vi.fn();
  const make = (): PlaytestController =>
    new PlaytestController({
      engine: () => engine,
      store,
      config: LIMITS,
      appVersion: '1.0.0',
      now: () => clock.now,
      isPageVisible: () => visible.value,
      askRating: (context) => {
        asked.push(context);
        return Promise.resolve(rating.answer);
      },
      onChange
    });
  return { controller: make(), make, engine, clock, visible, asked, rating, store, onChange };
}

describe('compactTrace', () => {
  it('writes one letter per move and an item drop in brackets', () => {
    expect(
      compactTrace([
        { tick: 0, dir: 'N' },
        { tick: 1, dir: 'E', drop: 'key_red' },
        { tick: 2, dir: 'S' }
      ])
    ).toBe('N[key_red]S');
  });
});

describe('assistsFor', () => {
  it('reports the aids of the ruleset and whether a solution is stored', () => {
    expect(assistsFor({ ...makeLevel('a') })).toEqual({
      hintAvailable: true,
      solutionAvailable: true,
      deadEndWatch: true
    });
    expect(assistsFor({ ...makeLevel('a'), solution: undefined, ruleset: 'lynx' })).toEqual({
      hintAvailable: false,
      solutionAvailable: false,
      deadEndWatch: false
    });
  });
});

describe('PlaytestController', () => {
  it('records nothing while Playtest mode is off', () => {
    const t = setup(false);
    t.controller.levelStarted('campaign');
    t.controller.restarted();
    t.controller.hintUsed();
    t.controller.won();
    expect(t.controller.sessionCount()).toBe(0);
    expect(t.store.loadSessions()).toEqual([]);
  });

  it('records a won level with its trace and asks for a rating', async () => {
    const t = setup();
    t.rating.answer = { difficulty: 2, fun: 4, aha: false, note: 'nice' };
    t.controller.levelStarted('campaign');
    t.engine.move('N');
    t.engine.move('E');
    t.engine.completed = true;
    t.controller.won();
    await Promise.resolve();
    await Promise.resolve();
    const [session] = t.store.loadSessions();
    expect(session.outcome).toMatchObject({ kind: 'win', moves: 2 });
    expect(session.winTrace).toBe('NE');
    expect(session.rating).toEqual(t.rating.answer);
    expect(t.asked).toEqual([{ levelNumber: 3, won: true }]);
  });

  it('keeps the data when the rating is skipped', async () => {
    const t = setup();
    t.controller.levelStarted('campaign');
    t.engine.move('N');
    t.controller.won();
    await Promise.resolve();
    await Promise.resolve();
    expect(t.store.loadSessions()[0].rating).toBeNull();
  });

  it('asks for a rating when leaving an unsolved level after a move, not before', () => {
    const t = setup();
    t.controller.levelStarted('campaign');
    t.controller.levelLeaving('campaign');
    expect(t.asked).toHaveLength(0);

    t.controller.levelStarted('campaign');
    t.engine.move('S');
    t.controller.levelLeaving('campaign');
    expect(t.asked).toEqual([{ levelNumber: 3, won: false }]);
    expect(t.store.loadSessions()[1].outcome).toEqual({ kind: 'leave', reason: 'level_change' });
  });

  it('reports a pack change as such', () => {
    const t = setup();
    t.controller.levelStarted('campaign');
    t.controller.levelLeaving('other');
    expect(t.store.loadSessions()[0].outcome).toEqual({ kind: 'leave', reason: 'pack_change' });
  });

  it('records the cause and cell of a death once', () => {
    const t = setup();
    t.controller.levelStarted('campaign');
    t.engine.player.alive = false;
    t.engine.player.deathReasonKey = 'hud.messages.death_water';
    t.controller.tick(PLAYING);
    t.controller.tick(PLAYING);
    t.controller.pageHiding();
    const [session] = t.store.loadSessions();
    expect(session.deaths).toEqual([
      { attempt: 1, cause: 'hud.messages.death_water', x: 1, y: 2, atActiveMs: 0 }
    ]);
    expect(session.outcome).toEqual({ kind: 'leave', reason: 'tab_close' });
  });

  it('counts a restart with the trace of the attempt it ends', () => {
    const t = setup();
    t.controller.levelStarted('campaign');
    t.engine.move('N');
    t.controller.restarted();
    t.engine.moves = [];
    t.controller.pageHiding();
    const [session] = t.store.loadSessions();
    expect(session).toMatchObject({ attempts: 2, restarts: 1, totalMoves: 1 });
  });

  it('runs the clock only while the tester really plays', () => {
    const t = setup();
    t.controller.levelStarted('campaign');
    t.controller.tick(PLAYING);
    t.clock.now = 1000;
    t.controller.tick({ playing: false, replaying: false });
    t.clock.now = 2000;
    t.controller.tick(PLAYING);
    t.clock.now = 2500;
    t.engine.paused = true;
    t.controller.tick(PLAYING);
    t.clock.now = 3500;
    t.engine.paused = false;
    t.controller.tick(PLAYING);
    t.clock.now = 3600;
    t.visible.value = false;
    t.controller.visibilityChanged();
    t.clock.now = 5000;
    t.controller.pageHiding();
    expect(t.store.loadSessions()[0].activeMs).toBe(1000 + 500 + 100);
  });

  it('closes the series when another level is loaded behind its back', () => {
    const t = setup();
    t.controller.levelStarted('campaign');
    t.engine.level = makeLevel('test-play');
    t.controller.tick(PLAYING);
    expect(t.controller.sessionCount()).toBe(1);
    t.controller.restarted();
    expect(t.controller.sessionCount()).toBe(1);
  });

  it('exports what was recorded and clears it on request', () => {
    const t = setup();
    expect(t.controller.buildExport()).toBeNull();
    t.controller.levelStarted('campaign');
    t.controller.pageHiding();
    expect(t.controller.buildExport()?.sessionCount).toBe(1);
    t.controller.clearData();
    expect(t.controller.sessionCount()).toBe(0);
    expect(t.store.loadSessions()).toEqual([]);
  });

  it('restores its sessions and its flag after a reload', () => {
    const t = setup();
    t.controller.levelStarted('campaign');
    t.controller.pageHiding();
    const reloaded = t.make();
    expect(reloaded.isEnabled()).toBe(true);
    expect(reloaded.sessionCount()).toBe(1);
  });

  it('turning the mode off ends the series without a form', () => {
    const t = setup();
    t.controller.levelStarted('campaign');
    t.engine.move('N');
    t.controller.setEnabled(false);
    expect(t.asked).toHaveLength(0);
    expect(t.controller.sessionCount()).toBe(1);
    expect(t.store.isEnabled()).toBe(false);
  });
});
