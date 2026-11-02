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
 * Freezes everything the five Retro HD styles (Pocket, Pastel, Blueprint, Sepia, Classic 90s) draw,
 * as the exact sequence of canvas calls and property assignments recorded on a fake 2D context.
 * They draw like HD Neon with recoloured palettes, banded gradients, no glow and a texture overlay,
 * so a change to any of those shows up as a changed hash. The committed snapshots hold one line per
 * case, `<heading> <sha256 of the case's full call log>`; see callLogRecorder for the failure report.
 *
 * Two recording modes, as in the HD Neon snapshots: direct (no DOM, every shape painted into the
 * recorded context) and sprite (a document stub whose canvases hand out recorded contexts).
 */

import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../audio/AudioManager', () => ({
  AudioManager: { playSfx: vi.fn() }
}));

import { ConfigRegistry } from '../config/ConfigRegistry';
import { GameEngine } from '../core/GameEngine';
import { CompiledLevel, Direction, GraphicsStyle } from '../core/types';
import { CallLog, createMainContext, installDocumentStub, verifyCases } from '../test/callLogRecorder';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { PixelRenderer } from './PixelRenderer';
import { cellHash, ISOLATED_TILE, NEIGHBOUR, TileNeighbours } from './tileNeighbours';

const SNAPSHOT_DIR = './__snapshots__/retroHd';
const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const STYLE_IDS: readonly GraphicsStyle[] = ['pocket', 'pastel', 'blueprint', 'sepia', 'classic90'];
const THEME_IDS = ['cyber_neon', 'arctic_lab', 'magma_core', 'lynx_lcd'] as const;

const TILE_SIZE = 48;
const SCENE_CANVAS_SIZE = 240;
const SCENE_FRAMES = 3;
const FRAME_MS = 16;
const FIXED_RANDOM = 0.5;
const ORIGIN_X = 10;
const ORIGIN_Y = 20;
const HASH_SCAN_SIDE = 8;
const SHADOW_NORTH_WEST = NEIGHBOUR.N | NEIGHBOUR.W;
const DIRECTIONS: readonly Direction[] = ['N', 'E', 'S', 'W'];
/** Two clock values that fall in the two monster walk frames (10 ticks per frame). */
const CLOCK_TICKS = [3, 13] as const;
const PLAYER_FRAMES = [0, 1, 2] as const;
const PLAYER_HOPS = [0, 0.3] as const;
const ANIM_FRAME = 7;
const WALL_MASK_COUNT = 16;
const ALL_NEIGHBOURS = 255;
const SCENE_SIZE = 12;
const SCENE_PLAYER = { x: 5, y: 5 };


type RecordingMode = 'direct' | 'sprite';
type NeighbourCase = { title: string; neighbours: TileNeighbours };

interface RendererInternals {
  timeTick: number;
  animFrame: number;
}

function setClock(renderer: PixelRenderer, tick: number): void {
  const internals = renderer as unknown as RendererInternals;
  internals.timeTick = tick;
  internals.animFrame = ANIM_FRAME;
}

function createRenderer(style: GraphicsStyle, themeId: string): PixelRenderer {
  const renderer = new PixelRenderer();
  renderer.setStyle(style);
  renderer.setThemeId(themeId);
  setClock(renderer, CLOCK_TICKS[0]);
  return renderer;
}

/** Runs `body` against a fresh log and recording context, in the given mode. */
function capture(mode: RecordingMode, body: (ctx: CanvasRenderingContext2D, log: CallLog) => void): string {
  const log = new CallLog();
  if (mode === 'sprite') installDocumentStub(log);
  try {
    body(createMainContext(log, TILE_SIZE * 2, TILE_SIZE * 2), log);
  } finally {
    vi.unstubAllGlobals();
  }
  return log.text();
}


function tilesByLayer(layer: string): string[] {
  return Object.values(ConfigRegistry.getTiles().tiles)
    .filter((tile) => tile.layer === layer)
    .map((tile) => tile.id);
}

