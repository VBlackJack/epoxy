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
import { LevelPackStorage } from '../storage/LevelPackStorage';
import { FakeIndexedDb } from '../test/FakeIndexedDb';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { mountModals } from '../test/domFixture';
import { LevelEditor } from './LevelEditor';

const WIDTH = 10;
const HEIGHT = 7;
const CELL_PX = 10;
const MECHANISMS_CATEGORY = 'mechanisms';
const TRIGGER = { x: 2, y: 2 };
const OTHER_TRIGGER = { x: 2, y: 4 };
const LAUNCHER = { x: 6, y: 2 };
const SECOND_LAUNCHER = { x: 6, y: 4 };

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
    id: 'lvl_launcher_wire_dom',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    customTitle: 'Launcher wire room',
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

function click(cell: { x: number; y: number }): void {
  canvas.dispatchEvent(
    new MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: (cell.x + 0.5) * CELL_PX, clientY: (cell.y + 0.5) * CELL_PX })
  );
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

const wireButton = (): HTMLButtonElement => paletteButton(t('editor.palette.tools.wire_launcher'));

function selectWire(): void {
  openMechanisms();
  wireButton().click();
}

function setDirection(dir: Direction): void {
  document.querySelector<HTMLButtonElement>(`#editor-dir-group [data-dir="${dir}"]`)?.click();
}

const terrainAt = (cell: { x: number; y: number }): string => editor.exportCompiledLevel().terrain[cell.y][cell.x];
const linksOf = (): LauncherLink[] | undefined => editor.exportCompiledLevel().launcherLinks;
const pending = (): unknown => editor['pendingWire'];

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

describe('the launcher wire entry', () => {
  it('ends the Lasers and mirrors group of the Mechanisms tab, with the shot trigger icon', () => {
    editor.loadCompiledLevel(room(undefined, []));
    openMechanisms();
    const button = wireButton();
    expect(button.getAttribute('aria-disabled')).toBeNull();
    expect(button.querySelector('img')?.getAttribute('src')).toBe('data:,tile-shot_trigger');
    const grid = byId('editor-palette-grid');
    const headings = Array.from(grid.querySelectorAll('h4'));
    const lasers = headings.find((heading) => heading.textContent === t('editor.palette.group.lasers.label'));
    expect(lasers).toBeDefined();
    let next = lasers?.nextElementSibling ?? null;
    let last: Element | null = null;
    while (next && next.tagName === 'BUTTON') {
      last = next;
      next = next.nextElementSibling;
    }
    expect(last).toBe(button);
  });

  it('is absent from the other tabs', () => {
    editor.loadCompiledLevel(room(undefined, []));
    const categories = ConfigRegistry.getTiles().categories;
    categories.forEach((cat, index) => {
      document.querySelectorAll<HTMLButtonElement>('#editor-category-tabs button')[index].click();
      const labels = Array.from(document.querySelectorAll('#editor-palette-grid .palette-item-label')).map((el) => el.textContent);
      expect(labels.includes(t('editor.palette.tools.wire_launcher')), cat.id).toBe(cat.id === MECHANISMS_CATEGORY);
    });
  });

  it('is greyed under Lynx with the reason, and a click on the map changes nothing', () => {
    editor.loadCompiledLevel(room('lynx', []));
    openMechanisms();
    const button = wireButton();
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.getAttribute('aria-description')).toBe(t('editor.palette.unavailable.epoxy_only.label'));
    button.click();
    expect(status()).toBe(t('editor.palette.unavailable.epoxy_only.label'));
    // Even with the brush forced, the application refuses.
    editor['brush'] = { kind: 'wire_launcher', id: 'wire_launcher' };
    click(TRIGGER);
    expect(terrainAt(TRIGGER)).toBe('floor');
    expect(pending()).toBeNull();
  });

  it('is absent from a CC3D palette', () => {
    editor.initBlankMap({ ruleset: 'cc3d' });
    for (const tab of Array.from(document.querySelectorAll<HTMLButtonElement>('#editor-category-tabs button'))) {
      tab.click();
      const labels = Array.from(document.querySelectorAll('#editor-palette-grid .palette-item-label')).map((el) => el.textContent);
      expect(labels).not.toContain(t('editor.palette.tools.wire_launcher'));
    }
  });

  it('names the entry in French', () => {
    i18n.setLocale('fr');
    editor.loadCompiledLevel(room(undefined, []));
    openMechanisms();
    expect(wireButton().querySelector('.palette-item-label')?.textContent).toBe(t('editor.palette.tools.wire_launcher'));
    expect(t('editor.palette.tools.wire_launcher')).not.toBe('editor.palette.tools.wire_launcher');
  });
});

