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
 * Freezes everything the "Runeward" render style draws, as the exact sequence of canvas calls and
 * property assignments recorded on a fake 2D context, for one theme. While no Runeward painter
 * exists the style draws like HD Neon in the Runeward colours; each lot that adds painters changes
 * these snapshots on purpose, and only these.
 *
 * The committed snapshots hold one line per case, `<heading> <sha256 of the case's full call log>`, to keep
 * the repository small. On a mismatch the full current log of every failing case is written to
 * `local/snapshot-diff/` (git-ignored) so it can be diffed against a run on the previous code.
 *
 * Two recording modes are used, because the renderer paints differently with and without a DOM:
 * - direct: `document` is undefined, the sprite cache returns null and every shape is painted
 *   straight into the recorded context;
 * - sprite: `document` is a stub whose canvases hand out recorded contexts, so sprites are painted
 *   into their own recorded contexts and blitted with `drawImage`.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../audio/AudioManager', () => ({
  AudioManager: { playSfx: vi.fn() }
}));

import { ConfigRegistry } from '../config/ConfigRegistry';
import { Direction } from '../core/types';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { PixelRenderer } from './PixelRenderer';
import { cellHash, ISOLATED_TILE, NEIGHBOUR, TileNeighbours } from './tileNeighbours';

const SNAPSHOT_DIR = './__snapshots__/runeward';
const STYLE_ID = 'runeward';
const THEME_ID = 'cyber_neon';
const DIFF_DIR_FROM_ROOT = 'local/snapshot-diff';
const SECTION_PREFIX = '## ';
const HASH_ALGORITHM = 'sha256';
const HASH_HEX_LENGTH = 16;
const REPO_ROOT_DEPTH = '../..';
const TILE_SIZE = 48;
const ROUND_FACTOR = 10000;
const FIXED_RANDOM = 0.5;
const TEXT_WIDTH_PER_CHAR = 6;
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
const DEFAULT_CANVAS = { width: 300, height: 150 };

type RecordingMode = 'direct' | 'sprite';
type NeighbourCase = { title: string; neighbours: TileNeighbours };

/** Collects the log lines of one case group; every context shares it so the order is global. */
class CallLog {
  public readonly lines: string[] = [];
  private canvasCount = 0;
  private gradientCount = 0;

  public nextCanvasId(): number {
    return ++this.canvasCount;
  }

  public nextGradientId(): number {
    return ++this.gradientCount;
  }

  /** Starts a section; gradient numbers restart so identical drawings produce identical lines. */
  public section(title: string): void {
    this.gradientCount = 0;
    this.lines.push(`## ${title}`);
  }

  public text(): string {
    return `${this.lines.join('\n')}\n`;
  }
}

interface Labelled {
  readonly label: string;
}

function isLabelled(value: unknown): value is Labelled {
  return typeof value === 'object' && value !== null && 'label' in value && typeof (value as Labelled).label === 'string';
}

