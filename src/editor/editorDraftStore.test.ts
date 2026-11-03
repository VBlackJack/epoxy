// @vitest-environment happy-dom
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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompiledLevel } from '../core/types';
import { DRAFT_VERSION, type EditorDraft } from './editorDraft';
import { EditorDraftStore } from './editorDraftStore';

const MAX_CHARS = 100_000;
const PREFIX = 'game:editor_draft:';
const KEY_A = `${PREFIX}a`;
const KEY_B = `${PREFIX}b`;

function level(): CompiledLevel {
  return {
    id: 'lvl',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    playerStart: { x: 1, y: 1, dir: 'S' },
    terrain: [['floor']],
    items: [[null]],
    entities: [],
    trapLinks: [],
    cloneLinks: []
  };
}

function draft(tabId: string): EditorDraft {
  return { v: DRAFT_VERSION, tabId, writtenAt: 1, source: { packId: null, levelId: null }, currentLevelId: 'lvl', baseHash: '', level: level() };
}

let data: Map<string, string>;
let blocked: boolean;
let full: boolean;
let listable: boolean;
let store: EditorDraftStore;

beforeEach(() => {
  data = new Map();
  blocked = false;
  full = false;
  listable = true;
  vi.stubGlobal('localStorage', {
    get length(): number {
      if (!listable) throw new Error('cannot list');
      return data.size;
    },
    key: (index: number) => [...data.keys()][index] ?? null,
    getItem: (key: string) => {
      if (blocked) throw new Error('blocked');
      return data.get(key) ?? null;
    },
    setItem: (key: string, value: string) => {
      if (blocked || full) throw new Error('refused');
      data.set(key, value);
    },
    removeItem: (key: string) => {
      if (blocked) throw new Error('blocked');
      data.delete(key);
    }
  });
  store = new EditorDraftStore(MAX_CHARS);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('EditorDraftStore', () => {
  it('writes and reads a draft under the key it is given', () => {
    expect(store.write(KEY_A, draft('a'))).toBe('written');
    const found = store.read(KEY_A);
    expect(found.kind).toBe('draft');
    expect(found.kind === 'draft' && found.draft.tabId).toBe('a');
    expect(found.kind === 'draft' && found.raw).toBe(data.get(KEY_A));
    expect(data.has(KEY_B)).toBe(false);
  });

  it('reports nothing stored', () => {
    expect(store.read(KEY_A)).toEqual({ kind: 'none' });
  });

  it('tells a damaged text, a wrong shape and an unsupported draft apart', () => {
    data.set(KEY_A, 'not json');
    expect(store.read(KEY_A)).toEqual({ kind: 'invalid', raw: 'not json' });
    const wrongShape = JSON.stringify({ v: DRAFT_VERSION, tabId: 3 });
    data.set(KEY_A, wrongShape);
    expect(store.read(KEY_A)).toEqual({ kind: 'invalid', raw: wrongShape });
    data.set(KEY_A, JSON.stringify({ v: 9 }));
    expect(store.read(KEY_A)).toEqual({ kind: 'unsupported', reason: 'version' });
    data.set(KEY_A, 'x'.repeat(MAX_CHARS + 1));
    expect(store.read(KEY_A)).toEqual({ kind: 'unsupported', reason: 'too_large' });
  });

  it('refuses a draft above the cap without touching the storage', () => {
    const small = new EditorDraftStore(10);
    expect(small.write(KEY_A, draft('a'))).toBe('too_large');
    expect(data.size).toBe(0);
  });

  it('reports a refused write', () => {
    full = true;
    expect(store.write(KEY_A, draft('a'))).toBe('failed');
  });

  it('removes a key unconditionally', () => {
    data.set(KEY_A, 'x');
    data.set(KEY_B, 'y');
    store.remove(KEY_A);
    expect([...data.keys()]).toEqual([KEY_B]);
  });

  it('removes a key only while it still holds the text that was read', () => {
    data.set(KEY_A, 'old');
    data.set(KEY_A, 'newer');
    store.removeIfRaw(KEY_A, 'old');
    expect(data.get(KEY_A)).toBe('newer');
    store.removeIfRaw(KEY_A, 'newer');
    expect(data.has(KEY_A)).toBe(false);
    store.removeIfRaw(KEY_A, 'newer');
  });

  it('lists the keys with a prefix, and only those', () => {
    data.set(KEY_B, '1');
    data.set(KEY_A, '2');
    data.set('game:editor_draft', '3');
    data.set('game:editor_draft_pending', '4');
    data.set('other', '5');
    expect(store.listKeys(PREFIX).sort()).toEqual([KEY_A, KEY_B]);
  });

  it('never throws when the storage is blocked', () => {
    data.set(KEY_A, JSON.stringify(draft('a')));
    blocked = true;
    expect(store.read(KEY_A)).toEqual({ kind: 'unavailable' });
    expect(store.write(KEY_A, draft('a'))).toBe('failed');
    expect(() => store.remove(KEY_A)).not.toThrow();
    expect(() => store.removeIfRaw(KEY_A, 'x')).not.toThrow();
    blocked = false;
    expect(data.has(KEY_A)).toBe(true);
  });

  it('lists nothing, and does not throw, when the storage cannot be listed', () => {
    data.set(KEY_A, 'x');
    listable = false;
    expect(store.listKeys(PREFIX)).toEqual([]);
  });
});
