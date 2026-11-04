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
vi.mock('../ui/confirmDialog', () => ({ confirmDialog: vi.fn(async () => false) }));
vi.mock('../ui/saveIntoDialog', () => ({ askSaveInto: vi.fn() }));

import type { CellUnderlay, CompiledLevel } from '../core/types';
import { datRefusalReason } from '../formats/DatCodec';
import { i18n, t } from '../i18n/I18nManager';
import { LevelPackStorage } from '../storage/LevelPackStorage';
import { FakeIndexedDb } from '../test/FakeIndexedDb';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { mountModals } from '../test/domFixture';
import { EDITOR_CELL_ANNOUNCE_DELAY_MS } from '../ui/uiConstants';
import { smallCc3dLevel } from './cc3dEditorFixtures';
import { LevelEditor } from './LevelEditor';

const WIDTH = 8;
const HEIGHT = 6;
const CELL_PX = 10;
const DOOR_X = 3;
const DOOR_Y = 2;
const HIDDEN: CellUnderlay[] = [{ x: DOOR_X, y: DOOR_Y, terrain: 'ice' }];

const fake = new FakeIndexedDb();
let editor: LevelEditor;
let canvas: HTMLCanvasElement;
let drawCellOverlay: ReturnType<typeof vi.fn>;
let setHiddenLayerMarkers: ReturnType<typeof vi.fn>;
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

/** A walled room with a red door at (3, 2) and the given hidden terrain. */
function room(ruleset: 'lynx' | undefined, underlays: CellUnderlay[] | undefined, withDoor = true): CompiledLevel {
  const terrain: string[][] = Array.from({ length: HEIGHT }, (_, y) =>
    Array.from({ length: WIDTH }, (_, x) => (x === 0 || y === 0 || x === WIDTH - 1 || y === HEIGHT - 1 ? 'wall' : 'floor'))
  );
  if (withDoor) terrain[DOOR_Y][DOOR_X] = 'door_red';
  // An exit and a key away from the door keep the room valid for "Test from here".
  terrain[HEIGHT - 2][WIDTH - 2] = 'exit';
  return {
    id: 'lvl_underlays_dom',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    customTitle: 'Hidden room',
    ruleset,
    playerStart: { x: 1, y: 1, dir: 'S' },
    terrain,
    items: terrain.map((row, y) => row.map((_, x) => (withDoor && x === 1 && y === HEIGHT - 2 ? 'key_red' : null) as string | null)),
    entities: [],
    trapLinks: [],
    cloneLinks: [],
    ...(underlays ? { underlays: underlays.map((u) => ({ ...u })) } : {})
  };
}

function lynxOption(): HTMLOptionElement | undefined {
  return Array.from(byId<HTMLSelectElement>('editor-meta-ruleset').options).find((option) => option.value === 'lynx');
}

/** The canvas of the room: WIDTH x HEIGHT cells of CELL_PX. */
function useRoomGrid(): void {
  canvas.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: WIDTH * CELL_PX, bottom: HEIGHT * CELL_PX, width: WIDTH * CELL_PX, height: HEIGHT * CELL_PX, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
}

function clickCell(x: number, y: number): void {
  canvas.dispatchEvent(
    new MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: (x + 0.5) * CELL_PX, clientY: (y + 0.5) * CELL_PX })
  );
  window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
}

/** The calls that drew the hidden terrain marker: a marked cell with no panel bars. */
function markerCalls(): unknown[][] {
  return drawCellOverlay.mock.calls.filter((call) => call[2] === true);
}

function markerDrawnAt(x: number, y: number): boolean {
  return markerCalls().some((call) => call[3] === x * (call[5] as number) && call[4] === y * (call[5] as number));
}

const status = (): string => byId('editor-status-bar').textContent ?? '';

beforeEach(() => {
  // loadTestConfigs registers the terrain lookup, so the editor prunes for real.
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
  useRoomGrid();
  drawCellOverlay = vi.fn();
  setHiddenLayerMarkers = vi.fn();
  onTestPlay = vi.fn();
  const renderer = {
    getAppearanceKey: vi.fn(() => 'look'),
    renderIconToDataUrl: vi.fn(() => 'data:,'),
    drawTile: vi.fn(),
    drawItem: vi.fn(),
    drawEntity: vi.fn(),
    drawPlayer: vi.fn(),
    drawCellOverlay,
    setHiddenLayerMarkers
  };
  const hooks = { onTestPlay, onLevelSaved: vi.fn(), onNotify: vi.fn(), openManager: vi.fn(), importAsPack: vi.fn(), getConfigBundle: vi.fn() };
  editor = new LevelEditor(canvas, renderer as never, hooks as never);
  editor.buildUI();
});

