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
 * Touch editing on the level editor canvas: one finger edits as a mouse does, a second finger takes a young stroke
 * back and turns into a pan or pinch, and a floating paste or a link session acts on the lift of a single finger.
 * Pointer events carry pointerType "touch" and a pointer id; the stage is stubbed as in the viewport suite.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const confirmDialog = vi.hoisted(() => vi.fn());
vi.mock('../ui/confirmDialog', () => ({ confirmDialog }));
vi.mock('../ui/saveIntoDialog', () => ({ askSaveInto: vi.fn() }));
vi.mock('../ui/download', async (importOriginal) => ({ ...(await importOriginal<typeof import('../ui/download')>()), downloadText: vi.fn() }));

import type { CompiledLevel } from '../core/types';
import { LevelPackStorage } from '../storage/LevelPackStorage';
import { FakeIndexedDb } from '../test/FakeIndexedDb';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { mountModals } from '../test/domFixture';
import { EDITOR_DRAFT_STORAGE_PREFIX, EDITOR_DRAFT_WRITE_DELAY_MS, EDITOR_TOUCH_LONG_PRESS_MS, EDITOR_TOUCH_PINCH_START_PX, EDITOR_TOUCH_STROKE_GRACE_MS, EDITOR_TOUCH_TAP_SLOP_PX } from '../ui/uiConstants';
import { t } from '../i18n/I18nManager';
import { ConfigRegistry } from '../config/ConfigRegistry';
import { compiledCc3d } from './cc3dEditorFixtures';
import { emptyCc3dRoom } from './cc3dRoom';
import { LevelEditor } from './LevelEditor';

const STAGE_WIDTH = 200;
const STAGE_HEIGHT = 150;
const ROOM_WIDTH = 40;
const ROOM_HEIGHT = 30;
const SMALL_WIDTH = 10;
const SMALL_HEIGHT = 7;
const BUTTON = { x: 3, y: 2 };
const TRAP = { x: 6, y: 2 };
const FINGER_A = 1;
const FINGER_B = 2;
const FINGER_C = 3;
const PAN_FROM = 50;
const FAR_APART = 100;
const LATE_SECOND_FINGER_MS = 100;
const DRAFT_MARGIN_MS = 100;

const fake = new FakeIndexedDb();
let store: Map<string, string>;
let editor: LevelEditor;
let canvas: HTMLCanvasElement;
let stage: HTMLElement;
let clock: number;

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

interface Point {
  clientX: number;
  clientY: number;
}

/** Where the middle of a cell is on screen, from the canvas box the editor is drawing. */
function cellPoint(x: number, y: number, mapWidth: number): Point {
  const rect = canvas.getBoundingClientRect();
  const tile = rect.width / mapWidth;
  return { clientX: rect.left + (x + 0.5) * tile, clientY: rect.top + (y + 0.5) * tile };
}

/** A pointer event of a finger; lifts and cancels go to the window, as a captured pointer's events bubble there. */
function finger(
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel' | 'lostpointercapture',
  id: number,
  at: Point,
  extra: { isPrimary?: boolean; pointerType?: string } = {}
): void {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, ...at });
  Object.defineProperty(ev, 'pointerType', { value: extra.pointerType ?? 'touch' });
  Object.defineProperty(ev, 'pointerId', { value: id });
  if (extra.isPrimary !== undefined) Object.defineProperty(ev, 'isPrimary', { value: extra.isPrimary });
  (type === 'pointerup' || type === 'pointercancel' ? window : canvas).dispatchEvent(ev);
}

function mouse(type: string, at: Point): void {
  (type === 'pointerup' ? window : canvas).dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, ...at }));
}

const at = (clientX: number, clientY: number): Point => ({ clientX, clientY });
const statusText = (): string => byId('editor-status-bar').textContent ?? '';
const draftKeys = (): string[] => [...store.keys()].filter((key) => key.startsWith(ConfigRegistry.getStorageKey(EDITOR_DRAFT_STORAGE_PREFIX)));
const realPause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const levelJson = (): string => JSON.stringify(editor.exportCompiledLevel());
const undoDepth = (): number => (editor as unknown as { history: { undoStack: unknown[] } }).history.undoStack.length;
const zoomOffset = (): number => (editor as unknown as { zoomOffset: number }).zoomOffset;

function selectWater(): void {
  document.querySelectorAll<HTMLButtonElement>('#editor-category-tabs button')[0].click();
  document.querySelectorAll<HTMLButtonElement>('#editor-palette-grid button')[1].click();
}

function openRoom(): void {
  editor.loadCompiledLevel(compiledCc3d(emptyCc3dRoom(ROOM_WIDTH, ROOM_HEIGHT)));
  selectWater();
}

