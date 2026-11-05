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

/** The Connections section and the "How mechanisms work" card on a CC3D level: rows from the derived links, no Link button. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../ui/confirmDialog', () => ({ confirmDialog: vi.fn(async () => false) }));
vi.mock('../ui/saveIntoDialog', () => ({ askSaveInto: vi.fn() }));

import { cc3dModel, stacked, type GlyphMeaning } from '../core/cc3d/cc3dTestMaps';
import { normalizeCell, type Cc3dLevel } from '../core/cc3d/model';
import type { CompiledLevel } from '../core/types';
import { i18n, t } from '../i18n/I18nManager';
import { LevelPackStorage } from '../storage/LevelPackStorage';
import { FakeIndexedDb } from '../test/FakeIndexedDb';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { mountModals } from '../test/domFixture';
import { compiledCc3d } from './cc3dEditorFixtures';
import { eraseCell, placeLayer } from './cc3dEdits';
import { CC3D_CONNECTION_KEYS } from './cc3dConnectionRows';
import { getEditorKeyAction } from './editorKeyboard';
import { LevelEditor } from './LevelEditor';
import { CC3D_MECHANISM_HELP_ROWS, MECHANISM_HELP_ROWS, MECHANISMS_HELP_CC3D_TOP_LAYER_KEY } from './mechanismsHelp';

const GLYPHS: Record<string, GlyphMeaning> = {
  b: stacked({ kind: 'floor' }, { kind: 'trap_control' }),
  c: stacked({ kind: 'floor' }, { kind: 'trap' }),
  U: stacked({ kind: 'floor' }, { kind: 'clone_switch' }, { kind: 'trap' })
};

const CONTROL = { x: 2, y: 1 };
const TRAP = { x: 5, y: 1 };
const BURIED = { x: 7, y: 1 };

const fake = new FakeIndexedDb();
let editor: LevelEditor;

const noopContext = (): CanvasRenderingContext2D =>
  new Proxy(() => undefined, { get: () => noopContext(), set: () => true, apply: () => undefined }) as unknown as CanvasRenderingContext2D;

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element ${id}`);
  return el as T;
}

const section = (): HTMLDetailsElement => byId<HTMLDetailsElement>('editor-connections-section');
const caption = (): string => byId('editor-connections-cell').textContent ?? '';
const note = (): string => byId('editor-connections-note').textContent ?? '';
const linkButton = (): HTMLButtonElement => byId<HTMLButtonElement>('editor-connections-link-btn');
const controlRows = (): HTMLElement[] => Array.from(byId('editor-connections-controls').querySelectorAll<HTMLElement>('.editor-connection-row'));
const controlledRows = (): HTMLElement[] => Array.from(byId('editor-connections-controlled').querySelectorAll<HTMLElement>('.editor-connection-row'));
const helpSection = (): HTMLDetailsElement => byId<HTMLDetailsElement>('editor-mechanisms-help-section');
const helpRows = (): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>('#editor-mechanisms-help-list li'));

/** A walled strip with a trap control, a trap and a buried clone switch. */
function cc3dLevel(): CompiledLevel {
  const model = cc3dModel(['##########', '#@b..c.U.#', '##########'], GLYPHS);
  const map: Cc3dLevel = { ...model, cells: model.cells.map((cell) => ({ ...cell, terrain: normalizeCell(cell.terrain) })) };
  return compiledCc3d(map, 'cc3d_connections_dom');
}

const SIZE = 6;

function epoxyLevel(): CompiledLevel {
  const terrain: string[][] = Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x) => (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? 'wall' : 'floor'))
  );
  terrain[SIZE - 2][SIZE - 2] = 'exit';
  return {
    id: 'lvl_cc3d_connections_epoxy',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    customTitle: 'Epoxy room',
    playerStart: { x: 1, y: 1, dir: 'S' },
    terrain,
    items: terrain.map((row) => row.map(() => null as string | null)),
    entities: [],
    trapLinks: [],
    cloneLinks: []
  };
}

function cursorTo(cell: { x: number; y: number }): void {
  editor['moveCursorTo'](cell, false);
  editor.render();
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
  const canvas = byId<HTMLCanvasElement>('editor-canvas');
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => noopContext()) as unknown as HTMLCanvasElement['getContext']);
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

