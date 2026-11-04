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
import type { CompiledLevel } from '../core/types';
import { i18n, t } from '../i18n/I18nManager';
import { LevelPackStorage } from '../storage/LevelPackStorage';
import { FakeIndexedDb } from '../test/FakeIndexedDb';
import { mountModals } from '../test/domFixture';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { LevelEditor } from './LevelEditor';
import { getEditorKeyAction } from './editorKeyboard';

const WIDTH = 8;
const HEIGHT = 6;
const CLONER = { x: 4, y: 3 };
const BUTTON = { x: 2, y: 3 };

const fake = new FakeIndexedDb();
let editor: LevelEditor;
let canvas: HTMLCanvasElement;
let drawEntity: ReturnType<typeof vi.fn>;
let renderIcon: ReturnType<typeof vi.fn>;

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

/** An editor shortcut: the application routes the key to the editor, so the test does the same. */
function shortcut(key: string, init: KeyboardEventInit = {}): void {
  const action = getEditorKeyAction(new KeyboardEvent('keydown', { key, ...init }));
  if (action) editor.handleKeyAction(action);
}

const status = (): string => byId('editor-status-bar').textContent ?? '';
const dirButton = (dir: string): HTMLButtonElement => document.querySelector<HTMLButtonElement>(`#editor-dir-group [data-dir="${dir}"]`)!;
const walkerName = (): string => t(ConfigRegistry.getEntityDef('walker')!.i18nKey);
const sideName = (key: string): string => t(`editor.cell_speech.side.${key}.label`);

/** A room with a clone machine at (4, 3) holding a walker facing east, wired to a red button. */
function room(): CompiledLevel {
  const terrain: string[][] = Array.from({ length: HEIGHT }, (_, y) =>
    Array.from({ length: WIDTH }, (_, x) => (x === 0 || y === 0 || x === WIDTH - 1 || y === HEIGHT - 1 ? 'wall' : 'floor'))
  );
  terrain[BUTTON.y][BUTTON.x] = 'button_red';
  terrain[CLONER.y][CLONER.x] = 'clone_machine';
  return {
    id: 'lvl_facing_dom',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    customTitle: 'Facing room',
    playerStart: { x: 1, y: 1, dir: 'S' },
    terrain,
    items: terrain.map((row) => row.map(() => null as string | null)),
    entities: [{ x: CLONER.x, y: CLONER.y, type: 'walker', dir: 'E' }],
    trapLinks: [],
    cloneLinks: [{ buttonX: BUTTON.x, buttonY: BUTTON.y, clonerX: CLONER.x, clonerY: CLONER.y, templateType: 'walker', templateDir: 'E' }]
  };
}

/** Puts the keyboard cursor on a cell, from the cell (1, 1) where it starts. */
function moveCursorTo(x: number, y: number): void {
  for (let i = 1; i < x; i++) press('ArrowRight');
  for (let i = 1; i < y; i++) press('ArrowDown');
}