/** A walled Epoxy room with a brown button and a trap, linked or not. */
function trapRoom(linked: boolean): CompiledLevel {
  const terrain: string[][] = Array.from({ length: SMALL_HEIGHT }, (_, y) =>
    Array.from({ length: SMALL_WIDTH }, (_, x) => (x === 0 || y === 0 || x === SMALL_WIDTH - 1 || y === SMALL_HEIGHT - 1 ? 'wall' : 'floor'))
  );
  terrain[SMALL_HEIGHT - 2][SMALL_WIDTH - 2] = 'exit';
  terrain[BUTTON.y][BUTTON.x] = 'button_brown';
  terrain[TRAP.y][TRAP.x] = 'trap';
  return {
    id: 'lvl_touch_dom',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    customTitle: 'Touch room',
    playerStart: { x: 1, y: 1, dir: 'S' },
    terrain,
    items: terrain.map((row) => row.map(() => null as string | null)),
    entities: [],
    trapLinks: linked ? [{ buttonX: BUTTON.x, buttonY: BUTTON.y, trapX: TRAP.x, trapY: TRAP.y }] : [],
    cloneLinks: []
  };
}

function scrollTo(left: number, top: number): void {
  stage.scrollLeft = left;
  stage.scrollTop = top;
}

/** Two fingers down at the given spots; the stroke the first one began is young unless the clock moved. */
function twoFingersDown(a: Point, b: Point): void {
  finger('pointerdown', FINGER_A, a);
  finger('pointerdown', FINGER_B, b);
}

const armedTimers = new Set<unknown>();

beforeEach(() => {
  const realSetTimeout = globalThis.setTimeout;
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
    const id = realSetTimeout(handler as () => void, delay, ...args);
    armedTimers.add(id);
    return id;
  }) as unknown as typeof setTimeout);
  clock = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
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
  const hooks = { onTestPlay: vi.fn(), onLevelSaved: vi.fn(), onNotify: vi.fn(), openManager: vi.fn(), importAsPack: vi.fn(), getConfigBundle: vi.fn() };
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

describe('one finger', () => {
  it('paints as a mouse does: one stroke, one history step', () => {
    openRoom();
    const before = levelJson();
    finger('pointerdown', FINGER_A, cellPoint(3, 3, ROOM_WIDTH));
    finger('pointermove', FINGER_A, cellPoint(4, 3, ROOM_WIDTH));
    finger('pointermove', FINGER_A, cellPoint(5, 3, ROOM_WIDTH));
    finger('pointerup', FINGER_A, cellPoint(5, 3, ROOM_WIDTH));
    expect(levelJson()).not.toBe(before);
    expect(undoDepth()).toBe(1);
  });

  it('paints again with a new touch once every finger is up', () => {
    openRoom();
    twoFingersDown(cellPoint(3, 3, ROOM_WIDTH), cellPoint(8, 3, ROOM_WIDTH));
    finger('pointerup', FINGER_B, cellPoint(8, 3, ROOM_WIDTH));
    finger('pointerup', FINGER_A, cellPoint(3, 3, ROOM_WIDTH));
    expect(undoDepth()).toBe(0);
    finger('pointerdown', FINGER_C, cellPoint(6, 6, ROOM_WIDTH));
    finger('pointerup', FINGER_C, cellPoint(6, 6, ROOM_WIDTH));
    expect(undoDepth()).toBe(1);
  });
});

