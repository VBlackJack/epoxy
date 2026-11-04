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
import { normalizeUnderlays } from '../config/ConfigValidation';
import type { CellUnderlay, CompiledLevel } from '../core/types';
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

/** The canvas of the room: WIDTH x HEIGHT cells of CELL_PX. */
function useRoomGrid(): void {
  canvas.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: WIDTH * CELL_PX, bottom: HEIGHT * CELL_PX, width: WIDTH * CELL_PX, height: HEIGHT * CELL_PX, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
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

const select = (): HTMLSelectElement => byId<HTMLSelectElement>('editor-hidden-terrain');
const field = (): HTMLElement => byId('editor-hidden-terrain-field');
const section = (): HTMLElement => byId('editor-layers-section');
const unavailable = (): HTMLElement => byId('editor-hidden-terrain-unavailable');
const optionIds = (): string[] => Array.from(select().options).map((option) => option.value);

/** Puts the keyboard cursor on the door cell, from the player start. */
function cursorToDoor(): void {
  canvas.focus();
  press('ArrowRight');
  press('ArrowRight');
  press('ArrowDown');
}

/** Picks a value in the select the way a player does. */
function choose(value: string): void {
  select().value = value;
  select().dispatchEvent(new Event('change', { bubbles: true }));
}

const underlaysOf = (): CellUnderlay[] | undefined => editor.exportCompiledLevel().underlays;

describe('hidden terrain select in the Layers section', () => {
  it('lists None and only the terrains a door can hide', () => {
    editor.loadCompiledLevel(room(undefined, undefined));
    cursorToDoor();
    expect(section().classList.contains('hidden')).toBe(false);
    expect(field().classList.contains('hidden')).toBe(false);
    expect(select().disabled).toBe(false);
    expect(byId('editor-layers-list').classList.contains('hidden')).toBe(true);

    const ids = optionIds();
    expect(ids[0]).toBe('');
    expect(select().options[0].textContent).toBe(t('editor.layout.layers.hidden_terrain.none.label'));
    const expected = Object.values(ConfigRegistry.getTiles().tiles)
      .filter((tile) => tile.layer === 'terrain')
      .filter((tile) => normalizeUnderlays([{ x: DOOR_X, y: DOOR_Y, terrain: tile.id }], room(undefined, undefined).terrain, 'epoxy') !== null)
      .map((tile) => tile.id);
    expect([...ids.slice(1)].sort()).toEqual([...expected].sort());
    expect(ids).toContain('ice');
    expect(ids).toContain('floor');
    // Under a key door a socket, dirt, a blue fake wall and the live devices are offered; key doors never are.
    for (const offered of ['socket', 'dirt', 'blue_wall_fake', 'toggle_wall_closed', 'toggle_wall_open']) {
      expect(ids, offered).toContain(offered);
    }
    for (const tile of Object.values(ConfigRegistry.getTiles().tiles)) {
      if (tile.plateColor || tile.holdDoorColor) expect(ids, tile.id).toContain(tile.id);
      if (tile.requiredKey) expect(ids, tile.id).not.toContain(tile.id);
      if (tile.layer === 'item') expect(ids).not.toContain(tile.id);
    }
    for (const refused of ['door_red', 'door_blue']) expect(ids).not.toContain(refused);
  });

  it('offers the same live devices under a socket, but never the socket itself or a key door', () => {
    const level = room(undefined, undefined, false);
    level.terrain[DOOR_Y][DOOR_X] = 'socket';
    editor.loadCompiledLevel(level);
    cursorToDoor();
    expect(field().classList.contains('hidden')).toBe(false);
    const ids = optionIds();
    for (const offered of ['dirt', 'blue_wall_fake', 'toggle_wall_closed', 'toggle_wall_open', 'ice', 'floor']) {
      expect(ids, offered).toContain(offered);
    }
    for (const tile of Object.values(ConfigRegistry.getTiles().tiles)) {
      if (tile.plateColor || tile.holdDoorColor) expect(ids, tile.id).toContain(tile.id);
      if (tile.requiredKey) expect(ids, tile.id).not.toContain(tile.id);
    }
    expect(ids).not.toContain('socket');
  });

  it('keeps the live devices out of the list under other removable tops (dirt, blue fake wall)', () => {
    for (const top of ['dirt', 'blue_wall_fake']) {
      const level = room(undefined, undefined, false);
      level.terrain[DOOR_Y][DOOR_X] = top;
      editor.loadCompiledLevel(level);
      cursorToDoor();
      const ids = optionIds();
      expect(ids, top).toContain('ice');
      for (const refused of ['socket', 'dirt', 'blue_wall_fake', 'door_red', 'toggle_wall_closed', 'toggle_wall_open']) {
        expect(ids, `${refused} under ${top}`).not.toContain(refused);
      }
      for (const tile of Object.values(ConfigRegistry.getTiles().tiles)) {
        if (tile.plateColor || tile.holdDoorColor) expect(ids, `${tile.id} under ${top}`).not.toContain(tile.id);
      }
    }
  });

  it('names the terrains with the locale and sorts them by name', () => {
    editor.loadCompiledLevel(room(undefined, undefined));
    cursorToDoor();
    const names = Array.from(select().options)
      .slice(1)
      .map((option) => option.textContent ?? '');
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en')));
    expect(names).toContain(t('tiles.ice.name'));
  });

  it('leaves out a terrain that could turn back into the top (water under dirt)', () => {
    const level = room(undefined, undefined, false);
    level.terrain[DOOR_Y][DOOR_X] = 'dirt';
    editor.loadCompiledLevel(level);
    cursorToDoor();
    expect(field().classList.contains('hidden')).toBe(false);
    expect(optionIds()).not.toContain('water');
    expect(optionIds()).toContain('ice');
  });

  it('offers the shot launchers and the shot trigger to hide under a removable top, as the normaliser accepts them', () => {
    const devices = ['shot_launcher_n', 'shot_launcher_e', 'shot_launcher_s', 'shot_launcher_w', 'shot_trigger'];
    editor.loadCompiledLevel(room(undefined, undefined));
    cursorToDoor();
    for (const id of devices) expect(optionIds(), id).toContain(id);
  });

  it('sets the hidden terrain as one undo step, marks and speaks it, and clears it as another', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    editor.loadCompiledLevel(room(undefined, undefined));
    cursorToDoor();
    expect(markerDrawnAt(DOOR_X, DOOR_Y)).toBe(false);

    choose('ice');
    expect(underlaysOf()).toEqual(HIDDEN);
    expect(select().value).toBe('ice');
    expect(status()).toBe(t('editor.layout.layers.hidden_terrain.set', { x: DOOR_X, y: DOOR_Y, name: t('tiles.ice.name') }));
    expect(markerDrawnAt(DOOR_X, DOOR_Y)).toBe(true);
    // The cell is read again with its hidden terrain.
    canvas.focus();
    press('ArrowRight');
    press('ArrowLeft');
    vi.advanceTimersByTime(EDITOR_CELL_ANNOUNCE_DELAY_MS);
    expect(byId('editor-cell-live').textContent).toContain(t('editor.cell_speech.underlay.label', { name: t('tiles.ice.name') }));

    choose('');
    expect('underlays' in editor.exportCompiledLevel()).toBe(false);
    expect(status()).toBe(t('editor.layout.layers.hidden_terrain.cleared', { x: DOOR_X, y: DOOR_Y }));

    // Each change is one step: two undos return to the level without hidden terrain.
    editor.undo();
    expect(underlaysOf()).toEqual(HIDDEN);
    expect(select().value).toBe('ice');
    editor.undo();
    expect('underlays' in editor.exportCompiledLevel()).toBe(false);
    expect(select().value).toBe('');
    editor.redo();
    expect(underlaysOf()).toEqual(HIDDEN);
  });

  it('shows the terrain already hidden under the cell', () => {
    editor.loadCompiledLevel(room(undefined, HIDDEN));
    cursorToDoor();
    expect(select().value).toBe('ice');
  });

  it('shows a hint instead of the select on a top that cannot hide terrain, and the select again on a door', () => {
    editor.loadCompiledLevel(room(undefined, undefined));
    canvas.focus();
    // No cursor cell: the section stays hidden.
    expect(section().classList.contains('hidden')).toBe(true);
    press('ArrowRight');
    // A floor top: the section stays, with the hint and no select.
    expect(section().classList.contains('hidden')).toBe(false);
    expect(field().classList.contains('hidden')).toBe(true);
    expect(unavailable().classList.contains('hidden')).toBe(false);
    expect(unavailable().textContent).toBe(t('editor.layout.layers.hidden_terrain.unavailable.label'));
    press('ArrowRight');
    press('ArrowDown');
    expect(section().classList.contains('hidden')).toBe(false);
    expect(field().classList.contains('hidden')).toBe(false);
    expect(unavailable().classList.contains('hidden')).toBe(true);
    press('ArrowLeft');
    expect(field().classList.contains('hidden')).toBe(true);
    expect(section().classList.contains('hidden')).toBe(false);
    expect(unavailable().classList.contains('hidden')).toBe(false);
  });

  it('words the hint in both languages without a dash', () => {
    for (const locale of ['en', 'fr'] as const) {
      i18n.setLocale(locale);
      const text = t('editor.layout.layers.hidden_terrain.unavailable.label');
      expect(text).not.toBe('editor.layout.layers.hidden_terrain.unavailable.label');
      expect(text).not.toMatch(/[\u2013\u2014]/);
    }
    i18n.setLocale('fr');
    expect(t('editor.layout.layers.hidden_terrain.unavailable.label')).not.toBe(
      (i18n.setLocale('en'), t('editor.layout.layers.hidden_terrain.unavailable.label'))
    );
  });

  it('enables the select with the Epoxy hint when a Lynx level is switched to Epoxy', () => {
    editor.loadCompiledLevel(room('lynx', undefined));
    cursorToDoor();
    expect(select().disabled).toBe(true);
    byId('editor-switch-epoxy-btn').click();
    expect(select().disabled).toBe(false);
    expect(byId('editor-hidden-terrain-hint').textContent).toBe(t('editor.layout.layers.hidden_terrain.hint.label'));
  });

  it('disables the select when an Epoxy level is switched to Lynx', () => {
    editor.loadCompiledLevel(room(undefined, undefined));
    cursorToDoor();
    expect(select().disabled).toBe(false);
    const ruleset = byId<HTMLSelectElement>('editor-meta-ruleset');
    ruleset.value = 'lynx';
    ruleset.dispatchEvent(new Event('input', { bubbles: true }));
    expect(editor.exportCompiledLevel().ruleset).toBe('lynx');
    expect(select().disabled).toBe(true);
    expect(byId('editor-hidden-terrain-hint').textContent).toBe(t('editor.layout.layers.hidden_terrain.lynx.label'));
  });

  it('puts the select back when a refused change slips through under Lynx rules', () => {
    editor.loadCompiledLevel(room('lynx', undefined));
    cursorToDoor();
    select().disabled = false;
    select().value = 'ice';
    select().dispatchEvent(new Event('change', { bubbles: true }));
    expect(select().value).toBe('');
    expect(select().disabled).toBe(true);
  });

  it('drops the field when a resize clears the cursor cell of an Epoxy level', () => {
    editor.loadCompiledLevel(room(undefined, undefined));
    cursorToDoor();
    expect(field().classList.contains('hidden')).toBe(false);
    byId<HTMLInputElement>('editor-size-width').value = String(WIDTH + 2);
    byId<HTMLButtonElement>('editor-size-apply-btn').click();
    expect(editor.exportCompiledLevel().terrain[0].length).toBe(WIDTH + 2);
    expect(field().classList.contains('hidden')).toBe(true);
    expect(section().classList.contains('hidden')).toBe(true);
  });

  it('sorts the names with the collator of the current locale after a change of language', () => {
    editor.loadCompiledLevel(room(undefined, undefined));
    cursorToDoor();
    i18n.setLocale('fr');
    editor.refreshTranslations();
    const names = Array.from(select().options)
      .slice(1)
      .map((option) => option.textContent ?? '');
    expect(names).toEqual([...names].sort(new Intl.Collator('fr').compare));
  });

  it('is hidden on a CC3D level, which keeps its own list of layers', () => {
    editor.loadCompiledLevel(smallCc3dLevel());
    canvas.focus();
    press('ArrowRight');
    expect(field().classList.contains('hidden')).toBe(true);
    expect(section().classList.contains('hidden')).toBe(false);
    expect(byId('editor-layers-list').classList.contains('hidden')).toBe(false);
    expect(byId('editor-layers-cell').classList.contains('hidden')).toBe(false);
  });

  it('is disabled, with the reason, under Lynx rules', () => {
    editor.loadCompiledLevel(room('lynx', undefined));
    cursorToDoor();
    expect(field().classList.contains('hidden')).toBe(false);
    expect(select().disabled).toBe(true);
    expect(byId('editor-hidden-terrain-hint').textContent).toBe(t('editor.layout.layers.hidden_terrain.lynx.label'));
    // A change event that slips through does nothing.
    choose('ice');
    expect('underlays' in editor.exportCompiledLevel()).toBe(false);
  });

  it('is labelled, and its labels follow a change of language', () => {
    editor.loadCompiledLevel(room(undefined, HIDDEN));
    i18n.translateDOM();
    cursorToDoor();
    const label = document.querySelector<HTMLLabelElement>('label[for="editor-hidden-terrain"]');
    expect(label).not.toBeNull();
    expect(label?.textContent).toBe('Hidden terrain');
    expect(select().getAttribute('aria-describedby')).toBe('editor-hidden-terrain-hint');

    i18n.setLocale('fr');
    i18n.translateDOM();
    editor.refreshTranslations();
    expect(label?.textContent).toBe(t('editor.layout.layers.hidden_terrain.label'));
    expect(label?.textContent).not.toBe('Hidden terrain');
    expect(select().options[0].textContent).toBe(t('editor.layout.layers.hidden_terrain.none.label'));
    expect(select().options[0].textContent).not.toBe('None');
    expect(select().value).toBe('ice');
    expect(Array.from(select().options).some((option) => option.textContent === t('tiles.ice.name'))).toBe(true);
  });
});

