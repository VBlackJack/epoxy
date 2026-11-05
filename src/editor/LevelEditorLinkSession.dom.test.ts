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

import { ConfigRegistry } from '../config/ConfigRegistry';
import type { CompiledLevel, Direction, LauncherLink } from '../core/types';
import { i18n, t } from '../i18n/I18nManager';
import { stripSeverityPrefix } from './issueList';
import { LevelPackStorage } from '../storage/LevelPackStorage';
import { FakeIndexedDb } from '../test/FakeIndexedDb';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { mountModals } from '../test/domFixture';
import { smallCc3dLevel } from './cc3dEditorFixtures';
import { LevelEditor } from './LevelEditor';

const WIDTH = 10;
const HEIGHT = 7;
const CELL_PX = 10;
const MECHANISMS_CATEGORY = 'mechanisms';
const TRIGGER = { x: 2, y: 2 };
const OTHER_TRIGGER = { x: 2, y: 4 };
const LAUNCHER = { x: 6, y: 2 };
const SECOND_LAUNCHER = { x: 6, y: 4 };
const FREE = { x: 4, y: 5 };
const EMPTY_FLOOR = { x: 5, y: 3 };

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
const linkButton = (): HTMLButtonElement => byId<HTMLButtonElement>('editor-connections-link-btn');
const caption = (): string => byId('editor-connections-cell').textContent ?? '';
const role = (id: string): string => t(`editor.connections.role.${id}.label`);

function press(name: string, init: KeyboardEventInit = {}): void {
  canvas.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init }));
}

/** A walled room, with the given terrain placed after the walls and the exit. */
function room(ruleset: 'lynx' | undefined, placed: Array<{ x: number; y: number; tile: string }>, links?: LauncherLink[]): CompiledLevel {
  const terrain: string[][] = Array.from({ length: HEIGHT }, (_, y) =>
    Array.from({ length: WIDTH }, (_, x) => (x === 0 || y === 0 || x === WIDTH - 1 || y === HEIGHT - 1 ? 'wall' : 'floor'))
  );
  terrain[HEIGHT - 2][WIDTH - 2] = 'exit';
  for (const cell of placed) terrain[cell.y][cell.x] = cell.tile;
  return {
    id: 'lvl_link_session_dom',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    customTitle: 'Link session room',
    ruleset,
    playerStart: { x: 1, y: 1, dir: 'S' },
    terrain,
    items: terrain.map((row) => row.map(() => null as string | null)),
    entities: [],
    trapLinks: [],
    cloneLinks: [],
    ...(links ? { launcherLinks: links.map((l) => ({ ...l })) } : {})
  };
}

const link = (from: { x: number; y: number }, to: { x: number; y: number }): LauncherLink => ({
  buttonX: from.x,
  buttonY: from.y,
  launcherX: to.x,
  launcherY: to.y
});

function pointer(type: string, cell: { x: number; y: number }, init: MouseEventInit = {}): void {
  canvas.dispatchEvent(
    new MouseEvent(type, { bubbles: true, cancelable: true, clientX: (cell.x + 0.5) * CELL_PX, clientY: (cell.y + 0.5) * CELL_PX, ...init })
  );
}

function click(cell: { x: number; y: number }, init: MouseEventInit = {}): void {
  pointer('pointerdown', cell, init);
  window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
}

function openMechanisms(): void {
  const index = ConfigRegistry.getTiles().categories.findIndex((cat) => cat.id === MECHANISMS_CATEGORY);
  document.querySelectorAll<HTMLButtonElement>('#editor-category-tabs button')[index].click();
}

function paletteButton(label: string): HTMLButtonElement {
  const found = Array.from(document.querySelectorAll<HTMLButtonElement>('#editor-palette-grid button')).find(
    (btn) => btn.querySelector('.palette-item-label')?.textContent === label
  );
  if (!found) throw new Error(`Missing palette entry ${label}`);
  return found;
}

function setDirection(dir: Direction): void {
  document.querySelector<HTMLButtonElement>(`#editor-dir-group [data-dir="${dir}"]`)?.click();
}

/** K on a cell: the keyboard cursor is put there first, as the key acts on the cursor cell. */
function pressK(cell: { x: number; y: number }): void {
  editor['cursorCell'] = { ...cell };
  editor.handleKeyAction({ kind: 'link' });
}