afterEach(async () => {
  editor.dispose();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await LevelPackStorage.closeConnection();
});

describe('hidden terrain in the editor', () => {
  it('is kept when an Epoxy level is opened and exported', () => {
    editor.loadCompiledLevel(room(undefined, HIDDEN));
    expect(editor.exportCompiledLevel().underlays).toEqual(HIDDEN);
  });

  it('is absent from the export of a level that has none', () => {
    editor.loadCompiledLevel(room(undefined, undefined));
    expect('underlays' in editor.exportCompiledLevel()).toBe(false);
  });

  it('locks the Lynx choice, with the reason', () => {
    editor.loadCompiledLevel(room(undefined, HIDDEN));
    expect(lynxOption()?.disabled).toBe(true);
    expect(lynxOption()?.title).toBe(t('editor.metadata.ruleset_lynx_unavailable.label'));
    expect(t('editor.metadata.ruleset_lynx_unavailable.label').toLowerCase()).toContain('terrain hidden');
    expect(t('editor.layout.rules.description.lynx').toLowerCase()).toContain('terrain hidden under tiles');
  });

  it('leaves the Lynx choice open when the level has none', () => {
    editor.loadCompiledLevel(room(undefined, undefined));
    expect(lynxOption()?.disabled).toBe(false);
  });

  it('switches a stored Lynx level that holds some to Epoxy on open, keeping them', () => {
    editor.loadCompiledLevel(room('lynx', HIDDEN));
    const exported = editor.exportCompiledLevel();
    expect(exported.ruleset).toBeUndefined();
    expect(exported.underlays).toEqual(HIDDEN);
  });

  it('survives a resize that keeps its cell and announces one that drops it', () => {
    editor.loadCompiledLevel(room(undefined, HIDDEN));
    byId<HTMLInputElement>('editor-size-width').value = '10';
    byId<HTMLButtonElement>('editor-size-apply-btn').click();
    expect(editor.exportCompiledLevel().underlays).toEqual(HIDDEN);

    const far: CellUnderlay[] = [{ x: 6, y: 2, terrain: 'ice' }];
    const level = room(undefined, far, false);
    level.terrain[2][6] = 'door_red';
    editor.loadCompiledLevel(level);
    byId<HTMLInputElement>('editor-size-width').value = '6';
    byId<HTMLButtonElement>('editor-size-apply-btn').click();
    expect('underlays' in editor.exportCompiledLevel()).toBe(false);
    expect(status()).toContain(t('editor.layout.size.dropped_underlays', { count: 1 }));
  });

  it('offers nine labelled anchor positions, top-left checked by default', () => {
    const radios = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="editor-size-anchor"]'));
    expect(radios).toHaveLength(9);
    expect(radios.filter((radio) => radio.checked).map((radio) => radio.value)).toEqual(['0,0']);
    i18n.translateDOM();
    radios.forEach((radio) => expect(radio.getAttribute('aria-label')).toBe(t(radio.getAttribute('data-i18n-aria-label') ?? '')));
    const labels = radios.map((radio) => t(radio.getAttribute('data-i18n-aria-label') ?? ''));
    expect(labels.some((label) => label.startsWith('editor.layout.size.anchor'))).toBe(false);
    expect(new Set(labels).size).toBe(9);
    expect(byId('editor-size-anchor-1-1').getAttribute('data-i18n-aria-label')).toBe('editor.layout.size.anchor.centre.label');
    expect(t('editor.layout.size.anchor.centre.label')).toBe('Anchor: centre');
  });

  it('resizes around the picked anchor as one undo step', () => {
    editor.loadCompiledLevel(room(undefined, HIDDEN));
    byId<HTMLInputElement>('editor-size-anchor-1-1').click();
    byId<HTMLInputElement>('editor-size-width').value = String(WIDTH + 2);
    byId<HTMLButtonElement>('editor-size-apply-btn').click();
    const grown = editor.exportCompiledLevel();
    expect(grown.terrain[DOOR_Y][DOOR_X + 1]).toBe('door_red');
    expect(grown.underlays).toEqual([{ x: DOOR_X + 1, y: DOOR_Y, terrain: 'ice' }]);
    editor.undo();
    const restored = editor.exportCompiledLevel();
    expect(restored.terrain[DOOR_Y][DOOR_X]).toBe('door_red');
    expect(restored.underlays).toEqual(HIDDEN);
    expect(restored.terrain[0]).toHaveLength(WIDTH);
  });

  it('survives a copy and a paste, and a paste under Lynx drops and counts it', () => {
    editor.loadCompiledLevel(room(undefined, HIDDEN));
    canvas.focus();
    document.querySelector<HTMLButtonElement>('.editor-tool-btn[data-tool="select"]')?.click();
    // Cursor to the door cell, then select that single cell and copy it.
    press('ArrowRight');
    press('ArrowRight');
    press('ArrowDown');
    press('Enter');
    expect(editor.handleSelectionAction({ kind: 'copy' })).toBe(true);

    editor.loadCompiledLevel(room(undefined, undefined, false));
    canvas.focus();
    expect(editor.handleSelectionAction({ kind: 'paste' })).toBe(true);
    press('ArrowRight');
    press('ArrowDown');
    press('Enter');
    const pasted = editor.exportCompiledLevel();
    const doorY = pasted.terrain.findIndex((row) => row.includes('door_red'));
    expect(doorY).toBeGreaterThan(-1);
    expect(pasted.underlays).toEqual([{ x: pasted.terrain[doorY].indexOf('door_red'), y: doorY, terrain: 'ice' }]);

    editor.loadCompiledLevel(room('lynx', undefined, false));
    canvas.focus();
    expect(editor.handleSelectionAction({ kind: 'paste' })).toBe(true);
    press('ArrowRight');
    press('ArrowDown');
    press('Enter');
    const lynx = editor.exportCompiledLevel();
    expect(lynx.ruleset).toBe('lynx');
    expect(lynx.terrain.some((row) => row.includes('door_red'))).toBe(true);
    expect('underlays' in lynx).toBe(false);
    expect(status()).toContain(t('editor.selection.status.paste_skipped', { count: 1 }));
  });

  it('is announced with its own wording when erasing its cell removes it', () => {
    editor.loadCompiledLevel(room(undefined, HIDDEN));
    canvas.focus();
    document.querySelector<HTMLButtonElement>('.editor-tool-btn[data-tool="eraser"]')?.click();
    clickCell(DOOR_X, DOOR_Y);
    expect('underlays' in editor.exportCompiledLevel()).toBe(false);
    expect(status()).toContain(t('editor.layout.status.underlays_erased.label'));
    expect(status()).not.toContain(t('editor.layout.status.underlays_removed', { count: 1 }));
  });

  it('is marked in the paste preview, but not under Lynx, and the markers end switched off', () => {
    editor.loadCompiledLevel(room(undefined, HIDDEN));
    canvas.focus();
    document.querySelector<HTMLButtonElement>('.editor-tool-btn[data-tool="select"]')?.click();
    press('ArrowRight');
    press('ArrowRight');
    press('ArrowDown');
    press('Enter');
    expect(editor.handleSelectionAction({ kind: 'copy' })).toBe(true);

    editor.loadCompiledLevel(room(undefined, undefined, false));
    canvas.focus();
    expect(editor.handleSelectionAction({ kind: 'paste' })).toBe(true);
    drawCellOverlay.mockClear();
    setHiddenLayerMarkers.mockClear();
    editor.render();
    expect(markerCalls()).toHaveLength(1);
    expect(setHiddenLayerMarkers).toHaveBeenCalledWith(true);
    expect(setHiddenLayerMarkers).toHaveBeenLastCalledWith(false);

    editor.loadCompiledLevel(room('lynx', undefined, false));
    canvas.focus();
    expect(editor.handleSelectionAction({ kind: 'paste' })).toBe(true);
    drawCellOverlay.mockClear();
    setHiddenLayerMarkers.mockClear();
    editor.render();
    expect(markerCalls()).toHaveLength(0);
    expect(setHiddenLayerMarkers).not.toHaveBeenCalledWith(true);
  });

  it('is marked on its cell, and only on that cell', () => {
    editor.loadCompiledLevel(room(undefined, HIDDEN));
    expect(setHiddenLayerMarkers).toHaveBeenCalledWith(true);
    expect(setHiddenLayerMarkers).toHaveBeenLastCalledWith(false);
    expect(markerCalls().length).toBeGreaterThan(0);
    expect(markerCalls().every((call) => call[3] === DOOR_X * (call[5] as number) && call[4] === DOOR_Y * (call[5] as number))).toBe(true);
    drawCellOverlay.mockClear();
    setHiddenLayerMarkers.mockClear();
    editor.loadCompiledLevel(room(undefined, undefined));
    expect(markerCalls()).toHaveLength(0);
    expect(setHiddenLayerMarkers).not.toHaveBeenCalled();
  });

  it('stops being marked when its cell is erased, and comes back with undo', () => {
    editor.loadCompiledLevel(room(undefined, HIDDEN));
    canvas.focus();
    document.querySelector<HTMLButtonElement>('.editor-tool-btn[data-tool="eraser"]')?.click();
    press('ArrowRight');
    press('ArrowRight');
    press('ArrowDown');
    press('Enter');
    expect('underlays' in editor.exportCompiledLevel()).toBe(false);
    drawCellOverlay.mockClear();
    editor.render();
    expect(markerCalls()).toHaveLength(0);
    editor.undo();
    drawCellOverlay.mockClear();
    editor.render();
    expect(editor.exportCompiledLevel().underlays).toEqual(HIDDEN);
    expect(markerDrawnAt(DOOR_X, DOOR_Y)).toBe(true);
  });

  it('is announced when painting floor over its door removes it, and undo brings it back', () => {
    editor.loadCompiledLevel(room(undefined, HIDDEN));
    editor['brush'] = { kind: 'terrain', id: 'floor' };
    clickCell(DOOR_X, DOOR_Y);
    expect('underlays' in editor.exportCompiledLevel()).toBe(false);
    expect(status()).toContain(t('editor.layout.status.underlays_removed', { count: 1 }));
    editor.undo();
    expect(editor.exportCompiledLevel().underlays).toEqual(HIDDEN);
  });

  it('is kept when another door is painted over its door', () => {
    editor.loadCompiledLevel(room(undefined, HIDDEN));
    editor['brush'] = { kind: 'terrain', id: 'door_blue' };
    clickCell(DOOR_X, DOOR_Y);
    const exported = editor.exportCompiledLevel();
    expect(exported.terrain[DOOR_Y][DOOR_X]).toBe('door_blue');
    expect(exported.underlays).toEqual(HIDDEN);
    expect(status()).not.toContain(t('editor.layout.status.underlays_removed', { count: 1 }));
  });

  it('is refused by the .CCL export', () => {
    editor.loadCompiledLevel(room(undefined, HIDDEN));
    expect(datRefusalReason(editor.exportCompiledLevel())).toBe('cell_underlays');
  });

  it('stays in the level handed to the game by "Test from here"', async () => {
    editor.loadCompiledLevel(room(undefined, HIDDEN));
    await editor['testPlay']({ x: 2, y: 1 });
    expect(onTestPlay).toHaveBeenCalledTimes(1);
    const played = onTestPlay.mock.calls[0][0] as CompiledLevel;
    expect(played.underlays).toEqual(HIDDEN);
    expect(played.playerStart).toMatchObject({ x: 2, y: 1 });
  });

  it('is not held by a CC3D level', () => {
    editor.loadCompiledLevel({ ...smallCc3dLevel(), underlays: HIDDEN });
    expect('underlays' in editor.exportCompiledLevel()).toBe(false);
    expect(markerCalls()).toHaveLength(0);
  });

  it('is spoken with the cell once the keyboard cursor stops on it', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    editor.loadCompiledLevel(room(undefined, HIDDEN));
    canvas.focus();
    press('ArrowRight');
    press('ArrowRight');
    press('ArrowDown');
    vi.advanceTimersByTime(EDITOR_CELL_ANNOUNCE_DELAY_MS);
    const spoken = byId('editor-cell-live').textContent ?? '';
    expect(spoken).toContain(`Tile (${DOOR_X}, ${DOOR_Y})`);
    expect(spoken).toContain(t('editor.cell_speech.underlay.label', { name: t('tiles.ice.name') }));
  });
});
