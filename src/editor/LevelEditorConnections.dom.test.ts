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

import type { CompiledLevel, LauncherLink, TrapLink } from '../core/types';
import { i18n, t } from '../i18n/I18nManager';
import { LevelPackStorage } from '../storage/LevelPackStorage';
import { FakeIndexedDb } from '../test/FakeIndexedDb';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { mountModals } from '../test/domFixture';
import { EDITOR_CONNECTIONS_HOVER_DWELL_MS } from '../ui/uiConstants';
import { smallCc3dLevel } from './cc3dEditorFixtures';
import { LevelEditor } from './LevelEditor';

const WIDTH = 10;
const HEIGHT = 7;
const CELL_PX = 10;
const SECTIONS_KEY_FRAGMENT = 'editor_sections';
const BUTTON = { x: 3, y: 2 };
const TRAP = { x: 6, y: 2 };
const SECOND_TRAP = { x: 6, y: 4 };
const RED_BUTTON = { x: 3, y: 5 };
const MACHINE = { x: 7, y: 5 };
const TRIGGER = { x: 2, y: 3 };
const LAUNCHER = { x: 8, y: 3 };

const fake = new FakeIndexedDb();
let editor: LevelEditor;
let canvas: HTMLCanvasElement;
let store: Map<string, string>;