function formatNumber(value: number): string {
  if (Number.isNaN(value)) return 'NaN';
  if (!Number.isFinite(value)) return value > 0 ? 'Infinity' : '-Infinity';
  const rounded = Math.round(value * ROUND_FACTOR) / ROUND_FACTOR;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

function formatValue(value: unknown): string {
  if (typeof value === 'number') return formatNumber(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean' || value === null || value === undefined) return String(value);
  if (Array.isArray(value)) return `[${value.map(formatValue).join(',')}]`;
  if (isLabelled(value)) return value.label;
  return `<${typeof value}>`;
}

function formatArgs(args: readonly unknown[]): string {
  return args.map(formatValue).join(', ');
}

const INITIAL_PROPERTIES: Readonly<Record<string, unknown>> = {
  fillStyle: '#000000',
  strokeStyle: '#000000',
  lineWidth: 1,
  lineCap: 'butt',
  lineJoin: 'miter',
  miterLimit: 10,
  lineDashOffset: 0,
  globalAlpha: 1,
  globalCompositeOperation: 'source-over',
  shadowBlur: 0,
  shadowColor: 'rgba(0, 0, 0, 0)',
  shadowOffsetX: 0,
  shadowOffsetY: 0,
  font: '10px sans-serif',
  textAlign: 'start',
  textBaseline: 'alphabetic',
  imageSmoothingEnabled: true,
  imageSmoothingQuality: 'low',
  filter: 'none'
};

interface FakeCanvas {
  readonly label: string;
  width: number;
  height: number;
  getContext(kind: string): CanvasRenderingContext2D | null;
  toDataURL(): string;
}

/** A recording 2D context: every call and property assignment becomes one log line. */
function createRecordingContext(log: CallLog, canvas: FakeCanvas, prefix: string): CanvasRenderingContext2D {
  const state: Record<string, unknown> = { ...INITIAL_PROPERTIES, canvas };
  let lineDash: number[] = [];
  const record = (line: string): void => {
    log.lines.push(prefix + line);
  };
  const gradient = (kind: string, args: unknown[]): Labelled & { addColorStop(offset: number, color: string): void } => {
    const label = `<${kind}#${log.nextGradientId()}>`;
    record(`${kind}(${formatArgs(args)}) -> ${label}`);
    return {
      label,
      addColorStop(offset: number, color: string): void {
        record(`${label}.addColorStop(${formatArgs([offset, color])})`);
      }
    };
  };

  return new Proxy(state, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      return (...args: unknown[]): unknown => {
        switch (prop) {
          case 'createLinearGradient':
          case 'createRadialGradient':
            return gradient(prop, args);
          case 'createPattern': {
            const label = `<pattern#${log.nextGradientId()}>`;
            record(`createPattern(${formatArgs(args)}) -> ${label}`);
            return { label };
          }
          case 'measureText': {
            const width = String(args[0]).length * TEXT_WIDTH_PER_CHAR;
            record(`measureText(${formatArgs(args)}) -> ${width}`);
            return { width };
          }
          case 'getLineDash':
            return [...lineDash];
          case 'setLineDash':
            lineDash = [...(args[0] as number[])];
            record(`setLineDash(${formatArgs(args)})`);
            return undefined;
          default:
            record(`${prop}(${formatArgs(args)})`);
            return undefined;
        }
      };
    },
    set(target, prop: string, value: unknown) {
      target[prop] = value;
      record(`${prop} = ${formatValue(value)}`);
      return true;
    }
  }) as unknown as CanvasRenderingContext2D;
}

/** A recorded main canvas context of the given size, whose lines carry no prefix. */
function createMainContext(log: CallLog, width: number, height: number): CanvasRenderingContext2D {
  const canvas: FakeCanvas = {
    label: `<main ${width}x${height}>`,
    width,
    height,
    getContext: () => null,
    toDataURL: () => ''
  };
  const ctx = createRecordingContext(log, canvas, '');
  canvas.getContext = () => ctx;
  return ctx;
}

/** Makes `document.createElement('canvas')` hand out fake canvases with recorded contexts. */
function installDocumentStub(log: CallLog): void {
  vi.stubGlobal('document', {
    createElement: (tag: string): FakeCanvas => {
      if (tag !== 'canvas') throw new Error(`unexpected element ${tag}`);
      const id = log.nextCanvasId();
      let ctx: CanvasRenderingContext2D | null = null;
      const canvas: FakeCanvas = {
        get label() {
          return `<canvas#${id} ${canvas.width}x${canvas.height}>`;
        },
        width: DEFAULT_CANVAS.width,
        height: DEFAULT_CANVAS.height,
        getContext: () => {
          ctx ??= createRecordingContext(log, canvas, `[c${id}] `);
          return ctx;
        },
        toDataURL: () => `data:canvas#${id}`
      };
      return canvas;
    }
  });
}

interface RendererInternals {
  timeTick: number;
  animFrame: number;
}

function setClock(renderer: PixelRenderer, tick: number): void {
  const internals = renderer as unknown as RendererInternals;
  internals.timeTick = tick;
  internals.animFrame = ANIM_FRAME;
}

