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
 * The level editor on a CC3D level, in a DOM built from the real index.html: opening it, the palette and the
 * inspector it shows, painting, erasing, undo, and a save that keeps the cc3d data.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const confirmDialog = vi.hoisted(() => vi.fn());
vi.mock('../ui/confirmDialog', () => ({ confirmDialog }));

import { ConfigRegistry } from '../config/ConfigRegistry';
import { validateCc3dLevel } from '../core/cc3d/cc3dValidator';
import { cellAt, topTerrain } from '../core/cc3d/model';
import type { CompiledLevel } from '../core/types';
import { LevelPackStorage } from '../storage/LevelPackStorage';
import { FakeIndexedDb } from '../test/FakeIndexedDb';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { mountModals, settleAsync } from '../test/domFixture';
import { cc3dEntriesOf, CC3D_CATEGORIES } from './cc3dPalette';
import { compiledCc3d, editableCc3dModel, smallCc3dLevel } from './cc3dEditorFixtures';
import { LevelEditor } from './LevelEditor';

const CELL_PX = 10;
const GRID_WIDTH = 5;
const GRID_HEIGHT = 4;
const FIRST_BUTTON = 0;
const SECOND_BUTTON = 1;
const WIDE_WIDTH = 120;

const fake = new FakeIndexedDb();
let store: Map<string, string>;
let editor: LevelEditor;
let canvas: HTMLCanvasElement;
let renderer: ReturnType<typeof fakeRenderer>;

const noopContext = (): CanvasRenderingContext2D =>
  new Proxy(() => undefined, { get: () => noopContext(), set: () => true, apply: () => undefined }) as unknown as CanvasRenderingContext2D;

let appearance = 'look-a';

