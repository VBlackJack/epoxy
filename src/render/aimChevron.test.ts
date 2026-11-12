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

/** The aim chevron: drawn on the faced edge of the player's cell while a hurl stone is held on a turn-in-place level. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../audio/AudioManager', () => ({
  AudioManager: { playSfx: vi.fn() }
}));

import { GameEngine } from '../core/GameEngine';
import { STONE_ITEM_ID } from '../core/coreConstants';
import { CompiledLevel, Direction, GraphicsStyle } from '../core/types';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { PixelRenderer } from './PixelRenderer';

const CANVAS_SIZE = 240;
const MAP_SIZE = 12;
const VIEW_TILES = 12;
const DEFAULT_CANVAS = 300;
const FRAME_MS = 16;
const BYTES = 4;
const PLAYER_CELL = { x: 5, y: 5 };
const CHEVRON_POINTS = 3;
const HALF = 2;

interface Point {
  readonly x: number;
  readonly y: number;
}

interface FakeCanvas {
  width: number;
  height: number;
  getContext(kind: string): CanvasRenderingContext2D;
}

/** Canvases that record every stroked path of exactly three points (a chevron has a tip and two arms). */
function createCanvas(width: number, height: number, paths: Point[][]): FakeCanvas {
  const props: Record<string, unknown> = {};
  let current: Point[] = [];
  const canvas: FakeCanvas = { width, height, getContext: () => ctx };
  const ctx = new Proxy(props, {
    get(target, prop: string) {
      if (prop === 'canvas') return canvas;
      if (prop in target) return target[prop];
      return (...args: unknown[]): unknown => {
        if (prop === 'beginPath') current = [];
        if (prop === 'moveTo' || prop === 'lineTo') current.push({ x: Number(args[0]), y: Number(args[1]) });
        if (prop === 'stroke' && current.length === CHEVRON_POINTS) paths.push([...current]);
        if (prop === 'createImageData') return { data: new Uint8ClampedArray(Number(args[0]) * Number(args[1]) * BYTES) };
        if (prop === 'createPattern') return {};
        if (prop.endsWith('Gradient')) return { addColorStop: () => undefined };
        return undefined;
      };
    },
    set(target, prop: string, value: unknown) {
      target[prop] = value;
      return true;
    }
  }) as unknown as CanvasRenderingContext2D;
  return canvas;
}

function level(dir: Direction, extra: Partial<CompiledLevel> = {}): CompiledLevel {
  const edge = MAP_SIZE - 1;
  const terrain: string[][] = Array.from({ length: MAP_SIZE }, (_, y) =>
    Array.from({ length: MAP_SIZE }, (_, x) => (x === 0 || y === 0 || x === edge || y === edge ? 'wall' : 'floor'))
  );
  return {
    id: 'aim-scene',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    playerStart: { ...PLAYER_CELL, dir },
    terrain,
    items: Array.from({ length: MAP_SIZE }, () => Array.from({ length: MAP_SIZE }, () => null)),
    entities: [],
    trapLinks: [],
    cloneLinks: [],
    ...extra
  };
}

describe('aim chevron', () => {
  let now = 0;
  let paths: Point[][] = [];

  beforeEach(() => {
    loadTestConfigs();
    now = 0;
    paths = [];
    vi.spyOn(performance, 'now').mockImplementation(() => (now += FRAME_MS));
    vi.stubGlobal('document', {
      createElement: (): FakeCanvas => createCanvas(DEFAULT_CANVAS, DEFAULT_CANVAS, paths)
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** Renders one frame and returns the three-point paths it stroked. */
  function frame(style: GraphicsStyle, lvl: CompiledLevel, stone: boolean, alive = true): Point[][] {
    const engine = new GameEngine();
    engine.loadLevel(lvl);
    if (stone) engine.getPlayer().keys[STONE_ITEM_ID] = 1;
    engine.getPlayer().alive = alive;
    const renderer = new PixelRenderer();
    renderer.setStyle(style);
    renderer.setViewportTiles(VIEW_TILES);
    const main = createCanvas(CANVAS_SIZE, CANVAS_SIZE, paths);
    paths.length = 0;
    renderer.renderViewport(main.getContext('2d'), engine);
    return [...paths];
  }

  const STYLES: GraphicsStyle[] = ['modern', 'retro', 'runeward'];

  for (const style of STYLES) {
    it(`${style}: draws one chevron only while the stone is held`, () => {
      const without = frame(style, level('S'), false).length;
      const withStone = frame(style, level('S'), true).length;
      expect(withStone - without).toBe(1);
    });
  }

  it('does not draw when the player is dead or the level is gated', () => {
    const baseline = frame('modern', level('S'), false).length;
    expect(frame('modern', level('S'), true, false).length).toBe(baseline);
    expect(frame('modern', level('S', { rulesFlavor: 'cc' }), true).length).toBe(baseline);
    expect(frame('modern', level('S', { ruleset: 'cc3d' }), true).length).toBe(baseline);
  });

  for (const dir of ['N', 'E', 'S', 'W'] as const) {
    it(`sits on the ${dir} edge of the player's cell with the tip outward`, () => {
      const base = frame('modern', level(dir), false);
      const added = frame('modern', level(dir), true).filter((p) => !base.some((b) => JSON.stringify(b) === JSON.stringify(p)));
      expect(added).toHaveLength(1);
      const [armA, tip, armB] = added[0];
      const tileSize = CANVAS_SIZE / VIEW_TILES;
      const centre = { x: (PLAYER_CELL.x + 0.5) * tileSize, y: (PLAYER_CELL.y + 0.5) * tileSize };
      const step = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] }[dir];
      // The tip is on the faced side and inside the cell; the arms are nearer the centre than the tip.
      expect((tip.x - centre.x) * step[0] + (tip.y - centre.y) * step[1]).toBeGreaterThan(tileSize / HALF * 0.8);
      expect(Math.abs(tip.x - centre.x) <= tileSize / HALF && Math.abs(tip.y - centre.y) <= tileSize / HALF).toBe(true);
      for (const arm of [armA, armB]) {
        expect((arm.x - centre.x) * step[0] + (arm.y - centre.y) * step[1]).toBeLessThan((tip.x - centre.x) * step[0] + (tip.y - centre.y) * step[1]);
      }
    });
  }

  it('retro: every point lands on a whole pixel', () => {
    const base = frame('retro', level('E'), false);
    const added = frame('retro', level('E'), true).filter((p) => !base.some((b) => JSON.stringify(b) === JSON.stringify(p)));
    expect(added).toHaveLength(1);
    for (const point of added[0]) {
      expect(Number.isInteger(point.x)).toBe(true);
      expect(Number.isInteger(point.y)).toBe(true);
    }
  });
});