const terrainAt = (cell: { x: number; y: number }): string => editor.exportCompiledLevel().terrain[cell.y][cell.x];
const linksOf = (): LauncherLink[] | undefined => editor.exportCompiledLevel().launcherLinks;
const session = (): unknown => editor['linkSession'];
const sessionAt = (cell: { x: number; y: number }, system: string, end: string): object => ({ system, end, x: cell.x, y: cell.y });

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
});

describe('the palette after the wire entries', () => {
  it('has no wire entry in any tab, in English or in French', () => {
    for (const locale of ['en', 'fr'] as const) {
      i18n.setLocale(locale);
      editor.loadCompiledLevel(room(undefined, []));
      ConfigRegistry.getTiles().categories.forEach((cat, index) => {
        document.querySelectorAll<HTMLButtonElement>('#editor-category-tabs button')[index].click();
        const labels = Array.from(document.querySelectorAll('#editor-palette-grid .palette-item-label')).map((el) => el.textContent ?? '');
        expect(labels.some((label) => /wire|relier/i.test(label)), `${locale} ${cat.id}`).toBe(false);
      });
    }
    i18n.setLocale('en');
  });

  it('still offers the shot trigger and the launchers as plain tiles, painted without a link', () => {
    editor.loadCompiledLevel(room(undefined, []));
    openMechanisms();
    paletteButton(t('tiles.shot_trigger.name')).click();
    click(TRIGGER);
    expect(terrainAt(TRIGGER)).toBe('shot_trigger');
    expect(linksOf()).toBeUndefined();
    expect(session()).toBeNull();
  });

  it('locks the Lynx choice once a trigger is painted', () => {
    editor.loadCompiledLevel(room(undefined, []));
    openMechanisms();
    paletteButton(t('tiles.shot_trigger.name')).click();
    click(TRIGGER);
    const lynx = Array.from(byId<HTMLSelectElement>('editor-meta-ruleset').options).find((option) => option.value === 'lynx');
    expect(lynx?.disabled).toBe(true);
  });
});

describe('starting a session', () => {
  it('starts on a shot trigger with the K key, says what it fires, and keeps the tool and brush', () => {
    editor.loadCompiledLevel(room(undefined, [{ ...TRIGGER, tile: 'shot_trigger' }, { ...LAUNCHER, tile: 'shot_launcher_w' }], [link(TRIGGER, LAUNCHER)]));
    editor.setTool('eraser');
    pressK(TRIGGER);
    expect(session()).toEqual(sessionAt(TRIGGER, 'shot', 'button'));
    expect(status()).toBe(
      t('editor.link.started.label', { role: role('shot_trigger'), partner: role('shot_launcher'), x: TRIGGER.x, y: TRIGGER.y, count: 1 })
    );
    expect(editor['tool']).toBe('eraser');
    expect(editor['brush']).toEqual({ kind: 'terrain', id: 'wall' });
    expect(editor['cursorCell']).toEqual(TRIGGER);
    expect(editor['history'].canUndo()).toBe(false);
  });

  it('adds the fallback sentence when the device has no link yet', () => {
    editor.loadCompiledLevel(room(undefined, [{ ...TRIGGER, tile: 'shot_trigger' }]));
    pressK(TRIGGER);
    expect(status()).toContain(t('editor.link.fallback.shot_trigger.label'));
  });

  it('starts from the launcher end too, and from a trap and a brown button', () => {
    editor.loadCompiledLevel(room(undefined, [{ ...TRIGGER, tile: 'shot_trigger' }, { ...LAUNCHER, tile: 'shot_launcher_w' }, { x: 3, y: 4, tile: 'button_brown' }, { x: 7, y: 4, tile: 'trap' }]));
    pressK(LAUNCHER);
    expect(session()).toEqual(sessionAt(LAUNCHER, 'shot', 'target'));
    pressK({ x: 7, y: 4 });
    expect(session()).toEqual(sessionAt({ x: 7, y: 4 }, 'trap', 'target'));
    pressK({ x: 3, y: 4 });
    expect(session()).toEqual(sessionAt({ x: 3, y: 4 }, 'trap', 'button'));
  });

  it('switches the session to another device on K, and ends it on K over the source', () => {
    editor.loadCompiledLevel(room(undefined, [{ ...TRIGGER, tile: 'shot_trigger' }, { ...OTHER_TRIGGER, tile: 'shot_trigger' }]));
    pressK(TRIGGER);
    pressK(OTHER_TRIGGER);
    expect(session()).toEqual(sessionAt(OTHER_TRIGGER, 'shot', 'button'));
    pressK(OTHER_TRIGGER);
    expect(session()).toBeNull();
    expect(status()).toBe(t('editor.link.done.label', { role: role('shot_trigger'), count: 0 }));
  });

  it('says there is nothing to link on a cell that holds no device, and starts nothing', () => {
    editor.loadCompiledLevel(room(undefined, []));
    pressK(EMPTY_FLOOR);
    expect(session()).toBeNull();
    expect(status()).toBe(t('editor.link.nothing.label'));
  });

  it('starts nothing on a CC3D level and says its links come from where things stand', () => {
    editor.loadCompiledLevel(smallCc3dLevel());
    editor.handleKeyAction({ kind: 'link' });
    expect(session()).toBeNull();
    expect(status()).toBe(t('editor.link.unavailable.label'));
  });

  it('starts from the Link button of the Connections section, on the target end too', () => {
    editor.loadCompiledLevel(room(undefined, [{ ...TRIGGER, tile: 'shot_trigger' }, { ...LAUNCHER, tile: 'shot_launcher_w' }]));
    editor['cursorCell'] = { ...LAUNCHER };
    editor.render();
    expect(linkButton().classList.contains('hidden')).toBe(false);
    expect(linkButton().textContent).toBe(t('editor.connections.link.action'));
    linkButton().click();
    expect(session()).toEqual(sessionAt(LAUNCHER, 'shot', 'target'));
  });

  it('refuses a hidden brown button and a hidden trap, but starts on a shot trigger hidden under a door', () => {
    const level = room(undefined, [{ ...TRIGGER, tile: 'door_red' }, { ...OTHER_TRIGGER, tile: 'door_red' }]);
    level.underlays = [
      { x: TRIGGER.x, y: TRIGGER.y, terrain: 'shot_trigger' },
      { x: OTHER_TRIGGER.x, y: OTHER_TRIGGER.y, terrain: 'button_brown' }
    ];
    editor.loadCompiledLevel(level);
    pressK(OTHER_TRIGGER);
    expect(session()).toBeNull();
    expect(status()).toBe(t('editor.link.refused.hidden.label', { role: role('trap_button') }));
    pressK(TRIGGER);
    expect(session()).toEqual(sessionAt(TRIGGER, 'shot', 'button'));
  });

  it('cancels a floating paste when it starts', () => {
    editor.loadCompiledLevel(room(undefined, [{ ...TRIGGER, tile: 'shot_trigger' }]));
    editor['pasting'] = true;
    pressK(TRIGGER);
    expect(editor['pasting']).toBe(false);
    expect(session()).not.toBeNull();
  });
});

