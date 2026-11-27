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
import { matchTwsRecord, TwsMatch } from '../core/cclp/twsReplay';
import { lynxLevel } from '../core/lynx/lynxTestMaps';
import type { CompiledLevel } from '../core/types';
import { parseTwsIndex, TwsErrorCode, TwsIndex, TwsLimits } from '../formats/TwsCodec';
import { formatMessage, resolveMessage, TranslationNode } from '../i18n/messageFormat';
import enLocale from '../locales/en.json';
import frLocale from '../locales/fr.json';
import type { TwsFileState } from '../storage/TwsFiles';
import { twsFileBytes, twsSolutionRecord } from '../test/twsTestBytes';
import {
  mayRecordWin,
  solutionControlState,
  twsErrorKey,
  twsLoadOutcome,
  twsMatchMessageKey,
  twsMessageKeys,
  twsParseRefusal,
  twsSizeRefusal
} from './twsSolution';

const LIMITS: TwsLimits = { maxFileBytes: 4096, maxSolutionTicks: 100000, maxSetNameChars: 64 };
const PASSWORD = 'TEST';

function level(number: number): CompiledLevel {
  return { ...lynxLevel(['###', '#@#', '###'], { number }), rulesProfile: 'cclp' };
}

function indexOf(ruleset: number, numbers: number[], password = PASSWORD): TwsIndex {
  return parseTwsIndex(twsFileBytes(ruleset, numbers.map((number) => twsSolutionRecord({ number, password, moves: [] }))), LIMITS);
}

function ready(index: TwsIndex): TwsFileState {
  return { kind: 'ready', fileName: 'mine.tws', index, persisted: true };
}

describe('solutionControlState', () => {
  const lvl = level(1);

  it('keeps today\'s stored solution control on a level the CCLP engine does not play', () => {
    expect(solutionControlState({ tws: false, storedAvailable: true, file: undefined, match: null })).toMatchObject({
      action: 'stored',
      enabled: true,
      titleKey: 'hud.controls.solution.hint'
    });
    expect(solutionControlState({ tws: false, storedAvailable: false, file: undefined, match: null })).toMatchObject({
      action: 'stored',
      enabled: false,
      titleKey: 'hud.controls.solution_unavailable.label'
    });
  });

  it('is loading until the pack\'s file has been read', () => {
    for (const file of [undefined, { kind: 'loading' } as TwsFileState]) {
      expect(solutionControlState({ tws: true, storedAvailable: false, file, match: null })).toMatchObject({ action: 'loading', enabled: true });
    }
  });

  it('offers to load a file when the pack has none', () => {
    expect(solutionControlState({ tws: true, storedAvailable: false, file: { kind: 'none' }, match: null })).toMatchObject({
      action: 'offer_load',
      enabled: true,
      titleKey: 'hud.controls.solution_tws_load.hint'
    });
  });

  it('offers to forget or reload a stored file the reader refuses', () => {
    const file: TwsFileState = { kind: 'error', fileName: 'mine.tws', code: 'too_large' };
    expect(solutionControlState({ tws: true, storedAvailable: false, file, match: null })).toMatchObject({ action: 'error', enabled: true });
  });

  it('plays the record when the file has a playable one for the level', () => {
    const index = indexOf(1, [1]);
    const match = matchTwsRecord(index, lvl);
    expect(solutionControlState({ tws: true, storedAvailable: false, file: ready(index), match })).toMatchObject({
      action: 'tws',
      enabled: true,
      titleKey: 'hud.controls.solution.hint'
    });
  });

  it('is disabled with the reason as its title for each way a level cannot play', () => {
    const cases: Array<[TwsFileState, TwsMatch, string]> = [
      [ready(indexOf(1, [2])), matchTwsRecord(indexOf(1, [2]), lvl), 'hud.messages.tws_no_record.label'],
      [ready(indexOf(1, [1], 'ABCD')), matchTwsRecord(indexOf(1, [1], 'ABCD'), lvl), 'hud.messages.tws_password_mismatch.label'],
      [ready(indexOf(2, [1])), matchTwsRecord(indexOf(2, [1]), lvl), 'hud.messages.tws_ms_ruleset.label']
    ];
    for (const [file, match, titleKey] of cases) {
      expect(solutionControlState({ tws: true, storedAvailable: false, file, match })).toMatchObject({ action: 'none', enabled: false, titleKey });
    }
    const passwordOnly = parseTwsIndex(twsFileBytes(1, [{ passwordOnly: { number: 1, password: PASSWORD } }]), LIMITS);
    expect(solutionControlState({ tws: true, storedAvailable: false, file: ready(passwordOnly), match: matchTwsRecord(passwordOnly, lvl) })).toMatchObject({
      action: 'none',
      enabled: false,
      titleKey: 'hud.messages.tws_no_solution.label'
    });
    const mouse = parseTwsIndex(twsFileBytes(1, [twsSolutionRecord({ number: 1, password: PASSWORD, moves: [0x13 | (4 << 5), 24] })]), LIMITS);
    expect(solutionControlState({ tws: true, storedAvailable: false, file: ready(mouse), match: matchTwsRecord(mouse, lvl) })).toMatchObject({
      action: 'none',
      enabled: false,
      titleKey: 'hud.messages.tws_mouse_moves.label'
    });
  });
});