describe('a second finger', () => {
  it('within the grace period takes the stroke back: the level is as before, no history step, the status restored', () => {
    openRoom();
    const before = levelJson();
    const statusBefore = statusText();
    finger('pointerdown', FINGER_A, cellPoint(3, 3, ROOM_WIDTH));
    expect(levelJson()).not.toBe(before);
    clock = EDITOR_TOUCH_STROKE_GRACE_MS - 1;
    finger('pointerdown', FINGER_B, cellPoint(8, 3, ROOM_WIDTH));
    expect(levelJson()).toBe(before);
    expect(undoDepth()).toBe(0);
    expect(statusText()).toBe(statusBefore);
    finger('pointerup', FINGER_B, cellPoint(8, 3, ROOM_WIDTH));
    finger('pointerup', FINGER_A, cellPoint(3, 3, ROOM_WIDTH));
    expect(undoDepth()).toBe(0);
    expect(levelJson()).toBe(before);
  });

  it('after the grace period keeps the stroke of a finger that moved to another cell as one history step, and its draft', async () => {
    openRoom();
    const before = levelJson();
    finger('pointerdown', FINGER_A, cellPoint(3, 3, ROOM_WIDTH));
    finger('pointermove', FINGER_A, cellPoint(4, 3, ROOM_WIDTH));
    clock = EDITOR_TOUCH_STROKE_GRACE_MS;
    finger('pointerdown', FINGER_B, cellPoint(8, 3, ROOM_WIDTH));
    expect(levelJson()).not.toBe(before);
    expect(undoDepth()).toBe(1);
    finger('pointerup', FINGER_B, cellPoint(8, 3, ROOM_WIDTH));
    finger('pointerup', FINGER_A, cellPoint(4, 3, ROOM_WIDTH));
    expect(undoDepth()).toBe(1);
    expect(editor.hasUnsavedChanges()).toBe(true);
    await realPause(EDITOR_DRAFT_WRITE_DELAY_MS + DRAFT_MARGIN_MS);
    expect(draftKeys()).toHaveLength(1);
  });

  it('after the grace period takes back the stroke of a finger that stayed on its cell: no step, nothing unsaved, no draft', async () => {
    openRoom();
    const before = levelJson();
    finger('pointerdown', FINGER_A, cellPoint(3, 3, ROOM_WIDTH));
    expect(levelJson()).not.toBe(before);
    clock = EDITOR_TOUCH_STROKE_GRACE_MS + LATE_SECOND_FINGER_MS;
    finger('pointerdown', FINGER_B, cellPoint(8, 3, ROOM_WIDTH));
    expect(levelJson()).toBe(before);
    expect(undoDepth()).toBe(0);
    expect(editor.hasUnsavedChanges()).toBe(false);
    finger('pointerup', FINGER_B, cellPoint(8, 3, ROOM_WIDTH));
    finger('pointerup', FINGER_A, cellPoint(3, 3, ROOM_WIDTH));
    expect(undoDepth()).toBe(0);
    expect(levelJson()).toBe(before);
    await realPause(EDITOR_DRAFT_WRITE_DELAY_MS + DRAFT_MARGIN_MS);
    expect(draftKeys()).toEqual([]);
  });

  it('pans the map by the midpoint move and paints nothing', () => {
    openRoom();
    scrollTo(PAN_FROM, PAN_FROM);
    const before = levelJson();
    const a = at(100, 100);
    const b = at(140, 100);
    twoFingersDown(a, b);
    finger('pointermove', FINGER_A, at(110, 120));
    finger('pointermove', FINGER_B, at(150, 120));
    expect(stage.scrollLeft).toBe(PAN_FROM - 10);
    expect(stage.scrollTop).toBe(PAN_FROM - 20);
    expect(levelJson()).toBe(before);
    expect(undoDepth()).toBe(0);
    finger('pointerup', FINGER_B, at(150, 120));
    finger('pointerup', FINGER_A, at(110, 120));
    expect(undoDepth()).toBe(0);
  });

  it('lifting one finger ends the gesture: the finger left never paints', () => {
    openRoom();
    const before = levelJson();
    twoFingersDown(cellPoint(3, 3, ROOM_WIDTH), cellPoint(8, 3, ROOM_WIDTH));
    finger('pointerup', FINGER_B, cellPoint(8, 3, ROOM_WIDTH));
    const scroll = stage.scrollLeft;
    finger('pointermove', FINGER_A, cellPoint(4, 3, ROOM_WIDTH));
    finger('pointermove', FINGER_A, cellPoint(5, 4, ROOM_WIDTH));
    expect(levelJson()).toBe(before);
    expect(stage.scrollLeft).toBe(scroll);
    finger('pointerup', FINGER_A, cellPoint(5, 4, ROOM_WIDTH));
    expect(undoDepth()).toBe(0);
  });

  it('is ignored as a third finger and does not end the gesture', () => {
    openRoom();
    scrollTo(PAN_FROM, PAN_FROM);
    twoFingersDown(at(100, 100), at(140, 100));
    finger('pointerdown', FINGER_C, at(60, 60));
    finger('pointermove', FINGER_A, at(110, 100));
    finger('pointermove', FINGER_B, at(150, 100));
    expect(stage.scrollLeft).toBe(PAN_FROM - 10);
    finger('pointerup', FINGER_C, at(60, 60));
    expect(undoDepth()).toBe(0);
  });
});

describe('a pinch', () => {
  const pinchTo = (distance: number): void => {
    finger('pointermove', FINGER_B, at(100 + distance, 100));
  };

  it('below the start threshold does not zoom', () => {
    openRoom();
    twoFingersDown(at(100, 100), at(100 + FAR_APART, 100));
    pinchTo(FAR_APART + EDITOR_TOUCH_PINCH_START_PX - 1);
    expect(zoomOffset()).toBe(0);
  });

  it('above the threshold zooms in exactly one step, and not again for a small further move', () => {
    openRoom();
    twoFingersDown(at(100, 100), at(100 + FAR_APART, 100));
    pinchTo(FAR_APART + FAR_APART / 2);
    expect(zoomOffset()).toBe(1);
    pinchTo(FAR_APART + FAR_APART / 2 + 5);
    expect(zoomOffset()).toBe(1);
    expect(undoDepth()).toBe(0);
  });

  it('does nothing when the zoom guard blocks the step (already at the smallest tile)', () => {
    openRoom();
    twoFingersDown(at(100, 100), at(100 + FAR_APART, 100));
    pinchTo(FAR_APART / 2);
    expect(zoomOffset()).toBe(0);
  });
});

