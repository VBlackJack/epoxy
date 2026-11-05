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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../audio/AudioManager', () => ({
  AudioManager: { playSfx: vi.fn() }
}));

import { GameEngine } from '../core/GameEngine';
import type { CompiledLevel, GridPoint } from '../core/types';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { PixelRenderer } from './PixelRenderer';

const CANVAS_PX = 240;
const MAP_SIZE = 40;
const VIEW_TILES = 10;
const TILE_PX = CANVAS_PX / VIEW_TILES;
const PLAYER_CELL = 20;
const FRAME_MS = 16;
const SETTLE_FRAMES = 80;
const PAD_INSET = 0.4;
const THEME_ID = 'cyber_neon';
/** Client rect of the canvas in the tap tests: it starts away from the origin. */
const RECT = { left: 30, top: 50, width: CANVAS_PX, height: CANVAS_PX };

interface Insets {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface FakeCanvas {
  width: number;
  height: number;
  getContext(kind: string): CanvasRenderingContext2D;
  getBoundingClientRect(): typeof RECT;
}

function createCanvas(): FakeCanvas {
  const props: Record<string, unknown> = {};
  const canvas: FakeCanvas = {
    width: CANVAS_PX,
    height: CANVAS_PX,
    getContext: () => ctx,
    getBoundingClientRect: () => RECT
  };
  const ctx = new Proxy(props, {
    get(target, prop: string) {
      if (prop === 'canvas') return canvas;
      if (prop in target) return target[prop];
      return (...args: unknown[]): unknown => {
        if (prop === 'createImageData') return { data: new Uint8ClampedArray(Number(args[0]) * Number(args[1]) * 4) };
        if (prop === 'createPattern') return {};
        if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return { addColorStop: () => undefined };
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

function bigLevel(): CompiledLevel {
  const edge = MAP_SIZE - 1;
  return {
    id: 'camera-insets',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    playerStart: { x: PLAYER_CELL, y: PLAYER_CELL, dir: 'S' },
    terrain: Array.from({ length: MAP_SIZE }, (_, y) =>
      Array.from({ length: MAP_SIZE }, (_, x) => (x === 0 || y === 0 || x === edge || y === edge ? 'wall' : 'floor'))
    ),
    items: Array.from({ length: MAP_SIZE }, () => Array.from({ length: MAP_SIZE }, () => null)),
    entities: [],
    trapLinks: [],
    cloneLinks: []
  };
}

describe('camera insets in the renderer', () => {
  beforeEach(() => {
    loadTestConfigs();
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => (now += FRAME_MS));
    vi.stubGlobal('document', { createElement: (): FakeCanvas => createCanvas() });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** Draws settled frames with the given insets and returns a function mapping a tile position of the canvas to a cell. */
  function settle(insets?: Insets): (tileX: number, tileY: number) => GridPoint | null {
    const engine = new GameEngine();
    engine.loadLevel(bigLevel());
    const renderer = new PixelRenderer();
    renderer.setThemeId(THEME_ID);
    renderer.setViewportTiles(VIEW_TILES);
    if (insets) renderer.setCameraInsets(insets);
    const canvas = createCanvas();
    for (let i = 0; i < SETTLE_FRAMES; i++) renderer.renderViewport(canvas.getContext('2d'), engine);
    return (tileX, tileY) =>
      renderer.screenToGrid(canvas as unknown as HTMLCanvasElement, RECT.left + tileX * TILE_PX, RECT.top + tileY * TILE_PX);
  }

  const centreTile = VIEW_TILES / 2;

  it('leaves the camera alone for zero or invalid insets', () => {
    const base = settle();
    expect(base(centreTile, centreTile)).toEqual({ x: PLAYER_CELL, y: PLAYER_CELL });
    const zero = settle({ left: 0, right: 0, top: 0, bottom: 0 });
    expect(zero(centreTile, centreTile)).toEqual(base(centreTile, centreTile));
    const invalid = settle({ left: Number.NaN, right: -1, top: Number.NEGATIVE_INFINITY, bottom: 0 });
    expect(invalid(centreTile, centreTile)).toEqual(base(centreTile, centreTile));
  });

  it('moves the camera so the player sits in the free area', () => {
    const padded = settle({ left: PAD_INSET, right: 0, top: 0, bottom: 0 });
    // Free span runs from the inset to the right edge; the player is drawn at its centre.
    const freeCentreTile = VIEW_TILES * (PAD_INSET + (1 - PAD_INSET) / 2);
    expect(padded(freeCentreTile, centreTile)).toEqual({ x: PLAYER_CELL, y: PLAYER_CELL });
    expect(padded(centreTile, centreTile)?.x).toBeLessThan(PLAYER_CELL);
  });

  it('clamps an out-of-range inset to half the canvas', () => {
    const huge = settle({ left: 5, right: 0, top: 0, bottom: 0 });
    const half = settle({ left: 0.5, right: 0, top: 0, bottom: 0 });
    expect(huge(centreTile, centreTile)).toEqual(half(centreTile, centreTile));
  });

  it('keeps tap mapping on the right cell with insets on both axes', () => {
    const padded = settle({ left: PAD_INSET, right: 0, top: 0, bottom: 0.2 });
    const freeCentreX = VIEW_TILES * (PAD_INSET + (1 - PAD_INSET) / 2);
    const freeCentreY = (VIEW_TILES * (1 - 0.2)) / 2;
    expect(padded(freeCentreX, freeCentreY)).toEqual({ x: PLAYER_CELL, y: PLAYER_CELL });
    // One tile to the right and below the player cell lands on the neighbouring cell.
    expect(padded(freeCentreX + 1, freeCentreY + 1)).toEqual({ x: PLAYER_CELL + 1, y: PLAYER_CELL + 1 });
  });
});
