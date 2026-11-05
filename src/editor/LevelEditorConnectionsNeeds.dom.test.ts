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

/**
 * The Connections section says what a device still needs and lists the problems found at its cell, the Link button
 * names its key, the ready status names K, T and L, and a lone linkable device just placed is followed by a nudge.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../ui/confirmDialog', () => ({ confirmDialog: vi.fn(async () => false) }));
vi.mock('../ui/saveIntoDialog', () => ({ askSaveInto: vi.fn() }));

import { ConfigRegistry } from '../config/ConfigRegistry';
import type { CompiledLevel, ValidationIssue } from '../core/types';
import { i18n, t } from '../i18n/I18nManager';
import { LevelPackStorage } from '../storage/LevelPackStorage';
import { FakeIndexedDb } from '../test/FakeIndexedDb';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { mountModals } from '../test/domFixture';
import { LevelEditor } from './LevelEditor';

const WIDTH = 10;
const HEIGHT = 7;
const CELL_PX = 10;
const MECHANISMS_CATEGORY = 'mechanisms';
const PLATE = { x: 3, y: 2 };
const DOOR = { x: 6, y: 2 };
const FREE = { x: 4, y: 4 };
const FREE_NEXT = { x: 5, y: 4 };
const FREE_LAST = { x: 6, y: 4 };
const FILL_AT = { x: 2, y: 5 };

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

const status = (): string => byId('editor-status-bar').textContent ?? '';
const note = (): string => byId('editor-connections-note').textContent ?? '';
const linkButton = (): HTMLButtonElement => byId<HTMLButtonElement>('editor-connections-link-btn');
const issueRowsHere = (): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>('#editor-connections-issues .editor-issue-row'));
const issuesBlock = (): HTMLElement => byId('editor-connections-issues-block');

function room(placed: Array<{ x: number; y: number; tile: string }>, ruleset?: CompiledLevel['ruleset']): CompiledLevel {
  const terrain: string[][] = Array.from({ length: HEIGHT }, (_, y) =>
    Array.from({ length: WIDTH }, (_, x) => (x === 0 || y === 0 || x === WIDTH - 1 || y === HEIGHT - 1 ? 'wall' : 'floor'))
  );
  terrain[HEIGHT - 2][WIDTH - 2] = 'exit';
  for (const cell of placed) terrain[cell.y][cell.x] = cell.tile;
  return {
    id: 'lvl_connections_needs_dom',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    customTitle: 'Needs room',
    ruleset,
    playerStart: { x: 1, y: 1, dir: 'S' },
    terrain,
    items: terrain.map((row) => row.map(() => null as string | null)),
    entities: [],
    trapLinks: [],
    cloneLinks: []
  };
}

function pointer(type: string, cell: { x: number; y: number }): void {
  canvas.dispatchEvent(
    new MouseEvent(type, { bubbles: true, cancelable: true, clientX: (cell.x + 0.5) * CELL_PX, clientY: (cell.y + 0.5) * CELL_PX })
  );
}

function click(cell: { x: number; y: number }): void {
  pointer('pointerdown', cell);
  window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
}

function drag(cells: Array<{ x: number; y: number }>): void {
  pointer('pointerdown', cells[0]);
  for (const cell of cells.slice(1)) pointer('pointermove', cell);
  window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
}

function openMechanisms(): void {
  const index = ConfigRegistry.getTiles().categories.findIndex((cat) => cat.id === MECHANISMS_CATEGORY);
  document.querySelectorAll<HTMLButtonElement>('#editor-category-tabs button')[index].click();
}

function pick(tileId: string): void {
  openMechanisms();
  const label = t(`tiles.${tileId}.name`);
  const found = Array.from(document.querySelectorAll<HTMLButtonElement>('#editor-palette-grid button')).find(
    (btn) => btn.querySelector('.palette-item-label')?.textContent === label
  );
  if (!found) throw new Error(`Missing palette entry ${label}`);
  found.click();
}

function cursorTo(cell: { x: number; y: number }): void {
  editor['moveCursorTo'](cell, false);
}

function pressPaint(cell: { x: number; y: number }): void {
  editor['cursorCell'] = { ...cell };
  canvas.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
}

const nudge = (role: string, fallback: string): string => `${role} placed. Press K (or Link...) to link it. ${fallback}`;

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
    renderIconToDataUrl: vi.fn((kind: string, id: string) => `data:,${kind}-${id}`),
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
  i18n.setLocale('en');
});

describe('the needs note', () => {
  it('says a pressure plate with no hold door of its colour opens nothing, in English and in French', () => {
    editor.loadCompiledLevel(room([{ ...PLATE, tile: 'pressure_plate_red' }]));
    cursorTo(PLATE);
    expect(note()).toContain('Needs a hold door of the same colour (red)');
    i18n.setLocale('fr');
    editor.refreshTranslations();
    expect(note()).toContain('Il faut une porte à maintien de la même couleur (rouge)');
  });

  it('goes away once a hold door of the colour is on the level', () => {
    editor.loadCompiledLevel(room([{ ...PLATE, tile: 'pressure_plate_red' }, { ...DOOR, tile: 'hold_door_red_closed' }]));
    cursorTo(PLATE);
    expect(note()).toBe('');
    cursorTo(DOOR);
    expect(note()).toBe('');
  });

  it('asks a hold door for a plate of another colour than the one on the level', () => {
    editor.loadCompiledLevel(room([{ ...PLATE, tile: 'pressure_plate_blue' }, { ...DOOR, tile: 'hold_door_red_closed' }]));
    cursorTo(DOOR);
    expect(note()).toContain('Needs a pressure plate of the same colour (red)');
  });
});

describe('the problems found at a cell', () => {
  const warningAt = (cell: { x: number; y: number }): ValidationIssue => ({
    severity: 'warning',
    i18nKey: 'validator.issues.trap_link_button.label',
    params: { x: cell.x, y: cell.y }
  });
  const errorAt = (cell: { x: number; y: number }): ValidationIssue => ({
    severity: 'error',
    i18nKey: 'validator.issues.clone_link_button.label',
    params: { x: cell.x, y: cell.y }
  });

  it('lists them under the lists for the shown cell, errors first, and only for that cell', () => {
    editor.loadCompiledLevel(room([{ ...PLATE, tile: 'pressure_plate_red' }]));
    cursorTo(PLATE);
    expect(issuesBlock().classList.contains('hidden')).toBe(true);
    const issues = [warningAt(PLATE), errorAt(PLATE), errorAt(DOOR)];
    editor['setCheck']({ state: 'errors', count: 2 }, issues);
    const rows = issueRowsHere();
    expect(rows.map((row) => row.dataset.severity)).toEqual(['error', 'warning']);
    expect(rows[0].textContent).toContain(editor['formatIssue'](errorAt(PLATE)));
    expect(rows[1].textContent).toContain(editor['formatIssue'](warningAt(PLATE)));
    expect(rows[0].querySelector('.editor-issue-glyph')?.getAttribute('aria-hidden')).toBe('true');
    expect(rows[0].tagName).toBe('DIV');
    expect(issuesBlock().classList.contains('hidden')).toBe(false);
    cursorTo(DOOR);
    expect(issueRowsHere()).toHaveLength(1);
    cursorTo(FREE);
    expect(issueRowsHere()).toHaveLength(0);
    expect(issuesBlock().classList.contains('hidden')).toBe(true);
  });

  it('clears when a new check finds nothing and when another level is loaded', () => {
    editor.loadCompiledLevel(room([{ ...PLATE, tile: 'pressure_plate_red' }]));
    cursorTo(PLATE);
    editor['setCheck']({ state: 'warnings', count: 1 }, [warningAt(PLATE)]);
    expect(issueRowsHere()).toHaveLength(1);
    editor['setCheck']({ state: 'valid', count: 0 }, []);
    expect(issueRowsHere()).toHaveLength(0);
    editor['setCheck']({ state: 'warnings', count: 1 }, [warningAt(PLATE)]);
    editor.loadCompiledLevel(room([{ ...PLATE, tile: 'pressure_plate_red' }]));
    cursorTo(PLATE);
    expect(issueRowsHere()).toHaveLength(0);
  });

  it('dims the rows while a check runs or was abandoned, as the main list does, and undims them on the next result', () => {
    editor.loadCompiledLevel(room([{ ...PLATE, tile: 'pressure_plate_red' }]));
    cursorTo(PLATE);
    const list = byId('editor-connections-issues');
    editor['setCheck']({ state: 'warnings', count: 1 }, [warningAt(PLATE)]);
    expect(list.dataset.stale).toBe('false');
    expect(list.hasAttribute('aria-description')).toBe(false);
    editor['showChecking']();
    expect(list.dataset.stale).toBe('true');
    expect(list.getAttribute('aria-description')).toBe(t('editor.issues.stale.label'));
    expect(issueRowsHere()).toHaveLength(1);
    editor['setCheck']({ state: 'warnings', count: 1 }, [warningAt(PLATE)]);
    editor['checkOverlay'] = null;
    editor['refreshConnections']();
    expect(list.dataset.stale).toBe('false');
    editor['showAbandoned']('skipped');
    expect(list.dataset.stale).toBe('true');
    expect(list.getAttribute('aria-description')).toBe(t('editor.issues.stale.label'));
  });

  it('does not rebuild the section for a check that finds the same problems at the shown cell', () => {
    editor.loadCompiledLevel(room([{ ...PLATE, tile: 'pressure_plate_red' }]));
    cursorTo(PLATE);
    editor['setCheck']({ state: 'warnings', count: 1 }, [warningAt(PLATE)]);
    const before = issueRowsHere()[0];
    const revision = editor['issuesRevision'];
    editor['setCheck']({ state: 'warnings', count: 2 }, [warningAt(PLATE), errorAt(DOOR)]);
    expect(editor['issuesRevision']).toBe(revision);
    expect(issueRowsHere()[0]).toBe(before);
    editor['setCheck']({ state: 'errors', count: 1 }, [errorAt(PLATE)]);
    expect(editor['issuesRevision']).toBe(revision + 1);
    expect(issueRowsHere()[0]).not.toBe(before);
    expect(issueRowsHere()[0].dataset.severity).toBe('error');
  });
});

describe('the Link button and the ready status', () => {
  it('titles the Link button with its key when it can start a link', () => {
    editor.loadCompiledLevel(room([{ ...PLATE, tile: 'button_brown' }]));
    cursorTo(PLATE);
    expect(linkButton().classList.contains('hidden')).toBe(false);
    expect(linkButton().title).toBe('Link to a partner (K)');
    i18n.setLocale('fr');
    editor.refreshTranslations();
    expect(linkButton().title).toBe('Relier à un partenaire (K)');
  });

  it('keeps the reason as the title when the device is hidden and cannot be linked', () => {
    const level = room([{ ...PLATE, tile: 'door_red' }]);
    level.underlays = [{ x: PLATE.x, y: PLATE.y, terrain: 'trap' }];
    editor.loadCompiledLevel(level);
    cursorTo(PLATE);
    expect(linkButton().title).toBe(t('editor.connections.link.blocked'));
  });

  it('adds K, T and L to the ready status', () => {
    editor.loadCompiledLevel(room([]));
    expect(status()).toContain('K link');
    expect(status()).toContain('T test');
    expect(status()).toContain('L beams');
    expect(status().startsWith('Left: paint')).toBe(true);
  });

  it('keeps the ready status short in both languages', () => {
    editor.loadCompiledLevel(room([]));
    expect(status().length).toBeLessThanOrEqual(90);
    i18n.setLocale('fr');
    editor.loadCompiledLevel(room([]));
    expect(status()).toContain('K relier | T tester | L faisceaux');
    expect(status().length).toBeLessThanOrEqual(90);
  });
});

describe('the nudge after placing a linkable device', () => {
  const brownNudge = nudge('Brown button', 'Unlinked, this brown button opens every unlinked trap.');

  it('follows a pointer click that places one unlinked device', () => {
    editor.loadCompiledLevel(room([]));
    pick('button_brown');
    click(FREE);
    expect(status()).toBe(brownNudge);
  });

  it('follows a keyboard paint', () => {
    editor.loadCompiledLevel(room([]));
    pick('button_brown');
    pressPaint(FREE);
    expect(status()).toBe(brownNudge);
  });

  it('names each device it nudges for', () => {
    editor.loadCompiledLevel(room([]));
    pick('trap');
    click(FREE);
    expect(status()).toBe(nudge('Trap', 'Unlinked, any brown button opens this trap.'));
    pick('clone_machine');
    click(FREE_NEXT);
    expect(status()).toBe(nudge('Clone machine', 'Unlinked, any red button fires this clone machine once a creature stands on it.'));
  });

  it('nudges once for five traps in a row, and again after something else was said', () => {
    editor.loadCompiledLevel(room([]));
    pick('trap');
    const cells = [FREE, FREE_NEXT, FREE_LAST, { x: 7, y: 4 }, { x: 8, y: 4 }];
    const trapNudge = nudge('Trap', 'Unlinked, any brown button opens this trap.');
    const writes: number[] = [];
    for (const cell of cells) {
      click(cell);
      writes.push(editor['statusWrites']);
    }
    expect(status()).toBe(trapNudge);
    expect(new Set(writes).size).toBe(1);
    editor['setStatusText']('Something else');
    click({ x: 1, y: 5 });
    expect(status()).toBe(trapNudge);
    pick('clone_machine');
    click({ x: 2, y: 5 });
    expect(status()).toBe(nudge('Clone machine', 'Unlinked, any red button fires this clone machine once a creature stands on it.'));
  });

  it('uses the Lynx wording under Lynx rules', () => {
    editor.loadCompiledLevel(room([], 'lynx'));
    pick('button_brown');
    click(FREE);
    expect(status()).toBe(nudge('Brown button', 'Unlinked: this button opens nothing.'));
  });

  it('speaks French under the French locale', () => {
    i18n.setLocale('fr');
    editor.loadCompiledLevel(room([]));
    pick('button_brown');
    click(FREE);
    expect(status()).toBe(`Bouton brun en place. Appuyez sur K (ou sur Relier...) pour créer un lien. ${t('editor.link.fallback.trap_button.label')}`);
  });

  it('is quiet for a plain tile', () => {
    editor.loadCompiledLevel(room([]));
    click(FREE);
    expect(status()).not.toContain('Press K');
  });

  it('is quiet after a stroke over several cells', () => {
    editor.loadCompiledLevel(room([]));
    pick('button_brown');
    drag([FREE, FREE_NEXT, FREE_LAST]);
    expect(editor.exportCompiledLevel().terrain[FREE_NEXT.y][FREE_NEXT.x]).toBe('button_brown');
    expect(status()).not.toContain('Press K');
  });

  it('is quiet after a fill', () => {
    editor.loadCompiledLevel(room([]));
    pick('button_brown');
    editor.setTool('fill');
    click(FILL_AT);
    expect(editor.exportCompiledLevel().terrain[FREE.y][FREE.x]).toBe('button_brown');
    expect(status()).not.toContain('Press K');
  });

  it('is quiet when the device is linked already', () => {
    const level = room([{ ...DOOR, tile: 'trap' }]);
    level.trapLinks = [{ buttonX: FREE.x, buttonY: FREE.y, trapX: DOOR.x, trapY: DOOR.y }];
    editor.loadCompiledLevel(level);
    pick('button_brown');
    click(FREE);
    expect(status()).not.toContain('Press K');
  });
});
