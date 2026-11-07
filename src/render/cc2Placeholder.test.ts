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
 * The placeholder of the reserved Chip's Challenge 2 ids on recording fake canvases: a magenta checker and a short
 * glyph, the same drawing in every render style.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../audio/AudioManager', () => ({
  AudioManager: { playSfx: vi.fn() }
}));

import { ConfigRegistry } from '../config/ConfigRegistry';
import { PACK_JSON_VERSION_V12_IDS } from '../config/constants';
import { GameEngine } from '../core/GameEngine';
import type { CompiledLevel, GraphicsStyle } from '../core/types';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { CC2_GLYPH_MAX_LENGTH, cc2Glyph, isCc2Id } from './cc2Placeholder';
import { PixelRenderer } from './PixelRenderer';

const STYLES: readonly GraphicsStyle[] = ['modern', 'retro', 'retro32', 'pocket', 'pastel', 'blueprint', 'sepia', 'classic90', 'runeward'];
const SCENE_SIZE = 8;
const CANVAS_PX = 256;
const TILE_PX = 32;
const FRAME_MS = 16;
const BYTES = 4;
const THEME_ID = 'cyber_neon';
const MAGENTA = '#ff00ff';

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
        if (prop === 'createImageData') return { data: new Uint8ClampedArray(Number(args[0]) * Number(args[1]) * BYTES) };
        if (prop === 'createPattern') return {};
        if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return { addColorStop: () => undefined };
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

function room(): CompiledLevel {
  const terrain = Array.from({ length: SCENE_SIZE }, () => Array.from({ length: SCENE_SIZE }, () => 'floor'));
  return {
    id: 'cc2-render',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    playerStart: { x: 1, y: 1, dir: 'S' },
    terrain,
    items: terrain.map((row) => row.map(() => null)),
    entities: [],
    trapLinks: [],
    cloneLinks: []
  };
}

describe('cc2 placeholder glyphs', () => {
  it('gives every reserved id a non-empty glyph of at most three letters', () => {
    for (const id of PACK_JSON_VERSION_V12_IDS) {
      expect(isCc2Id(id)).toBe(true);
      const glyph = cc2Glyph(id);
      expect(glyph.length, id).toBeGreaterThan(0);
      expect(glyph.length, id).toBeLessThanOrEqual(CC2_GLYPH_MAX_LENGTH);
    }
    expect(cc2Glyph('cc2_purple_wall')).toBe('PW');
    expect(isCc2Id('wall')).toBe(false);
  });
});

describe('cc2 placeholder in every render style', () => {
  beforeEach(() => {
    loadTestConfigs();
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => (now += FRAME_MS));
    vi.stubGlobal('document', {
      createElement: (): FakeCanvas => createCanvas(CANVAS_PX, CANVAS_PX)
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function readyRenderer(style: GraphicsStyle): PixelRenderer {
    const engine = new GameEngine();
    engine.loadLevel(room());
    const renderer = new PixelRenderer();
    renderer.setStyle(style);
    renderer.setThemeId(THEME_ID);
    renderer.setViewportTiles(SCENE_SIZE);
    renderer.renderViewport(createCanvas(SCENE_SIZE * TILE_PX, SCENE_SIZE * TILE_PX).getContext('2d'), engine);
    return renderer;
  }

  function callsOf(draw: (ctx: CanvasRenderingContext2D) => void): Call[] {
    const canvas = createCanvas(CANVAS_PX, CANVAS_PX);
    draw(canvas.getContext('2d'));
    return canvas.calls;
  }

  const reservedTiles = (): string[] => Object.keys(ConfigRegistry.getCc2Tiles().tiles);
  const reservedTerrain = (): string[] => reservedTiles().filter((id) => ConfigRegistry.getTile(id).layer === 'terrain');
  const reservedItems = (): string[] => reservedTiles().filter((id) => ConfigRegistry.getTile(id).layer === 'item');
  const reservedEntities = (): string[] => Object.keys(ConfigRegistry.getCc2Tiles().entities);

  /** Draws every reserved id of every kind and returns the whole recording. */
  function drawAll(renderer: PixelRenderer): Call[] {
    return callsOf((ctx) => {
      for (const id of reservedTerrain()) renderer.drawTile(ctx, id, 0, 0, TILE_PX);
      for (const id of reservedItems()) renderer.drawItem(ctx, id, 0, 0, TILE_PX);
      for (const id of reservedEntities()) renderer.drawEntity(ctx, id, 'S', 0, 0, TILE_PX);
    });
  }

  it('is loaded before the renderer reads it', () => {
    expect(reservedTiles().length + reservedEntities().length).toBe(PACK_JSON_VERSION_V12_IDS.size);
  });

  for (const style of STYLES) {
    it(`${style}: draws a magenta checker and the glyph for every reserved id`, () => {
      const renderer = readyRenderer(style);
      const ids = [...reservedTerrain(), ...reservedItems(), ...reservedEntities()];
      for (const id of reservedTerrain()) {
        const calls = callsOf((ctx) => renderer.drawTile(ctx, id, 0, 0, TILE_PX));
        expect(calls.some((c) => c.name === 'set fillStyle' && c.args[0] === MAGENTA), id).toBe(true);
        expect(calls.some((c) => c.name === 'fillText' && c.args[0] === cc2Glyph(id)), id).toBe(true);
      }
      for (const id of reservedItems()) {
        const calls = callsOf((ctx) => renderer.drawItem(ctx, id, 0, 0, TILE_PX));
        expect(calls.some((c) => c.name === 'fillText' && c.args[0] === cc2Glyph(id)), id).toBe(true);
      }
      for (const id of reservedEntities()) {
        const calls = callsOf((ctx) => renderer.drawEntity(ctx, id, 'N', 0, 0, TILE_PX));
        expect(calls.some((c) => c.name === 'fillText' && c.args[0] === cc2Glyph(id)), id).toBe(true);
      }
      expect(ids.length).toBe(PACK_JSON_VERSION_V12_IDS.size);
    });
  }

  it('draws the same thing in every style', () => {
    const first = JSON.stringify(drawAll(readyRenderer(STYLES[0])));
    for (const style of STYLES.slice(1)) {
      expect(JSON.stringify(drawAll(readyRenderer(style))), style).toBe(first);
    }
  });

  it('draws nothing on the animated pass of a terrain', () => {
    const renderer = readyRenderer('modern');
    const id = reservedTerrain()[0];
    expect(callsOf((ctx) => renderer.drawTile(ctx, id, 0, 0, TILE_PX, false, true, 'animated'))).toEqual([]);
  });
});
