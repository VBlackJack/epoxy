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

/** The Sokoban skin: its image loader, and where the renderer does and does not use it. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../audio/AudioManager', () => ({
  AudioManager: { playSfx: vi.fn() }
}));

import { ConfigRegistry } from '../config/ConfigRegistry';
import { GameEngine } from '../core/GameEngine';
import { CompiledLevel, GraphicsStyle } from '../core/types';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { PixelRenderer } from './PixelRenderer';
import { DEFAULT_SOKOBAN_SKIN, findGraphicsConfigErrors, resolveSokobanSkin } from './renderSettings';
import { SkinImage, SokobanSkinLoader } from './sokobanSkin';

const CANVAS_SIZE = 240;
const MAP_SIZE = 12;
const VIEW_TILES = 12;
const TILE_PX = CANVAS_SIZE / VIEW_TILES;
const SPRITE_UNIT = 16;
const DEFAULT_CANVAS = 300;
const PLAYER_CELL = 5;
const BLOCK_CELL = 8;
/** Cells that hold the hidden walls in the skin scene. */
const HIDDEN_WALL_CELLS = [
  { x: 2, y: 6, tile: 'invisible_wall' },
  { x: 6, y: 2, tile: 'appearing_wall' }
] as const;
const FRAME_MS = 16;
const BYTES = 4;
/** Frames after which the camera zoom has settled and the terrain cache is stable. */
const SETTLE_FRAMES = 40;

interface Call {
  readonly name: string;
  readonly args: unknown[];
}

interface FakeCanvas {
  width: number;
  height: number;
  readonly calls: Call[];
  getContext(kind: string): CanvasRenderingContext2D;
}

