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
 * The Runeward item painters (boots, slow time, bomb, score tokens, stopwatches, forbidden markers): every item is
 * told apart from the others, the boots charms differ, the forbidden keys keep their channel glyph, reduced motion
 * freezes the hover, colours stay legible, and the dispatch tables are consistent. When a contrast pair fails, the
 * colours in game.json change, never the thresholds below.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigRegistry } from '../../../config/ConfigRegistry';
import type { RunewardArtConfig, RunewardBootsKind, RunewardKeyColour } from '../../../core/types';
import { loadTestConfigs } from '../../../test/loadTestConfigs';
import { createRecordedContext } from '../../../test/runewardTestContext';
import { paintColorGlyph } from '../../colorGlyph';
import { NEIGHBOUR, type TileNeighbours } from '../../tileNeighbours';
import { ITEMS, PENDING, TILES, paintBootsItem } from './runewardItems';
import { RUNEWARD_FALLBACK, RUNEWARD_PAINTERS, runewardClockMs, type RunewardPaintEnv } from './runewardTiles';

vi.mock('../../colorGlyph', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../colorGlyph')>();
  return { ...actual, paintColorGlyph: vi.fn(actual.paintColorGlyph) };
});

const BOOTS: readonly RunewardBootsKind[] = ['water', 'fire', 'ice', 'force', 'speed', 'eye'];
const KEY_CHANNELS: readonly RunewardKeyColour[] = ['red', 'blue', 'yellow', 'green'];
const FORBID_BOOTS: readonly RunewardBootsKind[] = ['ice', 'water', 'fire', 'force'];
const TILE = 48;
const SMALL_TILE = 8;
const FAR_TICK = 937;
const MAIN_ON_FLOOR_MIN = 3;
const CELL: Readonly<TileNeighbours> = { wallMask: 0, shadowMask: NEIGHBOUR.N, hash: 424242, cx: 3, cy: 7 };

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

function plainArt(): RunewardArtConfig {
  return ConfigRegistry.getGame().runewardArt as RunewardArtConfig;
}

function parchmentArt(): RunewardArtConfig {
  return ConfigRegistry.getGame().runewardArtVariants?.parchment as RunewardArtConfig;
}

const ARTS: readonly (readonly [string, () => RunewardArtConfig])[] = [
  ['plain', plainArt],
  ['parchment', parchmentArt]
];

function envOf(art: RunewardArtConfig, timeTick: number, reducedMotion: boolean): RunewardPaintEnv {
  return { timeTick, signalPowered: false, reducedMotion, cache: new Map(), art };
}

function itemLog(id: string, art: RunewardArtConfig, timeTick = 0, reducedMotion = false, size = TILE): string[] {
  const { ctx, lines } = createRecordedContext();
  ITEMS[id](ctx, 0, 0, size, envOf(art, timeTick, reducedMotion));
  return lines;
}

function tileLog(id: string, art: RunewardArtConfig, pass: 'all' | 'static' | 'animated' = 'all', size = TILE): string[] {
  const { ctx, lines } = createRecordedContext();
  TILES[id](ctx, 0, 0, size, pass, CELL, envOf(art, 0, false), false, false);
  return lines;
}

/** The main fill of each item, the colour the contrast against the floor is read from. */
function mainFills(art: RunewardArtConfig): Record<string, string> {
  const { boots, bomb, score, stopwatch, slowTime } = art.item;
  return {
    ...Object.fromEntries(BOOTS.map((kind) => [`boots_${kind}`, boots[kind].main])),
    slow_time: slowTime.base,
    bomb: bomb.base,
    score_10: score.base,
    score_100: score.base,
    score_1000: score.base,
    score_2x: score.base,
    stopwatch_bonus: stopwatch.face,
    stopwatch_penalty: stopwatch.face
  };
}

const ITEM_IDS = Object.keys(ITEMS);
const TILE_IDS = Object.keys(TILES);

