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

import { CC2_GATE_BASE_IDS, NO_SIGN_ITEM_IDS, NO_SIGN_ITEM_PREFIX, SIGNAL_GATE_CC2_ID_SUFFIX } from '../core/coreConstants';
import type { RunewardArtConfig } from '../core/types';
import {
  MELINDA_BOW_COLOURS,
  MarkColours,
  paintBoltBadge,
  paintBribeBadge,
  paintDynamiteBadge,
  paintFishBadge,
  paintFoilBadge,
  paintForwardBadge,
  paintNoSign,
  paintPauseBadge,
  paintRailBadge,
  paintRivets,
  paintCornerBadge,
  paintSignPlate,
  paintToggleBadge,
  paintTreadBadge,
  paintTurningBadge
} from './cc2Marks';

/** The sealed trap (format 17): always drawn closed, whatever buttons are pressed. */
export const SEALED_TRAP_TILE = 'trap_sealed';

/** The marks a look-alike can wear. */
export type Cc2Mark = 'toggle' | 'tread' | 'rivets' | 'sign_chip' | 'sign_melinda' | 'foil' | 'pause' | 'bribe' | 'bolt' | 'no_sign' | 'rail' | 'dynamite' | 'fish' | 'forward' | 'turning' | 'cc2' | 'random' | 'barrier' | 'helmet' | '3d' | 'off';

/** The tile a look-alike is drawn on, and the mark drawn over it. */
export interface Cc2Variant {
  readonly base: string;
  readonly mark: Cc2Mark;
}

/** Items drawn as another item with a mark; the no-signs come last, so one over the hiking boots finds them already listed. */
export const CC2_ITEM_VARIANTS: Readonly<Record<string, Cc2Variant>> = {
  green_chip: { base: 'chip', mark: 'toggle' },
  green_bomb: { base: 'bomb', mark: 'toggle' },
  hiking_boots: { base: 'boots_force', mark: 'tread' },
  helmet: { base: 'boots_pull', mark: 'helmet' },
  steel_foil: { base: 'boots_ice', mark: 'foil' },
  toggle_clock: { base: 'stopwatch_bonus', mark: 'pause' },
  bribe: { base: 'toll_token', mark: 'bribe' },
  railroad_sign: { base: 'boots_fire', mark: 'rail' },
  lightning_bolt: { base: 'boots_speed', mark: 'bolt' },
  dynamite: { base: 'charge', mark: 'dynamite' },
  dynamite_lit: { base: 'charge_lit', mark: 'dynamite' },
  // The yellow pad picked up in a CC2 level: the pocket gate (a pad that is carried) with the forward mark of the yellow pad.
  teleport_yellow_item: { base: 'pocket_gate', mark: 'forward' }
,
  ...Object.fromEntries(NO_SIGN_ITEM_IDS.map((id): [string, Cc2Variant] => [`${NO_SIGN_ITEM_PREFIX}${id}`, { base: id, mark: 'no_sign' }]))
};

/** Runtime-only actors drawn as an item: the rolling ball is the bowling ball item (the hurl stone) on the move. Runeward paints it through its entity painter, the other styles through drawItem; both end in the item art. */
export const CC2_ENTITY_ITEM_ART: Readonly<Record<string, string>> = {
  rolling_ball: 'hurl_stone'
};