describe('linking inside a session', () => {
  it('links and unlinks a launcher on click, one undo step each, and stays open', () => {
    editor.loadCompiledLevel(room(undefined, [{ ...TRIGGER, tile: 'shot_trigger' }, { ...LAUNCHER, tile: 'shot_launcher_w' }, { ...SECOND_LAUNCHER, tile: 'shot_launcher_w' }]));
    pressK(TRIGGER);
    click(LAUNCHER);
    expect(linksOf()).toEqual([link(TRIGGER, LAUNCHER)]);
    expect(terrainAt(LAUNCHER)).toBe('shot_launcher_w');
    expect(status()).toBe(t('editor.link.linked.label', { role: role('shot_trigger'), count: 1 }));
    click(SECOND_LAUNCHER);
    expect(linksOf()).toEqual([link(TRIGGER, LAUNCHER), link(TRIGGER, SECOND_LAUNCHER)]);
    click(LAUNCHER);
    expect(linksOf()).toEqual([link(TRIGGER, SECOND_LAUNCHER)]);
    expect(status()).toBe(t('editor.link.unlinked.label', { role: role('shot_trigger'), count: 1 }));
    expect(session()).toEqual(sessionAt(TRIGGER, 'shot', 'button'));
    // Three changes, three history steps.
    editor.undo();
    expect(linksOf()).toEqual([link(TRIGGER, LAUNCHER), link(TRIGGER, SECOND_LAUNCHER)]);
    editor.undo();
    expect(linksOf()).toEqual([link(TRIGGER, LAUNCHER)]);
    editor.undo();
    expect(linksOf()).toBeUndefined();
    expect(editor['history'].canUndo()).toBe(false);
    expect(session()).not.toBeNull();
  });

  it('links from the launcher end, with a launcher hidden under a door', () => {
    const level = room(undefined, [{ ...TRIGGER, tile: 'shot_trigger' }, { ...LAUNCHER, tile: 'door_red' }]);
    level.underlays = [{ x: LAUNCHER.x, y: LAUNCHER.y, terrain: 'shot_launcher_w' }];
    editor.loadCompiledLevel(level);
    pressK(LAUNCHER);
    click(TRIGGER);
    expect(linksOf()).toEqual([link(TRIGGER, LAUNCHER)]);
    expect(terrainAt(LAUNCHER)).toBe('door_red');
  });

  it('places the partner on a free floor cell as one undo step, facing the direction control', () => {
    editor.loadCompiledLevel(room(undefined, [{ ...TRIGGER, tile: 'shot_trigger' }]));
    pressK(TRIGGER);
    setDirection('E');
    click(LAUNCHER);
    expect(terrainAt(LAUNCHER)).toBe('shot_launcher_e');
    expect(linksOf()).toEqual([link(TRIGGER, LAUNCHER)]);
    expect(status()).toContain(t('editor.link.placed.label', { role: role('shot_trigger'), partner: role('shot_launcher'), count: 1 }));
    editor.undo();
    expect(terrainAt(LAUNCHER)).toBe('floor');
    expect(linksOf()).toBeUndefined();
    expect(editor['history'].canUndo()).toBe(false);
    expect(session()).not.toBeNull();
  });

  it('places a trigger from the launcher end, and a red button next to a clone machine', () => {
    editor.loadCompiledLevel(room(undefined, [{ ...LAUNCHER, tile: 'shot_launcher_w' }, { x: 7, y: 4, tile: 'clone_machine' }]));
    pressK(LAUNCHER);
    click(TRIGGER);
    expect(terrainAt(TRIGGER)).toBe('shot_trigger');
    expect(linksOf()).toEqual([link(TRIGGER, LAUNCHER)]);
    pressK({ x: 7, y: 4 });
    click(FREE);
    expect(terrainAt(FREE)).toBe('button_red');
    expect(editor.exportCompiledLevel().cloneLinks).toHaveLength(1);
  });

  it('refuses a wall or another device, and a floor cell that hides terrain, naming what is missing', () => {
    const level = room(undefined, [{ ...TRIGGER, tile: 'shot_trigger' }, { ...OTHER_TRIGGER, tile: 'door_red' }]);
    level.underlays = [{ x: OTHER_TRIGGER.x, y: OTHER_TRIGGER.y, terrain: 'floor' }];
    level.terrain[3][3] = 'wall';
    editor.loadCompiledLevel(level);
    pressK(TRIGGER);
    click({ x: 3, y: 3 });
    expect(terrainAt({ x: 3, y: 3 })).toBe('wall');
    expect(status()).toBe(t('editor.link.refused.other.label', { found: t(ConfigRegistry.getTile('wall').i18nKey), expected: role('shot_launcher') }));
    expect(editor['history'].canUndo()).toBe(false);
    expect(session()).not.toBeNull();
  });

  it('never paints during a session: a drag over cells changes nothing', () => {
    editor.loadCompiledLevel(room(undefined, [{ ...TRIGGER, tile: 'shot_trigger' }, { ...LAUNCHER, tile: 'shot_launcher_w' }]));
    pressK(TRIGGER);
    pointer('pointerdown', LAUNCHER);
    for (const x of [LAUNCHER.x + 1, LAUNCHER.x + 2]) pointer('pointermove', { x, y: LAUNCHER.y });
    window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    expect(linksOf()).toEqual([link(TRIGGER, LAUNCHER)]);
    expect(terrainAt({ x: LAUNCHER.x + 1, y: LAUNCHER.y })).toBe('floor');
    expect(editor['stroke']).toBeNull();
  });

  it('acts from the keyboard with Enter and Space on the cursor cell', () => {
    editor.loadCompiledLevel(room(undefined, [{ ...TRIGGER, tile: 'shot_trigger' }]));
    pressK(TRIGGER);
    canvas.focus();
    editor['cursorCell'] = { ...LAUNCHER };
    setDirection('W');
    canvas.focus();
    press('Enter');
    expect(terrainAt(LAUNCHER)).toBe('shot_launcher_w');
    expect(linksOf()).toEqual([link(TRIGGER, LAUNCHER)]);
    editor['cursorCell'] = { ...LAUNCHER };
    press(' ');
    expect(linksOf()).toBeUndefined();
    expect(session()).not.toBeNull();
  });

  it('moves the session to another device of the same kind without editing', () => {
    editor.loadCompiledLevel(room(undefined, [{ ...TRIGGER, tile: 'shot_trigger' }, { ...OTHER_TRIGGER, tile: 'shot_trigger' }]));
    pressK(TRIGGER);
    click(OTHER_TRIGGER);
    expect(session()).toEqual(sessionAt(OTHER_TRIGGER, 'shot', 'button'));
    expect(editor['history'].canUndo()).toBe(false);
  });

  it('exports the links it made and reopens them', () => {
    editor.loadCompiledLevel(room(undefined, [{ ...TRIGGER, tile: 'shot_trigger' }]));
    pressK(TRIGGER);
    click(LAUNCHER);
    const exported = editor.exportCompiledLevel();
    expect(exported.launcherLinks).toEqual([link(TRIGGER, LAUNCHER)]);
    editor.loadCompiledLevel(exported);
    expect(linksOf()).toEqual([link(TRIGGER, LAUNCHER)]);
  });
});

