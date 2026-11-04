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
import { cellAt } from '../core/cc3d/model';
import type { CellEdge, CompiledLevel } from '../core/types';
import { i18n, t } from '../i18n/I18nManager';
import { LevelPackStorage } from '../storage/LevelPackStorage';
import { FakeIndexedDb } from '../test/FakeIndexedDb';
import { mountModals } from '../test/domFixture';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { smallCc3dLevel } from './cc3dEditorFixtures';
import { CC3D_CATEGORIES, cc3dEntriesOf, findCc3dEntry } from './cc3dPalette';
import { LevelEditor } from './LevelEditor';

const WIDTH = 8;
const HEIGHT = 6;
const ROOM_EDGES: CellEdge[] = [{ x: 2, y: 2, sides: ['N', 'E'] }];

const fake = new FakeIndexedDb();
let editor: LevelEditor;
let canvas: HTMLCanvasElement;

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

const status = (): string => byId('editor-status-bar').textContent ?? '';
const fillButton = (): HTMLButtonElement => byId<HTMLButtonElement>('editor-fill-selection-btn');
const toolButton = (tool: string): HTMLButtonElement => document.querySelector<HTMLButtonElement>(`.editor-tool-btn[data-tool="${tool}"]`)!;
const fill = (): boolean => editor.handleSelectionAction({ kind: 'fill' });

function room(edges?: CellEdge[]): CompiledLevel {
  const terrain: string[][] = Array.from({ length: HEIGHT }, (_, y) =>
    Array.from({ length: WIDTH }, (_, x) => (x === 0 || y === 0 || x === WIDTH - 1 || y === HEIGHT - 1 ? 'wall' : 'floor'))
  );
  return {
    id: 'lvl_fill_dom',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    customTitle: 'Fill room',
    playerStart: { x: 1, y: 1, dir: 'S' },
    terrain,
    items: terrain.map((row) => row.map(() => null as string | null)),
    entities: [],
    trapLinks: [],
    cloneLinks: [],
    ...(edges ? { cellEdges: edges.map((e) => ({ ...e, sides: [...e.sides] })) } : {})
  };
}

/** Puts the keyboard cursor on a cell, from the cell (1, 1) where it starts. */
function moveCursorTo(x: number, y: number): void {
  for (let i = 1; i < x; i++) press('ArrowRight');
  for (let i = 1; i < y; i++) press('ArrowDown');
}

/** Selects a rectangle with the keyboard: the cursor cell, then Shift+arrows. */
function selectRect(width: number, height: number): void {
  press('Enter');
  for (let i = 1; i < width; i++) press('ArrowRight', { shiftKey: true });
  for (let i = 1; i < height; i++) press('ArrowDown', { shiftKey: true });
}

/** Clicks the Epoxy palette entry with this name, whichever tab holds it. */
function clickPalette(name: string): void {
  const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('#editor-category-tabs button'));
  for (const tab of tabs) {
    tab.click();
    const button = Array.from(document.querySelectorAll<HTMLButtonElement>('#editor-palette-grid button')).find(
      (candidate) => candidate.querySelector('.palette-item-label')?.textContent === name
    );
    if (button) {
      button.click();
      return;
    }
  }
  throw new Error(`No palette entry named ${name}`);
}

const tileName = (id: string): string => t(ConfigRegistry.getTile(id)!.i18nKey);

/** Clicks a CC3D palette entry by its id and returns the label the palette shows for it. */
function clickCc3dEntry(id: string): string {
  const entry = findCc3dEntry(id)!;
  const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('#editor-category-tabs button'));
  tabs[CC3D_CATEGORIES.findIndex((category) => category.id === entry.category)].click();
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('#editor-palette-grid button'));
  const button = buttons[cc3dEntriesOf(entry.category).findIndex((candidate) => candidate.id === id)];
  const label = button.querySelector('.palette-item-label')?.textContent ?? '';
  button.click();
  return label;
}

