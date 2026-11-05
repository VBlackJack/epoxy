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
 * Colour-blind glyphs of the Runeward mechanism painters: every door, hold door, toggle wall, toggle button,
 * pressure plate, coloured button and key must draw the glyph of its own colour key, in the plain and in the
 * parchment drawing, and the key it passes must be the colour key the game gives the tile.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigRegistry } from '../../../config/ConfigRegistry';
import type { RunewardArtConfig, TileDefinition } from '../../../core/types';
import { loadTestConfigs } from '../../../test/loadTestConfigs';
import { createRecordedContext } from '../../../test/runewardTestContext';
import { BUTTON_GLYPH_KEYS } from '../../paletteKeys';
import { NEIGHBOUR, type TileNeighbours } from '../../tileNeighbours';
import { RUNEWARD_PAINTERS, type RunewardPaintEnv } from './runewardTiles';

vi.mock('../../colorGlyph', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../colorGlyph')>();
  return { ...actual, paintColorGlyph: vi.fn(actual.paintColorGlyph) };
});

import { paintColorGlyph } from '../../colorGlyph';

const TILE = 48;
const SMALL_TILE = 12;
const CELL: Readonly<TileNeighbours> = { wallMask: 0, shadowMask: NEIGHBOUR.N, hash: 123456789, cx: 5, cy: 4 };
const CHANNELS = ['red', 'blue', 'yellow', 'green'] as const;
const TOGGLE_CHANNELS = ['red', 'blue', 'yellow'] as const;
const PLAIN_TOGGLE_KEY = 'green';
/** The trap button holds a trap shut and carries a jaw, not a colour glyph. */
const JAW_BUTTON = 'button_brown';
/** Buttons that stay on the shared drawing: no Runeward painter, no glyph from it. */
const SHARED_BUTTONS: readonly string[] = ['button_orange', 'button_gray'];
const TOGGLE_ACTION_PREFIX = 'toggle_walls_';

interface Variant {
  readonly name: string;
  readonly art: () => RunewardArtConfig;
}

const VARIANTS: readonly Variant[] = [
  { name: 'plain', art: () => ConfigRegistry.getGame().runewardArt as RunewardArtConfig },
  { name: 'parchment', art: () => ConfigRegistry.getGame().runewardArtVariants?.parchment as RunewardArtConfig }
];

type GlyphModule = typeof import('../../colorGlyph');
let realGlyph: GlyphModule['paintColorGlyph'];

beforeAll(async () => {
  realGlyph = (await vi.importActual<GlyphModule>('../../colorGlyph')).paintColorGlyph;
});

beforeEach(() => {
  loadTestConfigs();
  vi.mocked(paintColorGlyph).mockClear();
});

function envOf(art: RunewardArtConfig): RunewardPaintEnv {
  return { timeTick: 0, reducedMotion: false, cache: new Map(), art };
}

/** The colour key the game gives a mechanism tile, whether through colorKey, its channel or its button action. */
function expectedKey(id: string): string | null {
  const def: TileDefinition = ConfigRegistry.getTile(id);
  if (def.colorKey) return def.colorKey;
  if (def.toggleChannel) return def.toggleChannel;
  if (def.buttonAction?.startsWith(TOGGLE_ACTION_PREFIX)) return def.buttonAction.slice(TOGGLE_ACTION_PREFIX.length);
  if (def.buttonAction === 'toggle_walls' || def.togglesTo) return PLAIN_TOGGLE_KEY;
  return BUTTON_GLYPH_KEYS[id] ?? null;
}

/** Ids of the glyph-carrying tile painters. */
function glyphTileIds(): string[] {
  const ids: string[] = [];
  for (const c of CHANNELS) ids.push(`door_${c}`, `hold_door_${c}_closed`, `hold_door_${c}_open`, `pressure_plate_${c}`);
  ids.push('toggle_wall_closed', 'toggle_wall_open', 'button_red', 'button_blue', 'button_green');
  for (const c of TOGGLE_CHANNELS) ids.push(`toggle_wall_${c}_closed`, `toggle_wall_${c}_open`, `toggle_button_${c}`);
  return ids;
}

function keyItemIds(): string[] {
  return CHANNELS.map((c) => `key_${c}`);
}

/** True when `needle` appears as a run of consecutive lines inside `haystack`. */
function containsRun(haystack: readonly string[], needle: readonly string[]): boolean {
  if (needle.length === 0) return false;
  for (let i = 0; i + needle.length <= haystack.length; i += 1) {
    if (needle.every((line, j) => haystack[i + j] === line)) return true;
  }
  return false;
}

