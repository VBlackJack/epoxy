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

/** The Stamps menu: ready-made linked pairs that float like a paste, leave the clipboard alone and turn with Shift+R. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../ui/confirmDialog', () => ({ confirmDialog: vi.fn(async () => false) }));
vi.mock('../ui/saveIntoDialog', () => ({ askSaveInto: vi.fn() }));

import { LevelValidator } from '../core/LevelValidator';
import type { CompiledLevel } from '../core/types';
import { i18n, t } from '../i18n/I18nManager';
import { LevelPackStorage } from '../storage/LevelPackStorage';
import { FakeIndexedDb } from '../test/FakeIndexedDb';
import { mountModals } from '../test/domFixture';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { smallCc3dLevel } from './cc3dEditorFixtures';
import { connectionRows } from './connectionRows';
import { LevelEditor } from './LevelEditor';
import { MECHANISM_STAMPS } from './mechanismStamps';

const WIDTH = 9;
const HEIGHT = 7;
/** Keys that move the keyboard cursor from the player start (1, 1) to the cell a stamp is placed on. */
const TO_THREE_THREE = ['ArrowRight', 'ArrowRight', 'ArrowDown', 'ArrowDown'];
const PLACE_X = 3;
const PLACE_Y = 3;

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
const stampsButton = (): HTMLButtonElement => byId<HTMLButtonElement>('editor-stamps-btn');
const menu = (): HTMLElement => byId('editor-stamps-menu');
const menuIsOpen = (): boolean => !menu().classList.contains('hidden');
const menuItems = (): HTMLButtonElement[] => Array.from(menu().querySelectorAll<HTMLButtonElement>('.editor-stamp-item'));
const toolButton = (tool: string): HTMLButtonElement => document.querySelector<HTMLButtonElement>(`.editor-tool-btn[data-tool="${tool}"]`)!;

/** A bordered room with a trap pair: brown button (1, 2) linked to the trap (3, 2). */
function room(ruleset?: CompiledLevel['ruleset']): CompiledLevel {
  const terrain: string[][] = Array.from({ length: HEIGHT }, (_, y) =>
    Array.from({ length: WIDTH }, (_, x) => (x === 0 || y === 0 || x === WIDTH - 1 || y === HEIGHT - 1 ? 'wall' : 'floor'))
  );
  terrain[2][1] = 'button_brown';
  terrain[2][3] = 'trap';
  return {
    id: 'lvl_stamps_dom',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    customTitle: 'Stamps room',
    ruleset,
    playerStart: { x: 1, y: 1, dir: 'S' },
    terrain,
    items: terrain.map((row) => row.map(() => null as string | null)),
    entities: [],
    trapLinks: [{ buttonX: 1, buttonY: 2, trapX: 3, trapY: 2 }],
    cloneLinks: []
  };
}

function open(level: CompiledLevel): void {
  editor.loadCompiledLevel(level);
  canvas.focus();
  toolButton('select').click();
}

function chooseStamp(id: string): void {
  stampsButton().click();
  const item = menuItems().find((candidate) => candidate.dataset.stamp === id);
  if (!item) throw new Error(`No stamp ${id} in the menu`);
  item.click();
}

function moveCursorTo(keys: readonly string[]): void {
  for (const key of keys) press(key);
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
  i18n.setLocale('en');
});

