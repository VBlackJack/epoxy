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
 * The 16-Bit Retro scene on recording fake canvases: it is drawn on a canvas with one pixel per
 * sprite pixel, scaled onto the main canvas once with smoothing off, and the LCD grid follows the
 * sprite pixels.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../audio/AudioManager', () => ({
  AudioManager: { playSfx: vi.fn() }
}));

import { ConfigRegistry } from '../config/ConfigRegistry';
import { GameEngine } from '../core/GameEngine';
import { CompiledLevel } from '../core/types';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { LCD_GAP_RATIO, PixelRenderer } from './PixelRenderer';
import { RETRO_SPRITE_SIZE } from './retroSprites';

const CANVAS_SIZE = 240;
const SCENE_SIZE = 12;
const PLAYER_CELL = 5;
const FRAME_MS = 16;
const DEFAULT_CANVAS = 300;
const BYTES = 4;

interface Call {
  readonly name: string;
  readonly args: unknown[];
}

interface FakeCanvas {
  width: number;
  height: number;
  readonly calls: Call[];
  readonly props: Record<string, unknown>;
  getContext(kind: string): CanvasRenderingContext2D;
}

function createCanvas(width: number, height: number): FakeCanvas {
  const calls: Call[] = [];
  const props: Record<string, unknown> = {};
  const canvas: FakeCanvas = {
    width,
    height,
    calls,
    props,
    getContext: () => ctx
  };
  const ctx = new Proxy(props, {
    get(target, prop: string) {
      if (prop === 'canvas') return canvas;
      if (prop in target) return target[prop];
      return (...args: unknown[]): unknown => {
        calls.push({ name: prop, args });
        if (prop === 'createImageData') {
          return { data: new Uint8ClampedArray(Number(args[0]) * Number(args[1]) * BYTES) };
        }
        if (prop === 'createPattern') return {};
        return undefined;
      };
    },
    set(target, prop: string, value: unknown) {
      target[prop] = value;
      calls.push({ name: `set ${prop}`, args: [value] });
      return true;
    }
  }) as unknown as CanvasRenderingContext2D;
  return canvas;
}

interface LevelOptions {
  size?: number;
  /** Tile ids placed after the border, as [x, y, tileId]. */
  tiles?: readonly (readonly [number, number, string])[];
  entities?: CompiledLevel['entities'];
  trapLinks?: CompiledLevel['trapLinks'];
  player?: { x: number; y: number };
}

function sceneLevel(options: LevelOptions = {}): CompiledLevel {
  const size = options.size ?? SCENE_SIZE;
  const edge = size - 1;
  const terrain: string[][] = Array.from({ length: size }, (_, y) =>
    Array.from({ length: size }, (_, x) => (x === 0 || y === 0 || x === edge || y === edge ? 'wall' : 'floor'))
  );
  terrain[2][2] = 'water';
  terrain[2][3] = 'force_e';
  for (const [x, y, tileId] of options.tiles ?? []) terrain[y][x] = tileId;
  const items: (string | null)[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => null)
  );
  items[3][3] = 'chip';
  return {
    id: 'retro-scene',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    playerStart: { x: options.player?.x ?? PLAYER_CELL, y: options.player?.y ?? PLAYER_CELL, dir: 'S' },
    terrain,
    items,
    entities: options.entities ?? [{ x: 8, y: 8, type: 'bug', dir: 'E' }],
    trapLinks: options.trapLinks ?? [],
    cloneLinks: []
  };
}