describe('the Connections section on a CC3D level', () => {
  it('is shown with the derived-links line, lists the rows of the cell and offers no Link button', () => {
    editor.loadCompiledLevel(cc3dLevel());
    cursorTo(CONTROL);
    expect(section().classList.contains('hidden')).toBe(false);
    expect(byId('editor-connections-derived').textContent).toBe(t('editor.connections.cc3d_derived.label'));
    expect(caption()).toContain(`(${CONTROL.x}, ${CONTROL.y})`);
    expect(controlRows()).toHaveLength(1);
    expect(controlRows()[0].querySelector('.editor-connection-goto')?.textContent).toContain(`(${TRAP.x}, ${TRAP.y})`);
    // No Unlink button on a derived link.
    expect(controlRows()[0].querySelectorAll('button')).toHaveLength(1);
    expect(linkButton().classList.contains('hidden')).toBe(true);
  });

  it('leaves K and the Link button inert', () => {
    editor.loadCompiledLevel(cc3dLevel());
    cursorTo(CONTROL);
    editor['onConnectionsLinkClick']();
    editor['startLinkAt'](CONTROL);
    expect(editor['linkSession']).toBeNull();
  });

  it('answers the K key through the real key handler by saying CC3D links come from where things stand', () => {
    editor.loadCompiledLevel(cc3dLevel());
    cursorTo(CONTROL);
    // The app maps the key with getEditorKeyAction and hands the action to the editor.
    const action = getEditorKeyAction(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK' }));
    expect(action).toEqual({ kind: 'link' });
    if (action) editor.handleKeyAction(action);
    expect(editor['linkSession']).toBeNull();
    expect(byId('editor-status-bar').textContent).toBe(t('editor.link.unavailable.label'));
    expect(t('editor.link.unavailable.label')).toContain('where things stand');
  });

  it('goes to the cell of a row when it is clicked', () => {
    editor.loadCompiledLevel(cc3dLevel());
    cursorTo(CONTROL);
    controlRows()[0].querySelector<HTMLButtonElement>('.editor-connection-goto')?.click();
    expect(editor['cursorCell']).toEqual(TRAP);
    expect(controlledRows()).toHaveLength(1);
    expect(controlledRows()[0].querySelector('.editor-connection-goto')?.textContent).toContain(`(${CONTROL.x}, ${CONTROL.y})`);
  });

  it('draws the rows again when an edit moves the trap', () => {
    editor.loadCompiledLevel(cc3dLevel());
    cursorTo(CONTROL);
    editor['commitCc3dEdit']((level) => placeLayer(eraseCell(level, TRAP.x, TRAP.y), 4, 1, { kind: 'trap' }));
    expect(controlRows()[0].querySelector('.editor-connection-goto')?.textContent).toContain('(4, 1)');
  });

  it('says what a buried entry device does, and writes the section again in French', () => {
    editor.loadCompiledLevel(cc3dLevel());
    cursorTo(BURIED);
    expect(note()).toBe(t(CC3D_CONNECTION_KEYS.buried));
    i18n.setLocale('fr');
    editor['refreshConnections']();
    expect(byId('editor-connections-derived').textContent).toBe(t('editor.connections.cc3d_derived.label'));
    expect(byId('editor-connections-derived').textContent).toContain('position');
    expect(note()).toBe(t(CC3D_CONNECTION_KEYS.buried));
  });
});

describe('the How mechanisms work card on a CC3D level', () => {
  it('has one row per CC3D mechanism with its sentence, no Epoxy row and the top layer footer', () => {
    editor.loadCompiledLevel(cc3dLevel());
    editor['refreshConnections']();
    expect(helpSection().classList.contains('hidden')).toBe(false);
    expect(helpRows()).toHaveLength(CC3D_MECHANISM_HELP_ROWS.length);
    for (const [index, row] of CC3D_MECHANISM_HELP_ROWS.entries()) {
      const item = helpRows()[index];
      expect(item.dataset.system).toBe(row.system);
      expect(item.textContent).toContain(t(row.nameKey));
      expect(item.textContent).toContain(t(row.howKey));
    }
    // None of the Epoxy-only rows (plates, shots, tanks, flames, swaps, puppets) is on the CC3D card.
    const shown = helpRows().map((item) => item.dataset.system);
    for (const system of ['plate', 'shot', 'tank', 'flame', 'swap', 'puppet']) expect(shown).not.toContain(system);
    expect(shown).toEqual(CC3D_MECHANISM_HELP_ROWS.map((row) => row.system));
    expect(byId('editor-mechanisms-help-keys').textContent).toBe(t(MECHANISMS_HELP_CC3D_TOP_LAYER_KEY));
    expect(byId('editor-mechanisms-help-lynx').textContent).toBe('');
  });

  it('is written again in French', () => {
    editor.loadCompiledLevel(cc3dLevel());
    i18n.setLocale('fr');
    editor['refreshConnections']();
    expect(helpRows()[0].textContent).toContain(t(CC3D_MECHANISM_HELP_ROWS[0].howKey));
    expect(helpRows()[0].textContent).toContain('piège');
  });

  it('gives the Epoxy card back when the level is Epoxy again', () => {
    editor.loadCompiledLevel(cc3dLevel());
    editor['refreshConnections']();
    editor.loadCompiledLevel(epoxyLevel());
    editor['refreshConnections']();
    expect(helpRows()).toHaveLength(MECHANISM_HELP_ROWS.length);
    expect(helpRows().map((item) => item.dataset.system)).toEqual(MECHANISM_HELP_ROWS.map((row) => row.system));
    expect(byId('editor-mechanisms-help-keys').textContent).toContain('Shift+F');
    expect(byId('editor-mechanisms-help-lynx').textContent).toContain('Lynx');
  });
});