function entityTypes(): string[] {
  return Object.keys(ConfigRegistry.getMonsters().entities);
}

/** Wall masks cover every N/E/S/W combination, plus fully surrounded cells with and without a panel. */
function wallNeighbours(): NeighbourCase[] {
  const edges = [NEIGHBOUR.N, NEIGHBOUR.E, NEIGHBOUR.S, NEIGHBOUR.W];
  const cases: NeighbourCase[] = [];
  for (let bits = 0; bits < WALL_MASK_COUNT; bits++) {
    let mask = 0;
    edges.forEach((edge, index) => {
      if (bits & (1 << index)) mask |= edge;
    });
    cases.push({ title: `wallMask=${mask} hash=1`, neighbours: { wallMask: mask, shadowMask: 0, hash: 1 } });
  }
  const full = ALL_NEIGHBOURS;
  cases.push({ title: 'wallMask=255 hash=0', neighbours: { wallMask: full, shadowMask: 0, hash: 0 } });
  cases.push({ title: 'wallMask=255 hash=3', neighbours: { wallMask: full, shadowMask: 0, hash: 3 } });
  cases.push({ title: 'wallMask=255 hash=7', neighbours: { wallMask: full, shadowMask: 0, hash: 7 } });
  return cases;
}

/** Every combination of the north, west and north-west shadow bits, plus all bits. */
function shadowNeighbours(): NeighbourCase[] {
  const bitList = [NEIGHBOUR.N, NEIGHBOUR.W, NEIGHBOUR.NW];
  const cases: NeighbourCase[] = [];
  for (let bits = 0; bits < 1 << bitList.length; bits++) {
    let mask = 0;
    bitList.forEach((bit, index) => {
      if (bits & (1 << index)) mask |= bit;
    });
    cases.push({ title: `shadowMask=${mask} hash=1`, neighbours: { wallMask: 0, shadowMask: mask, hash: 1 } });
  }
  cases.push({ title: `shadowMask=${ALL_NEIGHBOURS} hash=1`, neighbours: { wallMask: 0, shadowMask: ALL_NEIGHBOURS, hash: 1 } });
  return cases;
}

/** Shadow variants that exercise the three parts (north, west, corner) for tiles that are not floor. */
function reducedShadowNeighbours(): NeighbourCase[] {
  const masks = [SHADOW_NORTH_WEST, NEIGHBOUR.NW];
  return masks.map((mask) => ({ title: `shadowMask=${mask} hash=1`, neighbours: { wallMask: 0, shadowMask: mask, hash: 1 } }));
}

/** Cell hashes of a small grid: spreads floor details over all their kinds. */
function scannedHashes(): NeighbourCase[] {
  const cases: NeighbourCase[] = [{ title: 'isolated', neighbours: ISOLATED_TILE }];
  for (let y = 0; y < HASH_SCAN_SIDE; y++) {
    for (let x = 0; x < HASH_SCAN_SIDE; x++) {
      const hash = cellHash(x, y);
      cases.push({ title: `cell(${x},${y}) hash=${hash}`, neighbours: { wallMask: 0, shadowMask: 0, hash } });
    }
  }
  return cases;
}

/** Tiles that share the floor details, so a hidden wall gives nothing away. */
const DETAIL_TILES = new Set(['floor', 'invisible_wall', 'appearing_wall']);

function neighbourCasesFor(tileId: string): NeighbourCase[] {
  if (tileId === 'wall') return wallNeighbours();
  if (DETAIL_TILES.has(tileId)) return [...scannedHashes(), ...shadowNeighbours()];
  return [{ title: 'isolated', neighbours: ISOLATED_TILE }, ...reducedShadowNeighbours()];
}

interface Coverage {
  tiles: Set<string>;
  items: Set<string>;
  entities: Set<string>;
}

function newCoverage(): Coverage {
  return { tiles: new Set(), items: new Set(), entities: new Set() };
}

