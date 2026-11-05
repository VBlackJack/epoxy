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
import { ConfigRegistry } from '../config/ConfigRegistry';
import type { CompiledLevel } from '../core/types';
import { i18n, t } from '../i18n/I18nManager';
import { LevelPackStorage } from '../storage/LevelPackStorage';
import { FakeIndexedDb } from '../test/FakeIndexedDb';
import { mountModals } from '../test/domFixture';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { EDITOR_PALETTE_SEARCH_COUNT_DELAY_MS } from '../ui/uiConstants';
import { smallCc3dLevel } from './cc3dEditorFixtures';
import { isPaletteSearchKey } from './editorKeyboard';
import { LevelEditor } from './LevelEditor';
import { foldForSearch } from './paletteSearch';

const GRID_ID = 'editor-palette-grid';
const TABS_ID = 'editor-category-tabs';
const INPUT_ID = 'editor-palette-search';
const COUNT_ID = 'editor-palette-search-count';
const CANVAS_ID = 'editor-canvas';
const UNAVAILABLE_CLASS = 'is-unavailable';
const CELL_PX = 10;
const MECHANISMS_CATEGORY = 'mechanisms';
const ROOM_SIZE = 5;
const CC3D_ITEMS_TAB = 3;

const fake = new FakeIndexedDb();
let editor: LevelEditor;

