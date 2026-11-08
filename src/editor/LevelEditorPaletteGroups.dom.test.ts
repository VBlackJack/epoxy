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
import { isHiddenFromPalette, MECHANISM_GROUPS } from './paletteGroups';

const MECHANISMS_CATEGORY = 'mechanisms';
const GRID_ID = 'editor-palette-grid';
const TABS_ID = 'editor-category-tabs';

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

const gridChildren = (): Element[] => Array.from(byId(GRID_ID).children);
const gridButtons = (): HTMLButtonElement[] => Array.from(byId(GRID_ID).querySelectorAll<HTMLButtonElement>('button'));
const headings = (): HTMLElement[] => Array.from(byId(GRID_ID).querySelectorAll<HTMLElement>('h4'));
const tabButtons = (): HTMLButtonElement[] => Array.from(byId(TABS_ID).querySelectorAll<HTMLButtonElement>('button'));

/** Opens a category tab by its position in the config, so the lookup does not depend on the locale. */
function openCategory(categoryId: string): void {
  const index = ConfigRegistry.getTiles().categories.findIndex((cat) => cat.id === categoryId);
  tabButtons()[index].click();
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

describe('Mechanisms palette sub-headings', () => {
  it('shows the group headings in order, each before its own entries', () => {
    openCategory(MECHANISMS_CATEGORY);
    expect(headings().map((heading) => heading.textContent)).toEqual(MECHANISM_GROUPS.map((group) => t(group.labelKey)));
    const children = gridChildren();
    expect(children[0].tagName).toBe('H4');
    for (const heading of headings()) expect(children[children.indexOf(heading) + 1].tagName).toBe('BUTTON');
  });

  it('keeps every entry reachable in the DOM order, with headings that cannot take focus', () => {
    openCategory(MECHANISMS_CATEGORY);
    const tiles = Object.values(ConfigRegistry.getTiles().tiles).filter((tile) => tile.category === MECHANISMS_CATEGORY && !isHiddenFromPalette(tile));
    const entities = Object.values(ConfigRegistry.getMonsters().entities).filter((ent) => ent.category === MECHANISMS_CATEGORY);
    expect(gridButtons()).toHaveLength(tiles.length + entities.length);
    const labels = new Set(gridButtons().map((btn) => btn.querySelector('.palette-item-label')?.textContent));
    for (const tile of tiles) expect(labels.has(t(tile.i18nKey)), tile.id).toBe(true);
    for (const ent of entities) expect(labels.has(t(ent.i18nKey)), ent.id).toBe(true);
    for (const heading of headings()) expect(heading.hasAttribute('tabindex')).toBe(false);
    expect(gridChildren().filter((child) => child.tagName === 'BUTTON')).toEqual(gridButtons());
  });

  /** The ids of the entries under one heading, in DOM order. */
  function idsUnder(groupId: string): string[] {
    const index = MECHANISM_GROUPS.findIndex((group) => group.id === groupId);
    const heading = headings()[index];
    const ids: string[] = [];
    for (let el = heading.nextElementSibling; el && el.tagName === 'BUTTON'; el = el.nextElementSibling) {
      ids.push((el as HTMLButtonElement).dataset.brushId ?? '');
    }
    return ids;
  }

  it('offers the shot launchers and the shot trigger under Lasers and mirrors, and no wire entry anywhere', () => {
    openCategory(MECHANISMS_CATEGORY);
    const lasers = idsUnder('lasers');
    for (const id of ['shot_launcher_n', 'shot_launcher_e', 'shot_launcher_s', 'shot_launcher_w', 'shot_trigger', 'one_sided_mirror_ne']) {
      expect(lasers.includes(id), id).toBe(true);
    }
    expect(gridButtons().some((btn) => (btn.dataset.brushKind ?? '').startsWith('wire_'))).toBe(false);
    // The trigger fires launchers: it is not listed with the plain buttons.
    expect(idsUnder('buttons').includes('shot_trigger')).toBe(false);
  });

  it('names the headings in French', () => {
    i18n.setLocale('fr');
    openCategory(MECHANISMS_CATEGORY);
    const shown = headings().map((heading) => heading.textContent);
    expect(shown).toEqual(MECHANISM_GROUPS.map((group) => t(group.labelKey)));
    i18n.setLocale('en');
    expect(shown).not.toEqual(MECHANISM_GROUPS.map((group) => t(group.labelKey)));
  });

  it('adds no heading to the other tabs', () => {
    for (const cat of ConfigRegistry.getTiles().categories) {
      if (cat.id === MECHANISMS_CATEGORY) continue;
      openCategory(cat.id);
      expect(headings(), cat.id).toHaveLength(0);
    }
  });

  it('adds no heading to the CC3D palettes', () => {
    editor.initBlankMap({ ruleset: 'cc3d' });
    expect(tabButtons().length).toBeGreaterThan(0);
    for (let i = 0; i < tabButtons().length; i++) {
      tabButtons()[i].click();
      expect(headings()).toHaveLength(0);
    }
  });
});

describe('Palette focus after a choice', () => {
  it('gives focus back to the same entry after a click re-renders the palette', () => {
    openCategory(MECHANISMS_CATEGORY);
    const target = gridButtons()[2];
    const { brushKind, brushId } = target.dataset;
    target.focus();
    target.click();
    const active = document.activeElement as HTMLElement;
    expect(active).not.toBe(target);
    expect(active.tagName).toBe('BUTTON');
    expect(active.dataset.brushKind).toBe(brushKind);
    expect(active.dataset.brushId).toBe(brushId);
    expect(byId(GRID_ID).contains(active)).toBe(true);
  });

  it('does not steal focus when it was outside the palette', () => {
    openCategory(MECHANISMS_CATEGORY);
    const outside = byId<HTMLCanvasElement>('editor-canvas');
    outside.tabIndex = 0;
    outside.focus();
    gridButtons()[2].click();
    expect(byId(GRID_ID).contains(document.activeElement)).toBe(false);
  });
});
