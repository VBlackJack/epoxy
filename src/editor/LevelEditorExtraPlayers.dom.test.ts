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

/** Authoring the other players of a level: palette, placing, turning, character, move, copy, erase, undo and save. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../ui/confirmDialog', () => ({ confirmDialog: vi.fn(async () => false) }));
vi.mock('../ui/saveIntoDialog', () => ({ askSaveInto: vi.fn() }));

import type { CompiledLevel } from '../core/types';
import { i18n, t } from '../i18n/I18nManager';
import { LevelPackStorage } from '../storage/LevelPackStorage';
import { FakeIndexedDb } from '../test/FakeIndexedDb';
import { mountModals } from '../test/domFixture';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { EPOXY_ONLY_REASON_KEY } from './paletteAvailability';
import { LevelEditor } from './LevelEditor';

const WIDTH = 10;
const HEIGHT = 8;
const CELL_PX = 10;
const ENTITIES_TAB_LABEL_KEY = 'editor.palette.tools.extra_player_start';
const PLAYER_X = 4;
const PLAYER_Y = 3;

const fake = new FakeIndexedDb();
let editor: LevelEditor;
let canvas: HTMLCanvasElement;
let renderer: { drawPlayerOfCharacter: ReturnType<typeof vi.fn> };

const noopContext = (): CanvasRenderingContext2D =>
  new Proxy(() => undefined, { get: () => noopContext(), set: () => true, apply: () => undefined }) as unknown as CanvasRenderingContext2D;

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element ${id}`);
  return el as T;
}

function room(ruleset?: 'lynx'): CompiledLevel {
  const terrain: string[][] = Array.from({ length: HEIGHT }, (_, y) =>
    Array.from({ length: WIDTH }, (_, x) => (x === 0 || y === 0 || x === WIDTH - 1 || y === HEIGHT - 1 ? 'wall' : 'floor'))
  );
  return {
    id: 'lvl_players_dom',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    customTitle: 'Players room',
    ...(ruleset ? { ruleset } : {}),
    playerStart: { x: 1, y: 1, dir: 'S' },
    terrain,
    items: terrain.map((row) => row.map(() => null as string | null)),
    entities: [],
    trapLinks: [],
    cloneLinks: []
  };
}

function clickCell(x: number, y: number): void {
  canvas.dispatchEvent(
    new MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: (x + 0.5) * CELL_PX, clientY: (y + 0.5) * CELL_PX })
  );
  window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
}

function press(name: string, init: KeyboardEventInit = {}): void {
  canvas.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init }));
}

const status = (): string => byId('editor-status-bar').textContent ?? '';
const players = (): CompiledLevel['extraPlayers'] => editor.exportCompiledLevel().extraPlayers;
const section = (): HTMLElement => byId('editor-cell-section');
const toolButton = (tool: string): HTMLButtonElement => document.querySelector<HTMLButtonElement>(`.editor-tool-btn[data-tool="${tool}"]`)!;
const characterRadio = (value: string): HTMLInputElement =>
  section().querySelector<HTMLInputElement>(`.editor-extra-player-panel input[type="radio"][value="${value}"]`)!;

/** The palette button of the second player tool, whichever tab holds it. */
function secondPlayerButton(): HTMLButtonElement {
  const name = t(ENTITIES_TAB_LABEL_KEY);
  for (const tab of Array.from(document.querySelectorAll<HTMLButtonElement>('#editor-category-tabs button'))) {
    tab.click();
    const button = Array.from(document.querySelectorAll<HTMLButtonElement>('#editor-palette-grid button')).find(
      (candidate) => candidate.querySelector('.palette-item-label')?.textContent === name
    );
    if (button) return button;
  }
  throw new Error('No second player entry in the palette');
}

/** Opens the room, takes the second player tool and places a start at the test cell. */
function placeSecondPlayer(): void {
  editor.loadCompiledLevel(room());
  canvas.focus();
  secondPlayerButton().click();
  clickCell(PLAYER_X, PLAYER_Y);
}

function selectRect(fromX: number, fromY: number, width: number, height: number): void {
  toolButton('select').click();
  clickCell(fromX, fromY);
  for (let i = 1; i < width; i++) press('ArrowRight', { shiftKey: true });
  for (let i = 1; i < height; i++) press('ArrowDown', { shiftKey: true });
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
  renderer = { drawPlayerOfCharacter: vi.fn() };
  const drawing = {
    getAppearanceKey: vi.fn(() => 'look'),
    renderIconToDataUrl: vi.fn(() => 'data:,'),
    drawTile: vi.fn(),
    drawItem: vi.fn(),
    drawEntity: vi.fn(),
    drawPlayer: vi.fn(),
    drawCellOverlay: vi.fn(),
    setHiddenLayerMarkers: vi.fn(),
    ...renderer
  };
  const hooks = { onTestPlay: vi.fn(), onLevelSaved: vi.fn(), onNotify: vi.fn(), openManager: vi.fn(), importAsPack: vi.fn(), getConfigBundle: vi.fn() };
  editor = new LevelEditor(canvas, drawing as never, hooks as never);
  editor.buildUI();
});

afterEach(async () => {
  editor.dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await LevelPackStorage.closeConnection();
  i18n.setLocale('en');
});

