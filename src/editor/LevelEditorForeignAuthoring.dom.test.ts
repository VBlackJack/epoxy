// @vitest-environment happy-dom
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

/**
 * The foreign-authoring flag: with it off, the Rules field offers Lynx and CC3D only to a level that already has
 * that engine, the .DAT and CC3D XML exports are hidden, and the template picker lists Epoxy templates only.
 * The setup file turns the flag on for every other test; this file turns it off.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FEATURE_FLAGS } from '../config/constants';
import { setForeignAuthoringOverride } from '../config/featureFlags';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { mountModals } from '../test/domFixture';
import { LevelPackStorage } from '../storage/LevelPackStorage';
import { FakeIndexedDb } from '../test/FakeIndexedDb';
import { smallCc3dLevel } from './cc3dEditorFixtures';
import { LevelEditor } from './LevelEditor';
import { offeredTemplates, type LevelTemplate } from './levelTemplates';

const fake = new FakeIndexedDb();
let editor: LevelEditor;

const noopContext = (): CanvasRenderingContext2D =>
  new Proxy(() => undefined, { get: () => noopContext(), set: () => true, apply: () => undefined }) as unknown as CanvasRenderingContext2D;

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element ${id}`);
  return el as T;
}

function hiddenOptions(): Record<string, boolean> {
  const select = byId<HTMLSelectElement>('editor-meta-ruleset');
  return Object.fromEntries(Array.from(select.options).map((option) => [option.value, option.hidden]));
}

beforeEach(() => {
  setForeignAuthoringOverride(false);
  loadTestConfigs();
  fake.records.clear();
  const store = new Map<string, string>();
  vi.stubGlobal('indexedDB', fake);
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key)
  });
  mountModals('editor-view');
  const canvas = byId<HTMLCanvasElement>('editor-canvas');
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
  // Back to the configured value; the setup file turns the flag on before the next test.
  setForeignAuthoringOverride(null);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await LevelPackStorage.closeConnection();
});

describe('foreign authoring off', () => {
  it('is off in the production configuration', () => {
    expect(FEATURE_FLAGS.foreignAuthoring).toBe(false);
  });

  it('disables the withheld options as well, so a native picker cannot choose them', () => {
    editor.initBlankMap();
    const options = Object.fromEntries(Array.from(byId<HTMLSelectElement>('editor-meta-ruleset').options).map((option) => [option.value, option.disabled]));
    expect(options).toEqual({ epoxy: false, lynx: true, cc3d: true });
  });

  it('offers an Epoxy level the Epoxy rules only, and hides both exports', () => {
    editor.initBlankMap();
    expect(hiddenOptions()).toEqual({ epoxy: false, lynx: true, cc3d: true });
    expect(byId('editor-export-ccl-btn').classList.contains('hidden')).toBe(true);
    expect(byId('editor-export-xml-btn').classList.contains('hidden')).toBe(true);
    expect(byId('editor-export-btn').classList.contains('hidden')).toBe(false);
  });

  it('keeps showing the engine of a Lynx level, so it can still be switched to Epoxy', () => {
    editor.initBlankMap({ ruleset: 'lynx' });
    expect(hiddenOptions()).toEqual({ epoxy: false, lynx: false, cc3d: true });
  });

  it('keeps showing the engine of a CC3D level, and hides its XML export', () => {
    editor.loadCompiledLevel(smallCc3dLevel());
    expect(hiddenOptions()).toEqual({ epoxy: false, lynx: true, cc3d: false });
    expect(byId('editor-export-xml-btn').classList.contains('hidden')).toBe(true);
  });

  it('brings everything back when the flag is on', () => {
    setForeignAuthoringOverride(true);
    editor.initBlankMap();
    expect(hiddenOptions()).toEqual({ epoxy: false, lynx: false, cc3d: false });
    expect(byId('editor-export-ccl-btn').classList.contains('hidden')).toBe(false);
    editor.loadCompiledLevel(smallCc3dLevel());
    expect(byId('editor-export-xml-btn').classList.contains('hidden')).toBe(false);
  });

  it('lists only the Epoxy templates unless the flag is on', () => {
    const templates = [
      { id: 'a', ruleset: 'epoxy' },
      { id: 'b', ruleset: 'lynx' },
      { id: 'c', ruleset: 'cc3d' }
    ] as unknown as LevelTemplate[];
    expect(offeredTemplates(templates).map((template) => template.id)).toEqual(['a']);
    setForeignAuthoringOverride(true);
    expect(offeredTemplates(templates).map((template) => template.id)).toEqual(['a', 'b', 'c']);
  });
});
