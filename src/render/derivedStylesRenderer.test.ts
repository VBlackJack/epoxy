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
 * The five recolouring styles (Pocket, Pastel, Blueprint, Sepia, Classic 90s) on recording fake
 * canvases: every style composes its tiles under its own spec id, the small-tile fallback keeps
 * the recolouring, Classic 90s draws no floor shadows, lights or particles, colours drawn outside
 * the sprites go through the style, and an unusable palette degrades to the flat drawer.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../audio/AudioManager', () => ({
  AudioManager: { playSfx: vi.fn() }
}));

import { ConfigRegistry } from '../config/ConfigRegistry';
import { GameEngine } from '../core/GameEngine';
import type { CompiledLevel, GraphicsStyle } from '../core/types';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { PixelRenderer } from './PixelRenderer';
import { RETRO_SPRITE_SIZE } from './retroSprites';
import { RENDER_STYLES } from './styles/renderStyles';
import { parseHexColour } from './retro32/colour';

const SCENE_SIZE = 12;
const WALL_EDGE = SCENE_SIZE - 1;
const PLAYER_CELL = 5;
const FRAME_MS = 16;
const DEFAULT_CANVAS = 300;
const BYTES = 4;
const FULL_SIZE_TILE = 32;
const KEY_SEPARATOR = '|';
/** Position of the shadow signature among the last parts of a composed canvas key (it precedes the extent). */
const SHADOW_PART_FROM_END = 2;
const NO_SHADOW = '0';
const DERIVED_IDS: readonly GraphicsStyle[] = ['pocket', 'pastel', 'blueprint', 'sepia', 'classic90'];
const PATH_COLOUR = '#00e5ff';

interface Call {
  readonly name: string;
  readonly args: unknown[];
}

interface FakeCanvas {
  width: number;
  height: number;
  readonly calls: Call[];
  getContext(kind: string): CanvasRenderingContext2D;
}