describe('the Stamps menu', () => {
  it('lists the three stamps of an Epoxy level with a name and a description each', () => {
    open(room());
    stampsButton().click();
    expect(menuIsOpen()).toBe(true);
    expect(stampsButton().getAttribute('aria-expanded')).toBe('true');
    expect(menuItems().map((item) => item.dataset.stamp)).toEqual(['trap', 'clone', 'shot']);
    for (const [index, stamp] of MECHANISM_STAMPS.entries()) {
      expect(menuItems()[index].querySelector('.editor-stamp-name')?.textContent).toBe(t(stamp.i18nKey));
      expect(menuItems()[index].querySelector('.editor-stamp-desc')?.textContent).toBe(t(stamp.descI18nKey));
    }
    expect(document.activeElement).toBe(menuItems()[0]);
  });

  it('lists only the trap and clone stamps on a Lynx level', () => {
    open(room('lynx'));
    stampsButton().click();
    expect(menuItems().map((item) => item.dataset.stamp)).toEqual(['trap', 'clone']);
  });

  it('is hidden on a CC3D level, and a stamp is refused there', () => {
    editor.loadCompiledLevel(smallCc3dLevel());
    expect(stampsButton().classList.contains('hidden')).toBe(true);
    expect(editor['beginStamp']('trap')).toBe(false);
    expect(status()).toContain(t('editor.stamps.status.unavailable.label'));
    editor.loadCompiledLevel(room());
    expect(stampsButton().classList.contains('hidden')).toBe(false);
  });

  it('closes on Escape and gives the focus back to its button', () => {
    open(room());
    stampsButton().click();
    menuItems()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(menuIsOpen()).toBe(false);
    expect(stampsButton().getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(stampsButton());
  });

  it('closes on Escape pressed on the button too, and leaves Escape alone while closed', () => {
    open(room());
    stampsButton().click();
    const whileOpen = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    stampsButton().dispatchEvent(whileOpen);
    expect(whileOpen.defaultPrevented).toBe(true);
    expect(menuIsOpen()).toBe(false);
    const closed = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    stampsButton().dispatchEvent(closed);
    expect(closed.defaultPrevented).toBe(false);
  });

  it('closes when the focus leaves the menu, and stays open while it moves inside', () => {
    open(room());
    stampsButton().click();
    const items = menuItems();
    items[0].dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: items[1] }));
    expect(menuIsOpen()).toBe(true);
    items[1].dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: stampsButton() }));
    expect(menuIsOpen()).toBe(true);
    items[1].dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: canvas }));
    expect(menuIsOpen()).toBe(false);
    expect(stampsButton().getAttribute('aria-expanded')).toBe('false');
  });

  it('has no aria-haspopup, keeping aria-expanded and aria-controls', () => {
    expect(stampsButton().hasAttribute('aria-haspopup')).toBe(false);
    expect(stampsButton().getAttribute('aria-controls')).toBe('editor-stamps-menu');
    expect(stampsButton().getAttribute('aria-expanded')).toBe('false');
  });

  it('closes on a click elsewhere and on a second click of the button', () => {
    open(room());
    stampsButton().click();
    canvas.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(menuIsOpen()).toBe(false);
    stampsButton().click();
    stampsButton().click();
    expect(menuIsOpen()).toBe(false);
  });
});