/** Terrain drawn as another terrain with a mark. */
export const CC2_TERRAIN_VARIANTS: Readonly<Record<string, Cc2Variant>> = {
  steel_wall: { base: 'wall', mark: 'rivets' },
  sign_chip_only: { base: 'floor', mark: 'sign_chip' },
  sign_melinda_only: { base: 'floor', mark: 'sign_melinda' },
  // The CC3D look-alikes: the blue socket every mover opens, and the two teleporters of the CC3D exit orders.
  fish_gate: { base: 'socket', mark: 'fish' },
  teleport_forward: { base: 'teleport_blue', mark: 'forward' },
  teleport_turning: { base: 'teleport_red', mark: 'turning' },
  // The format 14 look-alikes: the Chip's Challenge 2 rules on the tile they resemble.
  slime_cc2: { base: 'slime', mark: 'cc2' },
  turtle_cc2: { base: 'turtle', mark: 'cc2' },
  flame_jet_cc2_off: { base: 'flame_jet_off', mark: 'cc2' },
  flame_jet_cc2_on: { base: 'flame_jet_on', mark: 'cc2' },
  block_barrier_floor: { base: 'floor', mark: 'barrier' },
  transmogrifier_cc2: { base: 'transmogrifier', mark: 'cc2' },
  teleport_random: { base: 'teleport_green', mark: 'random' },
  teleport_red_cc2: { base: 'teleport_red', mark: 'cc2' },
  // The format 15 look-alikes: more Chip's Challenge 2 and Chip's Challenge 3D rules on the tile they resemble.
  dirt_3d: { base: 'dirt', mark: '3d' },
  popup_wall_cc2: { base: 'floor', mark: 'cc2' },
  trap_open: { base: 'trap', mark: 'cc2' },
  appearing_wall_any: { base: 'appearing_wall', mark: '3d' },
  slime_3d: { base: 'slime', mark: '3d' },
  teleport_red_cc2_off: { base: 'teleport_red', mark: 'off' },
  transmogrifier_cc2_off: { base: 'transmogrifier', mark: 'off' },
  // The format 16 look-alike: the CC2 orange button, held down by any actor, on the signal plate.
  button_orange_cc2: { base: 'signal_plate', mark: 'cc2' },
  // The format 17 look-alike: the CC3D trap that no button opens, on the trap.
  [SEALED_TRAP_TILE]: { base: 'trap', mark: '3d' },
  // The CC2 logic gates: the gate of the same logic that every actor walks through.
  ...Object.fromEntries(CC2_GATE_BASE_IDS.map((id): [string, Cc2Variant] => [`${id}${SIGNAL_GATE_CC2_ID_SUFFIX}`, { base: id, mark: 'cc2' }])),
  // The CC2 dirt: only the dirt block is stopped by it, every other block packs it down.
  dirt_cc2: { base: 'dirt', mark: 'cc2' },
  // The format 17 CC3D ice corners, on the native corner of the same sides.
  ice_corner_3d_nw: { base: 'ice_nw', mark: '3d' },
  ice_corner_3d_ne: { base: 'ice_ne', mark: '3d' },
  ice_corner_3d_sw: { base: 'ice_sw', mark: '3d' },
  ice_corner_3d_se: { base: 'ice_se', mark: '3d' }
};

/** The letter set on the plate of each gender sign, or on the corner badge of a look-alike: its initial or symbol. */
const SIGN_LETTERS: Readonly<Record<'sign_chip' | 'sign_melinda' | 'cc2' | 'random' | 'barrier' | 'helmet' | '3d' | 'off', string>> = {
  sign_chip: 'C',
  sign_melinda: 'M',
  cc2: '2',
  random: '?',
  barrier: 'B',
  helmet: 'H',
  '3d': '3',
  off: 'O'
};

/** The marks that only tell a look-alike from the tile it resembles (drawn as a corner badge, never as a real sign). */
const LOOK_ALIKE_MARKS: ReadonlySet<Cc2Mark> = new Set<Cc2Mark>(['cc2', '3d', 'off', 'random', 'barrier', 'helmet']);

/** Where a mark is drawn: in the editor or in play, and on a level imported from Chip's Challenge 2 or 3D or not. */
export interface MarkContext {
  readonly isEditor: boolean;
  readonly importedLevel: boolean;
}

/**
 * True when the mark is drawn. A look-alike badge is left out in play on an imported level, where every such tile
 * follows the rule of the imported game and the badge carries no information; the editor and native levels keep it,
 * and the real signs and the no-signs are drawn everywhere.
 */
export function drawsMark(mark: Cc2Mark, context: MarkContext): boolean {
  return context.isEditor || !context.importedLevel || !LOOK_ALIKE_MARKS.has(mark);
}

/** Whether the level came from an import (CC2 record, CC3D data, or the CC3D source kept on a converted level). */
export function isImportedLevel(level: { cc2?: unknown; cc3d?: unknown; cc3dSource?: unknown }): boolean {
  return level.cc2 !== undefined || level.cc3d !== undefined || level.cc3dSource !== undefined;
}

