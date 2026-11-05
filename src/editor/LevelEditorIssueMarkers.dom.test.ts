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
 * The validator issues marked on the map: a mark in the corner of each cell the last report names, dimmed while the
 * report lags an edit, gone with the level, switched by the Markers button and the M key. A recording context stands
 * in for the canvas and the marks are found by the shapes they are drawn with.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../ui/confirmDialog', () => ({ confirmDialog: vi.fn(async () => false) }));
vi.mock('../ui/saveIntoDialog', () => ({ askSaveInto: vi.fn() }));

import { ConfigRegistry } from '../config/ConfigRegistry';
import type { CompiledLevel, ValidationIssue } from '../core/types';
import { i18n, t } from '../i18n/I18nManager';
import { LevelPackStorage } from '../storage/LevelPackStorage';
import { FakeIndexedDb } from '../test/FakeIndexedDb';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { mountModals } from '../test/domFixture';
import {
  EDITOR_CELL_ANNOUNCE_DELAY_MS,
  EDITOR_CHECK_DEBOUNCE_MS,
  EDITOR_ISSUE_MARKER_COUNT_MIN_TILE_PX,
  EDITOR_ISSUE_MARKER_INFO_SCALE,
  EDITOR_ISSUE_MARKER_INSET_PX,
  EDITOR_ISSUE_MARKER_MIN_PX,
  EDITOR_ISSUE_MARKER_STALE_ALPHA,
  EDITOR_ISSUE_MARKER_TILE,
  EDITOR_ISSUE_MARKER_ZOOM_THRESHOLD_PX
} from '../ui/uiConstants';
import { compiledCc3d } from './cc3dEditorFixtures';
import { emptyCc3dRoom } from './cc3dRoom';
import { getEditorKeyAction } from './editorKeyboard';
import { LevelEditor } from './LevelEditor';

const SIZE = 11;
const CELL_PX = 10;
const LONE_TRAP = { x: 5, y: 5 };
const HOLD_DOOR = { x: 5, y: 5 };
const BUTTON_AT = { x: 3, y: 3 };
const SPARE = { x: 8, y: 8 };
const CC3D_SIZE = 40;
const CC3D_DOUBLE_MOB = { x: 12, y: 9 };
const FILLED_ALPHA = 1;
const MAX_ZOOM_STEPS = 40;
const FAKE_CHECK_STATE = { state: 'errors', count: 2 } as const;
const BUTTON_ID = 'editor-issue-markers-btn';
const LIVE_ID = 'editor-cell-live';

interface Op {
  name: string;
  args: unknown[];
  alpha: number;
  /** The fill or stroke colour in force when the call was made. */
  style: unknown;
}

const fake = new FakeIndexedDb();
let editor: LevelEditor;
let canvas: HTMLCanvasElement;
let ops: Op[];

