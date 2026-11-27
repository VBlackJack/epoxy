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

// @vitest-environment happy-dom
// DOM tests opt in with the line above; the default environment stays node (see vitest.config.ts).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lynxLevel } from '../core/lynx/lynxTestMaps';
import type { CompiledLevel } from '../core/types';
import { FakeKeyedIndexedDb } from '../test/FakeKeyedIndexedDb';
import { twsFileBytes, twsSolutionRecord } from '../test/twsTestBytes';

const fake = new FakeKeyedIndexedDb();
const PACK = 'ccup_test';

type Flow = typeof import('./twsLoadFlow');
type Files = (typeof import('../storage/TwsFiles'))['TwsFiles'];
let flow: Flow;
let files: Files;
let levels: CompiledLevel[];

function fileOf(bytes: Uint8Array, name = 'mine.tws'): File {
  return new File([bytes as BlobPart], name);
}

function good(numbers: number[]): Uint8Array {
  return twsFileBytes(1, numbers.map((number) => twsSolutionRecord({ number, password: 'TEST', moves: [] })));
}

beforeEach(async () => {
  (globalThis as { indexedDB?: unknown }).indexedDB = fake;
  fake.records.clear();
  fake.abortWrites = false;
  vi.resetModules();
  document.body.innerHTML = '<input id="tws-file-input" type="file" class="hidden" />';
  const { i18n } = await import('../i18n/I18nManager');
  i18n.setLocale('en');
  const { loadTestConfigs } = await import('../test/loadTestConfigs');
  loadTestConfigs();
  flow = await import('./twsLoadFlow');
  ({ TwsFiles: files } = await import('../storage/TwsFiles'));
  levels = [1, 2, 3].map((number) => ({ ...lynxLevel(['###', '#@#', '###'], { number }), rulesProfile: 'cclp' }) as CompiledLevel);
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as { indexedDB?: unknown }).indexedDB;
});

describe('loadTwsFileForPack', () => {
  it('stores a file that plays levels of the pack and counts them', async () => {
    const result = await flow.loadTwsFileForPack(PACK, levels, fileOf(good([1, 2])));
    expect(result).toEqual({ ok: true, matched: 2, total: 3, persisted: true });
    expect(files.peek(PACK)).toMatchObject({ kind: 'ready', fileName: 'mine.tws', persisted: true });
    expect(flow.twsLoadMessage(result)).toBe('Solutions loaded: 2 of the 3 levels of this pack.');
  });

  it('refuses a file over the size limit before reading a byte of it', async () => {
    const file = fileOf(good([1]));
    Object.defineProperty(file, 'size', { value: 5 * 1024 * 1024 });
    const read = vi.spyOn(file, 'arrayBuffer');
    const result = await flow.loadTwsFileForPack(PACK, levels, file);
    expect(read).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false, errorKey: 'app.errors.tws.too_large.label', params: { max: 1024 } });
    expect(flow.twsLoadMessage(result)).toBe('This file is larger than 1024 KB.');
    expect(files.peek(PACK)).toBeUndefined();
  });

  it('stores nothing for a file that matches none of the pack levels, and says so', async () => {
    const result = await flow.loadTwsFileForPack(PACK, levels, fileOf(good([40, 41])));
    expect(result.ok).toBe(false);
    expect(flow.twsLoadMessage(result)).toBe('This file has no playable solution for the levels of this pack. Nothing was stored.');
    expect(files.peek(PACK)).toBeUndefined();
    expect(fake.records.size).toBe(0);
  });

  it('refuses a file of MS solutions with the message that names the fix, and stores nothing', async () => {
    const ms = twsFileBytes(2, [twsSolutionRecord({ number: 1, password: 'TEST', moves: [] })]);
    const result = await flow.loadTwsFileForPack(PACK, levels, fileOf(ms));
    expect(flow.twsLoadMessage(result)).toContain('MS ruleset');
    expect(fake.records.size).toBe(0);
  });

  it('keeps the file for the session when it cannot be stored, and says it plays until the page is left', async () => {
    fake.abortWrites = true;
    const result = await flow.loadTwsFileForPack(PACK, levels, fileOf(good([1])));
    expect(result).toEqual({ ok: true, matched: 1, total: 3, persisted: false });
    expect(files.peek(PACK)).toMatchObject({ kind: 'ready', persisted: false });
    expect(flow.twsLoadMessage(result)).toBe(
      'Solutions loaded: 1 of the 3 levels of this pack. The file could not be stored in this browser: it plays until you leave the page.'
    );
  });
});

describe('pickTwsFile', () => {
  function input(): HTMLInputElement {
    return document.getElementById('tws-file-input') as HTMLInputElement;
  }

  it('opens the picker for .tws files and resolves with the chosen file', async () => {
    const click = vi.spyOn(input(), 'click').mockImplementation(() => undefined);
    const picked = flow.pickTwsFile();
    expect(click).toHaveBeenCalledTimes(1);
    expect(input().accept).toBe('.tws,application/octet-stream');
    const file = fileOf(good([1]));
    Object.defineProperty(input(), 'files', { value: [file], configurable: true });
    input().dispatchEvent(new Event('change'));
    expect(await picked).toBe(file);
    expect(input().value).toBe('');
  });

  it('resolves with null when the player cancels the picker', async () => {
    vi.spyOn(input(), 'click').mockImplementation(() => undefined);
    const picked = flow.pickTwsFile();
    input().dispatchEvent(new Event('cancel'));
    expect(await picked).toBeNull();
  });

  it('abandons a picker still open when another is asked for', async () => {
    vi.spyOn(input(), 'click').mockImplementation(() => undefined);
    const first = flow.pickTwsFile();
    const second = flow.pickTwsFile();
    expect(await first).toBeNull();
    input().dispatchEvent(new Event('cancel'));
    expect(await second).toBeNull();
  });

  it('resolves with null when the page has no picker', async () => {
    document.body.innerHTML = '';
    expect(await flow.pickTwsFile()).toBeNull();
  });
});
