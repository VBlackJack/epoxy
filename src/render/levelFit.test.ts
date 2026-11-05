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

import { ConfigRegistry } from '../config/ConfigRegistry';
import { GameEngine } from '../core/GameEngine';
import type { CompiledLevel } from '../core/types';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { PixelRenderer } from './PixelRenderer';
import { RENDER_STYLES } from './styles/renderStyles';
import { LEVEL_FIT_MAX_ZOOM, LEVEL_FIT_MIN_TILES_SHORT_SIDE, levelTilePixelSize } from './viewMapping';

const NO_RESERVE = { left: 0, right: 0, top: 0, bottom: 0 };
const PHONE_LANDSCAPE = { width: 915, height: 412 };
const PHONE_PAD_RESERVE = 0.19;
const DESKTOP = { width: 1548, height: 863 };
const PORTRAIT = { width: 390, height: 844 };
const ROWS = 13;
const FRAME_MS = 16;
const SETTLE_FRAMES = 80;
const THEME_ID = 'cyber_neon';
const CSS_COLOUR = /^(#[0-9a-f]{6}|rgb\(\d{1,3}, \d{1,3}, \d{1,3}\))$/i;
const TILE_EPSILON = 0.01;
const TEST_CANVAS_W = 400;
const TEST_CANVAS_H = 240;
const SQUARE_CANVAS = 240;

function fit(canvas: { width: number; height: number }, mapW: number, mapH: number, reserve = NO_RESERVE): number {
  return levelTilePixelSize(
    canvas.width,
    canvas.height,
    mapW,
    mapH,
    ROWS,
    reserve,
    LEVEL_FIT_MAX_ZOOM,
    LEVEL_FIT_MIN_TILES_SHORT_SIDE
  );
}

describe('levelTilePixelSize', () => {
  it('grows the tile on a phone landscape board with a pad on the right', () => {
    const tile = fit(PHONE_LANDSCAPE, 13, 13, { ...NO_RESERVE, right: PHONE_PAD_RESERVE });
    expect(tile).toBeCloseTo(47.5, 0);
    expect(PHONE_LANDSCAPE.height / tile).toBeCloseTo(8.7, 1);
  });

  it('keeps the base size for a map that scrolls', () => {
    const base = PHONE_LANDSCAPE.height / ROWS;
    expect(fit(PHONE_LANDSCAPE, 32, 32, { ...NO_RESERVE, right: PHONE_PAD_RESERVE })).toBeCloseTo(base, 6);
  });

  it('shows the whole level on a desktop canvas when the map fits at base', () => {
    const tile = fit(DESKTOP, 13, 13);
    expect(13 * tile).toBeLessThanOrEqual(DESKTOP.height + TILE_EPSILON);
    expect(13 * tile).toBeLessThanOrEqual(DESKTOP.width);
    const small = fit(DESKTOP, 9, 7);
    expect(9 * small).toBeLessThanOrEqual(DESKTOP.width);
    expect(7 * small).toBeLessThanOrEqual(DESKTOP.height + TILE_EPSILON);
  });

  it('stays within the zoom caps in portrait with a bottom reserve', () => {
    const reserve = { ...NO_RESERVE, bottom: 0.3 };
    const base = PORTRAIT.width / ROWS;
    const tile = fit(PORTRAIT, 13, 13, reserve);
    expect(tile).toBeGreaterThanOrEqual(base);
    expect(tile).toBeLessThanOrEqual(LEVEL_FIT_MAX_ZOOM * base + TILE_EPSILON);
    expect(tile).toBeLessThanOrEqual(PORTRAIT.width / LEVEL_FIT_MIN_TILES_SHORT_SIDE + TILE_EPSILON);
    // The free height (70 percent of 844) over 13 rows is above the zoom cap, so the cap decides.
    expect(tile).toBeCloseTo(LEVEL_FIT_MAX_ZOOM * base, 6);
  });

  it('never drops below the base size and never exceeds the zoom caps', () => {
    const base = PHONE_LANDSCAPE.height / ROWS;
    const tiny = fit(PHONE_LANDSCAPE, 2, 2, { ...NO_RESERVE, right: PHONE_PAD_RESERVE });
    expect(tiny).toBeLessThanOrEqual(LEVEL_FIT_MAX_ZOOM * base + TILE_EPSILON);
    expect(fit(PHONE_LANDSCAPE, 200, 200)).toBeCloseTo(base, 6);
  });
});

interface FakeCanvas {
  width: number;
  height: number;
  getContext(kind: string): CanvasRenderingContext2D;
  getBoundingClientRect(): { left: number; top: number; width: number; height: number };
}

function createCanvas(width: number, height: number): FakeCanvas {
  const props: Record<string, unknown> = {};
  const canvas: FakeCanvas = {
    width,
    height,
    getContext: () => ctx,
    getBoundingClientRect: () => ({ left: 0, top: 0, width, height })
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

function level(id: string, size: number, start: number): CompiledLevel {
  const edge = size - 1;
  return {
    id,
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    playerStart: { x: start, y: start, dir: 'S' },
    terrain: Array.from({ length: size }, (_, y) =>
      Array.from({ length: size }, (_, x) => (x === 0 || y === 0 || x === edge || y === edge ? 'wall' : 'floor'))
    ),
    items: Array.from({ length: size }, () => Array.from({ length: size }, () => null)),
    entities: [],
    trapLinks: [],
    cloneLinks: []
  };
}

describe('level fit in the renderer', () => {
  beforeEach(() => {
    loadTestConfigs();
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => (now += FRAME_MS));
    vi.stubGlobal('document', { createElement: (): FakeCanvas => createCanvas(1, 1) });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function setup(size: number, start: number, rows: number): { engine: GameEngine; renderer: PixelRenderer } {
    const engine = new GameEngine();
    engine.loadLevel(level('fit-a', size, start));
    const renderer = new PixelRenderer();
    renderer.setThemeId(THEME_ID);
    renderer.setViewportTiles(rows);
    return { engine, renderer };
  }

  function draw(renderer: PixelRenderer, engine: GameEngine, canvas: FakeCanvas, frames: number): void {
    for (let i = 0; i < frames; i++) renderer.renderViewport(canvas.getContext('2d'), engine);
  }

  it('keeps the field of view maths in the default mode', () => {
    const canvas = createCanvas(TEST_CANVAS_W, TEST_CANVAS_H);
    const a = setup(40, 20, 10);
    draw(a.renderer, a.engine, canvas, SETTLE_FRAMES);
    const b = setup(40, 20, 10);
    b.renderer.setFitMode('fov');
    b.renderer.setFitReserve({ left: 0.2, right: 0.2, top: 0, bottom: 0 });
    draw(b.renderer, b.engine, canvas, SETTLE_FRAMES);
    expect(a.renderer.getFrameTileFraction()).toBeCloseTo(TEST_CANVAS_H / 10 / TEST_CANVAS_W, 9);
    expect(b.renderer.getFrameTileFraction()).toBe(a.renderer.getFrameTileFraction());
    const el = canvas as unknown as HTMLCanvasElement;
    expect(b.renderer.screenToGrid(el, 200, 120)).toEqual(a.renderer.screenToGrid(el, 200, 120));
  });

  it('sizes the tile from the level on the first frame and maps taps with it', () => {
    const canvas = createCanvas(TEST_CANVAS_W, TEST_CANVAS_H);
    const { engine, renderer } = setup(13, 6, ROWS);
    renderer.setFitMode('level');
    renderer.setFitReserve({ ...NO_RESERVE, right: PHONE_PAD_RESERVE });
    draw(renderer, engine, canvas, 1);
    const expected = fit({ width: TEST_CANVAS_W, height: TEST_CANVAS_H }, 13, 13, { ...NO_RESERVE, right: PHONE_PAD_RESERVE });
    expect(renderer.getFrameTileFraction() * TEST_CANVAS_W).toBeCloseTo(expected, 6);
    const el = canvas as unknown as HTMLCanvasElement;
    // The map is 13 tiles wide and centred horizontally in the free span (no insets set).
    const left = (TEST_CANVAS_W - 13 * expected) / 2;
    expect(renderer.screenToGrid(el, left - 2, TEST_CANVAS_H / 2)).toBeNull();
    expect(renderer.screenToGrid(el, left + 3.5 * expected, TEST_CANVAS_H / 2)?.x).toBe(3);
    // The map is taller than the canvas, so the player row sits at the vertical centre.
    expect(renderer.screenToGrid(el, left + 6.5 * expected, TEST_CANVAS_H / 2)).toEqual({ x: 6, y: 6 });
  });

  it('snaps the zoom and camera when another map is loaded', () => {
    const canvas = createCanvas(SQUARE_CANVAS, SQUARE_CANVAS);
    const { engine, renderer } = setup(40, 20, 10);
    renderer.setFitMode('level');
    draw(renderer, engine, canvas, SETTLE_FRAMES);
    const el = canvas as unknown as HTMLCanvasElement;
    expect(renderer.screenToGrid(el, SQUARE_CANVAS / 2, SQUARE_CANVAS / 2)).toEqual({ x: 20, y: 20 });
    engine.loadLevel(level('fit-b', 30, 2));
    draw(renderer, engine, canvas, 1);
    // First frame of the new map: the camera sits at its corner, not gliding from the old one.
    expect(renderer.screenToGrid(el, 1, 1)).toEqual({ x: 0, y: 0 });
    expect(renderer.getFrameTileFraction()).toBeCloseTo(SQUARE_CANVAS / 10 / SQUARE_CANVAS, 9);
  });

  it('eases the zoom on a field of view change even with a reserve and insets set', () => {
    const canvas = createCanvas(TEST_CANVAS_W, TEST_CANVAS_H);
    const { engine, renderer } = setup(40, 20, 10);
    renderer.setFitMode('level');
    renderer.setFitReserve({ ...NO_RESERVE, right: PHONE_PAD_RESERVE });
    renderer.setCameraInsets({ ...NO_RESERVE, right: PHONE_PAD_RESERVE });
    draw(renderer, engine, canvas, SETTLE_FRAMES);
    const before = renderer.getFrameTileFraction();
    renderer.setViewportTiles(20);
    // The insets follow the tile size on a phone, so they change together with the preset.
    renderer.setCameraInsets({ ...NO_RESERVE, right: PHONE_PAD_RESERVE / 2 });
    draw(renderer, engine, canvas, 1);
    const target = TEST_CANVAS_H / 20 / TEST_CANVAS_W;
    const after = renderer.getFrameTileFraction();
    expect(after).toBeLessThan(before);
    expect(after).toBeGreaterThan(target);
  });

  it('keeps a steady zoom while the same level is drawn again', () => {
    const canvas = createCanvas(SQUARE_CANVAS, SQUARE_CANVAS);
    const { engine, renderer } = setup(40, 20, 10);
    renderer.setFitMode('level');
    draw(renderer, engine, canvas, SETTLE_FRAMES);
    const before = renderer.getFrameTileFraction();
    draw(renderer, engine, canvas, 3);
    expect(renderer.getFrameTileFraction()).toBe(before);
  });
});

describe('getBackdropColour', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('returns a valid colour for every style and theme', () => {
    const themeIds = Object.keys(ConfigRegistry.getGame().themes as unknown as Record<string, unknown>);
    expect(themeIds.length).toBeGreaterThan(0);
    for (const style of RENDER_STYLES) {
      for (const themeId of themeIds) {
        const renderer = new PixelRenderer();
        renderer.setStyle(style.id);
        renderer.setThemeId(themeId);
        expect(renderer.getBackdropColour(), `${style.id}/${themeId}`).toMatch(CSS_COLOUR);
      }
    }
  });

  it('never throws, even for an unknown theme', () => {
    const renderer = new PixelRenderer();
    renderer.setThemeId('no-such-theme');
    expect(renderer.getBackdropColour()).toMatch(CSS_COLOUR);
  });

  it('is darker than the theme wall colour', () => {
    const renderer = new PixelRenderer();
    renderer.setThemeId(THEME_ID);
    const themes = ConfigRegistry.getGame().themes as unknown as Record<string, { wallBottom: string }>;
    const wall = themes[THEME_ID].wallBottom;
    const channel = (hex: string, at: number): number => parseInt(hex.slice(1 + at * 2, 3 + at * 2), 16);
    const [r, g, b] = (renderer.getBackdropColour().match(/\d+/g) ?? []).map(Number);
    expect(r).toBeLessThanOrEqual(channel(wall, 0));
    expect(g).toBeLessThanOrEqual(channel(wall, 1));
    expect(b).toBeLessThanOrEqual(channel(wall, 2));
  });
});