function fakeRenderer() {
  return {
    getAppearanceKey: vi.fn(() => appearance),
    renderIconToDataUrl: vi.fn(() => 'data:,'),
    drawTile: vi.fn(),
    drawItem: vi.fn(),
    drawEntity: vi.fn(),
    drawPlayer: vi.fn(),
    drawCellOverlay: vi.fn(),
    setHiddenLayerMarkers: vi.fn()
  };
}

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element ${id}`);
  return el as T;
}

function pointer(type: string, x: number, y: number, init: MouseEventInit = {}): void {
  // The cell (x, y) at its centre, or at a given offset inside it.
  canvas.dispatchEvent(
    new MouseEvent(type, { bubbles: true, cancelable: true, clientX: (x + 0.5) * CELL_PX, clientY: (y + 0.5) * CELL_PX, ...init })
  );
}

function click(x: number, y: number, init: MouseEventInit = {}): void {
  pointer('pointerdown', x, y, init);
  window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
}

function tabs(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('#editor-category-tabs button'));
}

function paletteButtons(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('#editor-palette-grid button'));
}

function exported(): CompiledLevel {
  return editor.exportCompiledLevel();
}

function topKindAt(x: number, y: number): string | undefined {
  const cc3d = exported().cc3d;
  const cell = cc3d ? cellAt(cc3d, x, y) : undefined;
  return cell ? topTerrain(cell).kind : undefined;
}

/** Timers the editor armed (the debounced check): dropped after each test so one test's check never lands in the next DOM. */
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
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key)
  });
  confirmDialog.mockReset();
  mountModals('editor-view');
  canvas = byId<HTMLCanvasElement>('editor-canvas');
  // Every canvas, the editor's own and the off-screen layer it keeps, draws into a recording-free no-op context.
  appearance = 'look-a';
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => noopContext()) as unknown as HTMLCanvasElement['getContext']);
  canvas.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: GRID_WIDTH * CELL_PX, bottom: GRID_HEIGHT * CELL_PX, width: GRID_WIDTH * CELL_PX, height: GRID_HEIGHT * CELL_PX, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  canvas.setPointerCapture = () => undefined;
  const hooks = {
    onTestPlay: vi.fn(),
    onLevelSaved: vi.fn(),
    onNotify: vi.fn(),
    openManager: vi.fn(),
    importAsPack: vi.fn(),
    getConfigBundle: vi.fn()
  };
  renderer = fakeRenderer();
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

describe('opening a CC3D level', () => {
  it('opens it and shows the CC3D palette, the layers list and the read-only engine', () => {
    expect(editor.loadCompiledLevel(smallCc3dLevel())).toBe(true);
    expect(tabs()).toHaveLength(CC3D_CATEGORIES.length);
    expect(paletteButtons().length).toBeGreaterThan(0);
    expect(byId('editor-layers-section').classList.contains('hidden')).toBe(false);
    expect(byId('editor-field-winrule').classList.contains('hidden')).toBe(true);
    expect(byId('editor-field-chips').classList.contains('hidden')).toBe(true);
    const ruleset = byId<HTMLSelectElement>('editor-meta-ruleset');
    expect(ruleset.value).toBe('cc3d');
    expect(ruleset.disabled).toBe(true);
    const options = Object.fromEntries(Array.from(ruleset.options).map((option) => [option.value, option.disabled]));
    expect(options).toEqual({ epoxy: true, lynx: true, cc3d: false });
  });

  it('turns fill, select and resize off with a reason, and keeps the other tools', () => {
    editor.loadCompiledLevel(smallCc3dLevel());
    for (const tool of ['fill', 'select']) {
      const button = document.querySelector<HTMLButtonElement>(`[data-tool="${tool}"]`)!;
      expect(button.getAttribute('aria-disabled')).toBe('true');
      expect(button.getAttribute('aria-description')).toBeTruthy();
      expect(button.title).toBeTruthy();
      editor.setTool(tool as never);
      expect(document.querySelector('[data-tool="brush"]')?.getAttribute('aria-pressed')).toBe('true');
    }
    for (const tool of ['brush', 'eraser', 'picker']) {
      expect(document.querySelector(`[data-tool="${tool}"]`)?.hasAttribute('aria-disabled')).toBe(false);
    }
    expect(byId<HTMLButtonElement>('editor-size-apply-btn').disabled).toBe(true);
    expect(byId<HTMLButtonElement>('editor-size-apply-btn').title).toBeTruthy();
    expect(byId<HTMLInputElement>('editor-size-width').readOnly).toBe(true);
    byId('editor-size-apply-btn').click();
    expect(exported().cc3d?.width).toBe(GRID_WIDTH);
  });

  it('gives the Epoxy chrome back when an Epoxy level follows', () => {
    editor.loadCompiledLevel(smallCc3dLevel());
    editor.initBlankMap();
    expect(byId('editor-layers-section').classList.contains('hidden')).toBe(true);
    expect(byId('editor-field-winrule').classList.contains('hidden')).toBe(false);
    const ruleset = byId<HTMLSelectElement>('editor-meta-ruleset');
    expect(ruleset.disabled).toBe(false);
    expect(Array.from(ruleset.options).find((option) => option.value === 'cc3d')?.disabled).toBe(true);
    expect(document.querySelector('[data-tool="fill"]')?.hasAttribute('aria-disabled')).toBe(false);
    expect(byId<HTMLInputElement>('editor-size-width').readOnly).toBe(false);
    expect(byId<HTMLButtonElement>('editor-size-apply-btn').disabled).toBe(false);
  });
});

describe('painting, erasing and undo on a CC3D level', () => {
  it('paints the selected entry, one history step per stroke, and undo takes it back', () => {
    editor.loadCompiledLevel(smallCc3dLevel());
    // Floors tab, then the second entry: water.
    tabs()[FIRST_BUTTON].click();
    paletteButtons()[SECOND_BUTTON].click();
    expect(cc3dEntriesOf('floors')[SECOND_BUTTON].kind).toBe('water');
    pointer('pointerdown', 1, 2);
    pointer('pointermove', 2, 2);
    pointer('pointermove', 3, 2);
    window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    expect([1, 2, 3].map((x) => topKindAt(x, 2))).toEqual(['water', 'water', 'water']);
    expect(editor.hasUnsavedChanges()).toBe(true);
    expect(byId<HTMLButtonElement>('editor-undo-btn').disabled).toBe(false);
    editor.undo();
    expect([1, 2, 3].map((x) => topKindAt(x, 2))).toEqual(['floor', 'floor', 'floor']);
    expect(editor.hasUnsavedChanges()).toBe(false);
    editor.redo();
    expect(topKindAt(2, 2)).toBe('water');
  });

  it('draws the whole map once and then only the cells an edit changed, with the stacked-layer marker on for the editor only', () => {
    renderer.drawTile.mockClear();
    editor.loadCompiledLevel(smallCc3dLevel());
    editor.render();
    const total = GRID_WIDTH * GRID_HEIGHT;
    expect(renderer.drawTile).toHaveBeenCalledTimes(total);
    // Moving the pointer over the map redraws nothing but the overlay.
    renderer.drawTile.mockClear();
    pointer('pointermove', 2, 2);
    editor.render();
    expect(renderer.drawTile).not.toHaveBeenCalled();
    // One painted cell: it and its neighbours under a clip are drawn again, nowhere near the whole map.
    tabs()[0].click();
    paletteButtons()[SECOND_BUTTON].click();
    click(1, 2);
    expect(renderer.drawTile.mock.calls.length).toBeLessThanOrEqual(9);
    expect(renderer.drawTile.mock.calls.some((call) => call[1] === 'water')).toBe(true);
    // The marker is switched on for the editor's drawing and back off after it.
    const switches = renderer.setHiddenLayerMarkers.mock.calls.map((call) => call[0]);
    expect(switches.length).toBeGreaterThan(0);
    expect(switches.at(-1)).toBe(false);
    expect(switches).toContain(true);
  });

  it('draws the whole map again when the look changes, and the player start over the layer every time', () => {
    renderer.drawTile.mockClear();
    editor.loadCompiledLevel(smallCc3dLevel());
    editor.render();
    const total = GRID_WIDTH * GRID_HEIGHT;
    expect(renderer.drawTile).toHaveBeenCalledTimes(total);
    renderer.drawPlayer.mockClear();
    editor.render();
    expect(renderer.drawTile).toHaveBeenCalledTimes(total);
    expect(renderer.drawPlayer).toHaveBeenCalledTimes(1);
    // A skin or theme change leaves the cells where they are but they must all be drawn in the new look.
    appearance = 'look-b';
    editor.render();
    expect(renderer.drawTile).toHaveBeenCalledTimes(total * 2);
    expect(renderer.drawPlayer).toHaveBeenCalledTimes(2);
    // A painted cell patches the layer (its 3x3 neighbourhood at most) and still draws the player once.
    renderer.drawTile.mockClear();
    renderer.drawPlayer.mockClear();
    tabs()[0].click();
    paletteButtons()[SECOND_BUTTON].click();
    click(2, 2);
    expect(renderer.drawTile.mock.calls.length).toBeLessThanOrEqual(9);
    expect(renderer.drawPlayer).toHaveBeenCalled();
  });

  it('keeps a map too wide for one chunk in several chunks and patches only the chunk an edit touches', () => {
    const wide = compiledCc3d(editableCc3dModel(['#'.repeat(WIDE_WIDTH), `#@${'.'.repeat(WIDE_WIDTH - 4)}X#`, '#'.repeat(WIDE_WIDTH)]), 'cc3d_wide');
    const created = vi.spyOn(document, 'createElement');
    editor.loadCompiledLevel(wide);
    editor.render();
    const chunks = created.mock.calls.filter((call) => call[0] === 'canvas').length;
    expect(chunks).toBeGreaterThanOrEqual(2);
    renderer.drawTile.mockClear();
    created.mockClear();
    editor.render();
    expect(renderer.drawTile).not.toHaveBeenCalled();
    // Paint a cell in the last column block: a handful of cells are drawn, and no chunk is rebuilt.
    canvas.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: WIDE_WIDTH * CELL_PX, bottom: 3 * CELL_PX, width: WIDE_WIDTH * CELL_PX, height: 3 * CELL_PX, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    tabs()[0].click();
    paletteButtons()[SECOND_BUTTON].click();
    click(WIDE_WIDTH - 5, 1);
    expect(renderer.drawTile.mock.calls.length).toBeLessThanOrEqual(9);
    expect(created.mock.calls.filter((call) => call[0] === 'canvas')).toHaveLength(0);
  });

  it('marks a cell as hiding layers only when something is really hidden', () => {
    renderer.drawCellOverlay.mockClear();
    editor.loadCompiledLevel(smallCc3dLevel());
    editor.render();
    // Walls and floor-based single layers hide nothing.
    expect(renderer.drawCellOverlay.mock.calls.every((call) => call[2] === false)).toBe(true);
    tabs()[0].click();
    paletteButtons()[SECOND_BUTTON].click();
    click(1, 2);
    tabs()[2].click();
    paletteButtons()[cc3dEntriesOf('blockers').findIndex((entry) => entry.kind === 'wall')].click();
    renderer.drawCellOverlay.mockClear();
    click(1, 2);
    expect(renderer.drawCellOverlay.mock.calls.some((call) => call[2] === true)).toBe(true);
  });

  it('refreshes the layers list when the picker or Alt-click reads a cell', () => {
    editor.loadCompiledLevel(smallCc3dLevel());
    const rows = (): number => document.querySelectorAll('#editor-layers-list li').length;
    editor.setTool('picker');
    click(3, 1);
    expect(byId('editor-layers-cell').textContent).toContain('3');
    expect(rows()).toBe(2);
    click(1, 2, { altKey: true });
    expect(rows()).toBe(1);
  });

  it('erases the top layer, and the whole cell with Shift', () => {
    editor.loadCompiledLevel(smallCc3dLevel());
    editor.setTool('eraser');
    // (4, 1) is the exit over its floor: it goes, and the floor stays.
    click(4, 1);
    expect(topKindAt(4, 1)).toBe('floor');
    // (2, 2) holds a block: plain eraser takes it, the cell under it is already bare.
    click(2, 2);
    expect(exported().cc3d?.mobs.some((mob) => mob.x === 2 && mob.y === 2)).toBe(false);
    editor.undo();
    expect(exported().cc3d?.mobs.some((mob) => mob.x === 2 && mob.y === 2)).toBe(true);
    // Shift clears the cell: item and layers at (3, 1).
    click(3, 1, { shiftKey: true });
    expect(cellAt(exported().cc3d!, 3, 1)).toEqual({ terrain: [{ kind: 'floor' }], panels: [], item: null });
  });

  it('toggles the side of the cell nearest the pointer in the thin wall mode, and by keyboard', () => {
    editor.loadCompiledLevel(smallCc3dLevel());
    tabs()[2].click();
    const panelIndex = cc3dEntriesOf('blockers').findIndex((entry) => entry.action === 'panel');
    paletteButtons()[panelIndex].click();
    // Near the east edge of (2, 1).
    pointer('pointerdown', 2, 1, { clientX: 2 * CELL_PX + CELL_PX - 1, clientY: 1 * CELL_PX + CELL_PX / 2 });
    window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    expect(cellAt(exported().cc3d!, 2, 1)?.panels).toEqual(['E']);
    // Again on the same side: off.
    pointer('pointerdown', 2, 1, { clientX: 2 * CELL_PX + CELL_PX - 1, clientY: 1 * CELL_PX + CELL_PX / 2 });
    window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    expect(cellAt(exported().cc3d!, 2, 1)?.panels).toEqual([]);
    // Keyboard: the cursor cell and the direction control (south).
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(cellAt(exported().cc3d!, 3, 1)?.panels).toEqual(['S']);
  });

  it('picks the creature, then the item, then the layer, with the attributes', () => {
    editor.loadCompiledLevel(smallCc3dLevel());
    editor.setTool('picker');
    click(2, 2);
    expect(document.querySelector('#editor-palette-grid .palette-item-btn.active')).not.toBeNull();
    expect(tabs().find((tab) => tab.classList.contains('active'))).toBe(tabs()[4]);
    expect(document.querySelector('[data-tool="brush"]')?.getAttribute('aria-pressed')).toBe('true');
    editor.setTool('picker');
    click(3, 1);
    expect(tabs().find((tab) => tab.classList.contains('active'))).toBe(tabs()[3]);
  });

  it('lists the layers of the cursor cell and removes one as an undoable edit', () => {
    editor.loadCompiledLevel(smallCc3dLevel());
    tabs()[2].click();
    // Wall is the default entry; put one on (1, 2), then look at that cell.
    click(1, 2);
    const rows = (): HTMLLIElement[] => Array.from(document.querySelectorAll<HTMLLIElement>('#editor-layers-list li'));
    expect(rows()).toHaveLength(2);
    const remove = rows()[1].querySelector('button')!;
    remove.click();
    expect(topKindAt(1, 2)).toBe('floor');
    expect(rows()).toHaveLength(1);
    expect(rows()[0].querySelector('button')!.disabled).toBe(true);
    editor.undo();
    expect(topKindAt(1, 2)).toBe('wall');
  });
});

