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
 * The five Retro HD styles (Pocket, Pastel, Blueprint, Sepia, Classic 90s) on recording fake
 * canvases: they draw like HD Neon with their own colours, every cached sprite is keyed by the
 * style, colours drawn outside tiles go through the style, gradients are banded, nothing glows,
 * Classic 90s draws no floor shadows and no lights, each overlay is painted once and blitted, and
 * an unusable palette degrades to the HD Neon colours. A frame costs no more gradients and image
 * blits than HD Neon, apart from the one overlay blit.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../audio/AudioManager', () => ({
  AudioManager: { playSfx: vi.fn() }
}));

import { ConfigRegistry } from '../config/ConfigRegistry';
import { GameEngine } from '../core/GameEngine';
import type { CompiledLevel, GraphicsStyle, ThemePalette } from '../core/types';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { PixelRenderer } from './PixelRenderer';
import { RENDER_STYLES, getRenderStyle } from './styles/renderStyles';

const SCENE_SIZE = 12;
const WALL_EDGE = SCENE_SIZE - 1;
const PLAYER_CELL = 5;
const FRAME_MS = 16;
const DEFAULT_CANVAS = 300;
const BYTES = 4;
const TILE_PX = 32;
const SMALL_TILE_PX = 16;
const FRAMES = 3;
const KEY_SEPARATOR = '|';
const THEME_ID = 'cyber_neon';
const DERIVED_IDS: readonly GraphicsStyle[] = ['pocket', 'pastel', 'blueprint', 'sepia', 'classic90'];
/** Cache key kinds that hold a colour of the palette and so carry the style id right after the kind. */
const STYLED_SPRITE_KINDS = ['item', 'entity', 'player', 'shadow', 'force', 'exitDisc', 'teleRing', 'teleCore'];
const GRADIENT_CALLS = ['createLinearGradient', 'createRadialGradient'];

interface Call {
  readonly name: string;
  readonly args: unknown[];
}

interface FakeCanvas {
  width: number;
  height: number;
  readonly calls: Call[];
  getContext(kind: string): CanvasRenderingContext2D;
  toDataURL(): string;
}

function createCanvas(width: number, height: number): FakeCanvas {
  const calls: Call[] = [];
  const props: Record<string, unknown> = {};
  const canvas: FakeCanvas = { width, height, calls, getContext: () => ctx, toDataURL: () => '' };
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
        if (GRADIENT_CALLS.includes(prop)) {
          return {
            addColorStop(offset: number, colour: string): void {
              calls.push({ name: 'addColorStop', args: [offset, colour] });
            }
          };
        }
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
  const placements: Record<string, [number, number]> = {
    water: [2, 2],
    fire: [3, 2],
    ice: [4, 2],
    force_e: [5, 2],
    exit: [6, 2],
    teleport: [7, 2],
    trap: [3, 4],
    door_red: [4, 4],
    wall: [3, 7]
  };
  for (const [tileId, [x, y]] of Object.entries(placements)) terrain[y][x] = tileId;
  const items: (string | null)[][] = Array.from({ length: SCENE_SIZE }, () =>
    Array.from({ length: SCENE_SIZE }, () => null)
  );
  items[7][6] = 'chip';
  items[7][7] = 'key_red';
  items[8][2] = 'bomb';
  return {
    id: 'derived-scene',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    playerStart: { x: PLAYER_CELL, y: PLAYER_CELL, dir: 'S' },
    terrain,
    items,
    entities: [
      { x: 8, y: 8, type: 'bug', dir: 'E' },
      { x: 4, y: 6, type: 'dirt_block', dir: 'S' }
    ],
    trapLinks: [],
    cloneLinks: []
  };
}

interface Internals {
  retroCanvases: Map<string, unknown>;
  sprites: Map<string, unknown>;
  particles: unknown[];
  overlayCanvas: unknown;
  visualViewportTiles: number;
  pal(): Record<string, string>;
  getActiveTheme(): ThemePalette | undefined;
}

