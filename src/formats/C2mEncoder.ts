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

import {
  PACK_COPY_FLAG,
  PACK_MAX_OFFSET,
  PACK_MAX_RUN,
  PACK_MAX_UNPACKED_BYTES,
  modifierCode
} from './C2mCodec';
import {
  C2M_ERROR_CODES,
  C2M_SECTION_HEADER_BYTES,
  C2M_TAGS,
  C2M_TAG_BYTES,
  C2mFormatError,
  type Cc2File,
  type Cc2Map,
  type Cc2Section,
  type Cc2Tile
} from './cc2Model';
import { cc2TileInfo } from './cc2TileTable';
import { encodeWindows1252 } from './cc2Text';

/** Shortest back-reference worth emitting: it costs 2 bytes, a literal costs 1 each. */
const PACK_MIN_MATCH = 3;
const BITS_PER_BYTE = 8;
const BYTE_MASK = 0xff;
const TEXT_TERMINATOR = 0;

function writeUint16(out: number[], value: number): void {
  out.push(value & BYTE_MASK, (value >>> BITS_PER_BYTE) & BYTE_MASK);
}

/**
 * Compresses with the greedy longest-match rule: at each position take the
 * longest earlier match within 255 bytes (the nearest on ties), if it is at
 * least 3 bytes long, otherwise extend the literal run. Deterministic, so the
 * same input always yields the same bytes.
 */
export function packC2m(data: Uint8Array): Uint8Array {
  if (data.length > PACK_MAX_UNPACKED_BYTES) {
    throw new C2mFormatError(C2M_ERROR_CODES.packTooLarge, String(data.length));
  }
  const out: number[] = [];
  writeUint16(out, data.length);
  let literalStart = 0;
  const flushLiterals = (end: number): void => {
    for (let at = literalStart; at < end; at += PACK_MAX_RUN) {
      const run = Math.min(PACK_MAX_RUN, end - at);
      out.push(run);
      for (let i = 0; i < run; i++) out.push(data[at + i]);
    }
  };
  let i = 0;
  while (i < data.length) {
    let bestLength = 0;
    let bestOffset = 0;
    const maxOffset = Math.min(PACK_MAX_OFFSET, i);
    const maxLength = Math.min(PACK_MAX_RUN, data.length - i);
    for (let offset = 1; offset <= maxOffset && bestLength < maxLength; offset++) {
      let length = 0;
      while (length < maxLength && data[i + length - offset] === data[i + length]) length++;
      if (length > bestLength) {
        bestLength = length;
        bestOffset = offset;
      }
    }
    if (bestLength >= PACK_MIN_MATCH) {
      flushLiterals(i);
      out.push(PACK_COPY_FLAG + bestLength, bestOffset);
      i += bestLength;
      literalStart = i;
    } else {
      i++;
    }
  }
  flushLiterals(data.length);
  return Uint8Array.from(out);
}

function pushTile(out: number[], tile: Cc2Tile): void {
  const info = cc2TileInfo(tile.code);
  if (!info) throw new C2mFormatError(C2M_ERROR_CODES.unknownTileCode, String(tile.code));
  if (tile.mod !== undefined) {
    const width = tile.modBytes;
    if (width === undefined) throw new C2mFormatError(C2M_ERROR_CODES.badTile, 'modifier without width');
    out.push(modifierCode(width));
    for (let i = 0; i < width; i++) out.push(Math.floor(tile.mod / 2 ** (BITS_PER_BYTE * i)) & BYTE_MASK);
  }
  out.push(tile.code);
  if (info.extra === 'dir') out.push((tile.dir ?? 0) & BYTE_MASK);
  else if (info.extra === 'flags') out.push((tile.flags ?? 0) & BYTE_MASK);
  else if (info.extra === 'dirArrows') out.push((tile.dir ?? 0) & BYTE_MASK, (tile.arrows ?? 0) & BYTE_MASK);
}

/** Serializes a map to its uncompressed bytes (the content of a MAP block). */
export function encodeC2mMapBytes(map: Cc2Map): Uint8Array {
  const out: number[] = [map.width & BYTE_MASK, map.height & BYTE_MASK];
  for (const cell of map.cells) for (const tile of cell.tiles) pushTile(out, tile);
  if (map.unknown) {
    for (const tile of map.unknown.tiles) pushTile(out, tile);
    for (const byte of map.unknown.raw) out.push(byte);
  }
  for (const byte of map.tail) out.push(byte);
  return Uint8Array.from(out);
}

function sectionPayload(section: Cc2Section): Uint8Array {
  switch (section.kind) {
    case 'raw':
      return section.data;
    case 'options':
      return section.raw;
    case 'text': {
      const text = encodeWindows1252(section.text);
      const parts = section.terminated ? [text, Uint8Array.of(TEXT_TERMINATOR), section.extra] : [text];
      return concat(parts);
    }
    case 'map': {
      const bytes = encodeC2mMapBytes(section.map);
      return section.tag === C2M_TAGS.packedMap ? packC2m(bytes) : bytes;
    }
  }
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** Serializes a file: every section as tag + uint32 length + payload, then the trailing bytes. */
export function encodeC2m(file: Cc2File): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const section of file.sections) {
    if (section.tag.length !== C2M_TAG_BYTES) throw new C2mFormatError(C2M_ERROR_CODES.badTag, section.tag);
    const payload = sectionPayload(section);
    const header = new Uint8Array(C2M_SECTION_HEADER_BYTES);
    header.set(encodeWindows1252(section.tag), 0);
    new DataView(header.buffer).setUint32(C2M_TAG_BYTES, payload.length, true);
    parts.push(header, payload);
  }
  parts.push(file.trailing);
  return concat(parts);
}
