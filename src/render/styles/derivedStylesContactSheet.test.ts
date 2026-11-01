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
 * Dev helper, skipped unless STYLES_DUMP is set: writes one PNG contact sheet of every tile
 * sprite per recolouring style to local/styles/ (ignored by version control) so the looks can be
 * reviewed by eye.
 *   PowerShell: $env:STYLES_DUMP=1; npx vitest run src/render/styles/derivedStylesContactSheet
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { describe, it } from 'vitest';
import type { RenderStylePaletteConfig } from '../../core/types';
import { createTestBundle } from '../../test/loadTestConfigs';
import { createRetro32SpriteCache } from '../retro32/cache';
import { rasterizeSprite32 } from '../retro32/rasterize';
import { createRetro32ThemeSprites } from '../retro32/spriteStyle32';
import { RETRO_SWAP_RAMPS } from '../paletteKeys';
import { RETRO_SHEET, RETRO_SPRITE_NAMES, RETRO_SPRITE_SIZE, rasterizeSprite, resolveRetroRamps } from '../retroSprites';
import { RENDER_STYLES } from './renderStyles';
import { applyRampTransform, createStyleTransforms } from './styleTransforms';

const DUMP_ENV = 'STYLES_DUMP';
const DUMP_DIR = 'local/styles';
const DUMP_THEME = 'default';
const COLUMNS = 16;
const ZOOM = 3;
const GAP = 2;
const BYTES_PER_PIXEL = 4;
const ALPHA_OFFSET = 3;
const BACKGROUND = [40, 40, 48, 255];
const CACHE_ENTRIES = 16;
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

function blitZoomed(sheet: Uint8Array, sheetWidth: number, px: Uint8ClampedArray, side: number, ox: number, oy: number): void {
  const scaled = side * ZOOM;
  for (let y = 0; y < scaled; y++) {
    for (let x = 0; x < scaled; x++) {
      const s = (Math.floor(y / ZOOM) * side + Math.floor(x / ZOOM)) * BYTES_PER_PIXEL;
      if (px[s + ALPHA_OFFSET] === 0) continue;
      const d = ((oy + y) * sheetWidth + ox + x) * BYTES_PER_PIXEL;
      sheet.set(px.subarray(s, s + BYTES_PER_PIXEL), d);
    }
  }
}

describe.skipIf(!process.env[DUMP_ENV])('recolouring style contact sheets', () => {
  it('writes one PNG per style under local/styles', () => {
    const bundle = createTestBundle();
    const palettes = bundle.game.retroPalettes as Record<string, Record<string, string[]>>;
    const stylePalettes = bundle.game.renderStylePalettes as Record<string, RenderStylePaletteConfig>;
    mkdirSync(DUMP_DIR, { recursive: true });
    const names = RETRO_SPRITE_NAMES.filter((n) => RETRO_SHEET.sprites[n].width === RETRO_SPRITE_SIZE);
    const ramps16 = resolveRetroRamps(palettes, DUMP_THEME);
    const swap = Object.values(RETRO_SWAP_RAMPS)[0];
    for (const style of RENDER_STYLES.filter((s) => s.transformKey !== null)) {
      const transforms = createStyleTransforms(stylePalettes[style.id]);
      const side = style.sprite?.tileSize ?? RETRO_SPRITE_SIZE;
      const cell = side * ZOOM + GAP * 2;
      const width = COLUMNS * cell;
      const height = Math.ceil(names.length / COLUMNS) * cell;
      const sheet = new Uint8Array(width * height * BYTES_PER_PIXEL);
      for (let i = 0; i < sheet.length; i += BYTES_PER_PIXEL) sheet.set(BACKGROUND, i);
      const ramps = style.base === 'retro32'
        ? createRetro32ThemeSprites(
            DUMP_THEME, ramps16, undefined, createRetro32SpriteCache(CACHE_ENTRIES), RETRO_SHEET,
            { styleId: style.id, transform: transforms.ramps }
          ).ramps32
        : applyRampTransform(ramps16, transforms.ramps);
      names.forEach((name, n) => {
        const sprite = RETRO_SHEET.sprites[name];
        const px = style.base === 'retro32'
          ? rasterizeSprite32(sprite, ramps, ramps16, swap)
          : rasterizeSprite(sprite, ramps, swap);
        blitZoomed(sheet, width, px, side, (n % COLUMNS) * cell + GAP, Math.floor(n / COLUMNS) * cell + GAP);
      });
      writeFileSync(`${DUMP_DIR}/sheet-${style.id}.png`, encodePng(sheet, width, height));
    }
  });
});
