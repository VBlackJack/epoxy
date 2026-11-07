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

import { CC2_ID_PREFIX } from '../core/coreConstants';

/**
 * Placeholder drawing of the reserved Chip's Challenge 2 ids: a magenta checker with a short glyph, the same in every
 * style, so a mechanic Epoxy does not play is never mistaken for a real tile.
 */

/** Cells per side of the checker. */
const CHECKER_CELLS = 4;
/** The two colours of the checker. */
const CHECKER_COLOR_A = '#ff00ff';
const CHECKER_COLOR_B = '#4a004a';
/** Colour and outline of the glyph. */
const GLYPH_COLOR = '#ffffff';
const GLYPH_OUTLINE = '#000000';
/** Font of the glyph, as a share of the cell size. */
const GLYPH_FONT_SCALE = 0.34;
const GLYPH_FONT_WEIGHT = 700;
const GLYPH_FONT_FAMILY = 'sans-serif';
/** Longest glyph, in letters. */
export const CC2_GLYPH_MAX_LENGTH = 3;
/** Share of the cell left clear around the drawing of an item or an entity, so the floor under it shows. */
export const CC2_PLACEHOLDER_INSET_RATIO = 0.12;
/** Share of the cell size taken by the glyph outline width. */
const GLYPH_OUTLINE_SCALE = 0.06;
const ID_WORD_SEPARATOR = '_';

/** True for an id reserved for a Chip's Challenge 2 mechanic. */
export function isCc2Id(id: string): boolean {
  return id.startsWith(CC2_ID_PREFIX);
}

/** The short glyph of a reserved id: the initials of the words of its name (cc2_purple_wall gives PW), at most three letters. */
export function cc2Glyph(id: string): string {
  const name = isCc2Id(id) ? id.slice(CC2_ID_PREFIX.length) : id;
  return name
    .split(ID_WORD_SEPARATOR)
    .filter((word) => word.length > 0)
    .map((word) => word[0].toUpperCase())
    .join('')
    .slice(0, CC2_GLYPH_MAX_LENGTH);
}

/**
 * Draws the placeholder of a reserved id in the square at (x, y). A terrain fills the cell (`inset` 0); an item or an
 * entity leaves the inset clear on every side.
 */
export function paintCc2Placeholder(
  ctx: CanvasRenderingContext2D,
  id: string,
  x: number,
  y: number,
  size: number,
  inset = 0
): void {
  const margin = size * inset;
  const side = size - margin * 2;
  const step = side / CHECKER_CELLS;
  ctx.save();
  for (let row = 0; row < CHECKER_CELLS; row++) {
    for (let col = 0; col < CHECKER_CELLS; col++) {
      ctx.fillStyle = (row + col) % 2 === 0 ? CHECKER_COLOR_A : CHECKER_COLOR_B;
      ctx.fillRect(x + margin + col * step, y + margin + row * step, step, step);
    }
  }
  const cx = x + size / 2;
  const cy = y + size / 2;
  ctx.font = `${GLYPH_FONT_WEIGHT} ${Math.floor(size * GLYPH_FONT_SCALE)}px ${GLYPH_FONT_FAMILY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = Math.max(1, size * GLYPH_OUTLINE_SCALE);
  ctx.strokeStyle = GLYPH_OUTLINE;
  ctx.fillStyle = GLYPH_COLOR;
  const glyph = cc2Glyph(id);
  ctx.strokeText(glyph, cx, cy);
  ctx.fillText(glyph, cx, cy);
  ctx.restore();
}
