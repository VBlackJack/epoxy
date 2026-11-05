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
import { i18n } from '../i18n/I18nManager';
import { LevelPackStorage } from '../storage/LevelPackStorage';
import { FakeIndexedDb } from '../test/FakeIndexedDb';
import { mountModals } from '../test/domFixture';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { smallCc3dLevel } from './cc3dEditorFixtures';
import { LevelEditor } from './LevelEditor';

const GRID_ID = 'editor-palette-grid';
const TABS_ID = 'editor-category-tabs';
const INPUT_ID = 'editor-palette-search';
const CANVAS_ID = 'editor-canvas';
const MECHANISMS_CATEGORY = 'mechanisms';
const ROOM_SIZE = 5;
const CELL_PX = 10;
const CC3D_ITEMS_TAB = 3;
const CC3D_KEY_ENTRY_ID = 'item:key';
const TAB_STOP = '0';
const OFF_STOP = '-1';

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
const stops = (): HTMLButtonElement[] => gridButtons().filter((btn) => btn.getAttribute('tabindex') === TAB_STOP);
const offStops = (): HTMLButtonElement[] => gridButtons().filter((btn) => btn.getAttribute('tabindex') === OFF_STOP);

function type(text: string): void {
  input().value = text;
  input().dispatchEvent(new Event('input', { bubbles: true }));
}