/** Lines the glyph painter records for one call it was given. */
function glyphLines(call: readonly unknown[]): string[] {
  const [, key, cx, cy, r, fill] = call as [unknown, string, number, number, number, string];
  const { ctx, lines } = createRecordedContext();
  realGlyph(ctx, key, cx, cy, r, fill);
  return lines;
}

/** Draws a painter and returns its log with the glyph calls it made. */
function drawTile(id: string, art: RunewardArtConfig, size: number): { lines: string[]; glyphs: unknown[][] } {
  vi.mocked(paintColorGlyph).mockClear();
  const { ctx, lines } = createRecordedContext();
  RUNEWARD_PAINTERS.tiles[id](ctx, 0, 0, size, 'all', CELL, envOf(art), false, false);
  return { lines, glyphs: vi.mocked(paintColorGlyph).mock.calls.map((call) => [...call]) };
}

function drawItem(id: string, art: RunewardArtConfig, size: number): { lines: string[]; glyphs: unknown[][] } {
  vi.mocked(paintColorGlyph).mockClear();
  const { ctx, lines } = createRecordedContext();
  RUNEWARD_PAINTERS.items[id](ctx, 0, 0, size, envOf(art));
  return { lines, glyphs: vi.mocked(paintColorGlyph).mock.calls.map((call) => [...call]) };
}

describe('Runeward mechanism glyphs', () => {
  it('knows the colour key of every glyph-carrying tile', () => {
    for (const id of [...glyphTileIds(), ...keyItemIds()]) {
      expect(expectedKey(id), id).not.toBeNull();
    }
  });

  it.each(VARIANTS)('draws the glyph of its colour key on every tile in the $name drawing', ({ art }) => {
    for (const size of [TILE, SMALL_TILE]) {
      for (const id of glyphTileIds()) {
        const { lines, glyphs } = drawTile(id, art(), size);
        expect(glyphs.length, id).toBeGreaterThan(0);
        for (const call of glyphs) {
          expect(call[1], id).toBe(expectedKey(id));
          expect(containsRun(lines, glyphLines(call)), id).toBe(true);
        }
      }
    }
  });

  it.each(VARIANTS)('draws the glyph of its colour key on every key item in the $name drawing', ({ art }) => {
    for (const id of keyItemIds()) {
      const { lines, glyphs } = drawItem(id, art(), TILE);
      expect(glyphs.length, id).toBe(1);
      expect(glyphs[0][1], id).toBe(ConfigRegistry.getTile(id).colorKey);
      expect(containsRun(lines, glyphLines(glyphs[0])), id).toBe(true);
    }
  });

  it('passes the colour key the game gives each tile that has one', () => {
    for (const id of glyphTileIds()) {
      const colorKey = ConfigRegistry.getTile(id).colorKey;
      if (!colorKey) continue;
      for (const { art } of VARIANTS) {
        expect(drawTile(id, art(), TILE).glyphs.map((call) => call[1]), id).toEqual([colorKey]);
      }
    }
  });

  it('paints the glyph in the glyph colour of its channel', () => {
    for (const { art } of VARIANTS) {
      const config = art();
      for (const id of [...glyphTileIds()]) {
        const key = expectedKey(id) as keyof RunewardArtConfig['keys'];
        for (const call of drawTile(id, config, TILE).glyphs) {
          const fill = call[5];
          const tint = config.keys[key];
          expect([tint.glyph, tint.main], id).toContain(fill);
        }
      }
    }
  });

  it('gives the trap button a jaw and no colour glyph', () => {
    for (const { art } of VARIANTS) {
      const { lines, glyphs } = drawTile(JAW_BUTTON, art(), TILE);
      expect(glyphs).toEqual([]);
      expect(lines.filter((line) => line.startsWith('lineTo(')).length).toBeGreaterThanOrEqual(4);
    }
  });

  it('leaves the orange and grey buttons to the shared drawing', () => {
    for (const id of SHARED_BUTTONS) expect(RUNEWARD_PAINTERS.tiles[id]).toBeUndefined();
  });

  it('draws a two-way notch on toggle buttons only', () => {
    for (const { art } of VARIANTS) {
      const toggle = drawTile('toggle_button_red', art(), TILE).lines;
      const plain = drawTile('button_red', art(), TILE).lines;
      expect(toggle.filter((line) => line.startsWith('closePath(')).length).toBeGreaterThan(
        plain.filter((line) => line.startsWith('closePath(')).length
      );
    }
  });
});
