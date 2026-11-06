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
 * The Runeward mechanism painters (doors, hold doors, toggle slabs, plates, buttons, keys, chip): legibility of
 * their colours read from game.json, the ink outline of the parchment drawing, the frozen clock under reduced
 * motion, and the dispatch tables. When a contrast pair fails, the colours in game.json change, never the
 * thresholds below.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { ConfigRegistry } from '../../../config/ConfigRegistry';
import type { RunewardArtConfig } from '../../../core/types';
import { loadTestConfigs } from '../../../test/loadTestConfigs';
import { createRecordedContext } from '../../../test/runewardTestContext';
import { NEIGHBOUR, type TileNeighbours } from '../../tileNeighbours';
import { paintButton, paintChipItem, paintGate, paintKeyItem, paintLock, paintPressurePlate, paintToggleSlab } from './runewardMechanisms';
import { RUNEWARD_FALLBACK, RUNEWARD_PAINTERS, type RunewardPaintEnv } from './runewardTiles';

const CHANNELS = ['red', 'blue', 'yellow', 'green'] as const;
const TOGGLE_CHANNELS = ['red', 'blue', 'yellow'] as const;
const PLAIN_MAIN_ON_FLOOR_MIN = 3;
const PARCHMENT_MAIN_ON_FLOOR_MIN = 1.5;
const GLYPH_ON_MAIN_MIN = 4.5;
const TILE = 48;
const FAR_TICK = 937;
/** Width of a portcullis bar, in tiles, and the tolerance when it is read back from a recorded call. */
const GATE_BAR_WIDTH = 0.08;
const BAR_WIDTH_TOLERANCE = 0.001;
const DASH_CALL = 'setLineDash(';
const SOLID_DASH_CALL = 'setLineDash()';
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

function envOf(art: RunewardArtConfig, timeTick: number, reducedMotion: boolean): RunewardPaintEnv {
  return { timeTick, signalPowered: false, reducedMotion, cache: new Map(), art };
}

function itemLog(id: string, art: RunewardArtConfig, timeTick: number, reducedMotion: boolean): string[] {
  const { ctx, lines } = createRecordedContext();
  RUNEWARD_PAINTERS.items[id](ctx, 0, 0, TILE, envOf(art, timeTick, reducedMotion));
  return lines;
}

function tileLog(id: string, art: RunewardArtConfig): string[] {
  const { ctx, lines } = createRecordedContext();
  RUNEWARD_PAINTERS.tiles[id](ctx, 0, 0, TILE, 'all', CELL, envOf(art, 0, false), false, false);
  return lines;
}

/** Every mechanism tile id the Runeward styles now paint. */
function mechanismTileIds(): string[] {
  const ids = ['toggle_wall_closed', 'toggle_wall_open', 'button_red', 'button_blue', 'button_green', 'button_brown'];
  for (const c of CHANNELS) ids.push(`door_${c}`, `pressure_plate_${c}`, `hold_door_${c}_closed`, `hold_door_${c}_open`);
  for (const c of TOGGLE_CHANNELS) ids.push(`toggle_wall_${c}_closed`, `toggle_wall_${c}_open`, `toggle_button_${c}`);
  return ids;
}

function mechanismItemIds(): string[] {
  return [...CHANNELS.map((c) => `key_${c}`), 'chip'];
}

describe('Runeward mechanism colours', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('keeps each plain colour at 3:1 or more against the floor', () => {
    const art = plainArt();
    const failing = CHANNELS.filter((c) => contrast(art.keys[c].main, art.floor.base) < PLAIN_MAIN_ON_FLOOR_MIN);
    expect(failing).toEqual([]);
  });

  it('keeps each parchment pigment at 1.5:1 or more against the paper', () => {
    const art = parchmentArt();
    const failing = CHANNELS.filter((c) => contrast(art.keys[c].main, art.floor.base) < PARCHMENT_MAIN_ON_FLOOR_MIN);
    expect(failing).toEqual([]);
  });

  it.each([
    ['plain', plainArt],
    ['parchment', parchmentArt]
  ])('keeps the glyph at 4.5:1 or more against its colour in the %s drawing', (_name, art) => {
    const config = art();
    const failing = CHANNELS.filter((c) => contrast(config.keys[c].glyph, config.keys[c].main) < GLYPH_ON_MAIN_MIN);
    expect(failing).toEqual([]);
  });
});