describe('Retro HD styles scene', () => {
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

  /** Renders frames of the scene in `style` on a canvas where a tile is `tilePx` pixels wide. */
  function render(
    style: GraphicsStyle,
    options: { tilePx?: number; frames?: number; renderer?: PixelRenderer; path?: boolean } = {}
  ): { main: FakeCanvas; renderer: PixelRenderer } {
    const { tilePx = TILE_PX, frames = 1, renderer = new PixelRenderer(), path = false } = options;
    created.length = 0;
    const engine = new GameEngine();
    engine.loadLevel(sceneLevel());
    renderer.setStyle(style);
    renderer.setThemeId(THEME_ID);
    renderer.setViewportTiles(SCENE_SIZE);
    // Start with the zoom settled, so the size of a tile does not ease from frame to frame.
    internals(renderer).visualViewportTiles = SCENE_SIZE;
    if (path) renderer.setPlannedPath([{ x: 4, y: 5 }, { x: 4, y: 6 }]);
    const main = createCanvas(SCENE_SIZE * tilePx, SCENE_SIZE * tilePx);
    for (let frame = 0; frame < frames; frame++) {
      renderer.renderViewport(main.getContext('2d'), engine);
      renderer.incrementFrame();
    }
    return { main, renderer };
  }

  const internals = (renderer: PixelRenderer): Internals => renderer as unknown as Internals;
  const allCanvases = (main: FakeCanvas): FakeCanvas[] => [main, ...created];
  const callsNamed = (main: FakeCanvas, ...names: string[]): Call[] =>
    allCanvases(main).flatMap((canvas) => canvas.calls.filter((c) => names.includes(c.name)));
  const spriteKeys = (renderer: PixelRenderer): string[] => [...internals(renderer).sprites.keys()];
  const kindOf = (key: string): string => key.split(KEY_SEPARATOR)[0];
  const additive = (main: FakeCanvas): Call[] =>
    callsNamed(main, 'set globalCompositeOperation').filter((c) => c.args[0] === 'lighter');

  it('cycles through every style with the G key and back to HD Neon', () => {
    const renderer = new PixelRenderer();
    expect(renderer.getStyle()).toBe('modern');
    const seen = RENDER_STYLES.slice(1).map(() => renderer.toggleStyle());
    expect(seen).toEqual(RENDER_STYLES.slice(1).map((s) => s.id));
    expect(renderer.toggleStyle()).toBe('modern');
  });

  for (const id of DERIVED_IDS) {
    it(`${id}: draws the vector scene, composes no retro sprite and keys every cached sprite by its id`, () => {
      const { main, renderer } = render(id, { frames: 2 });
      expect(internals(renderer).retroCanvases.size).toBe(0);
      expect(callsNamed(main, 'drawImage').length).toBeGreaterThan(0);
      const keys = spriteKeys(renderer);
      expect(keys.length).toBeGreaterThan(0);
      const styled = keys.filter((key) => STYLED_SPRITE_KINDS.includes(kindOf(key)));
      expect(styled.length).toBeGreaterThan(0);
      for (const key of styled) expect(key.split(KEY_SEPARATOR)[1], key).toBe(id);
    });
  }

  it('keeps the cached sprites of two styles apart on one renderer', () => {
    const { renderer } = render('pocket');
    render('pastel', { renderer });
    const styleOf = (key: string): string => key.split(KEY_SEPARATOR)[1];
    const styles = new Set(spriteKeys(renderer).filter((k) => STYLED_SPRITE_KINDS.includes(kindOf(k))).map(styleOf));
    expect(styles).toEqual(new Set(['pocket', 'pastel']));
  });

  it('keeps the shadow, force floor, exit and teleporter sprites per style', () => {
    const { renderer } = render('blueprint');
    const kinds = new Set(spriteKeys(renderer).map(kindOf));
    for (const kind of ['shadow', 'force', 'exitDisc', 'teleRing', 'teleCore']) expect(kinds.has(kind), kind).toBe(true);
  });

  for (const id of DERIVED_IDS) {
    it(`${id}: still draws recoloured vector tiles on tiles as small as a 16-pixel sprite`, () => {
      const { main, renderer } = render(id, { tilePx: SMALL_TILE_PX });
      expect(internals(renderer).retroCanvases.size).toBe(0);
      expect(callsNamed(main, 'addColorStop').length).toBeGreaterThan(0);
      expect(spriteKeys(renderer).length).toBeGreaterThan(0);
    });
  }

  it('draws Sepia floor shadows but none in Classic 90s', () => {
    expect(spriteKeys(render('sepia').renderer).some((k) => kindOf(k) === 'shadow')).toBe(true);
    const classic = render('classic90').renderer;
    expect(spriteKeys(classic).length).toBeGreaterThan(0);
    expect(spriteKeys(classic).some((k) => kindOf(k) === 'shadow')).toBe(false);
  });

  it('keeps HD Neon floor shadows exactly where they were', () => {
    expect(spriteKeys(render('modern').renderer).some((k) => kindOf(k) === 'shadow')).toBe(true);
  });

  it('lights the four styles with lighting and leaves Classic 90s unlit', () => {
    for (const id of DERIVED_IDS) {
      const { main } = render(id);
      const lit = additive(main).length > 0;
      expect(lit, id).toBe(getRenderStyle(id).lighting);
    }
  });

  it('draws particles in all five styles', () => {
    for (const id of DERIVED_IDS) {
      const { renderer } = render(id);
      renderer.triggerVisualEvent('chip', PLAYER_CELL, PLAYER_CELL);
      expect(internals(renderer).particles.length, id).toBeGreaterThan(0);
    }
  });

  it('allows the LCD grid in none of the five styles, whatever the player chose', () => {
    for (const id of DERIVED_IDS) {
      const renderer = new PixelRenderer();
      renderer.setLcdEnabled(true);
      renderer.setStyle(id);
      expect(renderer.isLcdEnabled(), id).toBe(false);
    }
  });

  it('never glows in the five styles while HD Neon does', () => {
    const blurs = (id: GraphicsStyle): number[] =>
      callsNamed(render(id, { frames: 2 }).main, 'set shadowBlur').map((c) => Number(c.args[0]));
    for (const id of DERIVED_IDS) {
      const values = blurs(id);
      expect(values.length, id).toBeGreaterThan(0);
      expect(Math.max(...values), id).toBe(0);
    }
    expect(Math.max(...blurs('modern'))).toBeGreaterThan(0);
  });

  it('cuts every gradient into hard bands: three for the Retro HD styles, two for Classic 90s', () => {
    const stopsPerGradient = (id: GraphicsStyle): Set<number> => {
      const sizes = new Set<number>();
      for (const canvas of allCanvases(render(id).main)) {
        let count = 0;
        for (const call of canvas.calls) {
          if (GRADIENT_CALLS.includes(call.name)) {
            if (count > 0) sizes.add(count);
            count = 0;
          } else if (call.name === 'addColorStop') {
            count++;
          }
        }
        if (count > 0) sizes.add(count);
      }
      return sizes;
    };
    for (const id of ['pocket', 'pastel', 'blueprint', 'sepia'] as const) expect([...stopsPerGradient(id)], id).toEqual([6]);
    expect([...stopsPerGradient('classic90')]).toEqual([4]);
    expect([...stopsPerGradient('modern')].sort()).toEqual([2, 3]);
  });

  it('passes the colours drawn outside tiles through the style', () => {
    const original = ConfigRegistry.getGame().palette;
    for (const id of ['modern', 'retro', 'retro32'] as const) {
      const renderer = new PixelRenderer();
      renderer.setStyle(id);
      expect(internals(renderer).pal(), id).toBe(original);
    }
    for (const id of DERIVED_IDS) {
      const renderer = new PixelRenderer();
      renderer.setStyle(id);
      renderer.setThemeId(THEME_ID);
      const styled = internals(renderer).pal();
      expect(styled, id).not.toBe(original);
      for (const key of ['pathLine', 'linkTrap', 'objectiveRing', 'irisShade', 'hintSign']) {
        expect(styled[key], `${id} ${key}`).not.toBe(original[key]);
      }
      const theme = internals(renderer).getActiveTheme();
      const raw = ConfigRegistry.getGame().themes?.[THEME_ID];
      expect(theme?.floorTop, id).not.toBe(raw?.floorTop);
      // The HUD keeps following the accent of the biome as game.json declares it.
      expect(renderer.getThemeAccent(), id).toBe(raw?.accentGlow);
    }
  });

  it('strokes the planned path in the colour of the styled theme', () => {
    for (const id of DERIVED_IDS) {
      const { main, renderer } = render(id, { path: true });
      const accent = internals(renderer).getActiveTheme()?.accentGlow;
      const strokes = callsNamed(main, 'set strokeStyle').map((c) => c.args[0]);
      expect(strokes, id).toContain(accent);
      expect(accent, id).not.toBe(ConfigRegistry.getGame().themes?.[THEME_ID].accentGlow);
    }
  });

  it('draws the editor tiles and icons with the colours of the style', () => {
    for (const id of DERIVED_IDS) {
      const renderer = new PixelRenderer();
      renderer.setStyle(id);
      const canvas = createCanvas(TILE_PX, TILE_PX);
      renderer.drawTile(canvas.getContext('2d'), 'floor', 0, 0, TILE_PX, true, true);
      const fills = canvas.calls.filter((c) => c.name === 'set fillStyle').map((c) => c.args[0]);
      expect(fills, id).toContain(internals(renderer).pal().floorBase);
      expect(internals(renderer).pal().floorBase).not.toBe(ConfigRegistry.getGame().palette.floorBase);
    }
  });

  it('rebuilds the colours when the theme changes and keeps them while nothing does', () => {
    const renderer = new PixelRenderer();
    renderer.setStyle('sepia');
    renderer.setThemeId('cyber_neon');
    const first = internals(renderer).pal();
    expect(internals(renderer).pal()).toBe(first);
    const accentBefore = internals(renderer).getActiveTheme()?.accentGlow;
    renderer.setThemeId('magma_core');
    expect(internals(renderer).getActiveTheme()?.accentGlow).not.toBe(accentBefore);
  });

  it('draws with the HD Neon colours, and says why once, when the palette of a style is unusable', () => {
    const report = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const original = ConfigRegistry.getGame().palette;
    delete (ConfigRegistry.getGame() as { renderStylePalettes?: unknown }).renderStylePalettes;
    const { main, renderer } = render('sepia', { frames: 2 });
    expect(internals(renderer).pal()).toBe(original);
    expect(callsNamed(main, 'drawImage').length).toBeGreaterThan(0);
    expect(report).toHaveBeenCalledTimes(1);
    expect(String(report.mock.calls[0][1])).toContain('renderStylePalettes');
  });

  it('reports an unusable palette once per config, whatever changes after', () => {
    const report = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    delete (ConfigRegistry.getGame() as { renderStylePalettes?: unknown }).renderStylePalettes;
    const { renderer } = render('sepia');
    renderer.setThemeId('magma_core');
    internals(renderer).pal();
    renderer.setStyle('pocket');
    internals(renderer).pal();
    expect(report).toHaveBeenCalledTimes(1);
  });

  it('does the same when the family table is unusable', () => {
    const report = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    delete (ConfigRegistry.getGame() as { renderStyleFamilies?: unknown }).renderStyleFamilies;
    const { renderer } = render('pocket');
    expect(internals(renderer).pal()).toBe(ConfigRegistry.getGame().palette);
    expect(report).toHaveBeenCalledTimes(1);
    expect(String(report.mock.calls[0][1])).toContain('renderStyleFamilies');
  });

  describe('overlays', () => {
    /** The texture the renderer holds for the view, or null when the style has none. */
    const textureOf = (renderer: PixelRenderer): FakeCanvas | null => internals(renderer).overlayCanvas as FakeCanvas | null;

    it('paints the texture of Pocket, Blueprint, Sepia and Classic 90s once, and none for Pastel', () => {
      for (const id of DERIVED_IDS) {
        const { main, renderer } = render(id, { frames: FRAMES });
        const texture = textureOf(renderer);
        expect(texture !== null, id).toBe(getRenderStyle(id).finish?.overlay !== null);
        if (!texture) continue;
        const blits = main.calls.filter((c) => c.name === 'drawImage' && c.args[0] === texture);
        expect(blits.length, id).toBe(FRAMES);
        // Painting it again every frame would add calls to the texture: one frame gives the same log.
        expect(texture.calls.length, id).toBe(textureOf(render(id).renderer)?.calls.length);
      }
    });

    it('repaints the texture when the view changes size and not otherwise', () => {
      const { renderer } = render('blueprint', { frames: 2 });
      const first = textureOf(renderer);
      expect(first).not.toBeNull();
      render('blueprint', { renderer });
      expect(textureOf(renderer)).toBe(first);
      render('blueprint', { renderer, tilePx: TILE_PX * 2 });
      expect(textureOf(renderer)).not.toBe(first);
    });

    it('repaints the texture when an overlay setting changes', () => {
      const { renderer } = render('blueprint');
      const first = textureOf(renderer);
      const game = ConfigRegistry.getGame();
      game.graphics = { ...game.graphics!, overlayGridDivisions: 4 } as typeof game.graphics;
      render('blueprint', { renderer });
      expect(textureOf(renderer)).not.toBe(first);
    });

    it('skips the texture at the lowest quality', () => {
      const renderer = new PixelRenderer();
      renderer.setQuality('low');
      const { main } = render('classic90', { renderer });
      expect(textureOf(renderer)).toBeNull();
      expect(main.calls.filter((c) => c.name === 'drawImage' && (c.args[0] as FakeCanvas).calls.some((k) => k.name === 'rect'))).toHaveLength(0);
    });

    it('paints each texture with its own shapes: dots, grid lines, rings with grain, scanlines', () => {
      const shapes = (id: GraphicsStyle): { rects: number; alphas: Set<number> } => {
        const texture = textureOf(render(id).renderer) as FakeCanvas;
        return {
          rects: texture.calls.filter((c) => c.name === 'rect').length,
          alphas: new Set(texture.calls.filter((c) => c.name === 'set globalAlpha').map((c) => Number(c.args[0])))
        };
      };
      const sizes = new Set(['pocket', 'blueprint', 'sepia', 'classic90'].map((id) => shapes(id as GraphicsStyle).rects));
      expect(sizes.size).toBe(4);
      expect(shapes('sepia').alphas.size).toBeGreaterThan(2);
    });
  });

  describe('frame cost', () => {
    const count = (id: GraphicsStyle, ...names: string[]): number => {
      return callsNamed(render(id, { frames: FRAMES }).main, ...names).length;
    };

    it('issues no more gradients than HD Neon on the same scene', () => {
      const modern = count('modern', ...GRADIENT_CALLS);
      expect(modern).toBeGreaterThan(0);
      for (const id of DERIVED_IDS) expect(count(id, ...GRADIENT_CALLS), id).toBeLessThanOrEqual(modern);
    });

    it('issues no more image blits than HD Neon, apart from the one overlay blit of each frame', () => {
      const modern = count('modern', 'drawImage');
      expect(modern).toBeGreaterThan(0);
      for (const id of DERIVED_IDS) {
        const overlayBlits = getRenderStyle(id).finish?.overlay ? FRAMES : 0;
        expect(count(id, 'drawImage'), id).toBeLessThanOrEqual(modern + overlayBlits);
      }
    });
  });
});
