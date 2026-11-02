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
 * The laser overlay on recording fake canvases: the beam and the glow of a lit receiver are drawn
 * in the palette colours in every style, the laser tiles and mirrors are composed from their own
 * sprites in the sprite styles, and a level without lasers draws none of it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../audio/AudioManager', () => ({
  AudioManager: { playSfx: vi.fn() }
}));

import { GameEngine } from '../core/GameEngine';
import type { CompiledLevel, GraphicsStyle } from '../core/types';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { PixelRenderer } from './PixelRenderer';

const SCENE_SIZE = 12;
const WALL_EDGE = SCENE_SIZE - 1;
const FRAME_MS = 16;
const CANVAS_PX = 300;
const TILE_PX = 32;
const BYTES = 4;
const THEME_ID = 'cyber_neon';
const EMITTER = { x: 2, y: 2 };
const RECEIVER = { x: 9, y: 2 };
const STYLES: readonly GraphicsStyle[] = ['modern', 'retro', 'pocket'];

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

function room(withLasers: boolean): CompiledLevel {
  const terrain: string[][] = Array.from({ length: SCENE_SIZE }, (_, y) =>
    Array.from({ length: SCENE_SIZE }, (_, x) => (x === 0 || y === 0 || x === WALL_EDGE || y === WALL_EDGE ? 'wall' : 'floor'))
  );
  const items: (string | null)[][] = Array.from({ length: SCENE_SIZE }, () =>
    Array.from({ length: SCENE_SIZE }, () => null)
  );
  const entities: CompiledLevel['entities'] = [];
  if (withLasers) {
    terrain[EMITTER.y][EMITTER.x] = 'laser_emitter_e';
    terrain[RECEIVER.y][RECEIVER.x] = 'laser_receiver_red';
    terrain[8][3] = 'laser_gate_red_closed';
    terrain[8][4] = 'laser_gate_blue_open';
    entities.push({ x: 7, y: 7, type: 'mirror_slash', dir: 'S' }, { x: 8, y: 7, type: 'mirror_backslash', dir: 'S' });
  }
  return {
    id: 'laser-scene',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    playerStart: { x: 5, y: 5, dir: 'S' },
    terrain,
    items,
    entities,
    trapLinks: [],
    cloneLinks: []
  };
}

interface Internals {
  retroCanvases: Map<string, unknown>;
  pal(): Record<string, string>;
  visualViewportTiles: number;
}

describe('laser overlay', () => {
  const created: FakeCanvas[] = [];
  let now = 0;

  beforeEach(() => {
    loadTestConfigs();
    created.length = 0;
    now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => (now += FRAME_MS));
    vi.stubGlobal('document', {
      createElement: (): FakeCanvas => {
        const canvas = createCanvas(CANVAS_PX, CANVAS_PX);
        created.push(canvas);
        return canvas;
      }
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function render(style: GraphicsStyle, withLasers: boolean): { calls: Call[]; renderer: PixelRenderer } {
    const engine = new GameEngine();
    engine.loadLevel(room(withLasers));
    const renderer = new PixelRenderer();
    renderer.setStyle(style);
    renderer.setThemeId(THEME_ID);
    renderer.setViewportTiles(SCENE_SIZE);
    (renderer as unknown as Internals).visualViewportTiles = SCENE_SIZE;
    const main = createCanvas(SCENE_SIZE * TILE_PX, SCENE_SIZE * TILE_PX);
    renderer.renderViewport(main.getContext('2d'), engine);
    return { calls: [main, ...created].flatMap((canvas) => canvas.calls), renderer };
  }

  const fillStyles = (calls: Call[]): unknown[] => calls.filter((c) => c.name === 'set fillStyle').map((c) => c.args[0]);

  for (const style of STYLES) {
    it(`${style}: draws the beam and the glow of the lit receiver in the palette colours`, () => {
      const { calls, renderer } = render(style, true);
      const pal = (renderer as unknown as Internals).pal();
      const fills = fillStyles(calls);
      expect(fills).toContain(pal.laserBeam);
      expect(fills).toContain(pal.laserBeamCore);
      // The beam crosses the cells between the emitter and the receiver: one halo rectangle per cell at least.
      const cellsBetween = RECEIVER.x - EMITTER.x - 1;
      expect(calls.filter((c) => c.name === 'fillRect').length).toBeGreaterThanOrEqual(cellsBetween);
    });

    it(`${style}: draws nothing of the overlay on a level without lasers`, () => {
      const { calls, renderer } = render(style, false);
      const pal = (renderer as unknown as Internals).pal();
      expect(fillStyles(calls)).not.toContain(pal.laserBeam);
      expect(fillStyles(calls)).not.toContain(pal.laserBeamCore);
    });
  }

  it('retro: composes the emitter, receiver, gates and mirrors from their own sprites', () => {
    const { renderer } = render('retro', true);
    const keys = [...(renderer as unknown as Internals).retroCanvases.keys()].join('+');
    for (const name of [
      'laser_emitter_e',
      'laser_receiver',
      'laser_gate_closed',
      'laser_gate_open',
      'mirror_slash',
      'mirror_backslash'
    ]) {
      expect(keys, name).toContain(name);
    }
  });
});