describe('a floating paste', () => {
  function startPaste(): void {
    editor.loadCompiledLevel(trapRoom(false));
    editor.setTool('select');
    mouse('pointerdown', cellPoint(0, 0, SMALL_WIDTH));
    mouse('pointerup', cellPoint(0, 0, SMALL_WIDTH));
    expect(editor.handleSelectionAction({ kind: 'copy' })).toBe(true);
    expect(editor.handleSelectionAction({ kind: 'paste' })).toBe(true);
    expect(editor['pasting']).toBe(true);
  }

  it('is not placed by a two-finger pan', () => {
    startPaste();
    const before = levelJson();
    twoFingersDown(cellPoint(4, 3, SMALL_WIDTH), cellPoint(5, 3, SMALL_WIDTH));
    finger('pointermove', FINGER_A, cellPoint(4, 4, SMALL_WIDTH));
    finger('pointermove', FINGER_B, cellPoint(5, 4, SMALL_WIDTH));
    finger('pointerup', FINGER_B, cellPoint(5, 4, SMALL_WIDTH));
    finger('pointerup', FINGER_A, cellPoint(4, 4, SMALL_WIDTH));
    expect(editor['pasting']).toBe(true);
    expect(levelJson()).toBe(before);
  });

  it('is not placed when the finger lands, only when it lifts', () => {
    startPaste();
    const before = levelJson();
    finger('pointerdown', FINGER_A, cellPoint(4, 3, SMALL_WIDTH));
    expect(editor['pasting']).toBe(true);
    expect(levelJson()).toBe(before);
    finger('pointerup', FINGER_A, cellPoint(4, 3, SMALL_WIDTH));
    expect(editor['pasting']).toBe(false);
    expect(levelJson()).not.toBe(before);
  });

  it('follows a dragging finger and is placed where it lifts', () => {
    startPaste();
    finger('pointerdown', FINGER_A, cellPoint(4, 3, SMALL_WIDTH));
    finger('pointermove', FINGER_A, cellPoint(6, 4, SMALL_WIDTH));
    expect(editor['pasteAnchor']).toEqual({ x: 6, y: 4 });
    finger('pointerup', FINGER_A, cellPoint(6, 4, SMALL_WIDTH));
    expect(editor['pasting']).toBe(false);
    expect(editor.exportCompiledLevel().terrain[4][6]).toBe('wall');
  });
});

describe('a link session', () => {
  function startSession(): void {
    editor.loadCompiledLevel(trapRoom(false));
    editor['moveCursorTo'](BUTTON, false);
    byId<HTMLButtonElement>('editor-connections-link-btn').click();
    expect(editor['linkSession']).not.toBeNull();
  }

  it('is not changed by a pan', () => {
    startSession();
    twoFingersDown(cellPoint(TRAP.x, TRAP.y, SMALL_WIDTH), cellPoint(8, 5, SMALL_WIDTH));
    finger('pointermove', FINGER_A, cellPoint(TRAP.x, TRAP.y + 1, SMALL_WIDTH));
    finger('pointerup', FINGER_B, cellPoint(8, 5, SMALL_WIDTH));
    finger('pointerup', FINGER_A, cellPoint(TRAP.x, TRAP.y + 1, SMALL_WIDTH));
    expect(editor.exportCompiledLevel().trapLinks).toEqual([]);
  });

  it('is not changed by a finger that travels past the tap slop before it lifts', () => {
    startSession();
    const start = cellPoint(TRAP.x, TRAP.y, SMALL_WIDTH);
    finger('pointerdown', FINGER_A, start);
    finger('pointermove', FINGER_A, at(start.clientX + EDITOR_TOUCH_TAP_SLOP_PX + 1, start.clientY));
    finger('pointerup', FINGER_A, start);
    expect(editor.exportCompiledLevel().trapLinks).toEqual([]);
  });

  it('is changed by a tap, on the lift', () => {
    startSession();
    finger('pointerdown', FINGER_A, cellPoint(TRAP.x, TRAP.y, SMALL_WIDTH));
    expect(editor.exportCompiledLevel().trapLinks).toEqual([]);
    finger('pointerup', FINGER_A, cellPoint(TRAP.x, TRAP.y, SMALL_WIDTH));
    expect(editor.exportCompiledLevel().trapLinks).toEqual([{ buttonX: BUTTON.x, buttonY: BUTTON.y, trapX: TRAP.x, trapY: TRAP.y }]);
    expect(editor['linkSession']).not.toBeNull();
  });
});

