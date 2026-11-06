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
 * How the ward and the lurkers are drawn: the ward as boots with a mark, the awake lurker as a blob with a mark, the
 * sleeping lurker as a faint tell on the floor that the editor backs with a visible marker, in every render style.
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
const DORMANT = 'lurker_dormant';
const AWAKE = 'lurker';

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

describe('ward and lurkers in the renderer', () => {
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

  it('draws the awake lurker as a blob with a mark', () => {
    expect(EPOXY_MOB_BASES[AWAKE].base).toBe('blob');
    expect(EPOXY_MOB_BASES[AWAKE].badge).not.toBeNull();
    expect(retroMonsterSprite(AWAKE, FACING, 0)).toBe(retroMonsterSprite('blob', FACING, 0));
  });

  it('gives the sleeping lurker one retro sprite whatever its facing and frame', () => {
    expect(retroMonsterSprite(DORMANT, 'N', 0)).toBe(retroMonsterSprite(DORMANT, 'W', 1));
    expect(retroMonsterSprite(DORMANT, 'N', 0)).not.toBe(retroMonsterSprite('blob', 'N', 0));
  });

  for (const style of STYLES) {
    it(`${style}: draws a faint tell for the sleeper, apart from the awake lurker`, () => {
      const renderer = readyRenderer(style);
      const tell = callsOf((ctx) => renderer.drawEntity(ctx, DORMANT, FACING, 0, 0, TILE_PX));
      const awake = callsOf((ctx) => renderer.drawEntity(ctx, AWAKE, FACING, 0, 0, TILE_PX));
      expect(tell.length).toBeGreaterThan(2);
      expect(tell).not.toBe(awake);
      // The tell is lighter than the creature it hides.
      expect(tell.length).toBeLessThan(awake.length);
    });

    it(`${style}: shows the sleeper in the editor with a marker the game does not draw`, () => {
      const renderer = readyRenderer(style);
      const inGame = callsOf((ctx) => renderer.drawEntity(ctx, DORMANT, FACING, 0, 0, TILE_PX));
      const inEditor = callsOf((ctx) => renderer.drawEntity(ctx, DORMANT, FACING, 0, 0, TILE_PX, true));
      expect(inEditor).not.toBe(inGame);
      expect(inEditor.length).toBeGreaterThan(inGame.length);
      // A monster that does not sleep looks the same in the editor as in the game.
      expect(callsOf((ctx) => renderer.drawEntity(ctx, AWAKE, FACING, 0, 0, TILE_PX, true))).toBe(
        callsOf((ctx) => renderer.drawEntity(ctx, AWAKE, FACING, 0, 0, TILE_PX))
      );
    });

    it(`${style}: draws the ward apart from every other pair of boots`, () => {
      const renderer = readyRenderer(style);
      const ward = callsOf((ctx) => renderer.drawItem(ctx, 'ward', 0, 0, TILE_PX));
      expect(ward.length).toBeGreaterThan(2);
      for (const other of ['boots_water', 'boots_fire', 'boots_ice', 'boots_force', 'boots_speed', 'boots_eye', 'boots_pull']) {
        expect(ward, other).not.toBe(callsOf((ctx) => renderer.drawItem(ctx, other, 0, 0, TILE_PX)));
      }
    });
  }
});
