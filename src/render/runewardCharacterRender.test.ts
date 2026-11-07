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
 * The player through the renderer: the Runeward style draws the chosen character with the extra state it is
 * given (gliding, boots, ward, death cause), and every other style draws the player exactly as before.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../audio/AudioManager', () => ({
  AudioManager: { playSfx: vi.fn(), playStep: vi.fn() }
}));

import type { GraphicsStyle } from '../core/types';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { PixelRenderer } from './PixelRenderer';
import type { PlayerSkinId } from './playerSkin';
import type { PlayerPoseExtras } from './styles/runeward/runewardCharacter';

const CANVAS_PX = 256;
const TILE_PX = 64;
const FRAME_MS = 16;
const THEME_ID = 'cyber_neon';
const OTHER_STYLES: readonly GraphicsStyle[] = ['modern', 'retro', 'retro32'];

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

function text(calls: readonly Call[]): string {
  return calls.map((call) => `${call.name}(${call.args.map((arg) => (typeof arg === 'object' ? 'obj' : String(arg))).join(',')})`).join('\n');
}

describe('the player through the renderer', () => {
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

  function drawn(
    style: GraphicsStyle,
    skin: PlayerSkinId,
    extras: PlayerPoseExtras | undefined,
    state: { alive?: boolean; inWater?: boolean } = {}
  ): string {
    const renderer = new PixelRenderer();
    renderer.setStyle(style);
    renderer.setThemeId(THEME_ID);
    renderer.setPlayerSkin(skin);
    const canvas = createCanvas(CANVAS_PX, CANVAS_PX);
    renderer.drawPlayer(canvas.getContext('2d'), 0, 0, TILE_PX, 'S', state.inWater ?? false, state.alive ?? true, 0, 0, extras);
    return text(canvas.calls);
  }

  it('offers the Runeward characters only to the Runeward style', () => {
    const runeward = new PixelRenderer();
    runeward.setStyle('runeward');
    expect(runeward.usesRunewardCharacters()).toBe(true);
    for (const style of OTHER_STYLES) {
      const renderer = new PixelRenderer();
      renderer.setStyle(style);
      expect(renderer.usesRunewardCharacters(), style).toBe(false);
    }
  });

  it('draws a different figure for each character in Runeward', () => {
    const pictures = (['default', 'runeward_scribe', 'runeward_adventurer'] as const).map((skin) => drawn('runeward', skin, undefined));
    expect(new Set(pictures).size).toBe(pictures.length);
    expect(pictures[0].length).toBeGreaterThan(0);
  });

  it('draws each extra of the state in Runeward', () => {
    const plain = drawn('runeward', 'default', undefined);
    const extras: readonly PlayerPoseExtras[] = [
      { skating: true },
      { boots: ['ice'] },
      { boots: ['fire', 'water'] },
      { wardActive: true }
    ];
    const pictures = new Set([plain, ...extras.map((extra) => drawn('runeward', 'default', extra))]);
    expect(pictures.size).toBe(extras.length + 1);
    const deaths = (['fire', 'water', 'other'] as const).map((deathCause) => drawn('runeward', 'default', { deathCause }, { alive: false }));
    expect(new Set(deaths).size).toBe(deaths.length);
  });

  it('draws the Julien skin the shared way in Runeward, whatever the extras', () => {
    const julien = drawn('runeward', 'julien', undefined);
    expect(julien).toBe(drawn('runeward', 'julien', { skating: true, boots: ['ice'], wardActive: true }));
    expect(julien).not.toBe(drawn('runeward', 'default', undefined));
  });

  for (const style of OTHER_STYLES) {
    it(`${style}: ignores the extras and draws a Runeward-only skin as the default`, () => {
      const reference = drawn(style, 'default', undefined);
      expect(reference.length).toBeGreaterThan(0);
      for (const skin of ['default', 'runeward_scribe', 'runeward_adventurer'] as const) {
        expect(drawn(style, skin, undefined), skin).toBe(reference);
        expect(drawn(style, skin, { skating: true, boots: ['ice', 'fire'], wardActive: true }), skin).toBe(reference);
      }
      const dead = drawn(style, 'default', undefined, { alive: false });
      expect(drawn(style, 'runeward_scribe', { deathCause: 'fire' }, { alive: false })).toBe(dead);
    });
  }
});