describe('wiring a trigger to launchers', () => {
  it('says what to click when the entry is chosen', () => {
    editor.loadCompiledLevel(room(undefined, []));
    selectWire();
    expect(status()).toBe(t('editor.palette.status.wire_launcher_select_source.label'));
  });

  it('places a trigger, then launchers facing the direction control, in one undo step each', () => {
    editor.loadCompiledLevel(room(undefined, []));
    selectWire();
    click(TRIGGER);
    expect(terrainAt(TRIGGER)).toBe('shot_trigger');
    expect(pending()).toEqual({ kind: 'launcher', x: TRIGGER.x, y: TRIGGER.y });
    expect(status()).toBe(t('editor.palette.status.wire_launcher_picked.label', { count: 0 }));

    setDirection('E');
    click(LAUNCHER);
    expect(terrainAt(LAUNCHER)).toBe('shot_launcher_e');
    expect(linksOf()).toEqual([link(TRIGGER, LAUNCHER)]);
    expect(status()).toBe(t('editor.layout.status.wire_launcher_linked.label', { count: 1 }));

    setDirection('N');
    click(SECOND_LAUNCHER);
    expect(terrainAt(SECOND_LAUNCHER)).toBe('shot_launcher_n');
    expect(linksOf()).toEqual([link(TRIGGER, LAUNCHER), link(TRIGGER, SECOND_LAUNCHER)]);
    expect(pending()).not.toBeNull();

    // Three changes, three history steps.
    editor.undo();
    expect(linksOf()).toEqual([link(TRIGGER, LAUNCHER)]);
    expect(terrainAt(SECOND_LAUNCHER)).toBe('floor');
    editor.undo();
    expect(linksOf()).toBeUndefined();
    expect(terrainAt(LAUNCHER)).toBe('floor');
    expect(terrainAt(TRIGGER)).toBe('shot_trigger');
    editor.undo();
    expect(terrainAt(TRIGGER)).toBe('floor');
    expect(editor['history'].canUndo()).toBe(false);
  });

  it('picks an existing trigger without changing the map, and links an existing launcher keeping its facing', () => {
    editor.loadCompiledLevel(room(undefined, [{ ...TRIGGER, tile: 'shot_trigger' }, { ...LAUNCHER, tile: 'shot_launcher_w' }]));
    selectWire();
    click(TRIGGER);
    expect(pending()).toEqual({ kind: 'launcher', x: TRIGGER.x, y: TRIGGER.y });
    expect(editor['history'].canUndo()).toBe(false);
    setDirection('S');
    click(LAUNCHER);
    expect(terrainAt(LAUNCHER)).toBe('shot_launcher_w');
    expect(linksOf()).toEqual([link(TRIGGER, LAUNCHER)]);
  });

  it('unlinks a launcher that is linked already and keeps the wire open', () => {
    editor.loadCompiledLevel(
      room(undefined, [{ ...TRIGGER, tile: 'shot_trigger' }, { ...LAUNCHER, tile: 'shot_launcher_w' }, { ...SECOND_LAUNCHER, tile: 'shot_launcher_w' }], [
        link(TRIGGER, LAUNCHER),
        link(TRIGGER, SECOND_LAUNCHER)
      ])
    );
    selectWire();
    click(TRIGGER);
    expect(status()).toBe(t('editor.palette.status.wire_launcher_picked.label', { count: 2 }));
    click(LAUNCHER);
    expect(linksOf()).toEqual([link(TRIGGER, SECOND_LAUNCHER)]);
    expect(terrainAt(LAUNCHER)).toBe('shot_launcher_w');
    expect(status()).toBe(t('editor.layout.status.wire_launcher_unlinked.label', { count: 1 }));
    expect(pending()).not.toBeNull();
    // Linking it again is another step.
    click(LAUNCHER);
    expect(linksOf()).toEqual([link(TRIGGER, LAUNCHER), link(TRIGGER, SECOND_LAUNCHER)]);
  });

  it('switches to another trigger when one is clicked, and finishes when the trigger is clicked again', () => {
    editor.loadCompiledLevel(
      room(undefined, [{ ...TRIGGER, tile: 'shot_trigger' }, { ...OTHER_TRIGGER, tile: 'shot_trigger' }, { ...LAUNCHER, tile: 'shot_launcher_w' }], [
        link(OTHER_TRIGGER, LAUNCHER)
      ])
    );
    selectWire();
    click(TRIGGER);
    click(OTHER_TRIGGER);
    expect(pending()).toEqual({ kind: 'launcher', x: OTHER_TRIGGER.x, y: OTHER_TRIGGER.y });
    // The first trigger stays unlinked: the switch says so before naming the new pick.
    expect(status()).toContain(t('editor.layout.status.wire_launcher_trigger_left.label'));
    expect(status()).toContain(t('editor.palette.status.wire_launcher_picked.label', { count: 1 }));
    expect(editor['history'].canUndo()).toBe(false);
    click(OTHER_TRIGGER);
    expect(pending()).toBeNull();
    expect(status()).toBe(t('editor.layout.status.wire_launcher_done.label', { count: 1 }));
  });

  it('refuses to start the wire from a launcher', () => {
    editor.loadCompiledLevel(room(undefined, [{ ...LAUNCHER, tile: 'shot_launcher_w' }]));
    selectWire();
    click(LAUNCHER);
    expect(pending()).toBeNull();
    expect(status()).toBe(t('editor.layout.status.wire_launcher_start_on_trigger.label'));
    expect(terrainAt(LAUNCHER)).toBe('shot_launcher_w');
  });

  it('starts from a trigger hidden under a door, and links a launcher hidden under one', () => {
    const level = room(undefined, [{ ...TRIGGER, tile: 'door_red' }, { ...LAUNCHER, tile: 'door_red' }]);
    level.underlays = [
      { x: TRIGGER.x, y: TRIGGER.y, terrain: 'shot_trigger' },
      { x: LAUNCHER.x, y: LAUNCHER.y, terrain: 'shot_launcher_w' }
    ];
    editor.loadCompiledLevel(level);
    selectWire();
    click(TRIGGER);
    expect(pending()).toEqual({ kind: 'launcher', x: TRIGGER.x, y: TRIGGER.y });
    expect(terrainAt(TRIGGER)).toBe('door_red');
    click(LAUNCHER);
    expect(terrainAt(LAUNCHER)).toBe('door_red');
    expect(linksOf()).toEqual([link(TRIGGER, LAUNCHER)]);
  });

  it('keeps a stroke of one click: dragging the pointer over cells links nothing more', () => {
    editor.loadCompiledLevel(room(undefined, [{ ...TRIGGER, tile: 'shot_trigger' }]));
    selectWire();
    click(TRIGGER);
    canvas.dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: (LAUNCHER.x + 0.5) * CELL_PX, clientY: (LAUNCHER.y + 0.5) * CELL_PX })
    );
    for (const x of [LAUNCHER.x + 1, LAUNCHER.x + 2]) {
      canvas.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, cancelable: true, clientX: (x + 0.5) * CELL_PX, clientY: (LAUNCHER.y + 0.5) * CELL_PX }));
    }
    window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    expect(linksOf()).toEqual([link(TRIGGER, LAUNCHER)]);
    expect(terrainAt({ x: LAUNCHER.x + 1, y: LAUNCHER.y })).toBe('floor');
  });
});

