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
 * How the signal tiles and signal links are drawn: every tile kind looks different powered and unpowered in
 * the flat, neon and sprite styles, and the links show on hover of either end or with the mechanism links on.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../audio/AudioManager', () => ({
  AudioManager: { playSfx: vi.fn() }
}));

import { ConfigRegistry } from '../config/ConfigRegistry';
import { GameEngine } from '../core/GameEngine';
import type { CompiledLevel, GraphicsStyle, SignalLink } from '../core/types';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { PixelRenderer } from './PixelRenderer';
import { SIGNAL_TILE_KINDS } from './signalTilePainter';

const SCENE_SIZE = 8;
const CANVAS_PX = 256;
const TILE_PX = 32;
const FRAME_MS = 16;
const THEME_ID = 'cyber_neon';
const CELL = { x: 3, y: 3 };
const SIGNAL_TILE_IDS = Object.keys(SIGNAL_TILE_KINDS);

type DrawStyle = 'flat' | 'neon' | 'retro' | 'retro32';
const DRAW_STYLES: ReadonlyArray<readonly [DrawStyle, GraphicsStyle]> = [
  ['flat', 'modern'],
  ['neon', 'modern'],
  ['retro', 'retro'],
  ['retro32', 'retro32']
];

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

function createCanvas(width: number, height: number, registry?: FakeCanvas[]): FakeCanvas {
  const calls: Call[] = [];
  const props: Record<string, unknown> = {};
  const canvas: FakeCanvas = { width, height, calls, getContext: () => ctx, toDataURL: () => '' };
  registry?.push(canvas);
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

/** A level of floor with one tile of the given id, plus signal links when given. */
function levelWith(tileId: string | null, links?: SignalLink[], extra: Array<[number, number, string]> = []): CompiledLevel {
  const terrain = Array.from({ length: SCENE_SIZE }, () => Array.from({ length: SCENE_SIZE }, () => 'floor'));
  if (tileId !== null) terrain[CELL.y][CELL.x] = tileId;
  for (const [x, y, id] of extra) terrain[y][x] = id;
  const level: CompiledLevel = {
    id: 'signal-render',
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
  if (links !== undefined) level.signalLinks = links;
  return level;
}

describe('signal tiles and links in the renderer', () => {
  let created: FakeCanvas[] = [];

  beforeEach(() => {
    loadTestConfigs();
    created = [];
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => (now += FRAME_MS));
    vi.stubGlobal('document', {
      createElement: (): FakeCanvas => createCanvas(CANVAS_PX, CANVAS_PX, created)
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** Every canvas call of one frame, flattened to text so two frames compare. */
  function serialise(canvases: readonly FakeCanvas[]): string {
    const flatten = (value: unknown): unknown => {
      if (value instanceof Uint8ClampedArray) return Array.from(value);
      if (value !== null && typeof value === 'object' && 'calls' in (value as object)) {
        return (value as FakeCanvas).calls.map((call) => [call.name, ...call.args.map(flatten)]);
      }
      return value;
    };
    return JSON.stringify(canvases.map((canvas) => canvas.calls.map((call) => [call.name, ...call.args.map(flatten)])));
  }

  function frame(
    drawStyle: DrawStyle,
    style: GraphicsStyle,
    engine: GameEngine,
    setup?: (renderer: PixelRenderer) => void
  ): { renderer: PixelRenderer; main: FakeCanvas } {
    created.length = 0;
    const renderer = new PixelRenderer();
    renderer.setStyle(style);
    renderer.setThemeId(THEME_ID);
    renderer.setViewportTiles(SCENE_SIZE);
    if (drawStyle === 'flat') {
      // A game without a resolvable theme draws the flat tiles.
      vi.spyOn(renderer as unknown as { getActiveTheme(): undefined }, 'getActiveTheme').mockReturnValue(undefined);
    }
    setup?.(renderer);
    const main = createCanvas(SCENE_SIZE * TILE_PX, SCENE_SIZE * TILE_PX, created);
    renderer.renderViewport(main.getContext('2d'), engine);
    return { renderer, main };
  }

  function engineWith(level: CompiledLevel, powered?: ReadonlySet<number>): GameEngine {
    const engine = new GameEngine();
    engine.loadLevel(level);
    if (powered !== undefined) engine.getPoweredSignalCells = () => powered;
    return engine;
  }

  for (const [drawStyle, style] of DRAW_STYLES) {
    for (const tileId of SIGNAL_TILE_IDS) {
      it(`${drawStyle}: ${tileId} is drawn differently powered and unpowered`, () => {
        const off = frame(drawStyle, style, engineWith(levelWith(tileId), new Set()));
        const offLog = serialise(created);
        frame(drawStyle, style, engineWith(levelWith(tileId), new Set([CELL.y * SCENE_SIZE + CELL.x])));
        const onLog = serialise(created);
        expect(off.main.calls.length).toBeGreaterThan(0);
        expect(onLog).not.toBe(offLog);
      });
    }

    it(`${drawStyle}: a tile that is not a signal tile ignores the powered set`, () => {
      frame(drawStyle, style, engineWith(levelWith('floor'), new Set()));
      const offLog = serialise(created);
      frame(drawStyle, style, engineWith(levelWith('floor'), new Set([CELL.y * SCENE_SIZE + CELL.x])));
      expect(serialise(created)).toBe(offLog);
    });
  }

  it('redraws the cached terrain when a signal node switches on and off', () => {
    const engine = engineWith(levelWith('signal_gate_and'), new Set());
    const renderer = new PixelRenderer();
    renderer.setStyle('modern');
    renderer.setThemeId(THEME_ID);
    renderer.setViewportTiles(SCENE_SIZE);
    const main = createCanvas(SCENE_SIZE * TILE_PX, SCENE_SIZE * TILE_PX, created);
    renderer.renderViewport(main.getContext('2d'), engine);
    const afterOff = created.reduce((sum, canvas) => sum + canvas.calls.length, 0);
    renderer.renderViewport(main.getContext('2d'), engine);
    const afterSecondOff = created.reduce((sum, canvas) => sum + canvas.calls.length, 0);
    engine.getPoweredSignalCells = () => new Set([CELL.y * SCENE_SIZE + CELL.x]);
    created.forEach((canvas) => (canvas.calls.length = 0));
    renderer.renderViewport(main.getContext('2d'), engine);
    const cacheCalls = created.filter((canvas) => canvas !== main).reduce((sum, canvas) => sum + canvas.calls.length, 0);
    expect(afterSecondOff).toBeGreaterThan(afterOff);
    // The cache canvas was repainted: far more than the single blit of an unchanged cache.
    expect(cacheCalls).toBeGreaterThan(SCENE_SIZE);
  });

  describe('signal links', () => {
    const FROM = { x: 1, y: 4 };
    const TO = CELL;
    const LINKS: SignalLink[] = [{ fromX: FROM.x, fromY: FROM.y, toX: TO.x, toY: TO.y }];
    const FROM_INDEX = FROM.y * SCENE_SIZE + FROM.x;

    function linkLevel(): CompiledLevel {
      return levelWith('signal_gate_and', LINKS, [[FROM.x, FROM.y, 'signal_plate']]);
    }

    /** The stroke calls made with the signal link colour, with the line dash in force at each. */
    function signalStrokes(canvas: FakeCanvas): Array<{ dash: unknown }> {
      const colour = ConfigRegistry.getGame().palette.linkSignal;
      const strokes: Array<{ dash: unknown }> = [];
      let strokeStyle: unknown;
      let dash: unknown = [];
      for (const call of canvas.calls) {
        if (call.name === 'set strokeStyle') strokeStyle = call.args[0];
        if (call.name === 'setLineDash') dash = call.args[0];
        if (call.name === 'stroke' && strokeStyle === colour) strokes.push({ dash });
      }
      return strokes;
    }

    /** Number of fills made with the signal link colour: the wired mark is the only fill that uses it. */
    function signalFills(canvas: FakeCanvas): number {
      const colour = ConfigRegistry.getGame().palette.linkSignal;
      let fillStyle: unknown;
      let fills = 0;
      for (const call of canvas.calls) {
        if (call.name === 'set fillStyle') fillStyle = call.args[0];
        if (call.name === 'fill' && fillStyle === colour) fills += 1;
      }
      return fills;
    }

    for (const [drawStyle, style] of DRAW_STYLES) {
      it(`${drawStyle}: marks a flip tile a signal link ends on, with no hover, and no other target`, () => {
        for (const flipId of ['toggle_wall_closed', 'rail_switch_a']) {
          const engine = new GameEngine();
          engine.loadLevel(levelWith(flipId, LINKS, [[FROM.x, FROM.y, 'signal_plate']]));
          expect(signalFills(frame(drawStyle, style, engine).main), flipId).toBe(1);
        }
        const gate = new GameEngine();
        gate.loadLevel(linkLevel());
        expect(signalFills(frame(drawStyle, style, gate).main)).toBe(0);
        const unlinked = new GameEngine();
        unlinked.loadLevel(levelWith('toggle_wall_closed'));
        expect(signalFills(frame(drawStyle, style, unlinked).main)).toBe(0);
      });
    }

    it('defines the link colour in the palette', () => {
      expect(ConfigRegistry.getGame().palette.linkSignal).toMatch(/^#[0-9a-f]{6}$/i);
    });

    for (const [drawStyle, style] of DRAW_STYLES) {
      it(`${drawStyle}: draws nothing without hover or the mechanism links`, () => {
        const engine = new GameEngine();
        engine.loadLevel(linkLevel());
        const idle = frame(drawStyle, style, engine);
        expect(signalStrokes(idle.main)).toEqual([]);
      });

      it(`${drawStyle}: draws the link when either end is hovered`, () => {
        for (const end of [FROM, TO]) {
          const engine = new GameEngine();
          engine.loadLevel(linkLevel());
          const { main } = frame(drawStyle, style, engine, (r) => r.setHoveredGridPoint(end));
          expect(signalStrokes(main)).toHaveLength(1);
        }
        const engine = new GameEngine();
        engine.loadLevel(linkLevel());
        const away = frame(drawStyle, style, engine, (r) => r.setHoveredGridPoint({ x: 6, y: 6 }));
        expect(signalStrokes(away.main)).toEqual([]);
      });

      it(`${drawStyle}: draws the link with the mechanism links on, dashed while unpowered and solid once powered`, () => {
        const off = new GameEngine();
        off.loadLevel(linkLevel());
        const unpowered = signalStrokes(frame(drawStyle, style, off, (r) => r.setShowMechanismLinks(true)).main);
        expect(unpowered).toHaveLength(1);
        expect((unpowered[0].dash as number[]).length).toBeGreaterThan(0);

        const on = new GameEngine();
        on.loadLevel(linkLevel());
        on.getPoweredSignalCells = () => new Set([FROM_INDEX]);
        const powered = signalStrokes(frame(drawStyle, style, on, (r) => r.setShowMechanismLinks(true)).main);
        expect(powered).toHaveLength(1);
        expect(powered[0].dash).toEqual([]);
      });
    }

    it('draws nothing on a level whose engine has no signal accessors', () => {
      const engine = new GameEngine();
      engine.loadLevel(linkLevel());
      (engine as { getSignalLinks?: unknown }).getSignalLinks = undefined;
      (engine as { getPoweredSignalCells?: unknown }).getPoweredSignalCells = undefined;
      const { main } = frame('neon', 'modern', engine, (r) => r.setShowMechanismLinks(true));
      expect(signalStrokes(main)).toEqual([]);
    });
  });
});
