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
import { LevelEditor } from './LevelEditor';

const WIDTH = 8;
const HEIGHT = 6;
const EDGES_LEVEL_INDEX = 2;
const ROOM_EDGES: CellEdge[] = [{ x: 3, y: 2, sides: ['N', 'E'] }];

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