const noopContext = (): CanvasRenderingContext2D =>
  new Proxy(() => undefined, { get: () => noopContext(), set: () => true, apply: () => undefined }) as unknown as CanvasRenderingContext2D;

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element ${id}`);
  return el as T;
}

const status = (): string => byId('editor-status-bar').textContent ?? '';
const caption = (): string => byId('editor-connections-cell').textContent ?? '';
const section = (): HTMLDetailsElement => byId<HTMLDetailsElement>('editor-connections-section');
const linkButton = (): HTMLButtonElement => byId<HTMLButtonElement>('editor-connections-link-btn');
const rowsOf = (listId: string): HTMLElement[] => Array.from(byId(listId).querySelectorAll<HTMLElement>('.editor-connection-row'));
const controlRows = (): HTMLElement[] => rowsOf('editor-connections-controls');
const controlledRows = (): HTMLElement[] => rowsOf('editor-connections-controlled');
const unlinkButtonOf = (row: HTMLElement): HTMLButtonElement => {
  const button = row.querySelector<HTMLButtonElement>('button:not(.editor-connection-goto)');
  if (!button) throw new Error('Row has no Unlink button');
  return button;
};

/** A walled room with the given terrain, plus whatever links and entities the case needs. */
function room(
  placed: Array<{ x: number; y: number; tile: string }>,
  extra: {
    trapLinks?: TrapLink[];
    cloneLinks?: CompiledLevel['cloneLinks'];
    launcherLinks?: LauncherLink[];
    entities?: CompiledLevel['entities'];
    underlays?: CompiledLevel['underlays'];
    ruleset?: CompiledLevel['ruleset'];
  } = {}
): CompiledLevel {
  const terrain: string[][] = Array.from({ length: HEIGHT }, (_, y) =>
    Array.from({ length: WIDTH }, (_, x) => (x === 0 || y === 0 || x === WIDTH - 1 || y === HEIGHT - 1 ? 'wall' : 'floor'))
  );
  terrain[HEIGHT - 2][WIDTH - 2] = 'exit';
  for (const cell of placed) terrain[cell.y][cell.x] = cell.tile;
  return {
    id: 'lvl_connections_dom',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    customTitle: 'Connections room',
    ruleset: extra.ruleset,
    playerStart: { x: 1, y: 1, dir: 'S' },
    terrain,
    items: terrain.map((row) => row.map(() => null as string | null)),
    entities: extra.entities ?? [],
    trapLinks: extra.trapLinks ?? [],
    cloneLinks: extra.cloneLinks ?? [],
    ...(extra.launcherLinks ? { launcherLinks: extra.launcherLinks } : {}),
    ...(extra.underlays ? { underlays: extra.underlays } : {})
  };
}

const trapRoom = (links: TrapLink[] = [{ buttonX: BUTTON.x, buttonY: BUTTON.y, trapX: TRAP.x, trapY: TRAP.y }]): CompiledLevel =>
  room(
    [
      { ...BUTTON, tile: 'button_brown' },
      { ...TRAP, tile: 'trap' },
      { ...SECOND_TRAP, tile: 'trap' }
    ],
    { trapLinks: links }
  );

function pointerAt(type: string, cell: { x: number; y: number }): void {
  canvas.dispatchEvent(
    new MouseEvent(type, { bubbles: true, cancelable: true, clientX: (cell.x + 0.5) * CELL_PX, clientY: (cell.y + 0.5) * CELL_PX })
  );
}

function click(cell: { x: number; y: number }): void {
  pointerAt('pointerdown', cell);
  window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
}

/** Moves the pointer over a cell and draws, as the next animation frame would. */
function hover(cell: { x: number; y: number }): void {
  pointerAt('pointermove', cell);
  editor.render();
}

function leaveCanvas(): void {
  canvas.dispatchEvent(new Event('pointerleave'));
  editor.render();
}

/** Lets time pass (fake timers must be on) and draws, as the next animation frame would. */
function dwell(ms: number = EDITOR_CONNECTIONS_HOVER_DWELL_MS): void {
  vi.advanceTimersByTime(ms);
  editor.render();
}

/** Puts the keyboard cursor on a cell without painting. */
function cursorTo(cell: { x: number; y: number }): void {
  editor['moveCursorTo'](cell, false);
}

const levelNow = (): CompiledLevel => editor.exportCompiledLevel();

beforeEach(() => {
  loadTestConfigs();
  i18n.setLocale('en');
  fake.records.clear();
  store = new Map<string, string>();
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
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await LevelPackStorage.closeConnection();
});

describe('the Connections section', () => {
  it('is shown for an Epoxy level and for a CC3D one, which adds the line saying its links are derived', () => {
    const derived = (): HTMLElement => byId('editor-connections-derived');
    editor.loadCompiledLevel(trapRoom());
    expect(section().classList.contains('hidden')).toBe(false);
    expect(section().open).toBe(true);
    expect(derived().classList.contains('hidden')).toBe(true);
    editor.loadCompiledLevel(smallCc3dLevel());
    expect(section().classList.contains('hidden')).toBe(false);
    expect(derived().classList.contains('hidden')).toBe(false);
    expect(derived().textContent).toBe(t('editor.connections.cc3d_derived.label'));
    editor.loadCompiledLevel(trapRoom());
    expect(section().classList.contains('hidden')).toBe(false);
    expect(derived().classList.contains('hidden')).toBe(true);
  });

  it('asks for a cell until there is one, then follows the keyboard cursor', () => {
    editor.loadCompiledLevel(trapRoom());
    expect(caption()).toBe(t('editor.connections.no_cell'));
    cursorTo(BUTTON);
    expect(caption()).toBe(t('editor.connections.cell', { x: BUTTON.x, y: BUTTON.y, name: t('editor.connections.role.trap_button.label') }));
    const rows = controlRows();
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector('.editor-connection-goto')?.textContent).toContain(`(${TRAP.x}, ${TRAP.y})`);
    expect(rows[1].querySelector('.editor-connection-goto')?.textContent).toContain(t('editor.connections.kind.fallback'));
    expect(byId('editor-connections-note').textContent).toBe(t('editor.connections.fallback.trap_button'));
    cursorTo(TRAP);
    expect(controlledRows()).toHaveLength(1);
    expect(byId('editor-connections-note').textContent).toBe(t('editor.connections.fallback.trap_linked'));
  });

  it('follows the pointer after a short pause, and keeps that cell when the pointer leaves the map', () => {
    vi.useFakeTimers();
    editor.loadCompiledLevel(trapRoom());
    cursorTo(BUTTON);
    hover(TRAP);
    // Before the pause the section still shows the keyboard cursor's cell.
    expect(caption()).toContain(`(${BUTTON.x}, ${BUTTON.y})`);
    dwell();
    expect(caption()).toContain(`(${TRAP.x}, ${TRAP.y})`);
    expect(caption()).toContain(t('editor.connections.role.trap.label'));
    leaveCanvas();
    dwell();
    expect(caption()).toContain(`(${TRAP.x}, ${TRAP.y})`);
  });

  it('does not retarget while the pointer crosses cells faster than the pause', () => {
    vi.useFakeTimers();
    editor.loadCompiledLevel(trapRoom());
    cursorTo(BUTTON);
    hover(TRAP);
    dwell(EDITOR_CONNECTIONS_HOVER_DWELL_MS - 100);
    hover(SECOND_TRAP);
    dwell(EDITOR_CONNECTIONS_HOVER_DWELL_MS - 100);
    // The first cell's pause was restarted by the second, which has not run its course either.
    expect(caption()).toContain(`(${BUTTON.x}, ${BUTTON.y})`);
    dwell(100);
    expect(caption()).toContain(`(${SECOND_TRAP.x}, ${SECOND_TRAP.y})`);
  });

  it('gives the section back to the keyboard cursor on a key move, even before the pause is over', () => {
    vi.useFakeTimers();
    editor.loadCompiledLevel(trapRoom());
    cursorTo(BUTTON);
    hover(TRAP);
    dwell();
    expect(caption()).toContain(`(${TRAP.x}, ${TRAP.y})`);
    cursorTo({ x: 4, y: 4 });
    expect(caption()).toContain('(4, 4)');
    hover(TRAP);
    cursorTo({ x: 5, y: 4 });
    dwell();
    expect(caption()).toContain('(5, 4)');
    expect(editor['connectionsDwellTimer']).toBeNull();
  });

  it('gives the section back to the clicked cell on a click', () => {
    vi.useFakeTimers();
    editor.loadCompiledLevel(trapRoom());
    cursorTo(BUTTON);
    hover(TRAP);
    dwell();
    click(SECOND_TRAP);
    expect(caption()).toContain(`(${SECOND_TRAP.x}, ${SECOND_TRAP.y})`);
    leaveCanvas();
    dwell();
    expect(caption()).toContain(`(${SECOND_TRAP.x}, ${SECOND_TRAP.y})`);
  });

  it('keeps its cell while the focus is inside, and takes the map cell back when the focus leaves', () => {
    vi.useFakeTimers();
    editor.loadCompiledLevel(trapRoom());
    cursorTo(BUTTON);
    const go = controlRows()[0].querySelector<HTMLButtonElement>('.editor-connection-goto');
    go?.focus();
    expect(section().contains(document.activeElement)).toBe(true);
    hover(TRAP);
    dwell();
    expect(caption()).toContain(`(${BUTTON.x}, ${BUTTON.y})`);
    canvas.focus();
    editor.render();
    expect(caption()).toContain(`(${TRAP.x}, ${TRAP.y})`);
  });

  it('keeps its cell while the pointer is over the section, and catches up when the pointer leaves it', () => {
    vi.useFakeTimers();
    editor.loadCompiledLevel(trapRoom());
    cursorTo(BUTTON);
    section().dispatchEvent(new Event('pointerenter'));
    hover(TRAP);
    dwell();
    expect(caption()).toContain(`(${BUTTON.x}, ${BUTTON.y})`);
    section().dispatchEvent(new Event('pointerleave'));
    expect(caption()).toContain(`(${TRAP.x}, ${TRAP.y})`);
  });

  it('forgets the pointer cell and its pause when another level loads, and when the editor is disposed', () => {
    vi.useFakeTimers();
    editor.loadCompiledLevel(trapRoom());
    hover(TRAP);
    dwell();
    expect(editor['connectionsPointerCell']).not.toBeNull();
    hover(BUTTON);
    expect(editor['connectionsDwellTimer']).not.toBeNull();
    editor.loadCompiledLevel(trapRoom());
    expect(editor['connectionsPointerCell']).toBeNull();
    expect(editor['connectionsDwellTimer']).toBeNull();
    hover(TRAP);
    editor.dispose();
    expect(editor['connectionsDwellTimer']).toBeNull();
    expect(editor['connectionsPointerCell']).toBeNull();
  });

  it('draws again when the ruleset changes: Lynx says where the connections are listed, Epoxy lists them again', () => {
    editor.loadCompiledLevel(trapRoom());
    cursorTo(BUTTON);
    expect(controlRows()).toHaveLength(2);
    const select = byId<HTMLSelectElement>('editor-meta-ruleset');
    select.value = 'lynx';
    select.dispatchEvent(new Event('input', { bubbles: true }));
    expect(byId('editor-connections-note').textContent).toBe(t('editor.connections.epoxy_only'));
    expect(byId('editor-connections-lists').classList.contains('hidden')).toBe(true);
    select.value = 'epoxy';
    select.dispatchEvent(new Event('input', { bubbles: true }));
    expect(controlRows()).toHaveLength(2);
    expect(byId('editor-connections-lists').classList.contains('hidden')).toBe(false);
  });

  it('moves the cursor to the cell of a row and gives the canvas the focus', () => {
    editor.loadCompiledLevel(trapRoom());
    cursorTo(BUTTON);
    const focus = vi.spyOn(canvas, 'focus');
    controlRows()[0].querySelector<HTMLButtonElement>('.editor-connection-goto')?.click();
    expect(byId('editor-coords-badge').textContent).toBe(t('editor.palette.status.coords', TRAP));
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(caption()).toContain(`(${TRAP.x}, ${TRAP.y})`);
  });

  it('draws again in the new language', () => {
    editor.loadCompiledLevel(trapRoom());
    cursorTo(BUTTON);
    i18n.setLocale('fr');
    editor.refreshTranslations();
    expect(caption()).toContain(t('editor.connections.role.trap_button.label'));
    expect(caption().startsWith('Case')).toBe(true);
    expect(byId('editor-connections-note').textContent).toBe(t('editor.connections.fallback.trap_button'));
    i18n.setLocale('en');
  });

  it('keeps its open state from one editor to the next', () => {
    editor.loadCompiledLevel(trapRoom());
    section().open = false;
    section().dispatchEvent(new Event('toggle'));
    const stored = Array.from(store.entries()).find(([name]) => name.toLowerCase().includes(SECTIONS_KEY_FRAGMENT));
    expect(JSON.parse(stored?.[1] ?? '{}')).toMatchObject({ connections: false });
    editor.buildUI();
    expect(section().open).toBe(false);
  });

  it('does not redraw during a stroke, and once when it ends', () => {
    vi.useFakeTimers();
    editor.loadCompiledLevel(trapRoom());
    cursorTo(BUTTON);
    hover({ x: 4, y: 4 });
    dwell();
    const before = caption();
    expect(before).toContain('(4, 4)');
    pointerAt('pointerdown', { x: 4, y: 4 });
    pointerAt('pointermove', { x: 5, y: 4 });
    editor.render();
    pointerAt('pointermove', { x: 6, y: 4 });
    dwell();
    expect(caption()).toBe(before);
    window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    expect(caption()).toContain('(6, 4)');
  });

  it('says under Lynx rules where the connections are listed, with no list but a Link button for traps and clone machines', () => {
    editor.loadCompiledLevel(room([{ ...BUTTON, tile: 'button_brown' }, { ...TRAP, tile: 'trap' }], { ruleset: 'lynx' }));
    cursorTo(BUTTON);
    expect(byId('editor-connections-note').textContent).toBe(t('editor.connections.epoxy_only'));
    expect(byId('editor-connections-lists').classList.contains('hidden')).toBe(true);
    expect(linkButton().classList.contains('hidden')).toBe(false);
    cursorTo(TRAP);
    expect(linkButton().classList.contains('hidden')).toBe(false);
    cursorTo({ x: 4, y: 4 });
    expect(linkButton().classList.contains('hidden')).toBe(true);
  });
});

describe('Unlink', () => {
  const twoLinks = (): TrapLink[] => [
    { buttonX: BUTTON.x, buttonY: BUTTON.y, trapX: TRAP.x, trapY: TRAP.y },
    { buttonX: BUTTON.x, buttonY: BUTTON.y, trapX: SECOND_TRAP.x, trapY: SECOND_TRAP.y }
  ];

  it('is offered on a link row only, with the name and cell in its label', () => {
    editor.loadCompiledLevel(trapRoom());
    cursorTo(BUTTON);
    const rows = controlRows();
    expect(rows[0].querySelectorAll('button')).toHaveLength(2);
    expect(rows[1].querySelectorAll('button')).toHaveLength(1);
    expect(unlinkButtonOf(rows[0]).getAttribute('aria-label')).toBe(
      t('editor.connections.unlink.aria', { name: t('editor.connections.role.trap.label'), x: TRAP.x, y: TRAP.y })
    );
  });

  it('removes the link as one undo step, says so, and says what the trap does now', () => {
    editor.loadCompiledLevel(trapRoom());
    cursorTo(BUTTON);
    unlinkButtonOf(controlRows()[0]).click();
    expect(levelNow().trapLinks).toEqual([]);
    expect(status()).toContain(t('editor.connections.unlink.suffix_trap'));
    expect(status()).toContain(`(${TRAP.x}, ${TRAP.y})`);
    expect(controlRows().every((row) => row.querySelectorAll('button').length === 1)).toBe(true);
    expect(byId('editor-connections-note').textContent).toBe(t('editor.connections.fallback.trap_button'));
    editor.undo();
    expect(levelNow().trapLinks).toHaveLength(1);
    expect(controlRows()[0].querySelectorAll('button')).toHaveLength(2);
  });

  it('leaves out the suffix while another button still opens the trap', () => {
    editor.loadCompiledLevel(
      room(
        [
          { ...BUTTON, tile: 'button_brown' },
          { x: 3, y: 4, tile: 'button_brown' },
          { ...TRAP, tile: 'trap' }
        ],
        {
          trapLinks: [
            { buttonX: BUTTON.x, buttonY: BUTTON.y, trapX: TRAP.x, trapY: TRAP.y },
            { buttonX: 3, buttonY: 4, trapX: TRAP.x, trapY: TRAP.y }
          ]
        }
      )
    );
    cursorTo(BUTTON);
    unlinkButtonOf(controlRows()[0]).click();
    expect(levelNow().trapLinks).toHaveLength(1);
    expect(status()).not.toContain(t('editor.connections.unlink.suffix_trap'));
  });

  it('keeps the focus on the same row index when an unlinked trap stays listed as a fallback', () => {
    editor.loadCompiledLevel(trapRoom(twoLinks()));
    cursorTo(BUTTON);
    const first = unlinkButtonOf(controlRows()[0]);
    first.focus();
    first.click();
    // The trap is now opened by any brown button: its row stays, without an Unlink.
    const rows = controlRows();
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelectorAll('button')).toHaveLength(1);
    expect(document.activeElement).toBe(rows[0].querySelector('.editor-connection-goto'));
  });

  it('gives the focus to the row above when the last row goes, else to the caption', () => {
    const second = { x: 8, y: 4 };
    editor.loadCompiledLevel(
      room(
        [
          { ...TRIGGER, tile: 'shot_trigger' },
          { ...LAUNCHER, tile: 'shot_launcher_w' },
          { ...second, tile: 'shot_launcher_w' }
        ],
        {
          launcherLinks: [
            { buttonX: TRIGGER.x, buttonY: TRIGGER.y, launcherX: LAUNCHER.x, launcherY: LAUNCHER.y },
            { buttonX: TRIGGER.x, buttonY: TRIGGER.y, launcherX: second.x, launcherY: second.y }
          ]
        }
      )
    );
    cursorTo(TRIGGER);
    const last = unlinkButtonOf(controlRows()[1]);
    last.focus();
    last.click();
    const remaining = controlRows();
    expect(remaining).toHaveLength(1);
    expect(document.activeElement).toBe(unlinkButtonOf(remaining[0]));
    expect(document.activeElement?.getAttribute('aria-label')).toContain(`(${LAUNCHER.x}, ${LAUNCHER.y})`);
    (document.activeElement as HTMLElement).click();
    expect(controlRows()).toHaveLength(0);
    expect(document.activeElement).toBe(byId('editor-connections-cell'));
  });

  it('tells a red button that now fires every machine with a creature', () => {
    editor.loadCompiledLevel(
      room(
        [
          { ...RED_BUTTON, tile: 'button_red' },
          { ...MACHINE, tile: 'clone_machine' }
        ],
        {
          entities: [{ x: MACHINE.x, y: MACHINE.y, type: 'walker', dir: 'S' }],
          cloneLinks: [
            { buttonX: RED_BUTTON.x, buttonY: RED_BUTTON.y, clonerX: MACHINE.x, clonerY: MACHINE.y, templateType: 'walker', templateDir: 'S' }
          ]
        }
      )
    );
    cursorTo(RED_BUTTON);
    unlinkButtonOf(controlRows()[0]).click();
    expect(levelNow().cloneLinks).toEqual([]);
    expect(status()).toContain(t('editor.connections.unlink.suffix_clone'));
  });

  it('tells a red button that now fires nothing when no machine holds a creature', () => {
    editor.loadCompiledLevel(
      room(
        [
          { ...RED_BUTTON, tile: 'button_red' },
          { ...MACHINE, tile: 'clone_machine' }
        ],
        {
          cloneLinks: [
            { buttonX: RED_BUTTON.x, buttonY: RED_BUTTON.y, clonerX: MACHINE.x, clonerY: MACHINE.y, templateType: 'walker', templateDir: 'S' }
          ]
        }
      )
    );
    cursorTo(RED_BUTTON);
    unlinkButtonOf(controlRows()[0]).click();
    expect(levelNow().cloneLinks).toEqual([]);
    expect(status()).toContain(t('editor.connections.unlink.suffix_clone_none'));
    expect(status()).not.toContain(t('editor.connections.unlink.suffix_clone'));
  });

  it('unlinks a launcher from the launcher end, as one undo step', () => {
    editor.loadCompiledLevel(
      room(
        [
          { ...TRIGGER, tile: 'shot_trigger' },
          { ...LAUNCHER, tile: 'shot_launcher_w' }
        ],
        { launcherLinks: [{ buttonX: TRIGGER.x, buttonY: TRIGGER.y, launcherX: LAUNCHER.x, launcherY: LAUNCHER.y }] }
      )
    );
    cursorTo(LAUNCHER);
    unlinkButtonOf(controlledRows()[0]).click();
    expect(levelNow().launcherLinks).toBeUndefined();
    editor.undo();
    expect(levelNow().launcherLinks).toHaveLength(1);
  });
});

describe('Link...', () => {
  it('shows the button on a trap too (the target end), and nothing on an empty cell', () => {
    editor.loadCompiledLevel(trapRoom());
    cursorTo(TRAP);
    expect(linkButton().classList.contains('hidden')).toBe(false);
    expect(linkButton().textContent).toBe(t('editor.connections.link.action'));
    cursorTo({ x: 4, y: 4 });
    expect(linkButton().classList.contains('hidden')).toBe(true);
  });

  it('starts a trap link session from a brown button without painting or touching the tool, links on the next click and stays open', () => {
    editor.loadCompiledLevel(trapRoom([]));
    editor.setTool('eraser');
    const terrainBefore = levelNow().terrain;
    cursorTo(BUTTON);
    expect(linkButton().classList.contains('hidden')).toBe(false);
    linkButton().click();
    expect(levelNow().terrain).toEqual(terrainBefore);
    expect(editor['linkSession']).toEqual({ system: 'trap', end: 'button', x: BUTTON.x, y: BUTTON.y });
    expect(editor['tool']).toBe('eraser');
    expect(editor['brush']).toEqual({ kind: 'terrain', id: 'wall' });
    expect(status()).toContain(t('editor.link.fallback.trap_button.label'));
    expect(linkButton().textContent).toBe(t('editor.connections.link.done'));
    click(TRAP);
    expect(levelNow().trapLinks).toEqual([{ buttonX: BUTTON.x, buttonY: BUTTON.y, trapX: TRAP.x, trapY: TRAP.y }]);
    expect(levelNow().terrain).toEqual(terrainBefore);
    expect(editor['linkSession']).not.toBeNull();
    expect(editor['tool']).toBe('eraser');
    expect(document.querySelector('[data-tool="eraser"]')?.getAttribute('aria-pressed')).toBe('true');
    // The section stays on the button, which now lists the trap with an Unlink.
    expect(caption()).toContain(`(${BUTTON.x}, ${BUTTON.y})`);
    expect(controlRows()[0].querySelectorAll('button')).toHaveLength(2);
  });

  it('does not paint when the player drags over the map during the session', () => {
    editor.loadCompiledLevel(trapRoom([]));
    cursorTo(BUTTON);
    linkButton().click();
    pointerAt('pointerdown', TRAP);
    pointerAt('pointermove', { x: 5, y: 3 });
    pointerAt('pointermove', { x: 4, y: 4 });
    window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    expect(levelNow().terrain[3][5]).toBe('floor');
    expect(levelNow().terrain[4][4]).toBe('floor');
  });

  it('ends on Escape, keeping the tool and brush, and says how many links the device has', () => {
    editor.loadCompiledLevel(trapRoom([]));
    cursorTo(BUTTON);
    linkButton().click();
    expect(editor['linkSession']).not.toBeNull();
    editor.handleKeyAction({ kind: 'cancel' });
    expect(editor['linkSession']).toBeNull();
    expect(editor['brush']).toEqual({ kind: 'terrain', id: 'wall' });
    expect(editor['tool']).toBe('brush');
    expect(status()).toBe(t('editor.link.done.label', { role: t('editor.connections.role.trap_button.label'), count: 0 }));
    expect(linkButton().textContent).toBe(t('editor.connections.link.action'));
  });

  it('ends on the Done button and on a click on the source cell', () => {
    editor.loadCompiledLevel(trapRoom([]));
    cursorTo(BUTTON);
    linkButton().click();
    linkButton().click();
    expect(editor['linkSession']).toBeNull();
    linkButton().click();
    expect(editor['linkSession']).not.toBeNull();
    click(BUTTON);
    expect(editor['linkSession']).toBeNull();
  });

  it('keeps the tool when loading another level drops the session', () => {
    editor.loadCompiledLevel(trapRoom([]));
    editor.setTool('picker');
    cursorTo(BUTTON);
    linkButton().click();
    expect(editor['tool']).toBe('picker');
    editor.loadCompiledLevel(trapRoom([]));
    expect(editor['tool']).toBe('picker');
    expect(editor['linkSession']).toBeNull();
  });

  it('refuses a brown button hidden under another tile, with the reason', () => {
    editor.loadCompiledLevel(room([{ ...BUTTON, tile: 'door_red' }], { underlays: [{ ...BUTTON, terrain: 'button_brown' }] }));
    cursorTo(BUTTON);
    const reason = t('editor.connections.link.blocked');
    expect(linkButton().getAttribute('aria-disabled')).toBe('true');
    expect(linkButton().getAttribute('aria-description')).toBe(reason);
    linkButton().click();
    expect(editor['linkSession']).toBeNull();
    expect(status()).toBe(reason);
  });

  it('starts a launcher session from a shot trigger, even hidden, and keeps the brush through Escape', () => {
    editor.loadCompiledLevel(
      room(
        [
          { ...TRIGGER, tile: 'door_red' },
          { ...LAUNCHER, tile: 'shot_launcher_w' }
        ],
        { underlays: [{ ...TRIGGER, terrain: 'shot_trigger' }] }
      )
    );
    cursorTo(TRIGGER);
    expect(linkButton().getAttribute('aria-disabled')).toBeNull();
    linkButton().click();
    expect(editor['linkSession']).toEqual({ system: 'shot', end: 'button', x: TRIGGER.x, y: TRIGGER.y });
    expect(status()).toContain(t('editor.link.fallback.shot_trigger.label'));
    click(LAUNCHER);
    expect(levelNow().launcherLinks).toEqual([{ buttonX: TRIGGER.x, buttonY: TRIGGER.y, launcherX: LAUNCHER.x, launcherY: LAUNCHER.y }]);
    // The session stays open for more launchers until Escape.
    expect(editor['linkSession']).not.toBeNull();
    editor.handleKeyAction({ kind: 'cancel' });
    expect(editor['linkSession']).toBeNull();
    expect(editor['brush']).toEqual({ kind: 'terrain', id: 'wall' });
  });

  it('says what a red button does while unlinked when the session starts', () => {
    editor.loadCompiledLevel(
      room(
        [
          { ...RED_BUTTON, tile: 'button_red' },
          { ...MACHINE, tile: 'clone_machine' }
        ],
        { entities: [{ x: MACHINE.x, y: MACHINE.y, type: 'walker', dir: 'S' }] }
      )
    );
    cursorTo(RED_BUTTON);
    linkButton().click();
    expect(editor['linkSession']).toEqual({ system: 'clone', end: 'button', x: RED_BUTTON.x, y: RED_BUTTON.y });
    expect(status()).toContain(t('editor.link.fallback.clone_button.label'));
  });
});