describe('the Connections section during a session', () => {
  it('stays on the source while the pointer and cursor move, and the Link button reads Done', () => {
    editor.loadCompiledLevel(room(undefined, [{ ...TRIGGER, tile: 'shot_trigger' }, { ...LAUNCHER, tile: 'shot_launcher_w' }]));
    pressK(TRIGGER);
    expect(caption()).toContain(`(${TRIGGER.x}, ${TRIGGER.y})`);
    expect(linkButton().textContent).toBe(t('editor.connections.link.done'));
    editor['cursorCell'] = { ...LAUNCHER };
    editor['hoverCell'] = { ...LAUNCHER };
    editor.render();
    expect(caption()).toContain(`(${TRIGGER.x}, ${TRIGGER.y})`);
    click(LAUNCHER);
    expect(caption()).toContain(`(${TRIGGER.x}, ${TRIGGER.y})`);
    expect(byId('editor-connections-controls').querySelectorAll('.editor-connection-row')).toHaveLength(1);
  });

  it('ends with the Done button and goes back to the cell under the cursor', () => {
    editor.loadCompiledLevel(room(undefined, [{ ...TRIGGER, tile: 'shot_trigger' }, { ...LAUNCHER, tile: 'shot_launcher_w' }]));
    pressK(TRIGGER);
    editor['cursorCell'] = { ...LAUNCHER };
    editor.render();
    linkButton().click();
    expect(session()).toBeNull();
    expect(status()).toBe(t('editor.link.done.label', { role: role('shot_trigger'), count: 0 }));
    expect(caption()).toContain(`(${LAUNCHER.x}, ${LAUNCHER.y})`);
    expect(linkButton().textContent).toBe(t('editor.connections.link.action'));
  });

  it('draws the partners the session offers, from the document revision', () => {
    editor.loadCompiledLevel(room(undefined, [{ ...TRIGGER, tile: 'shot_trigger' }, { ...LAUNCHER, tile: 'shot_launcher_w' }, { ...SECOND_LAUNCHER, tile: 'shot_launcher_w' }], [link(TRIGGER, LAUNCHER)]));
    pressK(TRIGGER);
    const partners = editor['sessionPartners']();
    expect(partners?.candidates).toEqual([LAUNCHER, SECOND_LAUNCHER]);
    expect(partners?.linked).toEqual([LAUNCHER]);
    expect(editor['sessionPartners']()).toBe(partners);
    click(SECOND_LAUNCHER);
    expect(editor['sessionPartners']()?.linked).toEqual([LAUNCHER, SECOND_LAUNCHER]);
  });
});

