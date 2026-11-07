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

import { describe, expect, it } from 'vitest';
import {
  PACK_MAX_OFFSET,
  PACK_MAX_RUN,
  decodeC2m,
  decodeC2mMapBytes,
  parseCc2Options,
  unpackC2m
} from './C2mCodec';
import { encodeC2m, encodeC2mMapBytes, packC2m } from './C2mEncoder';
import {
  C2M_ERROR_CODES,
  C2M_TAGS,
  C2mFormatError,
  Cc2Layer,
  CC2_MODIFIER_CODES,
  cc2Map,
  cc2Options,
  cc2Text,
  type Cc2File,
  type Cc2Map,
  type Cc2Section,
  type Cc2Tile
} from './cc2Model';
import {
  CC2_CODE_COMPUTER_CHIP,
  CC2_CODE_DIRECTIONAL_BLOCK,
  CC2_CODE_NO_SIGN,
  CC2_CODE_PLAYER,
  CC2_CODE_THIN_WALL,
  CC2_CODE_TRACK,
  cc2KnownCodes,
  cc2TileInfo
} from './cc2TileTable';
import { decodeWindows1252, encodeWindows1252 } from './cc2Text';

/** Synthetic tile codes used below (taken from the table, no level data involved). */
const FLOOR = 0x01;
const WALL = 0x02;
const WIRE_FLOOR = 0x6b;
const CUT_INTO_LAST_SECTION = 8;
const LCG_MULTIPLIER = 1103515245;
const LCG_INCREMENT = 12345;
const LCG_MASK = 0x7fffffff;
const LCG_SHIFT = 16;
const CODE_NOT_IN_TABLE = 0xee;

function emptyTail(): Uint8Array {
  return new Uint8Array(0);
}

function cellOf(...tiles: Cc2Tile[]): { tiles: Cc2Tile[] } {
  return { tiles };
}

function mapOf(width: number, height: number, fill: () => { tiles: Cc2Tile[] }): Cc2Map {
  const cells = Array.from({ length: width * height }, fill);
  return { width, height, cells, tail: emptyTail() };
}

function textSection(tag: string, text: string): Cc2Section {
  return { kind: 'text', tag, text, terminated: true, extra: emptyTail() };
}

function optionsSection(raw: number[]): Cc2Section {
  const bytes = Uint8Array.from(raw);
  return { kind: 'options', tag: C2M_TAGS.options, raw: bytes, options: parseCc2Options(bytes) };
}

function endSection(): Cc2Section {
  return { kind: 'raw', tag: C2M_TAGS.end, data: emptyTail() };
}

function pseudoRandomBytes(length: number, seed: number): Uint8Array {
  const out = new Uint8Array(length);
  let state = seed;
  for (let i = 0; i < length; i++) {
    state = (Math.imul(state, LCG_MULTIPLIER) + LCG_INCREMENT) & LCG_MASK;
    out[i] = (state >>> LCG_SHIFT) & 0xff;
  }
  return out;
}

function sampleFile(packed: boolean): Cc2File {
  const map = mapOf(3, 2, () => cellOf({ code: FLOOR }));
  map.cells[1] = cellOf({ code: CC2_CODE_COMPUTER_CHIP }, { code: FLOOR });
  map.cells[2] = cellOf({ code: CC2_CODE_PLAYER, dir: 2 }, { code: WALL });
  return {
    sections: [
      textSection(C2M_TAGS.header, '7'),
      textSection(C2M_TAGS.title, 'Synthetic'),
      textSection(C2M_TAGS.author, 'Test'),
      optionsSection([0x2c, 0x01, 0, 1, 0, 0]),
      { kind: 'map', tag: packed ? C2M_TAGS.packedMap : C2M_TAGS.map, map },
      { kind: 'raw', tag: C2M_TAGS.key, data: Uint8Array.of(1, 2, 3) },
      endSection()
    ],
    trailing: emptyTail()
  };
}