const noopContext = (): CanvasRenderingContext2D =>
  new Proxy(() => undefined, { get: () => noopContext(), set: () => true, apply: () => undefined }) as unknown as CanvasRenderingContext2D;

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element ${id}`);
  return el as T;
}

const input = (): HTMLInputElement => byId<HTMLInputElement>(INPUT_ID);
const gridButtons = (): HTMLButtonElement[] => Array.from(byId(GRID_ID).querySelectorAll<HTMLButtonElement>('button'));
const tabButtons = (): HTMLButtonElement[] => Array.from(byId(TABS_ID).querySelectorAll<HTMLButtonElement>('button'));
const keyOf = (btn: HTMLButtonElement): string => `${btn.dataset.brushKind}:${btn.dataset.brushId}`;

function type(text: string): void {
  input().value = text;
  input().dispatchEvent(new Event('input', { bubbles: true }));
}

function press(key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  input().dispatchEvent(event);
  return event;
}

function lynxRoom(): CompiledLevel {
  const terrain: string[][] = Array.from({ length: ROOM_SIZE }, (_, y) =>
    Array.from({ length: ROOM_SIZE }, (_, x) => (x === 0 || y === 0 || x === ROOM_SIZE - 1 || y === ROOM_SIZE - 1 ? 'wall' : 'floor'))
  );
  return {
    id: 'lvl_search_lynx',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    customTitle: 'Search room',
    ruleset: 'lynx',
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
  const canvas = byId<HTMLCanvasElement>(CANVAS_ID);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => noopContext()) as unknown as HTMLCanvasElement['getContext']);
  const renderer = {
    getAppearanceKey: vi.fn(() => 'look'),
    renderIconToDataUrl: vi.fn((kind: string, id: string) => `data:,${kind}-${id}`),
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
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await LevelPackStorage.closeConnection();
});

describe('Palette search: filtering', () => {
  it('shows matches from several tabs, each entry once, as the ordinary buttons', () => {
    type('door');
    const buttons = gridButtons();
    expect(buttons.length).toBeGreaterThan(1);
    const keys = buttons.map(keyOf);
    expect(new Set(keys).size).toBe(keys.length);
    const categories = new Set(
      buttons.filter((btn) => btn.dataset.brushKind === 'terrain').map((btn) => ConfigRegistry.getTile(btn.dataset.brushId ?? '').category)
    );
    expect(categories.size).toBeGreaterThan(1);
    for (const btn of buttons) {
      const text = foldForSearch(`${btn.querySelector('.palette-item-label')?.textContent ?? ''} ${btn.getAttribute('aria-description') ?? ''}`);
      expect(text).toContain('door');
    }
  });

  it('puts the palette back exactly as it was when the query is emptied', () => {
    // The Mechanisms tab is the one with sub-headings: the hardest grid to put back.
    tabButtons()[ConfigRegistry.getTiles().categories.findIndex((cat) => cat.id === MECHANISMS_CATEGORY)].click();
    const before = byId(GRID_ID).innerHTML;
    expect(byId(GRID_ID).querySelector('h4')).not.toBeNull();
    type('door');
    expect(byId(GRID_ID).querySelector('h4')).toBeNull();
    type('');
    expect(byId(GRID_ID).innerHTML).toBe(before);
    expect(byId(COUNT_ID).textContent).toBe('');
  });

  it('dims the tabs and labels the grid as results while a query is on', () => {
    type('door');
    for (const tab of tabButtons()) {
      expect(tab.getAttribute('aria-pressed')).toBe('false');
      expect(tab.classList.contains('is-dimmed')).toBe(true);
    }
    expect(byId(GRID_ID).getAttribute('aria-label')).toBe(t('editor.palette.search.results.label'));
  });

  it('shows a line, not a button, when nothing matches', () => {
    type('zzzqqq');
    expect(gridButtons()).toHaveLength(0);
    const line = byId(GRID_ID).querySelector('p.palette-search-empty');
    expect(line?.textContent).toBe(t('editor.palette.search.no_match.label', { query: 'zzzqqq' }));
    expect(line?.hasAttribute('tabindex')).toBe(false);
  });

  it('keeps the entries a Lynx level cannot use, greyed, in the results', () => {
    editor.loadCompiledLevel(lynxRoom());
    type('laser');
    const buttons = gridButtons();
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.some((btn) => btn.getAttribute('aria-disabled') === 'true' && btn.classList.contains('is-unavailable'))).toBe(true);
  });

  it('refilters in the new language', () => {
    i18n.setLocale('fr');
    editor.refreshTranslations();
    type('PIEGE');
    expect(gridButtons().map(keyOf)).toContain('terrain:trap');
    i18n.setLocale('en');
    editor.refreshTranslations();
    // The English names and descriptions hold no "piege": the trap is gone and the English empty line shows.
    expect(gridButtons().map(keyOf)).not.toContain('terrain:trap');
    expect(gridButtons()).toHaveLength(0);
    expect(byId(GRID_ID).querySelector('p.palette-search-empty')?.textContent).toBe(t('editor.palette.search.no_match.label', { query: 'PIEGE' }));
    expect(t('editor.palette.search.no_match.label', { query: 'PIEGE' })).toContain('No entry matches');
  });

  it('opens the tab of the entry it picks', () => {
    type('hold door');
    const target = gridButtons().find((btn) => btn.dataset.brushKind === 'terrain');
    expect(target).toBeDefined();
    const category = ConfigRegistry.getTile(target?.dataset.brushId ?? '').category;
    const startingTab = tabButtons().findIndex((tab) => tab.getAttribute('aria-pressed') === 'true');
    expect(ConfigRegistry.getTiles().categories.findIndex((cat) => cat.id === category)).not.toBe(startingTab);
    target?.click();
    type('');
    const index = ConfigRegistry.getTiles().categories.findIndex((cat) => cat.id === category);
    expect(tabButtons()[index].getAttribute('aria-pressed')).toBe('true');
  });

  it('ends the search when a tab is clicked, and opens that tab', () => {
    type('door');
    tabButtons()[ConfigRegistry.getTiles().categories.findIndex((cat) => cat.id === MECHANISMS_CATEGORY)].click();
    expect(input().value).toBe('');
    expect(byId(COUNT_ID).textContent).toBe('');
    expect(tabButtons().filter((tab) => tab.getAttribute('aria-pressed') === 'true')).toHaveLength(1);
    expect(tabButtons().some((tab) => tab.classList.contains('is-dimmed'))).toBe(false);
  });

  it('ends the search when another level is loaded', () => {
    type('door');
    editor.loadCompiledLevel(lynxRoom());
    expect(input().value).toBe('');
    expect(tabButtons().some((tab) => tab.classList.contains('is-dimmed'))).toBe(false);
  });
});

describe('Palette search: keyboard', () => {
  it('Enter picks the first available match, clears the field and focuses the map', () => {
    editor.loadCompiledLevel(lynxRoom());
    // Under Lynx the hold doors rank first by name and are greyed; the trap and the red button match by description and are usable.
    type('hold');
    const buttons = gridButtons();
    expect(buttons[0].classList.contains(UNAVAILABLE_CLASS)).toBe(true);
    const usable = buttons.find((btn) => !btn.classList.contains(UNAVAILABLE_CLASS));
    expect(usable).toBeDefined();
    expect(buttons.indexOf(usable as HTMLButtonElement)).toBeGreaterThan(0);
    const key = keyOf(usable as HTMLButtonElement);
    input().focus();
    const event = press('Enter');
    expect(event.defaultPrevented).toBe(true);
    expect(input().value).toBe('');
    expect(document.activeElement).toBe(byId(CANVAS_ID));
    expect(gridButtons().find((btn) => keyOf(btn) === key)?.getAttribute('aria-pressed')).toBe('true');
  });

  it('Enter keeps the text and the focus when every match is greyed', () => {
    editor.loadCompiledLevel(lynxRoom());
    type('laser');
    expect(gridButtons().length).toBeGreaterThan(0);
    expect(gridButtons().every((btn) => btn.classList.contains(UNAVAILABLE_CLASS))).toBe(true);
    input().focus();
    press('Enter');
    expect(input().value).toBe('laser');
    expect(document.activeElement).toBe(input());
  });

  it('Enter in an empty or blank field changes nothing and keeps the focus', () => {
    input().focus();
    press('Enter');
    expect(document.activeElement).toBe(input());
    type('   ');
    press('Enter');
    expect(document.activeElement).toBe(input());
    expect(byId(GRID_ID).querySelector('p.palette-search-empty')).toBeNull();
  });

  it('Enter on epoxy rules picks the first match, which is not the brush in hand', () => {
    type('door');
    const first = gridButtons()[0];
    expect(first.getAttribute('aria-pressed')).toBe('false');
    const key = keyOf(first);
    input().focus();
    press('Enter');
    expect(input().value).toBe('');
    const picked = gridButtons().find((btn) => keyOf(btn) === key);
    expect(picked?.getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(byId(CANVAS_ID));
  });

  it('Enter, Escape and ArrowDown on the field do not reach the window key handler', () => {
    const seen = vi.fn();
    window.addEventListener('keydown', seen);
    try {
      input().focus();
      type('door');
      press('ArrowDown');
      input().focus();
      press('Enter');
      type('door');
      press('Escape');
      press('Escape');
      expect(seen).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', seen);
    }
  });

  it('ignores Enter while an input method composes, by flag or by key code', () => {
    type('door');
    for (const init of [{ isComposing: true }, { keyCode: 229 }]) {
      const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...init });
      input().dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
      expect(input().value).toBe('door');
    }
  });

  it('Enter does nothing when nothing matches', () => {
    byId(CANVAS_ID).focus();
    input().focus();
    type('zzzqqq');
    press('Enter');
    expect(input().value).toBe('zzzqqq');
    expect(document.activeElement).toBe(input());
  });

  it('Escape clears the text first, then leaves the field for the map', () => {
    input().focus();
    type('door');
    const first = press('Escape');
    expect(first.defaultPrevented).toBe(true);
    expect(input().value).toBe('');
    expect(document.activeElement).toBe(input());
    press('Escape');
    expect(document.activeElement).toBe(byId(CANVAS_ID));
  });

  it('ArrowDown moves the focus to the first result', () => {
    input().focus();
    type('door');
    const event = press('ArrowDown');
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(gridButtons()[0]);
  });

  it('typing never moves the focus out of the field', () => {
    input().focus();
    type('d');
    type('do');
    type('doo');
    expect(document.activeElement).toBe(input());
  });

  it('focusPaletteSearch puts the focus in the field', () => {
    editor.focusPaletteSearch();
    expect(document.activeElement).toBe(input());
  });
});

describe('isPaletteSearchKey', () => {
  const base = { key: '/', ctrlKey: false, metaKey: false, altKey: false, target: null as EventTarget | null };

  it('accepts a bare slash outside text fields', () => {
    expect(isPaletteSearchKey(base)).toBe(true);
    expect(isPaletteSearchKey({ ...base, target: document.createElement('button') })).toBe(true);
  });

  it('refuses other keys, command chords and text fields', () => {
    expect(isPaletteSearchKey({ ...base, key: '?' })).toBe(false);
    expect(isPaletteSearchKey({ ...base, ctrlKey: true })).toBe(false);
    expect(isPaletteSearchKey({ ...base, metaKey: true })).toBe(false);
    expect(isPaletteSearchKey({ ...base, altKey: true })).toBe(false);
    expect(isPaletteSearchKey({ ...base, target: input() })).toBe(false);
  });
});

describe('Palette search: result count for screen readers', () => {
  it('writes the count once, after the typing pauses, and only when it changed', () => {
    vi.useFakeTimers();
    type('w');
    type('wa');
    type('wal');
    type('wall');
    expect(byId(COUNT_ID).textContent).toBe('');
    vi.advanceTimersByTime(EDITOR_PALETTE_SEARCH_COUNT_DELAY_MS);
    const expected = t('editor.palette.search.count.label', { count: gridButtons().length });
    expect(byId(COUNT_ID).textContent).toBe(expected);
    byId(COUNT_ID).textContent = 'marker';
    type('wall ');
    vi.advanceTimersByTime(EDITOR_PALETTE_SEARCH_COUNT_DELAY_MS);
    // The same number again is not announced again.
    expect(byId(COUNT_ID).textContent).toBe('marker');
    type('');
    expect(byId(COUNT_ID).textContent).toBe('');
  });
});

describe('Palette search: other ways the search ends or is announced', () => {
  it('is cleared by the picker', () => {
    const canvas = byId<HTMLCanvasElement>(CANVAS_ID);
    canvas.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 0, bottom: 0, width: CELL_PX * 20, height: CELL_PX * 20, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    canvas.setPointerCapture = () => undefined;
    type('door');
    editor.handleKeyAction({ kind: 'tool', tool: 'picker' });
    canvas.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: CELL_PX / 2, clientY: CELL_PX / 2 }));
    window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    expect(input().value).toBe('');
    expect(tabButtons().some((tab) => tab.classList.contains('is-dimmed'))).toBe(false);
    expect(tabButtons().filter((tab) => tab.getAttribute('aria-pressed') === 'true')).toHaveLength(1);
  });

  it('writes the count again, in the new language, when the locale changes', () => {
    vi.useFakeTimers();
    type('wall');
    vi.advanceTimersByTime(EDITOR_PALETTE_SEARCH_COUNT_DELAY_MS);
    const count = gridButtons().length;
    expect(byId(COUNT_ID).textContent).toBe(t('editor.palette.search.count.label', { count }));
    i18n.setLocale('fr');
    editor.refreshTranslations();
    expect(byId(COUNT_ID).textContent).toBe(t('editor.palette.search.count.label', { count: gridButtons().length }));
    expect(byId(COUNT_ID).textContent).toContain('entr');
    expect(byId(COUNT_ID).textContent).not.toContain('match');
  });

  it('announces nothing after the editor is disposed', () => {
    vi.useFakeTimers();
    type('wall');
    editor.dispose();
    vi.advanceTimersByTime(EDITOR_PALETTE_SEARCH_COUNT_DELAY_MS * 2);
    expect(byId(COUNT_ID).textContent).toBe('');
  });
});

describe('Palette search: CC3D levels', () => {
  it('searches every CC3D tab by name and picks through the normal path', () => {
    editor.loadCompiledLevel(smallCc3dLevel());
    tabButtons()[CC3D_ITEMS_TAB].click();
    const label = gridButtons()[0].querySelector('.palette-item-label')?.textContent ?? '';
    expect(label).not.toBe('');
    const itemKey = keyOf(gridButtons()[0]);
    tabButtons()[0].click();
    type(label);
    const buttons = gridButtons();
    expect(buttons.map(keyOf)).toContain(itemKey);
    expect(buttons.every((btn) => btn.dataset.brushKind === 'cc3d')).toBe(true);
    press('Enter');
    expect(input().value).toBe('');
    expect(document.activeElement).toBe(byId(CANVAS_ID));
    const picked = gridButtons().find((btn) => keyOf(btn) === keyOf(buttons[0]));
    expect(picked?.getAttribute('aria-pressed')).toBe('true');
  });
});