function createCanvas(width: number, height: number): FakeCanvas {
  const calls: Call[] = [];
  const props: Record<string, unknown> = {};
  const canvas: FakeCanvas = { width, height, calls, getContext: () => ctx };
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

interface FakeImage extends SkinImage {
  readonly file: string;
}

/** Fake images named by their file; `failing` files reject on decode. */
function fakeImages(failing: readonly string[] = []): { make: () => SkinImage; made: FakeImage[] } {
  const made: FakeImage[] = [];
  return {
    made,
    make: () => {
      const image = {
        src: '',
        get file(): string {
          return image.src.split('/').pop() ?? '';
        },
        decode: (): Promise<void> => (failing.includes(image.file) ? Promise.reject(new Error('bad')) : Promise.resolve())
      } as FakeImage;
      made.push(image);
      return image;
    }
  };
}

/** Composed layers are tagged with the files they stack, so tests can recognise them. */
const stackComposer = (layers: readonly CanvasImageSource[]): CanvasImageSource =>
  ({ stack: layers.map((layer) => (layer as unknown as FakeImage).file) }) as unknown as CanvasImageSource;

async function loadedLoader(): Promise<SokobanSkinLoader> {
  const loader = new SokobanSkinLoader(DEFAULT_SOKOBAN_SKIN, fakeImages().make, stackComposer);
  await loader.load();
  return loader;
}

describe('SokobanSkinLoader', () => {
  it('stays not ready without throwing where images do not exist', async () => {
    const loader = new SokobanSkinLoader(DEFAULT_SOKOBAN_SKIN);
    await expect(loader.load()).resolves.toBeUndefined();
    expect(loader.ready).toBe(false);
    expect(loader.getTerrain('wall')).toBeNull();
    expect(loader.getBlockOnTarget()).toBeNull();
  });

  it('is ready once every file decoded, joins the layers and bumps its version', async () => {
    const images = fakeImages();
    const loader = new SokobanSkinLoader(DEFAULT_SOKOBAN_SKIN, images.make, stackComposer);
    expect(loader.version).toBe(0);
    await loader.load();
    expect(loader.ready).toBe(true);
    expect(loader.version).toBe(1);
    expect(images.made.map((image) => image.src)).toContain('./sprites/sokoban/crate_12.png');
    expect(loader.getTerrain('block_target')).toEqual([{ stack: ['ground_06.png', 'environment_06.png'] }]);
    expect(loader.getTerrain('wall')).toHaveLength(1);
    expect(loader.getEntity('dirt_block')).toHaveLength(1);
    expect(loader.getTerrain('water')).toBeNull();
    expect(loader.getEntity('ice_block')).toBeNull();
  });

  it('stays off when one file fails to load', async () => {
    const loader = new SokobanSkinLoader(DEFAULT_SOKOBAN_SKIN, fakeImages(['crate_02.png']).make, stackComposer);
    await loader.load();
    expect(loader.ready).toBe(false);
    expect(loader.getTerrain('wall')).toBeNull();
  });

  it('loads only once', async () => {
    const images = fakeImages();
    const loader = new SokobanSkinLoader(DEFAULT_SOKOBAN_SKIN, images.make, stackComposer);
    await loader.load();
    const count = images.made.length;
    await loader.load();
    expect(images.made).toHaveLength(count);
    expect(loader.version).toBe(1);
  });
});

describe('Sokoban skin configuration', () => {
  beforeEach(() => loadTestConfigs());

  it('ships the roles in game.json', () => {
    const skin = resolveSokobanSkin(ConfigRegistry.getGame().graphics);
    expect(skin).toEqual(DEFAULT_SOKOBAN_SKIN);
    expect(ConfigRegistry.getGame().graphics?.sokobanSkin).toBeDefined();
  });

  it('falls back to the defaults on a malformed block', () => {
    const graphics = { ...ConfigRegistry.getGame().graphics!, sokobanSkin: { baseUrl: 1 } } as never;
    expect(resolveSokobanSkin(graphics)).toBe(DEFAULT_SOKOBAN_SKIN);
  });

  it('reports roles that name an unknown tile or entity', () => {
    const graphics = {
      ...ConfigRegistry.getGame().graphics!,
      sokobanSkin: { ...DEFAULT_SOKOBAN_SKIN, terrain: { nope: ['a.png'] }, entities: { ghost: 'b.png' } }
    };
    const tileIds = new Set(Object.keys(ConfigRegistry.getTiles().tiles));
    const errors = findGraphicsConfigErrors(graphics, ConfigRegistry.getGame().palette, tileIds, new Set(['dirt_block']));
    expect(errors).toEqual(['sokobanSkin.terrain: unknown tile nope', 'sokobanSkin.entities: unknown entity ghost']);
  });
});

describe('Sokoban skin in the renderer', () => {
  const created: FakeCanvas[] = [];
  let now = 0;

  beforeEach(() => {
    loadTestConfigs();
    created.length = 0;
    now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => (now += FRAME_MS));
    vi.stubGlobal('document', {
      createElement: (): FakeCanvas => {
        const canvas = createCanvas(DEFAULT_CANVAS, DEFAULT_CANVAS);
        created.push(canvas);
        return canvas;
      }
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function level(winRule: 'targets' | undefined, blockOnTarget: boolean, hiddenWalls = false): CompiledLevel {
    const edge = MAP_SIZE - 1;
    const terrain: string[][] = Array.from({ length: MAP_SIZE }, (_, y) =>
      Array.from({ length: MAP_SIZE }, (_, x) => (x === 0 || y === 0 || x === edge || y === edge ? 'wall' : 'floor'))
    );
    terrain[BLOCK_CELL][BLOCK_CELL] = blockOnTarget ? 'block_target' : 'floor';
    terrain[3][3] = 'block_target';
    if (hiddenWalls) for (const cell of HIDDEN_WALL_CELLS) terrain[cell.y][cell.x] = cell.tile;
    return {
      id: 'skin-scene',
      number: 1,
      password: 'TEST',
      timeLimitSeconds: 0,
      chipsRequired: 0,
      playerStart: { x: PLAYER_CELL, y: PLAYER_CELL, dir: 'S' },
      terrain,
      items: Array.from({ length: MAP_SIZE }, () => Array.from({ length: MAP_SIZE }, () => null)),
      entities: [{ x: BLOCK_CELL, y: BLOCK_CELL, type: 'dirt_block', dir: 'E' }],
      trapLinks: [],
      cloneLinks: [],
      ...(winRule ? { winRule } : {})
    };
  }

  interface Scene {
    renderer: PixelRenderer;
    main: FakeCanvas;
    engine: GameEngine;
    frame(): void;
  }

  function scene(opts: {
    winRule?: 'targets';
    onTarget?: boolean;
    hiddenWalls?: boolean;
    style?: GraphicsStyle;
    loader?: SokobanSkinLoader | null;
  }): Scene {
    const engine = new GameEngine();
    engine.loadLevel(level(opts.winRule, opts.onTarget ?? false, opts.hiddenWalls ?? false));
    const renderer = new PixelRenderer();
    renderer.setStyle(opts.style ?? 'modern');
    renderer.setThemeId('cyber_neon');
    renderer.setViewportTiles(VIEW_TILES);
    if (opts.loader) renderer.setSkinLoader(opts.loader);
    const main = createCanvas(CANVAS_SIZE, CANVAS_SIZE);
    return { renderer, main, engine, frame: () => renderer.renderViewport(main.getContext('2d'), engine) };
  }

  function resetCalls(): void {
    for (const canvas of created) canvas.calls.length = 0;
  }

  /** Every drawImage whose source is a skin file or stack, over the main canvas and the caches. */
  function skinDraws(extra: readonly FakeCanvas[] = []): { file: string; size: number }[] {
    const draws: { file: string; size: number }[] = [];
    for (const canvas of [...created, ...extra]) {
      for (const call of canvas.calls) {
        if (call.name !== 'drawImage') continue;
        const source = call.args[0] as { file?: string; stack?: string[] };
        const file = source.file ?? source.stack?.join('+');
        if (file) draws.push({ file, size: call.args[3] as number });
      }
    }
    return draws;
  }

  it('draws terrain and blocks of a Sokoban level from the skin in every style', async () => {
    const loader = await loadedLoader();
    for (const style of ['modern', 'retro', 'retro32'] as const) {
      created.length = 0;
      const s = scene({ winRule: 'targets', style, loader });
      s.frame();
      const draws = skinDraws([s.main]);
      const files = new Set(draws.map((d) => d.file));
      expect(files.has('block_05.png')).toBe(true);
      expect(files.has('ground_06.png')).toBe(true);
      expect(files.has('ground_06.png+environment_06.png')).toBe(true);
      expect(files.has('crate_02.png')).toBe(true);
      // Low-res styles are drawn at the real tile size, not at the sprite unit.
      expect(Math.min(...draws.map((d) => d.size))).toBeGreaterThan(SPRITE_UNIT);
    }
  });

  it('draws hidden walls with the skin floor, so they do not stand out on a skinned level', async () => {
    const loader = await loadedLoader();
    for (const style of ['modern', 'retro', 'retro32'] as const) {
      created.length = 0;
      const withFloor = scene({ winRule: 'targets', style, loader });
      withFloor.frame();
      const floorDraws = skinDraws([withFloor.main]).filter((d) => d.file === 'ground_06.png').length;
      created.length = 0;
      const hidden = scene({ winRule: 'targets', style, loader, hiddenWalls: true });
      hidden.frame();
      const hiddenDraws = skinDraws([hidden.main]).filter((d) => d.file === 'ground_06.png').length;
      expect(hiddenDraws).toBe(floorDraws);
    }
  });

  it('marks the hidden walls over the skin floor while the eye boots are held', async () => {
    const loader = await loadedLoader();
    const markers = (canvases: readonly FakeCanvas[]): number =>
      canvases.reduce(
        (total, canvas) =>
          total + canvas.calls.filter((c) => c.name === 'setLineDash' && (c.args[0] as number[]).length === 2).length,
        0
      );
    const without = scene({ winRule: 'targets', loader, hiddenWalls: true });
    without.frame();
    const base = markers([...created, without.main]);
    created.length = 0;
    const eyed = scene({ winRule: 'targets', loader, hiddenWalls: true });
    eyed.engine.getPlayer().boots.add('boots_eye');
    eyed.frame();
    expect(markers([...created, eyed.main]) - base).toBe(HIDDEN_WALL_CELLS.length);
  });

  it('draws only the darker crate for a block standing on a target', async () => {
    const loader = await loadedLoader();
    const s = scene({ winRule: 'targets', onTarget: true, loader });
    const outline = vi.spyOn(PixelRenderer.prototype as unknown as { drawBlockOnTargetOutline(): void }, 'drawBlockOnTargetOutline');
    s.frame();
    const files = skinDraws([s.main]).map((d) => d.file);
    expect(files.filter((file) => file === 'crate_12.png')).toHaveLength(1);
    expect(files).not.toContain('crate_02.png');
    expect(outline).not.toHaveBeenCalled();
  });

  it('keeps the current style when the level is not Sokoban, the option is off or images are not ready', async () => {
    const loader = await loadedLoader();
    const plain = scene({ loader });
    plain.frame();
    expect(skinDraws([plain.main])).toEqual([]);

    const off = scene({ winRule: 'targets', loader });
    off.renderer.setSokobanSkinEnabled(false);
    off.frame();
    expect(skinDraws([off.main])).toEqual([]);

    const pending = new SokobanSkinLoader(DEFAULT_SOKOBAN_SKIN, fakeImages().make, stackComposer);
    const notReady = scene({ winRule: 'targets', loader: pending });
    notReady.frame();
    expect(skinDraws([notReady.main])).toEqual([]);
    const none = scene({ winRule: 'targets', loader: null });
    none.frame();
    expect(skinDraws([none.main])).toEqual([]);
  });

  it('never skins direct drawTile and drawEntity calls, such as the editor and the HUD icons', async () => {
    const loader = await loadedLoader();
    const s = scene({ winRule: 'targets', loader });
    s.frame();
    created.length = 0;
    const target = createCanvas(TILE_PX, TILE_PX);
    const ctx = target.getContext('2d');
    s.renderer.drawTile(ctx, 'wall', 0, 0, TILE_PX, true);
    s.renderer.drawTile(ctx, 'block_target', 0, 0, TILE_PX);
    s.renderer.drawEntity(ctx, 'dirt_block', 'E', 0, 0, TILE_PX);
    expect(skinDraws([target])).toEqual([]);
  });

  it('rebuilds the terrain cache when the option is toggled or the images finish loading', async () => {
    const loader = await loadedLoader();
    const s = scene({ winRule: 'targets', loader });
    for (let i = 0; i < SETTLE_FRAMES; i++) s.frame();
    resetCalls();
    s.frame();
    expect(skinDraws().filter((d) => d.file === 'block_05.png')).toHaveLength(0);
    const cacheCalls = (): number => created.reduce((total, canvas) => total + canvas.calls.length, 0);
    const steadyCalls = cacheCalls();
    resetCalls();
    s.renderer.setSokobanSkinEnabled(false);
    s.frame();
    expect(cacheCalls()).toBeGreaterThan(steadyCalls);
    expect(skinDraws().filter((d) => d.file === 'block_05.png')).toHaveLength(0);
    s.renderer.setSokobanSkinEnabled(true);
    s.frame();
    expect(skinDraws().filter((d) => d.file === 'block_05.png').length).toBeGreaterThan(0);

    const late = new SokobanSkinLoader(DEFAULT_SOKOBAN_SKIN, fakeImages().make, stackComposer);
    const lateScene = scene({ winRule: 'targets', loader: late });
    for (let i = 0; i < SETTLE_FRAMES; i++) lateScene.frame();
    resetCalls();
    await late.load();
    lateScene.frame();
    expect(skinDraws().filter((d) => d.file === 'block_05.png').length).toBeGreaterThan(0);
  });
});