describe('container', () => {
  it('round trips a file whose bytes came from the encoder', () => {
    for (const packed of [false, true]) {
      const bytes = encodeC2m(sampleFile(packed));
      expect(encodeC2m(decodeC2m(bytes))).toEqual(bytes);
    }
  });

  it('round trips the model: decode(encode(x)) equals x', () => {
    for (const packed of [false, true]) {
      const file = sampleFile(packed);
      expect(decodeC2m(encodeC2m(file))).toEqual(file);
    }
  });

  it('reads typed fields', () => {
    const file = decodeC2m(encodeC2m(sampleFile(true)));
    expect(cc2Text(file, C2M_TAGS.title)).toBe('Synthetic');
    expect(cc2Options(file)?.timeLimit).toBe(0x012c);
    expect(cc2Options(file)?.flags).toEqual([0, 1, 0, 0]);
    expect(cc2Map(file)?.cells).toHaveLength(6);
  });

  it('accepts sections in any order and keeps unknown sections in place', () => {
    const file: Cc2File = {
      sections: [
        { kind: 'raw', tag: 'ZZZZ', data: Uint8Array.of(9, 9) },
        sampleFile(false).sections[4],
        textSection(C2M_TAGS.title, 'Late title'),
        { kind: 'raw', tag: 'LOCK', data: Uint8Array.of(5) },
        endSection()
      ],
      trailing: emptyTail()
    };
    const decoded = decodeC2m(encodeC2m(file));
    expect(decoded.sections.map((s) => s.tag)).toEqual(['ZZZZ', C2M_TAGS.map, C2M_TAGS.title, 'LOCK', C2M_TAGS.end]);
    expect(decoded).toEqual(file);
  });

  it('keeps bytes after the END section', () => {
    const file = sampleFile(true);
    file.trailing = Uint8Array.of(0xde, 0xad, 0xbe, 0xef, 0x00);
    const bytes = encodeC2m(file);
    const decoded = decodeC2m(bytes);
    expect(Array.from(decoded.trailing)).toEqual([0xde, 0xad, 0xbe, 0xef, 0x00]);
    expect(encodeC2m(decoded)).toEqual(bytes);
  });

  it('keeps a trailing fragment shorter than a section header', () => {
    const file = sampleFile(false);
    file.sections.pop();
    file.trailing = Uint8Array.of(1, 2, 3);
    expect(decodeC2m(encodeC2m(file))).toEqual(file);
  });

  it('rejects a section longer than the file', () => {
    const bytes = encodeC2m(sampleFile(false));
    expect(() => decodeC2m(bytes.subarray(0, bytes.length - CUT_INTO_LAST_SECTION - 1))).toThrow(C2mFormatError);
    try {
      decodeC2m(bytes.subarray(0, 20));
    } catch (error) {
      expect((error as C2mFormatError).code).toBe(C2M_ERROR_CODES.truncatedSection);
    }
  });

  it('keeps a malformed packed map as a raw section', () => {
    const bad: Cc2File = {
      sections: [{ kind: 'raw', tag: C2M_TAGS.packedMap, data: Uint8Array.of(0x10, 0x00, 0x81, 0x01) }, endSection()],
      trailing: emptyTail()
    };
    const decoded = decodeC2m(encodeC2m(bad));
    expect(decoded.sections[0].kind).toBe('raw');
    expect(cc2Map(decoded)).toBeUndefined();
  });
});

