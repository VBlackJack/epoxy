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

const askSaveInto = vi.hoisted(() => vi.fn());
vi.mock('../ui/saveIntoDialog', () => ({ askSaveInto }));

import type { BeamCellsDraw } from '../render/PixelRenderer';
import type { CompiledLevel, EntityPlacement } from '../core/types';
import { i18n, t } from '../i18n/I18nManager';
import { LevelPackStorage } from '../storage/LevelPackStorage';
import { FakeIndexedDb } from '../test/FakeIndexedDb';
import { mountModals } from '../test/domFixture';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { EDITOR_BEAM_STALE_ALPHA, EDITOR_CHECK_DEBOUNCE_MS } from '../ui/uiConstants';
import { emptyCc3dRoom } from './cc3dRoom';
import { compiledCc3d } from './cc3dEditorFixtures';
import { getEditorKeyAction } from './editorKeyboard';
import { LevelEditor } from './LevelEditor';

const SIZE = 11;
const LANE_Y = 5;
const TURRET_X = 3;
const TURRET_REACH = 3;
const BUTTON_ID = 'editor-beam-preview-btn';
const CC3D_ROOM_SIZE = 12;
/** The draws of one render: the beams at tick 0, then the dimmed later facings. */
const DRAWS_PER_RENDER = 2;

const fake = new FakeIndexedDb();
let editor: LevelEditor;
let canvas: HTMLCanvasElement;
let drawBeamCells: ReturnType<typeof vi.fn>;
let alphas: number[];

