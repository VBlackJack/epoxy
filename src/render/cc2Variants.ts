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
 * The Chip's Challenge 2 look-alikes of the game, drawn as the Epoxy tile they resemble plus a mark (see cc2Marks.ts), in
 * every render style: which tile each is drawn on, which mark it wears, and the colours of the mark in the palette of a
 * vector style and in the art of the Runeward style. Pure module: no DOM.
 */

import type { RunewardArtConfig } from '../core/types';
import { MELINDA_BOW_COLOURS, MarkColours, paintBoltBadge, paintBribeBadge, paintFoilBadge, paintPauseBadge, paintRivets, paintSignPlate, paintToggleBadge, paintTreadBadge } from './cc2Marks';

/** The marks a look-alike can wear. */
export type Cc2Mark = 'toggle' | 'tread' | 'rivets' | 'sign_chip' | 'sign_melinda' | 'foil' | 'pause' | 'bribe' | 'bolt';

/** The tile a look-alike is drawn on, and the mark drawn over it. */
export interface Cc2Variant {
  readonly base: string;
  readonly mark: Cc2Mark;
}

/** Items drawn as another item with a mark. */
export const CC2_ITEM_VARIANTS: Readonly<Record<string, Cc2Variant>> = {
  green_chip: { base: 'chip', mark: 'toggle' },
  green_bomb: { base: 'bomb', mark: 'toggle' },
  hiking_boots: { base: 'boots_force', mark: 'tread' },
  steel_foil: { base: 'boots_ice', mark: 'foil' },
  toggle_clock: { base: 'stopwatch_bonus', mark: 'pause' },
  bribe: { base: 'toll_token', mark: 'bribe' },
  lightning_bolt: { base: 'boots_speed', mark: 'bolt' }
};

/** Terrain drawn as another terrain with a mark. */
export const CC2_TERRAIN_VARIANTS: Readonly<Record<string, Cc2Variant>> = {
  steel_wall: { base: 'wall', mark: 'rivets' },
  sign_chip_only: { base: 'floor', mark: 'sign_chip' },
  sign_melinda_only: { base: 'floor', mark: 'sign_melinda' }
};

/** The letter set on the plate of each gender sign: the initial of the character who may step there. */
const SIGN_LETTERS: Readonly<Record<'sign_chip' | 'sign_melinda', string>> = { sign_chip: 'C', sign_melinda: 'M' };

/** The palette entries a vector style hands in (the same keys as the palette of game.json). */
export interface MarkPalette {
  readonly green: string;
  readonly brown: string;
  readonly gray: string;
  readonly blue: string;
  readonly glyphInk: string;
  readonly hintGlyph: string;
  readonly wallShadow: string;
}

/** The colours of a mark in a vector style. */
export function paletteMarkColours(pal: MarkPalette, mark: Cc2Mark): MarkColours {
  switch (mark) {
    case 'toggle':
      return { fill: pal.green, edge: pal.glyphInk, ink: pal.hintGlyph };
    case 'tread':
      return { fill: pal.brown, edge: pal.glyphInk, ink: pal.hintGlyph };
    case 'bolt':
      return { fill: pal.blue, edge: pal.glyphInk, ink: pal.hintGlyph };
    case 'rivets':
      return { fill: pal.gray, edge: pal.wallShadow, ink: pal.hintGlyph };
    case 'sign_chip':
      return { fill: pal.blue, edge: pal.glyphInk, ink: pal.hintGlyph };
    case 'sign_melinda':
      return { fill: MELINDA_BOW_COLOURS.fill, edge: pal.glyphInk, ink: pal.hintGlyph };
    case 'foil':
      return { fill: pal.gray, edge: pal.wallShadow, ink: pal.hintGlyph };
    case 'pause':
      return { fill: pal.blue, edge: pal.glyphInk, ink: pal.hintGlyph };
    case 'bribe':
      return { fill: pal.green, edge: pal.glyphInk, ink: pal.hintGlyph };
  }
}

/** The colours of a mark in the Runeward style, taken from its art: the key colours, the wall and the ink. */
export function runewardMarkColours(art: Readonly<RunewardArtConfig>, mark: Cc2Mark): MarkColours {
  const edge = art.ink ? art.ink.line : art.shadow.color;
  switch (mark) {
    case 'toggle':
      return { fill: art.keys.green.main, edge, ink: art.keys.green.glyph };
    case 'tread':
      return { fill: art.keys.yellow.main, edge, ink: art.keys.yellow.glyph };
    case 'bolt':
      return { fill: art.keys.blue.main, edge, ink: art.keys.blue.glyph };
    case 'rivets':
      return { fill: art.wall.topLight, edge: art.wall.edge, ink: art.wall.topLight };
    case 'sign_chip':
      return { fill: art.keys.blue.main, edge, ink: art.keys.blue.glyph };
    case 'sign_melinda':
      return { fill: art.keys.red.main, edge, ink: art.keys.red.glyph };
    case 'foil':
      return { fill: art.wall.topLight, edge: art.wall.edge, ink: art.wall.edge };
    case 'pause':
      return { fill: art.keys.blue.main, edge, ink: art.keys.blue.glyph };
    case 'bribe':
      return { fill: art.keys.green.main, edge, ink: art.keys.green.glyph };
  }
}

/** Draws a mark over the tile at (x, y). */
export function paintCc2Mark(ctx: CanvasRenderingContext2D, mark: Cc2Mark, x: number, y: number, size: number, colours: MarkColours): void {
  switch (mark) {
    case 'toggle':
      paintToggleBadge(ctx, x, y, size, colours);
      return;
    case 'tread':
      paintTreadBadge(ctx, x, y, size, colours);
      return;
    case 'bolt':
      paintBoltBadge(ctx, x, y, size, colours);
      return;
    case 'rivets':
      paintRivets(ctx, x, y, size, colours);
      return;
    case 'foil':
      paintFoilBadge(ctx, x, y, size, colours);
      return;
    case 'pause':
      paintPauseBadge(ctx, x, y, size, colours);
      return;
    case 'bribe':
      paintBribeBadge(ctx, x, y, size, colours);
      return;
    case 'sign_chip':
    case 'sign_melinda':
      paintSignPlate(ctx, x, y, size, SIGN_LETTERS[mark], colours);
      return;
  }
}


/** The variant a table holds for an id, or undefined; inherited keys never match. */
export function cc2VariantOf(table: Readonly<Record<string, Cc2Variant>>, id: string): Cc2Variant | undefined {
  return Object.prototype.hasOwnProperty.call(table, id) ? table[id] : undefined;
}