describe('PACK compression', () => {
  it('expands overlapping copies', () => {
    // size 6: literal 'x', then copy 5 bytes from 1 back (run-length style overlap).
    const packed = Uint8Array.of(0x06, 0x00, 0x01, 0x78, 0x80 + 5, 0x01);
    expect(Array.from(unpackC2m(packed))).toEqual([0x78, 0x78, 0x78, 0x78, 0x78, 0x78]);
  });

  it('expands a copy that overlaps with an offset above one', () => {
    const packed = Uint8Array.of(0x07, 0x00, 0x02, 0x01, 0x02, 0x80 + 5, 0x02);
    expect(Array.from(unpackC2m(packed))).toEqual([1, 2, 1, 2, 1, 2, 1]);
  });

  it('round trips empty, tiny and run-only data', () => {
    for (const data of [new Uint8Array(0), Uint8Array.of(7), new Uint8Array(1000).fill(3)]) {
      expect(unpackC2m(packC2m(data))).toEqual(data);
    }
  });

  it('splits literal runs at the maximum run length', () => {
    const noise = pseudoRandomBytes(PACK_MAX_RUN * 3 + 5, 1);
    const packed = packC2m(noise);
    expect(unpackC2m(packed)).toEqual(noise);
    // No control byte may exceed the run limit when read as a literal length.
    let at = 2;
    while (at < packed.length) {
      const control = packed[at++];
      if (control < 0x80) {
        expect(control).toBeLessThanOrEqual(PACK_MAX_RUN);
        at += control;
      } else {
        at += 1;
      }
    }
  });

  it('emits back-references of maximum length and distance', () => {
    const block = pseudoRandomBytes(PACK_MAX_OFFSET, 2);
    const data = new Uint8Array(block.length * 2 + PACK_MAX_RUN);
    data.set(block, 0);
    data.set(block, block.length);
    data.set(block.subarray(0, PACK_MAX_RUN), block.length * 2);
    const packed = packC2m(data);
    expect(unpackC2m(packed)).toEqual(data);
    expect(packed.length).toBeLessThan(data.length);
  });

  it('is deterministic', () => {
    const data = pseudoRandomBytes(500, 3);
    expect(packC2m(data)).toEqual(packC2m(data));
  });

  it('rejects invalid blocks', () => {
    const codes = (bytes: number[]): string => {
      try {
        unpackC2m(Uint8Array.from(bytes));
      } catch (error) {
        return (error as C2mFormatError).code;
      }
      return 'none';
    };
    expect(codes([0x05])).toBe(C2M_ERROR_CODES.badPack); // no size field
    expect(codes([0x02, 0x00, 0x81, 0x01])).toBe(C2M_ERROR_CODES.badPack); // copy before any output
    expect(codes([0x02, 0x00, 0x01, 0x05, 0x81, 0x00])).toBe(C2M_ERROR_CODES.badPack); // offset zero
    expect(codes([0x01, 0x00, 0x02, 0x01, 0x02])).toBe(C2M_ERROR_CODES.badPack); // overrun
    expect(codes([0x03, 0x00, 0x01, 0x05])).toBe(C2M_ERROR_CODES.badPack); // size mismatch
    expect(codes([0x02, 0x00, 0x05, 0x01])).toBe(C2M_ERROR_CODES.badPack); // literal past end
  });

  it('refuses data too large for the size field', () => {
    expect(() => packC2m(new Uint8Array(0x10000))).toThrow(C2mFormatError);
  });
});

