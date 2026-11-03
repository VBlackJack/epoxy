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
 * The issues list of the level editor: it fills after the check debounce and after Check, a row that names a
 * cell is a button that moves the cursor there, and a row whose cell is off the grid is plain text. The stage's
 * sizes are stubbed and its scroll made writable, as happy-dom does no layout.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const confirmDialog = vi.hoisted(() => vi.fn());
vi.mock('../ui/confirmDialog', () => ({ confirmDialog }));
vi.mock('../ui/saveIntoDialog', () => ({ askSaveInto: vi.fn() }));
vi.mock('../ui/download', async (importOriginal) => ({ ...(await importOriginal<typeof import('../ui/download')>()), downloadText: vi.fn() }));

import { EDITOR_CHECK_DEBOUNCE_MS } from '../ui/uiConstants';
import { i18n, t } from '../i18n/I18nManager';
import { LevelPackStorage } from '../storage/LevelPackStorage';
import { FakeIndexedDb } from '../test/FakeIndexedDb';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { mountModals } from '../test/domFixture';
import { compiledCc3d } from './cc3dEditorFixtures';
import type { Cc3dMob } from '../core/cc3d/model';
import { emptyCc3dRoom } from './cc3dRoom';
import { LevelEditor } from './LevelEditor';

const STAGE_WIDTH = 200;
const STAGE_HEIGHT = 150;
const ROOM_WIDTH = 40;
const ROOM_HEIGHT = 30;

const fake = new FakeIndexedDb();
let store: Map<string, string>;
let editor: LevelEditor;
let canvas: HTMLCanvasElement;
let stage: HTMLElement;

