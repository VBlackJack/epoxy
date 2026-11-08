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
 * The Runeward marks (gravel, dirt, hint, recessed wall, block target, slime, turtle, thief, floating blocks,
 * flame and swap buttons, signal tiles): distinct drawings, legibility of their colours read from game.json in
 * both art variants, the glyph of each floating block, the frozen turtle under reduced motion and the signal
 * power states. When a contrast pair fails, the colours in game.json change, never the thresholds below.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigRegistry } from '../../../config/ConfigRegistry';
import type { RunewardArtConfig } from '../../../core/types';
import { loadTestConfigs } from '../../../test/loadTestConfigs';
import { createRecordedContext } from '../../../test/runewardTestContext';
import { paintSignalTile, SIGNAL_TILE_KINDS, type SignalTileStyle } from '../../signalTilePainter';
import { NEIGHBOUR, type TileNeighbours } from '../../tileNeighbours';
import * as marks from './runewardMarks';
import { RUNEWARD_FALLBACK, RUNEWARD_PAINTERS, type RunewardPaintEnv, type RunewardTilePass } from './runewardTiles';

vi.mock('../../colorGlyph', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../colorGlyph')>();
  return { ...actual, paintColorGlyph: vi.fn(actual.paintColorGlyph) };
});

import { paintColorGlyph } from '../../colorGlyph';

const TILE = 48;
const FAR_TICK = 937;
const CELL: Readonly<TileNeighbours> = { wallMask: 0, shadowMask: NEIGHBOUR.N, hash: 424242, cx: 3, cy: 7 };
const OTHER_CELL: Readonly<TileNeighbours> = { wallMask: 0, shadowMask: NEIGHBOUR.N, hash: 99991, cx: 8, cy: 2 };
const FLOOR_ID = 'floor';
const PATCH_ON_FLOOR_MIN = 1.5;
const LIT_ON_IDLE_MIN = 3;
const HINT_MARK_ON_SHEET_MIN = 4.5;
const SIGNAL_STYLE: SignalTileStyle = { rounded: true, glowBlurPx: 0 };

const HEX_RADIX = 16;
const SRGB_LINEAR_CUTOFF = 0.03928;
const SRGB_LINEAR_DIVISOR = 12.92;
const SRGB_OFFSET = 0.055;
const SRGB_SCALE = 1.055;
const SRGB_GAMMA = 2.4;
const LUMA_RED = 0.2126;
const LUMA_GREEN = 0.7152;
const LUMA_BLUE = 0.0722;
const FLARE = 0.05;
const MAX_CHANNEL = 255;

function luminance(hex: string): number {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) throw new Error(`not an opaque hex colour: ${hex}`);
  const [r, g, b] = [match[1], match[2], match[3]].map((part) => {
    const c = parseInt(part, HEX_RADIX) / MAX_CHANNEL;
    return c <= SRGB_LINEAR_CUTOFF ? c / SRGB_LINEAR_DIVISOR : Math.pow((c + SRGB_OFFSET) / SRGB_SCALE, SRGB_GAMMA);
  });
  return LUMA_RED * r + LUMA_GREEN * g + LUMA_BLUE * b;
}

/** WCAG contrast ratio, at least 1. */
function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + FLARE) / (Math.min(la, lb) + FLARE);
}

interface Variant {
  readonly name: string;
  readonly art: () => RunewardArtConfig;
}

const VARIANTS: readonly Variant[] = [
  { name: 'plain', art: () => ConfigRegistry.getGame().runewardArt as RunewardArtConfig },
  { name: 'parchment', art: () => ConfigRegistry.getGame().runewardArtVariants?.parchment as RunewardArtConfig }
];

function envOf(art: RunewardArtConfig, timeTick = 0, reducedMotion = false, signalPowered = false): RunewardPaintEnv {
  return { timeTick, signalPowered, reducedMotion, cache: new Map(), art };
}

function tileLog(
  id: string,
  art: RunewardArtConfig,
  env: RunewardPaintEnv = envOf(art),
  pass: RunewardTilePass = 'all',
  cell: Readonly<TileNeighbours> = CELL
): string[] {
  const { ctx, lines } = createRecordedContext();
  RUNEWARD_PAINTERS.tiles[id](ctx, 0, 0, TILE, pass, cell, env, false, false);
  return lines;
}

/** The drawing a tile painter adds between its own save/translate and restore. */
function body(lines: readonly string[]): string[] {
  const SKIPPED_HEAD = 2;
  return lines.slice(SKIPPED_HEAD, -1);
}

