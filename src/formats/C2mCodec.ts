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
  C2M_ERROR_CODES,
  C2M_SECTION_HEADER_BYTES,
  C2M_TAGS,
  C2M_TAG_BYTES,
  C2M_TEXT_TAGS,
  CC2_MODIFIER_CODES,
  C2mFormatError,
  type Cc2File,
  type Cc2Map,
  type Cc2Options,
  type Cc2Section,
  type Cc2Tile,
  type Cc2UnknownRemainder
} from './cc2Model';
import { cc2TileInfo, closesCell } from './cc2TileTable';
import { decodeWindows1252 } from './cc2Text';

/** Size field of a packed block: little-endian uint16 holding the unpacked size. */
export const PACK_SIZE_FIELD_BYTES = 2;
/** Control bytes below this value start a literal run of that many bytes. */
export const PACK_COPY_FLAG = 0x80;
/** Longest literal run or back-reference a control byte can express. */
export const PACK_MAX_RUN = 0x7f;
/** Back-reference distances are one unsigned byte. */
export const PACK_MAX_OFFSET = 0xff;
/** Largest unpacked size the uint16 size field can hold. */
export const PACK_MAX_UNPACKED_BYTES = 0xffff;

/** Map data starts with the width and height, one byte each. */
export const MAP_HEADER_BYTES = 2;
/** Value of Cc2UnknownRemainder.code when the data ended inside a cell. */
export const UNKNOWN_CODE_END_OF_DATA = -1;
/** Option block layout: uint16 time limit, then single-byte switches. */
const OPTIONS_TIME_BYTES = 2;
const OPTIONS_FLAG_COUNT = 4;
const BITS_PER_BYTE = 8;

/** Data bytes carried by each modifier code. */
const MODIFIER_BYTES: ReadonlyMap<number, 1 | 2 | 4> = new Map([
  [CC2_MODIFIER_CODES.byte, 1],
  [CC2_MODIFIER_CODES.word, 2],
  [CC2_MODIFIER_CODES.dword, 4]
]);

/** Modifier width for a code, or undefined when the code is not a modifier. */
export function modifierBytes(code: number): 1 | 2 | 4 | undefined {
  return MODIFIER_BYTES.get(code);
}

/** Inverse of modifierBytes. */
export function modifierCode(width: 1 | 2 | 4): number {
  if (width === 1) return CC2_MODIFIER_CODES.byte;
  if (width === 2) return CC2_MODIFIER_CODES.word;
  return CC2_MODIFIER_CODES.dword;
}

function readUint16(data: Uint8Array, at: number): number {
  return data[at] | (data[at + 1] << BITS_PER_BYTE);
}

function readUint32(data: Uint8Array, at: number): number {
  return (data[at] | (data[at + 1] << 8) | (data[at + 2] << 16) | (data[at + 3] << 24)) >>> 0;
}

/**
 * Expands a packed block: uint16 unpacked size, then control bytes. A control
 * below 0x80 is a literal run of that many bytes; otherwise it copies
 * (control - 0x80) bytes starting `offset` bytes back, offset being the next
 * byte. The copy may overlap its own output.
 */
export function unpackC2m(data: Uint8Array): Uint8Array {
  if (data.length < PACK_SIZE_FIELD_BYTES) throw new C2mFormatError(C2M_ERROR_CODES.badPack, 'no size field');
  const size = readUint16(data, 0);
  const out = new Uint8Array(size);
  let written = 0;
  let at = PACK_SIZE_FIELD_BYTES;
  while (at < data.length && written < size) {
    const control = data[at++];
    if (control < PACK_COPY_FLAG) {
      if (at + control > data.length) throw new C2mFormatError(C2M_ERROR_CODES.badPack, 'literal run past end');
      if (written + control > size) throw new C2mFormatError(C2M_ERROR_CODES.badPack, 'output overrun');
      out.set(data.subarray(at, at + control), written);
      at += control;
      written += control;
    } else {
      const count = control - PACK_COPY_FLAG;
      if (at >= data.length) throw new C2mFormatError(C2M_ERROR_CODES.badPack, 'copy without offset');
      const offset = data[at++];
      if (offset === 0 || offset > written) throw new C2mFormatError(C2M_ERROR_CODES.badPack, 'offset out of range');
      if (written + count > size) throw new C2mFormatError(C2M_ERROR_CODES.badPack, 'output overrun');
      for (let i = 0; i < count; i++) {
        out[written] = out[written - offset];
        written++;
      }
    }
  }
  if (written !== size || at !== data.length) {
    throw new C2mFormatError(C2M_ERROR_CODES.badPack, 'size mismatch');
  }
  return out;
}

/** Result of reading one tile. */
type TileRead = { tile: Cc2Tile; next: number; closesCell: boolean } | { unknownCode: number };