function recordTiles(renderer: PixelRenderer, ctx: CanvasRenderingContext2D, log: CallLog, coverage: Coverage): void {
  for (const tileId of tilesByLayer('terrain')) {
    coverage.tiles.add(tileId);
    const trapStates = tileId === 'trap' ? [true, false] : [true];
    for (const closed of trapStates) {
      for (const { title, neighbours } of neighbourCasesFor(tileId)) {
        log.section(`tile ${tileId} closed=${closed} ${title}`);
        for (const pass of ['static', 'animated', 'all'] as const) {
          const ticks = pass === 'static' ? [CLOCK_TICKS[0]] : CLOCK_TICKS;
          for (const tick of ticks) {
            setClock(renderer, tick);
            log.lines.push(`# pass=${pass} tick=${tick}`);
            renderer.drawTile(ctx, tileId, ORIGIN_X, ORIGIN_Y, TILE_SIZE, false, closed, pass, neighbours);
          }
        }
      }
    }
  }
}

function recordSprites(renderer: PixelRenderer, ctx: CanvasRenderingContext2D, log: CallLog, coverage: Coverage): void {
  for (const tick of CLOCK_TICKS) {
    setClock(renderer, tick);
    for (const itemId of tilesByLayer('item')) {
      coverage.items.add(itemId);
      log.section(`item ${itemId} tick=${tick}`);
      renderer.drawItem(ctx, itemId, ORIGIN_X, ORIGIN_Y, TILE_SIZE);
    }
    for (const type of entityTypes()) {
      coverage.entities.add(type);
      for (const dir of DIRECTIONS) {
        log.section(`entity ${type} dir=${dir} tick=${tick}`);
        renderer.drawEntity(ctx, type, dir, ORIGIN_X, ORIGIN_Y, TILE_SIZE);
      }
    }
  }
  setClock(renderer, CLOCK_TICKS[0]);
  const states = [
    { inWater: false, alive: true },
    { inWater: true, alive: true },
    { inWater: false, alive: false }
  ];
  for (const { inWater, alive } of states) {
    for (const dir of DIRECTIONS) {
      for (const frame of PLAYER_FRAMES) {
        for (const hop of PLAYER_HOPS) {
          log.section(`player dir=${dir} inWater=${inWater} alive=${alive} frame=${frame} hop=${hop}`);
          renderer.drawPlayer(ctx, ORIGIN_X, ORIGIN_Y, TILE_SIZE, dir, inWater, alive, frame, hop);
        }
      }
    }
  }
}

/** The legacy tile code reached from HD Neon through the editor flag, for every tile id. */
function recordEditorTiles(renderer: PixelRenderer, ctx: CanvasRenderingContext2D, log: CallLog): void {
  const ids = [...tilesByLayer('terrain'), ...tilesByLayer('item')];
  for (const tileId of ids) {
    for (const closed of [true, false]) {
      log.section(`editor tile ${tileId} closed=${closed}`);
      renderer.drawTile(ctx, tileId, ORIGIN_X, ORIGIN_Y, TILE_SIZE, true, closed);
    }
  }
  for (const itemId of tilesByLayer('item')) {
    log.section(`editor item over floor ${itemId}`);
    renderer.drawTile(ctx, 'floor', ORIGIN_X, ORIGIN_Y, TILE_SIZE, true, true);
    renderer.drawItem(ctx, itemId, ORIGIN_X, ORIGIN_Y, TILE_SIZE);
  }
  for (const type of entityTypes()) {
    log.section(`editor entity over floor ${type}`);
    renderer.drawTile(ctx, 'floor', ORIGIN_X, ORIGIN_Y, TILE_SIZE, true, true);
    renderer.drawEntity(ctx, type, 'S', ORIGIN_X, ORIGIN_Y, TILE_SIZE);
  }
}

