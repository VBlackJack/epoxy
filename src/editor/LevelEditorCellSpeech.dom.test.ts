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

/**
 * The spoken description of the keyboard cursor cell: a polite live region that speaks once the cursor has
 * stopped, never for the pointer, never over a status bar message, and not after the canvas lost focus.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../ui/confirmDialog', () => ({ confirmDialog: vi.fn() }));
vi.mock('../ui/saveIntoDialog', () => ({ askSaveInto: vi.fn() }));

import { ConfigRegistry } from '../config/ConfigRegistry';
import { i18n, t } from '../i18n/I18nManager';
import { LevelPackStorage } from '../storage/LevelPackStorage';
import { FakeIndexedDb } from '../test/FakeIndexedDb';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { mountModals } from '../test/domFixture';
import { EDITOR_CELL_ANNOUNCE_DELAY_MS } from '../ui/uiConstants';
import type { CompiledLevel } from '../core/types';
import { smallCc3dLevel } from './cc3dEditorFixtures';
import { LevelEditor } from './LevelEditor';

const CELL_PX = 10;
const WIDTH = 6;
const HEIGHT = 5;
const LIVE_ID = 'editor-cell-live';
const SPACE_KEY = ' ';

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

const live = (): string => byId(LIVE_ID).textContent ?? '';
const status = (): string => byId('editor-status-bar').textContent ?? '';

function press(name: string, init: KeyboardEventInit = {}): void {
  canvas.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init }));
}

function epoxyLevel(): CompiledLevel {
  const terrain = Array.from({ length: HEIGHT }, (_, y) =>
    Array.from({ length: WIDTH }, (_, x) => (x === 0 || y === 0 || x === WIDTH - 1 || y === HEIGHT - 1 ? 'wall' : 'floor'))
  );
  const items = terrain.map((row) => row.map(() => null as string | null));
  items[1][3] = 'chip';
  return {
    id: 'lvl_speech',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    customTitle: 'Speech room',
    playerStart: { x: 1, y: 1, dir: 'S' },
    terrain,
    items,
    entities: [],
    trapLinks: [],
    cloneLinks: []
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
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
  canvas.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: WIDTH * CELL_PX, bottom: HEIGHT * CELL_PX, width: WIDTH * CELL_PX, height: HEIGHT * CELL_PX, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
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
  editor.loadCompiledLevel(epoxyLevel());
  canvas.focus();
});

afterEach(async () => {
  editor.dispose();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await LevelPackStorage.closeConnection();
});

describe('the spoken cell description', () => {
  it('sits next to the coordinates badge, which stays out of the live regions', () => {
    const badge = byId('editor-coords-badge');
    expect(badge.hasAttribute('aria-live')).toBe(false);
    const region = byId(LIVE_ID);
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.getAttribute('aria-atomic')).toBe('true');
    expect(region.classList.contains('sr-only')).toBe(true);
  });

  it('speaks only the final cell of three quick arrows', () => {
    press('ArrowRight');
    vi.advanceTimersByTime(EDITOR_CELL_ANNOUNCE_DELAY_MS - 1);
    press('ArrowRight');
    press('ArrowRight');
    expect(live()).toBe('');
    vi.advanceTimersByTime(EDITOR_CELL_ANNOUNCE_DELAY_MS);
    expect(live()).toContain('Tile (4, 1)');
    expect(byId('editor-coords-badge').textContent).toBe('Tile (4, 1)');
  });

  it('names the item of the cell it stops on', () => {
    press('ArrowRight');
    press('ArrowRight');
    vi.advanceTimersByTime(EDITOR_CELL_ANNOUNCE_DELAY_MS);
    expect(live()).toContain('Tile (3, 1)');
    expect(live()).toContain('item:');
  });

  it('says nothing for a pointer hover', () => {
    canvas.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 3 * CELL_PX + 1, clientY: 2 * CELL_PX + 1 }));
    vi.advanceTimersByTime(EDITOR_CELL_ANNOUNCE_DELAY_MS * 2);
    expect(live()).toBe('');
  });

  it('leaves the cell quiet when Shift+arrow writes the selection size in the status bar', () => {
    document.querySelector<HTMLButtonElement>('.editor-tool-btn[data-tool="select"]')?.click();
    press('ArrowRight', { shiftKey: true });
    vi.advanceTimersByTime(EDITOR_CELL_ANNOUNCE_DELAY_MS * 2);
    expect(live()).toBe('');
    expect(status()).toBe(t('editor.selection.status.size', { width: 2, height: 1 }));
  });

  it('re-reads the cell after a keyboard paint that said nothing', () => {
    press('ArrowRight');
    vi.advanceTimersByTime(EDITOR_CELL_ANNOUNCE_DELAY_MS);
    byId(LIVE_ID).textContent = '';
    // A keyboard paint of a wall on the cell under the cursor changes the name the cell is read with.
    const wallName = t(ConfigRegistry.getTile('wall').i18nKey);
    const wallButton = Array.from(document.querySelectorAll<HTMLButtonElement>('#editor-palette-grid button')).find(
      (button) => button.querySelector('.palette-item-label')?.textContent === wallName
    );
    if (!wallButton) throw new Error('Missing wall palette button');
    wallButton.click();
    press(SPACE_KEY);
    vi.advanceTimersByTime(EDITOR_CELL_ANNOUNCE_DELAY_MS);
    expect(live()).toContain('Tile (2, 1)');
    expect(live()).toContain(wallName);
  });

  it('stays silent after a keyboard paint that wrote a status line', () => {
    press('ArrowRight');
    vi.advanceTimersByTime(EDITOR_CELL_ANNOUNCE_DELAY_MS);
    byId(LIVE_ID).textContent = '';
    document.querySelector<HTMLButtonElement>('.editor-tool-btn[data-tool="picker"]')?.click();
    press(SPACE_KEY);
    vi.advanceTimersByTime(EDITOR_CELL_ANNOUNCE_DELAY_MS * 2);
    expect(live()).toBe('');
  });

  it('lets a status line win over a cell description still waiting', () => {
    document.querySelector<HTMLButtonElement>('.editor-tool-btn[data-tool="picker"]')?.click();
    press('ArrowRight');
    press(SPACE_KEY);
    vi.advanceTimersByTime(EDITOR_CELL_ANNOUNCE_DELAY_MS * 2);
    expect(live()).toBe('');
    expect(status()).not.toBe('');
  });

  it('announces the same cell again by emptying the region first', () => {
    press('ArrowRight');
    vi.advanceTimersByTime(EDITOR_CELL_ANNOUNCE_DELAY_MS);
    const first = live();
    expect(first).not.toBe('');
    press('ArrowLeft');
    press('ArrowRight');
    vi.advanceTimersByTime(EDITOR_CELL_ANNOUNCE_DELAY_MS);
    expect(live()).toBe('');
    vi.advanceTimersByTime(1);
    expect(live()).toBe(first);
  });

  it('empties the region when a level is loaded', () => {
    press('ArrowRight');
    vi.advanceTimersByTime(EDITOR_CELL_ANNOUNCE_DELAY_MS);
    expect(live()).not.toBe('');
    editor.loadCompiledLevel(epoxyLevel());
    expect(live()).toBe('');
  });

  it('stays silent when the canvas no longer has the focus, or the editor is left', () => {
    press('ArrowRight');
    canvas.blur();
    vi.advanceTimersByTime(EDITOR_CELL_ANNOUNCE_DELAY_MS * 2);
    expect(live()).toBe('');

    canvas.focus();
    press('ArrowRight');
    editor.onLeave();
    vi.advanceTimersByTime(EDITOR_CELL_ANNOUNCE_DELAY_MS * 2);
    expect(live()).toBe('');
  });

  it('is cancelled by a blur, by a load and by dispose', () => {
    press('ArrowRight');
    canvas.dispatchEvent(new Event('blur'));
    vi.advanceTimersByTime(EDITOR_CELL_ANNOUNCE_DELAY_MS * 2);
    expect(live()).toBe('');

    press('ArrowRight');
    editor.loadCompiledLevel(epoxyLevel());
    vi.advanceTimersByTime(EDITOR_CELL_ANNOUNCE_DELAY_MS * 2);
    expect(live()).toBe('');

    press('ArrowRight');
    editor.dispose();
    vi.advanceTimersByTime(EDITOR_CELL_ANNOUNCE_DELAY_MS * 2);
    expect(live()).toBe('');
  });

  it('names the stack of a CC3D cell with the names of the layers list', () => {
    editor.loadCompiledLevel(smallCc3dLevel());
    press('ArrowRight');
    vi.advanceTimersByTime(EDITOR_CELL_ANNOUNCE_DELAY_MS);
    const names = Array.from(document.querySelectorAll('#editor-layers-list .editor-layer-name')).map((el) => el.textContent);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(live()).toContain(name ?? '');
  });
});