describe('ending a session', () => {
  const open = (): void => {
    editor.loadCompiledLevel(room(undefined, [{ ...TRIGGER, tile: 'shot_trigger' }, { ...LAUNCHER, tile: 'shot_launcher_w' }], [link(TRIGGER, LAUNCHER)]));
    pressK(TRIGGER);
  };

  it('ends on Escape and says how many launchers the trigger fires', () => {
    open();
    editor.handleKeyAction({ kind: 'cancel' });
    expect(session()).toBeNull();
    expect(status()).toBe(t('editor.link.done.label', { role: role('shot_trigger'), count: 1 }));
  });

  it('ends on a click on the source cell', () => {
    open();
    click(TRIGGER);
    expect(session()).toBeNull();
    expect(linksOf()).toEqual([link(TRIGGER, LAUNCHER)]);
  });

  it('drops a pending paste or the selection with Escape before it ends the session', () => {
    open();
    editor['selection'] = { x: 3, y: 3, width: 2, height: 2 };
    editor.handleKeyAction({ kind: 'cancel' });
    expect(editor['selection']).toBeNull();
    expect(session()).not.toBeNull();
    editor.handleKeyAction({ kind: 'cancel' });
    expect(session()).toBeNull();
  });

  it('says nothing when no session is open', () => {
    editor.loadCompiledLevel(room(undefined, []));
    const before = status();
    editor.handleKeyAction({ kind: 'cancel' });
    expect(status()).toBe(before);
  });

  it('ends on a secondary button or an Alt click instead of painting', () => {
    open();
    click(EMPTY_FLOOR, { button: 2 });
    expect(session()).toBeNull();
    expect(terrainAt(EMPTY_FLOOR)).toBe('floor');
    pressK(TRIGGER);
    click(EMPTY_FLOOR, { altKey: true });
    expect(session()).toBeNull();
    expect(editor['brush']).toEqual({ kind: 'terrain', id: 'wall' });
  });

  it('ends when another tool or palette entry is chosen', () => {
    open();
    editor.setTool('eraser');
    expect(session()).toBeNull();
    pressK(TRIGGER);
    openMechanisms();
    paletteButton(t('tiles.shot_trigger.name')).click();
    expect(session()).toBeNull();
  });

  it('ends when the picker is chosen, a resize applies, or another level loads', () => {
    open();
    editor.setTool('picker');
    expect(session()).toBeNull();
    editor.setTool('brush');
    pressK(TRIGGER);
    byId<HTMLInputElement>('editor-size-width').value = String(WIDTH + 1);
    byId<HTMLButtonElement>('editor-size-apply-btn').click();
    expect(editor.exportCompiledLevel().terrain[0]).toHaveLength(WIDTH + 1);
    expect(session()).toBeNull();
    pressK(TRIGGER);
    expect(session()).not.toBeNull();
    editor.loadCompiledLevel(room(undefined, []));
    expect(session()).toBeNull();
  });

  it('takes a click on the map as a session click under the picker, and picks nothing', () => {
    editor.loadCompiledLevel(room(undefined, [{ ...TRIGGER, tile: 'shot_trigger' }, { ...LAUNCHER, tile: 'shot_launcher_w' }]));
    editor.setTool('picker');
    const brush = editor['brush'];
    pressK(TRIGGER);
    click(LAUNCHER);
    expect(linksOf()).toEqual([link(TRIGGER, LAUNCHER)]);
    expect(session()).toEqual(sessionAt(TRIGGER, 'shot', 'button'));
    expect(editor['brush']).toEqual(brush);
  });

  it('does not extend the selection with the cursor while a session is open', () => {
    editor.loadCompiledLevel(room(undefined, [{ ...TRIGGER, tile: 'shot_trigger' }]));
    editor.setTool('select');
    pressK(TRIGGER);
    expect(session()).not.toBeNull();
    editor['moveCursorTo']({ x: 4, y: 4 }, true);
    expect(editor['selection']).toBeNull();
  });

  it('says a stroke is running instead of staying silent on K', () => {
    editor.loadCompiledLevel(room(undefined, [{ ...TRIGGER, tile: 'shot_trigger' }]));
    editor['stroke'] = {} as never;
    pressK(TRIGGER);
    expect(session()).toBeNull();
    expect(status()).toBe(t('editor.link.busy.label'));
    editor['stroke'] = null as never;
  });

  it('keeps the session through undo and redo, and ends it saying so when the source is gone', () => {
    editor.loadCompiledLevel(room(undefined, []));
    openMechanisms();
    paletteButton(t('tiles.shot_trigger.name')).click();
    click(TRIGGER);
    pressK(TRIGGER);
    click(LAUNCHER);
    expect(linksOf()).toEqual([link(TRIGGER, LAUNCHER)]);
    editor.undo();
    expect(linksOf()).toBeUndefined();
    expect(session()).not.toBeNull();
    editor.redo();
    expect(linksOf()).toEqual([link(TRIGGER, LAUNCHER)]);
    expect(session()).not.toBeNull();
    editor.undo();
    editor.undo();
    expect(terrainAt(TRIGGER)).toBe('floor');
    expect(session()).toBeNull();
    expect(status()).toBe(t('editor.link.source_gone.label', { role: role('shot_trigger') }));
  });

  it('ends when an edit removes the source', () => {
    open();
    editor['cursorCell'] = { ...TRIGGER };
    const base = editor['doc'];
    editor['doc'] = { ...base, terrain: base.terrain.map((row, y) => (y === TRIGGER.y ? row.map((id, x) => (x === TRIGGER.x ? 'floor' : id)) : row)) };
    editor['recordChange'](base);
    expect(session()).toBeNull();
    expect(status()).toBe(t('editor.link.source_gone.label', { role: role('shot_trigger') }));
  });

  it('ends when hidden terrain is cleared from the source', () => {
    const level = room(undefined, [{ ...TRIGGER, tile: 'door_red' }]);
    level.underlays = [{ x: TRIGGER.x, y: TRIGGER.y, terrain: 'shot_trigger' }];
    editor.loadCompiledLevel(level);
    pressK(TRIGGER);
    expect(session()).not.toBeNull();
    editor['cursorCell'] = { ...TRIGGER };
    editor['setHiddenTerrain']('');
    expect(session()).toBeNull();
  });
});