function openRoom(): void {
  editor.loadCompiledLevel(room());
  canvas.focus();
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
  drawEntity = vi.fn();
  renderIcon = vi.fn((kind: string, id: string, dir?: string) => `data:,${kind}-${id}-${dir ?? 'default'}`);
  const renderer = {
    getAppearanceKey: vi.fn(() => 'look'),
    renderIconToDataUrl: renderIcon,
    drawTile: vi.fn(),
    drawItem: vi.fn(),
    drawEntity,
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

describe('facing and clone templates in the editor', () => {
  it('draws the template of a clone machine with its facing as a smaller badge in its corner', () => {
    openRoom();
    const calls = drawEntity.mock.calls.filter((call) => call[1] === 'walker');
    const sizes = new Set(calls.map((call) => call[5] as number));
    // One call for the creature itself, one for the badge: same type and facing, a smaller size.
    expect(sizes.size).toBe(2);
    const [full, badge] = [Math.max(...sizes), Math.min(...sizes)];
    const badgeCall = calls.find((call) => call[5] === badge)!;
    expect(badgeCall[2]).toBe('E');
    // Top right corner of the clone machine cell.
    expect(badgeCall[3]).toBe((CLONER.x + 1) * full - badge);
    expect(badgeCall[4]).toBe(CLONER.y * full);
  });

  it('draws the badge with the new facing after a rotation', () => {
    openRoom();
    moveCursorTo(CLONER.x, CLONER.y);
    drawEntity.mockClear();
    shortcut('R', { shiftKey: true });
    const facings = drawEntity.mock.calls.filter((call) => call[1] === 'walker').map((call) => call[2]);
    expect(facings.length).toBeGreaterThan(0);
    expect(new Set(facings)).toEqual(new Set(['S']));
  });

  it('Shift+R turns the creature under the cursor as one undo step and the clone template follows', () => {
    openRoom();
    moveCursorTo(CLONER.x, CLONER.y);
    const undo = byId<HTMLButtonElement>('editor-undo-btn');
    expect(undo.disabled).toBe(true);
    shortcut('R', { shiftKey: true });
    let level = editor.exportCompiledLevel();
    expect(level.entities).toEqual([{ x: CLONER.x, y: CLONER.y, type: 'walker', dir: 'S' }]);
    expect(level.cloneLinks[0]).toMatchObject({ templateType: 'walker', templateDir: 'S' });
    expect(status()).toContain(t('editor.layout.status.rotated.label', { name: walkerName(), x: CLONER.x, y: CLONER.y, side: sideName('s') }));
    expect(status()).toContain(
      t('editor.layout.status.cloner_template.label', { x: CLONER.x, y: CLONER.y, name: walkerName(), side: sideName('s') })
    );
    // The facing control keeps its own value: Shift+R does not turn it.
    expect(dirButton('S').getAttribute('aria-pressed')).toBe('true');

    editor.undo();
    level = editor.exportCompiledLevel();
    expect(level.entities[0].dir).toBe('E');
    expect(level.cloneLinks[0].templateDir).toBe('E');
    expect(undo.disabled).toBe(true);
  });

  it('Shift+R says so when no creature or turret is under the cursor, and records no step', () => {
    openRoom();
    moveCursorTo(2, 2);
    shortcut('R', { shiftKey: true });
    expect(status()).toBe(t('editor.layout.status.rotate_nothing.label'));
    expect(byId<HTMLButtonElement>('editor-undo-btn').disabled).toBe(true);
  });

  it('plain R still turns the direction control, not the creature', () => {
    openRoom();
    moveCursorTo(CLONER.x, CLONER.y);
    shortcut('r');
    expect(dirButton('W').getAttribute('aria-pressed')).toBe('true');
    expect(editor.exportCompiledLevel().entities[0].dir).toBe('E');
  });

  it('redraws the palette icons of creatures with the facing of the direction control', () => {
    openRoom();
    const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('#editor-category-tabs button'));
    const iconOfWalker = (): string | null => {
      const button = Array.from(document.querySelectorAll<HTMLButtonElement>('#editor-palette-grid button')).find(
        (candidate) => candidate.querySelector('.palette-item-label')?.textContent === walkerName()
      );
      return button?.querySelector('img')?.getAttribute('src') ?? null;
    };
    let before: string | null = null;
    for (const tab of tabs) {
      tab.click();
      before = iconOfWalker();
      if (before !== null) break;
    }
    expect(before).toBe('data:,entity-walker-S');
    dirButton('W').click();
    expect(iconOfWalker()).toBe('data:,entity-walker-W');
    dirButton('S').click();
    expect(iconOfWalker()).toBe('data:,entity-walker-S');
    // Turning back reuses the drawn icons: each walker facing is rendered once.
    expect(renderIcon.mock.calls.filter((c) => c[0] === 'entity' && c[1] === 'walker' && c[2] === 'S')).toHaveLength(1);
    expect(renderIcon.mock.calls.filter((c) => c[0] === 'entity' && c[1] === 'walker' && c[2] === 'W')).toHaveLength(1);
    // A block has no facing: its icon is always drawn the default way.
    expect(renderIcon).not.toHaveBeenCalledWith('entity', 'dirt_block', 'W');
  });
});