/** A context that remembers every opacity it was given and ignores everything else. */
function recordingContext(): CanvasRenderingContext2D {
  const sink = (): unknown => new Proxy(() => undefined, { get: () => sink(), set: () => true, apply: () => undefined });
  return new Proxy(() => undefined, {
    get: () => sink(),
    set: (_target, prop, value) => {
      if (prop === 'globalAlpha') alphas.push(value as number);
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
const unavailable = (): boolean => button().getAttribute('aria-disabled') === 'true';
const status = (): string => byId('editor-status-bar').textContent ?? '';

/** An editor shortcut: the application routes the key to the editor, so the test does the same. */
function shortcut(key: string, init: KeyboardEventInit = {}): void {
  const action = getEditorKeyAction(new KeyboardEvent('keydown', { key, ...init }));
  if (action) editor.handleKeyAction(action);
}

function pressOnCanvas(key: string): void {
  canvas.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

/** A walled room holding a fixed turret at (3, 5) that faces east; it fires three cells at tick 0. */
function turretRoom(ruleset?: CompiledLevel['ruleset']): CompiledLevel {
  const terrain: string[][] = Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x) => (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? 'wall' : 'floor'))
  );
  const entities: EntityPlacement[] = [{ type: 'turret_fixed', x: TURRET_X, y: LANE_Y, dir: 'E' }];
  return {
    id: 'lvl_beam_dom',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    ...(ruleset ? { ruleset } : {}),
    playerStart: { x: 1, y: 1, dir: 'S' },
    terrain,
    items: terrain.map((row) => row.map(() => null as string | null)),
    entities,
    trapLinks: [],
    cloneLinks: []
  };
}

/** The same room with the turret one row lower, so its beam runs on another lane. */
function lowerTurretRoom(): CompiledLevel {
  const room = turretRoom();
  return { ...room, id: 'lvl_beam_dom_2', entities: [{ type: 'turret_fixed', x: TURRET_X, y: LANE_Y + 1, dir: 'E' }] };
}

function plainRoom(): CompiledLevel {
  return { ...turretRoom(), id: 'lvl_plain_dom', entities: [] };
}

/** Puts the keyboard cursor on a cell, from the cell (1, 1) where it starts. */
function moveCursorTo(x: number, y: number): void {
  for (let i = 1; i < x; i++) pressOnCanvas('ArrowRight');
  for (let i = 1; i < y; i++) pressOnCanvas('ArrowDown');
}

/** The cells of the last draw of the beams at tick 0 (the draw before the last, which is the dimmed one). */
function lastBeamCells(): BeamCellsDraw['cells'] {
  const calls = drawBeamCells.mock.calls;
  return (calls[calls.length - DRAWS_PER_RENDER][1] as BeamCellsDraw).cells;
}

beforeEach(() => {
  loadTestConfigs();
  i18n.setLocale('en');
  fake.records.clear();
  askSaveInto.mockReset();
  alphas = [];
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
  canvas.setPointerCapture = () => undefined;
  drawBeamCells = vi.fn();
  const renderer = {
    getAppearanceKey: vi.fn(() => 'look'),
    renderIconToDataUrl: vi.fn((kind: string, id: string) => `data:,${kind}-${id}`),
    drawTile: vi.fn(),
    drawItem: vi.fn(),
    drawEntity: vi.fn(),
    drawPlayer: vi.fn(),
    drawCellOverlay: vi.fn(),
    setHiddenLayerMarkers: vi.fn(),
    drawBeamCells
  };
  const hooks = { onTestPlay: vi.fn(), onLevelSaved: vi.fn(), onNotify: vi.fn(), openManager: vi.fn(), importAsPack: vi.fn(), getConfigBundle: vi.fn() };
  editor = new LevelEditor(canvas, renderer as never, hooks as never);
  editor.buildUI();
});

afterEach(async () => {
  vi.useRealTimers();
  editor.dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await LevelPackStorage.closeConnection();
});

describe('beam preview toggle', () => {
  it('starts off, draws nothing, and turns on by the button with the summary announced', () => {
    editor.loadCompiledLevel(turretRoom());
    expect(button().getAttribute('aria-pressed')).toBe('false');
    expect(drawBeamCells).not.toHaveBeenCalled();
    button().click();
    expect(button().getAttribute('aria-pressed')).toBe('true');
    const summary = t('editor.beam_preview.summary.label', { cells: TURRET_REACH, lit: 0, total: 0, gates: 0 });
    expect(status()).toBe(summary);
    expect(summary).toContain('tick 0');
    expect(button().title).toBe(summary);
    expect(lastBeamCells()).toHaveLength(TURRET_REACH);
  });

  it('turns on and off by the L key', () => {
    editor.loadCompiledLevel(turretRoom());
    shortcut('l');
    expect(button().getAttribute('aria-pressed')).toBe('true');
    shortcut('L');
    expect(button().getAttribute('aria-pressed')).toBe('false');
    expect(status()).toBe(t('editor.beam_preview.off.label'));
    expect(button().title).toBe(t('editor.beam_preview.title.label'));
  });

  it('ignores Ctrl+L', () => {
    editor.loadCompiledLevel(turretRoom());
    shortcut('l', { ctrlKey: true });
    expect(button().getAttribute('aria-pressed')).toBe('false');
  });

  it('says there are no lasers on a level without any, and draws nothing', () => {
    editor.loadCompiledLevel(plainRoom());
    button().click();
    expect(status()).toBe(t('editor.beam_preview.none.label'));
    expect(drawBeamCells).not.toHaveBeenCalled();
  });

  it('is disabled with its reason on a CC3D level and does not turn on by key', () => {
    editor.loadCompiledLevel(compiledCc3d(emptyCc3dRoom(CC3D_ROOM_SIZE, CC3D_ROOM_SIZE)));
    expect(unavailable()).toBe(true);
    expect(button().disabled).toBe(false);
    expect(button().title).toBe(t('editor.beam_preview.unavailable_cc3d.label'));
    shortcut('l');
    expect(status()).toBe(t('editor.beam_preview.unavailable_cc3d.label'));
    expect(button().getAttribute('aria-pressed')).toBe('false');
  });

  it('is disabled with its reason on a Lynx level', () => {
    editor.loadCompiledLevel({ ...plainRoom(), ruleset: 'lynx' });
    expect(unavailable()).toBe(true);
    expect(button().disabled).toBe(false);
    expect(button().title).toBe(t('editor.beam_preview.unavailable_lynx.label'));
    shortcut('l');
    expect(status()).toBe(t('editor.beam_preview.unavailable_lynx.label'));
  });

  it('turns itself off when the editor moves to a level it cannot cover', () => {
    editor.loadCompiledLevel(turretRoom());
    button().click();
    editor.loadCompiledLevel(compiledCc3d(emptyCc3dRoom(CC3D_ROOM_SIZE, CC3D_ROOM_SIZE)));
    expect(button().getAttribute('aria-pressed')).toBe('false');
    expect(unavailable()).toBe(true);
    expect(button().disabled).toBe(false);
  });
});

describe('beam preview and the ruleset', () => {
  it('follows the ruleset when laser content turns a Lynx level into an Epoxy one', () => {
    editor.loadCompiledLevel(turretRoom('lynx'));
    expect(unavailable()).toBe(false);
    expect(button().title).toBe(t('editor.beam_preview.title.label'));
  });
});

describe('beam preview after an edit', () => {
  it('draws the old beams dimmed until the check timer recomputes, then draws the new ones', () => {
    editor.loadCompiledLevel(turretRoom());
    canvas.focus();
    moveCursorTo(TURRET_X, LANE_Y);
    button().click();
    vi.useFakeTimers();
    // Turn the turret from east to south: its beam leaves the lane.
    shortcut('R', { shiftKey: true });
    alphas.length = 0;
    editor.render();
    expect(alphas).toContain(EDITOR_BEAM_STALE_ALPHA);
    expect(lastBeamCells().map((cell) => `${cell.x},${cell.y}`).sort()).toEqual(['4,5', '5,5', '6,5']);
    vi.advanceTimersByTime(EDITOR_CHECK_DEBOUNCE_MS + 1);
    expect(lastBeamCells().map((cell) => `${cell.x},${cell.y}`).sort()).toEqual(['3,6', '3,7', '3,8']);
    alphas.length = 0;
    editor.render();
    expect(alphas).not.toContain(EDITOR_BEAM_STALE_ALPHA);
  });

  it('stays silent when the recompute gives the same summary', () => {
    vi.useFakeTimers();
    editor.loadCompiledLevel(turretRoom());
    button().click();
    const marker = 'unrelated status';
    byId('editor-status-bar').textContent = marker;
    const before = drawBeamCells.mock.calls.length;
    vi.advanceTimersByTime(EDITOR_CHECK_DEBOUNCE_MS + 1);
    // The recompute ran (the beams were painted again) and found the same summary: the status is left alone.
    expect(drawBeamCells.mock.calls.length).toBeGreaterThan(before);
    expect(status()).toBe(marker);
  });

  it('is not dimmed after a save, which changes no content', async () => {
    editor.loadCompiledLevel(turretRoom());
    button().click();
    askSaveInto.mockResolvedValue({ kind: 'new', name: 'beam pack' });
    await editor.save();
    expect(editor.hasUnsavedChanges()).toBe(false);
    alphas.length = 0;
    editor.render();
    expect(alphas).not.toContain(EDITOR_BEAM_STALE_ALPHA);
    expect(alphas).toContain(1);
  });
});

describe('beam preview when another level is loaded', () => {
  it('never draws the beams of the old level on the new one', () => {
    editor.loadCompiledLevel(turretRoom());
    button().click();
    editor.loadCompiledLevel(lowerTurretRoom());
    alphas.length = 0;
    editor.render();
    expect(lastBeamCells().map((cell) => `${cell.x},${cell.y}`).sort()).toEqual(['4,6', '5,6', '6,6']);
    expect(alphas).not.toContain(EDITOR_BEAM_STALE_ALPHA);
  });

  it('draws nothing on a new level without lasers, and says so', () => {
    editor.loadCompiledLevel(turretRoom());
    button().click();
    const before = drawBeamCells.mock.calls.length;
    editor.loadCompiledLevel(plainRoom());
    editor.render();
    expect(drawBeamCells.mock.calls.length).toBe(before);
    expect(status()).toBe(t('editor.beam_preview.none.label'));
  });

  it('clears the overlay and the announced summary when the new level cannot be covered', () => {
    editor.loadCompiledLevel(turretRoom());
    button().click();
    const renders = vi.spyOn(editor, 'render');
    editor.loadCompiledLevel({ ...plainRoom(), ruleset: 'lynx' });
    expect(renders).toHaveBeenCalled();
    expect(button().getAttribute('aria-pressed')).toBe('false');
    // Back on a coverable level, the same summary is announced again rather than swallowed as unchanged.
    editor.loadCompiledLevel(turretRoom());
    button().click();
    expect(status()).toContain('tick 0');
  });
});

describe('beam preview button when unavailable', () => {
  it('stays focusable and announces the reason on a click', () => {
    editor.loadCompiledLevel({ ...plainRoom(), ruleset: 'lynx' });
    expect(button().disabled).toBe(false);
    expect(button().classList.contains('is-unavailable')).toBe(true);
    expect(button().getAttribute('aria-description')).toBe(t('editor.beam_preview.unavailable_lynx.label'));
    byId('editor-status-bar').textContent = '';
    button().click();
    expect(status()).toBe(t('editor.beam_preview.unavailable_lynx.label'));
    expect(button().getAttribute('aria-pressed')).toBe('false');
  });

  it('drops the unavailable markers on a level the preview covers', () => {
    editor.loadCompiledLevel({ ...plainRoom(), ruleset: 'lynx' });
    editor.loadCompiledLevel(turretRoom());
    expect(button().hasAttribute('aria-disabled')).toBe(false);
    expect(button().hasAttribute('aria-description')).toBe(false);
    expect(button().classList.contains('is-unavailable')).toBe(false);
  });
});

describe('beam preview drawing cache', () => {
  it('paints the beams once and copies them on the next render with the same key', () => {
    editor.loadCompiledLevel(turretRoom());
    button().click();
    const painted = drawBeamCells.mock.calls.length;
    expect(painted).toBe(DRAWS_PER_RENDER);
    editor.render();
    editor.render();
    expect(drawBeamCells.mock.calls.length).toBe(painted);
  });

  it('paints again when the tile size changes', () => {
    editor.loadCompiledLevel(turretRoom());
    button().click();
    const painted = drawBeamCells.mock.calls.length;
    byId('editor-zoom-in-btn').click();
    expect(drawBeamCells.mock.calls.length).toBeGreaterThan(painted);
  });

  it('paints directly on every render when no off-screen canvas is available', () => {
    editor.loadCompiledLevel(turretRoom());
    const context = canvas.getContext('2d');
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
      return this === canvas ? context : null;
    } as unknown as HTMLCanvasElement['getContext']);
    button().click();
    const painted = drawBeamCells.mock.calls.length;
    editor.render();
    expect(drawBeamCells.mock.calls.length).toBe(painted + DRAWS_PER_RENDER);
  });
});

describe('beam preview in French', () => {
  it('announces in French with plurals', () => {
    i18n.setLocale('fr');
    editor.loadCompiledLevel(turretRoom());
    button().click();
    expect(status()).toContain('tick 0');
    expect(status()).toContain('3 cases de faisceau');
    expect(status()).toContain('0 récepteur allumé');
  });
});