describe('solutionControlState parameters and the stored path', () => {
  it('carries the level number the password message names, and formats with no brace left in both languages', () => {
    const index = indexOf(1, [4], 'ABCD');
    const lvl = level(4);
    const control = solutionControlState({
      tws: true,
      storedAvailable: false,
      file: ready(index),
      match: matchTwsRecord(index, lvl),
      levelNumber: lvl.number
    });
    expect(control.titleKey).toBe('hud.messages.tws_password_mismatch.label');
    expect(control.titleParams).toEqual({ number: 4 });
    for (const locale of [enLocale, frLocale]) {
      const text = formatMessage(String(resolveMessage(locale as TranslationNode, control.titleKey)), control.titleParams, locale === enLocale ? 'en' : 'fr');
      expect(text).toContain('4');
      expect(text).not.toMatch(/[{}]/);
    }
  });

  it('keeps the stored solution rule for a level the CCLP engine does not play, whatever the file state', () => {
    const base = { tws: false, file: undefined, match: null } as const;
    expect(solutionControlState({ ...base, storedAvailable: false }).enabled).toBe(false);
    expect(solutionControlState({ ...base, storedAvailable: true })).toMatchObject({ action: 'stored', enabled: true });
  });
});

describe('mayRecordWin', () => {
  it('records only a win that is not a replay, not a Tile World run, not a seeded takeover and not a test play', () => {
    const flags = [false, true];
    let recorded = 0;
    for (const replaying of flags) {
      for (const tws of flags) {
        for (const seededRun of flags) {
          for (const testPlaying of flags) {
            const expected = !replaying && !tws && !seededRun && !testPlaying;
            expect(mayRecordWin({ replaying, tws, seededRun, testPlaying })).toBe(expected);
            if (expected) recorded++;
          }
        }
      }
    }
    expect(recorded).toBe(1);
  });
});