describe('Runeward mechanism drawings', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('draws an ink outline on every parchment tile and item, and none in the plain drawing', () => {
    const ink = parchmentArt().ink!.line;
    const outline = `strokeStyle = ${JSON.stringify(ink)}`;
    for (const id of mechanismTileIds()) {
      expect(tileLog(id, parchmentArt()), id).toContain(outline);
      expect(tileLog(id, plainArt()), id).not.toContain(outline);
    }
    for (const id of mechanismItemIds()) {
      expect(itemLog(id, parchmentArt(), 0, false), id).toContain(outline);
      expect(itemLog(id, plainArt(), 0, false), id).not.toContain(outline);
    }
  });

  it('draws the keyhole of a door in the door keyhole colour', () => {
    for (const art of [plainArt(), parchmentArt()]) {
      expect(tileLog('door_red', art)).toContain(`fillStyle = ${JSON.stringify(art.door.keyhole)}`);
    }
  });

  it('raises the bars of an open hold door and lowers them when it is closed', () => {
    const barWidth = TILE * GATE_BAR_WIDTH;
    const barHeights = (id: string): number[] =>
      tileLog(id, plainArt())
        .filter((line) => line.startsWith('fillRect('))
        .map((line) => line.slice('fillRect('.length, -1).split(',').map(Number))
        .filter(([, , width]) => Math.abs(width - barWidth) < BAR_WIDTH_TOLERANCE)
        .map(([, , , height]) => height);
    expect(barHeights('hold_door_red_open').length).toBeGreaterThan(0);
    expect(Math.max(...barHeights('hold_door_red_closed'))).toBeGreaterThan(Math.max(...barHeights('hold_door_red_open')));
    expect(tileLog('hold_door_red_closed', plainArt())).not.toEqual(tileLog('hold_door_red_open', plainArt()));
  });

  it('dashes the outline of an open toggle wall and restores a solid line', () => {
    for (const id of ['toggle_wall_open', 'toggle_wall_red_open']) {
      const lines = tileLog(id, plainArt());
      const dashed = lines.findIndex((line) => line.startsWith(DASH_CALL) && line !== SOLID_DASH_CALL);
      expect(dashed, id).toBeGreaterThanOrEqual(0);
      expect(lines.lastIndexOf(SOLID_DASH_CALL), id).toBeGreaterThan(dashed);
      expect(tileLog(id.replace('_open', '_closed'), plainArt()), id).not.toContain(lines[dashed]);
    }
  });

  it('draws a pressed plate differently from a free one', () => {
    for (const art of [plainArt(), parchmentArt()]) {
      const draw = (pressed: boolean): string[] => {
        const { ctx, lines } = createRecordedContext();
        paintPressurePlate(ctx, TILE, art, 'red', CELL, pressed);
        return lines;
      };
      expect(draw(true)).not.toEqual(draw(false));
    }
  });

  it('draws on small tiles without throwing', () => {
    for (const art of [plainArt(), parchmentArt()]) {
      const { ctx } = createRecordedContext();
      expect(() => {
        paintLock(ctx, 8, art, 'red', CELL);
        paintGate(ctx, 8, art, 'blue', false, CELL);
        paintToggleSlab(ctx, 8, art, 'yellow', false, CELL);
        paintButton(ctx, 8, art, { kind: 'toggle', colour: 'green' }, CELL);
        paintKeyItem(ctx, 8, art, 'green', 0);
        paintChipItem(ctx, 8, art, 0);
      }).not.toThrow();
    }
  });
});

describe('Runeward mechanism animation', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it.each([
    ['plain', plainArt],
    ['parchment', parchmentArt]
  ])('freezes the key bob and the chip pulse under reduced motion in the %s drawing', (_name, art) => {
    for (const id of mechanismItemIds()) {
      const rest = itemLog(id, art(), 0, true);
      expect(itemLog(id, art(), FAR_TICK, true), id).toEqual(rest);
    }
  });

  it.each([
    ['plain', plainArt],
    ['parchment', parchmentArt]
  ])('moves the key and the chip with the clock when motion is allowed in the %s drawing', (_name, art) => {
    for (const id of mechanismItemIds()) {
      expect(itemLog(id, art(), FAR_TICK, false), id).not.toEqual(itemLog(id, art(), 0, false));
    }
  });

  it('draws every mechanism tile motionless: the animated pass draws nothing', () => {
    for (const id of mechanismTileIds()) {
      const { ctx, lines } = createRecordedContext();
      RUNEWARD_PAINTERS.tiles[id](ctx, 0, 0, TILE, 'animated', CELL, envOf(plainArt(), FAR_TICK, false), false, false);
      expect(lines, id).toEqual([]);
      expect(RUNEWARD_PAINTERS.animatedTiles.has(id), id).toBe(false);
    }
  });
});

describe('Runeward mechanism dispatch', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('registers every mechanism tile and item, and none stays on the shared drawing', () => {
    for (const id of mechanismTileIds()) {
      expect(RUNEWARD_PAINTERS.tiles[id], id).toBeTypeOf('function');
      expect(RUNEWARD_FALLBACK.has(id), id).toBe(false);
    }
    for (const id of mechanismItemIds()) {
      expect(RUNEWARD_PAINTERS.items[id], id).toBeTypeOf('function');
      expect(RUNEWARD_FALLBACK.has(id), id).toBe(false);
    }
  });

  it('draws the orange and grey buttons with their own Runeward painters', () => {
    for (const id of ['button_orange', 'button_gray']) {
      expect(RUNEWARD_FALLBACK.has(id), id).toBe(false);
      expect(RUNEWARD_PAINTERS.tiles[id], id).toBeTypeOf('function');
    }
  });
});
