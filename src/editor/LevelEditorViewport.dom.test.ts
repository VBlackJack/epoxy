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
 * The level editor on a map larger than its stage: the keyboard cursor scrolls the map, a zoom keeps the cell
 * under the pointer, and an undo or redo brings the change into view and says what it was. The stage's sizes
 * are stubbed and its scroll made writable, as happy-dom does no layout.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const confirmDialog = vi.hoisted(() => vi.fn());
vi.mock('../ui/confirmDialog', () => ({ confirmDialog }));
vi.mock('../ui/saveIntoDialog', () => ({ askSaveInto: vi.fn() }));
vi.mock('../ui/download', async (importOriginal) => ({ ...(await importOriginal<typeof import('../ui/download')>()), downloadText: vi.fn() }));

import { t } from '../i18n/I18nManager';
import { LevelPackStorage } from '../storage/LevelPackStorage';
import { FakeIndexedDb } from '../test/FakeIndexedDb';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { mountModals } from '../test/domFixture';
import { compiledCc3d } from './cc3dEditorFixtures';
import { emptyCc3dRoom } from './cc3dRoom';
import { LevelEditor } from './LevelEditor';

const BASE_TILE = 24;
const ZOOMED_TILE = BASE_TILE + 8;
const STAGE_WIDTH = 200;
const STAGE_HEIGHT = 150;
const ROOM_WIDTH = 40;
const ROOM_HEIGHT = 30;
const ONE_PIXEL = 1;
const SMALL_ROOM_SIZE = 5;

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

/** Where the middle of a cell is on screen, with the stage at the screen origin. */
function screenOf(x: number, y: number, tile = BASE_TILE): { clientX: number; clientY: number } {
  return { clientX: (x + 0.5) * tile - stage.scrollLeft, clientY: (y + 0.5) * tile - stage.scrollTop };
}

function pointer(type: string, at: { clientX: number; clientY: number }): void {
  canvas.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, ...at }));
}

function click(x: number, y: number): void {
  pointer('pointerdown', screenOf(x, y));
  window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
}

function press(name: string): void {
  canvas.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
}

function scrollTo(left: number, top: number): void {
  stage.scrollLeft = left;
  stage.scrollTop = top;
}

function statusText(): string {
  return byId('editor-status-bar').textContent ?? '';
}

function selectWater(): void {
  document.querySelectorAll<HTMLButtonElement>('#editor-category-tabs button')[0].click();
  document.querySelectorAll<HTMLButtonElement>('#editor-palette-grid button')[1].click();
}

function openRoom(): void {
  editor.loadCompiledLevel(compiledCc3d(emptyCc3dRoom(ROOM_WIDTH, ROOM_HEIGHT)));
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

describe('the keyboard cursor on a large map', () => {
  it('scrolls the map when an arrow key moves the cursor past the edge of the stage', () => {
    openRoom();
    editor.setTool('picker');
    click(7, 2);
    expect(stage.scrollLeft).toBe(0);
    press('ArrowRight');
    // Cell 8 and a cell of margin end at 9 * 24 + 24 = 240 on a 200 wide stage.
    expect(stage.scrollLeft).toBe(40);
    expect(stage.scrollTop).toBe(0);
    press('ArrowDown');
    expect(stage.scrollTop).toBe(0);
    press('ArrowLeft');
    press('ArrowLeft');
    // Cell 6: its margin starts at 120, inside the view that begins at 40.
    expect(stage.scrollLeft).toBe(40);
    for (let i = 0; i < 3; i++) press('ArrowLeft');
    // Cell 3: its margin starts at 48, still inside the view that begins at 40.
    expect(stage.scrollLeft).toBe(40);
    press('ArrowLeft');
    // Cell 2: the margin starts at 24, before the scroll of 40.
    expect(stage.scrollLeft).toBe(24);
  });

  it('leaves the scroll alone while the cursor stays well inside the stage', () => {
    openRoom();
    editor.setTool('picker');
    click(3, 3);
    press('ArrowRight');
    press('ArrowDown');
    expect(stage.scrollLeft).toBe(0);
    expect(stage.scrollTop).toBe(0);
  });
});

describe('a map smaller than the stage', () => {
  it('never scrolls on arrow moves or zoom', () => {
    editor.loadCompiledLevel(compiledCc3d(emptyCc3dRoom(SMALL_ROOM_SIZE, SMALL_ROOM_SIZE)));
    editor.setTool('picker');
    click(2, 2);
    for (const key of ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'ArrowRight']) press(key);
    expect(stage.scrollLeft).toBe(0);
    expect(stage.scrollTop).toBe(0);
    editor.handleKeyAction({ kind: 'zoom_in' });
    editor.handleKeyAction({ kind: 'zoom_out' });
    expect(stage.scrollLeft).toBe(0);
    expect(stage.scrollTop).toBe(0);
  });
});