/** A context that records the calls the markers are drawn with, with the opacity in force, and ignores the rest. */
function recordingContext(): CanvasRenderingContext2D {
  let alpha = 1;
  let fillStyle: unknown = '';
  let strokeStyle: unknown = '';
  const stack: number[] = [];
  const sink = (): unknown => new Proxy(() => undefined, { get: () => sink(), set: () => true, apply: () => undefined });
  return new Proxy(() => undefined, {
    get: (_target, prop) => {
      if (prop === 'save') return () => void stack.push(alpha);
      if (prop === 'restore') return () => void (alpha = stack.pop() ?? 1);
      if (prop === 'globalAlpha') return alpha;
      if (prop === 'rect' || prop === 'arc' || prop === 'fillText' || prop === 'strokeRect' || prop === 'fill' || prop === 'stroke') {
        const style = prop === 'fill' || prop === 'fillText' ? fillStyle : strokeStyle;
        return (...args: unknown[]) => void ops.push({ name: String(prop), args, alpha, style });
      }
      return sink();
    },
    set: (_target, prop, value) => {
      if (prop === 'globalAlpha') alpha = value as number;
      if (prop === 'fillStyle') fillStyle = value;
      if (prop === 'strokeStyle') strokeStyle = value;
      return true;
    },
    apply: () => undefined
  }) as unknown as CanvasRenderingContext2D;
}

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element ${id}`);
  return el as T;
}

const button = (): HTMLButtonElement => byId<HTMLButtonElement>(BUTTON_ID);
const status = (): string => byId('editor-status-bar').textContent ?? '';
const tilePx = (): number => editor['tilePx'] as number;
const markerSize = (): number => Math.max(EDITOR_ISSUE_MARKER_MIN_PX, EDITOR_ISSUE_MARKER_TILE * tilePx());

function room(placed: Array<{ x: number; y: number; tile: string }>, extra: Partial<CompiledLevel> = {}): CompiledLevel {
  const terrain: string[][] = Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x) => (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? 'wall' : 'floor'))
  );
  terrain[SIZE - 2][SIZE - 2] = 'exit';
  for (const cell of placed) terrain[cell.y][cell.x] = cell.tile;
  return {
    id: 'lvl_issue_markers_dom',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    customTitle: 'Markers room',
    playerStart: { x: 1, y: 1, dir: 'S' },
    terrain,
    items: terrain.map((row) => row.map(() => null as string | null)),
    entities: [],
    trapLinks: [],
    cloneLinks: [],
    ...extra
  };
}

const loneTrapRoom = (): CompiledLevel => room([{ ...LONE_TRAP, tile: 'trap' }]);
const holdDoorRoom = (): CompiledLevel => room([{ ...HOLD_DOOR, tile: 'hold_door_red_closed' }]);

/** Lets the check debounce pass, so the report of the loaded level lands. */
function settle(): void {
  vi.advanceTimersByTime(EDITOR_CHECK_DEBOUNCE_MS + 1);
}

/** Draws once and returns what the markers drew. */
function draw(): Op[] {
  ops = [];
  editor.render();
  return ops;
}

const cornerOf = (cell: { x: number; y: number }): { x: number; y: number } => ({
  x: cell.x * tilePx() + EDITOR_ISSUE_MARKER_INSET_PX,
  y: cell.y * tilePx() + EDITOR_ISSUE_MARKER_INSET_PX
});

/** The square of an error at a cell, or undefined. */
function errorMarkAt(drawn: Op[], cell: { x: number; y: number }): Op | undefined {
  const corner = cornerOf(cell);
  return drawn.find((op) => op.name === 'rect' && op.args[0] === corner.x && op.args[1] === corner.y && op.args[2] === op.args[3]);
}

/** The "!" of a warning at a cell, or undefined. */
function warningMarkAt(drawn: Op[], cell: { x: number; y: number }): Op | undefined {
  const corner = cornerOf(cell);
  return drawn.find((op) => op.name === 'fillText' && op.args[0] === '!' && op.args[1] === corner.x + markerSize() / 2);
}

/** The circle of a hint at a cell, or undefined. */
function infoMarkAt(drawn: Op[], cell: { x: number; y: number }): Op | undefined {
  const corner = cornerOf(cell);
  const size = markerSize() * EDITOR_ISSUE_MARKER_INFO_SCALE;
  return drawn.find((op) => op.name === 'arc' && op.args[0] === corner.x + size / 2 && op.args[1] === corner.y + size / 2);
}

const anyMarkAt = (drawn: Op[], cell: { x: number; y: number }): Op | undefined =>
  errorMarkAt(drawn, cell) ?? warningMarkAt(drawn, cell) ?? infoMarkAt(drawn, cell);

function pointer(type: string, cell: { x: number; y: number }): void {
  canvas.dispatchEvent(
    new MouseEvent(type, { bubbles: true, cancelable: true, clientX: (cell.x + 0.5) * CELL_PX, clientY: (cell.y + 0.5) * CELL_PX })
  );
}

function click(cell: { x: number; y: number }): void {
  pointer('pointerdown', cell);
  window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
}

function pick(tileId: string): void {
  const index = ConfigRegistry.getTiles().categories.findIndex((cat) => cat.id === 'mechanisms');
  document.querySelectorAll<HTMLButtonElement>('#editor-category-tabs button')[index].click();
  const label = t(`tiles.${tileId}.name`);
  const found = Array.from(document.querySelectorAll<HTMLButtonElement>('#editor-palette-grid button')).find(
    (btn) => btn.querySelector('.palette-item-label')?.textContent === label
  );
  if (!found) throw new Error(`Missing palette entry ${label}`);
  found.click();
}

function shortcut(key: string, init: KeyboardEventInit = {}): void {
  const action = getEditorKeyAction(new KeyboardEvent('keydown', { key, ...init }));
  if (action) editor.handleKeyAction(action);
}

/** Hands the editor a report made of these issues for the content as it is. */
function giveReport(issues: ValidationIssue[]): void {
  editor['setCheck'](FAKE_CHECK_STATE, issues, editor['currentBeamPreviewKey']() as string);
}

const issueAt = (severity: ValidationIssue['severity'], cell: { x: number; y: number }): ValidationIssue => ({
  severity,
  i18nKey: 'validator.issues.hold_door_no_plate.label',
  params: { x: cell.x, y: cell.y, color: 'red' }
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  loadTestConfigs();
  i18n.setLocale('en');
  fake.records.clear();
  ops = [];
  const store = new Map<string, string>();
  vi.stubGlobal('indexedDB', fake);
  vi.stubGlobal('localStorage', {
    getItem: (name: string) => store.get(name) ?? null,
    setItem: (name: string, value: string) => void store.set(name, value),
    removeItem: (name: string) => void store.delete(name)
  });
  mountModals('editor-view');
  canvas = byId<HTMLCanvasElement>('editor-canvas');
  const context = recordingContext();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => context) as unknown as HTMLCanvasElement['getContext']);
  canvas.getContext = (() => context) as unknown as HTMLCanvasElement['getContext'];
  canvas.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: SIZE * CELL_PX, bottom: SIZE * CELL_PX, width: SIZE * CELL_PX, height: SIZE * CELL_PX, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  canvas.setPointerCapture = () => undefined;
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
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await LevelPackStorage.closeConnection();
  i18n.setLocale('en');
});

describe('the markers a report draws', () => {
  it('draws nothing before the first report', () => {
    editor.loadCompiledLevel(loneTrapRoom());
    expect(anyMarkAt(draw(), LONE_TRAP)).toBeUndefined();
  });

  it('marks a lone trap with a hint circle once the check has run, at full strength', () => {
    editor.loadCompiledLevel(loneTrapRoom());
    settle();
    const mark = infoMarkAt(draw(), LONE_TRAP);
    expect(mark).toBeDefined();
    expect(mark?.alpha).toBe(FILLED_ALPHA);
  });

  it('drops the hint once a brown button is on the level', () => {
    editor.loadCompiledLevel(loneTrapRoom());
    settle();
    expect(infoMarkAt(draw(), LONE_TRAP)).toBeDefined();
    pick('button_brown');
    click(BUTTON_AT);
    settle();
    expect(anyMarkAt(draw(), LONE_TRAP)).toBeUndefined();
  });

  it('marks a hold door with no plate with a warning triangle', () => {
    editor.loadCompiledLevel(holdDoorRoom());
    settle();
    const drawn = draw();
    expect(warningMarkAt(drawn, HOLD_DOOR)).toBeDefined();
    expect(errorMarkAt(drawn, HOLD_DOOR)).toBeUndefined();
  });

  it('marks an error with a square', () => {
    editor.loadCompiledLevel(loneTrapRoom());
    giveReport([issueAt('error', SPARE)]);
    const mark = errorMarkAt(draw(), SPARE);
    expect(mark).toBeDefined();
    expect(mark?.alpha).toBe(FILLED_ALPHA);
  });

  it('shows the worst severity of a cell and writes the count on a large tile', () => {
    editor.loadCompiledLevel(loneTrapRoom());
    for (let step = 0; step < MAX_ZOOM_STEPS && tilePx() < EDITOR_ISSUE_MARKER_COUNT_MIN_TILE_PX; step++) shortcut('+');
    expect(tilePx()).toBeGreaterThanOrEqual(EDITOR_ISSUE_MARKER_COUNT_MIN_TILE_PX);
    giveReport([issueAt('info', SPARE), issueAt('error', SPARE), issueAt('warning', SPARE)]);
    const drawn = draw();
    expect(errorMarkAt(drawn, SPARE)).toBeDefined();
    expect(warningMarkAt(drawn, SPARE)).toBeUndefined();
    expect(drawn.some((op) => op.name === 'fillText' && op.args[0] === '3')).toBe(true);
  });

  it('leaves out an issue that names no cell on the grid', () => {
    editor.loadCompiledLevel(loneTrapRoom());
    giveReport([{ severity: 'error', i18nKey: 'k' }, { severity: 'error', i18nKey: 'k', params: { x: SIZE, y: 0 } }]);
    const drawn = draw();
    expect(drawn.filter((op) => op.name === 'rect' && op.args[2] === op.args[3])).toHaveLength(0);
  });

  it('draws a cell border instead of a mark on a tiny tile, for errors and warnings only', () => {
    editor.loadCompiledLevel(loneTrapRoom());
    giveReport([issueAt('error', SPARE), issueAt('info', LONE_TRAP)]);
    editor['tilePx'] = EDITOR_ISSUE_MARKER_ZOOM_THRESHOLD_PX - 1;
    ops = [];
    editor['drawIssueMarkers'](tilePx());
    const borders = ops.filter((op) => op.name === 'strokeRect');
    expect(borders).toHaveLength(1);
    expect(ops.some((op) => op.name === 'arc' || op.name === 'fillText')).toBe(false);
  });
});

describe('markers and the freshness of the report', () => {
  it('draws the markers dimmed and outlined while an edit waits for its check, then at full strength', () => {
    editor.loadCompiledLevel(holdDoorRoom());
    settle();
    expect(warningMarkAt(draw(), HOLD_DOOR)?.alpha).toBe(FILLED_ALPHA);
    pick('pressure_plate_blue');
    click(SPARE);
    expect(warningMarkAt(draw(), HOLD_DOOR)?.alpha).toBe(EDITOR_ISSUE_MARKER_STALE_ALPHA);
    settle();
    expect(warningMarkAt(draw(), HOLD_DOOR)?.alpha).toBe(FILLED_ALPHA);
  });

  it('fills a fresh error but only outlines a stale one', () => {
    editor.loadCompiledLevel(loneTrapRoom());
    giveReport([issueAt('error', SPARE)]);
    const color = editor['issueMarkerColors']().error;
    expect(draw().some((op) => op.name === 'fill' && op.style === color)).toBe(true);
    pick('pressure_plate_blue');
    click(BUTTON_AT);
    const stale = draw();
    expect(errorMarkAt(stale, SPARE)?.alpha).toBe(EDITOR_ISSUE_MARKER_STALE_ALPHA);
    expect(stale.some((op) => op.name === 'fill' && op.style === color)).toBe(false);
    expect(stale.some((op) => op.name === 'stroke' && op.style === color)).toBe(true);
  });

  it('draws the hint circle in the biome accent, and follows a change of it', () => {
    editor.loadCompiledLevel(loneTrapRoom());
    settle();
    const first = editor['issueMarkerColors']().info;
    document.documentElement.style.setProperty('--biome-accent', '#123456');
    try {
      const next = editor['issueMarkerColors']().info;
      expect(next).toBe('#123456');
      expect(next).not.toBe(first);
      expect(draw().some((op) => op.name === 'stroke' && op.style === '#123456')).toBe(true);
    } finally {
      document.documentElement.style.removeProperty('--biome-accent');
    }
  });

  it('writes no count below the large tile size', () => {
    editor.loadCompiledLevel(loneTrapRoom());
    expect(tilePx()).toBeLessThan(EDITOR_ISSUE_MARKER_COUNT_MIN_TILE_PX);
    giveReport([issueAt('error', SPARE), issueAt('error', SPARE), issueAt('error', SPARE)]);
    const drawn = draw();
    expect(errorMarkAt(drawn, SPARE)).toBeDefined();
    expect(drawn.some((op) => op.name === 'fillText' && op.args[0] === '3')).toBe(false);
  });

  it('draws nothing on a level loaded after another', () => {
    editor.loadCompiledLevel(holdDoorRoom());
    settle();
    expect(warningMarkAt(draw(), HOLD_DOOR)).toBeDefined();
    editor.loadCompiledLevel(room([]));
    expect(anyMarkAt(draw(), HOLD_DOOR)).toBeUndefined();
  });

  it('stays at full strength when only the language changes', () => {
    editor.loadCompiledLevel(holdDoorRoom());
    settle();
    i18n.setLocale('fr');
    editor.refreshTranslations();
    expect(warningMarkAt(draw(), HOLD_DOOR)?.alpha).toBe(FILLED_ALPHA);
  });

  it('draws over the CC3D map without rebuilding its picture', () => {
    const mobs = [CC3D_DOUBLE_MOB, CC3D_DOUBLE_MOB].map((cell) => ({ kind: 'snappy' as const, x: cell.x, y: cell.y, dir: 'S' as const }));
    editor.loadCompiledLevel(compiledCc3d({ ...emptyCc3dRoom(CC3D_SIZE, CC3D_SIZE), mobs }));
    const layer = editor['staticLayer'];
    expect(layer).not.toBeNull();
    settle();
    expect(editor['staticLayer']).toBe(layer);
    expect(errorMarkAt(draw(), CC3D_DOUBLE_MOB)).toBeDefined();
    expect(editor['staticLayer']).toBe(layer);
  });
});

describe('the Markers switch', () => {
  it('starts on, hides the markers by the button and the M key, and shows them again', () => {
    editor.loadCompiledLevel(holdDoorRoom());
    settle();
    expect(button().getAttribute('aria-pressed')).toBe('true');
    button().click();
    expect(button().getAttribute('aria-pressed')).toBe('false');
    expect(status()).toBe(t('editor.issue_markers.off.label'));
    expect(anyMarkAt(draw(), HOLD_DOOR)).toBeUndefined();
    shortcut('m');
    expect(button().getAttribute('aria-pressed')).toBe('true');
    expect(status()).toBe(t('editor.issue_markers.on.label'));
    expect(warningMarkAt(draw(), HOLD_DOOR)).toBeDefined();
    shortcut('M');
    expect(button().getAttribute('aria-pressed')).toBe('false');
  });

  it('ignores Ctrl+M', () => {
    editor.loadCompiledLevel(holdDoorRoom());
    shortcut('m', { ctrlKey: true });
    expect(button().getAttribute('aria-pressed')).toBe('true');
  });

  it('says what the button does in both languages', () => {
    expect(button().getAttribute('data-i18n-title')).toBe('editor.issue_markers.title.label');
    expect(t('editor.issue_markers.title.label')).toContain('(M)');
    i18n.setLocale('fr');
    expect(t('editor.issue_markers.title.label')).toContain('(M)');
  });
});

describe('the spoken cell description', () => {
  const speak = (cell: { x: number; y: number }): string => {
    canvas.focus();
    editor['moveCursorTo'](cell, false);
    vi.advanceTimersByTime(EDITOR_CELL_ANNOUNCE_DELAY_MS + 1);
    return byId(LIVE_ID).textContent ?? '';
  };

  it('adds the count of issues at the cursor cell for a fresh report', () => {
    editor.loadCompiledLevel(loneTrapRoom());
    giveReport([issueAt('error', SPARE), issueAt('warning', SPARE), issueAt('warning', SPARE)]);
    const expected = t('editor.issue_markers.cell_speech.label', {
      list: [
        t('editor.issue_markers.cell_speech.errors.label', { count: 1 }),
        t('editor.issue_markers.cell_speech.warnings.label', { count: 2 })
      ].join(', ')
    });
    expect(expected).toContain('1 error, 2 warnings');
    expect(speak(SPARE)).toContain(expected);
  });

  it('says nothing about issues on a cell that has none', () => {
    editor.loadCompiledLevel(loneTrapRoom());
    giveReport([issueAt('error', SPARE)]);
    expect(speak(BUTTON_AT)).not.toContain(t('editor.issue_markers.cell_speech.errors.label', { count: 1 }));
  });

  it('says nothing about issues once the report lags an edit', () => {
    editor.loadCompiledLevel(loneTrapRoom());
    giveReport([issueAt('error', SPARE)]);
    pick('pressure_plate_blue');
    click(BUTTON_AT);
    expect(speak(SPARE)).not.toContain(t('editor.issue_markers.cell_speech.errors.label', { count: 1 }));
  });
});
