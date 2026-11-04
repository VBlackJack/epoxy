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
 * How the puppet, its control and the skitter are drawn: the puppet as the yellow golem, the control as
 * the golem control, the skitter as teeth with a mark, in every render style.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../audio/AudioManager', () => ({
  AudioManager: { playSfx: vi.fn() }
}));

import { ConfigRegistry } from '../config/ConfigRegistry';
import type { Direction, GraphicsStyle } from '../core/types';
import { loadTestConfigs } from '../test/loadTestConfigs';
import {
  CC3D_MOB_BASES,
  EPOXY_MOB_BASES,
  GOLEM_CONTROL_PAINTER_ID,
  GOLEM_YELLOW_PAINTER_ID
} from './cc3dPainters';
import { PixelRenderer } from './PixelRenderer';

const STYLES: readonly GraphicsStyle[] = ['modern', 'retro', 'retro32'];
const CANVAS_PX = 256;
const TILE_PX = 32;
const FRAME_MS = 16;
const THEME_ID = 'cyber_neon';
const DIRECTIONS: readonly Direction[] = ['N', 'E', 'S', 'W'];

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
        if (prop === 'createImageData') return { data: new Uint8ClampedArray(Number(args[0]) * Number(args[1]) * 4) };
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

describe('puppet, puppet control and skitter in the renderer', () => {
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
    const renderer = new PixelRenderer();
    renderer.setStyle(style);
    renderer.setThemeId(THEME_ID);
    return renderer;
  }

  function callsOf(draw: (ctx: CanvasRenderingContext2D) => void): string {
    const canvas = createCanvas(CANVAS_PX, CANVAS_PX);
    draw(canvas.getContext('2d'));
    return JSON.stringify(canvas.calls);
  }

  it('names the painters of the cc3d golem and its control through the exported ids', () => {
    expect(GOLEM_YELLOW_PAINTER_ID).toBe('cc3d_golem_yellow');
    expect(GOLEM_CONTROL_PAINTER_ID).toBe('cc3d_golem_control_yellow');
    expect(CC3D_MOB_BASES[GOLEM_YELLOW_PAINTER_ID]).toBeDefined();
  });

  it('marks the skitter as teeth, with a mark no cc3d variant has taken', () => {
    const variant = EPOXY_MOB_BASES.skitter;
    expect(variant.base).toBe('teeth');
    expect(ConfigRegistry.getEntityDef(variant.base)).toBeDefined();
    expect(variant.badge).not.toBeNull();
    expect(Object.values(CC3D_MOB_BASES).map((v) => v.badge)).not.toContain(variant.badge);
    // The Epoxy table names Epoxy entity types, not cc3d display ids.
    for (const id of Object.keys(EPOXY_MOB_BASES)) {
      expect(ConfigRegistry.getEntityDef(id), id).toBeDefined();
    }
  });

  for (const style of STYLES) {
    it(`${style}: draws the puppet as the yellow golem, in every direction`, () => {
      const renderer = readyRenderer(style);
      for (const dir of DIRECTIONS) {
        const drawn = callsOf((ctx) => renderer.drawEntity(ctx, 'puppet', dir, 0, 0, TILE_PX));
        expect(drawn, dir).toBe(callsOf((ctx) => renderer.drawEntity(ctx, GOLEM_YELLOW_PAINTER_ID, dir, 0, 0, TILE_PX)));
        expect(drawn.length, dir).toBeGreaterThan(2);
      }
    });

    it(`${style}: draws the puppet control as the golem control`, () => {
      const renderer = readyRenderer(style);
      const drawn = callsOf((ctx) => renderer.drawTile(ctx, 'puppet_control', 0, 0, TILE_PX));
      expect(drawn).toBe(callsOf((ctx) => renderer.drawTile(ctx, GOLEM_CONTROL_PAINTER_ID, 0, 0, TILE_PX)));
      expect(drawn).not.toBe(callsOf((ctx) => renderer.drawTile(ctx, 'floor', 0, 0, TILE_PX)));
    });

    it(`${style}: draws the skitter as teeth plus a mark`, () => {
      const renderer = readyRenderer(style);
      for (const dir of DIRECTIONS) {
        const skitter = callsOf((ctx) => renderer.drawEntity(ctx, 'skitter', dir, 0, 0, TILE_PX));
        const teeth = callsOf((ctx) => renderer.drawEntity(ctx, 'teeth', dir, 0, 0, TILE_PX));
        expect(skitter, dir).not.toBe(teeth);
        expect(skitter.startsWith(teeth.slice(0, -1)), dir).toBe(true);
      }
    });
  }
});