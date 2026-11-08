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
import type { CellEdge, CompiledLevel } from '../core/types';
import { i18n, t } from '../i18n/I18nManager';
import { LevelPackStorage } from '../storage/LevelPackStorage';
import { FakeIndexedDb } from '../test/FakeIndexedDb';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { mountModals } from '../test/domFixture';
import { serializePack } from '../packs/packJson';
import { PACK_JSON_VERSION_V13 } from '../config/constants';
import { LevelEditor } from './LevelEditor';

const WIDTH = 8;
const HEIGHT = 6;
const CELL_PX = 10;

const fake = new FakeIndexedDb();
let editor: LevelEditor;
let canvas: HTMLCanvasElement;
let drawCanopy: ReturnType<typeof vi.fn>;

const noopContext = (): CanvasRenderingContext2D =>
  new Proxy(() => undefined, { get: () => noopContext(), set: () => true, apply: () => undefined }) as unknown as CanvasRenderingContext2D;

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element ${id}`);
  return el as T;
}

function room(ruleset: 'lynx' | undefined, edges: CellEdge[] | undefined): CompiledLevel {
  const terrain: string[][] = Array.from({ length: HEIGHT }, (_, y) =>
    Array.from({ length: WIDTH }, (_, x) => (x === 0 || y === 0 || x === WIDTH - 1 || y === HEIGHT - 1 ? 'wall' : 'floor'))
  );
  return {
    id: 'lvl_canopy_dom',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    customTitle: 'Canopy room',
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

function paletteButton(label: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('#editor-palette-grid button')).find(
    (btn) => btn.querySelector('.palette-item-label')?.textContent === label
  );
}

function canopyButton(): HTMLButtonElement | undefined {
  return paletteButton(t('editor.palette.tools.canopy'));
}

function pointerAt(type: string, x: number, y: number, fx = 0.5, fy = 0.5): void {
  canvas.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: (x + fx) * CELL_PX, clientY: (y + fy) * CELL_PX }));
}

function release(): void {
  window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
}

function click(x: number, y: number): void {
  pointerAt('pointerdown', x, y);
  release();
}

const canopyCells = (): string[] =>
  (editor.exportCompiledLevel().cellEdges ?? []).filter((e) => e.canopy === true).map((e) => `${e.x},${e.y}`);

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
  canvas.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: WIDTH * CELL_PX, bottom: HEIGHT * CELL_PX, width: WIDTH * CELL_PX, height: HEIGHT * CELL_PX, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  drawCanopy = vi.fn();
  const renderer = {
    getAppearanceKey: vi.fn(() => 'look'),
    renderIconToDataUrl: vi.fn(() => 'data:,'),
    drawTile: vi.fn(),
    drawItem: vi.fn(),
    drawEntity: vi.fn(),
    drawPlayer: vi.fn(),
    drawCellOverlay: vi.fn(),
    drawCanopy: drawCanopy,
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

describe('the canopy brush', () => {
  it('sits in the Terrain tab beside the thin wall and says what it does', () => {
    editor.loadCompiledLevel(room(undefined, undefined));
    const button = canopyButton();
    expect(button).toBeDefined();
    expect(button?.getAttribute('aria-disabled')).toBeNull();
    expect(button?.getAttribute('aria-description')).toBe(t('editor.palette.tools.canopy_desc.label'));
    expect(button?.nextElementSibling).toBe(paletteButton(t('editor.palette.tools.cell_edge')));
    button?.click();
    expect(byId('editor-status-bar').textContent).toContain(t('editor.palette.tools.canopy_desc.label'));
  });

  it('is written in French too', () => {
    i18n.setLocale('fr');
    expect(t('editor.palette.tools.canopy')).not.toBe('editor.palette.tools.canopy');
    expect(t('editor.palette.tools.canopy_desc.label')).not.toBe('editor.palette.tools.canopy_desc.label');
  });

  it('toggles the canopy of a clicked cell and keeps the thin walls of the cell', () => {
    editor.loadCompiledLevel(room(undefined, [{ x: 3, y: 2, sides: ['N'] }]));
    canopyButton()?.click();
    click(3, 2);
    expect(editor.exportCompiledLevel().cellEdges).toEqual([{ x: 3, y: 2, sides: ['N'], canopy: true }]);
    click(3, 2);
    expect(editor.exportCompiledLevel().cellEdges).toEqual([{ x: 3, y: 2, sides: ['N'] }]);
  });

  it('puts a canopy on every cell of a drag, once each, as one undo step', () => {
    editor.loadCompiledLevel(room(undefined, undefined));
    canopyButton()?.click();
    pointerAt('pointerdown', 2, 2);
    pointerAt('pointermove', 2, 2, 0.8, 0.8);
    pointerAt('pointermove', 3, 2);
    pointerAt('pointermove', 3, 2, 0.2, 0.2);
    pointerAt('pointermove', 4, 2);
    release();
    expect(canopyCells()).toEqual(['2,2', '3,2', '4,2']);
    editor.undo();
    expect(canopyCells()).toEqual([]);
    editor.redo();
    expect(canopyCells()).toEqual(['2,2', '3,2', '4,2']);
  });

  it('takes the canopy off the cells of a drag that starts on a canopy', () => {
    editor.loadCompiledLevel(
      room(undefined, [
        { x: 2, y: 2, sides: [], canopy: true },
        { x: 3, y: 2, sides: [], canopy: true }
      ])
    );
    canopyButton()?.click();
    pointerAt('pointerdown', 2, 2);
    pointerAt('pointermove', 3, 2);
    pointerAt('pointermove', 4, 2);
    release();
    expect(editor.exportCompiledLevel().cellEdges).toBeUndefined();
  });

  it('is cleared by the eraser', () => {
    editor.loadCompiledLevel(
      room(undefined, [
        { x: 2, y: 2, sides: [], canopy: true },
        { x: 3, y: 2, sides: ['E'], canopy: true }
      ])
    );
    editor.setTool('eraser');
    click(2, 2);
    expect(editor.exportCompiledLevel().cellEdges).toEqual([{ x: 3, y: 2, sides: ['E'], canopy: true }]);
    click(3, 2);
    expect(editor.exportCompiledLevel().cellEdges).toBeUndefined();
    editor.undo();
    expect(canopyCells()).toEqual(['3,2']);
  });

  it('undoes and redoes a click', () => {
    editor.loadCompiledLevel(room(undefined, undefined));
    canopyButton()?.click();
    click(5, 3);
    expect(canopyCells()).toEqual(['5,3']);
    editor.undo();
    expect(canopyCells()).toEqual([]);
    editor.redo();
    expect(canopyCells()).toEqual(['5,3']);
  });

  it('does not draw the thin wall side bar', () => {
    editor.loadCompiledLevel(room(undefined, undefined));
    const hint = vi.spyOn(editor as unknown as { drawSideHint: (...args: unknown[]) => void }, 'drawSideHint');
    canopyButton()?.click();
    pointerAt('pointermove', 3, 2, 0.9, 0.5);
    editor.render();
    expect(hint).not.toHaveBeenCalled();
  });

  it('survives a save round trip, written as pack format 13 and reopened with its canopy', () => {
    editor.loadCompiledLevel(room(undefined, undefined));
    canopyButton()?.click();
    click(4, 3);
    const exported = editor.exportCompiledLevel();
    expect(exported.cellEdges).toEqual([{ x: 4, y: 3, sides: [], canopy: true }]);
    expect(JSON.parse(serializePack('Canopy', [exported])).version).toBe(PACK_JSON_VERSION_V13);
    editor.loadCompiledLevel(exported);
    expect(editor.exportCompiledLevel().cellEdges).toEqual([{ x: 4, y: 3, sides: [], canopy: true }]);
  });

  it('draws the roof of a placed canopy, and stops drawing it once it is taken off', () => {
    editor.loadCompiledLevel(room(undefined, undefined));
    drawCanopy.mockClear();
    editor.render();
    expect(drawCanopy).not.toHaveBeenCalled();
    canopyButton()?.click();
    click(3, 2);
    drawCanopy.mockClear();
    editor.render();
    expect(drawCanopy).toHaveBeenCalled();
    click(3, 2);
    drawCanopy.mockClear();
    editor.render();
    expect(drawCanopy).not.toHaveBeenCalled();
  });

  it('is greyed under Lynx rules with the reason, and a click changes nothing', () => {
    editor.loadCompiledLevel(room('lynx', undefined));
    const button = canopyButton();
    expect(button?.getAttribute('aria-disabled')).toBe('true');
    expect(button?.getAttribute('aria-description')).toBe(t('editor.palette.unavailable.epoxy_only.label'));
    // Even with the brush forced, the application refuses.
    editor['brush'] = { kind: 'cell_edge', id: 'canopy' };
    click(3, 2);
    expect(editor.exportCompiledLevel().cellEdges).toBeUndefined();
    expect(byId('editor-status-bar').textContent).toBe(t('editor.palette.unavailable.epoxy_only.label'));
  });
});