describe('finishing and dropping the launcher wire', () => {
  it('finishes with Escape and says how many launchers the trigger fires', () => {
    editor.loadCompiledLevel(room(undefined, [{ ...TRIGGER, tile: 'shot_trigger' }, { ...LAUNCHER, tile: 'shot_launcher_w' }], [link(TRIGGER, LAUNCHER)]));
    selectWire();
    click(TRIGGER);
    editor.handleKeyAction({ kind: 'cancel' });
    expect(pending()).toBeNull();
    expect(status()).toBe(t('editor.layout.status.wire_launcher_done.label', { count: 1 }));
    expect(linksOf()).toEqual([link(TRIGGER, LAUNCHER)]);
  });

  it('says the trigger stays unlinked when the wire is dropped before any launcher', () => {
    editor.loadCompiledLevel(room(undefined, []));
    selectWire();
    click(TRIGGER);
    editor.handleKeyAction({ kind: 'cancel' });
    expect(pending()).toBeNull();
    expect(status()).toBe(t('editor.layout.status.wire_launcher_trigger_left.label'));
    expect(terrainAt(TRIGGER)).toBe('shot_trigger');
  });

  it('drops a wire silently when the tool changes while the trigger has links', () => {
    editor.loadCompiledLevel(room(undefined, [{ ...TRIGGER, tile: 'shot_trigger' }, { ...LAUNCHER, tile: 'shot_launcher_w' }], [link(TRIGGER, LAUNCHER)]));
    selectWire();
    click(TRIGGER);
    editor.setTool('eraser');
    expect(pending()).toBeNull();
    expect(status()).not.toBe(t('editor.layout.status.wire_launcher_trigger_left.label'));
  });

  it('drops the open wire when its hidden trigger is cleared from under the door', () => {
    const level = room(undefined, [{ ...TRIGGER, tile: 'door_red' }]);
    level.underlays = [{ x: TRIGGER.x, y: TRIGGER.y, terrain: 'shot_trigger' }];
    editor.loadCompiledLevel(level);
    selectWire();
    click(TRIGGER);
    expect(pending()).not.toBeNull();
    editor['cursorCell'] = { ...TRIGGER };
    editor['setHiddenTerrain']('');
    expect(pending()).toBeNull();
  });

  it('says nothing about a wire when none is open', () => {
    editor.loadCompiledLevel(room(undefined, []));
    selectWire();
    const before = status();
    editor.handleKeyAction({ kind: 'cancel' });
    expect(status()).toBe(before);
  });

  it('clears the open wire on undo, with the message when the trigger is left unlinked', () => {
    editor.loadCompiledLevel(room(undefined, []));
    selectWire();
    click(TRIGGER);
    click(LAUNCHER);
    expect(pending()).not.toBeNull();
    editor.undo();
    expect(pending()).toBeNull();
    expect(status()).toBe(t('editor.layout.status.wire_launcher_trigger_left.label'));
    expect(terrainAt(TRIGGER)).toBe('shot_trigger');
  });

  it('says the trigger is gone when it was erased while the wire was open', () => {
    editor.loadCompiledLevel(room(undefined, [{ ...TRIGGER, tile: 'shot_trigger' }, { ...LAUNCHER, tile: 'shot_launcher_w' }]));
    selectWire();
    click(TRIGGER);
    // The map changes under the open wire (a pasted level, an undo...): the next click finds no trigger.
    editor['doc'] = { ...editor['doc'], terrain: editor['doc'].terrain.map((row, y) => (y === TRIGGER.y ? row.map((id, x) => (x === TRIGGER.x ? 'floor' : id)) : row)) };
    click(LAUNCHER);
    expect(status()).toBe(t('editor.layout.status.wire_missing_button'));
    expect(pending()).toBeNull();
    expect(linksOf()).toBeUndefined();
  });
});