describe('a cancelled touch', () => {
  it('keeps a stroke older than the grace period as one step', () => {
    openRoom();
    finger('pointerdown', FINGER_A, cellPoint(3, 3, ROOM_WIDTH));
    clock = EDITOR_TOUCH_STROKE_GRACE_MS;
    finger('pointercancel', FINGER_A, cellPoint(3, 3, ROOM_WIDTH));
    expect(undoDepth()).toBe(1);
    expect(editor['stroke']).toBeNull();
  });

  it('takes back a stroke within the grace period: no history step, the level as before', () => {
    openRoom();
    const before = levelJson();
    finger('pointerdown', FINGER_A, cellPoint(3, 3, ROOM_WIDTH));
    expect(levelJson()).not.toBe(before);
    finger('pointercancel', FINGER_A, cellPoint(3, 3, ROOM_WIDTH));
    expect(undoDepth()).toBe(0);
    expect(levelJson()).toBe(before);
  });

  it('of a finger that owns no stroke leaves the stroke of the mouse running', () => {
    openRoom();
    mouse('pointerdown', cellPoint(3, 3, ROOM_WIDTH));
    finger('pointerdown', FINGER_A, cellPoint(9, 9, ROOM_WIDTH));
    finger('pointercancel', FINGER_A, cellPoint(9, 9, ROOM_WIDTH));
    expect(editor['stroke']).not.toBeNull();
    mouse('pointerup', cellPoint(3, 3, ROOM_WIDTH));
    expect(undoDepth()).toBe(1);
  });
});

describe('a lost lift', () => {
  it('does not leave touch dead: a new primary touch paints exactly one step', () => {
    openRoom();
    finger('pointerdown', FINGER_A, cellPoint(3, 3, ROOM_WIDTH), { isPrimary: true });
    finger('pointerdown', FINGER_B, cellPoint(8, 8, ROOM_WIDTH), { isPrimary: true });
    finger('pointerup', FINGER_B, cellPoint(8, 8, ROOM_WIDTH));
    // The first finger was never lifted: its young stroke is taken back, and only the new touch is a step.
    expect(undoDepth()).toBe(1);
    expect(editor['touchGesture']).toBeNull();
  });

  it('is cleared when the page is hidden, so the next touch paints', () => {
    openRoom();
    finger('pointerdown', FINGER_A, cellPoint(3, 3, ROOM_WIDTH));
    clock = EDITOR_TOUCH_STROKE_GRACE_MS;
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    try {
      document.dispatchEvent(new Event('visibilitychange'));
    } finally {
      delete (document as unknown as Record<string, unknown>).visibilityState;
    }
    expect(undoDepth()).toBe(1);
    expect(editor['touchPointers'].size).toBe(0);
    finger('pointerdown', FINGER_B, cellPoint(8, 8, ROOM_WIDTH));
    finger('pointerup', FINGER_B, cellPoint(8, 8, ROOM_WIDTH));
    expect(undoDepth()).toBe(2);
  });

  it('is cleared when the window loses focus', () => {
    openRoom();
    finger('pointerdown', FINGER_A, cellPoint(3, 3, ROOM_WIDTH));
    window.dispatchEvent(new Event('blur'));
    expect(editor['touchPointers'].size).toBe(0);
    expect(editor['stroke']).toBeNull();
  });

  it('rolls back a young stroke when the pointer capture is lost', () => {
    openRoom();
    const before = levelJson();
    finger('pointerdown', FINGER_A, cellPoint(3, 3, ROOM_WIDTH));
    finger('lostpointercapture', FINGER_A, cellPoint(3, 3, ROOM_WIDTH));
    expect(levelJson()).toBe(before);
    expect(undoDepth()).toBe(0);
  });

  it('ignores a lost capture after a normal lift', () => {
    openRoom();
    finger('pointerdown', FINGER_A, cellPoint(3, 3, ROOM_WIDTH));
    finger('pointerup', FINGER_A, cellPoint(3, 3, ROOM_WIDTH));
    finger('lostpointercapture', FINGER_A, cellPoint(3, 3, ROOM_WIDTH));
    expect(undoDepth()).toBe(1);
  });
});

describe('a pen after a palm', () => {
  it('takes the canvas from the finger: one step, only the pen cell changed', () => {
    openRoom();
    finger('pointerdown', FINGER_A, cellPoint(3, 3, ROOM_WIDTH));
    finger('pointerdown', 9, cellPoint(12, 12, ROOM_WIDTH), { pointerType: 'pen' });
    finger('pointerup', FINGER_A, cellPoint(3, 3, ROOM_WIDTH));
    finger('pointerup', 9, cellPoint(12, 12, ROOM_WIDTH), { pointerType: 'pen' });
    expect(undoDepth()).toBe(1);
    const penOnly = levelJson();
    editor.undo();
    openRoom();
    finger('pointerdown', 9, cellPoint(12, 12, ROOM_WIDTH), { pointerType: 'pen' });
    finger('pointerup', 9, cellPoint(12, 12, ROOM_WIDTH), { pointerType: 'pen' });
    expect(levelJson()).toBe(penOnly);
  });
});

describe('a paste carried off the map', () => {
  it('is not placed when the finger lifts outside the map', () => {
    editor.loadCompiledLevel(trapRoom(false));
    editor.setTool('select');
    mouse('pointerdown', cellPoint(0, 0, SMALL_WIDTH));
    mouse('pointerup', cellPoint(0, 0, SMALL_WIDTH));
    editor.handleSelectionAction({ kind: 'copy' });
    editor.handleSelectionAction({ kind: 'paste' });
    const before = levelJson();
    finger('pointerdown', FINGER_A, cellPoint(4, 3, SMALL_WIDTH));
    finger('pointermove', FINGER_A, at(-500, -500));
    finger('pointerup', FINGER_A, at(-500, -500));
    expect(levelJson()).toBe(before);
  });
});

