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
 * The level editor's column layout follows the size of its view: the width alone for phones and wide screens, and
 * the height too for a medium-width view (a tablet held upright gets one column). The view's sizes are stubbed and
 * the ResizeObserver is replaced by a stub the test fires, as happy-dom does no layout.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../ui/confirmDialog', () => ({ confirmDialog: vi.fn() }));
vi.mock('../ui/saveIntoDialog', () => ({ askSaveInto: vi.fn() }));

import { LevelPackStorage } from '../storage/LevelPackStorage';
import { FakeIndexedDb } from '../test/FakeIndexedDb';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { mountModals } from '../test/domFixture';
import { LevelEditor } from './LevelEditor';

const PORTRAIT_TABLET = { width: 711, height: 967 };
const LANDSCAPE_TABLET = { width: 967, height: 711 };
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };
const HIDDEN = { width: 0, height: 0 };

const fake = new FakeIndexedDb();
let view: HTMLElement;
let fireResize: () => void;
let size = { width: 0, height: 0 };

const noopContext = (): CanvasRenderingContext2D =>
  new Proxy(() => undefined, { get: () => noopContext(), set: () => true, apply: () => undefined }) as unknown as CanvasRenderingContext2D;

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element ${id}`);
  return el as T;
}

function resizeTo(next: { width: number; height: number }): void {
  size = next;
  fireResize();
}

beforeEach(() => {
  loadTestConfigs();
  fake.records.clear();
  vi.stubGlobal('indexedDB', fake);
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined
  });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        fireResize = callback;
      }
      observe(): void {}
      disconnect(): void {}
    }
  );
  size = HIDDEN;
  mountModals('editor-view');
  view = byId('editor-view');
  Object.defineProperty(view, 'offsetWidth', { configurable: true, get: () => size.width });
  Object.defineProperty(view, 'offsetHeight', { configurable: true, get: () => size.height });
  const canvas = byId<HTMLCanvasElement>('editor-canvas');
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => noopContext()) as unknown as HTMLCanvasElement['getContext']);
  const hooks = {
    onTestPlay: vi.fn(),
    onLevelSaved: vi.fn(),
    onNotify: vi.fn(),
    openManager: vi.fn(),
    importAsPack: vi.fn(),
    getConfigBundle: vi.fn()
  };
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
  new LevelEditor(canvas, renderer as never, hooks as never).buildUI();
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await LevelPackStorage.closeConnection();
});

describe('the editor column layout', () => {
  it('gives a portrait tablet one column and the same tablet turned two', () => {
    resizeTo(PORTRAIT_TABLET);
    expect(view.dataset.layout).toBe('one');
    resizeTo(LANDSCAPE_TABLET);
    expect(view.dataset.layout).toBe('two');
    resizeTo(PORTRAIT_TABLET);
    expect(view.dataset.layout).toBe('one');
  });

  it('keeps one column on a phone and three on a desktop window', () => {
    resizeTo(PHONE);
    expect(view.dataset.layout).toBe('one');
    resizeTo(DESKTOP);
    expect(view.dataset.layout).toBe('three');
  });

  it('keeps the layout it had while the view is hidden', () => {
    resizeTo(PORTRAIT_TABLET);
    resizeTo(HIDDEN);
    expect(view.dataset.layout).toBe('one');
  });
});
