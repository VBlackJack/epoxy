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

/** The eye boots mark invisible and appearing walls in a played scene, and only while they are held. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../audio/AudioManager', () => ({
  AudioManager: { playSfx: vi.fn() }
}));

import { ConfigRegistry } from '../config/ConfigRegistry';
import { GameEngine } from '../core/GameEngine';
import { CompiledLevel, GraphicsStyle } from '../core/types';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { PixelRenderer } from './PixelRenderer';

const CANVAS_SIZE = 240;
const MAP_SIZE = 12;
const VIEW_TILES = 12;
const DEFAULT_CANVAS = 300;
const FRAME_MS = 16;
const BYTES = 4;
const EYE_ID = 'boots_eye';
const INVISIBLE_CELL = { x: 3, y: 4 };
const APPEARING_CELL = { x: 7, y: 4 };
const FAKE_BLUE_CELL = { x: 5, y: 8 };
const PLAYER_CELL = { x: 5, y: 5 };
const ICON_TILE_PX = 32;
/** The dash pattern the hidden wall marker is stroked with. */
const MARKER_DASH = [3, 3];
/** Markers the two hidden wall cells of the scene add. */
const HIDDEN_WALL_CELLS = 2;

interface Marker {
  readonly stroke: unknown;
}

interface FakeCanvas {
  width: number;
  height: number;
  getContext(kind: string): CanvasRenderingContext2D;
}

/** Canvases that record every dashed rectangle they stroke, with the stroke colour in force. */
function createCanvas(width: number, height: number, markers: Marker[]): FakeCanvas {
  const props: Record<string, unknown> = {};
  let dash: unknown[] = [];
  const canvas: FakeCanvas = { width, height, getContext: () => ctx };
  const ctx = new Proxy(props, {
    get(target, prop: string) {
      if (prop === 'canvas') return canvas;
      if (prop in target) return target[prop];
      return (...args: unknown[]): unknown => {
        if (prop === 'setLineDash') dash = args[0] as unknown[];
        if (prop === 'strokeRect' && dash.length === MARKER_DASH.length && dash.every((d, i) => d === MARKER_DASH[i])) {
          markers.push({ stroke: target.strokeStyle });
        }
        if (prop === 'createImageData') {
          return { data: new Uint8ClampedArray(Number(args[0]) * Number(args[1]) * BYTES) };
        }
        if (prop === 'createPattern') return {};
        if (prop.endsWith('Gradient')) return { addColorStop: () => undefined };
        return undefined;
      };
    },
    set(target, prop: string, value: unknown) {
      target[prop] = value;
      return true;
    }
  }) as unknown as CanvasRenderingContext2D;
  return canvas;
}

function level(): CompiledLevel {
  const edge = MAP_SIZE - 1;
  const terrain: string[][] = Array.from({ length: MAP_SIZE }, (_, y) =>
    Array.from({ length: MAP_SIZE }, (_, x) => (x === 0 || y === 0 || x === edge || y === edge ? 'wall' : 'floor'))
  );
  terrain[INVISIBLE_CELL.y][INVISIBLE_CELL.x] = 'invisible_wall';
  terrain[APPEARING_CELL.y][APPEARING_CELL.x] = 'appearing_wall';
  terrain[FAKE_BLUE_CELL.y][FAKE_BLUE_CELL.x] = 'blue_wall_fake';
  return {
    id: 'eye-scene',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    playerStart: { x: PLAYER_CELL.x, y: PLAYER_CELL.y, dir: 'S' },
    terrain,
    items: Array.from({ length: MAP_SIZE }, () => Array.from({ length: MAP_SIZE }, () => null)),
    entities: [],
    trapLinks: [],
    cloneLinks: []
  };
}

describe('eye boots in a played scene', () => {
  let now = 0;
  let markers: Marker[] = [];

  beforeEach(() => {
    loadTestConfigs();
    now = 0;
    markers = [];
    vi.spyOn(performance, 'now').mockImplementation(() => (now += FRAME_MS));
    vi.stubGlobal('document', {
      createElement: (): FakeCanvas => createCanvas(DEFAULT_CANVAS, DEFAULT_CANVAS, markers)
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  interface Scene {
    engine: GameEngine;
    renderer: PixelRenderer;
    main: FakeCanvas;
    /** Markers stroked by one frame of the scene. */
    frame(): Marker[];
  }

  /** `themed: false` removes the themes, which is how a game without any theme draws: the flat look. */
  function setup(style: GraphicsStyle, themed: boolean, themeId = 'cyber_neon'): Scene {
    if (!themed) delete (ConfigRegistry.getGame() as { themes?: unknown }).themes;
    const engine = new GameEngine();
    engine.loadLevel(level());
    const renderer = new PixelRenderer();
    renderer.setStyle(style);
    renderer.setThemeId(themeId);
    renderer.setViewportTiles(VIEW_TILES);
    const main = createCanvas(CANVAS_SIZE, CANVAS_SIZE, markers);
    return {
      engine,
      renderer,
      main,
      frame: () => {
        markers.length = 0;
        renderer.renderViewport(main.getContext('2d'), engine);
        return [...markers];
      }
    };
  }

  it('is a collectible boot that reveals hidden walls', () => {
    expect(ConfigRegistry.getTile(EYE_ID).revealsHiddenWalls).toBe(true);
    expect(ConfigRegistry.getTile(EYE_ID).collectible).toBe('boot');
  });

  for (const [label, themed] of [['themed', true], ['flat', false]] as const) {
    it(`${label}: marks the invisible and the appearing wall with the boots, never the fake blue wall`, () => {
      const scene = setup('modern', themed);
      const without = scene.frame();
      scene.engine.getPlayer().boots.add(EYE_ID);
      const withBoots = scene.frame();
      expect(withBoots.length - without.length).toBe(HIDDEN_WALL_CELLS);
    });

    it(`${label}: the marker is gone once the boots are stolen`, () => {
      const scene = setup('modern', themed);
      const baseline = scene.frame().length;
      scene.engine.getPlayer().boots.add(EYE_ID);
      expect(scene.frame().length).toBe(baseline + HIDDEN_WALL_CELLS);
      scene.engine.getPlayer().boots.clear();
      expect(scene.frame().length).toBe(baseline);
    });

    it(`${label}: holding other boots draws no marker`, () => {
      const scene = setup('modern', themed);
      const baseline = scene.frame().length;
      scene.engine.getPlayer().boots.add('boots_speed');
      scene.engine.getPlayer().boots.add('boots_fire');
      expect(scene.frame().length).toBe(baseline);
    });
  }

  it('modern: the invisible wall takes the theme glow and the appearing wall the palette yellow', () => {
    const scene = setup('modern', true);
    scene.engine.getPlayer().boots.add(EYE_ID);
    const strokes = scene.frame().map((m) => m.stroke);
    expect(strokes).toContain(ConfigRegistry.getGame().themes?.cyber_neon?.accentGlow);
    expect(strokes).toContain(ConfigRegistry.getGame().palette.yellow);
  });

  it('does not leak the flag into draws outside a frame', () => {
    const scene = setup('modern', true);
    scene.engine.getPlayer().boots.add(EYE_ID);
    scene.frame();
    markers.length = 0;
    const target = createCanvas(DEFAULT_CANVAS, DEFAULT_CANVAS, markers);
    scene.renderer.drawTile(target.getContext('2d'), 'invisible_wall', 0, 0, ICON_TILE_PX);
    expect(markers).toEqual([]);
  });
});
