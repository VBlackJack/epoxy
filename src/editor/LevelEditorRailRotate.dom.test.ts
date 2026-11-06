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

/** The rotate key turns a rail piece in hand without touching the tool, the selection or a floating paste. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../ui/confirmDialog', () => ({ confirmDialog: vi.fn(async () => false) }));
vi.mock('../ui/saveIntoDialog', () => ({ askSaveInto: vi.fn() }));

import type { CompiledLevel } from '../core/types';
import { i18n } from '../i18n/I18nManager';
import { LevelPackStorage } from '../storage/LevelPackStorage';
import { FakeIndexedDb } from '../test/FakeIndexedDb';
import { mountModals } from '../test/domFixture';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { LevelEditor } from './LevelEditor';

const WIDTH = 9;
const HEIGHT = 7;

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

const toolButton = (tool: string): HTMLButtonElement => document.querySelector<HTMLButtonElement>(`.editor-tool-btn[data-tool="${tool}"]`)!;

/** A bordered room with a trap pair: brown button (1, 2) linked to the trap (3, 2). */
function room(ruleset?: CompiledLevel['ruleset']): CompiledLevel {
  const terrain: string[][] = Array.from({ length: HEIGHT }, (_, y) =>
    Array.from({ length: WIDTH }, (_, x) => (x === 0 || y === 0 || x === WIDTH - 1 || y === HEIGHT - 1 ? 'wall' : 'floor'))
  );
  terrain[2][1] = 'button_brown';
  terrain[2][3] = 'trap';
  return {
    id: 'lvl_stamps_dom',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    customTitle: 'Stamps room',
    ruleset,
    playerStart: { x: 1, y: 1, dir: 'S' },
    terrain,
    items: terrain.map((row) => row.map(() => null as string | null)),
    entities: [],
    trapLinks: [{ buttonX: 1, buttonY: 2, trapX: 3, trapY: 2 }],
    cloneLinks: []
  };
}

function open(level: CompiledLevel): void {
  editor.loadCompiledLevel(level);
  canvas.focus();
  toolButton('select').click();
}

function chooseStamp(id: string): void {
  byId<HTMLButtonElement>('editor-stamps-btn').click();
  const item = Array.from(document.querySelectorAll<HTMLButtonElement>('#editor-stamps-menu .editor-stamp-item')).find((c) => c.dataset.stamp === id);
  if (!item) throw new Error(`No stamp ${id} in the menu`);
  item.click();
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await LevelPackStorage.closeConnection();
  i18n.setLocale('en');
});

describe('rotating a rail piece in hand', () => {
  const brushOf = (): { kind: string; id: string } => (editor as unknown as { brush: { kind: string; id: string } }).brush;

  it('turns the brush to the next piece', () => {
    open(room());
    toolButton('brush').click();
    (editor as unknown as { selectBrush(b: unknown): void }).selectBrush({ kind: 'terrain', id: 'rail_ns' });
    editor.handleKeyAction({ kind: 'rotate' });
    expect(brushOf().id).toBe('rail_ew');
  });

  it('keeps the Select tool and a floating paste', () => {
    open(room());
    (editor as unknown as { selectBrush(b: unknown): void }).selectBrush({ kind: 'terrain', id: 'rail_ne' });
    toolButton('select').click();
    chooseStamp('trap');
    const state = editor as unknown as { pasting: boolean; tool: string };
    expect(state.pasting).toBe(true);
    editor.handleKeyAction({ kind: 'rotate' });
    expect(brushOf().id).toBe('rail_se');
    expect(state.pasting).toBe(true);
    expect(state.tool).toBe('select');
  });
});
