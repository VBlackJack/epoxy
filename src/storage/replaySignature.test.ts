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
import {
  isReplayPlayable,
  replaySignature,
  shouldReplaceReplay,
  UNKNOWN_REPLAY_SIGNATURE,
  type SignatureLevel
} from './replaySignature';
import { sanitizeHighScores } from './persistedState';
import { CC_RULES_VERSION } from '../config/constants';

const NATIVE: SignatureLevel = {};
const CC_FLAVOR: SignatureLevel = { rulesFlavor: 'cc' };
const CC2_IMPORT = { cc2: {} } as unknown as SignatureLevel;
const LYNX: SignatureLevel = { ruleset: 'lynx' };
const CC3D: SignatureLevel = { ruleset: 'cc3d' };

describe('replaySignature', () => {
  it('names the engine and rules version of each kind of level', () => {
    expect(replaySignature(NATIVE)).toBe('epoxy:1');
    expect(replaySignature({ ruleset: 'epoxy' })).toBe('epoxy:1');
    expect(replaySignature(CC_FLAVOR)).toBe(`epoxy-cc:${CC_RULES_VERSION}`);
    expect(replaySignature(CC2_IMPORT)).toBe(`epoxy-cc:${CC_RULES_VERSION}`);
    expect(replaySignature(LYNX)).toBe('lynx:1');
    expect(replaySignature(CC3D)).toBe('cc3d:1');
  });
});

describe('isReplayPlayable', () => {
  it('plays a replay recorded on the same signature', () => {
    for (const level of [NATIVE, CC_FLAVOR, LYNX, CC3D]) {
      expect(isReplayPlayable(level, replaySignature(level))).toBe(true);
    }
  });

  it('refuses a replay recorded on another engine', () => {
    expect(isReplayPlayable(NATIVE, replaySignature(LYNX))).toBe(false);
    expect(isReplayPlayable(NATIVE, replaySignature(CC_FLAVOR))).toBe(false);
    expect(isReplayPlayable(CC_FLAVOR, replaySignature(CC3D))).toBe(false);
  });

  it('plays a legacy record without signature only on a native Epoxy level', () => {
    expect(isReplayPlayable(NATIVE, undefined)).toBe(true);
    expect(isReplayPlayable(CC_FLAVOR, undefined)).toBe(false);
    expect(isReplayPlayable(CC2_IMPORT, undefined)).toBe(false);
    expect(isReplayPlayable(LYNX, undefined)).toBe(false);
    expect(isReplayPlayable(CC3D, undefined)).toBe(false);
  });

  it('refuses a replay when the rules version was bumped', async () => {
    const stored = replaySignature(CC_FLAVOR);
    vi.resetModules();
    vi.doMock('../config/constants', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../config/constants')>()),
      CC_RULES_VERSION: CC_RULES_VERSION + 1
    }));
    const bumped = await import('./replaySignature');
    expect(bumped.replaySignature(CC_FLAVOR)).toBe(`epoxy-cc:${CC_RULES_VERSION + 1}`);
    expect(bumped.isReplayPlayable(CC_FLAVOR, stored)).toBe(false);
    expect(bumped.isReplayPlayable(NATIVE, bumped.replaySignature(NATIVE))).toBe(true);
    vi.doUnmock('../config/constants');
    vi.resetModules();
  });
});

describe('stored signature and kept scores', () => {
  const GOOD = { bestTimeRemaining: 50, minSteps: 12, bestScore: 900 };

  it('keeps the signature, the replay and the scores of a record', () => {
    const replay = [{ tick: 1, dir: 'N' }];
    const table = sanitizeHighScores({ a: { ...GOOD, replayTimedMoves: replay, replaySignature: 'lynx:1' } });
    expect(table.a.replaySignature).toBe('lynx:1');
    expect(table.a.bestScore).toBe(900);
    expect(table.a.replayTimedMoves?.length).toBe(1);
  });

  it('a mismatching signature hides the replay but keeps the score and the replay data', () => {
    const table = sanitizeHighScores({
      a: { ...GOOD, replayTimedMoves: [{ tick: 1, dir: 'N' }], replaySignature: 'lynx:1' }
    });
    expect(isReplayPlayable(NATIVE, table.a.replaySignature)).toBe(false);
    expect(table.a.minSteps).toBe(12);
    expect(table.a.replayTimedMoves?.length).toBe(1);
  });

  it('keeps a malformed signature refused, never legacy', () => {
    const table = sanitizeHighScores({
      a: { ...GOOD, replaySignature: 5 },
      b: { ...GOOD, replaySignature: '' },
      c: { ...GOOD }
    });
    expect(table.a.replaySignature).toBe(UNKNOWN_REPLAY_SIGNATURE);
    expect(table.b.replaySignature).toBe(UNKNOWN_REPLAY_SIGNATURE);
    expect(isReplayPlayable(NATIVE, table.a.replaySignature)).toBe(false);
    expect(isReplayPlayable(NATIVE, table.b.replaySignature)).toBe(false);
    expect(table.c.replaySignature).toBeUndefined();
    expect(isReplayPlayable(NATIVE, table.c.replaySignature)).toBe(true);
  });
});

describe('shouldReplaceReplay', () => {
  const replay = [{ tick: 1, dir: 'N' }];

  it('replaces on a first win and on a better run', () => {
    expect(shouldReplaceReplay(NATIVE, undefined, false)).toBe(true);
    expect(shouldReplaceReplay(NATIVE, { replayTimedMoves: replay, replaySignature: 'epoxy:1' }, true)).toBe(true);
  });

  it('keeps a playable replay on a worse run, legacy native one included', () => {
    expect(shouldReplaceReplay(NATIVE, { replayTimedMoves: replay, replaySignature: 'epoxy:1' }, false)).toBe(false);
    expect(shouldReplaceReplay(NATIVE, { replayTimedMoves: replay }, false)).toBe(false);
  });

  it('replaces an unplayable replay even on a worse run', () => {
    expect(shouldReplaceReplay(NATIVE, { replayTimedMoves: replay, replaySignature: 'lynx:1' }, false)).toBe(true);
    expect(shouldReplaceReplay(CC_FLAVOR, { replayTimedMoves: replay }, false)).toBe(true);
    expect(
      shouldReplaceReplay(NATIVE, { replayTimedMoves: replay, replaySignature: UNKNOWN_REPLAY_SIGNATURE }, false)
    ).toBe(true);
    expect(shouldReplaceReplay(NATIVE, { replayTimedMoves: [] }, false)).toBe(true);
  });
});
