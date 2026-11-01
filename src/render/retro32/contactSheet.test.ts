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
 * Dev helper, skipped unless RETRO32_DUMP is set: writes PNG contact sheets of every tile
 * sprite to local/retro32/ (git-ignored) so the look can be reviewed by eye.
 *   PowerShell: $env:RETRO32_DUMP=1; npx vitest run src/render/retro32/contactSheet
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { describe, it } from 'vitest';
import { createTestBundle } from '../../test/loadTestConfigs';
import { RETRO_SWAP_RAMPS } from '../paletteKeys';
import { RETRO_SHEET, RETRO_SPRITE_NAMES, RETRO_SPRITE_SIZE, resolveRetroRamps } from '../retroSprites';
import { deriveRetro32Ramps } from './ramps';
import { RETRO32_SPRITE_SIZE, rasterizeSprite32 } from './rasterize';

const DUMP_ENV = 'RETRO32_DUMP';
const DUMP_DIR = 'local/retro32';
const DUMP_THEMES = ['default', 'magma_core'];
const COLUMNS = 16;
const ZOOM = 3;
const GAP = 2;
const BYTES_PER_PIXEL = 4;
const BACKGROUND = [40, 40, 48, 255];
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

function blitZoomed(sheet: Uint8Array, sheetWidth: number, px: Uint8ClampedArray, ox: number, oy: number): void {
  const side = RETRO32_SPRITE_SIZE * ZOOM;
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const s = (Math.floor(y / ZOOM) * RETRO32_SPRITE_SIZE + Math.floor(x / ZOOM)) * BYTES_PER_PIXEL;
      if (px[s + 3] === 0) continue;
      const d = ((oy + y) * sheetWidth + ox + x) * BYTES_PER_PIXEL;
      sheet.set(px.subarray(s, s + BYTES_PER_PIXEL), d);
    }
  }
}

describe.skipIf(!process.env[DUMP_ENV])('32-Bit Retro contact sheets', () => {
  it('writes one PNG per theme under local/retro32', () => {
    const palettes = createTestBundle().game.retroPalettes as Record<string, Record<string, string[]>>;
    mkdirSync(DUMP_DIR, { recursive: true });
    const cell = RETRO32_SPRITE_SIZE * ZOOM + GAP * 2;
    const names = RETRO_SPRITE_NAMES.filter((n) => RETRO_SHEET.sprites[n].width === RETRO_SPRITE_SIZE);
    const width = COLUMNS * cell;
    const height = Math.ceil(names.length / COLUMNS) * cell;
    for (const themeId of DUMP_THEMES) {
      const ramps16 = resolveRetroRamps(palettes, themeId);
      const ramps32 = deriveRetro32Ramps(ramps16);
      const sheet = new Uint8Array(width * height * BYTES_PER_PIXEL);
      for (let i = 0; i < sheet.length; i += BYTES_PER_PIXEL) sheet.set(BACKGROUND, i);
      names.forEach((name, n) => {
        const px = rasterizeSprite32(RETRO_SHEET.sprites[name], ramps32, ramps16, Object.values(RETRO_SWAP_RAMPS)[0]);
        blitZoomed(sheet, width, px, (n % COLUMNS) * cell + GAP, Math.floor(n / COLUMNS) * cell + GAP);
      });
      writeFileSync(`${DUMP_DIR}/sheet-${themeId}.png`, encodePng(sheet, width, height));
    }
  });
});