describe('authoring the other players', () => {
  it('places a start with the direction control, a default character, and draws it with its character and facing', () => {
    editor.loadCompiledLevel(room());
    canvas.focus();
    secondPlayerButton().click();
    editor.handleKeyAction({ kind: 'rotate' });
    clickCell(PLAYER_X, PLAYER_Y);
    expect(players()).toEqual([{ x: PLAYER_X, y: PLAYER_Y, dir: 'W', character: 'melinda' }]);
    const drawn = renderer.drawPlayerOfCharacter.mock.calls.map((args) => ({ dir: args[4], character: args[5] }));
    expect(drawn).toContainEqual({ dir: 'W', character: 'melinda' });
  });

  it('cannot start on the main start, and says so', () => {
    editor.loadCompiledLevel(room());
    secondPlayerButton().click();
    clickCell(1, 1);
    expect(players()).toBeUndefined();
    expect(status()).toBe(t('editor.extra_players.status.on_start.label'));
  });

  it('cannot place the main start on another start', () => {
    placeSecondPlayer();
    const button = Array.from(document.querySelectorAll<HTMLButtonElement>('#editor-palette-grid button')).find(
      (candidate) => candidate.querySelector('.palette-item-label')?.textContent === t('editor.palette.tools.player_start')
    )!;
    button.click();
    clickCell(PLAYER_X, PLAYER_Y);
    expect(status()).toBe(t('editor.extra_players.status.start_on_extra.label'));
    expect(editor.exportCompiledLevel().playerStart).toEqual({ x: 1, y: 1, dir: 'S' });
  });

  it('shows the Cell section for a start, picks the character, and undo and redo bring it back', () => {
    placeSecondPlayer();
    expect(section().classList.contains('hidden')).toBe(false);
    expect(characterRadio('melinda').checked).toBe(true);
    characterRadio('chip').checked = true;
    characterRadio('chip').dispatchEvent(new Event('change', { bubbles: true }));
    expect(players()?.[0].character).toBe('chip');
    editor.undo();
    expect(players()?.[0].character).toBe('melinda');
    editor.redo();
    expect(players()?.[0].character).toBe('chip');
  });

  it('turns the start in place with Shift+R as one history step', () => {
    placeSecondPlayer();
    editor.handleKeyAction({ kind: 'rotate_in_place' });
    expect(players()?.[0].dir).toBe('W');
    expect(status()).toContain('turned to face');
    editor.undo();
    expect(players()?.[0].dir).toBe('S');
  });

  it('removes the start with the eraser, with the secondary button and with the panel, each undoable', () => {
    placeSecondPlayer();
    toolButton('eraser').click();
    clickCell(PLAYER_X, PLAYER_Y);
    expect(players()).toBeUndefined();
    editor.undo();
    expect(players()).toHaveLength(1);
    section().querySelector<HTMLButtonElement>('button[data-action="remove-extra-player"]')!.click();
    expect(players()).toBeUndefined();
    editor.undo();
    expect(players()).toHaveLength(1);
  });

  it('keeps a start under terrain painted over it', () => {
    placeSecondPlayer();
    toolButton('brush').click();
    (editor as unknown as { selectBrush(b: unknown): void }).selectBrush({ kind: 'terrain', id: 'water' });
    clickCell(PLAYER_X, PLAYER_Y);
    expect(players()).toHaveLength(1);
    expect(editor.exportCompiledLevel().terrain[PLAYER_Y][PLAYER_X]).toBe('water');
  });

  it('moves with a cut and a paste, and copies leave it behind', () => {
    placeSecondPlayer();
    selectRect(PLAYER_X, PLAYER_Y, 2, 2);
    editor.handleSelectionAction({ kind: 'copy' });
    expect(players()).toHaveLength(1);
    editor.handleSelectionAction({ kind: 'cut' });
    expect(players()).toBeUndefined();
    editor.handleSelectionAction({ kind: 'paste' });
    clickCell(6, 5);
    press('Enter');
    expect(players()).toEqual([{ x: 6, y: 5, dir: 'S', character: 'melinda' }]);
    editor.undo();
    expect(players()).toBeUndefined();
  });

  it('moves with the selection', () => {
    placeSecondPlayer();
    selectRect(PLAYER_X, PLAYER_Y, 2, 2);
    editor.handleSelectionAction({ kind: 'move', dx: 1, dy: 0 });
    expect(players()).toEqual([{ x: PLAYER_X + 1, y: PLAYER_Y, dir: 'S', character: 'melinda' }]);
  });

  it('counts the players in the level settings', () => {
    editor.loadCompiledLevel(room());
    expect(byId('editor-meta-players').textContent).toBe(t('editor.extra_players.count.label', { count: 1 }));
    secondPlayerButton().click();
    clickCell(PLAYER_X, PLAYER_Y);
    clickCell(PLAYER_X + 1, PLAYER_Y);
    expect(byId('editor-meta-players').textContent).toBe(t('editor.extra_players.count.label', { count: 3 }));
  });

  it('keeps the players through an export and a reopening of the level', () => {
    placeSecondPlayer();
    const saved = editor.exportCompiledLevel();
    editor.loadCompiledLevel(room());
    expect(players()).toBeUndefined();
    editor.loadCompiledLevel(saved);
    expect(players()).toEqual(saved.extraPlayers);
    expect(saved.extraPlayers).toHaveLength(1);
  });

  it('is unavailable under the Lynx rules, with the reason', () => {
    editor.loadCompiledLevel(room('lynx'));
    const button = secondPlayerButton();
    expect(button.getAttribute('aria-disabled')).toBe('true');
    button.click();
    expect(status()).toBe(t(EPOXY_ONLY_REASON_KEY));
    canvas.focus();
    clickCell(PLAYER_X, PLAYER_Y);
    expect(players()).toBeUndefined();
  });
});