describe('zoom on a large map', () => {
  it('keeps the cell under the pointer where it was when the zoom comes from the keyboard', () => {
    openRoom();
    scrollTo(300, 200);
    const at = { clientX: 50, clientY: 40 };
    pointer('pointermove', at);
    const cellX = (stage.scrollLeft + at.clientX) / BASE_TILE;
    const cellY = (stage.scrollTop + at.clientY) / BASE_TILE;
    editor.handleKeyAction({ kind: 'zoom_in' });
    expect(Math.abs(stage.scrollLeft - (cellX * ZOOMED_TILE - at.clientX))).toBeLessThan(ONE_PIXEL);
    expect(Math.abs(stage.scrollTop - (cellY * ZOOMED_TILE - at.clientY))).toBeLessThan(ONE_PIXEL);
  });

  it('pivots on the middle of the stage once the pointer left the canvas (a zoom button)', () => {
    openRoom();
    scrollTo(300, 200);
    pointer('pointermove', { clientX: 50, clientY: 40 });
    pointer('pointerleave', { clientX: 250, clientY: 40 });
    byId<HTMLButtonElement>('editor-zoom-in-btn').click();
    const middleX = STAGE_WIDTH / 2;
    const middleY = STAGE_HEIGHT / 2;
    expect(Math.abs(stage.scrollLeft - (((300 + middleX) / BASE_TILE) * ZOOMED_TILE - middleX))).toBeLessThan(ONE_PIXEL);
    expect(Math.abs(stage.scrollTop - (((200 + middleY) / BASE_TILE) * ZOOMED_TILE - middleY))).toBeLessThan(ONE_PIXEL);
  });

  it('pivots on the cursor cell when it is in view and the pointer is away', () => {
    openRoom();
    editor.setTool('picker');
    scrollTo(200, 150);
    click(10, 8);
    const before = screenOf(10, 8);
    expect(before.clientX).toBeGreaterThan(0);
    byId<HTMLButtonElement>('editor-zoom-in-btn').click();
    expect(Math.abs(10.5 * ZOOMED_TILE - stage.scrollLeft - before.clientX)).toBeLessThan(ONE_PIXEL);
    expect(Math.abs(8.5 * ZOOMED_TILE - stage.scrollTop - before.clientY)).toBeLessThan(ONE_PIXEL);
  });

  it('keeps the scroll inside the map after the Fit key', () => {
    openRoom();
    scrollTo(300, 200);
    editor.handleKeyAction({ kind: 'zoom_in' });
    editor.handleKeyAction({ kind: 'zoom_fit' });
    expect(stage.scrollLeft).toBeGreaterThanOrEqual(0);
    expect(stage.scrollLeft).toBeLessThanOrEqual(ROOM_WIDTH * BASE_TILE - STAGE_WIDTH);
  });
});

describe('undo and redo on a large map', () => {
  it('scrolls to a change that is out of view and says where, then keeps the scroll when it is in view', () => {
    openRoom();
    selectWater();
    scrollTo(700, 500);
    click(35, 25);
    scrollTo(0, 0);
    editor.undo();
    // The cell and its margin end at 36 * 24 + 24 = 888 across and 26 * 24 + 24 = 648 down.
    expect(stage.scrollLeft).toBe(888 - STAGE_WIDTH);
    expect(stage.scrollTop).toBe(648 - STAGE_HEIGHT);
    expect(statusText()).toBe(t('editor.layout.status.undone_cells.label', { count: 1, x: 35, y: 25 }));
    expect(statusText()).toContain('(35, 25)');
    scrollTo(700, 500);
    editor.redo();
    expect(stage.scrollLeft).toBe(700);
    expect(stage.scrollTop).toBe(500);
    expect(statusText()).toBe(t('editor.layout.status.redone_cells.label', { count: 1, x: 35, y: 25 }));
  });

  it('keeps the cursor cell through an undo', () => {
    openRoom();
    selectWater();
    click(5, 5);
    editor.undo();
    expect(byId('editor-layers-cell').textContent).toBe(t('editor.cc3d.layers.cell', { x: 5, y: 5 }));
  });

  it('drops the cursor when the cell no longer exists, and says the new size', () => {
    openRoom();
    byId<HTMLInputElement>('editor-size-width').value = '20';
    byId<HTMLInputElement>('editor-size-height').value = '15';
    byId<HTMLButtonElement>('editor-size-apply-btn').click();
    editor.undo();
    expect(statusText()).toBe(t('editor.layout.status.undone_size.label', { width: ROOM_WIDTH, height: ROOM_HEIGHT }));
    editor.setTool('picker');
    click(35, 25);
    editor.redo();
    expect(statusText()).toBe(t('editor.layout.status.redone_size.label', { width: 20, height: 15 }));
    expect(byId('editor-layers-cell').textContent).toBe(t('editor.cc3d.layers.none'));
  });

  it('says level settings when only the settings changed', () => {
    openRoom();
    const title = byId<HTMLInputElement>('editor-meta-title');
    title.value = 'Another title';
    title.dispatchEvent(new Event('input', { bubbles: true }));
    title.dispatchEvent(new Event('change', { bubbles: true }));
    editor.undo();
    expect(statusText()).toBe(t('editor.layout.status.undone_settings.label'));
    editor.redo();
    expect(statusText()).toBe(t('editor.layout.status.redone_settings.label'));
  });

  it('names the changed cells of an Epoxy map too, and lets the message of a link session an undo ended win', () => {
    editor.initBlankMap();
    const state = editor as unknown as {
      brush: { kind: string; id: string };
      linkSession: { system: string; end: string; x: number; y: number } | null;
    };
    state.brush = { kind: 'terrain', id: 'button_brown' };
    click(3, 3);
    state.brush = { kind: 'terrain', id: 'wall' };
    click(5, 4);
    editor.undo();
    expect(statusText()).toBe(t('editor.layout.status.undone_cells.label', { count: 1, x: 5, y: 4 }));
    editor.redo();
    state.linkSession = { system: 'trap', end: 'button', x: 3, y: 3 };
    editor.undo();
    // The brown button is still there: the session stays open.
    expect(state.linkSession).not.toBeNull();
    expect(statusText()).toBe(t('editor.layout.status.undone_cells.label', { count: 1, x: 5, y: 4 }));
    editor.undo();
    expect(state.linkSession).toBeNull();
    expect(statusText()).toBe(t('editor.link.source_gone.label', { role: t('editor.connections.role.trap_button.label') }));
  });
});