describe('a long press', () => {
  const brushId = (): string => (editor['brush'] as { id: string }).id;
  const hold = (): void => void vi.advanceTimersByTime(EDITOR_TOUCH_LONG_PRESS_MS);

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('on the brush takes the stroke back, picks the cell and makes it the Connections subject', () => {
    editor.loadCompiledLevel(trapRoom(false));
    const before = levelJson();
    const statusBefore = statusText();
    finger('pointerdown', FINGER_A, cellPoint(BUTTON.x, BUTTON.y, SMALL_WIDTH));
    expect(levelJson()).not.toBe(before);
    clock = EDITOR_TOUCH_LONG_PRESS_MS;
    hold();
    expect(levelJson()).toBe(before);
    expect(undoDepth()).toBe(0);
    expect(brushId()).toBe('button_brown');
    expect(statusText()).not.toBe(statusBefore);
    expect(statusText()).toBe(t('editor.palette.status.picked.label', { name: t(ConfigRegistry.getTile('button_brown')?.i18nKey ?? '') }));
    expect(editor['cursorCell']).toEqual(BUTTON);
    expect(editor['tool']).toBe('brush');
    finger('pointerup', FINGER_A, cellPoint(BUTTON.x, BUTTON.y, SMALL_WIDTH));
    expect(undoDepth()).toBe(0);
    expect(levelJson()).toBe(before);
  });

  it('keeps the tool on the eraser and rolls its stroke back', () => {
    editor.loadCompiledLevel(trapRoom(false));
    editor.setTool('eraser');
    const before = levelJson();
    finger('pointerdown', FINGER_A, cellPoint(BUTTON.x, BUTTON.y, SMALL_WIDTH));
    expect(levelJson()).not.toBe(before);
    hold();
    expect(levelJson()).toBe(before);
    expect(editor['tool']).toBe('eraser');
    expect(brushId()).toBe('button_brown');
    finger('pointerup', FINGER_A, cellPoint(BUTTON.x, BUTTON.y, SMALL_WIDTH));
    expect(undoDepth()).toBe(0);
  });

  it('on the fill tool rolls the fill back', () => {
    editor.loadCompiledLevel(trapRoom(false));
    editor.setTool('fill');
    const before = levelJson();
    finger('pointerdown', FINGER_A, cellPoint(2, 3, SMALL_WIDTH));
    expect(levelJson()).not.toBe(before);
    hold();
    expect(levelJson()).toBe(before);
    finger('pointerup', FINGER_A, cellPoint(2, 3, SMALL_WIDTH));
    expect(undoDepth()).toBe(0);
  });

  it('is cancelled by a move past the tap slop: a normal stroke goes on', () => {
    editor.loadCompiledLevel(trapRoom(false));
    const start = cellPoint(2, 3, SMALL_WIDTH);
    finger('pointerdown', FINGER_A, start);
    finger('pointermove', FINGER_A, at(start.clientX + EDITOR_TOUCH_TAP_SLOP_PX + 1, start.clientY));
    hold();
    finger('pointerup', FINGER_A, start);
    expect(undoDepth()).toBe(1);
  });

  it('is cancelled by a lift before the delay: one step', () => {
    editor.loadCompiledLevel(trapRoom(false));
    finger('pointerdown', FINGER_A, cellPoint(2, 3, SMALL_WIDTH));
    finger('pointerup', FINGER_A, cellPoint(2, 3, SMALL_WIDTH));
    hold();
    expect(undoDepth()).toBe(1);
    expect(brushId()).not.toBe('button_brown');
  });

  it('is replaced by the two-finger gesture when a second finger lands first', () => {
    openRoom();
    scrollTo(PAN_FROM, PAN_FROM);
    const before = levelJson();
    const brushBefore = brushId();
    twoFingersDown(at(100, 100), at(140, 100));
    hold();
    finger('pointermove', FINGER_A, at(110, 120));
    finger('pointermove', FINGER_B, at(150, 120));
    expect(stage.scrollLeft).toBe(PAN_FROM - 10);
    expect(levelJson()).toBe(before);
    expect(editor['touchLongPress']).toBeNull();
    expect(brushId()).toBe(brushBefore);
  });

  it('is cancelled when the finger reaches another cell within the slop (small cells)', () => {
    openRoom();
    // A fit zoom on a wide map: cells of 4 px, narrower than the tap slop.
    const smallTile = 4;
    canvas.getBoundingClientRect = () => rectOf(0, 0, ROOM_WIDTH * smallTile, ROOM_HEIGHT * smallTile);
    const from = cellPoint(3, 3, ROOM_WIDTH);
    const to = cellPoint(4, 3, ROOM_WIDTH);
    expect(Math.abs(to.clientX - from.clientX)).toBeLessThanOrEqual(EDITOR_TOUCH_TAP_SLOP_PX);
    const brushBefore = brushId();
    finger('pointerdown', FINGER_A, from);
    finger('pointermove', FINGER_A, to);
    expect(editor['touchLongPress']).toBeNull();
    hold();
    finger('pointerup', FINGER_A, to);
    expect(undoDepth()).toBe(1);
    expect(brushId()).toBe(brushBefore);
  });

  it('once fired leaves the finger inert: a move paints nothing and a second finger does not pan', () => {
    editor.loadCompiledLevel(trapRoom(false));
    const before = levelJson();
    finger('pointerdown', FINGER_A, cellPoint(BUTTON.x, BUTTON.y, SMALL_WIDTH));
    hold();
    finger('pointermove', FINGER_A, cellPoint(5, 5, SMALL_WIDTH));
    expect(levelJson()).toBe(before);
    scrollTo(PAN_FROM, PAN_FROM);
    finger('pointerdown', FINGER_B, at(100, 100));
    finger('pointermove', FINGER_B, at(130, 130));
    finger('pointermove', FINGER_A, at(60, 60));
    expect(stage.scrollLeft).toBe(PAN_FROM);
    expect(stage.scrollTop).toBe(PAN_FROM);
    finger('pointerup', FINGER_B, at(130, 130));
    finger('pointerup', FINGER_A, at(60, 60));
    expect(levelJson()).toBe(before);
    expect(undoDepth()).toBe(0);
    finger('pointerdown', FINGER_C, cellPoint(5, 5, SMALL_WIDTH));
    finger('pointerup', FINGER_C, cellPoint(5, 5, SMALL_WIDTH));
    expect(undoDepth()).toBe(1);
  });

  it('on a cell the picker writes nothing for (an empty CC3D cell) says there is nothing to pick', () => {
    openRoom();
    // Defensive branch: pickCc3dCell always returns the top terrain for an in-bounds cell, so the picker is stubbed to write no status.
    vi.spyOn(editor as unknown as { pickAt: () => void }, 'pickAt').mockImplementation(() => undefined);
    finger('pointerdown', FINGER_A, cellPoint(3, 3, ROOM_WIDTH));
    hold();
    expect(statusText()).toBe(t('editor.touch.pick.nothing.label'));
    expect(undoDepth()).toBe(0);
    finger('pointerup', FINGER_A, cellPoint(3, 3, ROOM_WIDTH));
  });

  it('never fires in a link session, a paste, with the picker or with the select tool', () => {
    editor.loadCompiledLevel(trapRoom(false));
    editor['moveCursorTo'](BUTTON, false);
    byId<HTMLButtonElement>('editor-connections-link-btn').click();
    finger('pointerdown', FINGER_A, cellPoint(TRAP.x, TRAP.y, SMALL_WIDTH));
    expect(editor['touchLongPress']).toBeNull();
    finger('pointerup', FINGER_A, cellPoint(TRAP.x, TRAP.y, SMALL_WIDTH));
    editor['endLinkSession'](true);
    editor.setTool('picker');
    finger('pointerdown', FINGER_A, cellPoint(2, 3, SMALL_WIDTH));
    expect(editor['touchLongPress']).toBeNull();
    finger('pointerup', FINGER_A, cellPoint(2, 3, SMALL_WIDTH));
    editor.setTool('select');
    finger('pointerdown', FINGER_A, cellPoint(2, 3, SMALL_WIDTH));
    expect(editor['touchLongPress']).toBeNull();
    finger('pointerup', FINGER_A, cellPoint(2, 3, SMALL_WIDTH));
    mouse('pointerdown', cellPoint(0, 0, SMALL_WIDTH));
    mouse('pointerup', cellPoint(0, 0, SMALL_WIDTH));
    editor.handleSelectionAction({ kind: 'copy' });
    editor.handleSelectionAction({ kind: 'paste' });
    finger('pointerdown', FINGER_A, cellPoint(4, 3, SMALL_WIDTH));
    expect(editor['touchLongPress']).toBeNull();
    finger('pointerup', FINGER_A, cellPoint(4, 3, SMALL_WIDTH));
  });

  it('is dropped by a dispose or a blur before the delay: no pick', () => {
    editor.loadCompiledLevel(trapRoom(false));
    finger('pointerdown', FINGER_A, cellPoint(BUTTON.x, BUTTON.y, SMALL_WIDTH));
    window.dispatchEvent(new Event('blur'));
    hold();
    expect(brushId()).not.toBe('button_brown');
    finger('pointerdown', FINGER_B, cellPoint(BUTTON.x, BUTTON.y, SMALL_WIDTH));
    expect(editor['touchLongPress']).not.toBeNull();
    editor.dispose();
    expect(editor['touchLongPress']).toBeNull();
    hold();
    expect(brushId()).not.toBe('button_brown');
  });

  it('is dropped when another level is loaded', () => {
    editor.loadCompiledLevel(trapRoom(false));
    finger('pointerdown', FINGER_A, cellPoint(BUTTON.x, BUTTON.y, SMALL_WIDTH));
    editor.loadCompiledLevel(trapRoom(true));
    expect(editor['touchLongPress']).toBeNull();
  });
});