function openRoom(edges?: CellEdge[]): void {
  editor.loadCompiledLevel(room(edges));
  canvas.focus();
  toolButton('select').click();
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

describe('fill selection on an Epoxy level', () => {
  it('keeps the Select tool and the selection when a palette entry is chosen, then fills as one undo step', () => {
    openRoom();
    moveCursorTo(1, 1);
    selectRect(2, 2);
    clickPalette(tileName('water'));
    expect(toolButton('select').getAttribute('aria-pressed')).toBe('true');
    expect(toolButton('brush').getAttribute('aria-pressed')).toBe('false');
    expect(status()).toBe(t('editor.selection.status.fill_hint', { name: tileName('water') }));

    expect(fill()).toBe(true);
    const terrain = editor.exportCompiledLevel().terrain;
    expect([terrain[1][1], terrain[1][2], terrain[2][1], terrain[2][2]]).toEqual(['water', 'water', 'water', 'water']);
    expect(terrain[1][3]).toBe('floor');
    expect(status()).toBe(t('editor.selection.status.filled', { width: 2, height: 2, name: tileName('water') }));

    // The selection is still there: a second fill finds nothing to change.
    expect(fill()).toBe(true);
    expect(status()).toBe(t('editor.selection.status.unchanged'));

    editor.undo();
    expect(editor.exportCompiledLevel().terrain[1][1]).toBe('floor');
    expect(byId<HTMLButtonElement>('editor-undo-btn').disabled).toBe(true);
    editor.redo();
    expect(editor.exportCompiledLevel().terrain[2][2]).toBe('water');
  });

  it('still puts the brush in hand when the Select tool has nothing selected', () => {
    openRoom();
    clickPalette(tileName('water'));
    expect(toolButton('brush').getAttribute('aria-pressed')).toBe('true');
    expect(toolButton('select').getAttribute('aria-pressed')).toBe('false');
  });

  it('leaves the outer ring alone and says how many cells it spared', () => {
    openRoom();
    press('ArrowLeft');
    press('ArrowUp');
    selectRect(2, 2);
    clickPalette(tileName('water'));
    fill();
    const terrain = editor.exportCompiledLevel().terrain;
    expect(terrain[0][0]).toBe('wall');
    expect(terrain[0][1]).toBe('wall');
    expect(terrain[1][0]).toBe('wall');
    expect(terrain[1][1]).toBe('water');
    expect(status()).toContain(t('editor.selection.status.border_skipped', { count: 3 }));
  });

  it('fills with an entity facing the chosen direction and leaves the player start cell alone', () => {
    openRoom();
    document.querySelector<HTMLButtonElement>('#editor-dir-group [data-dir="E"]')?.click();
    moveCursorTo(1, 1);
    selectRect(2, 1);
    clickPalette(t(ConfigRegistry.getEntityDef('dirt_block')!.i18nKey));
    fill();
    const level = editor.exportCompiledLevel();
    expect(level.entities).toEqual([{ x: 2, y: 1, type: 'dirt_block', dir: 'E' }]);
    expect(level.playerStart).toEqual({ x: 1, y: 1, dir: 'S' });
    expect(status()).toContain(t('editor.selection.status.fill_start_kept'));
  });

  it('keeps the thin walls of the filled cells', () => {
    openRoom(ROOM_EDGES);
    moveCursorTo(2, 2);
    selectRect(1, 1);
    clickPalette(tileName('water'));
    fill();
    const level = editor.exportCompiledLevel();
    expect(level.terrain[2][2]).toBe('water');
    expect(level.cellEdges).toEqual(ROOM_EDGES);
  });

  it('refuses the thin wall brush with a message and records no step', () => {
    openRoom();
    moveCursorTo(2, 2);
    selectRect(2, 2);
    clickPalette(t('editor.palette.tools.cell_edge'));
    expect(toolButton('select').getAttribute('aria-pressed')).toBe('true');
    expect(status()).toBe(t('editor.selection.status.fill_refused_cell_edge'));
    expect(fill()).toBe(true);
    expect(status()).toBe(t('editor.selection.status.fill_refused_cell_edge'));
    expect(byId<HTMLButtonElement>('editor-undo-btn').disabled).toBe(true);
    expect(editor.exportCompiledLevel().cellEdges).toBeUndefined();
  });

  it('enables the button only with a selection and answers a click on it when there is none', () => {
    openRoom();
    expect(fillButton().getAttribute('aria-disabled')).toBe('true');
    fillButton().click();
    expect(status()).toBe(t('editor.selection.status.none'));
    expect(byId<HTMLButtonElement>('editor-undo-btn').disabled).toBe(true);

    moveCursorTo(1, 1);
    selectRect(2, 2);
    expect(fillButton().getAttribute('aria-disabled')).toBe('false');
    clickPalette(tileName('water'));
    fillButton().click();
    expect(editor.exportCompiledLevel().terrain[1][1]).toBe('water');
    expect(status()).toBe(t('editor.selection.status.filled', { width: 2, height: 2, name: tileName('water') }));

    expect(fillButton().classList.contains('is-unavailable')).toBe(false);

    toolButton('brush').click();
    expect(fillButton().getAttribute('aria-disabled')).toBe('true');
    expect(fillButton().classList.contains('is-unavailable')).toBe(true);
  });

  it('ignores the fill while a paste floats and drops back to the brush when an entry is chosen', () => {
    openRoom();
    moveCursorTo(1, 1);
    selectRect(2, 2);
    editor.handleSelectionAction({ kind: 'copy' });
    clickPalette(tileName('water'));
    expect(editor.handleSelectionAction({ kind: 'paste' })).toBe(true);
    expect(fillButton().getAttribute('aria-disabled')).toBe('true');
    const before = JSON.stringify(editor.exportCompiledLevel());
    expect(fill()).toBe(true);
    fillButton().click();
    expect(JSON.stringify(editor.exportCompiledLevel())).toBe(before);
    expect(status()).toBe(t('editor.selection.status.paste_ready'));

    clickPalette(tileName('water'));
    expect(toolButton('brush').getAttribute('aria-pressed')).toBe('true');
  });

  it('says so, with no tool change, on the Select tool with nothing selected', () => {
    openRoom();
    expect(fill()).toBe(true);
    expect(status()).toBe(t('editor.selection.status.none'));
    expect(toolButton('select').getAttribute('aria-pressed')).toBe('true');
  });

  it('is not taken on another tool without a selection, so the key can still pick the fill tool', () => {
    editor.loadCompiledLevel(room());
    expect(fill()).toBe(false);
  });
});

describe('fill selection on a CC3D level', () => {
  /** 5 x 4: the player at (1, 1), a fish at (3, 1), a dirt block at (2, 2), a walker at (4, 2). */
  function openSmall(): void {
    editor.loadCompiledLevel(smallCc3dLevel());
    canvas.focus();
    toolButton('select').click();
    moveCursorTo(2, 1);
    selectRect(2, 2);
  }

  const cc3d = () => editor.exportCompiledLevel().cc3d!;

  it('fills a layer, keeping the items and the Select tool, as one undo step', () => {
    openSmall();
    const original = cc3d();
    const label = clickCc3dEntry('layer:water');
    expect(label).not.toBe('');
    expect(toolButton('select').getAttribute('aria-pressed')).toBe('true');
    expect(fill()).toBe(true);
    for (const [x, y] of [
      [2, 1],
      [3, 1],
      [2, 2],
      [3, 2]
    ]) {
      expect(cellAt(cc3d(), x, y)?.terrain.map((layer) => layer.kind)).toContain('water');
    }
    expect(cellAt(cc3d(), 3, 1)?.item?.kind).toBe('fish');
    expect(status()).toBe(t('editor.selection.status.filled', { width: 2, height: 2, name: label }));
    editor.undo();
    expect(cc3d()).toEqual(original);
    expect(byId<HTMLButtonElement>('editor-undo-btn').disabled).toBe(true);
  });

  it('fills with a creature, replacing the ones in place and skipping the player start', () => {
    openSmall();
    clickCc3dEntry('mob:walker');
    fill();
    const mobs = cc3d().mobs.filter((mob) => mob.x >= 2 && mob.x <= 3 && mob.y >= 1 && mob.y <= 2);
    expect(mobs.map((mob) => `${mob.kind}@${mob.x},${mob.y}`).sort()).toEqual(['walker@2,1', 'walker@2,2', 'walker@3,1', 'walker@3,2']);
    editor.undo();
    expect(cc3d().mobs.find((mob) => mob.x === 2 && mob.y === 2)?.kind).toBe('block_dirt');
  });

  it('skips the player start cell when filling with a creature, and says so', () => {
    editor.loadCompiledLevel(smallCc3dLevel());
    canvas.focus();
    toolButton('select').click();
    selectRect(2, 1);
    clickCc3dEntry('mob:walker');
    fill();
    expect(cc3d().mobs.some((mob) => mob.x === 1 && mob.y === 1)).toBe(false);
    expect(cc3d().mobs.some((mob) => mob.kind === 'walker' && mob.x === 2 && mob.y === 1)).toBe(true);
    expect(status()).toContain(t('editor.cc3d.status.area_mobs_skipped', { count: 1 }));
  });

  it('refuses the thin wall mode and the player start with a message and records no step', () => {
    openSmall();
    clickCc3dEntry('panel:panel');
    expect(status()).toBe(t('editor.selection.status.fill_refused_entry'));
    expect(fill()).toBe(true);
    expect(status()).toBe(t('editor.selection.status.fill_refused_entry'));
    clickCc3dEntry('player:player');
    expect(status()).toBe(t('editor.selection.status.fill_refused_entry'));
    expect(byId<HTMLButtonElement>('editor-undo-btn').disabled).toBe(true);
  });

  it('does not draw the thin wall side hint for the panel entry on the Select tool with a selection', () => {
    openSmall();
    clickCc3dEntry('panel:panel');
    expect(toolButton('select').getAttribute('aria-pressed')).toBe('true');
    expect((editor as never as { sideToolActive: () => boolean }).sideToolActive()).toBe(false);
    toolButton('brush').click();
    expect((editor as never as { sideToolActive: () => boolean }).sideToolActive()).toBe(true);
  });
});
