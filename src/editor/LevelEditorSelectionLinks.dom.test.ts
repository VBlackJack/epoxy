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
import type { CompiledLevel, TrapLink } from '../core/types';
import { i18n, t } from '../i18n/I18nManager';
import { LevelPackStorage } from '../storage/LevelPackStorage';
import { FakeIndexedDb } from '../test/FakeIndexedDb';
import { mountModals } from '../test/domFixture';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { DAT_MAX_CLONE_LINKS, DAT_MAX_TRAP_LINKS } from './datLinkCap';
import { LevelEditor } from './LevelEditor';

vi.mock('../ui/download', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../ui/download')>()),
  downloadBytes: vi.fn(),
  downloadJson: vi.fn()
}));

const WIDTH = 8;
const HEIGHT = 6;
const WIDE_WIDTH = 32;
const EXTRA_TRAPS = 2;

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

function press(name: string, init: KeyboardEventInit = {}): void {
  canvas.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init }));
}

const status = (): string => byId('editor-status-bar').textContent ?? '';
const toolButton = (tool: string): HTMLButtonElement => document.querySelector<HTMLButtonElement>(`.editor-tool-btn[data-tool="${tool}"]`)!;

/** A bordered room with a trap pair: brown button (1, 2) linked to the trap (3, 2). */
function room(width = WIDTH): CompiledLevel {
  const terrain: string[][] = Array.from({ length: HEIGHT }, (_, y) =>
    Array.from({ length: width }, (_, x) => (x === 0 || y === 0 || x === width - 1 || y === HEIGHT - 1 ? 'wall' : 'floor'))
  );
  terrain[2][1] = 'button_brown';
  terrain[2][3] = 'trap';
  return {
    id: 'lvl_links_dom',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    customTitle: 'Links room',
    playerStart: { x: 1, y: 1, dir: 'S' },
    terrain,
    items: terrain.map((row) => row.map(() => null as string | null)),
    entities: [],
    trapLinks: [{ buttonX: 1, buttonY: 2, trapX: 3, trapY: 2 }],
    cloneLinks: []
  };
}

/** A wide room where one brown button works more traps than a .DAT level keeps. */
function crowdedRoom(): CompiledLevel {
  const level = room(WIDE_WIDTH);
  const trapLinks: TrapLink[] = [];
  const count = DAT_MAX_TRAP_LINKS + EXTRA_TRAPS;
  for (let i = 0; i < count; i++) {
    const x = 3 + i;
    level.terrain[3][x] = 'trap';
    trapLinks.push({ buttonX: 1, buttonY: 2, trapX: x, trapY: 3 });
  }
  level.trapLinks = trapLinks;
  return level;
}

function moveCursorTo(x: number, y: number): void {
  for (let i = 1; i < x; i++) press('ArrowRight');
  for (let i = 1; i < y; i++) press('ArrowDown');
}

function selectRect(width: number, height: number): void {
  press('Enter');
  for (let i = 1; i < width; i++) press('ArrowRight', { shiftKey: true });
  for (let i = 1; i < height; i++) press('ArrowDown', { shiftKey: true });
}

function open(level: CompiledLevel): void {
  editor.loadCompiledLevel(level);
  canvas.focus();
  toolButton('select').click();
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
});

describe('selection links on an Epoxy level', () => {
  it('cuts a pair without calling its links dropped, and pastes them back as one undo step', () => {
    open(room());
    moveCursorTo(1, 1);
    selectRect(3, 2);
    editor.handleSelectionAction({ kind: 'cut' });
    expect(editor.exportCompiledLevel().trapLinks).toEqual([]);
    expect(status()).toContain(t('editor.selection.status.cut', { width: 3, height: 2 }));
    expect(status()).not.toContain(t('editor.selection.status.links_dropped', { count: 1 }));

    editor.handleSelectionAction({ kind: 'paste' });
    press('Enter');
    expect(editor.exportCompiledLevel().trapLinks).toEqual([{ buttonX: 3, buttonY: 3, trapX: 5, trapY: 3 }]);
    expect(status()).toContain(t('editor.selection.status.links_pasted.label', { count: 1 }));

    // One step for the paste: undoing it leaves the state after the cut.
    editor.undo();
    expect(editor.exportCompiledLevel().trapLinks).toEqual([]);
    editor.undo();
    expect(editor.exportCompiledLevel().trapLinks).toEqual([{ buttonX: 1, buttonY: 2, trapX: 3, trapY: 2 }]);
  });

  it('says how many links a copy leaves out when they leave the selection', () => {
    open(room());
    moveCursorTo(1, 1);
    selectRect(2, 2);
    editor.handleSelectionAction({ kind: 'copy' });
    expect(status()).toContain(t('editor.selection.status.links_left_out.label', { count: 1 }));
  });

  it('warns after a .CCL export that more trap links than the .DAT format keeps were left out', () => {
    open(crowdedRoom());
    byId<HTMLButtonElement>('editor-export-ccl-btn').click();
    expect(status()).toContain(t('app.export.trap_links_capped.label', { max: DAT_MAX_TRAP_LINKS, count: EXTRA_TRAPS }));
  });

  it('does not warn when every link fits', () => {
    open(room());
    byId<HTMLButtonElement>('editor-export-ccl-btn').click();
    // No prefix of either cap message, whatever the count.
    const prefixOf = (key: string, max: number): string => t(key, { max, count: 1 }).split(',')[0];
    expect(status()).not.toContain(prefixOf('app.export.trap_links_capped.label', DAT_MAX_TRAP_LINKS));
    expect(status()).not.toContain(prefixOf('app.export.clone_links_capped.label', DAT_MAX_CLONE_LINKS));
  });
});
