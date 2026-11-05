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
 * The coordinates badge names what the pointed cell holds (the words the keyboard cursor speaks), carries them as
 * its tooltip, goes back to the empty marker when the pointer leaves, and is never a live region.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../ui/confirmDialog', () => ({ confirmDialog: vi.fn() }));
vi.mock('../ui/saveIntoDialog', () => ({ askSaveInto: vi.fn() }));

import { ConfigRegistry } from '../config/ConfigRegistry';
import { i18n, t } from '../i18n/I18nManager';
import { LevelPackStorage } from '../storage/LevelPackStorage';
import { FakeIndexedDb } from '../test/FakeIndexedDb';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { mountModals } from '../test/domFixture';
import type { CompiledLevel } from '../core/types';
import { smallCc3dLevel } from './cc3dEditorFixtures';
import { LevelEditor } from './LevelEditor';

const CELL_PX = 10;
const WIDTH = 8;
const HEIGHT = 6;
const DOOR = { x: 3, y: 2 };
const CLONER = { x: 5, y: 2 };
const FLOOR = { x: 2, y: 4 };
const NO_CELL_TEXT = '--';
const LIVE_ID = 'editor-cell-live';
const CC3D_COLUMNS = 5;
const CC3D_ROWS = 4;

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

const badge = (): HTMLElement => byId('editor-coords-badge');

function useGrid(columns: number, rows: number): void {
  canvas.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: columns * CELL_PX, bottom: rows * CELL_PX, width: columns * CELL_PX, height: rows * CELL_PX, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
}

function hover(cell: { x: number; y: number }): void {
  canvas.dispatchEvent(
    new MouseEvent('pointermove', { bubbles: true, clientX: cell.x * CELL_PX + 1, clientY: cell.y * CELL_PX + 1 })
  );
}

function leave(): void {
  canvas.dispatchEvent(new MouseEvent('pointerleave', { bubbles: true }));
}

const tileName = (id: string): string => t(ConfigRegistry.getTile(id).i18nKey);
const entityName = (id: string): string => t(ConfigRegistry.getEntityDef(id)!.i18nKey);

function room(): CompiledLevel {
  const terrain: string[][] = Array.from({ length: HEIGHT }, (_, y) =>
    Array.from({ length: WIDTH }, (_, x) => (x === 0 || y === 0 || x === WIDTH - 1 || y === HEIGHT - 1 ? 'wall' : 'floor'))
  );
  terrain[DOOR.y][DOOR.x] = 'door_red';
  terrain[CLONER.y][CLONER.x] = 'clone_machine';
  return {
    id: 'lvl_hover_dom',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    customTitle: 'Hover room',
    playerStart: { x: 1, y: 1, dir: 'S' },
    terrain,
    items: terrain.map((row) => row.map(() => null as string | null)),
    entities: [],
    trapLinks: [],
    cloneLinks: [{ buttonX: 1, buttonY: 2, clonerX: CLONER.x, clonerY: CLONER.y, templateType: 'walker', templateDir: 'N' }],
    underlays: [{ x: DOOR.x, y: DOOR.y, terrain: 'ice' }]
  };
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
  useGrid(WIDTH, HEIGHT);
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
  editor.loadCompiledLevel(room());
});

afterEach(async () => {
  editor.dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  i18n.setLocale('en');
  await LevelPackStorage.closeConnection();
});

describe('the hover description in the coordinates badge', () => {
  it('names a door and the terrain hidden under it, and carries the same words as its tooltip', () => {
    hover(DOOR);
    const text = badge().textContent ?? '';
    expect(text).toContain(`Tile (${DOOR.x}, ${DOOR.y})`);
    expect(text).toContain(tileName('door_red'));
    expect(text).toContain(tileName('ice'));
    expect(badge().title).toBe(text);
  });

  it('names the creature a clone machine copies', () => {
    hover(CLONER);
    const text = badge().textContent ?? '';
    expect(text).toContain(tileName('clone_machine'));
    expect(text).toContain(entityName('walker'));
  });

  it('shows only the coordinates and the tile for a plain floor cell', () => {
    hover(FLOOR);
    const text = badge().textContent ?? '';
    expect(text).toContain(`Tile (${FLOOR.x}, ${FLOOR.y})`);
    expect(text).toContain(tileName('floor'));
  });

  it('leaves the live region alone', () => {
    hover(DOOR);
    hover(CLONER);
    expect(badge().hasAttribute('aria-live')).toBe(false);
    expect(byId(LIVE_ID).textContent).toBe('');
    expect(byId('editor-status-bar').textContent).not.toContain(tileName('door_red'));
  });

  it('goes back to the empty marker, with no tooltip, when the pointer leaves the map', () => {
    hover(DOOR);
    leave();
    expect(badge().textContent).toBe(NO_CELL_TEXT);
    expect(badge().hasAttribute('title')).toBe(false);
  });

  it('is written in French when the language is French', () => {
    i18n.setLocale('fr');
    hover(DOOR);
    const text = badge().textContent ?? '';
    expect(text).toContain(tileName('door_red'));
    expect(text).toContain(tileName('ice'));
    expect(text).not.toContain('Tile (');
    expect(text.startsWith(`Case (${DOOR.x}, ${DOOR.y}) : `)).toBe(true);
    expect(text).not.toContain(`Case (${DOOR.x}, ${DOOR.y}): `);
  });

  it('puts the colon straight after the coordinates in English', () => {
    hover(DOOR);
    const text = badge().textContent ?? '';
    expect(text.startsWith(`Tile (${DOOR.x}, ${DOOR.y}): `)).toBe(true);
    expect(text).not.toContain(`Tile (${DOOR.x}, ${DOOR.y}) : `);
  });

  it('does not rebuild the text when the same cell is hovered twice', () => {
    hover(DOOR);
    badge().textContent = 'sentinel';
    hover(DOOR);
    expect(badge().textContent).toBe('sentinel');
    hover(CLONER);
    expect(badge().textContent).not.toBe('sentinel');
  });

  it('rebuilds the text for the same cell once the level changes under the pointer', () => {
    hover(FLOOR);
    const before = badge().textContent;
    const wall = Array.from(document.querySelectorAll<HTMLButtonElement>('#editor-palette-grid button')).find(
      (button) => button.querySelector('.palette-item-label')?.textContent === tileName('wall')
    );
    if (!wall) throw new Error('Missing wall palette button');
    wall.click();
    canvas.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: FLOOR.x * CELL_PX + 1, clientY: FLOOR.y * CELL_PX + 1 }));
    window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    expect(badge().textContent).not.toBe(before);
    expect(badge().textContent).toContain(tileName('wall'));
  });

  it('describes the layers of a CC3D cell', () => {
    editor.loadCompiledLevel(smallCc3dLevel());
    useGrid(CC3D_COLUMNS, CC3D_ROWS);
    hover({ x: 1, y: 2 });
    const text = badge().textContent ?? '';
    expect(text).toContain('Tile (1, 2)');
    expect(text.length).toBeGreaterThan('Tile (1, 2)'.length);
    expect(badge().title).toBe(text);
  });
});