describe('Lynx rules', () => {
  const BUTTON = { x: 3, y: 2 };
  const TRAP = { x: 6, y: 2 };
  const SECOND_TRAP = { x: 6, y: 4 };

  it('links a brown button to a trap, and replaces the old link when a second trap is linked', () => {
    editor.loadCompiledLevel(room('lynx', [{ ...BUTTON, tile: 'button_brown' }, { ...TRAP, tile: 'trap' }, { ...SECOND_TRAP, tile: 'trap' }]));
    pressK(BUTTON);
    expect(session()).toEqual(sessionAt(BUTTON, 'trap', 'button'));
    click(TRAP);
    expect(editor.exportCompiledLevel().trapLinks).toEqual([{ buttonX: BUTTON.x, buttonY: BUTTON.y, trapX: TRAP.x, trapY: TRAP.y }]);
    click(SECOND_TRAP);
    expect(editor.exportCompiledLevel().trapLinks).toEqual([{ buttonX: BUTTON.x, buttonY: BUTTON.y, trapX: SECOND_TRAP.x, trapY: SECOND_TRAP.y }]);
    expect(status()).toContain(t('editor.link.replaced.label'));
  });

  it('refuses the shot devices with the Epoxy-only reason, from K and with no Link button', () => {
    // A level with Epoxy-only content opens under Epoxy rules: the ruleset is switched afterwards.
    editor.loadCompiledLevel(room(undefined, [{ ...TRIGGER, tile: 'shot_trigger' }]));
    editor['doc'] = { ...editor['doc'], ruleset: 'lynx' };
    pressK(TRIGGER);
    expect(session()).toBeNull();
    expect(status()).toBe(t('editor.palette.unavailable.epoxy_only.label'));
    expect(linkButton().classList.contains('hidden')).toBe(true);
  });

  it('ends a shot session when the level switches to Lynx rules', () => {
    editor.loadCompiledLevel(room(undefined, [{ ...TRIGGER, tile: 'shot_trigger' }]));
    pressK(TRIGGER);
    expect(session()).not.toBeNull();
    editor['doc'] = { ...editor['doc'], ruleset: 'lynx' };
    editor['afterMetadataChange']();
    expect(session()).toBeNull();
    // The source still holds its end: the status gives the Epoxy-only reason, not "gone".
    expect(status()).toBe(t('editor.palette.unavailable.epoxy_only.label'));
  });

  it('keeps the Lynx wording for an unlinked device', () => {
    editor.loadCompiledLevel(room('lynx', [{ x: 3, y: 2, tile: 'button_brown' }]));
    pressK({ x: 3, y: 2 });
    expect(status()).toContain(t('editor.link.fallback_lynx.trap_button.label'));
    expect(status()).not.toContain(t('editor.link.fallback.trap_button.label'));
  });
});