describe('the hover of a finger', () => {
  const leave = (pointerType: string): void => {
    const ev = new MouseEvent('pointerleave', { bubbles: false, ...cellPoint(2, 3, SMALL_WIDTH) });
    Object.defineProperty(ev, 'pointerType', { value: pointerType });
    canvas.dispatchEvent(ev);
  };

  it('is kept after a touch lift and the pointer leaving', () => {
    editor.loadCompiledLevel(trapRoom(false));
    finger('pointerdown', FINGER_A, cellPoint(2, 3, SMALL_WIDTH));
    finger('pointerup', FINGER_A, cellPoint(2, 3, SMALL_WIDTH));
    leave('touch');
    expect(editor['hoverCell']).toEqual({ x: 2, y: 3 });
  });

  it('is cleared by the first mouse move over the stage (a hybrid device)', () => {
    editor.loadCompiledLevel(trapRoom(false));
    finger('pointerdown', FINGER_A, cellPoint(2, 3, SMALL_WIDTH));
    finger('pointerup', FINGER_A, cellPoint(2, 3, SMALL_WIDTH));
    expect(editor['hoverCell']).toEqual({ x: 2, y: 3 });
    stage.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 190, clientY: 140 }));
    expect(editor['hoverCell']).toBeNull();
  });

  it('is still cleared for a mouse', () => {
    editor.loadCompiledLevel(trapRoom(false));
    mouse('pointermove', cellPoint(2, 3, SMALL_WIDTH));
    expect(editor['hoverCell']).toEqual({ x: 2, y: 3 });
    leave('mouse');
    expect(editor['hoverCell']).toBeNull();
  });
});