describe('Runeward item dispatch', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('paints every boots, slow-time, bomb, score and stopwatch item', () => {
    const expected = [
      ...BOOTS.map((kind) => `boots_${kind}`),
      'slow_time', 'bomb', 'score_10', 'score_100', 'score_1000', 'score_2x', 'stopwatch_bonus', 'stopwatch_penalty'
    ];
    expect(ITEM_IDS.sort()).toEqual(expected.sort());
  });

  it('registers every item in the dispatch and none stays on the shared drawing', () => {
    for (const id of ITEM_IDS) {
      expect(RUNEWARD_PAINTERS.items[id], id).toBeTypeOf('function');
      expect(RUNEWARD_FALLBACK.has(id), id).toBe(false);
      expect(PENDING.includes(id), id).toBe(false);
    }
  });

  it('knows every painted id as an item or a terrain tile of the game', () => {
    const tiles = ConfigRegistry.getTiles().tiles;
    for (const id of ITEM_IDS) expect(tiles[id]?.layer, id).toBe('item');
    for (const id of TILE_IDS) expect(tiles[id]?.layer, id).toBe('terrain');
  });

  it('keeps the forbidden markers pending until the tile dispatch registers them', () => {
    expect([...PENDING].sort()).toEqual([...TILE_IDS].sort());
    for (const id of TILE_IDS) expect(TILES[id], id).toBeTypeOf('function');
  });
});

describe('Runeward item drawings', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it.each(ARTS)('gives no two items the same drawing in the %s drawing', (_name, art) => {
    const logs = ITEM_IDS.map((id) => itemLog(id, art()).join('\n'));
    expect(new Set(logs).size).toBe(ITEM_IDS.length);
  });

  it.each(ARTS)('gives no two forbidden markers the same drawing in the %s drawing', (_name, art) => {
    const logs = TILE_IDS.map((id) => tileLog(id, art()).join('\n'));
    expect(new Set(logs).size).toBe(TILE_IDS.length);
  });

  it.each(ARTS)('draws a different charm on each pair of boots in the %s drawing, whatever the colours', (_name, art) => {
    const config = art();
    const same = BOOTS.map((kind) => config.item.boots[kind])[0];
    const levelled: RunewardArtConfig = {
      ...config,
      item: { ...config.item, boots: Object.fromEntries(BOOTS.map((kind) => [kind, same])) as RunewardArtConfig['item']['boots'] }
    };
    const logs = BOOTS.map((kind) => {
      const { ctx, lines } = createRecordedContext();
      paintBootsItem(ctx, TILE, levelled, kind, 0);
      return lines.join('\n');
    });
    expect(new Set(logs).size).toBe(BOOTS.length);
  });

  it('draws an ink outline on every parchment item and forbidden marker, and none in the plain drawing', () => {
    const outline = `strokeStyle = ${JSON.stringify(parchmentArt().ink!.line)}`;
    for (const id of ITEM_IDS) {
      expect(itemLog(id, parchmentArt()), id).toContain(outline);
      expect(itemLog(id, plainArt()), id).not.toContain(outline);
    }
    for (const id of TILE_IDS) {
      expect(tileLog(id, parchmentArt()), id).toContain(outline);
      expect(tileLog(id, plainArt()), id).not.toContain(outline);
    }
  });

  it('draws the plus of the bonus watch with one more shape than the minus of the penalty watch', () => {
    const rects = (id: string): number => itemLog(id, plainArt()).filter((line) => line.startsWith('fillRect(')).length;
    expect(rects('stopwatch_bonus')).toBe(rects('stopwatch_penalty') + 1);
  });

  it('gives the score tokens one, two and three pips, and the double token two coins', () => {
    const coins = (id: string): number => itemLog(id, plainArt()).filter((line) => line.startsWith('arc(')).length;
    const base = coins('score_10');
    expect(coins('score_100')).toBe(base + 1);
    expect(coins('score_1000')).toBe(base + 2);
    expect(coins('score_2x')).toBeGreaterThan(base);
  });

  it('draws on small tiles without throwing', () => {
    for (const [, art] of ARTS) {
      for (const id of ITEM_IDS) expect(() => itemLog(id, art(), 0, false, SMALL_TILE), id).not.toThrow();
      for (const id of TILE_IDS) expect(() => tileLog(id, art(), 'all', SMALL_TILE), id).not.toThrow();
    }
  });
});

