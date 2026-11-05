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

/** The "How mechanisms work" card: a closed section with one row per mechanism, written in the player's language. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../ui/confirmDialog', () => ({ confirmDialog: vi.fn(async () => false) }));
vi.mock('../ui/saveIntoDialog', () => ({ askSaveInto: vi.fn() }));

import { GRAY_BUTTON_RADIUS } from '../core/coreConstants';
import type { CompiledLevel } from '../core/types';
import { i18n, t } from '../i18n/I18nManager';
import { smallCc3dLevel } from './cc3dEditorFixtures';
import { LevelPackStorage } from '../storage/LevelPackStorage';
import { FakeIndexedDb } from '../test/FakeIndexedDb';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { mountModals } from '../test/domFixture';
import { LevelEditor } from './LevelEditor';
import { MECHANISM_HELP_ROWS } from './mechanismsHelp';

const fake = new FakeIndexedDb();
let editor: LevelEditor;

const noopContext = (): CanvasRenderingContext2D =>
  new Proxy(() => undefined, { get: () => noopContext(), set: () => true, apply: () => undefined }) as unknown as CanvasRenderingContext2D;

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element ${id}`);
  return el as T;
}

const SIZE = 6;

function plainLevel(ruleset?: CompiledLevel['ruleset']): CompiledLevel {
  const terrain: string[][] = Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x) => (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? 'wall' : 'floor'))
  );
  terrain[SIZE - 2][SIZE - 2] = 'exit';
  return {
    id: 'lvl_mechanisms_help_dom',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    customTitle: 'Help room',
    ruleset,
    playerStart: { x: 1, y: 1, dir: 'S' },
    terrain,
    items: terrain.map((row) => row.map(() => null as string | null)),
    entities: [],
    trapLinks: [],
    cloneLinks: []
  };
}

const section = (): HTMLDetailsElement => byId<HTMLDetailsElement>('editor-mechanisms-help-section');
const rows = (): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>('#editor-mechanisms-help-list li'));

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
  editor['refreshConnections']();
});

afterEach(async () => {
  editor.dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await LevelPackStorage.closeConnection();
  i18n.setLocale('en');
});

describe('the How mechanisms work card', () => {
  it('is a section that starts closed and is shown for Epoxy levels', () => {
    expect(section().hasAttribute('open')).toBe(false);
    expect(section().classList.contains('hidden')).toBe(false);
    const title = section().querySelector('summary')?.getAttribute('data-i18n') ?? '';
    expect(t(title)).toBe('How mechanisms work');
  });

  it('has one row per mechanism, each naming the mechanism and what happens when it is unlinked', () => {
    expect(rows()).toHaveLength(MECHANISM_HELP_ROWS.length);
    for (const [index, row] of MECHANISM_HELP_ROWS.entries()) {
      const text = rows()[index].textContent ?? '';
      expect(rows()[index].dataset.system).toBe(row.system);
      expect(text).toContain(t(row.nameKey));
      expect(text).toContain(t(row.howKey, row.params));
      expect(text).toContain(t(row.unlinkedKey, row.params));
    }
  });

  it('names the keys and the Lynx rule', () => {
    expect(byId('editor-mechanisms-help-keys').textContent).toContain('Shift+F');
    expect(byId('editor-mechanisms-help-lynx').textContent).toContain('Lynx');
  });

  it('shows the radius of the gray button from the engine constant', () => {
    const swap = rows().find((row) => row.dataset.system === 'swap')?.textContent ?? '';
    expect(swap).toContain(`radius ${GRAY_BUTTON_RADIUS}`);
    expect(swap).not.toContain('{radius}');
  });

  it('is hidden for a CC3D level and its rows are back when the level is Epoxy again', () => {
    editor.loadCompiledLevel(smallCc3dLevel());
    editor['refreshConnections']();
    expect(section().classList.contains('hidden')).toBe(true);
    editor.loadCompiledLevel(plainLevel());
    editor['refreshConnections']();
    expect(section().classList.contains('hidden')).toBe(false);
    expect(rows()).toHaveLength(MECHANISM_HELP_ROWS.length);
  });

  it('keeps its rows when the hovered cell changes', () => {
    editor.loadCompiledLevel(plainLevel());
    editor['refreshConnections']();
    const first = rows()[0];
    editor['moveCursorTo']({ x: 2, y: 2 }, false);
    editor['refreshConnections']();
    editor['moveCursorTo']({ x: 3, y: 3 }, false);
    editor['refreshConnections']();
    expect(first.isConnected).toBe(true);
    expect(rows()[0]).toBe(first);
  });

  it('leaves out the unlinked sentence of the trap and clone rows under Lynx rules, and restores it for Epoxy', () => {
    const trap = (): string => rows().find((row) => row.dataset.system === 'trap')?.textContent ?? '';
    const clone = (): string => rows().find((row) => row.dataset.system === 'clone')?.textContent ?? '';
    const plate = (): string => rows().find((row) => row.dataset.system === 'plate')?.textContent ?? '';
    expect(trap()).toContain(t('editor.connections.help.system.trap.unlinked.label'));
    editor.loadCompiledLevel(plainLevel('lynx'));
    editor['refreshConnections']();
    expect(trap()).toContain(t('editor.connections.help.system.trap.how.label'));
    expect(trap()).not.toContain(t('editor.connections.help.system.trap.unlinked.label'));
    expect(clone()).not.toContain(t('editor.connections.help.system.clone.unlinked.label'));
    expect(plate()).toContain(t('editor.connections.help.system.plate.unlinked.label'));
    editor.loadCompiledLevel(plainLevel());
    editor['refreshConnections']();
    expect(trap()).toContain(t('editor.connections.help.system.trap.unlinked.label'));
  });

  it('is written again in French when the locale changes', () => {
    i18n.setLocale('fr');
    editor['refreshConnections']();
    expect(t(section().querySelector('summary')?.getAttribute('data-i18n') ?? '')).toBe('Comment fonctionnent les mécanismes');
    expect(rows()[0].textContent).toContain(t(MECHANISM_HELP_ROWS[0].howKey));
    expect(rows()[0].textContent).toContain('Reliez');
    expect(byId('editor-mechanisms-help-keys').textContent).toContain('Maj+F');
  });
});