describe('map cells', () => {
  function roundTrip(tile: Cc2Tile, others: Cc2Tile[] = []): Cc2Tile[] {
    const closed = cc2TileInfo(tile.code)?.layer === Cc2Layer.Terrain;
    const map = mapOf(1, 1, () => cellOf(...others, tile, ...(closed ? [] : [{ code: FLOOR }])));
    const decoded = decodeC2mMapBytes(encodeC2mMapBytes(map));
    expect(decoded).toEqual(map);
    return decoded.cells[0].tiles;
  }

  it('writes a modifier before its tile for each width', () => {
    const cases: Array<[1 | 2 | 4, number, number]> = [
      [1, 0x35, CC2_MODIFIER_CODES.byte],
      [2, 0x0210, CC2_MODIFIER_CODES.word],
      [4, 0x01020304, CC2_MODIFIER_CODES.dword]
    ];
    for (const [width, value, code] of cases) {
      const tile: Cc2Tile = { code: width === 2 ? CC2_CODE_TRACK : WIRE_FLOOR, mod: value, modBytes: width };
      const map = mapOf(1, 1, () => cellOf(tile));
      const bytes = encodeC2mMapBytes(map);
      expect(bytes[2]).toBe(code);
      expect(bytes.length).toBe(2 + 1 + width + 1);
      expect(bytes[2 + 1 + width]).toBe(tile.code);
      expect(roundTrip(tile)[0]).toEqual(tile);
    }
  });

  it('keeps the wire and tunnel nibbles of a one-byte modifier', () => {
    const tile: Cc2Tile = { code: WIRE_FLOOR, mod: 0xa5, modBytes: 1 };
    expect(roundTrip(tile)[0].mod).toBe(0xa5);
  });

  it('round trips a thin wall with its flags', () => {
    const tile: Cc2Tile = { code: CC2_CODE_THIN_WALL, flags: 0x1f };
    const map = mapOf(1, 1, () => cellOf(tile, { code: FLOOR }));
    const bytes = encodeC2mMapBytes(map);
    expect(Array.from(bytes.subarray(2))).toEqual([CC2_CODE_THIN_WALL, 0x1f, FLOOR]);
    expect(decodeC2mMapBytes(bytes)).toEqual(map);
  });

  it('round trips a directional block with facing and arrows', () => {
    const tile: Cc2Tile = { code: CC2_CODE_DIRECTIONAL_BLOCK, dir: 1, arrows: 0x0a };
    const bytes = encodeC2mMapBytes(mapOf(1, 1, () => cellOf(tile, { code: FLOOR })));
    expect(Array.from(bytes.subarray(2))).toEqual([CC2_CODE_DIRECTIONAL_BLOCK, 1, 0x0a, FLOOR]);
    expect(roundTrip(tile)[0]).toEqual(tile);
  });

  it('gives actors a facing byte and items none', () => {
    const item = encodeC2mMapBytes(mapOf(1, 1, () => cellOf({ code: CC2_CODE_COMPUTER_CHIP }, { code: FLOOR })));
    const actor = encodeC2mMapBytes(mapOf(1, 1, () => cellOf({ code: CC2_CODE_PLAYER, dir: 3 }, { code: FLOOR })));
    expect(item.length).toBe(2 + 2);
    expect(actor.length).toBe(2 + 3);
    expect(cc2TileInfo(CC2_CODE_COMPUTER_CHIP)?.layer).toBe(Cc2Layer.Item);
    expect(cc2TileInfo(CC2_CODE_PLAYER)?.layer).toBe(Cc2Layer.Actor);
    expect(cc2TileInfo(CC2_CODE_NO_SIGN)?.layer).toBe(Cc2Layer.NoSign);
    expect(cc2TileInfo(CC2_CODE_THIN_WALL)?.layer).toBe(Cc2Layer.Panel);
    expect(cc2TileInfo(FLOOR)?.layer).toBe(Cc2Layer.Terrain);
  });

  it('decodes a full stack in the verified layer order', () => {
    const stack: Cc2Tile[] = [
      { code: CC2_CODE_COMPUTER_CHIP },
      { code: CC2_CODE_NO_SIGN },
      { code: CC2_CODE_THIN_WALL, flags: 2 },
      { code: CC2_CODE_PLAYER, dir: 0 },
      { code: WIRE_FLOOR, mod: 3, modBytes: 1 }
    ];
    const map = mapOf(2, 1, () => cellOf(...stack));
    const decoded = decodeC2mMapBytes(encodeC2mMapBytes(map));
    expect(decoded.cells).toHaveLength(2);
    expect(decoded.cells[0].tiles).toEqual(stack);
  });

  it('keeps bytes after the last cell', () => {
    const map = mapOf(1, 1, () => cellOf({ code: FLOOR }));
    map.tail = Uint8Array.of(1, 2, 3);
    expect(decodeC2mMapBytes(encodeC2mMapBytes(map))).toEqual(map);
  });

  it('keeps everything from an unknown code on, byte for byte', () => {
    const bytes = Uint8Array.of(2, 1, FLOOR, CC2_CODE_COMPUTER_CHIP, CODE_NOT_IN_TABLE, 7, 7, FLOOR);
    const map = decodeC2mMapBytes(bytes);
    expect(map.cells).toHaveLength(1);
    expect(map.unknown?.cellIndex).toBe(1);
    expect(map.unknown?.code).toBe(CODE_NOT_IN_TABLE);
    expect(map.unknown?.tiles).toEqual([{ code: CC2_CODE_COMPUTER_CHIP }]);
    expect(encodeC2mMapBytes(map)).toEqual(bytes);
  });

  it('treats a modifier stacked on a modifier as unknown and keeps its bytes', () => {
    const bytes = Uint8Array.of(1, 1, CC2_MODIFIER_CODES.byte, 1, CC2_MODIFIER_CODES.byte, 2, WIRE_FLOOR);
    const map = decodeC2mMapBytes(bytes);
    expect(map.unknown?.code).toBe(CC2_MODIFIER_CODES.byte);
    expect(encodeC2mMapBytes(map)).toEqual(bytes);
  });

  it('reports data that ends inside a cell', () => {
    const bytes = Uint8Array.of(2, 1, FLOOR);
    const map = decodeC2mMapBytes(bytes);
    expect(map.unknown?.cellIndex).toBe(1);
    expect(encodeC2mMapBytes(map)).toEqual(bytes);
  });

  it('refuses to encode a code absent from the table', () => {
    expect(() => encodeC2mMapBytes(mapOf(1, 1, () => cellOf({ code: CODE_NOT_IN_TABLE })))).toThrow(C2mFormatError);
  });

  it('has unique confirmed names and a name for every code', () => {
    const confirmed = cc2KnownCodes().map((c) => cc2TileInfo(c)).filter((i) => i?.confirmed);
    const names = confirmed.map((i) => i?.name);
    expect(new Set(names).size).toBe(names.length);
    expect(cc2TileInfo(0x46)?.name).toBe('Random Force Floor');
    for (const code of cc2KnownCodes()) expect(cc2TileInfo(code)?.name.length).toBeGreaterThan(0);
  });

  it('rejects a section tag that is not four characters', () => {
    const bad: Cc2File = { sections: [{ kind: 'raw', tag: 'ABC', data: emptyTail() }], trailing: emptyTail() };
    expect(() => encodeC2m(bad)).toThrow(C2mFormatError);
  });

  it('has a consistent table', () => {
    const codes = cc2KnownCodes();
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) {
      const info = cc2TileInfo(code);
      expect(info?.code).toBe(code);
      expect([CC2_MODIFIER_CODES.byte, CC2_MODIFIER_CODES.word, CC2_MODIFIER_CODES.dword]).not.toContain(code);
    }
  });
});