describe('the validator warning and the issue list', () => {
  const triggerWarning = (): string =>
    stripSeverityPrefix(t('validator.issues.shot_trigger_no_link.label', { x: TRIGGER.x, y: TRIGGER.y }), 'warning');
  const rows = (): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>('#editor-issues-list .editor-issue-row'));

  it('goes away once the trigger is linked in a session, and the row of the warning jumps to the trigger', () => {
    editor.loadCompiledLevel(room(undefined, [{ ...TRIGGER, tile: 'shot_trigger' }, { ...LAUNCHER, tile: 'shot_launcher_w' }]));
    byId<HTMLButtonElement>('editor-validate-btn').click();
    const warning = rows().find((row) => row.textContent?.includes(triggerWarning()));
    expect(warning).toBeDefined();
    expect(warning?.tagName).toBe('BUTTON');
    warning?.click();
    expect(byId('editor-coords-badge').textContent).toBe(t('editor.palette.status.coords', TRIGGER));

    pressK(TRIGGER);
    click(LAUNCHER);
    byId<HTMLButtonElement>('editor-validate-btn').click();
    expect(rows().some((row) => row.textContent?.includes(triggerWarning()))).toBe(false);
  });
});

describe('the K key in the help and the locales', () => {
  it('is listed in the help modal in both languages', () => {
    for (const locale of ['en', 'fr'] as const) {
      i18n.setLocale(locale);
      expect(t('hud.help_modal.kb_editor_link.label')).not.toBe('hud.help_modal.kb_editor_link.label');
      expect(t('hud.help_modal.kb_editor_cancel.label')).not.toContain('wire');
    }
    i18n.setLocale('en');
  });
});

