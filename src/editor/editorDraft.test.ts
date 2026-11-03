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

import { beforeEach, describe, expect, it } from 'vitest';
import type { CompiledLevel } from '../core/types';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { smallCc3dLevel } from './cc3dEditorFixtures';
import {
  DRAFT_VERSION,
  draftLevelOf,
  draftOffer,
  fingerprint,
  hydrateDraftLevel,
  levelFingerprint,
  parseDraft,
  serializeDraft,
  type EditorDraft
} from './editorDraft';

const MAX_CHARS = 100_000;

function epoxyLevel(overrides: Partial<CompiledLevel> = {}): CompiledLevel {
  return {
    id: 'lvl_a',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    customTitle: 'Room',
    playerStart: { x: 1, y: 1, dir: 'S' },
    terrain: [
      ['wall', 'wall', 'wall'],
      ['wall', 'floor', 'wall'],
      ['wall', 'wall', 'wall']
    ],
    items: [
      [null, null, null],
      [null, null, null],
      [null, null, null]
    ],
    entities: [],
    trapLinks: [],
    cloneLinks: [],
    ...overrides
  };
}

function draftOf(level: CompiledLevel, source: EditorDraft['source'], base: CompiledLevel | null): EditorDraft {
  return {
    v: DRAFT_VERSION,
    tabId: 'tab-1',
    writtenAt: 1,
    source,
    currentLevelId: level.id,
    baseHash: base ? levelFingerprint(base) : '',
    level: draftLevelOf(level)
  };
}

const SOURCE = { packId: 'pack', levelId: 'lvl_a' };

describe('serializeDraft and parseDraft', () => {
  it('round trips a draft', () => {
    const draft = draftOf(epoxyLevel({ customTitle: 'Edited' }), SOURCE, epoxyLevel());
    const written = serializeDraft(draft, MAX_CHARS);
    expect(written.ok).toBe(true);
    const parsed = parseDraft((written as { text: string }).text, MAX_CHARS);
    expect(parsed).toEqual({ ok: true, draft });
  });

  it('refuses a draft of another version', () => {
    const text = JSON.stringify({ ...draftOf(epoxyLevel(), SOURCE, null), v: 2 });
    expect(parseDraft(text, MAX_CHARS)).toEqual({ ok: false, reason: 'version' });
  });

  it('refuses text that is not JSON, or not an object', () => {
    expect(parseDraft('{"v":1,', MAX_CHARS)).toEqual({ ok: false, reason: 'malformed' });
    expect(parseDraft('[1,2]', MAX_CHARS)).toEqual({ ok: false, reason: 'malformed' });
    expect(parseDraft('null', MAX_CHARS)).toEqual({ ok: false, reason: 'malformed' });
  });

  it.each([
    ['a missing tab id', { tabId: undefined }],
    ['a source that is not an object', { source: 'pack' }],
    ['a source with a numeric pack id', { source: { packId: 3, levelId: null } }],
    ['a time that is not a number', { writtenAt: 'now' }],
    ['a missing base hash', { baseHash: undefined }],
    ['a level that is not an object', { level: 'x' }]
  ])('refuses %s', (_label, patch) => {
    const text = JSON.stringify({ ...draftOf(epoxyLevel(), SOURCE, null), ...patch });
    expect(parseDraft(text, MAX_CHARS)).toEqual({ ok: false, reason: 'shape' });
  });

  it('skips a draft above the cap, when writing and when reading', () => {
    const draft = draftOf(epoxyLevel(), SOURCE, null);
    const size = JSON.stringify(draft).length;
    expect(serializeDraft(draft, size).ok).toBe(true);
    expect(serializeDraft(draft, size - 1)).toEqual({ ok: false, reason: 'too_large' });
    expect(parseDraft(JSON.stringify(draft), size - 1)).toEqual({ ok: false, reason: 'too_large' });
  });
});

describe('fingerprint', () => {
  it('is stable, short, and tells different texts apart', () => {
    expect(fingerprint('abc')).toBe(fingerprint('abc'));
    expect(fingerprint('abc')).not.toBe(fingerprint('abd'));
    expect(fingerprint('x'.repeat(100_000)).length).toBeLessThan(16);
  });

  it('does not depend on the key order of a level', () => {
    const a = epoxyLevel();
    const reordered = Object.fromEntries(Object.entries(a).reverse()) as unknown as CompiledLevel;
    expect(levelFingerprint(reordered)).toBe(levelFingerprint(a));
  });
});

describe('CC3D drafts', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('drops the derived display layers, and gives them back', () => {
    const level = smallCc3dLevel();
    expect(level.terrain.length).toBeGreaterThan(0);
    const stored = draftLevelOf(level);
    expect(stored.terrain).toEqual([]);
    expect(stored.items).toEqual([]);
    expect(stored.entities).toEqual([]);
    expect(stored.cc3d).toBe(level.cc3d);
    expect(hydrateDraftLevel(stored)).toEqual(level);
  });

  it('leaves a level without cc3d data as it is', () => {
    const level = epoxyLevel();
    expect(draftLevelOf(level)).toBe(level);
    expect(hydrateDraftLevel(level)).toBe(level);
  });

  it('compares a CC3D draft with its source through the same reduction', () => {
    const source = smallCc3dLevel();
    expect(draftOffer(draftOf(source, SOURCE, source), source)).toBe('identical');
  });
});

describe('draftOffer', () => {
  const source = epoxyLevel();
  const edited = epoxyLevel({ customTitle: 'Edited' });

  it('has nothing to offer without a draft', () => {
    expect(draftOffer(null, source)).toBe('none');
    expect(draftOffer(null, undefined)).toBe('none');
  });

  it('drops a draft that holds exactly the source', () => {
    expect(draftOffer(draftOf(source, SOURCE, source), source)).toBe('identical');
  });

  it('restores on top of a source that is unchanged since the draft started from it', () => {
    expect(draftOffer(draftOf(edited, SOURCE, source), source)).toBe('restore');
  });

  it('warns when the source changed since the draft started from it', () => {
    const newer = epoxyLevel({ customHint: 'changed elsewhere' });
    expect(draftOffer(draftOf(edited, SOURCE, source), newer)).toBe('conflict');
  });

  it('offers a new level when the source is gone', () => {
    expect(draftOffer(draftOf(edited, SOURCE, source), undefined)).toBe('orphan');
    expect(draftOffer(draftOf(edited, { packId: 'pack', levelId: null }, null), undefined)).toBe('orphan');
  });

  it('decides by fingerprint, never by time', () => {
    const early = { ...draftOf(edited, SOURCE, source), writtenAt: 0 };
    const late = { ...draftOf(edited, SOURCE, source), writtenAt: Number.MAX_SAFE_INTEGER };
    expect(draftOffer(early, source)).toBe('restore');
    expect(draftOffer(late, source)).toBe('restore');
  });
});
