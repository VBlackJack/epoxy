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
 * Dev helper, skipped unless STYLES_DUMP is set: writes one PNG swatch sheet per Retro HD style to
 * local/styles/ (ignored by version control): every colour of the palette, then the colours of
 * each theme, recoloured by the style, so the looks can be reviewed by eye.
 *   PowerShell: $env:STYLES_DUMP=1; npx vitest run src/render/styles/derivedStylesContactSheet
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { describe, it } from 'vitest';
import type { RenderStyleFamilies, RenderStylePaletteConfig, ThemePalette } from '../../core/types';
import { createTestBundle } from '../../test/loadTestConfigs';
import { RENDER_STYLES } from './renderStyles';
import { THEME_COLOUR_KEYS, createRetroHdRecolour, parseCssColour } from './retroHdPalette';

const DUMP_ENV = 'STYLES_DUMP';
const DUMP_DIR = 'local/styles';
const COLUMNS = 16;
const SWATCH = 24;
const GAP = 2;
const BYTES_PER_PIXEL = 4;
const BACKGROUND = [40, 40, 48, 255];
const OPAQUE = 255;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const CRC_POLY = 0xedb88320;
const BITS_PER_BYTE = 8;
const RGBA_COLOUR_TYPE = 6;
const IHDR_LENGTH = 13;

function crc32(data: Uint8Array): number {
  let crc = ~0;
  for (const byte of data) {
    crc ^= byte;
    for (let k = 0; k < BITS_PER_BYTE; k++) crc = (crc >>> 1) ^ (crc & 1 ? CRC_POLY : 0);
  }
  return ~crc >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, tail]);
}

function encodePng(rgba: Uint8Array, width: number, height: number): Buffer {
  const header = Buffer.alloc(IHDR_LENGTH);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = BITS_PER_BYTE;
  header[9] = RGBA_COLOUR_TYPE;
  const stride = width * BYTES_PER_PIXEL;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from(PNG_SIGNATURE),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array(0))
  ]);
}

function fillSwatch(sheet: Uint8Array, sheetWidth: number, colour: string, index: number): void {
  const parsed = parseCssColour(colour);
  const rgba = parsed ? [...parsed.rgb, OPAQUE] : BACKGROUND;
  const cell = SWATCH + GAP * 2;
  const ox = (index % COLUMNS) * cell + GAP;
  const oy = Math.floor(index / COLUMNS) * cell + GAP;
  for (let y = 0; y < SWATCH; y++) {
    for (let x = 0; x < SWATCH; x++) sheet.set(rgba, ((oy + y) * sheetWidth + ox + x) * BYTES_PER_PIXEL);
  }
}

describe.skipIf(!process.env[DUMP_ENV])('Retro HD style contact sheets', () => {
  it('writes one PNG per style under local/styles', () => {
    const { game } = createTestBundle();
    const stylePalettes = game.renderStylePalettes as Record<string, RenderStylePaletteConfig>;
    const themes = Object.values(game.themes as Record<string, ThemePalette>);
    mkdirSync(DUMP_DIR, { recursive: true });
    for (const style of RENDER_STYLES.filter((s) => s.finish !== null)) {
      const recolour = createRetroHdRecolour(stylePalettes[style.id], game.renderStyleFamilies as RenderStyleFamilies);
      const colours = Object.values(recolour.palette(game.palette));
      for (const theme of themes) {
        const styled = recolour.theme(theme);
        colours.push(...THEME_COLOUR_KEYS.map((key) => styled[key] as string));
      }
      const cell = SWATCH + GAP * 2;
      const width = COLUMNS * cell;
      const height = Math.ceil(colours.length / COLUMNS) * cell;
      const sheet = new Uint8Array(width * height * BYTES_PER_PIXEL);
      for (let i = 0; i < sheet.length; i += BYTES_PER_PIXEL) sheet.set(BACKGROUND, i);
      colours.forEach((colour, index) => fillSwatch(sheet, width, colour, index));
      writeFileSync(`${DUMP_DIR}/sheet-${style.id}.png`, encodePng(sheet, width, height));
    }
  });
});