/** True when `needle` appears as a run of consecutive lines inside `haystack`. */
function containsRun(haystack: readonly string[], needle: readonly string[]): boolean {
  if (needle.length === 0) return false;
  for (let i = 0; i + needle.length <= haystack.length; i += 1) {
    if (needle.every((line, j) => haystack[i + j] === line)) return true;
  }
  return false;
}

/** Every string value of an art config, nested or not. */
function configStrings(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (typeof value === 'string') into.add(value);
  else if (Array.isArray(value)) for (const item of value) configStrings(item, into);
  else if (typeof value === 'object' && value !== null) for (const item of Object.values(value)) configStrings(item, into);
  return into;
}

const COLOUR_IN_LINE = /"(#[0-9a-fA-F]{6}|rgba?\([^"]*\))"/g;
const COLOUR_IN_STOP = /\.stop\([^,]+, (#[0-9a-fA-F]{6}|rgba?\(.*\))\)$/;

/** Colours a recorded drawing sets or uses in a gradient stop. */
function coloursOf(lines: readonly string[]): string[] {
  const found: string[] = [];
  for (const line of lines) {
    for (const match of line.matchAll(COLOUR_IN_LINE)) found.push(match[1]);
    const stop = COLOUR_IN_STOP.exec(line);
    if (stop) found.push(stop[1]);
  }
  return found;
}

const MARK_IDS = Object.keys(marks.TILES);
const FLOATING_IDS = Object.keys(marks.FLOATING_BLOCK_COLOURS);
const SIGNAL_IDS = Object.keys(SIGNAL_TILE_KINDS);

beforeEach(() => {
  loadTestConfigs();
  vi.mocked(paintColorGlyph).mockClear();
});

describe('Runeward marks dispatch', () => {
  it('paints every id of the module, leaves none pending and takes them off the shared drawing', () => {
    expect(marks.PENDING).toEqual([]);
    expect(MARK_IDS.length).toBe(10 + FLOATING_IDS.length + 2 + SIGNAL_IDS.length);
    for (const id of MARK_IDS) {
      expect(RUNEWARD_PAINTERS.tiles[id], id).toBe(marks.TILES[id]);
      expect(RUNEWARD_FALLBACK.has(id), id).toBe(false);
    }
  });

  it('knows every id as a tile of the game', () => {
    const known = new Set(Object.keys(ConfigRegistry.getTiles().tiles));
    expect(MARK_IDS.filter((id) => !known.has(id))).toEqual([]);
  });

  it.each(VARIANTS)('draws a distinct, non-empty log for every id in the $name drawing', ({ art }) => {
    const logs = MARK_IDS.map((id) => tileLog(id, art()).join('\n'));
    for (const [index, log] of logs.entries()) expect(log.length, MARK_IDS[index]).toBeGreaterThan(0);
    // The signal tiles differ from each other only by their symbol: still distinct.
    expect(new Set(logs).size).toBe(MARK_IDS.length);
  });

  it.each(VARIANTS)('leaves the animated pass to the moving tile only in the $name drawing', ({ art }) => {
    for (const id of MARK_IDS) {
      const lines = tileLog(id, art(), envOf(art()), 'animated');
      if (id === 'turtle') expect(lines.length, id).toBeGreaterThan(0);
      else expect(lines, id).toEqual([]);
    }
  });

  it.each(VARIANTS)('draws only colours of the art config in the $name drawing', ({ art }) => {
    const allowed = configStrings(art());
    for (const id of MARK_IDS) {
      for (const powered of [false, true]) {
        const used = coloursOf(tileLog(id, art(), envOf(art(), 0, false, powered)));
        expect(used.filter((colour) => !allowed.has(colour)), id).toEqual([]);
      }
    }
  });

  it.each(VARIANTS)('keeps the drawing stable for a cell and varied between cells in the $name drawing', ({ art }) => {
    for (const id of ['gravel', 'dirt', 'slime']) {
      expect(tileLog(id, art()), id).toEqual(tileLog(id, art()));
      expect(tileLog(id, art()), id).not.toEqual(tileLog(id, art(), envOf(art()), 'all', OTHER_CELL));
    }
  });
});

describe('Runeward gravel and dirt', () => {
  it.each(VARIANTS)('keeps both patches at 1.5:1 or more against the floor in the $name drawing', ({ art }) => {
    const config = art();
    for (const patch of [config.mark.gravel, config.mark.dirt]) {
      expect(contrast(patch.base, config.floor.base)).toBeGreaterThanOrEqual(PATCH_ON_FLOOR_MIN);
    }
  });

  it.each(VARIANTS)('lays the patch colour over the floor in the $name drawing', ({ art }) => {
    const config = art();
    const floor = tileLog(FLOOR_ID, config);
    for (const [id, patch] of [['gravel', config.mark.gravel], ['dirt', config.mark.dirt]] as const) {
      const log = tileLog(id, config);
      expect(log, id).toContain(`fillStyle = "${patch.base}"`);
      expect(log, id).not.toEqual(floor);
      expect(containsRun(log, body(floor)), id).toBe(true);
    }
  });

  it.each(VARIANTS)('tells gravel from dirt by colour and by drawing in the $name drawing', ({ art }) => {
    const config = art();
    expect(config.mark.gravel.base).not.toBe(config.mark.dirt.base);
    expect(tileLog('gravel', config)).not.toEqual(tileLog('dirt', config));
  });

  it.each(VARIANTS)('tells sand from dirt and from gravel by drawing in the $name drawing', ({ art }) => {
    const config = art();
    const sand = tileLog('sand', config);
    expect(sand).not.toEqual(tileLog('dirt', config));
    expect(sand).not.toEqual(tileLog('gravel', config));
    expect(containsRun(sand, body(tileLog(FLOOR_ID, config)))).toBe(true);
  });
});

describe('Runeward hint, recessed wall and block target', () => {
  it.each(VARIANTS)('draws the question mark of the hint as a shape, readable on the sheet, in the $name drawing', ({ art }) => {
    const config = art();
    const log = tileLog('hint', config);
    expect(log.some((line) => line.startsWith('fillText(') || line.startsWith('strokeText('))).toBe(false);
    expect(log.some((line) => line.startsWith('arc('))).toBe(true);
    expect(log).toContain(`strokeStyle = "${config.mark.hint.core}"`);
    expect(contrast(config.mark.hint.core, config.mark.hint.base)).toBeGreaterThanOrEqual(HINT_MARK_ON_SHEET_MIN);
  });

  it.each(VARIANTS)('keeps the recessed wall visible, unlike the hidden walls, in the $name drawing', ({ art }) => {
    const config = art();
    const floor = tileLog(FLOOR_ID, config);
    const recessed = tileLog('recessed_wall', config);
    expect(recessed).not.toEqual(floor);
    expect(recessed).toContain(`strokeStyle = "${config.mark.recessedWall.edge}"`);
    expect(tileLog('invisible_wall', config)).toEqual(floor);
    expect(tileLog('appearing_wall', config)).toEqual(floor);
  });

  it.each(VARIANTS)('inlays the block target in the glow colour in the $name drawing', ({ art }) => {
    const config = art();
    expect(tileLog('block_target', config)).toContain(`strokeStyle = "${config.mark.blockTarget.glow}"`);
  });
});

describe('Runeward turtle', () => {
  it.each(VARIANTS)('moves with the clock in the $name drawing', ({ art }) => {
    const config = art();
    expect(tileLog('turtle', config, envOf(config, FAR_TICK, false))).not.toEqual(tileLog('turtle', config, envOf(config, 0, false)));
  });

  it.each(VARIANTS)('freezes under reduced motion in the $name drawing', ({ art }) => {
    const config = art();
    const rest = tileLog('turtle', config, envOf(config, 0, true));
    expect(tileLog('turtle', config, envOf(config, FAR_TICK, true))).toEqual(rest);
    expect(rest).toEqual(tileLog('turtle', config, envOf(config, 0, false)));
    expect(tileLog('turtle', config, envOf(config, FAR_TICK, true), 'animated')).toEqual(
      tileLog('turtle', config, envOf(config, 0, true), 'animated')
    );
  });

  it.each(VARIANTS)('draws the cached terrain at the rest frame whatever the clock in the $name drawing', ({ art }) => {
    const config = art();
    expect(tileLog('turtle', config, envOf(config, FAR_TICK, false), 'static')).toEqual(
      tileLog('turtle', config, envOf(config, 0, false), 'static')
    );
  });

  it.each(VARIANTS)('repaints the whole water under the moving stone in the overlay in the $name drawing', ({ art }) => {
    const config = art();
    const overlay = tileLog('turtle', config, envOf(config, FAR_TICK, false), 'animated');
    const water = (() => {
      const { ctx, lines } = createRecordedContext();
      RUNEWARD_PAINTERS.tiles.water(ctx, 0, 0, TILE, 'all', CELL, envOf(config, FAR_TICK, false), false, false);
      return lines;
    })();
    expect(containsRun(overlay, body(water))).toBe(true);
  });
});

describe('Runeward thieves', () => {
  it.each(VARIANTS)('adds the key tag to the thief with keys in the $name drawing', ({ art }) => {
    const plain = tileLog('thief', art());
    const keys = tileLog('thief_keys', art());
    expect(keys.length).toBeGreaterThan(plain.length);
    expect(containsRun(keys, plain.slice(0, plain.length - 1))).toBe(true);
  });
});

describe('Runeward floating blocks', () => {
  it('knows the colour key the game gives each floating block', () => {
    for (const id of FLOATING_IDS) {
      expect(marks.FLOATING_BLOCK_COLOURS[id], id).toBe(ConfigRegistry.getTile(id).colorKey);
    }
    expect(FLOATING_IDS.length).toBe(4);
  });

  it.each(VARIANTS)('draws the glyph of its colour, in the glyph colour of the channel, in the $name drawing', ({ art }) => {
    const config = art();
    for (const id of FLOATING_IDS) {
      vi.mocked(paintColorGlyph).mockClear();
      tileLog(id, config);
      const calls = vi.mocked(paintColorGlyph).mock.calls;
      expect(calls.length, id).toBe(1);
      const colour = ConfigRegistry.getTile(id).colorKey as keyof RunewardArtConfig['keys'];
      expect(calls[0][1], id).toBe(colour);
      expect(calls[0][5], id).toBe(config.keys[colour].glyph);
      expect(contrast(config.keys[colour].glyph, config.keys[colour].main), id).toBeGreaterThanOrEqual(HINT_MARK_ON_SHEET_MIN);
    }
  });

  it.each(VARIANTS)('paints the slab in the main colour of the channel over water in the $name drawing', ({ art }) => {
    const config = art();
    const water = (() => {
      const { ctx, lines } = createRecordedContext();
      RUNEWARD_PAINTERS.tiles.water(ctx, 0, 0, TILE, 'all', CELL, envOf(config), false, false);
      return lines;
    })();
    for (const id of FLOATING_IDS) {
      const log = tileLog(id, config);
      const colour = marks.FLOATING_BLOCK_COLOURS[id];
      expect(containsRun(log, body(water)), id).toBe(true);
      expect(log.some((line) => line.includes(config.keys[colour].main)), id).toBe(true);
    }
  });
});

describe('Runeward signal tiles', () => {
  it.each(VARIANTS)('draws a different log for powered and unpowered in the $name drawing', ({ art }) => {
    const config = art();
    for (const id of SIGNAL_IDS) {
      expect(tileLog(id, config, envOf(config, 0, false, true)), id).not.toEqual(tileLog(id, config, envOf(config, 0, false, false)));
    }
  });

  it.each(VARIANTS)('keeps the lit colour at 3:1 or more against the idle one in the $name drawing', ({ art }) => {
    const { lit, idle, box } = art().signal;
    expect(contrast(lit, idle)).toBeGreaterThanOrEqual(LIT_ON_IDLE_MIN);
    expect(contrast(idle, box)).toBeGreaterThan(1);
    expect(contrast(lit, box)).toBeGreaterThanOrEqual(LIT_ON_IDLE_MIN);
  });

  it.each(VARIANTS)('draws the Runeward floor, then the shared symbol unchanged, in the $name drawing', ({ art }) => {
    const config = art();
    const floor = (() => {
      const { ctx, lines } = createRecordedContext();
      RUNEWARD_PAINTERS.tiles[FLOOR_ID](ctx, 0, 0, TILE, 'all', CELL, envOf(config), false, false);
      return lines;
    })();
    for (const id of SIGNAL_IDS) {
      for (const powered of [false, true]) {
        const log = tileLog(id, config, envOf(config, 0, false, powered));
        const { ctx, lines: symbol } = createRecordedContext();
        const { box, idle, lit } = config.signal;
        paintSignalTile(ctx, 0, 0, TILE, SIGNAL_TILE_KINDS[id], powered, { box, idle, lit }, SIGNAL_STYLE);
        expect(containsRun(log, body(floor)), id).toBe(true);
        expect(containsRun(log, symbol), `${id} powered=${powered}`).toBe(true);
      }
    }
  });

  it('gives every signal kind of the game a Runeward painter', () => {
    // The eight original signal tiles, the NAND gate, the data latch, ten counters and the wire floor.
    expect(SIGNAL_IDS.length).toBe(21);
    for (const id of SIGNAL_IDS) expect(RUNEWARD_PAINTERS.tiles[id], id).toBeDefined();
  });
});