describe('Runeward forbidden markers', () => {
  beforeEach(() => {
    loadTestConfigs();
    vi.mocked(paintColorGlyph).mockClear();
  });

  it.each(ARTS)('keeps the channel glyph and colour of each forbidden key in the %s drawing', (_name, art) => {
    const config = art();
    for (const colour of KEY_CHANNELS) {
      vi.mocked(paintColorGlyph).mockClear();
      const log = tileLog(`forbid_key_${colour}`, config);
      const glyphColours = vi.mocked(paintColorGlyph).mock.calls.map((call) => call[1]);
      expect(glyphColours, colour).toEqual([colour]);
      expect(vi.mocked(paintColorGlyph).mock.calls[0][5], colour).toBe(config.keys[colour].glyph);
      if (!config.ink) expect(log, colour).toContain(`fillStyle = ${JSON.stringify(config.keys[colour].main)}`);
    }
  });

  it.each(ARTS)('bars every forbidden marker with the forbid ring and slash colours in the %s drawing', (_name, art) => {
    const config = art();
    for (const id of TILE_IDS) {
      const log = tileLog(id, config);
      expect(log, id).toContain(`strokeStyle = ${JSON.stringify(config.item.forbid.ring)}`);
      expect(log, id).toContain(`strokeStyle = ${JSON.stringify(config.item.forbid.slash)}`);
    }
  });

  it('draws the boots a forbidden boots marker is named after', () => {
    for (const kind of FORBID_BOOTS) {
      const log = tileLog(`forbid_boots_${kind}`, plainArt());
      expect(log, kind).toContain(`fillStyle = ${JSON.stringify(plainArt().item.boots[kind].light)}`);
    }
  });

  it('draws nothing in the animated pass, as the markers are motionless terrain', () => {
    for (const id of TILE_IDS) expect(tileLog(id, plainArt(), 'animated'), id).toEqual([]);
  });
});

describe('Runeward item animation', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it.each(ARTS)('freezes every item under reduced motion in the %s drawing', (_name, art) => {
    for (const id of ITEM_IDS) {
      expect(itemLog(id, art(), FAR_TICK, true), id).toEqual(itemLog(id, art(), 0, true));
    }
  });

  it.each(ARTS)('hovers on the Runeward clock of the dispatch module in the %s drawing', (_name, art) => {
    const env = envOf(art(), FAR_TICK, false);
    const { ctx, lines } = createRecordedContext();
    ctx.translate(0, 0);
    paintBootsItem(ctx, TILE, art(), 'water', runewardClockMs(env));
    const hoverCall = lines.find((line) => line.startsWith('translate(0, ') && line !== 'translate(0, 0)');
    expect(hoverCall).toBeDefined();
    expect(itemLog('boots_water', art(), FAR_TICK, false)).toContain(hoverCall);
  });

  it.each(ARTS)('moves every item with the clock when motion is allowed in the %s drawing', (_name, art) => {
    for (const id of ITEM_IDS) {
      expect(itemLog(id, art(), FAR_TICK, false), id).not.toEqual(itemLog(id, art(), 0, false));
    }
  });
});

describe('Runeward item colours', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('keeps the main fill of every item at 3:1 or more against the plain floor', () => {
    const art = plainArt();
    const failing = Object.entries(mainFills(art)).filter(([, fill]) => contrast(fill, art.floor.base) < MAIN_ON_FLOOR_MIN);
    expect(failing).toEqual([]);
  });

  it('gives every item a main fill in the parchment drawing', () => {
    const fills = mainFills(parchmentArt());
    expect(Object.keys(fills).sort()).toEqual([...ITEM_IDS].sort());
    for (const fill of Object.values(fills)) expect(fill).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