function sceneLevel(): CompiledLevel {
  const edge = SCENE_SIZE - 1;
  const terrain: string[][] = Array.from({ length: SCENE_SIZE }, (_, y) =>
    Array.from({ length: SCENE_SIZE }, (_, x) => (x === 0 || y === 0 || x === edge || y === edge ? 'wall' : 'floor'))
  );
  const placements: Record<string, [number, number]> = {
    water: [2, 2],
    fire: [3, 2],
    ice: [4, 2],
    force_e: [5, 2],
    exit: [6, 2],
    teleport: [7, 2],
    button_green: [8, 2],
    toggle_wall_closed: [2, 4],
    trap: [3, 4],
    door_red: [4, 4],
    socket: [6, 4],
    block_target: [7, 4],
    flame_jet_on: [8, 4],
    wall: [3, 7]
  };
  for (const [tileId, [x, y]] of Object.entries(placements)) terrain[y][x] = tileId;
  const items: (string | null)[][] = Array.from({ length: SCENE_SIZE }, () =>
    Array.from({ length: SCENE_SIZE }, () => null)
  );
  items[7][6] = 'chip';
  items[7][7] = 'key_red';
  items[8][2] = 'bomb';
  return {
    id: 'scene',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    playerStart: { x: SCENE_PLAYER.x, y: SCENE_PLAYER.y, dir: 'S' },
    terrain,
    items,
    entities: [
      { x: 8, y: 8, type: 'bug', dir: 'E' },
      { x: 2, y: 8, type: 'blob', dir: 'N' },
      { x: 4, y: 6, type: 'dirt_block', dir: 'S' },
      { x: 7, y: 9, type: 'ice_block', dir: 'S' }
    ],
    trapLinks: [],
    cloneLinks: []
  };
}

function recordScene(style: GraphicsStyle, themeId: string): string {
  const log = new CallLog();
  installDocumentStub(log);
  let now = 0;
  const performanceSpy = vi.spyOn(performance, 'now').mockImplementation(() => (now += FRAME_MS));
  try {
    const engine = new GameEngine();
    engine.loadLevel(sceneLevel());
    const renderer = createRenderer(style, themeId);
    renderer.setViewportTiles(SCENE_SIZE);
    const ctx = createMainContext(log, SCENE_CANVAS_SIZE, SCENE_CANVAS_SIZE);
    for (let frame = 0; frame < SCENE_FRAMES; frame++) {
      log.section(`scene ${themeId} frame ${frame}`);
      renderer.renderViewport(ctx, engine);
      renderer.incrementFrame();
    }
  } finally {
    performanceSpy.mockRestore();
    vi.unstubAllGlobals();
  }
  return log.text();
}

const SMALL_MAP_SIZE = 6;
const WIDE_CANVAS = { width: 300, height: 150 };
const OVERLAY_PATH = [
  { x: 3, y: 3 },
  { x: 4, y: 3 },
  { x: 4, y: 4 }
];

/** A map smaller than the view, with a few tiles, one item and one monster. */
function smallLevel(): CompiledLevel {
  const edge = SMALL_MAP_SIZE - 1;
  const terrain: string[][] = Array.from({ length: SMALL_MAP_SIZE }, (_, y) =>
    Array.from({ length: SMALL_MAP_SIZE }, (_, x) => (x === 0 || y === 0 || x === edge || y === edge ? 'wall' : 'floor'))
  );
  terrain[1][1] = 'water';
  terrain[1][2] = 'fire';
  terrain[2][4] = 'exit';
  const items: (string | null)[][] = Array.from({ length: SMALL_MAP_SIZE }, () =>
    Array.from({ length: SMALL_MAP_SIZE }, () => null)
  );
  items[4][1] = 'chip';
  return {
    id: 'small',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    playerStart: { x: 3, y: 3, dir: 'S' },
    terrain,
    items,
    entities: [{ x: 2, y: 4, type: 'bug', dir: 'E' }],
    trapLinks: [],
    cloneLinks: []
  };
}