/** The palette entries a vector style hands in (the same keys as the palette of game.json). */
export interface MarkPalette {
  readonly green: string;
  readonly brown: string;
  readonly gray: string;
  readonly red: string;
  readonly blue: string;
  readonly glyphInk: string;
  readonly hintGlyph: string;
  readonly wallShadow: string;
  readonly forbidSign: string;
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
    case 'no_sign':
      return { fill: pal.forbidSign, edge: pal.forbidSign, ink: pal.forbidSign };
    case 'foil':
      return { fill: pal.gray, edge: pal.wallShadow, ink: pal.hintGlyph };
    case 'pause':
      return { fill: pal.blue, edge: pal.glyphInk, ink: pal.hintGlyph };
    case 'bribe':
      return { fill: pal.green, edge: pal.glyphInk, ink: pal.hintGlyph };
    case 'dynamite':
      return { fill: pal.red, edge: pal.glyphInk, ink: pal.hintGlyph };
    case 'rail':
      return { fill: pal.gray, edge: pal.glyphInk, ink: pal.hintGlyph };
    case 'fish':
    case 'forward':
      return { fill: pal.blue, edge: pal.glyphInk, ink: pal.hintGlyph };
    case 'turning':
      return { fill: pal.red, edge: pal.glyphInk, ink: pal.hintGlyph };
    case 'cc2':
    case 'barrier':
    case 'off':
      return { fill: pal.gray, edge: pal.wallShadow, ink: pal.hintGlyph };
    case 'random':
      return { fill: pal.green, edge: pal.glyphInk, ink: pal.hintGlyph };
    case 'helmet':
    case '3d':
      return { fill: pal.blue, edge: pal.glyphInk, ink: pal.hintGlyph };
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
    case 'no_sign':
      return { fill: art.item.forbid.ring, edge: art.item.forbid.slash, ink: art.item.forbid.ring };
    case 'foil':
      return { fill: art.wall.topLight, edge: art.wall.edge, ink: art.wall.edge };
    case 'pause':
      return { fill: art.keys.blue.main, edge, ink: art.keys.blue.glyph };
    case 'bribe':
      return { fill: art.keys.green.main, edge, ink: art.keys.green.glyph };
    case 'dynamite':
      return { fill: art.keys.red.main, edge, ink: art.keys.red.glyph };
    case 'rail':
      return { fill: art.wall.topLight, edge: art.wall.edge, ink: art.wall.edge };
    case 'fish':
    case 'forward':
      return { fill: art.keys.blue.main, edge, ink: art.keys.blue.glyph };
    case 'turning':
      return { fill: art.keys.red.main, edge, ink: art.keys.red.glyph };
    case 'cc2':
    case 'barrier':
    case 'off':
      return { fill: art.wall.topLight, edge: art.wall.edge, ink: art.wall.edge };
    case 'random':
      return { fill: art.keys.green.main, edge, ink: art.keys.green.glyph };
    case 'helmet':
    case '3d':
      return { fill: art.keys.blue.main, edge, ink: art.keys.blue.glyph };
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
    case 'dynamite':
      paintDynamiteBadge(ctx, x, y, size, colours);
      return;
    case 'rail':
      paintRailBadge(ctx, x, y, size, colours);
      return;
    case 'fish':
      paintFishBadge(ctx, x, y, size, colours);
      return;
    case 'forward':
      paintForwardBadge(ctx, x, y, size, colours);
      return;
    case 'turning':
      paintTurningBadge(ctx, x, y, size, colours);
      return;
    case 'sign_chip':
    case 'sign_melinda':
      paintSignPlate(ctx, x, y, size, SIGN_LETTERS[mark], colours);
      return;
    case 'cc2':
    case 'random':
    case 'barrier':
    case 'helmet':
    case '3d':
    case 'off':
      // A look-alike wears a small corner badge: the big plate stays for the real signs.
      paintCornerBadge(ctx, x, y, size, SIGN_LETTERS[mark], colours);
      return;
    case 'no_sign':
      paintNoSign(ctx, x, y, size, colours);
      return;
  }
}


/** The variant a table holds for an id, or undefined; inherited keys never match. */
export function cc2VariantOf(table: Readonly<Record<string, Cc2Variant>>, id: string): Cc2Variant | undefined {
  return Object.prototype.hasOwnProperty.call(table, id) ? table[id] : undefined;
}