describe('the launcher wire from the keyboard', () => {
  it('uses Enter on the cursor cell and the direction control for the facing of a new launcher', () => {
    editor.loadCompiledLevel(room(undefined, []));
    selectWire();
    canvas.focus();
    editor['cursorCell'] = { ...TRIGGER };
    press('Enter');
    expect(terrainAt(TRIGGER)).toBe('shot_trigger');
    setDirection('W');
    canvas.focus();
    editor['cursorCell'] = { ...LAUNCHER };
    press(' ');
    expect(terrainAt(LAUNCHER)).toBe('shot_launcher_w');
    expect(linksOf()).toEqual([link(TRIGGER, LAUNCHER)]);
    press('Escape');
    editor.handleKeyAction({ kind: 'cancel' });
    expect(status()).toBe(t('editor.layout.status.wire_launcher_done.label', { count: 1 }));
  });
});

describe('launcher links and the other tools', () => {
  it('keeps the links of a launcher painted over by another facing, and drops them for another kind of tile', () => {
    editor.loadCompiledLevel(
      room(undefined, [{ ...TRIGGER, tile: 'shot_trigger' }, { ...LAUNCHER, tile: 'shot_launcher_w' }], [link(TRIGGER, LAUNCHER)])
    );
    openMechanisms();
    paletteButton(t('tiles.shot_launcher_n.name')).click();
    click(LAUNCHER);
    expect(terrainAt(LAUNCHER)).toBe('shot_launcher_n');
    expect(linksOf()).toEqual([link(TRIGGER, LAUNCHER)]);
    paletteButton(t('tiles.shot_trigger.name')).click();
    click(LAUNCHER);
    expect(terrainAt(LAUNCHER)).toBe('shot_trigger');
    expect(linksOf()).toBeUndefined();
    expect(status()).toContain(t('editor.layout.status.links_removed', { count: 1 }));
  });

  it('exports the links it drew and reopens them', () => {
    editor.loadCompiledLevel(room(undefined, []));
    selectWire();
    click(TRIGGER);
    click(LAUNCHER);
    const exported = editor.exportCompiledLevel();
    expect(exported.launcherLinks).toEqual([link(TRIGGER, LAUNCHER)]);
    editor.loadCompiledLevel(exported);
    expect(linksOf()).toEqual([link(TRIGGER, LAUNCHER)]);
  });

  it('locks the Lynx choice once a trigger is placed', () => {
    editor.loadCompiledLevel(room(undefined, []));
    selectWire();
    click(TRIGGER);
    const lynx = Array.from(byId<HTMLSelectElement>('editor-meta-ruleset').options).find((option) => option.value === 'lynx');
    expect(lynx?.disabled).toBe(true);
  });

  it('rejects the wire entry as a fill brush with the unsupported message', () => {
    editor.loadCompiledLevel(room(undefined, []));
    selectWire();
    document.querySelector<HTMLButtonElement>('.editor-tool-btn[data-tool="fill"]')?.click();
    click({ x: 3, y: 3 });
    expect(status()).toBe(t('editor.layout.status.fill_needs_terrain'));
    expect(terrainAt({ x: 3, y: 3 })).toBe('floor');
  });
});

describe('the validator warning and the issue list', () => {
  const triggerWarning = (): string => t('validator.issues.shot_trigger_no_link.label', { x: TRIGGER.x, y: TRIGGER.y });
  const rows = (): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>('#editor-issues-list .editor-issue-row'));

  it('goes away once the trigger is wired, and the row of the warning jumps to the trigger', () => {
    editor.loadCompiledLevel(room(undefined, [{ ...TRIGGER, tile: 'shot_trigger' }, { ...LAUNCHER, tile: 'shot_launcher_w' }]));
    byId<HTMLButtonElement>('editor-validate-btn').click();
    const warning = rows().find((row) => row.textContent?.includes(triggerWarning()));
    expect(warning).toBeDefined();
    expect(warning?.tagName).toBe('BUTTON');
    warning?.click();
    expect(byId('editor-coords-badge').textContent).toBe(t('editor.palette.status.coords', TRIGGER));

    selectWire();
    click(TRIGGER);
    click(LAUNCHER);
    byId<HTMLButtonElement>('editor-validate-btn').click();
    expect(rows().some((row) => row.textContent?.includes(triggerWarning()))).toBe(false);
  });
});