function createRenderer(themeId: string): PixelRenderer {
  const renderer = new PixelRenderer();
  renderer.setStyle(STYLE_ID);
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

interface CaseLog {
  heading: string;
  text: string;
}

/** Splits a recorded log into its cases, one per section heading. */
function splitCases(log: string): CaseLog[] {
  const cases: CaseLog[] = [];
  for (const line of log.split('\n')) {
    if (line.startsWith(SECTION_PREFIX)) cases.push({ heading: line.slice(SECTION_PREFIX.length), text: `${line}\n` });
    else if (cases.length > 0 && line !== '') cases[cases.length - 1].text += `${line}\n`;
  }
  return cases;
}

function hashOf(text: string): string {
  return createHash(HASH_ALGORITHM).update(text).digest('hex').slice(0, HASH_HEX_LENGTH);
}

function safeFileName(heading: string): string {
  return heading.replace(/[^A-Za-z0-9._=-]+/g, '_');
}

function isUpdatingSnapshots(): boolean {
  const state = expect.getState() as unknown as { snapshotState?: { _updateSnapshot?: string } };
  return state.snapshotState?._updateSnapshot === 'all';
}

/**
 * Compares the case hashes of a recorded log with the committed snapshot file. On a mismatch the full
 * log of each failing case goes to `local/snapshot-diff/<group>/` and the assertion says so.
 */
async function verifyCases(log: string, snapshotPath: string): Promise<void> {
  const cases = splitCases(log);
  expect(cases.length).toBeGreaterThan(0);
  const current = cases.map((c) => `${c.heading} ${hashOf(c.text)}`);
  const text = `${current.join('\n')}
`;
  const here = dirname(fileURLToPath(import.meta.url));
  const file = resolve(here, snapshotPath);
  if (existsSync(file) && !isUpdatingSnapshots()) {
    const expected = new Map(
      readFileSync(file, 'utf-8')
        .split(/\r?\n/)
        .filter((line) => line !== '')
        .map((line) => [line.slice(0, line.lastIndexOf(' ')), line.slice(line.lastIndexOf(' ') + 1)] as const)
    );
    const failing = cases.filter((c) => expected.get(c.heading) !== hashOf(c.text));
    const missing = [...expected.keys()].filter((heading) => !cases.some((c) => c.heading === heading));
    if (failing.length > 0 || missing.length > 0) {
      const group = safeFileName(snapshotPath.split('/').pop() ?? 'group');
      const dir = resolve(here, REPO_ROOT_DEPTH, DIFF_DIR_FROM_ROOT, group);
      mkdirSync(dir, { recursive: true });
      for (const c of failing) writeFileSync(resolve(dir, `${safeFileName(c.heading)}.txt`), c.text, 'utf-8');
      throw new Error(
        `${failing.length} case(s) differ and ${missing.length} case(s) vanished in ${snapshotPath}. ` +
          `Full current logs of the failing cases were written to ${DIFF_DIR_FROM_ROOT}/${group}/ ` +
          `(first: ${failing[0]?.heading ?? missing[0]}).`
      );
    }
  }
  await expect(text).toMatchFileSnapshot(snapshotPath);
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

describe('Runeward render style snapshots', () => {
  beforeEach(() => {
    loadTestConfigs();
    vi.spyOn(Math, 'random').mockReturnValue(FIXED_RANDOM);
    vi.spyOn(performance, 'now').mockReturnValue(0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('runs without a DOM, so direct mode really paints into the recorded context', () => {
    expect(typeof document).toBe('undefined');
  });

  it('draws with the Runeward style and its theme', () => {
    const renderer = createRenderer(THEME_ID);
    expect(renderer.getStyle()).toBe(STYLE_ID);
    expect(Object.keys(ConfigRegistry.getGame().themes ?? {})).toContain(THEME_ID);
  });

  for (const mode of ['direct', 'sprite'] as const) {
    it(`tiles, ${mode} mode`, async () => {
      const coverage = newCoverage();
      const out = capture(mode, (ctx, log) => recordTiles(createRenderer(THEME_ID), ctx, log, coverage));
      expect(coverage.tiles.size).toBe(tilesByLayer('terrain').length);
      expect(coverage.tiles.size).toBeGreaterThanOrEqual(WALL_MASK_COUNT);
      await verifyCases(out, `${SNAPSHOT_DIR}/${THEME_ID}.tiles.${mode}.snap.txt`);
    });

    it(`items, entities and player, ${mode} mode`, async () => {
      const coverage = newCoverage();
      const out = capture(mode, (ctx, log) => recordSprites(createRenderer(THEME_ID), ctx, log, coverage));
      expect(coverage.items.size).toBe(tilesByLayer('item').length);
      expect(coverage.entities.size).toBe(entityTypes().length);
      await verifyCases(out, `${SNAPSHOT_DIR}/${THEME_ID}.sprites.${mode}.snap.txt`);
    });
  }
});
