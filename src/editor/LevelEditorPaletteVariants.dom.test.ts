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

/** A variant family has one palette entry; the rotate key cycles it, and the eyedropper picks the variant it finds. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../ui/confirmDialog', () => ({ confirmDialog: vi.fn(async () => false) }));
vi.mock('../ui/saveIntoDialog', () => ({ askSaveInto: vi.fn() }));

import { ConfigRegistry } from '../config/ConfigRegistry';
import type { CompiledLevel } from '../core/types';
import { i18n, t } from '../i18n/I18nManager';
import { LevelPackStorage } from '../storage/LevelPackStorage';
import { FakeIndexedDb } from '../test/FakeIndexedDb';
import { mountModals } from '../test/domFixture';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { getEditorKeyAction } from './editorKeyboard';
import { LevelEditor } from './LevelEditor';
import { familyKey, paletteTilesOf, variantFamilyOf } from './paletteVariants';

const WIDTH = 9;
const HEIGHT = 7;
const GRID = '#editor-palette-grid button';
const NO_SIGN_PREFIX = 'no_sign_';
const ITEMS_CATEGORY = 'items';
const MECHANISMS_CATEGORY = 'mechanisms';
const NO_SIGN_FAMILY = 'no_sign';
const CURSOR_START = 1;
const THIRD_VARIANT = 2;

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

const toolButton = (tool: string): HTMLButtonElement => document.querySelector<HTMLButtonElement>(`.editor-tool-btn[data-tool="${tool}"]`)!;
const gridButtons = (): HTMLButtonElement[] => Array.from(document.querySelectorAll<HTMLButtonElement>(GRID));
const status = (): string => byId('editor-status-bar').textContent ?? '';
const brushOf = (): { kind: string; id: string } => (editor as unknown as { brush: { kind: string; id: string } }).brush;
const labelOf = (id: string): string => t(ConfigRegistry.getTile(id)!.i18nKey);
const selectBrush = (brush: { kind: string; id: string }): void => (editor as unknown as { selectBrush(b: unknown): void }).selectBrush(brush);

/** The config order of a family's tiles, derived from the data. */
const membersOf = (family: string, category: string): string[] =>
  Object.values(ConfigRegistry.getTiles().tiles)
    .filter((tile) => tile.category === category && variantFamilyOf(tile) === family)
    .map((tile) => tile.id);

function openTab(categoryId: string): void {
  const index = ConfigRegistry.getTiles().categories.findIndex((cat) => cat.id === categoryId);
  byId('editor-category-tabs').querySelectorAll<HTMLButtonElement>('button')[index].click();
}

const entryFor = (id: string): HTMLButtonElement | undefined => gridButtons().find((btn) => btn.dataset.brushId === id);

function shortcut(key: string, init: KeyboardEventInit = {}): void {
  const action = getEditorKeyAction(new KeyboardEvent('keydown', { key, ...init }));
  if (action) editor.handleKeyAction(action);
}

/** Presses the paint key with the keyboard cursor on the cell. */
function pressPaint(cell: { x: number; y: number }): void {
  (editor as unknown as { cursorCell: { x: number; y: number } }).cursorCell = { ...cell };
  canvas.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
}

/** A bordered empty room. */
function room(): CompiledLevel {
  const terrain: string[][] = Array.from({ length: HEIGHT }, (_, y) =>
    Array.from({ length: WIDTH }, (_, x) => (x === 0 || y === 0 || x === WIDTH - 1 || y === HEIGHT - 1 ? 'wall' : 'floor'))
  );
  return {
    id: 'lvl_variants_dom',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    customTitle: 'Variants room',
    playerStart: { x: 4, y: 3, dir: 'S' },
    terrain,
    items: terrain.map((row) => row.map(() => null as string | null)),
    entities: [],
    trapLinks: [],
    cloneLinks: []
  };
}

function open(level: CompiledLevel): void {
  editor.loadCompiledLevel(level);
  canvas.focus();
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
  i18n.setLocale('en');
});

describe('one palette entry per variant family', () => {
  it('offers a single no-sign entry in the Items tab and every other tile as before', () => {
    open(room());
    openTab(ITEMS_CATEGORY);
    const tiles = Object.values(ConfigRegistry.getTiles().tiles).filter((tile) => tile.category === ITEMS_CATEGORY && tile.litCharge !== true);
    const entries = paletteTilesOf(tiles, ITEMS_CATEGORY, new Map());
    const members = membersOf(NO_SIGN_FAMILY, ITEMS_CATEGORY);
    expect(members.length).toBeGreaterThan(1);
    expect(gridButtons().filter((btn) => btn.dataset.brushId?.startsWith(NO_SIGN_PREFIX))).toHaveLength(1);
    expect(entries.length).toBe(tiles.length - members.length + 1);
  });

  it('shows the variant in hand on the entry and keeps the family where it was', () => {
    open(room());
    openTab(ITEMS_CATEGORY);
    const members = membersOf(NO_SIGN_FAMILY, ITEMS_CATEGORY);
    entryFor(members[0])!.click();
    const position = gridButtons().findIndex((btn) => btn.dataset.brushId === members[0]);
    shortcut('r');
    expect(brushOf()).toEqual({ kind: 'item', id: members[1] });
    const entry = gridButtons()[position];
    expect(entry.dataset.brushId).toBe(members[1]);
    expect(entry.getAttribute('aria-pressed')).toBe('true');
    expect(entry.querySelector('.palette-item-label')?.textContent).toBe(labelOf(members[1]));
  });
});