describe('placing a stamp', () => {
  it('floats the stamp, places it with Enter as one undo step, and links its ends', () => {
    open(room());
    moveCursorTo(TO_THREE_THREE);
    const before = editor.exportCompiledLevel();
    chooseStamp('trap');
    expect(menuIsOpen()).toBe(false);
    expect(status()).toContain(t('editor.stamps.status.ready.label', { name: t(MECHANISM_STAMPS[0].i18nKey) }));
    // Floating only: the map has not changed yet.
    expect(editor.exportCompiledLevel().trapLinks).toEqual(before.trapLinks);

    press('Enter');
    const placed = editor.exportCompiledLevel();
    expect(placed.terrain[PLACE_Y].slice(PLACE_X, PLACE_X + 3)).toEqual(['button_brown', 'floor', 'trap']);
    expect(placed.trapLinks).toContainEqual({ buttonX: PLACE_X, buttonY: PLACE_Y, trapX: PLACE_X + 2, trapY: PLACE_Y });
    expect(status()).toContain(t('editor.selection.status.links_pasted.label', { count: 1 }));

    // The Connections list names the partner of the button.
    const view = connectionRows(placed, PLACE_X, PLACE_Y);
    expect(view.controls?.rows.map((row) => [row.x, row.y, row.kind])).toEqual([[PLACE_X + 2, PLACE_Y, 'link']]);

    // One step: a single undo restores the level from before.
    editor.undo();
    expect(editor.exportCompiledLevel().terrain).toEqual(before.terrain);
    expect(editor.exportCompiledLevel().trapLinks).toEqual(before.trapLinks);
  });

  it('places the clone stamp with a block on its machine, and the shot stamp with a launcher facing away from its trigger', () => {
    open(room());
    moveCursorTo(TO_THREE_THREE);
    chooseStamp('clone');
    press('Enter');
    let level = editor.exportCompiledLevel();
    expect(level.terrain[PLACE_Y].slice(PLACE_X, PLACE_X + 3)).toEqual(['button_red', 'floor', 'clone_machine']);
    expect(level.entities).toContainEqual({ x: PLACE_X + 2, y: PLACE_Y, type: 'dirt_block', dir: 'W' });
    expect(level.cloneLinks).toContainEqual({
      buttonX: PLACE_X,
      buttonY: PLACE_Y,
      clonerX: PLACE_X + 2,
      clonerY: PLACE_Y,
      templateType: 'dirt_block',
      templateDir: 'W'
    });

    moveCursorTo(['ArrowDown']);
    chooseStamp('shot');
    press('Enter');
    level = editor.exportCompiledLevel();
    const row = PLACE_Y + 1;
    expect(level.terrain[row].slice(PLACE_X, PLACE_X + 3)).toEqual(['shot_trigger', 'floor', 'shot_launcher_e']);
    expect(level.launcherLinks).toEqual([{ buttonX: PLACE_X, buttonY: row, launcherX: PLACE_X + 2, launcherY: row }]);
    expect(connectionRows(level, PLACE_X + 2, row).controlledBy?.rows.map((r) => [r.x, r.y])).toEqual([[PLACE_X, row]]);
  });

  it.each(MECHANISM_STAMPS.map((stamp) => [stamp.id] as const))('the %s stamp raises no link, unlinked or wall warning from the validator', (id) => {
    open(room());
    moveCursorTo(TO_THREE_THREE);
    chooseStamp(id);
    press('Enter');
    const own = LevelValidator.validate(editor.exportCompiledLevel()).issues.filter((issue) =>
      /trap_link|clone_link|shot_trigger_no_link|shot_launcher_unlinked|shot_launcher_faces_wall/.test(issue.i18nKey)
    );
    expect(own).toEqual([]);
  });

  it('is cancelled with Escape without a step in the history', () => {
    open(room());
    moveCursorTo(TO_THREE_THREE);
    const before = editor.exportCompiledLevel();
    chooseStamp('trap');
    editor.handleKeyAction({ kind: 'cancel' });
    expect(status()).toContain(t('editor.selection.status.paste_cancelled'));
    press('Enter');
    expect(editor.exportCompiledLevel().terrain).toEqual(before.terrain);
  });

  it('forgets the floating stamp once it is placed, cancelled or dropped by a tool change', () => {
    open(room());
    moveCursorTo(TO_THREE_THREE);
    chooseStamp('trap');
    expect(editor['floatingStamp']).not.toBeNull();
    press('Enter');
    expect(editor['floatingStamp']).toBeNull();
    chooseStamp('trap');
    editor.handleKeyAction({ kind: 'cancel' });
    expect(editor['floatingStamp']).toBeNull();
    chooseStamp('trap');
    toolButton('brush').click();
    expect(editor['floatingStamp']).toBeNull();
  });

  it('does not touch the copied clipboard: a paste afterwards still pastes the copy', () => {
    open(room());
    // Copy the trap pair (1, 2) to (3, 2).
    press('ArrowDown');
    press('Enter');
    press('ArrowRight', { shiftKey: true });
    press('ArrowRight', { shiftKey: true });
    editor.handleSelectionAction({ kind: 'copy' });

    // Place a stamp lower down, back on the left wall (the selection left the cursor on its right end).
    moveCursorTo(['ArrowLeft', 'ArrowLeft', 'ArrowDown', 'ArrowDown']);
    chooseStamp('trap');
    press('Enter');
    expect(editor.exportCompiledLevel().trapLinks).toContainEqual({ buttonX: 1, buttonY: 4, trapX: 3, trapY: 4 });

    // The copy is still there: paste it one row lower.
    editor.handleSelectionAction({ kind: 'paste' });
    expect(status()).toContain(t('editor.selection.status.paste_ready'));
    press('ArrowDown');
    press('Enter');
    expect(editor.exportCompiledLevel().trapLinks).toEqual(
      expect.arrayContaining([
        { buttonX: 1, buttonY: 2, trapX: 3, trapY: 2 },
        { buttonX: 1, buttonY: 4, trapX: 3, trapY: 4 },
        { buttonX: 1, buttonY: 5, trapX: 3, trapY: 5 }
      ])
    );
  });

  it('keeps the copy after a cancelled stamp, and an ordinary paste never floats a stamp', () => {
    open(room());
    press('ArrowDown');
    press('Enter');
    press('ArrowRight', { shiftKey: true });
    press('ArrowRight', { shiftKey: true });
    editor.handleSelectionAction({ kind: 'copy' });
    chooseStamp('shot');
    editor.handleKeyAction({ kind: 'cancel' });
    // Ctrl+V while a stamp floats swaps it for the copy.
    chooseStamp('clone');
    editor.handleSelectionAction({ kind: 'paste' });
    expect(status()).toContain(t('editor.selection.status.paste_ready'));
    moveCursorTo(['ArrowLeft', 'ArrowLeft', 'ArrowDown', 'ArrowDown']);
    press('Enter');
    const level = editor.exportCompiledLevel();
    expect(level.terrain[4].slice(1, 4)).toEqual(['button_brown', 'floor', 'trap']);
    expect(level.cloneLinks).toEqual([]);
  });
});