describe('hidden terrain hint and stored-state badge', () => {
  const HINT_WORDS = {
    en: [/socket/, /dirt/, /fake wall/, /toggle wall/, /hold door/, /pressure plate/],
    fr: [/verrou de puces/, /terre meuble/, /faux mur/, /mur bascule/, /porte à plaque/, /plaque de pression/]
  } as const;
  const BADGE_ARG = 6;

  /** The state argument of the marker call drawn at the door cell. */
  function badgeAtDoor(): unknown {
    const call = markerCalls().find((c) => c[3] === DOOR_X * (c[5] as number) && c[4] === DOOR_Y * (c[5] as number));
    expect(call).toBeDefined();
    return call?.[BADGE_ARG];
  }

  it.each(['en', 'fr'] as const)('names what a key door or a socket can hide in the field hint (%s)', (locale) => {
    i18n.setLocale(locale);
    const hint = t('editor.layout.layers.hidden_terrain.hint.label');
    for (const word of HINT_WORDS[locale]) expect(hint, String(word)).toMatch(word);

    editor.loadCompiledLevel(room(undefined, undefined));
    editor.refreshTranslations();
    cursorToDoor();
    expect(byId('editor-hidden-terrain-hint').textContent).toBe(hint);
  });

  it('keeps the unavailable hint on the tops that can hide terrain', () => {
    for (const locale of ['en', 'fr'] as const) {
      i18n.setLocale(locale);
      expect(t('editor.layout.layers.hidden_terrain.unavailable.label').length).toBeGreaterThan(0);
    }
  });

  it.each([
    ['toggle_wall_closed', true],
    ['toggle_wall_open', false],
    ['toggle_wall_red_closed', true],
    ['toggle_wall_red_open', false],
    ['hold_door_red_closed', true],
    ['hold_door_red_open', false]
  ] as const)('passes the stored state of a hidden %s to the overlay', (terrain, closed) => {
    editor.loadCompiledLevel(room(undefined, [{ x: DOOR_X, y: DOOR_Y, terrain }]));
    expect(badgeAtDoor()).toBe(closed);
  });

  it.each(['ice', 'socket', 'dirt', 'blue_wall_fake', 'pressure_plate_red'])('passes no state for a hidden %s', (terrain) => {
    editor.loadCompiledLevel(room(undefined, [{ x: DOOR_X, y: DOOR_Y, terrain }]));
    expect(badgeAtDoor()).toBeUndefined();
  });

  it('needs no extra speech for the stored state: the name of the hidden tile already says open or closed', () => {
    for (const id of ['toggle_wall_closed', 'toggle_wall_open', 'hold_door_red_closed', 'hold_door_red_open']) {
      i18n.setLocale('en');
      expect(t(ConfigRegistry.getTile(id).i18nKey)).toMatch(/\((Open|Closed)\)/);
      i18n.setLocale('fr');
      expect(t(ConfigRegistry.getTile(id).i18nKey)).toMatch(/\((Ouvert|Ouverte|Fermé|Fermée)\)/);
    }
  });
});
