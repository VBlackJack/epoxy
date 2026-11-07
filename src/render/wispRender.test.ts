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
 * How the wisp is drawn: a see-through monster in every render style, apart from every other monster.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../audio/AudioManager', () => ({
  AudioManager: { playSfx: vi.fn() }
}));

import type { Direction, GraphicsStyle } from '../core/types';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { EPOXY_MOB_BASES } from './cc3dPainters';
import { PixelRenderer } from './PixelRenderer';
import { retroMonsterSprite } from './retroCompose';

const STYLES: readonly GraphicsStyle[] = ['modern', 'retro', 'retro32', 'runeward'];
const CANVAS_PX = 256;
const TILE_PX = 32;
const FRAME_MS = 16;
const THEME_ID = 'cyber_neon';
const FACING: Direction = 'S';
const WISP = 'wisp';
/** Monsters the wisp must not be drawn like. */
const OTHER_MONSTERS: readonly string[] = ['glider', 'fireball', 'lurker', 'skitter', 'blob'];

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

describe('wisp in the renderer', () => {
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

  function drawn(style: GraphicsStyle, type: string, isEditor = false): FakeCanvas['calls'] {
    const renderer = readyRenderer(style);
    const canvas = createCanvas(CANVAS_PX, CANVAS_PX);
    renderer.drawEntity(canvas.getContext('2d'), type, FACING, 0, 0, TILE_PX, isEditor);
    return canvas.calls;
  }

  it('draws the wisp as a marked glider where the style shares the monster sprites', () => {
    expect(EPOXY_MOB_BASES[WISP].base).toBe('glider');
    expect(EPOXY_MOB_BASES[WISP].badge).not.toBeNull();
    expect(retroMonsterSprite(WISP, FACING, 0)).toBe(retroMonsterSprite('glider', FACING, 0));
  });

  for (const style of STYLES) {
    it(`${style}: draws something, see-through, and apart from every other monster`, () => {
      const calls = drawn(style, WISP);
      expect(calls.length).toBeGreaterThan(2);
      const alphas = calls.filter((call) => call.name === 'set globalAlpha').map((call) => Number(call.args[0]));
      expect(alphas.some((alpha) => alpha > 0 && alpha < 1), 'a see-through draw').toBe(true);
      const own = JSON.stringify(calls);
      for (const other of OTHER_MONSTERS) {
        expect(own, other).not.toBe(JSON.stringify(drawn(style, other)));
      }
    });

    it(`${style}: draws the same in the editor as in the game`, () => {
      expect(JSON.stringify(drawn(style, WISP, true))).toBe(JSON.stringify(drawn(style, WISP)));
    });
  }
});