describe('the stage padding', () => {
  /** A finger event whose target is the stage, as a touch on the padding around a small map. */
  function stageFinger(type: 'pointerdown' | 'pointermove' | 'pointerup', id: number, point: Point): void {
    const ev = new MouseEvent(type, { bubbles: true, cancelable: true, ...point });
    Object.defineProperty(ev, 'pointerType', { value: 'touch' });
    Object.defineProperty(ev, 'pointerId', { value: id });
    (type === 'pointerup' ? window : stage).dispatchEvent(ev);
  }

  it('lets a pinch with both fingers on the stage zoom exactly one step', () => {
    openRoom();
    stageFinger('pointerdown', FINGER_A, at(100, 100));
    stageFinger('pointerdown', FINGER_B, at(100 + FAR_APART, 100));
    stageFinger('pointermove', FINGER_B, at(100 + FAR_APART + FAR_APART / 2, 100));
    expect(zoomOffset()).toBe(1);
    stageFinger('pointerup', FINGER_B, at(100, 100));
    stageFinger('pointerup', FINGER_A, at(100, 100));
    expect(undoDepth()).toBe(0);
  });

  it('pans with one finger on the canvas and one on the stage, and rolls back a young stroke', () => {
    openRoom();
    scrollTo(PAN_FROM, PAN_FROM);
    const before = levelJson();
    finger('pointerdown', FINGER_A, cellPoint(3, 3, ROOM_WIDTH));
    stageFinger('pointerdown', FINGER_B, at(150, 100));
    expect(levelJson()).toBe(before);
    const a = cellPoint(3, 3, ROOM_WIDTH);
    finger('pointermove', FINGER_A, at(a.clientX + 10, a.clientY));
    stageFinger('pointermove', FINGER_B, at(160, 100));
    expect(stage.scrollLeft).toBeLessThan(PAN_FROM);
    stageFinger('pointerup', FINGER_B, at(160, 100));
    finger('pointerup', FINGER_A, a);
    expect(undoDepth()).toBe(0);
  });

  it('paints nothing with one finger alone on the stage', () => {
    openRoom();
    const before = levelJson();
    stageFinger('pointerdown', FINGER_A, at(190, 140));
    stageFinger('pointermove', FINGER_A, at(195, 145));
    stageFinger('pointerup', FINGER_A, at(195, 145));
    expect(levelJson()).toBe(before);
    expect(undoDepth()).toBe(0);
  });
});

describe('a mouse or pen', () => {
  it('keeps painting while a finger rests on the canvas (palm rejection)', () => {
    openRoom();
    mouse('pointerdown', cellPoint(3, 3, ROOM_WIDTH));
    finger('pointerdown', FINGER_A, cellPoint(9, 9, ROOM_WIDTH));
    finger('pointermove', FINGER_A, cellPoint(10, 9, ROOM_WIDTH));
    finger('pointerup', FINGER_A, cellPoint(10, 9, ROOM_WIDTH));
    expect(editor['stroke']).not.toBeNull();
    mouse('pointerup', cellPoint(3, 3, ROOM_WIDTH));
    expect(undoDepth()).toBe(1);
  });
});