/** Presses a key on an element; the event bubbles like a real one. */
function press(target: HTMLElement, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

function openCategory(categoryId: string): void {
  tabButtons()[ConfigRegistry.getTiles().categories.findIndex((cat) => cat.id === categoryId)].click();
}

function lynxRoom(): CompiledLevel {
  const terrain: string[][] = Array.from({ length: ROOM_SIZE }, (_, y) =>
    Array.from({ length: ROOM_SIZE }, (_, x) => (x === 0 || y === 0 || x === ROOM_SIZE - 1 || y === ROOM_SIZE - 1 ? 'wall' : 'floor'))
  );
  return {
    id: 'lvl_roving_lynx',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    customTitle: 'Roving room',
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await LevelPackStorage.closeConnection();
});

describe('Palette roving tabindex: the Tab stop', () => {
  it('has exactly one entry in the Tab order, the one in hand, and every other entry out of it', () => {
    const buttons = gridButtons();
    expect(buttons.length).toBeGreaterThan(2);
    expect(stops()).toHaveLength(1);
    expect(offStops()).toHaveLength(buttons.length - 1);
    expect(stops()[0].getAttribute('aria-pressed')).toBe('true');
  });

  it('falls back to the first entry when the brush in hand is on another tab', () => {
    openCategory(MECHANISMS_CATEGORY);
    expect(gridButtons().some((btn) => btn.getAttribute('aria-pressed') === 'true')).toBe(false);
    expect(stops()).toEqual([gridButtons()[0]]);
  });

  it('follows the focus and keeps the entry through a redraw, even when the focus is elsewhere', () => {
    const buttons = gridButtons();
    buttons[2].focus();
    expect(stops()).toEqual([buttons[2]]);
    byId(CANVAS_ID).focus();
    // A language change redraws the whole grid.
    editor.refreshTranslations();
    const again = gridButtons();
    expect(stops()).toHaveLength(1);
    expect(stops()[0].dataset.brushId).toBe(buttons[2].dataset.brushId);
    expect(again.filter((btn) => btn.getAttribute('tabindex') === OFF_STOP)).toHaveLength(again.length - 1);
  });

  it('keeps the focus on the entry that was clicked after the redraw', () => {
    const buttons = gridButtons();
    buttons[1].focus();
    buttons[1].click();
    expect(document.activeElement?.getAttribute('data-brush-id')).toBe(buttons[1].dataset.brushId);
    expect(stops()).toHaveLength(1);
    expect(stops()[0]).toBe(document.activeElement);
  });
});

describe('Palette roving tabindex: arrow keys', () => {
  it('Right and Down go to the next entry, Left and Up to the previous, and the stop follows', () => {
    const buttons = gridButtons();
    buttons[0].focus();
    expect(press(buttons[0], 'ArrowRight').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(buttons[1]);
    expect(stops()).toEqual([buttons[1]]);
    press(buttons[1], 'ArrowDown');
    expect(document.activeElement).toBe(buttons[2]);
    press(buttons[2], 'ArrowLeft');
    expect(document.activeElement).toBe(buttons[1]);
    press(buttons[1], 'ArrowUp');
    expect(document.activeElement).toBe(buttons[0]);
    expect(stops()).toEqual([buttons[0]]);
  });

  it('Home and End go to the first and the last entry', () => {
    const buttons = gridButtons();
    buttons[1].focus();
    press(buttons[1], 'End');
    expect(document.activeElement).toBe(buttons[buttons.length - 1]);
    expect(stops()).toEqual([buttons[buttons.length - 1]]);
    press(buttons[buttons.length - 1], 'Home');
    expect(document.activeElement).toBe(buttons[0]);
  });

  it('does not wrap at either end, and still takes the key', () => {
    const buttons = gridButtons();
    const last = buttons[buttons.length - 1];
    buttons[0].focus();
    expect(press(buttons[0], 'ArrowLeft').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(buttons[0]);
    last.focus();
    expect(press(last, 'ArrowDown').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);
  });

  it('skips the sub-headings of the Mechanisms tab and visits every entry in order', () => {
    openCategory(MECHANISMS_CATEGORY);
    expect(byId(GRID_ID).querySelector('h4')).not.toBeNull();
    const buttons = gridButtons();
    buttons[0].focus();
    const visited: Element[] = [document.activeElement as Element];
    for (let i = 1; i < buttons.length; i += 1) {
      press(document.activeElement as HTMLElement, 'ArrowRight');
      visited.push(document.activeElement as Element);
    }
    expect(visited).toEqual(buttons);
    expect(visited.every((el) => el.tagName === 'BUTTON')).toBe(true);
  });

  it('reaches an entry a Lynx level cannot use', () => {
    editor.loadCompiledLevel(lynxRoom());
    const buttons = gridButtons();
    const greyed = buttons.findIndex((btn) => btn.getAttribute('aria-disabled') === 'true');
    expect(greyed).toBeGreaterThan(-1);
    const before = greyed === 0 ? 1 : greyed - 1;
    buttons[before].focus();
    press(buttons[before], greyed === 0 ? 'ArrowLeft' : 'ArrowRight');
    expect(document.activeElement).toBe(buttons[greyed === 0 ? 0 : greyed]);
    expect(stops()).toEqual([buttons[greyed]]);
  });

  it('keeps the arrow keys away from the window shortcuts and from the map cursor', () => {
    const seen = vi.fn();
    window.addEventListener('keydown', seen);
    try {
      const buttons = gridButtons();
      buttons[0].focus();
      for (const key of ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'End', 'Home']) press(document.activeElement as HTMLElement, key);
      expect(seen).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', seen);
    }
  });

  it('leaves other keys and modified arrows alone', () => {
    const buttons = gridButtons();
    buttons[0].focus();
    expect(press(buttons[0], 'Enter').defaultPrevented).toBe(false);
    expect(press(buttons[0], ' ').defaultPrevented).toBe(false);
    expect(press(buttons[0], 'ArrowRight', { altKey: true }).defaultPrevented).toBe(false);
    expect(press(buttons[0], 'ArrowRight', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(buttons[0]);
  });
});

describe('Palette roving tabindex: search results', () => {
  it('ArrowDown from the field focuses the first result, which becomes the Tab stop', () => {
    input().focus();
    type('door');
    press(input(), 'ArrowDown');
    const results = gridButtons();
    expect(document.activeElement).toBe(results[0]);
    expect(stops()).toEqual([results[0]]);
    press(results[0], 'ArrowRight');
    expect(document.activeElement).toBe(results[1]);
    expect(stops()).toEqual([results[1]]);
  });

  it('keeps one Tab stop in the results', () => {
    type('door');
    expect(stops()).toHaveLength(1);
    expect(offStops()).toHaveLength(gridButtons().length - 1);
  });

  it('ArrowUp on the first result returns to the search field, and only there', () => {
    input().focus();
    type('door');
    press(input(), 'ArrowDown');
    const results = gridButtons();
    press(results[1], 'ArrowUp');
    expect(document.activeElement).toBe(results[0]);
    expect(press(results[0], 'ArrowUp').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(input());
  });

  it('ArrowUp on the first entry without a search stays put', () => {
    const buttons = gridButtons();
    buttons[0].focus();
    press(buttons[0], 'ArrowUp');
    expect(document.activeElement).toBe(buttons[0]);
  });

  it('does nothing in a grid that holds only the no-match line', () => {
    type('zzzqqq');
    expect(gridButtons()).toHaveLength(0);
    expect(byId(GRID_ID).querySelector('p.palette-search-empty')).not.toBeNull();
    expect(press(byId(GRID_ID), 'ArrowDown').defaultPrevented).toBe(false);
  });
});

describe('Palette roving tabindex: CC3D grid', () => {
  it('is one Tab stop and navigable with the arrow keys', () => {
    editor.loadCompiledLevel(smallCc3dLevel());
    const buttons = gridButtons();
    expect(buttons.length).toBeGreaterThan(2);
    expect(stops()).toHaveLength(1);
    buttons[0].focus();
    press(buttons[0], 'ArrowRight');
    expect(document.activeElement).toBe(buttons[1]);
    expect(stops()).toEqual([buttons[1]]);
    press(buttons[1], 'End');
    expect(document.activeElement).toBe(buttons[buttons.length - 1]);
  });

  it('leaves the colour, corner and mirror choosers outside the roving stop', () => {
    editor.loadCompiledLevel(smallCc3dLevel());
    tabButtons()[CC3D_ITEMS_TAB].click();
    const key = gridButtons().find((btn) => btn.dataset.brushId === CC3D_KEY_ENTRY_ID);
    expect(key).toBeDefined();
    key?.click();
    const choosers = Array.from(document.querySelectorAll<HTMLButtonElement>('#editor-cc3d-attrs button'));
    expect(choosers.length).toBeGreaterThan(0);
    for (const choice of choosers) expect(choice.hasAttribute('tabindex')).toBe(false);
    choosers[0].focus();
    expect(press(choosers[0], 'ArrowRight').defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(choosers[0]);
  });
});

describe('Palette roving tabindex: a choice made without the palette focus', () => {
  it('moves the stop to the brush in hand after a pick through the search', () => {
    const buttons = gridButtons();
    buttons[2].focus();
    expect(stops()).toEqual([buttons[2]]);
    input().focus();
    type('door');
    press(input(), 'Enter');
    expect(stops()).toHaveLength(1);
    expect(stops()[0].getAttribute('aria-pressed')).toBe('true');
    expect(stops()[0].dataset.brushId).not.toBe(buttons[2].dataset.brushId);
  });

  it('moves the stop to the brush in hand after the eyedropper', () => {
    const canvas = byId<HTMLCanvasElement>(CANVAS_ID);
    canvas.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 0, bottom: 0, width: CELL_PX * 20, height: CELL_PX * 20, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    canvas.setPointerCapture = () => undefined;
    gridButtons()[2].focus();
    editor.handleKeyAction({ kind: 'tool', tool: 'picker' });
    canvas.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: CELL_PX / 2, clientY: CELL_PX / 2 }));
    window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    expect(stops()).toHaveLength(1);
    expect(stops()[0].getAttribute('aria-pressed')).toBe('true');
  });
});