describe('16-Bit Retro scene', () => {
  const created: FakeCanvas[] = [];
  let now = 0;

  beforeEach(() => {
    loadTestConfigs();
    created.length = 0;
    now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => (now += FRAME_MS));
    vi.stubGlobal('document', {
      createElement: (): FakeCanvas => {
        const canvas = createCanvas(DEFAULT_CANVAS, DEFAULT_CANVAS);
        created.push(canvas);
        return canvas;
      }
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  interface RenderOptions {
    level?: LevelOptions;
    width?: number;
    height?: number;
    frames?: number;
    setup?: (renderer: PixelRenderer) => void;
  }

  let lastRenderer: PixelRenderer;

  function render(options: RenderOptions = {}): FakeCanvas {
    const engine = new GameEngine();
    engine.loadLevel(sceneLevel(options.level));
    const renderer = new PixelRenderer();
    lastRenderer = renderer;
    renderer.setStyle('retro');
    renderer.setThemeId('cyber_neon');
    renderer.setViewportTiles(SCENE_SIZE);
    options.setup?.(renderer);
    const main = createCanvas(options.width ?? CANVAS_SIZE, options.height ?? CANVAS_SIZE);
    for (let frame = 0; frame < (options.frames ?? 1); frame++) {
      renderer.renderViewport(main.getContext('2d'), engine);
    }
    return main;
  }

  /** Names of every sprite layer the renderer composed while `body` ran. */
  function composedLayerNames(body: () => void): Set<string> {
    const names = new Set<string>();
    const spy = vi.spyOn(PixelRenderer.prototype as unknown as { getRetroCanvas(l: { name: string }[]): unknown }, 'getRetroCanvas');
    body();
    for (const call of spy.mock.calls) for (const layer of call[0]) names.add(layer.name);
    return names;
  }

  it('scales a one-pixel-per-sprite-pixel canvas onto the main canvas once, smoothing off', () => {
    const main = render();
    const scale = CANVAS_SIZE / SCENE_SIZE / RETRO_SPRITE_SIZE;
    const blits = main.calls.filter((c) => c.name === 'drawImage');
    expect(blits).toHaveLength(1);
    const [source, dx, dy, dw, dh] = blits[0].args as [FakeCanvas, number, number, number, number];
    expect(source.width).toBe(Math.ceil(CANVAS_SIZE / scale));
    expect(source.height).toBe(Math.ceil(CANVAS_SIZE / scale));
    expect([dx, dy]).toEqual([0, 0]);
    expect(dw).toBeCloseTo(source.width * scale);
    expect(dh).toBeCloseTo(source.height * scale);
    const names = main.calls.map((c) => c.name);
    const smoothingOff = main.calls.findIndex((c) => c.name === 'set imageSmoothingEnabled' && c.args[0] === false);
    expect(smoothingOff).toBeGreaterThanOrEqual(0);
    expect(smoothingOff).toBeLessThan(names.indexOf('drawImage'));
  });

  it('draws every sprite on whole low-res pixels with smoothing off', () => {
    render();
    const sceneCanvas = created.find((c) => c.width === Math.ceil(CANVAS_SIZE / (CANVAS_SIZE / SCENE_SIZE / RETRO_SPRITE_SIZE)));
    expect(sceneCanvas).toBeDefined();
    const blits = sceneCanvas!.calls.filter((c) => c.name === 'drawImage');
    expect(blits.length).toBeGreaterThan(0);
    for (const blit of blits) {
      expect(Number.isInteger(blit.args[1])).toBe(true);
      expect(Number.isInteger(blit.args[2])).toBe(true);
    }
    // Sprites are drawn from 16x16 canvases, each blit inside a save with smoothing off.
    const spriteBlits = created
      .filter((c) => c.width === RETRO_SPRITE_SIZE && c.height === RETRO_SPRITE_SIZE)
      .flatMap((c) => c.calls);
    expect(spriteBlits.some((c) => c.name === 'putImageData')).toBe(true);
  });

  it('draws the LCD grid on the sprite pixel boundaries of the scaled scene', () => {
    render({ setup: (renderer) => renderer.setLcdEnabled(true), frames: 2 });
    const scale = CANVAS_SIZE / SCENE_SIZE / RETRO_SPRITE_SIZE;
    const gap = Math.max(1, Math.round(scale * LCD_GAP_RATIO));
    // The grid is painted once on its own canvas and blitted on later frames.
    const gridCanvases = created.filter((c) => c.calls.some((call) => call.name === 'rect'));
    expect(gridCanvases).toHaveLength(1);
    const rects = gridCanvases[0].calls.filter((c) => c.name === 'rect');
    expect(rects.length).toBeGreaterThan(0);
    const columns = rects.filter((c) => c.args[1] === 0 && c.args[2] === gap);
    expect(columns.map((c) => c.args[0])).toContain(Math.round(scale) - gap);
    expect(columns.map((c) => c.args[0])).toContain(Math.round(7 * scale) - gap);
  });

  it('falls back to the flat drawer when the config carries no retro palettes', () => {
    ConfigRegistry.getGame().retroPalettes = undefined;
    const main = render();
    expect(created.filter((c) => c.width === RETRO_SPRITE_SIZE && c.height === RETRO_SPRITE_SIZE)).toHaveLength(0);
    // The terrain cache canvas is blitted straight onto the main canvas at full resolution.
    const [source] = main.calls.find((c) => c.name === 'drawImage')!.args as [FakeCanvas];
    expect(source.width).toBeGreaterThan(CANVAS_SIZE);
  });

  it('turns smoothing off on the scene canvas and on the upscale', () => {
    const main = render();
    const scene = created.find((c) => c.width === Math.ceil(CANVAS_SIZE / (CANVAS_SIZE / SCENE_SIZE / RETRO_SPRITE_SIZE)))!;
    expect(scene.props.imageSmoothingEnabled).toBe(false);
    const upscale = main.calls.findIndex((c) => c.name === 'drawImage');
    expect(main.calls[upscale - 1]).toMatchObject({ name: 'set imageSmoothingEnabled', args: [false] });
  });

  it('draws a trap closed without a held button and open under one', () => {
    const closed = composedLayerNames(() => render({ level: { tiles: [[7, 3, 'trap']] } }));
    expect(closed.has('trap_closed')).toBe(true);
    expect(closed.has('trap_open')).toBe(false);
    vi.restoreAllMocks();
    vi.spyOn(performance, 'now').mockImplementation(() => (now += FRAME_MS));
    const open = composedLayerNames(() =>
      render({ level: { tiles: [[7, 3, 'trap'], [PLAYER_CELL, PLAYER_CELL, 'button_brown']] } })
    );
    expect(open.has('trap_open')).toBe(true);
    expect(open.has('trap_closed')).toBe(false);
  });

  it('marks a block standing on a block target', () => {
    const covered = composedLayerNames(() =>
      render({ level: { tiles: [[8, 8, 'block_target']], entities: [{ x: 8, y: 8, type: 'dirt_block', dir: 'S' }] } })
    );
    expect(covered.has('block_on_target')).toBe(true);
    expect(covered.has('dirt_block')).toBe(true);
    vi.restoreAllMocks();
    vi.spyOn(performance, 'now').mockImplementation(() => (now += FRAME_MS));
    const apart = composedLayerNames(() =>
      render({ level: { tiles: [[8, 8, 'block_target']], entities: [{ x: 7, y: 8, type: 'dirt_block', dir: 'S' }] } })
    );
    expect(apart.has('block_on_target')).toBe(false);
  });

  it('draws a map smaller than the view, on a non-square canvas, on whole sprite pixels', () => {
    const small = 6;
    const main = render({
      level: { size: small, player: { x: 3, y: 3 }, entities: [] },
      width: CANVAS_SIZE,
      height: CANVAS_SIZE / 2
    });
    const frame = (lastRenderer as unknown as { lastFrame: { camX: number; camY: number } }).lastFrame;
    // The camera is centred on the map and snapped to a sprite pixel.
    expect(frame.camX).toBeLessThan(0);
    expect(Number.isInteger(frame.camX * RETRO_SPRITE_SIZE)).toBe(true);
    expect(Number.isInteger(frame.camY * RETRO_SPRITE_SIZE)).toBe(true);
    expect(main.calls.filter((c) => c.name === 'drawImage')).toHaveLength(1);
    const scale = main.height / SCENE_SIZE / RETRO_SPRITE_SIZE;
    const scene = created.find((c) => c.width === Math.ceil(main.width / scale))!;
    expect(scene.height).toBe(Math.ceil(main.height / scale));
    for (const blit of scene.calls.filter((c) => c.name === 'drawImage')) {
      expect(Number.isInteger(blit.args[1])).toBe(true);
      expect(Number.isInteger(blit.args[2])).toBe(true);
    }
  });

  it('keeps the least recently used sprites when the retro cache is full', () => {
    // Settings are resolved once per graphics object, so the limit goes in a new object.
    const game = ConfigRegistry.getGame();
    game.graphics = { ...game.graphics, retroSpriteCacheMaxEntries: 2 } as typeof game.graphics;
    const renderer = new PixelRenderer();
    renderer.setStyle('retro');
    renderer.setThemeId('cyber_neon');
    const main = createCanvas(CANVAS_SIZE, CANVAS_SIZE).getContext('2d');
    const cache = (renderer as unknown as { retroCanvases: Map<string, unknown> }).retroCanvases;
    renderer.drawItem(main, 'chip', 0, 0, RETRO_SPRITE_SIZE);
    renderer.drawItem(main, 'bomb', 0, 0, RETRO_SPRITE_SIZE);
    renderer.drawItem(main, 'chip', 0, 0, RETRO_SPRITE_SIZE);
    renderer.drawItem(main, 'key_red', 0, 0, RETRO_SPRITE_SIZE);
    expect(cache.size).toBe(2);
    const keys = [...cache.keys()];
    expect(keys.some((k) => k.includes('chip'))).toBe(true);
    expect(keys.some((k) => k.includes('key'))).toBe(true);
    expect(keys.some((k) => k.includes('bomb'))).toBe(false);
  });

  it('rejects invalid palettes once, reports them and falls back to the flat drawer', () => {
    const report = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const game = ConfigRegistry.getGame();
    game.retroPalettes!.default.floor = ['#123456'];
    const main = render();
    expect(report).toHaveBeenCalledTimes(1);
    expect(String(report.mock.calls[0][1])).toContain('not 9-bit');
    expect(created.filter((c) => c.width === RETRO_SPRITE_SIZE && c.height === RETRO_SPRITE_SIZE)).toHaveLength(0);
    expect(main.calls.filter((c) => c.name === 'drawImage').length).toBeGreaterThan(1);
  });

  it('drops what it composed when the palettes object is replaced', () => {
    const renderer = new PixelRenderer();
    renderer.setStyle('retro');
    renderer.setThemeId('cyber_neon');
    const main = createCanvas(CANVAS_SIZE, CANVAS_SIZE).getContext('2d');
    renderer.drawItem(main, 'chip', 0, 0, RETRO_SPRITE_SIZE);
    const internals = renderer as unknown as { retroCanvases: Map<string, unknown>; terrainCacheKey: string };
    expect(internals.retroCanvases.size).toBe(1);
    internals.terrainCacheKey = 'stale';
    const game = ConfigRegistry.getGame();
    game.retroPalettes = structuredClone(game.retroPalettes);
    renderer.drawItem(main, 'bomb', 0, 0, RETRO_SPRITE_SIZE);
    expect(internals.retroCanvases.size).toBe(1);
    expect(internals.terrainCacheKey).toBe('');
  });
});
