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

/** A runtime-only entity or tile (the rolling ball, the picked-up yellow pad) is never offered by the editor palette. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigRegistry } from '../config/ConfigRegistry';
import { i18n, t } from '../i18n/I18nManager';
import { LevelPackStorage } from '../storage/LevelPackStorage';
import { FakeIndexedDb } from '../test/FakeIndexedDb';
import { mountModals } from '../test/domFixture';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { LevelEditor } from './LevelEditor';

const GRID_ID = 'editor-palette-grid';
const TABS_ID = 'editor-category-tabs';
const INPUT_ID = 'editor-palette-search';
const CANVAS_ID = 'editor-canvas';
const ROLLING_BALL_ID = 'rolling_ball';
const YELLOW_ITEM_ID = 'teleport_yellow_item';
const RUNTIME_ONLY_IDS: readonly string[] = [ROLLING_BALL_ID, YELLOW_ITEM_ID];

const fake = new FakeIndexedDb();
let editor: LevelEditor;

const noopContext = (): CanvasRenderingContext2D =>
  new Proxy(() => undefined, { get: () => noopContext(), set: () => true, apply: () => undefined }) as unknown as CanvasRenderingContext2D;

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element ${id}`);
  return el as T;
}

const gridButtons = (): HTMLButtonElement[] => Array.from(byId(GRID_ID).querySelectorAll<HTMLButtonElement>('button'));
const tabButtons = (): HTMLButtonElement[] => Array.from(byId(TABS_ID).querySelectorAll<HTMLButtonElement>('button'));

function type(text: string): void {
  const input = byId<HTMLInputElement>(INPUT_ID);
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
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
  const canvas = byId<HTMLCanvasElement>(CANVAS_ID);
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
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await LevelPackStorage.closeConnection();
});

describe('runtime-only palette entries', () => {
  it('both exist in the config, so their absence below is the filter and not a missing entry', () => {
    expect(ConfigRegistry.getEntityDef(ROLLING_BALL_ID)).toBeDefined();
    expect(ConfigRegistry.getTile(YELLOW_ITEM_ID).id).toBe(YELLOW_ITEM_ID);
  });

  it('are in no tab of the palette', () => {
    const tabs = tabButtons();
    expect(tabs.length).toBeGreaterThan(1);
    let entries = 0;
    for (const tab of tabs) {
      tab.click();
      const ids = gridButtons().map((btn) => btn.dataset.brushId ?? '');
      entries += ids.length;
      for (const id of RUNTIME_ONLY_IDS) expect(ids).not.toContain(id);
    }
    expect(entries).toBeGreaterThan(0);
  });

  it('are in no search result, even when the query names them', () => {
    for (const id of RUNTIME_ONLY_IDS) {
      const name = id === ROLLING_BALL_ID ? t(ConfigRegistry.getEntityDef(id)!.i18nKey) : t(ConfigRegistry.getTile(id).i18nKey);
      type(name);
      const ids = gridButtons().map((btn) => btn.dataset.brushId ?? '');
      for (const hidden of RUNTIME_ONLY_IDS) expect(ids).not.toContain(hidden);
    }
    type('teleporter');
    expect(gridButtons().length).toBeGreaterThan(0);
  });
});