describe('turning a stamp with Shift+R', () => {
  it('swaps the horizontal and vertical layouts of a floating stamp, and back', () => {
    open(room());
    moveCursorTo(TO_THREE_THREE);
    chooseStamp('trap');
    editor.handleKeyAction({ kind: 'rotate_in_place' });
    expect(status()).toContain(t('editor.stamps.status.turned.label', { name: t(MECHANISM_STAMPS[0].i18nKey), layout: t('editor.stamps.layout.vertical.label') }));
    press('Enter');
    const level = editor.exportCompiledLevel();
    expect([level.terrain[PLACE_Y][PLACE_X], level.terrain[PLACE_Y + 1][PLACE_X], level.terrain[PLACE_Y + 2][PLACE_X]]).toEqual(['button_brown', 'floor', 'trap']);
    expect(level.trapLinks).toContainEqual({ buttonX: PLACE_X, buttonY: PLACE_Y, trapX: PLACE_X, trapY: PLACE_Y + 2 });

    editor.undo();
    chooseStamp('trap');
    editor.handleKeyAction({ kind: 'rotate_in_place' });
    editor.handleKeyAction({ kind: 'rotate_in_place' });
    expect(status()).toContain(t('editor.stamps.layout.horizontal.label'));
    press('Enter');
    expect(editor.exportCompiledLevel().terrain[PLACE_Y].slice(PLACE_X, PLACE_X + 3)).toEqual(['button_brown', 'floor', 'trap']);
  });

  it('turns the launcher to keep facing away from its trigger', () => {
    open(room());
    moveCursorTo(TO_THREE_THREE);
    chooseStamp('shot');
    editor.handleKeyAction({ kind: 'rotate_in_place' });
    press('Enter');
    const level = editor.exportCompiledLevel();
    expect(level.terrain[PLACE_Y + 2][PLACE_X]).toBe('shot_launcher_s');
  });

  it('leaves the key alone for an ordinary floating paste', () => {
    open(room());
    press('ArrowDown');
    press('Enter');
    editor.handleSelectionAction({ kind: 'copy' });
    editor.handleSelectionAction({ kind: 'paste' });
    editor.handleKeyAction({ kind: 'rotate_in_place' });
    expect(status()).not.toContain(t('editor.stamps.layout.vertical.label'));
    expect(status()).toContain(t('editor.layout.status.rotate_nothing.label'));
  });
});