const noopContext = (): CanvasRenderingContext2D =>
  new Proxy(() => undefined, { get: () => noopContext(), set: () => true, apply: () => undefined }) as unknown as CanvasRenderingContext2D;

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element ${id}`);
  return el as T;
}

function rectOf(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, right: left + width, bottom: top + height, width, height, x: left, y: top, toJSON: () => ({}) } as DOMRect;
}

function press(name: string, init: KeyboardEventInit = {}): void {
  canvas.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init }));
}

function selectWater(): void {
  document.querySelectorAll<HTMLButtonElement>('#editor-category-tabs button')[0].click();
  document.querySelectorAll<HTMLButtonElement>('#editor-palette-grid button')[1].click();
}

const armedTimers = new Set<unknown>();

beforeEach(() => {
  const realSetTimeout = globalThis.setTimeout;
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
    const id = realSetTimeout(handler as () => void, delay, ...args);
    armedTimers.add(id);
    return id;
  }) as unknown as typeof setTimeout);
  loadTestConfigs();
  i18n.setLocale('en');
  fake.records.clear();
  store = new Map();
  vi.stubGlobal('indexedDB', fake);
  vi.stubGlobal('localStorage', {
    getItem: (name: string) => store.get(name) ?? null,
    setItem: (name: string, value: string) => void store.set(name, value),
    removeItem: (name: string) => void store.delete(name)
  });
  confirmDialog.mockReset();
  mountModals('editor-view');
  canvas = byId<HTMLCanvasElement>('editor-canvas');
  stage = byId('editor-stage');
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => noopContext()) as unknown as HTMLCanvasElement['getContext']);
  // A stage smaller than the map, scrollable, with the canvas following its scroll.
  for (const [name, value] of [
    ['clientWidth', STAGE_WIDTH],
    ['offsetWidth', STAGE_WIDTH],
    ['clientHeight', STAGE_HEIGHT],
    ['offsetHeight', STAGE_HEIGHT]
  ] as const) {
    Object.defineProperty(stage, name, { configurable: true, get: () => value });
  }
  for (const name of ['scrollLeft', 'scrollTop']) {
    Object.defineProperty(stage, name, { configurable: true, writable: true, value: 0 });
  }
  stage.getBoundingClientRect = () => rectOf(0, 0, STAGE_WIDTH, STAGE_HEIGHT);
  canvas.getBoundingClientRect = () =>
    rectOf(-stage.scrollLeft, -stage.scrollTop, parseFloat(canvas.style.width) || 0, parseFloat(canvas.style.height) || 0);
  canvas.getContext = (() => noopContext()) as unknown as HTMLCanvasElement['getContext'];
  canvas.setPointerCapture = () => undefined;
  const hooks = {
    onTestPlay: vi.fn(),
    onLevelSaved: vi.fn(),
    onNotify: vi.fn(),
    openManager: vi.fn(),
    importAsPack: vi.fn(),
    getConfigBundle: vi.fn()
  };
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
  editor = new LevelEditor(canvas, renderer as never, hooks as never);
  editor.buildUI();
});

afterEach(async () => {
  for (const id of armedTimers) clearTimeout(id as ReturnType<typeof setTimeout>);
  armedTimers.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await LevelPackStorage.closeConnection();
});


const DEBOUNCE_WAIT_MS = EDITOR_CHECK_DEBOUNCE_MS + 100;
const TWO_MOBS_CELL = { x: 12, y: 9 };
const OFF_GRID_MOB_X = -3;
const KEY_CELL_INDEX = 3 * ROOM_WIDTH + 3;
const SECTIONS_KEY_FRAGMENT = 'section';

const snappy = (x: number, y: number): Cc3dMob => ({ kind: 'snappy', x, y, dir: 'S' });

/** A room with two creatures on one cell (an error that names it) and one outside the grid (an error that names none). */
function openFlawedRoom(): void {
  const room = emptyCc3dRoom(ROOM_WIDTH, ROOM_HEIGHT);
  const mobs = [snappy(TWO_MOBS_CELL.x, TWO_MOBS_CELL.y), snappy(TWO_MOBS_CELL.x, TWO_MOBS_CELL.y), snappy(OFF_GRID_MOB_X, 2)];
  editor.loadCompiledLevel(compiledCc3d({ ...room, mobs }));
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => globalThis.setTimeout(resolve, ms));

function issueRowsOnScreen(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('#editor-issues-list .editor-issue-row'));
}

function issuesSection(): HTMLDetailsElement {
  return byId<HTMLDetailsElement>('editor-issues-section');
}

describe('the issues list', () => {
  it('invites a check before any, then fills after the debounce', async () => {
    openFlawedRoom();
    expect(issueRowsOnScreen()).toHaveLength(0);
    expect(byId('editor-issues-note').textContent).toBe(t('editor.issues.idle'));
    await wait(DEBOUNCE_WAIT_MS);
    expect(issueRowsOnScreen().length).toBeGreaterThanOrEqual(2);
    expect(byId('editor-issues-note').textContent).toBe('');
  });

  it('fills right after Check and opens the section', () => {
    openFlawedRoom();
    expect(issuesSection().open).toBe(false);
    byId<HTMLButtonElement>('editor-validate-btn').click();
    expect(issueRowsOnScreen().length).toBeGreaterThanOrEqual(2);
    expect(issuesSection().open).toBe(true);
  });

  it('says so when the level has no issue', () => {
    editor.loadCompiledLevel(compiledCc3d(emptyCc3dRoom(ROOM_WIDTH, ROOM_HEIGHT)));
    byId<HTMLButtonElement>('editor-validate-btn').click();
    expect(issueRowsOnScreen()).toHaveLength(0);
    expect(byId('editor-issues-note').textContent).toBe(t('editor.issues.none'));
  });

  it('makes a button of a row that names a cell and plain text of one that does not', () => {
    openFlawedRoom();
    byId<HTMLButtonElement>('editor-validate-btn').click();
    const rows = issueRowsOnScreen();
    const buttons = rows.filter((row) => row.tagName === 'BUTTON');
    const plain = rows.filter((row) => row.tagName !== 'BUTTON');
    expect(buttons.length).toBeGreaterThanOrEqual(1);
    expect(plain.length).toBeGreaterThanOrEqual(1);
    expect(plain.some((row) => row.textContent?.includes(`(${OFF_GRID_MOB_X}, 2)`))).toBe(true);
    expect(buttons.every((row) => row.dataset.severity === 'error')).toBe(true);
  });

  it('gives each row its severity as hidden text next to a glyph hidden from screen readers', () => {
    openFlawedRoom();
    byId<HTMLButtonElement>('editor-validate-btn').click();
    const rows = issueRowsOnScreen();
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const row of rows) {
      expect(row.querySelector('.sr-only')?.textContent).toBe(t('editor.issues.severity.error.label'));
      expect(row.querySelector('.editor-issue-glyph')?.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('gives a warning row the warning label', () => {
    const room = emptyCc3dRoom(ROOM_WIDTH, ROOM_HEIGHT);
    // A key with no door of its colour is a warning.
    const cells = room.cells.map((cell, index) => (index === KEY_CELL_INDEX ? { ...cell, item: { kind: 'key', color: 'red' } } : cell));
    editor.loadCompiledLevel(compiledCc3d({ ...room, cells } as never));
    byId<HTMLButtonElement>('editor-validate-btn').click();
    const warnings = issueRowsOnScreen().filter((row) => row.dataset.severity === 'warning');
    expect(warnings.length).toBeGreaterThanOrEqual(1);
    for (const row of warnings) {
      expect(row.querySelector('.sr-only')?.textContent).toBe(t('editor.issues.severity.warning.label'));
    }
  });

  it('goes back to the idle note and badge when another level is loaded', () => {
    openFlawedRoom();
    byId<HTMLButtonElement>('editor-validate-btn').click();
    expect(issueRowsOnScreen().length).toBeGreaterThanOrEqual(2);
    expect(byId('editor-check-badge').dataset.state).not.toBe('idle');
    editor.loadCompiledLevel(compiledCc3d(emptyCc3dRoom(ROOM_WIDTH, ROOM_HEIGHT)));
    expect(issueRowsOnScreen()).toHaveLength(0);
    expect(byId('editor-issues-note').textContent).toBe(t('editor.issues.idle'));
    expect(byId('editor-check-badge').dataset.state).toBe('idle');
    expect(byId('editor-check-badge').textContent).toBe(t('editor.layout.check.idle'));
  });

  it('gives the focus back to the same row index when the list is rebuilt', () => {
    openFlawedRoom();
    byId<HTMLButtonElement>('editor-validate-btn').click();
    const before = issueRowsOnScreen();
    const target = before.find((row) => row.tagName === 'BUTTON');
    expect(target).toBeDefined();
    const index = before.indexOf(target as HTMLElement);
    target?.focus();
    expect(document.activeElement).toBe(target);
    byId<HTMLButtonElement>('editor-validate-btn').click();
    const after = issueRowsOnScreen();
    expect(after[index]).not.toBe(target);
    expect(document.activeElement).toBe(after[index]);
  });

  it('moves the cursor, scrolls the stage and focuses the canvas when a row is clicked', () => {
    openFlawedRoom();
    byId<HTMLButtonElement>('editor-validate-btn').click();
    const focus = vi.spyOn(canvas, 'focus');
    const button = issueRowsOnScreen().find((row) => row.tagName === 'BUTTON');
    expect(button).toBeDefined();
    button?.click();
    expect(byId('editor-coords-badge').textContent).toBe(t('editor.palette.status.coords', TWO_MOBS_CELL));
    // The cell and a cell of margin end at (12 + 2) * 24 = 336 on a 200 wide stage, and (9 + 2) * 24 = 264 on a 150 high one.
    expect(stage.scrollLeft).toBe(136);
    expect(stage.scrollTop).toBe(114);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('keeps the section open or closed from one editor to the next', () => {
    openFlawedRoom();
    issuesSection().open = true;
    issuesSection().dispatchEvent(new Event('toggle'));
    const stored = Array.from(store.entries()).find(([name]) => name.toLowerCase().includes(SECTIONS_KEY_FRAGMENT));
    expect(stored).toBeDefined();
    expect(JSON.parse(stored?.[1] ?? '{}')).toMatchObject({ issues: true });
    editor.buildUI();
    expect(issuesSection().open).toBe(true);
  });

  it('shows the rows again in the new language after a switch', () => {
    openFlawedRoom();
    byId<HTMLButtonElement>('editor-validate-btn').click();
    const before = issueRowsOnScreen().map((row) => row.textContent);
    i18n.setLocale('fr');
    editor.refreshTranslations();
    const after = issueRowsOnScreen().map((row) => row.textContent);
    expect(after).toHaveLength(before.length);
    expect(after).not.toEqual(before);
    i18n.setLocale('en');
  });
});

describe('the keyboard cursor', () => {
  const coords = (): string | null => byId('editor-coords-badge').textContent;

  it('still moves while an arrow key is held', () => {
    editor.loadCompiledLevel(compiledCc3d(emptyCc3dRoom(ROOM_WIDTH, ROOM_HEIGHT)));
    press('ArrowRight');
    const first = coords();
    press('ArrowRight', { repeat: true });
    press('ArrowRight', { repeat: true });
    expect(coords()).not.toBe(first);
  });

  it('still extends the selection with Shift and an arrow', () => {
    editor.loadCompiledLevel(compiledCc3d(emptyCc3dRoom(ROOM_WIDTH, ROOM_HEIGHT)));
    document.querySelector<HTMLButtonElement>('[data-tool="select"]')?.click();
    press('ArrowRight');
    press('ArrowRight', { shiftKey: true });
    press('ArrowDown', { shiftKey: true });
    expect(byId('editor-status-bar').textContent).toBe(t('editor.selection.status.size', { width: 2, height: 2 }));
  });
});

describe('a key held on the canvas', () => {
  it('paints once, not on every repeat', () => {
    editor.loadCompiledLevel(compiledCc3d(emptyCc3dRoom(ROOM_WIDTH, ROOM_HEIGHT)));
    selectWater();
    press('ArrowRight');
    const apply = vi.spyOn(editor as unknown as { applyAt: (x: number, y: number, dir: string) => void }, 'applyAt');
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(apply).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 3; i++) {
      canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true, cancelable: true }));
    }
    expect(apply).toHaveBeenCalledTimes(1);
  });
});
