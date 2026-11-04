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

import type { CompiledLevel, LauncherLink } from '../core/types';
import { i18n, t } from '../i18n/I18nManager';
import { LevelPackStorage } from '../storage/LevelPackStorage';
import { FakeIndexedDb } from '../test/FakeIndexedDb';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { mountModals } from '../test/domFixture';
import { EDITOR_LAUNCHER_LINK_COLOR } from '../ui/uiConstants';
import { LevelEditor } from './LevelEditor';

const WIDTH = 10;
const HEIGHT = 7;
const LINK: LauncherLink = { buttonX: 3, buttonY: 2, launcherX: 6, launcherY: 2 };

const fake = new FakeIndexedDb();
let editor: LevelEditor;
let canvas: HTMLCanvasElement;
let strokeColors: string[];

/** A context that ignores every call and records the stroke colours it was given. */
function recordingContext(): CanvasRenderingContext2D {
  const handler: ProxyHandler<() => undefined> = {
    get: () => new Proxy(() => undefined, handler),
    set: (_target, property, value) => {
      if (property === 'strokeStyle' && typeof value === 'string') strokeColors.push(value);
      return true;
    },
    apply: () => undefined
  };
  return new Proxy(() => undefined, handler) as unknown as CanvasRenderingContext2D;
}

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element ${id}`);
  return el as T;
}

function room(ruleset: 'lynx' | undefined, links: LauncherLink[] | undefined): CompiledLevel {
  const terrain: string[][] = Array.from({ length: HEIGHT }, (_, y) =>
    Array.from({ length: WIDTH }, (_, x) => (x === 0 || y === 0 || x === WIDTH - 1 || y === HEIGHT - 1 ? 'wall' : 'floor'))
  );
  terrain[2][3] = 'shot_trigger';
  terrain[2][6] = 'shot_launcher_e';
  terrain[HEIGHT - 2][WIDTH - 2] = 'exit';
  return {
    id: 'lvl_launchers_dom',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    customTitle: 'Launcher room',
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

function lynxOption(): HTMLOptionElement | undefined {
  return Array.from(byId<HTMLSelectElement>('editor-meta-ruleset').options).find((option) => option.value === 'lynx');
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
  strokeColors = [];
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => recordingContext()) as unknown as HTMLCanvasElement['getContext']);
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
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await LevelPackStorage.closeConnection();
});

describe('launcher links in the editor', () => {
  it('are kept when an Epoxy level is opened and exported', () => {
    editor.loadCompiledLevel(room(undefined, [LINK]));
    expect(editor.exportCompiledLevel().launcherLinks).toEqual([LINK]);
  });

  it('are absent from the export of a level that has none', () => {
    editor.loadCompiledLevel(room(undefined, undefined));
    expect('launcherLinks' in editor.exportCompiledLevel()).toBe(false);
  });

  it('lock the Lynx choice, with the reason', () => {
    editor.loadCompiledLevel(room(undefined, [LINK]));
    expect(lynxOption()?.disabled).toBe(true);
    expect(lynxOption()?.title).toBe(t('editor.metadata.ruleset_lynx_unavailable.label'));
  });

  it('switch a stored Lynx level that holds some to Epoxy on open, keeping them', () => {
    editor.loadCompiledLevel(room('lynx', [LINK]));
    const exported = editor.exportCompiledLevel();
    expect(exported.ruleset).toBeUndefined();
    expect(exported.launcherLinks).toEqual([LINK]);
  });

  it('survive a resize that keeps both ends, translated by the anchor', () => {
    editor.loadCompiledLevel(room(undefined, [LINK]));
    byId<HTMLInputElement>('editor-size-width').value = String(WIDTH + 2);
    byId<HTMLButtonElement>('editor-size-apply-btn').click();
    expect(editor.exportCompiledLevel().launcherLinks).toEqual([LINK]);
  });

  it('are drawn as a line of their own colour', () => {
    editor.loadCompiledLevel(room(undefined, [LINK]));
    expect(strokeColors).toContain(EDITOR_LAUNCHER_LINK_COLOR);
  });

  it('are not drawn when the level has none', () => {
    editor.loadCompiledLevel(room(undefined, undefined));
    expect(strokeColors).not.toContain(EDITOR_LAUNCHER_LINK_COLOR);
  });

  describe.each([
    ['cleared', ''],
    ['replaced by another terrain', 'ice']
  ])('with the trigger hidden under a door, when its hidden terrain is %s', (_name, value) => {
    it('are dropped and counted', () => {
      const level = room(undefined, [LINK]);
      level.terrain[LINK.buttonY][LINK.buttonX] = 'door_red';
      level.underlays = [{ x: LINK.buttonX, y: LINK.buttonY, terrain: 'shot_trigger' }];
      editor.loadCompiledLevel(level);
      expect(editor.exportCompiledLevel().launcherLinks).toEqual([LINK]);

      canvas.focus();
      const press = (key: string): boolean => canvas.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      press('ArrowRight');
      press('ArrowRight');
      press('ArrowDown');
      const select = byId<HTMLSelectElement>('editor-hidden-terrain');
      select.value = value;
      select.dispatchEvent(new Event('change', { bubbles: true }));

      expect('launcherLinks' in editor.exportCompiledLevel()).toBe(false);
      expect(byId('editor-status-bar').textContent).toContain(t('editor.layout.status.links_removed', { count: 1 }));
    });
  });
});