/** A stored pack the editor can save into, as the id the level's source names. */
async function storedPackId(): Promise<string> {
  const created = await ConfigRegistry.createUserPack('Cc3d editor tests');
  if (!created.pack) throw new Error('The test pack was not created');
  return created.pack.id;
}

function levelsOf(packId: string): CompiledLevel[] {
  return ConfigRegistry.getAllPacks().find((candidate) => candidate.id === packId)?.levels ?? [];
}

describe('saving, checking and new levels', () => {
  it('keeps the cc3d data when the level is saved', async () => {
    const packId = await storedPackId();
    editor.loadCompiledLevel(smallCc3dLevel(), { source: { packId, levelId: null } });
    click(1, 2);
    await editor.save();
    const saved = levelsOf(packId).at(-1);
    expect(saved?.ruleset).toBe('cc3d');
    expect(saved?.cc3d).toBeDefined();
    expect(cellAt(saved!.cc3d!, 1, 2)?.terrain.at(-1)?.kind).toBe('wall');
    expect(saved?.terrain[2][1]).toBe('wall');
    expect(editor.hasUnsavedChanges()).toBe(false);
  });

  it('asks before saving a CC3D level with validator errors, and saves nothing when the answer is no', async () => {
    const noExit = compiledCc3d(editableCc3dModel(['#####', '#@..#', '#####']), 'cc3d_no_exit');
    const packId = await storedPackId();
    editor.loadCompiledLevel(noExit, { source: { packId, levelId: null } });
    confirmDialog.mockResolvedValueOnce(false);
    await editor.save();
    expect(confirmDialog).toHaveBeenCalledTimes(1);
    expect(levelsOf(packId)).toHaveLength(0);
    confirmDialog.mockResolvedValueOnce(true);
    await editor.save();
    expect(levelsOf(packId)).toHaveLength(1);
  });

  it('does not ask when the level is valid', async () => {
    const packId = await storedPackId();
    editor.loadCompiledLevel(smallCc3dLevel(), { source: { packId, levelId: null } });
    await editor.save();
    expect(confirmDialog).not.toHaveBeenCalled();
    expect(levelsOf(packId)).toHaveLength(1);
  });

  it('checks a CC3D level with the CC3D validator', async () => {
    editor.loadCompiledLevel(compiledCc3d(editableCc3dModel(['#####', '#@..#', '#####']), 'cc3d_no_exit'));
    byId('editor-validate-btn').click();
    await settleAsync();
    expect(byId('editor-check-badge').dataset.state).toBe('errors');
    editor.loadCompiledLevel(smallCc3dLevel());
    byId('editor-validate-btn').click();
    await settleAsync();
    expect(['valid', 'warnings']).toContain(byId('editor-check-badge').dataset.state);
  });

  it('creates a CC3D room only by its own choice, never for an empty room in a pack of CC3D levels', async () => {
    const packId = await storedPackId();
    editor.loadCompiledLevel(smallCc3dLevel(), { source: { packId, levelId: null } });
    await editor.save();
    expect(await editor.newLevelInPack(packId)).toBe(true);
    expect(exported().ruleset).toBeUndefined();
    expect(exported().cc3d).toBeUndefined();
  });

  it('starts a new CC3D room that validates and is a cc3d level', () => {
    editor.initBlankMap({ ruleset: 'cc3d' });
    const level = exported();
    expect(level.ruleset).toBe('cc3d');
    expect(level.cc3d).toBeDefined();
    expect(validateCc3dLevel(level.cc3d!)).toEqual([]);
    expect(tabs()).toHaveLength(CC3D_CATEGORIES.length);
    expect(byId<HTMLSelectElement>('editor-meta-ruleset').value).toBe('cc3d');
  });

  it('never converts a level through the engine select', () => {
    editor.loadCompiledLevel(smallCc3dLevel());
    const ruleset = byId<HTMLSelectElement>('editor-meta-ruleset');
    ruleset.value = 'epoxy';
    ruleset.dispatchEvent(new Event('input', { bubbles: true }));
    expect(exported().ruleset).toBe('cc3d');
    editor.initBlankMap();
    ruleset.value = 'cc3d';
    ruleset.dispatchEvent(new Event('input', { bubbles: true }));
    expect(exported().ruleset).toBeUndefined();
  });
});
