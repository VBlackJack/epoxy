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

/** Authoring the Chip's Challenge 2 track cells: palette, painting, the Cell section, the rotate key, undo and save. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../ui/confirmDialog', () => ({ confirmDialog: vi.fn(async () => false) }));
vi.mock('../ui/saveIntoDialog', () => ({ askSaveInto: vi.fn() }));

import { ConfigRegistry } from '../config/ConfigRegistry';
import { normalizeRailTracks } from '../config/ConfigValidation';
import type { CompiledLevel } from '../core/types';
import { i18n, t } from '../i18n/I18nManager';
import { LevelPackStorage } from '../storage/LevelPackStorage';
import { FakeIndexedDb } from '../test/FakeIndexedDb';
import { mountModals } from '../test/domFixture';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { LevelEditor } from './LevelEditor';

const WIDTH = 8;
const HEIGHT = 6;
const CELL_PX = 10;
const TRACK_X = 3;
const TRACK_Y = 2;
const NORTH_SOUTH_MASK = 1 << 5;
const EAST_WEST_MASK = 1 << 4;
const NORTH_EAST_SEGMENT = 0;
const EAST_WEST_SEGMENT = 4;
const NORTH_SOUTH_SEGMENT = 5;
const MECHANISMS_CATEGORY = 'mechanisms';

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

function room(): CompiledLevel {
  const terrain: string[][] = Array.from({ length: HEIGHT }, (_, y) =>
    Array.from({ length: WIDTH }, (_, x) => (x === 0 || y === 0 || x === WIDTH - 1 || y === HEIGHT - 1 ? 'wall' : 'floor'))
  );
  return {
    id: 'lvl_rails_dom',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    customTitle: 'Rails room',
    playerStart: { x: 1, y: 1, dir: 'S' },
    terrain,
    items: terrain.map((row) => row.map(() => null as string | null)),
    entities: [],
    trapLinks: [],
    cloneLinks: []
  };
}

function pointerAt(type: string, x: number, y: number): void {
  canvas.dispatchEvent(
    new MouseEvent(type, { bubbles: true, cancelable: true, clientX: (x + 0.5) * CELL_PX, clientY: (y + 0.5) * CELL_PX })
  );
}

/** One click on a cell of the map with the tool in hand. */
function clickCell(x: number, y: number): void {
  pointerAt('pointerdown', x, y);
  window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
}

function selectBrush(id: string): void {
  (editor as unknown as { selectBrush(b: unknown): void }).selectBrush({ kind: 'terrain', id });
}

const section = (): HTMLElement => byId('editor-cell-section');
const segmentButton = (segment: number): HTMLButtonElement =>
  section().querySelector<HTMLButtonElement>(`.editor-rail-segment[data-segment="${segment}"]`)!;
const pressedSegments = (): number[] =>
  Array.from(section().querySelectorAll<HTMLButtonElement>('.editor-rail-segment'))
    .filter((button) => button.getAttribute('aria-pressed') === 'true')
    .map((button) => Number(button.dataset.segment));
const clearButton = (): HTMLButtonElement | null => section().querySelector<HTMLButtonElement>('button[data-action="clear"]');
const activeRadios = (): HTMLInputElement[] => Array.from(section().querySelectorAll<HTMLInputElement>('.editor-rail-active input[type="radio"]'));
const tracks = (): CompiledLevel['railTracks'] => editor.exportCompiledLevel().railTracks;

/** Paints a track cell at the test position and leaves the cursor on it. */
function placeTrack(): void {
  editor.loadCompiledLevel(room());
  canvas.focus();
  selectBrush('rail_junction');
  clickCell(TRACK_X, TRACK_Y);
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
  canvas.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: WIDTH * CELL_PX, bottom: HEIGHT * CELL_PX, width: WIDTH * CELL_PX, height: HEIGHT * CELL_PX, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  const renderer = {
    getAppearanceKey: vi.fn(() => 'look'),
    renderIconToDataUrl: vi.fn(() => 'data:,'),
    drawTile: vi.fn(),
    drawTrackCell: vi.fn(),
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
  i18n.setLocale('en');
});