describe('the rotate key cycles a variant family', () => {
  it('walks the family in config order, wraps, and says which variant it is on', () => {
    open(room());
    openTab(ITEMS_CATEGORY);
    const members = membersOf(NO_SIGN_FAMILY, ITEMS_CATEGORY);
    entryFor(members[0])!.click();
    for (let step = 1; step <= members.length; step++) {
      shortcut('r');
      const expected = members[step % members.length];
      expect(brushOf().id).toBe(expected);
      expect(status()).toBe(t('editor.palette.status.variant.label', { name: labelOf(expected), position: (step % members.length) + 1, count: members.length }));
    }
    expect(brushOf().id).toBe(members[0]);
  });

  it('cycles the counters, the CC2 swivel doors and the toggle switch too', () => {
    open(room());
    openTab(MECHANISMS_CATEGORY);
    for (const family of ['signal_counter', 'swivel_cc2', 'toggle_switch']) {
      const members = membersOf(family, MECHANISMS_CATEGORY);
      expect(members.length, family).toBeGreaterThan(1);
      expect(gridButtons().filter((btn) => members.includes(btn.dataset.brushId ?? '')), family).toHaveLength(1);
      selectBrush({ kind: 'terrain', id: members[0] });
      shortcut('r');
      expect(brushOf().id, family).toBe(members[1]);
    }
  });

  it('paints the variant in hand and undoes it as one step', () => {
    open(room());
    toolButton('brush').click();
    openTab(ITEMS_CATEGORY);
    const members = membersOf(NO_SIGN_FAMILY, ITEMS_CATEGORY);
    entryFor(members[0])!.click();
    shortcut('r');
    canvas.focus();
    pressPaint({ x: CURSOR_START, y: CURSOR_START });
    expect(editor.exportCompiledLevel().items[CURSOR_START][CURSOR_START]).toBe(members[1]);
    editor.undo();
    expect(editor.exportCompiledLevel().items[CURSOR_START][CURSOR_START]).toBeNull();
  });

  it('leaves Shift+R to the in-place rotation, which does not touch the brush', () => {
    open(room());
    openTab(ITEMS_CATEGORY);
    const members = membersOf(NO_SIGN_FAMILY, ITEMS_CATEGORY);
    entryFor(members[0])!.click();
    shortcut('r', { shiftKey: true });
    expect(brushOf().id).toBe(members[0]);
  });

  it('keeps turning a rail piece the old way', () => {
    open(room());
    selectBrush({ kind: 'terrain', id: 'rail_ns' });
    shortcut('r');
    expect(brushOf().id).toBe('rail_ew');
  });
});

describe('picking a variant and searching', () => {
  it('the eyedropper on a map cell selects the family entry showing that variant', () => {
    const members = membersOf(NO_SIGN_FAMILY, ITEMS_CATEGORY);
    const level = room();
    level.items[CURSOR_START][CURSOR_START] = members[THIRD_VARIANT];
    open(level);
    toolButton('picker').click();
    canvas.focus();
    pressPaint({ x: CURSOR_START, y: CURSOR_START });
    expect(brushOf()).toEqual({ kind: 'item', id: members[THIRD_VARIANT] });
    const entries = gridButtons().filter((btn) => btn.dataset.brushId?.startsWith(NO_SIGN_PREFIX));
    expect(entries).toHaveLength(1);
    expect(entries[0].dataset.brushId).toBe(members[THIRD_VARIANT]);
    expect(entries[0].getAttribute('aria-pressed')).toBe('true');
  });

  it('a search still finds every variant by name', () => {
    open(room());
    const members = membersOf(NO_SIGN_FAMILY, ITEMS_CATEGORY);
    const input = byId<HTMLInputElement>('editor-palette-search');
    for (const id of members) {
      input.value = labelOf(id);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      expect(gridButtons().some((btn) => btn.dataset.brushId === id), id).toBe(true);
    }
  });

  it('keys a family by category and name', () => {
    expect(familyKey(ITEMS_CATEGORY, NO_SIGN_FAMILY)).toBe('items:no_sign');
  });
});