/** Planned path, explosion shake and effects, on a non-square canvas over a map smaller than the view. */
function recordOverlayScene(style: GraphicsStyle, themeId: string): string {
  const log = new CallLog();
  installDocumentStub(log);
  let now = 0;
  const performanceSpy = vi.spyOn(performance, 'now').mockImplementation(() => (now += FRAME_MS));
  try {
    const engine = new GameEngine();
    engine.loadLevel(smallLevel());
    const renderer = createRenderer(style, themeId);
    renderer.setViewportTiles(SCENE_SIZE);
    renderer.setPlannedPath(OVERLAY_PATH);
    renderer.triggerVisualEvent('explosion', SCENE_PLAYER.x - 2, SCENE_PLAYER.y - 2);
    const ctx = createMainContext(log, WIDE_CANVAS.width, WIDE_CANVAS.height);
    for (let frame = 0; frame < SCENE_FRAMES; frame++) {
      log.section(`overlay scene ${themeId} frame ${frame}`);
      renderer.renderViewport(ctx, engine);
      renderer.incrementFrame();
    }
  } finally {
    performanceSpy.mockRestore();
    vi.unstubAllGlobals();
  }
  return log.text();
}


describe('Retro HD render style snapshots', () => {
  beforeEach(() => {
    loadTestConfigs();
    vi.spyOn(Math, 'random').mockReturnValue(FIXED_RANDOM);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('runs without a DOM, so direct mode really paints into the recorded context', () => {
    expect(typeof document).toBe('undefined');
  });

  it('covers the four shipped themes', () => {
    expect(Object.keys(ConfigRegistry.getGame().themes ?? {})).toEqual([...THEME_IDS]);
  });

  for (const style of STYLE_IDS) {
    describe(`style ${style}`, () => {
      for (const mode of ['direct', 'sprite'] as const) {
        it(`tiles, ${mode} mode`, async () => {
          const coverage = newCoverage();
          const out = capture(mode, (ctx, log) => recordTiles(createRenderer(style, THEME_IDS[0]), ctx, log, coverage));
          expect(coverage.tiles.size).toBe(tilesByLayer('terrain').length);
          await verifyCases(out, `${SNAPSHOT_DIR}/${style}.tiles.${mode}.snap.txt`, TEST_DIR);
        });

        it(`items, entities and player, ${mode} mode`, async () => {
          const coverage = newCoverage();
          const out = capture(mode, (ctx, log) => recordSprites(createRenderer(style, THEME_IDS[0]), ctx, log, coverage));
          expect(coverage.items.size).toBe(tilesByLayer('item').length);
          expect(coverage.entities.size).toBe(entityTypes().length);
          await verifyCases(out, `${SNAPSHOT_DIR}/${style}.sprites.${mode}.snap.txt`, TEST_DIR);
        });

        it(`editor and icon path, ${mode} mode`, async () => {
          const out = capture(mode, (ctx, log) => recordEditorTiles(createRenderer(style, THEME_IDS[0]), ctx, log));
          await verifyCases(out, `${SNAPSHOT_DIR}/${style}.editor.${mode}.snap.txt`, TEST_DIR);
        });
      }

      for (const themeId of THEME_IDS) {
        it(`full scene in ${themeId}`, async () => {
          const out = recordScene(style, themeId);
          expect(out).toContain(`## scene ${themeId} frame ${SCENE_FRAMES - 1}`);
          await verifyCases(out, `${SNAPSHOT_DIR}/${style}.${themeId}.scene.snap.txt`, TEST_DIR);
        });
      }

      it('planned path, explosion and a small map on a wide canvas', async () => {
        const out = recordOverlayScene(style, THEME_IDS[0]);
        expect(out).toContain(`## overlay scene ${THEME_IDS[0]} frame ${SCENE_FRAMES - 1}`);
        await verifyCases(out, `${SNAPSHOT_DIR}/${style}.overlay-scene.snap.txt`, TEST_DIR);
      });
    });
  }
});