describe('text', () => {
  it('round trips Windows-1252 text including the 0x80..0x9f block', () => {
    const text = 'caf\u00e9 \u20ac \u201cquoted\u201d \u2026 \u0081';
    expect(decodeWindows1252(encodeWindows1252(text))).toBe(text);
    expect(encodeWindows1252('€')[0]).toBe(0x80);
  });

  it('replaces characters Windows-1252 cannot hold', () => {
    expect(Array.from(encodeWindows1252('a中b'))).toEqual([0x61, 0x3f, 0x62]);
  });

  it('keeps unterminated text and bytes after the terminator', () => {
    const file: Cc2File = {
      sections: [
        { kind: 'text', tag: C2M_TAGS.title, text: 'no end', terminated: false, extra: emptyTail() },
        { kind: 'text', tag: C2M_TAGS.note, text: 'abc', terminated: true, extra: Uint8Array.of(0x41, 0x00) },
        endSection()
      ],
      trailing: emptyTail()
    };
    expect(decodeC2m(encodeC2m(file))).toEqual(file);
  });

  it('decodes accented text from file bytes', () => {
    const file: Cc2File = { sections: [textSection(C2M_TAGS.title, 'Café'), endSection()], trailing: emptyTail() };
    const bytes = encodeC2m(file);
    expect(bytes[8 + 3]).toBe(0xe9);
    expect(cc2Text(decodeC2m(bytes), C2M_TAGS.title)).toBe('Café');
  });
});

describe('options', () => {
  it('parses a short block without failing', () => {
    expect(parseCc2Options(Uint8Array.of(5))).toEqual({ timeLimit: 0, flags: [] });
    expect(parseCc2Options(Uint8Array.of(0xe7, 0x03, 1))).toEqual({ timeLimit: 999, flags: [1] });
  });
});
