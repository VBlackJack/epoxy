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

/** Colour-channel glyphs: a distinct shape per colour key, so colour is never the only cue. */

const FULL_TURN = Math.PI * 2;

/** Draws the glyph of a colour key (diamond, triangle, plus, ring or saltire) centred on (cx, cy). */
export function paintColorGlyph(
  ctx: CanvasRenderingContext2D,
  colorKey: string,
  cx: number,
  cy: number,
  r: number,
  fillColor: string
): void {
  ctx.save();
  ctx.fillStyle = fillColor;
  ctx.strokeStyle = fillColor;
  ctx.lineWidth = Math.max(1.5, r * 0.35);
  ctx.beginPath();
  if (colorKey === 'red') {
    // Diamond
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r, cy);
    ctx.lineTo(cx, cy + r);
    ctx.lineTo(cx - r, cy);
    ctx.closePath();
    ctx.fill();
  } else if (colorKey === 'blue') {
    // Triangle
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r, cy + r * 0.85);
    ctx.lineTo(cx - r, cy + r * 0.85);
    ctx.closePath();
    ctx.fill();
  } else if (colorKey === 'yellow') {
    // Plus / Cross
    ctx.moveTo(cx - r, cy);
    ctx.lineTo(cx + r, cy);
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx, cy + r);
    ctx.stroke();
  } else if (colorKey === 'green') {
    // Ring
    ctx.arc(cx, cy, r * 0.78, 0, FULL_TURN);
    ctx.stroke();
  } else if (colorKey === 'orange') {
    // Saltire
    ctx.moveTo(cx - r, cy - r);
    ctx.lineTo(cx + r, cy + r);
    ctx.moveTo(cx + r, cy - r);
    ctx.lineTo(cx - r, cy + r);
    ctx.stroke();
  }
  ctx.restore();
}
