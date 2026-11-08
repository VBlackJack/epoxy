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

import type { CompiledLevel, LevelBlueprint } from '../core/types';
import { ConfigRegistry } from '../config/ConfigRegistry';
import { i18n, t } from '../i18n/I18nManager';
import { LevelPackStorage } from '../storage/LevelPackStorage';
import { FakeIndexedDb } from '../test/FakeIndexedDb';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { mountModals } from '../test/domFixture';
import citadelLevels from '../../public/configs/citadel-levels.json';
import { LevelEditor } from './LevelEditor';

const WIDTH = 10;
const HEIGHT = 7;
const CELL_PX = 10;
const DATA_SOURCE = { x: 2, y: 2 };
const CLOCK_SOURCE = { x: 2, y: 4 };
const LATCH = { x: 4, y: 3 };
const SWAP_LABEL_KEY = 'editor.signal_ports.swap.action_input';

const fake = new FakeIndexedDb();
let editor: LevelEditor;
let canvas: HTMLCanvasElement;
let store: Map<string, string>;

const noopContext = (): CanvasRenderingContext2D =>
  new Proxy(() => undefined, { get: () => noopContext(), set: () => true, apply: () => undefined }) as unknown as CanvasRenderingContext2D;

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element ${id}`);
  return el as T;
}

const rowsOf = (listId: string): HTMLElement[] => Array.from(byId(listId).querySelectorAll<HTMLElement>('.editor-connection-row'));
const controlledRows = (): HTMLElement[] => rowsOf('editor-connections-controlled');
const swapButtonOf = (row: HTMLElement): HTMLButtonElement => {
  const button = row.querySelector<HTMLButtonElement>('button[data-action="swap-ports"]');
  if (!button) throw new Error('Row has no Swap ports button');
  return button;
};
const rowText = (row: HTMLElement): string => row.querySelector('.editor-connection-goto')?.textContent ?? '';
const levelNow = (): CompiledLevel => editor.exportCompiledLevel();
const cursorTo = (cell: { x: number; y: number }): void => editor['moveCursorTo'](cell, false);

function room(gate: string, links: CompiledLevel['signalLinks']): CompiledLevel {
  const terrain: string[][] = Array.from({ length: HEIGHT }, (_, y) =>
    Array.from({ length: WIDTH }, (_, x) => (x === 0 || y === 0 || x === WIDTH - 1 || y === HEIGHT - 1 ? 'wall' : 'floor'))
  );
  terrain[HEIGHT - 2][WIDTH - 2] = 'exit';
  terrain[DATA_SOURCE.y][DATA_SOURCE.x] = 'signal_plate';
  terrain[CLOCK_SOURCE.y][CLOCK_SOURCE.x] = 'signal_plate';
  terrain[LATCH.y][LATCH.x] = gate;
  return {
    id: 'lvl_gate_ports_dom',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    customTitle: 'Gate ports room',
    playerStart: { x: 1, y: 1, dir: 'S' },
    terrain,
    items: terrain.map((row) => row.map(() => null as string | null)),
    entities: [],
    trapLinks: [],
    cloneLinks: [],
    ...(links ? { signalLinks: links } : {})
  };
}

const latchLinks = (): NonNullable<CompiledLevel['signalLinks']> => [
  { fromX: DATA_SOURCE.x, fromY: DATA_SOURCE.y, toX: LATCH.x, toY: LATCH.y, port: 'in0' },
  { fromX: CLOCK_SOURCE.x, fromY: CLOCK_SOURCE.y, toX: LATCH.x, toY: LATCH.y, port: 'in1' }
];

beforeEach(() => {
  loadTestConfigs();
  i18n.setLocale('en');
  fake.records.clear();
  store = new Map<string, string>();
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
  canvas.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: WIDTH * CELL_PX, bottom: HEIGHT * CELL_PX, width: WIDTH * CELL_PX, height: HEIGHT * CELL_PX, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
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

describe('gate ports in the Connections section', () => {
  it('labels each wire into a data latch with its role, in both languages', () => {
    editor.loadCompiledLevel(room('signal_gate_dlatch', latchLinks()));
    cursorTo(LATCH);
    const rows = controlledRows();
    expect(rows).toHaveLength(2);
    expect(rowText(rows[0])).toContain(t('editor.signal_ports.data.label'));
    expect(rowText(rows[1])).toContain(t('editor.signal_ports.clock.label'));
    i18n.setLocale('fr');
    editor.render();
    cursorTo(DATA_SOURCE);
    cursorTo(LATCH);
    expect(rowText(controlledRows()[1])).toContain('horloge');
  });

  it('labels the count up and count down wires of a counter', () => {
    editor.loadCompiledLevel(room('signal_counter_4', latchLinks()));
    cursorTo(LATCH);
    const rows = controlledRows();
    expect(rowText(rows[0])).toContain(t('editor.signal_ports.count_up.label'));
    expect(rowText(rows[1])).toContain(t('editor.signal_ports.count_down.label'));
  });

  it('swaps the ports from a row, says so, and undoes in one step', () => {
    const before = latchLinks();
    editor.loadCompiledLevel(room('signal_gate_dlatch', before));
    cursorTo(LATCH);
    expect(swapButtonOf(controlledRows()[0]).textContent).toBe(t(SWAP_LABEL_KEY));
    swapButtonOf(controlledRows()[0]).click();
    const swapped = levelNow().signalLinks ?? [];
    expect(swapped.find((l) => l.fromY === DATA_SOURCE.y)?.port).toBe('in1');
    expect(swapped.find((l) => l.fromY === CLOCK_SOURCE.y)?.port).toBe('in0');
    expect(byId('editor-status-bar').textContent).toContain(t('editor.signal_ports.swap.done', { name: t('editor.connections.role.signal_gate.label'), x: LATCH.x, y: LATCH.y }));
    const labelsNow = controlledRows().map(rowText);
    expect(labelsNow.find((text) => text.includes(`(${DATA_SOURCE.x}, ${DATA_SOURCE.y})`))).toContain(t('editor.signal_ports.clock.label'));
    editor.undo();
    expect(levelNow().signalLinks).toEqual(before);
    editor.redo();
    expect(levelNow().signalLinks).toEqual(swapped);
  });

  it('names the two swaps of a counter-to-latch row differently', () => {
    const level = room('signal_gate_dlatch', [{ fromX: DATA_SOURCE.x, fromY: DATA_SOURCE.y, toX: LATCH.x, toY: LATCH.y, port: 'out1>in0' }]);
    level.terrain[DATA_SOURCE.y][DATA_SOURCE.x] = 'signal_counter_0';
    editor.loadCompiledLevel(level);
    cursorTo(LATCH);
    const labels = Array.from(controlledRows()[0].querySelectorAll<HTMLButtonElement>('button[data-action="swap-ports"]')).map((b) => b.textContent);
    expect(labels).toEqual([t('editor.signal_ports.swap.action_input'), t('editor.signal_ports.swap.action_output')]);
    expect(new Set(labels).size).toBe(2);
  });

  it('offers no swap on a plain gate', () => {
    editor.loadCompiledLevel(
      room('signal_gate_and', [
        { fromX: DATA_SOURCE.x, fromY: DATA_SOURCE.y, toX: LATCH.x, toY: LATCH.y },
        { fromX: CLOCK_SOURCE.x, fromY: CLOCK_SOURCE.y, toX: LATCH.x, toY: LATCH.y }
      ])
    );
    cursorTo(LATCH);
    for (const row of controlledRows()) expect(row.querySelector('button[data-action="swap-ports"]')).toBeNull();
  });

  it('keeps the links of every native level as they are on load and save', () => {
    const natives = (citadelLevels as unknown as { levels: LevelBlueprint[] }).levels.filter((l) => (l.signalLinks?.length ?? 0) > 0);
    expect(natives.length).toBeGreaterThan(0);
    for (const blueprint of natives) {
      const compiled = ConfigRegistry.compileBlueprint(blueprint);
      editor.loadCompiledLevel(compiled);
      expect(levelNow().signalLinks, blueprint.id).toEqual(compiled.signalLinks);
    }
  });
});