describe('authoring track cells', () => {
  it('offers the track cell in the Mechanisms palette', () => {
    editor.loadCompiledLevel(room());
    const index = ConfigRegistry.getTiles().categories.findIndex((category) => category.id === MECHANISMS_CATEGORY);
    document.querySelectorAll<HTMLButtonElement>('#editor-category-tabs button')[index].click();
    const labels = Array.from(document.querySelectorAll('#editor-palette-grid .palette-item-label')).map((el) => el.textContent);
    expect(labels).toContain(t(ConfigRegistry.getTile('rail_junction').i18nKey));
  });

  it('writes the default north-south track when a track cell is painted, and shows the Cell section', () => {
    editor.loadCompiledLevel(room());
    expect(section().classList.contains('hidden')).toBe(true);
    placeTrack();
    expect(tracks()).toEqual([{ x: TRACK_X, y: TRACK_Y, mask: NORTH_SOUTH_MASK }]);
    expect(section().classList.contains('hidden')).toBe(false);
    expect(section().querySelectorAll('.editor-rail-segment')).toHaveLength(6);
    expect(pressedSegments()).toEqual([NORTH_SOUTH_SEGMENT]);
    expect(activeRadios()).toHaveLength(0);
  });

  it('toggles a segment through the history: undo and redo bring the tracks back', () => {
    placeTrack();
    segmentButton(EAST_WEST_SEGMENT).click();
    expect(tracks()).toEqual([{ x: TRACK_X, y: TRACK_Y, mask: NORTH_SOUTH_MASK | EAST_WEST_MASK }]);
    expect(pressedSegments()).toEqual([EAST_WEST_SEGMENT, NORTH_SOUTH_SEGMENT]);
    editor.undo();
    expect(tracks()).toEqual([{ x: TRACK_X, y: TRACK_Y, mask: NORTH_SOUTH_MASK }]);
    expect(pressedSegments()).toEqual([NORTH_SOUTH_SEGMENT]);
    editor.redo();
    expect(tracks()?.[0].mask).toBe(NORTH_SOUTH_MASK | EAST_WEST_MASK);
  });

  it('offers the open segment only with two or more segments, and writes the choice', () => {
    placeTrack();
    expect(activeRadios()).toHaveLength(0);
    segmentButton(EAST_WEST_SEGMENT).click();
    // No switch, then the two segments.
    expect(activeRadios()).toHaveLength(3);
    expect(activeRadios()[0].checked).toBe(true);
    const eastWest = activeRadios().find((radio) => radio.value === String(EAST_WEST_SEGMENT))!;
    eastWest.checked = true;
    eastWest.dispatchEvent(new Event('change', { bubbles: true }));
    expect(tracks()?.[0].active).toBe(EAST_WEST_SEGMENT);
    expect(activeRadios().find((radio) => radio.checked)?.value).toBe(String(EAST_WEST_SEGMENT));
    // Back to a single segment: the switch goes with it.
    segmentButton(EAST_WEST_SEGMENT).click();
    expect(tracks()).toEqual([{ x: TRACK_X, y: TRACK_Y, mask: NORTH_SOUTH_MASK }]);
    expect(activeRadios()).toHaveLength(0);
  });

  it('turns the tracks with the rotate key, as one history step', () => {
    placeTrack();
    segmentButton(NORTH_EAST_SEGMENT).click();
    editor.handleKeyAction({ kind: 'rotate' });
    // North-east becomes south-east, north-south becomes east-west.
    expect(tracks()?.[0].mask).toBe((1 << 1) | EAST_WEST_MASK);
    editor.undo();
    expect(tracks()?.[0].mask).toBe(NORTH_SOUTH_MASK | 1);
  });

  it('clears the tracks, warns about the empty cell, and keeps the cell a track cell', () => {
    placeTrack();
    clearButton()!.click();
    expect(tracks()).toBeUndefined();
    expect(editor.exportCompiledLevel().terrain[TRACK_Y][TRACK_X]).toBe('rail_junction');
    expect(pressedSegments()).toEqual([]);
    expect(clearButton()!.disabled).toBe(true);
    editor.undo();
    expect(tracks()).toEqual([{ x: TRACK_X, y: TRACK_Y, mask: NORTH_SOUTH_MASK }]);
  });

  it('removes the tracks and hides the section when the cell is painted over', () => {
    placeTrack();
    selectBrush('floor');
    clickCell(TRACK_X, TRACK_Y);
    expect(tracks()).toBeUndefined();
    expect(section().classList.contains('hidden')).toBe(true);
  });

  it('keeps the tracks through an export and a reopening of the level', () => {
    placeTrack();
    segmentButton(EAST_WEST_SEGMENT).click();
    const saved = editor.exportCompiledLevel();
    editor.loadCompiledLevel(room());
    expect(tracks()).toBeUndefined();
    editor.loadCompiledLevel(saved);
    expect(tracks()).toEqual(saved.railTracks);
    // The saved form is already the canonical one: normalising it again changes nothing.
    expect(normalizeRailTracks(saved.railTracks, saved.terrain, 'epoxy')).toEqual(saved.railTracks);
  });
});