function readTile(data: Uint8Array, start: number): TileRead {
  let at = start;
  let mod: number | undefined;
  let modBytes: 1 | 2 | 4 | undefined;
  let code = data[at++];
  const width = modifierBytes(code);
  if (width !== undefined) {
    if (at + width >= data.length) return { unknownCode: code };
    mod = 0;
    for (let i = 0; i < width; i++) mod += data[at + i] * 2 ** (BITS_PER_BYTE * i);
    modBytes = width;
    at += width;
    code = data[at++];
    if (modifierBytes(code) !== undefined) return { unknownCode: code };
  }
  const info = cc2TileInfo(code);
  if (!info || at + info.extraBytes > data.length) return { unknownCode: code };
  const tile: Cc2Tile = { code };
  if (mod !== undefined && modBytes !== undefined) {
    tile.mod = mod;
    tile.modBytes = modBytes;
  }
  if (info.extra === 'dir') tile.dir = data[at];
  else if (info.extra === 'flags') tile.flags = data[at];
  else if (info.extra === 'dirArrows') {
    tile.dir = data[at];
    tile.arrows = data[at + 1];
  }
  return { tile, next: at + info.extraBytes, closesCell: closesCell(info.layer) };
}

/**
 * Decodes the uncompressed map bytes. Decoding stops at the first byte the
 * tile table cannot explain; the rest is kept raw in `unknown`.
 */
export function decodeC2mMapBytes(data: Uint8Array): Cc2Map {
  if (data.length < MAP_HEADER_BYTES) throw new C2mFormatError(C2M_ERROR_CODES.badTile, 'map shorter than its header');
  const width = data[0];
  const height = data[1];
  const map: Cc2Map = { width, height, cells: [], tail: new Uint8Array(0) };
  let at = MAP_HEADER_BYTES;
  const cellCount = width * height;
  for (let cellIndex = 0; cellIndex < cellCount; cellIndex++) {
    const tiles: Cc2Tile[] = [];
    for (;;) {
      const read: TileRead = at < data.length ? readTile(data, at) : { unknownCode: UNKNOWN_CODE_END_OF_DATA };
      if ('unknownCode' in read) {
        const unknown: Cc2UnknownRemainder = { cellIndex, code: read.unknownCode, tiles, raw: data.slice(at) };
        map.unknown = unknown;
        return map;
      }
      tiles.push(read.tile);
      at = read.next;
      if (read.closesCell) break;
    }
    map.cells.push({ tiles });
  }
  map.tail = data.slice(at);
  return map;
}

function decodeText(tag: string, data: Uint8Array): Cc2Section {
  const end = data.indexOf(0);
  const terminated = end >= 0;
  return {
    kind: 'text',
    tag,
    text: decodeWindows1252(terminated ? data.subarray(0, end) : data),
    terminated,
    extra: terminated ? data.slice(end + 1) : new Uint8Array(0)
  };
}

/** Reads the typed view of an option block. */
export function parseCc2Options(raw: Uint8Array): Cc2Options {
  const timeLimit = raw.length >= OPTIONS_TIME_BYTES ? readUint16(raw, 0) : 0;
  const flags: number[] = [];
  for (let i = 0; i < OPTIONS_FLAG_COUNT; i++) {
    const at = OPTIONS_TIME_BYTES + i;
    if (at < raw.length) flags.push(raw[at]);
  }
  return { timeLimit, flags };
}

function decodeMapSection(tag: string, data: Uint8Array): Cc2Section {
  const packed = tag === C2M_TAGS.packedMap;
  try {
    const map = decodeC2mMapBytes(packed ? unpackC2m(data) : data);
    return { kind: 'map', tag: packed ? C2M_TAGS.packedMap : C2M_TAGS.map, map };
  } catch (error) {
    // A malformed map block is kept raw so the rest of the file stays usable.
    if (error instanceof C2mFormatError) return { kind: 'raw', tag, data: data.slice() };
    throw error;
  }
}

function decodeSection(tag: string, data: Uint8Array): Cc2Section {
  if (C2M_TEXT_TAGS.includes(tag)) return decodeText(tag, data);
  if (tag === C2M_TAGS.options) {
    return { kind: 'options', tag: C2M_TAGS.options, raw: data.slice(), options: parseCc2Options(data) };
  }
  if (tag === C2M_TAGS.map || tag === C2M_TAGS.packedMap) return decodeMapSection(tag, data);
  return { kind: 'raw', tag, data: data.slice() };
}

/**
 * Decodes a .c2m file. Sections may come in any order, unknown sections are
 * kept, and bytes after the END section are preserved in `trailing`.
 */
export function decodeC2m(bytes: Uint8Array): Cc2File {
  const sections: Cc2Section[] = [];
  let at = 0;
  let trailing = new Uint8Array(0);
  while (at < bytes.length) {
    if (at + C2M_SECTION_HEADER_BYTES > bytes.length) {
      trailing = bytes.slice(at);
      break;
    }
    const tag = decodeWindows1252(bytes.subarray(at, at + C2M_TAG_BYTES));
    const length = readUint32(bytes, at + C2M_TAG_BYTES);
    const start = at + C2M_SECTION_HEADER_BYTES;
    if (start + length > bytes.length) throw new C2mFormatError(C2M_ERROR_CODES.truncatedSection, tag);
    sections.push(decodeSection(tag, bytes.subarray(start, start + length)));
    at = start + length;
    if (tag === C2M_TAGS.end) {
      trailing = bytes.slice(at);
      break;
    }
  }
  return { sections, trailing };
}
