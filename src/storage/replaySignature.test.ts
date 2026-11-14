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
import { CC2_RULES_VERSION, CC3D_PACE_VERSION, CC_RULES_VERSION } from '../config/constants';

const NATIVE: SignatureLevel = {};
const CC_FLAVOR: SignatureLevel = { rulesFlavor: 'cc' };
const CC2_IMPORT = { cc2: {} } as unknown as SignatureLevel;
const LYNX: SignatureLevel = { ruleset: 'lynx' };
const CC3D: SignatureLevel = { ruleset: 'cc3d' };
const CONVERTED_BY_ID: SignatureLevel = { id: 'cc3d_p1_001~epoxy' };
const CONVERTED_BY_SOURCE = { id: 'renamed', cc3dSource: {} } as unknown as SignatureLevel;
const CONVERTED_CLASSIC: SignatureLevel = { id: 'cc3d_p1_001~epoxy', rulesFlavor: 'cc' };

describe('replaySignature', () => {
  it('names the engine and rules version of each kind of level', () => {
    expect(replaySignature(NATIVE)).toBe('epoxy:1');
    expect(replaySignature({ ruleset: 'epoxy' })).toBe('epoxy:1');
    expect(replaySignature(CC_FLAVOR)).toBe(`epoxy-cc:${CC_RULES_VERSION}`);
    expect(replaySignature(CC2_IMPORT)).toBe(`epoxy-cc2:${CC2_RULES_VERSION}`);
    expect(replaySignature(LYNX)).toBe('lynx:1');
    expect(replaySignature(CC3D)).toBe('cc3d:1');
  });

  it('signs a CC3D level converted to Epoxy with the pace version, found by its id or its CC3D source', () => {
    expect(replaySignature(CONVERTED_BY_ID)).toBe(`epoxy-3d:${CC3D_PACE_VERSION}`);
    expect(replaySignature(CONVERTED_BY_SOURCE)).toBe(`epoxy-3d:${CC3D_PACE_VERSION}`);
  });

  it('keeps the classic signature on a converted level of the classic rules, and the native one on a native id', () => {
    expect(replaySignature(CONVERTED_CLASSIC)).toBe(`epoxy-cc:${CC_RULES_VERSION}`);
    expect(replaySignature({ id: 'custom_level' })).toBe('epoxy:1');
  });
});

describe('isReplayPlayable', () => {
  it('plays a replay recorded on the same signature', () => {
    for (const level of [NATIVE, CC_FLAVOR, LYNX, CC3D]) {
      expect(isReplayPlayable(level, replaySignature(level))).toBe(true);
    }
  });

  it('stops playing the replay of a converted level recorded before the pace, scores kept apart', () => {
    expect(isReplayPlayable(CONVERTED_BY_ID, 'epoxy:1')).toBe(false);
    expect(isReplayPlayable(CONVERTED_BY_ID, undefined)).toBe(false);
    expect(isReplayPlayable(CONVERTED_BY_ID, replaySignature(CONVERTED_BY_ID))).toBe(true);
    expect(isReplayPlayable(NATIVE, replaySignature(CONVERTED_BY_ID))).toBe(false);
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

describe('CC2-engine signature', () => {
  it('splits a CC2-engine level from the classic DAT signature', () => {
    expect(replaySignature(CC2_IMPORT)).not.toBe(replaySignature(CC_FLAVOR));
    expect(replaySignature({ rulesFlavor: 'cc', cc2: {} } as unknown as SignatureLevel)).toBe(`epoxy-cc2:${CC2_RULES_VERSION}`);
  });

  it('no longer plays an epoxy-cc replay on a CC2 level, and still plays it on a DAT level', () => {
    const stored = `epoxy-cc:${CC_RULES_VERSION}`;
    expect(isReplayPlayable(CC2_IMPORT, stored)).toBe(false);
    expect(isReplayPlayable(CC_FLAVOR, stored)).toBe(true);
  });

  it('plays an epoxy-cc2 replay on a CC2 level only', () => {
    const stored = replaySignature(CC2_IMPORT);
    expect(isReplayPlayable(CC2_IMPORT, stored)).toBe(true);
    expect(isReplayPlayable(CC_FLAVOR, stored)).toBe(false);
    expect(isReplayPlayable(NATIVE, stored)).toBe(false);
  });

  it('signs a CC2 import with the wave 9 rules version', () => {
    expect(CC2_RULES_VERSION).toBe(6);
  });

  it('a CC2 rules bump drops the CC2 replays and keeps the DAT ones', async () => {
    const storedCc2 = replaySignature(CC2_IMPORT);
    const storedDat = replaySignature(CC_FLAVOR);
    vi.resetModules();
    vi.doMock('../config/constants', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../config/constants')>()),
      CC2_RULES_VERSION: CC2_RULES_VERSION + 1
    }));
    const bumped = await import('./replaySignature');
    expect(bumped.isReplayPlayable(CC2_IMPORT, storedCc2)).toBe(false);
    expect(bumped.isReplayPlayable(CC_FLAVOR, storedDat)).toBe(true);
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
