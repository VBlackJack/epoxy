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
import { ConfigRegistry } from '../config/ConfigRegistry';
import { i18n, t } from '../i18n/I18nManager';
import { LevelPackStorage } from '../storage/LevelPackStorage';
import { FakeIndexedDb } from '../test/FakeIndexedDb';
import { mountModals } from '../test/domFixture';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { LevelEditor } from './LevelEditor';

const GRID_ID = 'editor-palette-grid';
const TABS_ID = 'editor-category-tabs';
const STATUS_ID = 'editor-status-bar';
const MECHANISMS_CATEGORY = 'mechanisms';
const TERRAIN_CATEGORY = 'terrain';
const ENTITIES_CATEGORY = 'entities';
const HOLD_DOOR_ID = 'hold_door_red_closed';
const HOLD_DOOR_DESC_KEY = 'tiles.hold_door_red_closed.desc.label';

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
const status = (): string => byId(STATUS_ID).textContent ?? '';

function entryButton(kind: string, id: string): HTMLButtonElement {
  const found = gridButtons().find((btn) => btn.dataset.brushKind === kind && btn.dataset.brushId === id);
  if (!found) throw new Error(`Missing palette entry ${kind}:${id}`);
  return found;
}

function openCategory(categoryId: string): void {
  const index = ConfigRegistry.getTiles().categories.findIndex((cat) => cat.id === categoryId);
  Array.from(byId(TABS_ID).querySelectorAll<HTMLButtonElement>('button'))[index].click();
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
});

describe('Palette entry descriptions', () => {
  it('puts the name and the description in the hover title, and the description in aria-description', () => {
    openCategory(MECHANISMS_CATEGORY);
    const button = entryButton('terrain', HOLD_DOOR_ID);
    const name = t(ConfigRegistry.getTile(HOLD_DOOR_ID).i18nKey);
    const description = t(HOLD_DOOR_DESC_KEY);
    expect(description).not.toBe(HOLD_DOOR_DESC_KEY);
    expect(button.title).toBe(`${name}: ${description}`);
    expect(button.getAttribute('aria-description')).toBe(description);
    // The visible label stays the bare name.
    expect(button.querySelector('.palette-item-label')?.textContent).toBe(name);
  });

  it('describes an entity entry and follows the language', () => {
    openCategory(MECHANISMS_CATEGORY);
    const english = entryButton('entity', 'turret_cw').getAttribute('aria-description');
    i18n.setLocale('fr');
    openCategory(MECHANISMS_CATEGORY);
    const french = entryButton('entity', 'turret_cw').getAttribute('aria-description');
    expect(english).toBeTruthy();
    expect(french).toBeTruthy();
    expect(french).not.toBe(english);
  });

  it('describes the thin wall and the player start entries', () => {
    openCategory(TERRAIN_CATEGORY);
    expect(entryButton('cell_edge', 'cell_edge').getAttribute('aria-description')).toBe(t('editor.palette.tools.cell_edge_desc.label'));
    openCategory(ENTITIES_CATEGORY);
    expect(entryButton('player_start', 'player_start').getAttribute('aria-description')).toBe(t('editor.palette.tools.player_start_desc.label'));
  });

  it('adds no description to an entry that has none, keeping the bare name as title', () => {
    openCategory(TERRAIN_CATEGORY);
    const button = entryButton('terrain', 'floor');
    expect(button.hasAttribute('aria-description')).toBe(false);
    expect(button.title).toBe(t(ConfigRegistry.getTile('floor').i18nKey));
  });

  it('shows the name and the description on the status line when the entry is chosen', () => {
    openCategory(MECHANISMS_CATEGORY);
    entryButton('terrain', HOLD_DOOR_ID).click();
    expect(status()).toBe(`${t(ConfigRegistry.getTile(HOLD_DOOR_ID).i18nKey)}: ${t(HOLD_DOOR_DESC_KEY)}`);
  });

  it('keeps the thin wall status, which already says how to use it', () => {
    openCategory(TERRAIN_CATEGORY);
    entryButton('cell_edge', 'cell_edge').click();
    expect(status()).toBe(t('editor.palette.status.cell_edge_mode'));
  });
});
