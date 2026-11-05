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

describe('32-Bit Retro scene', () => {
  const created: FakeCanvas[] = [];
  let now = 0;
  const SPRITE_32 = 32;
  const SCENE_32 = SCENE_SIZE * SPRITE_32;
  /** A canvas on which a tile is exactly one 32-Bit sprite, so sprites are never shrunk. */
  const CANVAS_32 = SCENE_32;
  /** Keys of the composed canvases that start with this style id. */
  const keysOf = (renderer: PixelRenderer, styleId: string): string[] =>
    [...(renderer as unknown as { retroCanvases: Map<string, FakeCanvas> }).retroCanvases.keys()].filter((k) =>
      k.startsWith(`${styleId}|`)
    );

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

  function render32(setup?: (renderer: PixelRenderer) => void, frames = 1): { main: FakeCanvas; renderer: PixelRenderer } {
    const engine = new GameEngine();
    engine.loadLevel(sceneLevel());
    const renderer = new PixelRenderer();
    renderer.setStyle('retro32');
    renderer.setThemeId('cyber_neon');
    renderer.setViewportTiles(SCENE_SIZE);
    setup?.(renderer);
    const main = createCanvas(CANVAS_32, CANVAS_32);
    for (let frame = 0; frame < frames; frame++) renderer.renderViewport(main.getContext('2d'), engine);
    return { main, renderer };
  }

  /** Calls that set the blend mode of a canvas to additive. */
  const additiveCalls = (canvas: FakeCanvas): Call[] =>
    canvas.calls.filter((c) => c.name === 'set globalCompositeOperation' && c.args[0] === 'lighter');

  it('cycles modern, 16-Bit, 32-Bit, then the recolouring and Runeward styles, and back', () => {
    const renderer = new PixelRenderer();
    expect(renderer.getStyle()).toBe('modern');
    expect(renderer.toggleStyle()).toBe('retro');
    expect(renderer.toggleStyle()).toBe('retro32');
    for (const id of ['pocket', 'pastel', 'blueprint', 'sepia', 'classic90', 'runeward', 'runeward_parchment']) expect(renderer.toggleStyle()).toBe(id);
    expect(renderer.toggleStyle()).toBe('modern');
  });

  it('draws the scene at 32 pixels per tile from 32x32 sprites', () => {
    const { main } = render32();
    const scene = created.find((c) => c.width === SCENE_32 && c.height === SCENE_32);
    expect(scene).toBeDefined();
    const sprites = created.filter((c) => c.width === SPRITE_32 && c.height === SPRITE_32 && c !== scene);
    expect(sprites.some((c) => c.calls.some((call) => call.name === 'putImageData'))).toBe(true);
    expect(created.filter((c) => c.width === RETRO_SPRITE_SIZE && c.height === RETRO_SPRITE_SIZE)).toHaveLength(0);
    const upscale = main.calls.find((c) => c.name === 'drawImage')!;
    expect((upscale.args[0] as FakeCanvas).width).toBe(SCENE_32);
    for (const blit of scene!.calls.filter((c) => c.name === 'drawImage')) {
      expect(Number.isInteger(blit.args[1])).toBe(true);
      expect(Number.isInteger(blit.args[2])).toBe(true);
    }
  });

  it('snaps the camera to a 32nd of a tile', () => {
    const { renderer } = render32();
    const frame = (renderer as unknown as { lastFrame: { camX: number; camY: number } }).lastFrame;
    expect(Number.isInteger(frame.camX * SPRITE_32)).toBe(true);
    expect(Number.isInteger(frame.camY * SPRITE_32)).toBe(true);
  });

  it('forces the LCD grid off but remembers the preference', () => {
    const grid = vi.spyOn(PixelRenderer.prototype as unknown as { drawLcdGrid(): void }, 'drawLcdGrid');
    const { renderer } = render32((r) => r.setLcdEnabled(true), 2);
    expect(renderer.isLcdEnabled()).toBe(false);
    expect(renderer.getLcdPreference()).toBe(true);
    expect(grid).not.toHaveBeenCalled();
    renderer.setStyle('retro');
    expect(renderer.isLcdEnabled()).toBe(true);
    renderer.setStyle('modern');
    expect(renderer.isLcdEnabled()).toBe(false);
    expect(renderer.getLcdPreference()).toBe(true);
  });

  it('lights the scene additively over the scaled-up pixels', () => {
    const { main } = render32();
    expect(additiveCalls(main).length).toBeGreaterThan(0);
  });

  it('keeps 16-Bit without lights, particles or shine', () => {
    const engine = new GameEngine();
    engine.loadLevel(sceneLevel());
    const renderer = new PixelRenderer();
    renderer.setStyle('retro');
    renderer.setThemeId('cyber_neon');
    renderer.setViewportTiles(SCENE_SIZE);
    const main = createCanvas(CANVAS_32, CANVAS_32);
    renderer.triggerVisualEvent('chip', 5, 5);
    renderer.renderViewport(main.getContext('2d'), engine);
    expect(additiveCalls(main)).toHaveLength(0);
    const internals = renderer as unknown as { particles: unknown[]; shockwaves: unknown[] };
    expect(internals.particles).toHaveLength(0);
    expect(internals.shockwaves).toHaveLength(0);
    const scene = created.find((c) => c.width === SCENE_SIZE * RETRO_SPRITE_SIZE)!;
    expect(additiveCalls(scene)).toHaveLength(0);
  });

  it('spawns particles in 32-Bit, which has effects', () => {
    const { renderer } = render32();
    renderer.triggerVisualEvent('chip', 5, 5);
    expect((renderer as unknown as { particles: unknown[] }).particles.length).toBeGreaterThan(0);
  });

  it('sweeps a shine over items and blocks from the animation frame', () => {
    render32();
    const scene = created.find((c) => c.width === SCENE_32)!;
    expect(additiveCalls(scene).length).toBeGreaterThan(0);
  });

  it('rests the shine outside the sweep frames', () => {
    const engine = new GameEngine();
    engine.loadLevel(sceneLevel());
    const renderer = new PixelRenderer();
    renderer.setStyle('retro32');
    renderer.setThemeId('cyber_neon');
    renderer.setViewportTiles(SCENE_SIZE);
    const resting = 59;
    for (let i = 0; i < resting; i++) renderer.incrementFrame();
    renderer.renderViewport(createCanvas(CANVAS_32, CANVAS_32).getContext('2d'), engine);
    const scene = created.find((c) => c.width === SCENE_32)!;
    expect(additiveCalls(scene)).toHaveLength(0);
  });

  it('draws no shine under reduced motion', () => {
    render32((r) => r.setReducedMotion(true));
    const scene = created.find((c) => c.width === SCENE_32)!;
    expect(additiveCalls(scene)).toHaveLength(0);
  });

  it('draws no shine on low quality', () => {
    render32((r) => r.setQuality('low'));
    const scene = created.find((c) => c.width === SCENE_32)!;
    expect(additiveCalls(scene)).toHaveLength(0);
  });

  it('puts the style id in every cache key so switching styles never mixes canvases', () => {
    const renderer = new PixelRenderer();
    renderer.setThemeId('cyber_neon');
    const main = createCanvas(CANVAS_32, CANVAS_32).getContext('2d');
    const cache = (renderer as unknown as { retroCanvases: Map<string, FakeCanvas> }).retroCanvases;
    renderer.setStyle('retro');
    renderer.drawItem(main, 'chip', 0, 0, RETRO_SPRITE_SIZE);
    renderer.setStyle('retro32');
    renderer.drawItem(main, 'chip', 0, 0, SPRITE_32);
    expect(cache.size).toBe(2);
    expect(keysOf(renderer, 'retro')).toHaveLength(1);
    expect(keysOf(renderer, 'retro32')).toHaveLength(1);
    const sizes = [...cache.entries()].map(([key, canvas]) => [key.split('|')[0], canvas.width]);
    expect(sizes).toContainEqual(['retro', RETRO_SPRITE_SIZE]);
    expect(sizes).toContainEqual(['retro32', SPRITE_32]);
    const before = created.length;
    renderer.setStyle('retro');
    renderer.drawItem(main, 'chip', 0, 0, RETRO_SPRITE_SIZE);
    expect(cache.size).toBe(2);
    expect(created.length).toBe(before);
  });

  it('puts the style id in the terrain cache key', () => {
    const { renderer } = render32();
    const internals = renderer as unknown as { terrainCacheKey: string };
    expect(internals.terrainCacheKey.startsWith('retro32|retro32|')).toBe(true);
  });

  it('falls back to the 16-Bit sprites when the 32-Bit ramps cannot be derived', () => {
    const report = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    ConfigRegistry.getGame().retro32Palettes = { default: { floor: ['not-a-colour'] } };
    const { main, renderer } = render32(undefined, 2);
    expect(report).toHaveBeenCalledTimes(1);
    expect(String(report.mock.calls[0][0])).toContain('32-Bit');
    // 16 px sprites on a 16 px per tile scene: still the sprite path, not the flat drawer.
    expect(created.filter((c) => c.width === SPRITE_32 && c.height === SPRITE_32)).toHaveLength(0);
    expect(created.some((c) => c.width === RETRO_SPRITE_SIZE && c.calls.some((call) => call.name === 'putImageData'))).toBe(true);
    expect(created.some((c) => c.width === SCENE_SIZE * RETRO_SPRITE_SIZE)).toBe(true);
    expect(keysOf(renderer, 'retro').length).toBeGreaterThan(0);
    expect(keysOf(renderer, 'retro32')).toHaveLength(0);
    expect(main.calls.filter((c) => c.name === 'drawImage').length).toBeGreaterThan(0);
  });

  it('applies a block cover in 32-Bit: the tile under a block is not drawn', () => {
    const fireDrawn = (blockAt: number): boolean => {
      const spy = vi.spyOn(PixelRenderer.prototype as unknown as { getRetroCanvas(l: { name: string }[]): unknown }, 'getRetroCanvas');
      const engine = new GameEngine();
      engine.loadLevel(sceneLevel({ tiles: [[8, 8, 'fire']], entities: [{ x: blockAt, y: 8, type: 'dirt_block', dir: 'S' }] }));
      const renderer = new PixelRenderer();
      renderer.setStyle('retro32');
      renderer.setThemeId('cyber_neon');
      renderer.setViewportTiles(SCENE_SIZE);
      renderer.renderViewport(createCanvas(CANVAS_32, CANVAS_32).getContext('2d'), engine);
      const names = spy.mock.calls.flatMap((call) => call[0].map((layer) => layer.name));
      spy.mockRestore();
      return names.some((n) => n.startsWith('fire_'));
    };
    expect(fireDrawn(8)).toBe(false);
    expect(fireDrawn(7)).toBe(true);
  });

  it('renders icons in every style', () => {
    vi.stubGlobal('document', {
      createElement: (): FakeCanvas & { toDataURL(): string } => ({
        ...createCanvas(DEFAULT_CANVAS, DEFAULT_CANVAS),
        toDataURL: () => 'data:fake'
      })
    });
    for (const style of ['modern', 'retro', 'retro32'] as const) {
      const renderer = new PixelRenderer();
      renderer.setStyle(style);
      renderer.setThemeId('cyber_neon');
      expect(renderer.renderIconToDataUrl('tile', 'wall')).toBe('data:fake');
      expect(renderer.renderIconToDataUrl('item', 'chip')).toBe('data:fake');
      expect(renderer.renderIconToDataUrl('entity', 'bug')).toBe('data:fake');
    }
  });
  interface RendererInternals {
    terrainCacheKey: string;
    spriteStyleMemo: { ramps16: unknown; cacheEntries: number } | null;
    retroCanvases: Map<string, FakeCanvas>;
    retro32CacheSize: number;
    frameGuard: { record(frameMs: number, budget: { frameBudgetMs: number; frameBudgetWindow: number }): boolean };
    effectiveQuality: string;
  }

  /** The pixels uploaded to a composed canvas. */
  const uploadedPixels = (canvas: FakeCanvas): Uint8ClampedArray | undefined =>
    (canvas.calls.find((c) => c.name === 'putImageData')?.args[0] as { data: Uint8ClampedArray } | undefined)?.data;

  it('rebuilds the sprites, the cache keys and the pixels when the theme changes', () => {
    const engine = new GameEngine();
    engine.loadLevel(sceneLevel());
    const renderer = new PixelRenderer();
    renderer.setStyle('retro32');
    renderer.setThemeId('cyber_neon');
    renderer.setViewportTiles(SCENE_SIZE);
    const main = createCanvas(CANVAS_32, CANVAS_32).getContext('2d');
    renderer.renderViewport(main, engine);
    const internals = renderer as unknown as RendererInternals;
    const memoBefore = internals.spriteStyleMemo;
    const keyBefore = internals.terrainCacheKey;
    const before = new Map(internals.retroCanvases);
    expect(memoBefore).not.toBeNull();

    renderer.setThemeId('arctic_lab');
    renderer.renderViewport(main, engine);

    expect(internals.spriteStyleMemo).not.toBe(memoBefore);
    expect(internals.spriteStyleMemo?.ramps16).not.toBe(memoBefore?.ramps16);
    expect(internals.terrainCacheKey).not.toBe(keyBefore);
    expect(internals.terrainCacheKey).toContain('arctic_lab');
    const keys = [...internals.retroCanvases.keys()];
    expect(keys.some((k) => k.split('|')[1] === 'arctic_lab')).toBe(true);
    // The same layer stack composed for the other theme has other pixels.
    const differs = keys.some((key) => {
      const [styleId, theme, ...rest] = key.split('|');
      if (theme !== 'arctic_lab') return false;
      const old = before.get([styleId, 'cyber_neon', ...rest].join('|'));
      const fresh = uploadedPixels(internals.retroCanvases.get(key)!);
      const previous = old ? uploadedPixels(old) : undefined;
      return !!fresh && !!previous && fresh.some((v, n) => v !== previous[n]);
    });
    expect(differs).toBe(true);
  });

  it('draws a boots_force item with the green swap ramp', () => {
    const spy = vi.spyOn(
      PixelRenderer.prototype as unknown as { getRetroCanvas(l: { name: string; swap?: string }[]): unknown },
      'getRetroCanvas'
    );
    const renderer = new PixelRenderer();
    renderer.setStyle('retro32');
    renderer.setThemeId('cyber_neon');
    renderer.drawItem(createCanvas(CANVAS_32, CANVAS_32).getContext('2d'), 'boots_force', 0, 0, SPRITE_32);
    const layers = spy.mock.calls.flatMap((call) => call[0]);
    expect(layers.some((layer) => layer.swap === 'green')).toBe(true);
  });

  it('keeps the sprite cache size in the memo key', () => {
    const { renderer } = render32();
    const internals = renderer as unknown as RendererInternals;
    const before = internals.spriteStyleMemo;
    ConfigRegistry.getGame().graphics = {
      ...ConfigRegistry.getGame().graphics,
      retro32SpriteCacheMaxEntries: 7
    } as never;
    const engine = new GameEngine();
    engine.loadLevel(sceneLevel());
    renderer.renderViewport(createCanvas(CANVAS_32, CANVAS_32).getContext('2d'), engine);
    expect(internals.spriteStyleMemo).not.toBe(before);
    expect(internals.spriteStyleMemo?.cacheEntries).toBe(7);
    expect(internals.retro32CacheSize).toBe(7);
  });

  it('degrades to the 16-Bit sprites when a tile is smaller than a 32-Bit sprite', () => {
    const small = 24;
    const canvasSize = SCENE_SIZE * small;
    const { renderer } = render32((r) => r.setViewportTiles(SCENE_SIZE), 1);
    expect(created.some((c) => c.width === SCENE_32 && c.height === SCENE_32)).toBe(true);
    // Again at 24 px per tile on a fresh renderer.
    created.length = 0;
    const engine = new GameEngine();
    engine.loadLevel(sceneLevel());
    const shrunk = new PixelRenderer();
    shrunk.setStyle('retro32');
    shrunk.setThemeId('cyber_neon');
    shrunk.setViewportTiles(SCENE_SIZE);
    shrunk.renderViewport(createCanvas(canvasSize, canvasSize).getContext('2d'), engine);
    expect(created.some((c) => c.width === SCENE_SIZE * RETRO_SPRITE_SIZE)).toBe(true);
    expect(created.filter((c) => c.width === SPRITE_32 && c.height === SPRITE_32)).toHaveLength(0);
    expect(keysOf(shrunk, 'retro').length).toBeGreaterThan(0);
    expect(keysOf(shrunk, 'retro32')).toHaveLength(0);
    expect((shrunk as unknown as RendererInternals).terrainCacheKey.startsWith('retro32|retro|')).toBe(true);
    expect(renderer.getStyle()).toBe('retro32');
  });

  it('turns lights and effects off when the style has no sprite source', () => {
    ConfigRegistry.getGame().retroPalettes = undefined;
    const { main, renderer } = render32();
    expect(additiveCalls(main)).toHaveLength(0);
    renderer.triggerVisualEvent('chip', 5, 5);
    expect((renderer as unknown as { particles: unknown[] }).particles).toHaveLength(0);
  });

  describe('automatic quality', () => {
    const TINY_BUDGET = { frameBudgetMs: 1, frameBudgetWindow: 3 };

    it('does not step down because of the frame that rebuilt after a style or theme change', () => {
      const engine = new GameEngine();
      engine.loadLevel(sceneLevel());
      const renderer = new PixelRenderer();
      renderer.setStyle('retro32');
      renderer.setThemeId('cyber_neon');
      renderer.setViewportTiles(SCENE_SIZE);
      ConfigRegistry.getGame().graphics = { ...ConfigRegistry.getGame().graphics, ...TINY_BUDGET } as never;
      const lowered = vi.fn();
      renderer.setOnQualityLowered(lowered);
      const main = createCanvas(CANVAS_32, CANVAS_32).getContext('2d');
      // Every frame costs FRAME_MS (16 ms), over the 1 ms budget. Two frames fill part of the window.
      renderer.renderViewport(main, engine);
      renderer.renderViewport(main, engine);
      renderer.setThemeId('arctic_lab');
      // The window restarts: the rebuilding frame is not timed, so two slow frames do not close it.
      renderer.renderViewport(main, engine);
      renderer.renderViewport(main, engine);
      expect(lowered).not.toHaveBeenCalled();
      expect(renderer.getEffectiveQuality()).toBe('high');
      // Frames that really are slow still step quality down.
      renderer.renderViewport(main, engine);
      renderer.renderViewport(main, engine);
      expect(lowered).toHaveBeenCalledTimes(1);
    });
  });
});