function createCanvas(width: number, height: number): FakeCanvas {
  const calls: Call[] = [];
  const props: Record<string, unknown> = {};
  const canvas: FakeCanvas = { width, height, calls, getContext: () => ctx };
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

function sceneLevel(): CompiledLevel {
  const terrain: string[][] = Array.from({ length: SCENE_SIZE }, (_, y) =>
    Array.from({ length: SCENE_SIZE }, (_, x) => (x === 0 || y === 0 || x === WALL_EDGE || y === WALL_EDGE ? 'wall' : 'floor'))
  );
  const items: (string | null)[][] = Array.from({ length: SCENE_SIZE }, () =>
    Array.from({ length: SCENE_SIZE }, () => null)
  );
  items[3][3] = 'chip';
  return {
    id: 'derived-scene',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    playerStart: { x: PLAYER_CELL, y: PLAYER_CELL, dir: 'S' },
    terrain,
    items,
    entities: [],
    trapLinks: [],
    cloneLinks: []
  };
}

interface Internals {
  retroCanvases: Map<string, unknown>;
  particles: unknown[];
  styleColour(colour: string): string;
}

describe('recolouring styles scene', () => {
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

  /** Renders one frame of the scene in `style` on a canvas where a tile is `tilePx` pixels wide. */
  function render(style: GraphicsStyle, tilePx = FULL_SIZE_TILE, renderer = new PixelRenderer()): { main: FakeCanvas; renderer: PixelRenderer } {
    const engine = new GameEngine();
    engine.loadLevel(sceneLevel());
    renderer.setStyle(style);
    renderer.setThemeId('cyber_neon');
    renderer.setViewportTiles(SCENE_SIZE);
    const main = createCanvas(SCENE_SIZE * tilePx, SCENE_SIZE * tilePx);
    renderer.renderViewport(main.getContext('2d'), engine);
    return { main, renderer };
  }

  const keysOf = (renderer: PixelRenderer): string[] => [...(renderer as unknown as Internals).retroCanvases.keys()];
  const additive = (canvas: FakeCanvas): Call[] =>
    canvas.calls.filter((c) => c.name === 'set globalCompositeOperation' && c.args[0] === 'lighter');

  it('cycles through every style with the G key and back to HD Neon', () => {
    const renderer = new PixelRenderer();
    expect(renderer.getStyle()).toBe('modern');
    const seen = RENDER_STYLES.slice(1).map(() => renderer.toggleStyle());
    expect(seen).toEqual(RENDER_STYLES.slice(1).map((s) => s.id));
    expect(renderer.toggleStyle()).toBe('modern');
  });

  for (const id of DERIVED_IDS) {
    it(`${id}: composes its tiles under its own spec id`, () => {
      const { renderer } = render(id);
      const keys = keysOf(renderer);
      expect(keys.length).toBeGreaterThan(0);
      for (const key of keys) expect(key.startsWith(`${id}${KEY_SEPARATOR}`)).toBe(true);
    });
  }

  it('keeps the tiles of two styles apart on one renderer', () => {
    const { renderer } = render('pocket');
    render('retro', FULL_SIZE_TILE, renderer);
    const prefixes = new Set(keysOf(renderer).map((k) => k.split(KEY_SEPARATOR)[0]));
    expect(prefixes).toEqual(new Set(['pocket', 'retro']));
  });

  for (const id of ['sepia', 'classic90'] as const) {
    it(`${id}: recoloured 16-pixel sprites on tiles smaller than its own`, () => {
      const { renderer } = render(id, RETRO_SPRITE_SIZE);
      const keys = keysOf(renderer);
      expect(keys.length).toBeGreaterThan(0);
      for (const key of keys) expect(key.startsWith(`${id}-16${KEY_SEPARATOR}`)).toBe(true);
    });
  }

  it('draws Sepia floor shadows but none in Classic 90s', () => {
    const shadowOf = (key: string): string => key.split(KEY_SEPARATOR).slice(-SHADOW_PART_FROM_END)[0];
    const sepia = keysOf(render('sepia').renderer).map(shadowOf);
    expect(sepia.some((s) => s !== NO_SHADOW)).toBe(true);
    const classic = keysOf(render('classic90').renderer).map(shadowOf);
    expect(classic.length).toBeGreaterThan(0);
    expect(classic.every((s) => s === NO_SHADOW)).toBe(true);
  });

  it('draws no lights in any recolouring style and no particles in Classic 90s', () => {
    for (const id of DERIVED_IDS) {
      const { main } = render(id);
      expect(additive(main), id).toHaveLength(0);
      for (const canvas of created) expect(additive(canvas), id).toHaveLength(0);
    }
    const { renderer } = render('classic90');
    renderer.triggerVisualEvent('chip', PLAYER_CELL, PLAYER_CELL);
    expect((renderer as unknown as Internals).particles).toHaveLength(0);
  });

  it('allows the LCD grid in Pocket only', () => {
    expect(render('pocket').renderer.getStyle()).toBe('pocket');
    for (const id of DERIVED_IDS) {
      const renderer = new PixelRenderer();
      renderer.setLcdEnabled(true);
      renderer.setStyle(id);
      expect(renderer.isLcdEnabled(), id).toBe(id === 'pocket');
    }
  });

  it('passes the colours drawn outside sprites through the style', () => {
    const colourIn = (id: GraphicsStyle): string => {
      const renderer = new PixelRenderer();
      renderer.setStyle(id);
      return (renderer as unknown as Internals).styleColour(PATH_COLOUR);
    };
    expect(colourIn('modern')).toBe(PATH_COLOUR);
    expect(colourIn('retro')).toBe(PATH_COLOUR);
    expect(colourIn('retro32')).toBe(PATH_COLOUR);
    const stops = ConfigRegistry.getGame().renderStylePalettes?.pocket.stops ?? [];
    expect(stops).toContain(colourIn('pocket'));
    const [r, g, b] = parseHexColour(colourIn('pocket'));
    expect(g).toBeGreaterThan(r);
    expect(g).toBeGreaterThan(b);
    for (const id of DERIVED_IDS) expect(colourIn(id), id).not.toBe(PATH_COLOUR);
  });

  it('draws the flat fallback, and says why, when the palette of a style is unusable', () => {
    const report = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    delete (ConfigRegistry.getGame() as { renderStylePalettes?: unknown }).renderStylePalettes;
    const { renderer } = render('sepia');
    expect(keysOf(renderer)).toHaveLength(0);
    expect(report).toHaveBeenCalledTimes(1);
    expect(String(report.mock.calls[0][1])).toContain('renderStylePalettes');
    render('retro', FULL_SIZE_TILE, renderer);
    expect(keysOf(renderer).length).toBeGreaterThan(0);
  });
});
