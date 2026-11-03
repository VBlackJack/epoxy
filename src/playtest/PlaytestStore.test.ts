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
import { PLAYTEST_FORMAT_ID, PLAYTEST_FORMAT_VERSION } from '../config/constants';
import type { PlaytestConfig } from '../core/types';
import { PlaytestRecorder, PlaytestSession } from './PlaytestRecorder';
import {
  buildPlaytestExport,
  playtestFileName,
  PlaytestStorage,
  PlaytestStore,
  sanitizeSession,
  sanitizeSessions
} from './PlaytestStore';

const LIMITS: PlaytestConfig = {
  maxSessions: 2,
  maxTraceLength: 8,
  maxDeathsPerSession: 2,
  noteMaxLength: 5,
  ratingMin: 1,
  ratingMax: 5
};
const KEYS = { enabledKey: 'on', sessionsKey: 'sessions' };

function sampleSession(id = 'x'): PlaytestSession {
  const rec = new PlaytestRecorder({ ...LIMITS, maxSessions: 10 }, '1.0.0');
  rec.beginLevel(
    {
      packId: 'campaign',
      levelId: id,
      levelNumber: 7,
      ruleset: 'epoxy',
      assists: { hintAvailable: true, solutionAvailable: true, deadEndWatch: false }
    },
    1000
  );
  rec.observeSteps(2);
  rec.death(1100, { cause: 'hud.messages.death_fire', x: 2, y: 3 });
  return rec.leave('level_change', 2000, 'NE')!;
}

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

const BLOCKED: PlaytestStorage = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
  removeItem: () => {
    throw new Error('blocked');
  }
};

describe('playtest export', () => {
  it('names its format and version and carries the sessions', () => {
    const sessions = [sampleSession('a'), sampleSession('b')];
    const file = buildPlaytestExport(sessions, '1.2.3', Date.UTC(2026, 10, 3, 14, 5, 9));
    expect(file.format).toBe(PLAYTEST_FORMAT_ID);
    expect(file.version).toBe(PLAYTEST_FORMAT_VERSION);
    expect(file.appVersion).toBe('1.2.3');
    expect(file.exportedAt).toBe('2026-11-03T14:05:09.000Z');
    expect(file.sessionCount).toBe(2);
    expect(file.sessions).toEqual(sessions);
  });

  it('round-trips through JSON without losing a field', () => {
    const sessions = [sampleSession('a')];
    const parsed = JSON.parse(JSON.stringify(buildPlaytestExport(sessions, '1', 0))) as { sessions: unknown };
    expect(sanitizeSessions(parsed.sessions, { ...LIMITS, maxSessions: 10 })).toEqual(sessions);
  });

  it('names the file after the export moment', () => {
    expect(playtestFileName(Date.UTC(2026, 10, 3, 14, 5, 9))).toBe('epoxy-playtest-20261103-140509.json');
  });
});

describe('playtest sanitizing', () => {
  it('rejects a session with a missing or mistyped field', () => {
    const good = JSON.parse(JSON.stringify(sampleSession())) as Record<string, unknown>;
    expect(sanitizeSession(good, LIMITS)).not.toBeNull();
    expect(sanitizeSession({ ...good, levelId: undefined }, LIMITS)).toBeNull();
    expect(sanitizeSession({ ...good, attempts: 'one' }, LIMITS)).toBeNull();
    expect(sanitizeSession({ ...good, activeMs: -1 }, LIMITS)).toBeNull();
    expect(sanitizeSession({ ...good, outcome: { kind: 'leave', reason: 'whim' } }, LIMITS)).toBeNull();
    expect(sanitizeSession({ ...good, assists: null }, LIMITS)).toBeNull();
    expect(sanitizeSession('nope', LIMITS)).toBeNull();
  });

  it('clips traces and notes and drops an out-of-scale rating', () => {
    const base = JSON.parse(JSON.stringify(sampleSession())) as Record<string, unknown>;
    const clean = sanitizeSession(
      {
        ...base,
        lastTrace: 'N'.repeat(40),
        rating: { difficulty: 9, fun: 3, aha: 'maybe', note: 'too long note' }
      },
      LIMITS
    );
    expect(clean?.lastTrace).toHaveLength(LIMITS.maxTraceLength);
    expect(clean?.rating).toEqual({ difficulty: null, fun: 3, aha: null, note: 'too l' });
  });

  it('keeps the newest sessions within the bound and skips unreadable ones', () => {
    const list = ['a', 'b', 'c'].map((id) => JSON.parse(JSON.stringify(sampleSession(id))) as unknown);
    const kept = sanitizeSessions([list[0], 42, list[1], list[2]], LIMITS);
    expect(kept.map((s) => s.levelId)).toEqual(['b', 'c']);
    expect(sanitizeSessions({ not: 'a list' }, LIMITS)).toEqual([]);
  });
});

describe('PlaytestStore', () => {
  it('is off by default and remembers the flag', () => {
    const storage = new MemoryStorage();
    const store = new PlaytestStore(storage, KEYS, LIMITS);
    expect(store.isEnabled()).toBe(false);
    store.setEnabled(true);
    expect(new PlaytestStore(storage, KEYS, LIMITS).isEnabled()).toBe(true);
    store.setEnabled(false);
    expect(store.isEnabled()).toBe(false);
  });

  it('saves, loads and clears the sessions', () => {
    const storage = new MemoryStorage();
    const store = new PlaytestStore(storage, KEYS, LIMITS);
    expect(store.saveSessions([sampleSession('a')])).toBe(true);
    expect(store.loadSessions().map((s) => s.levelId)).toEqual(['a']);
    store.clearSessions();
    expect(store.loadSessions()).toEqual([]);
  });

  it('reads corrupt data as empty', () => {
    const storage = new MemoryStorage();
    storage.setItem(KEYS.sessionsKey, '{not json');
    expect(new PlaytestStore(storage, KEYS, LIMITS).loadSessions()).toEqual([]);
  });

  it('survives blocked storage', () => {
    const store = new PlaytestStore(BLOCKED, KEYS, LIMITS);
    expect(store.isEnabled()).toBe(false);
    expect(store.loadSessions()).toEqual([]);
    expect(store.saveSessions([sampleSession()])).toBe(false);
    expect(() => {
      store.setEnabled(true);
      store.clearSessions();
    }).not.toThrow();
  });
});
