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
import type { CellEdge, CompiledLevel, LevelBlueprint } from '../core/types';
import { datRefusalReason } from '../formats/DatCodec';
import { i18n, t } from '../i18n/I18nManager';
import { LevelPackStorage } from '../storage/LevelPackStorage';
import { FakeIndexedDb } from '../test/FakeIndexedDb';
import showcase from '../test/fixtures/mechanicsShowcase.json';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { mountModals } from '../test/domFixture';
import { cc3dEntriesOf } from './cc3dPalette';
import { smallCc3dLevel } from './cc3dEditorFixtures';
import { LevelEditor } from './LevelEditor';

const WIDTH = 8;
const HEIGHT = 6;
const EDGES_LEVEL_INDEX = 2;
const ROOM_EDGES: CellEdge[] = [{ x: 3, y: 2, sides: ['N', 'E'] }];
const CELL_PX = 10;

const fake = new FakeIndexedDb();
let editor: LevelEditor;
let canvas: HTMLCanvasElement;
let drawCellOverlay: ReturnType<typeof vi.fn>;
let onTestPlay: ReturnType<typeof vi.fn>;

const noopContext = (): CanvasRenderingContext2D =>
  new Proxy(() => undefined, { get: () => noopContext(), set: () => true, apply: () => undefined }) as unknown as CanvasRenderingContext2D;

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element ${id}`);
  return el as T;
}

function press(name: string, init: KeyboardEventInit = {}): void {
  canvas.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init }));
}

function room(ruleset: 'lynx' | undefined, edges: CellEdge[] | undefined): CompiledLevel {
  const terrain: string[][] = Array.from({ length: HEIGHT }, (_, y) =>
    Array.from({ length: WIDTH }, (_, x) => (x === 0 || y === 0 || x === WIDTH - 1 || y === HEIGHT - 1 ? 'wall' : 'floor'))
  );
  return {
    id: 'lvl_edges_dom',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    customTitle: 'Edges room',
    ruleset,
    playerStart: { x: 1, y: 1, dir: 'S' },
    terrain,
    items: terrain.map((row) => row.map(() => null as string | null)),
    entities: [],
    trapLinks: [],
    cloneLinks: [],
    ...(edges ? { cellEdges: edges.map((e) => ({ ...e, sides: [...e.sides] })) } : {})
  };
}

function showcaseEdgesLevel(): CompiledLevel {
  const blueprint = (showcase as { levels: LevelBlueprint[] }).levels[EDGES_LEVEL_INDEX];
  return ConfigRegistry.compileBlueprint(blueprint);
}

function lynxOption(): HTMLOptionElement | undefined {
  return Array.from(byId<HTMLSelectElement>('editor-meta-ruleset').options).find((option) => option.value === 'lynx');
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
  drawCellOverlay = vi.fn();
  onTestPlay = vi.fn();
  const renderer = {
    getAppearanceKey: vi.fn(() => 'look'),
    renderIconToDataUrl: vi.fn(() => 'data:,'),
    drawTile: vi.fn(),
    drawItem: vi.fn(),
    drawEntity: vi.fn(),
    drawPlayer: vi.fn(),
    drawCellOverlay,
    setHiddenLayerMarkers: vi.fn()
  };
  const hooks = { onTestPlay, onLevelSaved: vi.fn(), onNotify: vi.fn(), openManager: vi.fn(), importAsPack: vi.fn(), getConfigBundle: vi.fn() };
  editor = new LevelEditor(canvas, renderer as never, hooks as never);
  editor.buildUI();
});

afterEach(async () => {
  editor.dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await LevelPackStorage.closeConnection();
});

describe('thin walls in the editor', () => {
  it('are kept when an Epoxy level is opened and exported', () => {
    editor.loadCompiledLevel(room(undefined, ROOM_EDGES));
    expect(editor.exportCompiledLevel().cellEdges).toEqual(ROOM_EDGES);
  });

  it('lock the Lynx choice, with the reason', () => {
    editor.loadCompiledLevel(room(undefined, ROOM_EDGES));
    expect(lynxOption()?.disabled).toBe(true);
    expect(lynxOption()?.title).toBe(t('editor.metadata.ruleset_lynx_unavailable.label'));
    expect(t('editor.metadata.ruleset_lynx_unavailable.label').toLowerCase()).toContain('thin wall');
  });

  it('leave the Lynx choice open when the level has none', () => {
    editor.loadCompiledLevel(room(undefined, undefined));
    expect(lynxOption()?.disabled).toBe(false);
  });

  it('switch a stored Lynx level that holds some to Epoxy on open, keeping them', () => {
    editor.loadCompiledLevel(room('lynx', ROOM_EDGES));
    const exported = editor.exportCompiledLevel();
    expect(exported.ruleset).toBeUndefined();
    expect(exported.cellEdges).toEqual(ROOM_EDGES);
  });

  it('survive a resize that keeps their cell and announce one that drops them', () => {
    editor.loadCompiledLevel(room(undefined, ROOM_EDGES));
    byId<HTMLInputElement>('editor-size-width').value = '10';
    byId<HTMLButtonElement>('editor-size-apply-btn').click();
    expect(editor.exportCompiledLevel().cellEdges).toEqual(ROOM_EDGES);

    editor.loadCompiledLevel(room(undefined, [{ x: 6, y: 2, sides: ['W'] }]));
    byId<HTMLInputElement>('editor-size-width').value = '6';
    byId<HTMLButtonElement>('editor-size-apply-btn').click();
    expect(editor.exportCompiledLevel().cellEdges).toBeUndefined();
    expect(byId('editor-status-bar').textContent).toContain(t('editor.layout.size.dropped_edges', { count: 1 }));
  });

  it('survive a copy and a paste, and a paste under Lynx drops and counts them', () => {
    editor.loadCompiledLevel(room(undefined, ROOM_EDGES));
    canvas.focus();
    document.querySelector<HTMLButtonElement>('.editor-tool-btn[data-tool="select"]')?.click();
    // Cursor to the cell (3, 2), then select that single cell and copy it.
    press('ArrowRight');
    press('ArrowRight');
    press('ArrowDown');
    press('Enter');
    expect(editor.handleSelectionAction({ kind: 'copy' })).toBe(true);

    editor.loadCompiledLevel(room('lynx', undefined));
    canvas.focus();
    expect(editor.handleSelectionAction({ kind: 'paste' })).toBe(true);
    press('ArrowRight');
    press('ArrowDown');
    press('Enter');
    const pasted = editor.exportCompiledLevel();
    expect(pasted.ruleset).toBe('lynx');
    expect(pasted.cellEdges).toBeUndefined();
    expect(byId('editor-status-bar').textContent).toContain(t('editor.selection.status.paste_skipped', { count: 1 }));
  });

  it('are drawn over the cells of an Epoxy level, and only those', () => {
    editor.loadCompiledLevel(showcaseEdgesLevel());
    const drawn = (): Set<string> =>
      new Set(
        drawCellOverlay.mock.calls
          .filter((call) => Array.isArray(call[1]) && call[1].length > 0)
          .map((call) => `${call[1].join('')}@${call[3]},${call[4]}`)
      );
    expect(drawn().size).toBe(3);
    expect([...drawn()].map((entry) => entry.split('@')[0]).sort()).toEqual(['E', 'W', 'W']);
    drawCellOverlay.mockClear();
    editor.loadCompiledLevel(room(undefined, undefined));
    expect(drawn().size).toBe(0);
  });

  it('stop being drawn when their cell is erased, and come back with undo', () => {
    editor.loadCompiledLevel(room(undefined, ROOM_EDGES));
    const wallDrawn = (): boolean =>
      drawCellOverlay.mock.calls.some((call) => Array.isArray(call[1]) && call[1].join('') === 'NE' && call[3] === 3 * call[5] && call[4] === 2 * call[5]);
    drawCellOverlay.mockClear();
    canvas.focus();
    document.querySelector<HTMLButtonElement>('.editor-tool-btn[data-tool="eraser"]')?.click();
    press('ArrowRight');
    press('ArrowRight');
    press('ArrowDown');
    press('Enter');
    expect(editor.exportCompiledLevel().cellEdges).toBeUndefined();
    drawCellOverlay.mockClear();
    editor.render();
    expect(drawCellOverlay.mock.calls.some((call) => Array.isArray(call[1]) && call[1].length > 0)).toBe(false);
    editor.undo();
    drawCellOverlay.mockClear();
    editor.render();
    expect(editor.exportCompiledLevel().cellEdges).toEqual(ROOM_EDGES);
    expect(wallDrawn()).toBe(true);
  });

  it('are refused by the .CCL export', () => {
    editor.loadCompiledLevel(showcaseEdgesLevel());
    expect(datRefusalReason(editor.exportCompiledLevel())).toBe('cell_edges');
  });

  it('stay in the level handed to the game by "Test from here"', async () => {
    editor.loadCompiledLevel(showcaseEdgesLevel());
    await editor['testPlay']({ x: 2, y: 1 });
    expect(onTestPlay).toHaveBeenCalledTimes(1);
    const played = onTestPlay.mock.calls[0][0] as CompiledLevel;
    expect(played.cellEdges).toEqual(showcaseEdgesLevel().cellEdges);
    expect(played.playerStart).toMatchObject({ x: 2, y: 1 });
  });
});

/** The button of the palette whose label is the given text, in the active tab. */
function paletteButton(label: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('#editor-palette-grid button')).find(
    (btn) => btn.querySelector('.palette-item-label')?.textContent === label
  );
}

function edgeButton(): HTMLButtonElement | undefined {
  return paletteButton(t('editor.palette.tools.cell_edge'));
}

/** A pointer event at an offset (0 to 1) inside the cell (x, y); the canvas is WIDTH x HEIGHT cells of CELL_PX. */
function pointerAt(type: string, x: number, y: number, fx = 0.5, fy = 0.5, init: MouseEventInit = {}): void {
  canvas.dispatchEvent(
    new MouseEvent(type, { bubbles: true, cancelable: true, clientX: (x + fx) * CELL_PX, clientY: (y + fy) * CELL_PX, ...init })
  );
}

function release(): void {
  window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
}

const CC3D_WIDTH = 5;
const CC3D_HEIGHT = 4;

/** The canvas of the small CC3D fixture: CC3D_WIDTH x CC3D_HEIGHT cells of CELL_PX. */
function useCc3dGrid(): void {
  canvas.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: CC3D_WIDTH * CELL_PX, bottom: CC3D_HEIGHT * CELL_PX, width: CC3D_WIDTH * CELL_PX, height: CC3D_HEIGHT * CELL_PX, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
}

/** A click near the east side of a cell. */
function clickEast(x: number, y: number): void {
  pointerAt('pointerdown', x, y, 0.9, 0.5);
  release();
}

describe('the thin wall tool', () => {
  beforeEach(() => {
    canvas.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: WIDTH * CELL_PX, bottom: HEIGHT * CELL_PX, width: WIDTH * CELL_PX, height: HEIGHT * CELL_PX, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  });

  it('ends the Terrain tab on an Epoxy level, and is absent from a CC3D palette', () => {
    editor.loadCompiledLevel(room(undefined, undefined));
    const button = edgeButton();
    expect(button).toBeDefined();
    expect(button?.getAttribute('aria-disabled')).toBeNull();
    const buttons = Array.from(document.querySelectorAll('#editor-palette-grid button'));
    expect(buttons[buttons.length - 1]).toBe(button);

    editor.loadCompiledLevel(smallCc3dLevel());
    const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('#editor-category-tabs button'));
    for (const tab of tabs) {
      tab.click();
      expect(edgeButton()).toBeUndefined();
    }
  });

  it('is greyed under Lynx with the reason, and a click on the map changes nothing', () => {
    editor.loadCompiledLevel(room('lynx', undefined));
    const button = edgeButton();
    expect(button?.getAttribute('aria-disabled')).toBe('true');
    expect(button?.getAttribute('aria-description')).toBe(t('editor.palette.unavailable.epoxy_only.label'));
    button?.click();
    expect(byId('editor-status-bar').textContent).toBe(t('editor.palette.unavailable.epoxy_only.label'));
    // Even with the brush forced, the application refuses.
    editor['brush'] = { kind: 'cell_edge', id: 'cell_edge' };
    clickEast(3, 2);
    expect(editor.exportCompiledLevel().cellEdges).toBeUndefined();
    expect(byId('editor-status-bar').textContent).toBe(t('editor.palette.unavailable.epoxy_only.label'));
  });

  it('says what it does when it is chosen', () => {
    editor.loadCompiledLevel(room(undefined, undefined));
    edgeButton()?.click();
    expect(byId('editor-status-bar').textContent).toBe(t('editor.palette.status.cell_edge_mode'));
  });

  it('toggles the side nearest the pointer with one undo step, and locks the Lynx choice', () => {
    editor.loadCompiledLevel(room(undefined, undefined));
    expect(lynxOption()?.disabled).toBe(false);
    edgeButton()?.click();
    clickEast(3, 2);
    expect(editor.exportCompiledLevel().cellEdges).toEqual([{ x: 3, y: 2, sides: ['E'] }]);
    expect(lynxOption()?.disabled).toBe(true);
    clickEast(3, 2);
    expect(editor.exportCompiledLevel().cellEdges).toBeUndefined();
    clickEast(3, 2);
    pointerAt('pointerdown', 3, 2, 0.5, 0.1);
    release();
    expect(editor.exportCompiledLevel().cellEdges).toEqual([{ x: 3, y: 2, sides: ['N', 'E'] }]);
    editor.undo();
    expect(editor.exportCompiledLevel().cellEdges).toEqual([{ x: 3, y: 2, sides: ['E'] }]);
  });

  it('toggles once for a drag, not once per cell crossed', () => {
    editor.loadCompiledLevel(room(undefined, undefined));
    edgeButton()?.click();
    pointerAt('pointerdown', 3, 2, 0.9, 0.5);
    pointerAt('pointermove', 4, 2, 0.9, 0.5);
    pointerAt('pointermove', 5, 2, 0.9, 0.5);
    release();
    expect(editor.exportCompiledLevel().cellEdges).toEqual([{ x: 3, y: 2, sides: ['E'] }]);
    editor.undo();
    expect(editor.exportCompiledLevel().cellEdges).toBeUndefined();
  });

  it('removes a wall that the neighbour holds, from both cells, in one click', () => {
    editor.loadCompiledLevel(
      room(undefined, [
        { x: 3, y: 2, sides: ['E'] },
        { x: 4, y: 2, sides: ['W', 'S'] }
      ])
    );
    edgeButton()?.click();
    pointerAt('pointerdown', 4, 2, 0.1, 0.5);
    release();
    expect(editor.exportCompiledLevel().cellEdges).toEqual([{ x: 4, y: 2, sides: ['S'] }]);
  });

  it('uses the direction control for the keyboard, on Space', () => {
    editor.loadCompiledLevel(room(undefined, undefined));
    edgeButton()?.click();
    canvas.focus();
    document.querySelector<HTMLButtonElement>('#editor-dir-group [data-dir="E"]')?.click();
    press('ArrowRight');
    press(' ');
    expect(editor.exportCompiledLevel().cellEdges).toEqual([{ x: 2, y: 1, sides: ['E'] }]);
    document.querySelector<HTMLButtonElement>('#editor-dir-group [data-dir="N"]')?.click();
    press(' ');
    expect(editor.exportCompiledLevel().cellEdges).toEqual([{ x: 2, y: 1, sides: ['N', 'E'] }]);
  });

  it('draws the side bar only while its entry is the brush, and follows the pointer and the direction control', () => {
    editor.loadCompiledLevel(room(undefined, undefined));
    const hint = vi.spyOn(editor as unknown as { drawSideHint: (...args: unknown[]) => void }, 'drawSideHint');
    pointerAt('pointermove', 3, 2, 0.9, 0.5);
    editor.render();
    expect(hint).not.toHaveBeenCalled();

    edgeButton()?.click();
    hint.mockClear();
    pointerAt('pointermove', 3, 2, 0.9, 0.5);
    editor.render();
    expect(hint).toHaveBeenCalledWith({ x: 3, y: 2 }, 'E', expect.any(Number));

    hint.mockClear();
    pointerAt('pointermove', 3, 2, 0.5, 0.95);
    editor.render();
    expect(hint).toHaveBeenCalledWith({ x: 3, y: 2 }, 'S', expect.any(Number));

    // With the pointer gone, the keyboard cursor and the direction control take over.
    canvas.dispatchEvent(new MouseEvent('pointerleave', { bubbles: true }));
    canvas.focus();
    press('ArrowRight');
    document.querySelector<HTMLButtonElement>('#editor-dir-group [data-dir="W"]')?.click();
    expect(hint).toHaveBeenLastCalledWith({ x: 2, y: 1 }, 'W', expect.any(Number));

    // Another tool or entry puts the bar away.
    hint.mockClear();
    editor.setTool('eraser');
    editor.render();
    expect(hint).not.toHaveBeenCalled();
  });

  it('leaves the picker taking terrain, and the eraser clearing only the walls of its own cell', () => {
    editor.loadCompiledLevel(
      room(undefined, [
        { x: 3, y: 2, sides: ['E'] },
        { x: 4, y: 2, sides: ['W'] }
      ])
    );
    edgeButton()?.click();
    editor.setTool('picker');
    pointerAt('pointerdown', 3, 2);
    release();
    expect(editor['brush']).toEqual({ kind: 'terrain', id: 'floor' });

    editor.setTool('eraser');
    pointerAt('pointerdown', 4, 2);
    release();
    expect(editor.exportCompiledLevel().cellEdges).toEqual([{ x: 3, y: 2, sides: ['E'] }]);
  });

  it('exports several toggled walls in canonical order', () => {
    editor.loadCompiledLevel(room(undefined, undefined));
    edgeButton()?.click();
    clickEast(2, 3);
    clickEast(1, 3);
    expect(editor.exportCompiledLevel().cellEdges).toEqual([
      { x: 1, y: 3, sides: ['E'] },
      { x: 2, y: 3, sides: ['E'] }
    ]);
  });

  it('redraws the map after an Alt-click pick, so the side bar goes away with its entry', () => {
    editor.loadCompiledLevel(room(undefined, undefined));
    edgeButton()?.click();
    pointerAt('pointermove', 3, 2, 0.9, 0.5);
    const render = vi.spyOn(editor, 'render');
    const hint = vi.spyOn(editor as unknown as { drawSideHint: (...args: unknown[]) => void }, 'drawSideHint');
    pointerAt('pointerdown', 3, 2, 0.5, 0.5, { altKey: true });
    release();
    expect(editor['brush']).toEqual({ kind: 'terrain', id: 'floor' });
    expect(render).toHaveBeenCalled();
    hint.mockClear();
    editor.render();
    expect(hint).not.toHaveBeenCalled();
  });

  it('draws the side bar on a CC3D level with the thin wall entry and not with another entry', () => {
    editor.loadCompiledLevel(smallCc3dLevel());
    useCc3dGrid();
    const hint = vi.spyOn(editor as unknown as { drawSideHint: (...args: unknown[]) => void }, 'drawSideHint');
    pointerAt('pointermove', 2, 1, 0.9, 0.5);
    editor.render();
    expect(hint).not.toHaveBeenCalled();

    const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('#editor-category-tabs button'));
    tabs[2].click();
    const entries = cc3dEntriesOf('blockers');
    const panelIndex = entries.findIndex((entry) => entry.action === 'panel');
    const otherIndex = entries.findIndex((entry) => entry.action !== 'panel');
    const buttons = (): HTMLButtonElement[] => Array.from(document.querySelectorAll<HTMLButtonElement>('#editor-palette-grid button'));
    buttons()[otherIndex].click();
    hint.mockClear();
    pointerAt('pointermove', 2, 1, 0.9, 0.5);
    editor.render();
    expect(hint).not.toHaveBeenCalled();

    buttons()[panelIndex].click();
    hint.mockClear();
    pointerAt('pointermove', 2, 1, 0.9, 0.5);
    editor.render();
    expect(hint).toHaveBeenCalledWith({ x: 2, y: 1 }, 'E', expect.any(Number));
  });

  it('follows the keyboard cursor after a keyboard move even while the pointer hovers, and the pointer again after it moves', () => {
    editor.loadCompiledLevel(room(undefined, undefined));
    edgeButton()?.click();
    const hint = vi.spyOn(editor as unknown as { drawSideHint: (...args: unknown[]) => void }, 'drawSideHint');
    pointerAt('pointermove', 3, 2, 0.9, 0.5);
    canvas.focus();
    document.querySelector<HTMLButtonElement>('#editor-dir-group [data-dir]')?.click();
    press('ArrowRight');
    document.querySelector<HTMLButtonElement>('#editor-dir-group [data-dir="W"]')?.click();
    hint.mockClear();
    editor.render();
    expect(hint).toHaveBeenLastCalledWith({ x: 2, y: 1 }, 'W', expect.any(Number));

    hint.mockClear();
    pointerAt('pointermove', 3, 2, 0.9, 0.5);
    editor.render();
    expect(hint).toHaveBeenLastCalledWith({ x: 3, y: 2 }, 'E', expect.any(Number));
  });

  it('puts the bar on the cursor cell after a thin wall entry is chosen by keyboard, on Epoxy and CC3D levels', () => {
    editor.loadCompiledLevel(room(undefined, undefined));
    const hint = vi.spyOn(editor as unknown as { drawSideHint: (...args: unknown[]) => void }, 'drawSideHint');
    canvas.focus();
    press('ArrowRight');
    pointerAt('pointermove', 3, 2, 0.9, 0.5);
    press('ArrowDown');
    hint.mockClear();
    // A click with no pointer detail is how Enter or Space activates a button.
    edgeButton()?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
    expect(hint).toHaveBeenLastCalledWith({ x: 2, y: 2 }, expect.any(String), expect.any(Number));

    editor.loadCompiledLevel(smallCc3dLevel());
    useCc3dGrid();
    Array.from(document.querySelectorAll<HTMLButtonElement>('#editor-category-tabs button'))[2].click();
    canvas.focus();
    press('ArrowRight');
    pointerAt('pointermove', 3, 2, 0.9, 0.5);
    const panelIndex = cc3dEntriesOf('blockers').findIndex((entry) => entry.action === 'panel');
    hint.mockClear();
    document
      .querySelectorAll<HTMLButtonElement>('#editor-palette-grid button')
      [panelIndex].dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
    expect(hint).toHaveBeenLastCalledWith(editor['cursorCell'], expect.any(String), expect.any(Number));
  });

  it('follows the keyboard cursor on a CC3D level too, and the pointer once it moves', () => {
    editor.loadCompiledLevel(smallCc3dLevel());
    useCc3dGrid();
    Array.from(document.querySelectorAll<HTMLButtonElement>('#editor-category-tabs button'))[2].click();
    const panelIndex = cc3dEntriesOf('blockers').findIndex((entry) => entry.action === 'panel');
    document.querySelectorAll<HTMLButtonElement>('#editor-palette-grid button')[panelIndex].click();
    const hint = vi.spyOn(editor as unknown as { drawSideHint: (...args: unknown[]) => void }, 'drawSideHint');
    pointerAt('pointermove', 3, 2, 0.9, 0.5);
    canvas.focus();
    press('ArrowRight');
    hint.mockClear();
    editor.render();
    expect(hint).toHaveBeenLastCalledWith(editor['cursorCell'], editor['activeDir'], expect.any(Number));

    hint.mockClear();
    pointerAt('pointermove', 3, 2, 0.9, 0.5);
    editor.render();
    expect(hint).toHaveBeenLastCalledWith({ x: 3, y: 2 }, 'E', expect.any(Number));
  });
});
