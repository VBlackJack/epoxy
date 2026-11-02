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
 * The display ids of the cc3d ruleset on recording fake canvases: every id draws something in every
 * render style, a tile draws over the style's own floor, and the painters stay inside their tile.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../audio/AudioManager', () => ({
  AudioManager: { playSfx: vi.fn() }
}));

import { ConfigRegistry } from '../config/ConfigRegistry';
import { CC3D_DISPLAY_IDS } from '../core/cc3d/display';
import { GameEngine } from '../core/GameEngine';
import type { CompiledLevel, Direction, GraphicsStyle } from '../core/types';
import { loadTestConfigs } from '../test/loadTestConfigs';
import {
  CC3D_MOB_BASES,
  isCc3dId,
  paintCc3dItem,
  paintCc3dMob,
  paintCc3dTerrain,
  type Cc3dPaintTools
} from './cc3dPainters';
import { PixelRenderer } from './PixelRenderer';

const STYLES: readonly GraphicsStyle[] = ['modern', 'retro', 'retro32', 'pocket', 'pastel', 'blueprint', 'sepia', 'classic90'];
const SCENE_SIZE = 8;
const CANVAS_PX = 256;
const TILE_PX = 32;
const FRAME_MS = 16;
const BYTES = 4;
const THEME_ID = 'cyber_neon';
const DIRECTIONS: readonly Direction[] = ['N', 'E', 'S', 'W'];
const DRAWING_CALLS = new Set(['fill', 'stroke', 'fillRect', 'strokeRect', 'drawImage']);
const PAINTER_ORIGIN = 100;
const ITEM_ID = 'cc3d_fish_extra';
const SHOOTER_ID = 'cc3d_laser_shooter';

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
    id: 'cc3d-render',
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

const MOB_PATTERN = /^cc3d_(block_|reflector_|legs_|baby_|golem_yellow|laser_shooter|bot_)/;
const TERRAIN_IDS = CC3D_DISPLAY_IDS.filter((id) => id !== ITEM_ID && !MOB_PATTERN.test(id));
const MOB_IDS = CC3D_DISPLAY_IDS.filter((id) => MOB_PATTERN.test(id));

describe('cc3d display ids in every render style', () => {
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

  /** A renderer that has drawn one frame, so its style is resolved like in play. */
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

  const drewSomething = (calls: Call[]): boolean => calls.some((c) => DRAWING_CALLS.has(c.name));

  for (const style of STYLES) {
    it(`${style}: draws every terrain id over the floor of the style`, () => {
      const renderer = readyRenderer(style);
      const floor = JSON.stringify(callsOf((ctx) => renderer.drawTile(ctx, 'floor', 0, 0, TILE_PX)));
      for (const id of TERRAIN_IDS) {
        const calls = JSON.stringify(callsOf((ctx) => renderer.drawTile(ctx, id, 0, 0, TILE_PX)));
        expect(calls, id).not.toBe(floor);
        expect(calls.startsWith(floor.slice(0, -1)), id).toBe(true);
      }
    });

    it(`${style}: draws the extra fish item and every mob in every direction`, () => {
      const renderer = readyRenderer(style);
      expect(drewSomething(callsOf((ctx) => renderer.drawItem(ctx, ITEM_ID, 0, 0, TILE_PX)))).toBe(true);
      for (const id of MOB_IDS) {
        for (const dir of DIRECTIONS) {
          const calls = callsOf((ctx) => renderer.drawEntity(ctx, id, dir, 0, 0, TILE_PX));
          expect(drewSomething(calls), `${id} ${dir}`).toBe(true);
        }
      }
    });

    it(`${style}: draws the other tiles as before`, () => {
      const renderer = readyRenderer(style);
      const before = JSON.stringify(callsOf((ctx) => renderer.drawTile(ctx, 'wall', 0, 0, TILE_PX)));
      callsOf((ctx) => renderer.drawTile(ctx, 'cc3d_sand', 0, 0, TILE_PX));
      expect(JSON.stringify(callsOf((ctx) => renderer.drawTile(ctx, 'wall', 0, 0, TILE_PX)))).toBe(before);
    });
  }

  it('tells a cc3d id from a base id', () => {
    expect(CC3D_DISPLAY_IDS.every(isCc3dId)).toBe(true);
    expect(['floor', 'wall', 'chip', 'tank'].some(isCc3dId)).toBe(false);
  });

  it('variant mobs name monsters that exist and have a definition of their own', () => {
    for (const [id, variant] of Object.entries(CC3D_MOB_BASES)) {
      expect(ConfigRegistry.getEntityDef(variant.base), id).toBeDefined();
      expect(ConfigRegistry.getTiles().tiles[id], id).toBeUndefined();
      expect(ConfigRegistry.getTile(id).id, id).toBe(id);
    }
  });

  it('every painter keeps its rectangles near the tile it is given', () => {
    const tools: Cc3dPaintTools = { pal: ConfigRegistry.getGame().palette, glyph: () => undefined };
    const low = PAINTER_ORIGIN - TILE_PX / 2;
    const high = PAINTER_ORIGIN + TILE_PX * 1.5;
    // The shooter draws in a frame rotated about its centre, so its rectangles are not in tile coordinates.
    for (const id of [...TERRAIN_IDS, ...MOB_IDS, ITEM_ID].filter((candidate) => candidate !== SHOOTER_ID)) {
      const canvas = createCanvas(CANVAS_PX, CANVAS_PX);
      const ctx = canvas.getContext('2d');
      paintCc3dTerrain(ctx, id, PAINTER_ORIGIN, PAINTER_ORIGIN, TILE_PX, tools);
      paintCc3dMob(ctx, id, 'E', PAINTER_ORIGIN, PAINTER_ORIGIN, TILE_PX, tools);
      paintCc3dItem(ctx, id, PAINTER_ORIGIN, PAINTER_ORIGIN, TILE_PX, tools);
      for (const call of canvas.calls.filter((c) => c.name === 'fillRect' || c.name === 'strokeRect')) {
        const [x, y, w, h] = call.args.map(Number);
        for (const edge of [x, x + w, y, y + h]) {
          expect(edge, id).toBeGreaterThanOrEqual(low);
          expect(edge, id).toBeLessThanOrEqual(high);
        }
      }
    }
  });
});
