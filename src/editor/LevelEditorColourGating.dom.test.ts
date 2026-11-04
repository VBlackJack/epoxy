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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n, t } from '../i18n/I18nManager';
import { LevelPackStorage } from '../storage/LevelPackStorage';
import { FakeIndexedDb } from '../test/FakeIndexedDb';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { mountModals } from '../test/domFixture';
import type { CompiledLevel } from '../core/types';
import { LevelEditor } from './LevelEditor';

const WIDTH = 7;
const HEIGHT = 5;
const PLATE = 'pressure_plate_red';

const fake = new FakeIndexedDb();
let editor: LevelEditor;
let canvas: HTMLCanvasElement;

const noopContext = (): CanvasRenderingContext2D =>
  new Proxy(() => undefined, { get: () => noopContext(), set: () => true, apply: () => undefined }) as unknown as CanvasRenderingContext2D;

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element ${id}`);
  return el as T;
}

const status = (): string => byId('editor-status-bar').textContent ?? '';

function press(name: string, init: KeyboardEventInit = {}): void {
  canvas.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init }));
}

function room(ruleset: 'lynx' | undefined, plate: boolean): CompiledLevel {
  const terrain: string[][] = Array.from({ length: HEIGHT }, (_, y) =>
    Array.from({ length: WIDTH }, (_, x) => (x === 0 || y === 0 || x === WIDTH - 1 || y === HEIGHT - 1 ? 'wall' : 'floor'))
  );
  if (plate) terrain[2][2] = PLATE;
  return {
    id: 'lvl_gating',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    customTitle: 'Gating room',
    ruleset,
    playerStart: { x: 1, y: 1, dir: 'S' },
    terrain,
    items: terrain.map((row) => row.map(() => null as string | null)),
    entities: [],
    trapLinks: [],
    cloneLinks: []
  };
}

beforeEach(() => {
  loadTestConfigs();
  i18n.setLocale('en');
  fake.records.clear();
  const store = new Map<string, string>();
  vi.stubGlobal('indexedDB', fake);
  vi.stubGlobal('localStorage', {
    getItem: (name: string) => store.get(name) ?? null,
    setItem: (name: string, value: string) => void store.set(name, value),
    removeItem: (name: string) => void store.delete(name)
  });
  mountModals('editor-view');
  canvas = byId<HTMLCanvasElement>('editor-canvas');
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => noopContext()) as unknown as HTMLCanvasElement['getContext']);
  canvas.setPointerCapture = () => undefined;
  const renderer = {
    getAppearanceKey: vi.fn(() => 'look'),
    renderIconToDataUrl: vi.fn(() => 'data:,'),
    drawTile: vi.fn(),
    drawItem: vi.fn(),
    drawEntity: vi.fn(),
    drawPlayer: vi.fn(),
    drawCellOverlay: vi.fn(),
    setHiddenLayerMarkers: vi.fn()
  };
  const hooks = { onTestPlay: vi.fn(), onLevelSaved: vi.fn(), onNotify: vi.fn(), openManager: vi.fn(), importAsPack: vi.fn(), getConfigBundle: vi.fn() };
  editor = new LevelEditor(canvas, renderer as never, hooks as never);
  editor.buildUI();
});

afterEach(async () => {
  editor.dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await LevelPackStorage.closeConnection();
});

describe('colour channel gating', () => {
  it('locks the Lynx choice for a level that holds a pressure plate, with the colour wording as the reason', () => {
    editor.loadCompiledLevel(room(undefined, true));
    const lynx = Array.from(byId<HTMLSelectElement>('editor-meta-ruleset').options).find((option) => option.value === 'lynx');
    expect(lynx?.disabled).toBe(true);
    expect(lynx?.title).toBe(t('editor.metadata.ruleset_lynx_unavailable.label'));
    expect(t('editor.metadata.ruleset_lynx_unavailable.label').toLowerCase()).toContain('colour');
  });

  it('leaves the Lynx choice open for a level with no Epoxy-only content', () => {
    editor.loadCompiledLevel(room(undefined, false));
    const lynx = Array.from(byId<HTMLSelectElement>('editor-meta-ruleset').options).find((option) => option.value === 'lynx');
    expect(lynx?.disabled).toBe(false);
  });

  it('switches a stored Lynx level that holds a plate to Epoxy on open', () => {
    editor.loadCompiledLevel(room('lynx', true));
    expect(editor.exportCompiledLevel().ruleset).toBeUndefined();
  });

  it('skips a pasted plate in a Lynx level and counts it', () => {
    editor.loadCompiledLevel(room(undefined, true));
    canvas.focus();
    document.querySelector<HTMLButtonElement>('.editor-tool-btn[data-tool="select"]')?.click();
    // Cursor to the plate cell (2, 2), then select that single cell and copy it.
    press('ArrowRight');
    press('ArrowDown');
    press('Enter');
    expect(editor.handleSelectionAction({ kind: 'copy' })).toBe(true);

    editor.loadCompiledLevel(room('lynx', false));
    canvas.focus();
    expect(editor.exportCompiledLevel().ruleset).toBe('lynx');
    expect(editor.handleSelectionAction({ kind: 'paste' })).toBe(true);
    press('ArrowRight');
    press('ArrowDown');
    press('Enter');

    const pasted = editor.exportCompiledLevel();
    expect(pasted.ruleset).toBe('lynx');
    expect(pasted.terrain.flat()).not.toContain(PLATE);
    expect(status()).toContain(t('editor.selection.status.paste_skipped', { count: 1 }));
  });
});