describe('twsLoadOutcome', () => {
  const levels = [level(1), level(2), level(3)];

  it('counts the levels of the pack a file plays', () => {
    const bytes = twsFileBytes(1, [twsSolutionRecord({ number: 1, password: PASSWORD, moves: [] }), twsSolutionRecord({ number: 2, password: PASSWORD, moves: [] })]);
    const outcome = twsLoadOutcome(bytes, levels, LIMITS);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect([outcome.matched, outcome.total]).toEqual([2, 3]);
  });

  it('refuses a file of MS solutions, and names the fix', () => {
    const bytes = twsFileBytes(2, [twsSolutionRecord({ number: 1, password: PASSWORD, moves: [] })]);
    expect(twsLoadOutcome(bytes, levels, LIMITS)).toEqual({ ok: false, errorKey: 'hud.messages.tws_ms_ruleset.label', params: {} });
  });

  it('refuses a file that plays none of the pack\'s levels, with its own message', () => {
    const bytes = twsFileBytes(1, [twsSolutionRecord({ number: 9, password: PASSWORD, moves: [] }), twsSolutionRecord({ number: 1, password: 'ABCD', moves: [] })]);
    expect(twsLoadOutcome(bytes, levels, LIMITS)).toEqual({ ok: false, errorKey: 'app.errors.tws.no_match.label', params: {} });
  });

  it('refuses a damaged file with the size limit in KB for the too large message', () => {
    const good = twsFileBytes(1, [twsSolutionRecord({ number: 1, password: PASSWORD, moves: [] })]);
    expect(twsLoadOutcome(good.slice(0, good.length - 1), levels, LIMITS)).toEqual({ ok: false, errorKey: 'app.errors.tws.damaged.label', params: { max: 4 } });
    expect(twsLoadOutcome(good, levels, { ...LIMITS, maxFileBytes: 4 })).toEqual({ ok: false, errorKey: 'app.errors.tws.too_large.label', params: { max: 0 } });
  });

  it('refuses a file by its size alone, before any byte is read', () => {
    expect(twsSizeRefusal(LIMITS.maxFileBytes, LIMITS)).toBeNull();
    expect(twsSizeRefusal(LIMITS.maxFileBytes + 1, LIMITS)).toEqual({ ok: false, errorKey: 'app.errors.tws.too_large.label', params: { max: 4 } });
  });
});

describe('messages', () => {
  const EN = enLocale as TranslationNode;
  const FR = frLocale as TranslationNode;

  it('names a message for every refusal and every way a level cannot play', () => {
    const codes: TwsErrorCode[] = ['too_large', 'signature', 'ruleset', 'truncated', 'record_size', 'start_state', 'too_long'];
    for (const code of codes) expect(twsErrorKey(code)).toMatch(/^app\.errors\.tws\./);
    expect(twsParseRefusal('too_long', LIMITS).errorKey).toBe('app.errors.tws.too_long.label');
    expect(twsMatchMessageKey('no_record')).toBe('hud.messages.tws_no_record.label');
  });

  it('has every message key of the replay in both languages', () => {
    const extra = [
      'hud.messages.tws_offer_load.label',
      'hud.messages.tws_loaded.label',
      'hud.messages.tws_loading.label',
      'hud.messages.tws_playing.label',
      'hud.messages.tws_replaying_banner.label',
      'hud.messages.tws_not_reached.label',
      'hud.messages.tws_died.label',
      'hud.messages.tws_run_unscored.label',
      'app.confirm.tws_load.action',
      'app.errors.tws.not_stored.label',
      'app.packs.manager.tws_section.title.label',
      'app.packs.manager.tws_section.hint.label',
      'app.packs.manager.tws_section.none.label',
      'app.packs.manager.tws_section.file.label',
      'app.packs.manager.tws_section.loading.label',
      'app.packs.manager.tws_section.error.label',
      'app.packs.manager.tws_load.action',
      'app.packs.manager.tws_load_other.action',
      'app.packs.manager.tws_forget.action',
      'app.packs.manager.tws_forget.confirm.label',
      'app.packs.manager.toast.tws_forgotten.label'
    ];
    for (const key of [...twsMessageKeys(), ...extra]) {
      expect(resolveMessage(EN, key), `en ${key}`).toBeTypeOf('string');
      expect(resolveMessage(FR, key), `fr ${key}`).toBeTypeOf('string');
    }
  });

  it('writes the English messages in plain ASCII', () => {
    const texts = [
      'hud.messages.tws_offer_load.label',
      'hud.messages.tws_ms_ruleset.label',
      'hud.messages.tws_replaying_banner.label',
      'app.errors.tws.not_stored.label',
      'app.errors.tws.no_match.label'
    ].map((key) => String(resolveMessage(EN, key)));
    for (const text of texts) expect(text).toMatch(/^[\x20-\x7e]+$/);
  });
});