describe('a signal session', () => {
  const PLATE = { x: 2, y: 2 };
  const AND = { x: 4, y: 2 };
  const DOOR = { x: 6, y: 2 };
  const signalsOf = (): unknown => editor.exportCompiledLevel().signalLinks;
  const signalRoom = (): CompiledLevel =>
    room(undefined, [
      { ...PLATE, tile: 'signal_plate' },
      { ...AND, tile: 'signal_gate_and' },
      { ...DOOR, tile: 'hold_door_red_closed' }
    ]);

  it('links a plate to an AND gate and the gate to a door with K and clicks, one undo step each', () => {
    editor.loadCompiledLevel(signalRoom());
    pressK(PLATE);
    expect(session()).toEqual(sessionAt(PLATE, 'signal', 'button'));
    expect(status()).toContain(role('signal_out'));
    click(AND);
    expect(signalsOf()).toEqual([{ fromX: PLATE.x, fromY: PLATE.y, toX: AND.x, toY: AND.y }]);
    expect(terrainAt(AND)).toBe('signal_gate_and');
    pressK(AND);
    expect(session()).toEqual(sessionAt(AND, 'signal', 'button'));
    click(DOOR);
    expect(signalsOf()).toEqual([
      { fromX: PLATE.x, fromY: PLATE.y, toX: AND.x, toY: AND.y },
      { fromX: AND.x, fromY: AND.y, toX: DOOR.x, toY: DOOR.y }
    ]);
    editor.undo();
    expect(signalsOf()).toEqual([{ fromX: PLATE.x, fromY: PLATE.y, toX: AND.x, toY: AND.y }]);
    editor.undo();
    expect(signalsOf()).toBeUndefined();
  });

  it('starts on a hold door as the input end and links a plate into it', () => {
    editor.loadCompiledLevel(signalRoom());
    pressK(DOOR);
    expect(session()).toEqual(sessionAt(DOOR, 'signal', 'target'));
    click(PLATE);
    expect(signalsOf()).toEqual([{ fromX: PLATE.x, fromY: PLATE.y, toX: DOOR.x, toY: DOOR.y }]);
  });

  it('refuses a cycle with its message and ends on Escape', () => {
    const level = signalRoom();
    level.terrain[3][4] = 'signal_gate_or';
    level.signalLinks = [{ fromX: AND.x, fromY: AND.y, toX: 4, toY: 3 }];
    editor.loadCompiledLevel(level);
    pressK({ x: 4, y: 3 });
    click(AND);
    expect(signalsOf()).toEqual([{ fromX: AND.x, fromY: AND.y, toX: 4, toY: 3 }]);
    expect(status()).toBe(t('editor.link.refused.cycle.label', { x: AND.x, y: AND.y }));
    expect(session()).not.toBeNull();
    editor.handleKeyAction({ kind: 'cancel' });
    expect(session()).toBeNull();
  });

  it('places nothing on an empty floor cell', () => {
    editor.loadCompiledLevel(signalRoom());
    pressK(PLATE);
    click(EMPTY_FLOOR);
    expect(terrainAt(EMPTY_FLOOR)).toBe('floor');
    expect(signalsOf()).toBeUndefined();
  });

  it('is refused under Lynx rules with the Epoxy-only reason', () => {
    editor.loadCompiledLevel(signalRoom());
    editor['doc'] = { ...editor['doc'], ruleset: 'lynx' };
    pressK(PLATE);
    expect(session()).toBeNull();
    expect(status()).toBe(t('editor.palette.unavailable.epoxy_only.label'));
  });
});
