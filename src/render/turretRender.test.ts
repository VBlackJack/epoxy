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
 * How the Epoxy turrets are drawn: as the cc3d bot of the same kind, facing the way they fire, and with
 * a beam that is drawn as plain lines whatever mirror stands beside it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../audio/AudioManager', () => ({
  AudioManager: { playSfx: vi.fn() }
}));

import { GameEngine } from '../core/GameEngine';
import type { CompiledLevel, Direction, GraphicsStyle } from '../core/types';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { PixelRenderer } from './PixelRenderer';
import { armRects, beamArms } from './laserBeams';

const STYLES: readonly GraphicsStyle[] = ['modern', 'retro', 'retro32'];
const SCENE_SIZE = 8;
const CANVAS_PX = 256;
const TILE_PX = 32;
const FRAME_MS = 16;
const THEME_ID = 'cyber_neon';
const DIRECTIONS: readonly Direction[] = ['N', 'E', 'S', 'W'];
/** Each Epoxy turret and the cc3d bot it is drawn as. */
const TURRET_PAINTERS: ReadonlyArray<readonly [string, string]> = [
  ['turret_fixed', 'cc3d_bot_static'],
  ['turret_cw', 'cc3d_bot_cw'],
  ['turret_ccw', 'cc3d_bot_ccw'],
  ['turret_multi', 'cc3d_bot_multi']
];
const TURRET_CELL = { x: 3, y: 3 };

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

function turretLevel(): CompiledLevel {
  const terrain = Array.from({ length: SCENE_SIZE }, () => Array.from({ length: SCENE_SIZE }, () => 'floor'));
  return {
    id: 'turret-render',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    playerStart: { x: 1, y: 1, dir: 'S' },
    terrain,
    items: terrain.map((row) => row.map(() => null)),
    entities: [{ type: 'turret_cw', x: TURRET_CELL.x, y: TURRET_CELL.y, dir: 'N' }],
    trapLinks: [],
    cloneLinks: []
  };
}

describe('turrets in the renderer', () => {
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

  function readyRenderer(style: GraphicsStyle, engine: GameEngine): PixelRenderer {
    const renderer = new PixelRenderer();
    renderer.setStyle(style);
    renderer.setThemeId(THEME_ID);
    renderer.setViewportTiles(SCENE_SIZE);
    renderer.renderViewport(createCanvas(SCENE_SIZE * TILE_PX, SCENE_SIZE * TILE_PX).getContext('2d'), engine);
    return renderer;
  }

  function callsOf(draw: (ctx: CanvasRenderingContext2D) => void): string {
    const canvas = createCanvas(CANVAS_PX, CANVAS_PX);
    draw(canvas.getContext('2d'));
    return JSON.stringify(canvas.calls);
  }

  for (const style of STYLES) {
    it(`${style}: draws each turret as the cc3d bot of its kind, in every direction`, () => {
      const engine = new GameEngine();
      engine.loadLevel(turretLevel());
      const renderer = readyRenderer(style, engine);
      for (const [turret, bot] of TURRET_PAINTERS) {
        for (const dir of DIRECTIONS) {
          const drawn = callsOf((ctx) => renderer.drawEntity(ctx, turret, dir, 0, 0, TILE_PX));
          expect(drawn, `${turret} ${dir}`).toBe(callsOf((ctx) => renderer.drawEntity(ctx, bot, dir, 0, 0, TILE_PX)));
          expect(drawn.length, `${turret} ${dir}`).toBeGreaterThan(2);
        }
      }
    });
  }

  it('draws a turret facing the way it fires, not the way it was pushed', () => {
    const engine = new GameEngine();
    engine.loadLevel(turretLevel());
    const entity = engine.getEntities()[0];
    entity.facing = 'E';
    const renderer = new PixelRenderer();
    renderer.setStyle('modern');
    renderer.setThemeId(THEME_ID);
    renderer.setViewportTiles(SCENE_SIZE);
    const spy = vi.spyOn(renderer, 'drawEntity');
    renderer.renderViewport(createCanvas(SCENE_SIZE * TILE_PX, SCENE_SIZE * TILE_PX).getContext('2d'), engine);
    const turretCalls = spy.mock.calls.filter(([, type]) => type === 'turret_cw');
    expect(turretCalls.length).toBeGreaterThan(0);
    expect(turretCalls.every(([, , dir]) => dir === 'E')).toBe(true);
    expect(entity.dir).toBe('N');
  });

  it('draws a turret beam cell as a plain line, with no corner against a neighbouring mirror', () => {
    const turretCell = { x: 3, y: 3, horizontal: true, vertical: false };
    // The board a renderer builds from the emitter cells only: no beam is known beside the mirror.
    const board = {
      beamAt: () => undefined,
      mirrorAt: () => undefined,
      emitterAt: () => undefined
    };
    const arms = beamArms(turretCell, board);
    expect(arms).toEqual({ N: false, S: false, E: true, W: true });
    expect(armRects(arms, 0.25)).toHaveLength(2);
  });
});
