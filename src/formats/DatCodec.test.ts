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

import { beforeEach, describe, expect, it } from 'vitest';
import { DatCodec, datRefusalReason } from './DatCodec';
import { ConfigBundle, ConfigRegistry } from '../config/ConfigRegistry';
import { findDatFormatErrors } from '../config/ConfigValidation';
import { CompiledLevel } from '../core/types';
import { loadTestConfigs } from '../test/loadTestConfigs';

const PREFIX = 'test';

function blankLevel(number: number): CompiledLevel {
  const { mapWidth, mapHeight } = ConfigRegistry.getGame().grid;
  const terrain = Array.from({ length: mapHeight }, (_, y) =>
    Array.from({ length: mapWidth }, (_, x) =>
      x === 0 || y === 0 || x === mapWidth - 1 || y === mapHeight - 1 ? 'wall' : 'floor'
    )
  );
  const items: (string | null)[][] = Array.from({ length: mapHeight }, () =>
    Array.from({ length: mapWidth }, () => null)
  );
  return {
    id: `${PREFIX}_level_${number}`,
    number,
    customTitle: `Room ${number}`,
    customHint: '',
    password: 'ABCD',
    timeLimitSeconds: 150,
    chipsRequired: 0,
    playerStart: { x: 2, y: 2, dir: 'S' },
    terrain,
    items,
    entities: [],
    trapLinks: [],
    cloneLinks: []
  };
}

function richLevel(number: number): CompiledLevel {
  const lvl = blankLevel(number);
  lvl.customHint = 'Mind the bug';
  lvl.chipsRequired = 2;
  lvl.items[3][3] = 'chip';
  lvl.items[3][4] = 'chip';
  lvl.items[5][5] = 'key_red';
  lvl.terrain[6][6] = 'door_red';
  lvl.terrain[7][7] = 'exit';
  lvl.terrain[8][8] = 'water';
  lvl.terrain[9][3] = 'button_brown';
  lvl.terrain[9][5] = 'trap';
  lvl.terrain[10][3] = 'button_red';
  lvl.terrain[10][6] = 'clone_machine';
  lvl.entities = [
    { x: 12, y: 12, type: 'bug', dir: 'E' },
    { x: 14, y: 4, type: 'dirt_block', dir: 'S' },
    { x: 6, y: 10, type: 'dirt_block', dir: 'S' }
  ];
  lvl.trapLinks = [{ buttonX: 3, buttonY: 9, trapX: 5, trapY: 9 }];
  lvl.cloneLinks = [
    { buttonX: 3, buttonY: 10, clonerX: 6, clonerY: 10, templateType: 'dirt_block', templateDir: 'S' }
  ];
  return lvl;
}

function toBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** Builds a pack header followed by raw level records. */
function rawPack(levelCount: number, ...records: Uint8Array[]): ArrayBuffer {
  const total = 6 + records.reduce((s, r) => s + r.length, 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, ConfigRegistry.getDatFormat().defaultMagicHeader, true);
  view.setUint16(4, levelCount, true);
  let pos = 6;
  for (const r of records) {
    out.set(r, pos);
    pos += r.length;
  }
  return out.buffer;
}

/** Extracts the first level record (length word included) from an encoded pack. */
function firstRecord(encoded: Uint8Array): Uint8Array {
  const view = new DataView(encoded.buffer, encoded.byteOffset);
  const len = view.getUint16(6, true);
  return encoded.slice(6, 6 + 2 + len);
}

describe('DatCodec round trip', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('preserves every field of the encoded levels', () => {
    const source = [richLevel(1), blankLevel(2)];
    const decoded = DatCodec.decodeBuffer(toBuffer(DatCodec.encodeLevels(source)), PREFIX);

    expect(decoded).toHaveLength(2);
    for (let i = 0; i < source.length; i++) {
      const a = source[i];
      const b = decoded[i];
      expect(b.id).toBe(a.id);
      expect(b.number).toBe(a.number);
      expect(b.customTitle).toBe(a.customTitle);
      expect(b.customHint).toBe(a.customHint);
      expect(b.password).toBe(a.password);
      expect(b.timeLimitSeconds).toBe(a.timeLimitSeconds);
      expect(b.chipsRequired).toBe(a.chipsRequired);
      expect(b.playerStart).toEqual(a.playerStart);
      expect(b.terrain).toEqual(a.terrain);
      expect(b.items).toEqual(a.items);
      expect(b.trapLinks).toEqual(a.trapLinks);
      expect(b.cloneLinks).toEqual(a.cloneLinks);
      const sortKey = (e: { x: number; y: number }) => e.y * 100 + e.x;
      expect([...b.entities].sort((p, q) => sortKey(p) - sortKey(q))).toEqual(
        [...a.entities].sort((p, q) => sortKey(p) - sortKey(q))
      );
    }
  });

  it('writes a level length that matches the record exactly', () => {
    const encoded = DatCodec.encodeLevels([richLevel(1)]);
    const view = new DataView(encoded.buffer);
    const recordLen = view.getUint16(6, true);
    let pos = 8 + 8;
    const layer1 = view.getUint16(pos, true);
    pos += 2 + layer1;
    const layer2 = view.getUint16(pos, true);
    pos += 2 + layer2;
    const optional = view.getUint16(pos, true);
    pos += 2 + optional;
    expect(pos).toBe(8 + recordLen);
    expect(encoded.length).toBe(8 + recordLen);
  });

  it('replaces non-ASCII characters instead of mangling them', () => {
    const lvl = blankLevel(1);
    lvl.customTitle = 'Été à Noël';
    const [decoded] = DatCodec.decodeBuffer(toBuffer(DatCodec.encodeLevels([lvl])), PREFIX);
    expect(decoded.customTitle).toBe('?t? ? No?l');
  });

  it('truncates oversized optional fields to whole records', () => {
    const lvl = blankLevel(1);
    lvl.customHint = 'still readable';
    for (let i = 0; i < 40; i++) {
      lvl.trapLinks.push({ buttonX: 1 + (i % 30), buttonY: 1, trapX: 1 + (i % 30), trapY: 2 });
      lvl.cloneLinks.push({
        buttonX: 1 + (i % 30),
        buttonY: 3,
        clonerX: 1 + (i % 30),
        clonerY: 4,
        templateType: 'dirt_block',
        templateDir: 'S'
      });
    }
    for (let i = 0; i < 200; i++) {
      lvl.entities.push({ x: 1 + (i % 30), y: 5 + Math.floor(i / 30), type: 'bug', dir: 'N' });
    }
    const [decoded] = DatCodec.decodeBuffer(toBuffer(DatCodec.encodeLevels([lvl])), PREFIX);
    expect(decoded.trapLinks).toHaveLength(Math.floor(255 / 10));
    expect(decoded.cloneLinks).toHaveLength(Math.floor(255 / 8));
    expect(decoded.customHint).toBe('still readable');
    expect(decoded.entities).toHaveLength(200);
  });
});

describe('DatCodec tiles without a byte code', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('writes floor for an unmapped terrain, drops an unmapped item and reports both', () => {
    const lvl = blankLevel(1);
    lvl.terrain[3][3] = 'turtle';
    lvl.terrain[4][4] = 'thin_wall_nesw';
    lvl.terrain[5][5] = 'teleport_red';
    lvl.terrain[5][7] = 'teleport_red';
    lvl.terrain[8][8] = 'forbid_key_red';
    lvl.items[6][6] = 'score_100';
    lvl.items[7][7] = 'chip';
    const encoded = DatCodec.encodeLevelsWithReport([lvl]);
    expect(encoded.replaced).toEqual(['teleport_red']);
    expect(encoded.lost.sort()).toEqual(['forbid_key_red', 'score_100', 'thin_wall_nesw', 'turtle']);
    const decoded = DatCodec.decodeBuffer(toBuffer(encoded.bytes), PREFIX);
    expect(decoded).toHaveLength(1);
    expect(decoded[0].terrain[3][3]).toBe('floor');
    expect(decoded[0].terrain[4][4]).toBe('floor');
    expect(decoded[0].terrain[5][5]).toBe('teleport');
    expect(decoded[0].terrain[5][7]).toBe('teleport');
    expect(decoded[0].terrain[8][8]).toBe('floor');
    expect(decoded[0].items[6][6]).toBeNull();
    expect(decoded[0].items[7][7]).toBe('chip');
  });

  it('reports an exact export as exact', () => {
    const encoded = DatCodec.encodeLevelsWithReport([richLevel(1)]);
    expect(encoded.replaced).toEqual([]);
    expect(encoded.lost).toEqual([]);
    expect(encoded.bytes).toEqual(DatCodec.encodeLevels([richLevel(1)]));
  });
});

describe('DatCodec malformed input', () => {
  let bundle: ConfigBundle;

  beforeEach(() => {
    bundle = loadTestConfigs();
  });

  it('rejects a buffer shorter than the pack header', () => {
    expect(() => DatCodec.decodeBuffer(new ArrayBuffer(3))).toThrow();
  });

  it('keeps the complete levels of a truncated pack', () => {
    const encoded = DatCodec.encodeLevels([richLevel(1), richLevel(2)]);
    const firstLen = firstRecord(encoded).length;
    const cut = encoded.slice(0, 6 + firstLen + 20);
    expect(DatCodec.decodeBuffer(toBuffer(cut), PREFIX)).toHaveLength(1);
    expect(DatCodec.decodeBuffer(toBuffer(encoded.slice(0, 12)), PREFIX)).toHaveLength(0);
  });

  it('skips a zero-length record and decodes the next one', () => {
    const valid = firstRecord(DatCodec.encodeLevels([richLevel(3)]));
    const decoded = DatCodec.decodeBuffer(rawPack(2, new Uint8Array([0, 0]), valid), PREFIX);
    expect(decoded).toHaveLength(1);
    expect(decoded[0].number).toBe(3);
  });

  it('skips a record whose layer length runs past its end', () => {
    const broken = new Uint8Array(2 + 14);
    const view = new DataView(broken.buffer);
    view.setUint16(0, 14, true);
    view.setUint16(2 + 8, 5000, true);
    const valid = firstRecord(DatCodec.encodeLevels([blankLevel(4)]));
    const decoded = DatCodec.decodeBuffer(rawPack(2, broken, valid), PREFIX);
    expect(decoded.map((l) => l.number)).toEqual([4]);
  });

  it('does not trust a huge level count', () => {
    const valid = firstRecord(DatCodec.encodeLevels([blankLevel(1)]));
    expect(DatCodec.decodeBuffer(rawPack(0xffff, valid), PREFIX)).toHaveLength(1);

    bundle.datFormat.maxLevelCount = 1;
    const three = DatCodec.encodeLevels([blankLevel(1), blankLevel(2), blankLevel(3)]);
    expect(DatCodec.decodeBuffer(toBuffer(three), PREFIX)).toHaveLength(1);
  });

  it('round-trips with a layer wider than the grid, using the layer width as stride', () => {
    const { mapWidth, mapHeight } = ConfigRegistry.getGame().grid;
    bundle.datFormat.layerWidth = mapWidth + 4;
    bundle.datFormat.layerHeight = mapHeight;
    bundle.datFormat.layerByteLength = (mapWidth + 4) * mapHeight;
    const encoded = DatCodec.encodeLevels([richLevel(1)]);
    const [decoded] = DatCodec.decodeBuffer(toBuffer(encoded), PREFIX);
    expect(decoded.terrain[7][7]).toBe('exit');
  });

  it('rejects a layer smaller than its declared dimensions', () => {
    const grid = ConfigRegistry.getGame().grid;
    expect(findDatFormatErrors(bundle.datFormat, grid)).toEqual([]);
    expect(findDatFormatErrors({ ...bundle.datFormat, layerByteLength: 100 }, grid)).toHaveLength(1);
  });

  it('ignores layer cells beyond the grid', () => {
    bundle.datFormat.layerByteLength = 4096;
    const encoded = DatCodec.encodeLevels([richLevel(1)]);
    const [decoded] = DatCodec.decodeBuffer(toBuffer(encoded), PREFIX);
    expect(decoded.terrain).toHaveLength(ConfigRegistry.getGame().grid.mapHeight);
    expect(decoded.terrain[7][7]).toBe('exit');
  });
});

/** CCLP 1, inlined by Vite as a base64 data URL so the test needs no file system access. */
const CCLP1_DATA_URL = Object.values(
  import.meta.glob('../../public/packs/CCLP1.DAT', { query: '?inline', import: 'default', eager: true })
)[0] as string;
/** Share of a corner's open sides that face walkable cells in a real, playable pack. */
const MIN_OPEN_SIDE_WALKABLE_RATE = 0.9;

describe('DatCodec ice corners', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('decodes ice corners with their open sides facing playable cells', () => {
    const base64 = CCLP1_DATA_URL.slice(CCLP1_DATA_URL.indexOf(',') + 1);
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const levels = DatCodec.decodeBuffer(bytes.buffer, 'cclp1');
    let openSides = 0;
    let walkableOpenSides = 0;
    for (const level of levels) {
      level.terrain.forEach((row, y) =>
        row.forEach((id, x) => {
          const tile = ConfigRegistry.getTile(id);
          if (tile.slideType !== 'ice' || !tile.blockedEntryDirections) return;
          // A corner is entered through its open sides: moving N into it means coming from the south.
          const openToward = (['N', 'E', 'S', 'W'] as const).filter(
            (d) => !tile.blockedEntryDirections!.includes(({ N: 'S', S: 'N', E: 'W', W: 'E' } as const)[d])
          );
          for (const d of openToward) {
            const nx = x + (d === 'E' ? 1 : d === 'W' ? -1 : 0);
            const ny = y + (d === 'S' ? 1 : d === 'N' ? -1 : 0);
            if (ny < 0 || ny >= level.terrain.length || nx < 0 || nx >= row.length) continue;
            openSides++;
            if (ConfigRegistry.getTile(level.terrain[ny][nx]).passableByPlayer) walkableOpenSides++;
          }
        })
      );
    }
    expect(openSides).toBeGreaterThan(0);
    expect(walkableOpenSides / openSides).toBeGreaterThan(MIN_OPEN_SIDE_WALKABLE_RATE);
  });
});

/** Decompresses the first layer of the first record of an encoded single-level pack. */
function firstLayer1(encoded: Uint8Array): Uint8Array {
  const datCfg = ConfigRegistry.getDatFormat();
  const layer1LengthOffset = 6 + 2 + 8;
  const view = new DataView(encoded.buffer, encoded.byteOffset);
  const compressedLength = view.getUint16(layer1LengthOffset, true);
  const compressed = encoded.subarray(layer1LengthOffset + 2, layer1LengthOffset + 2 + compressedLength);
  const out: number[] = [];
  for (let i = 0; i < compressed.length; ) {
    if (compressed[i] === datCfg.rleMarkerByte) {
      for (let c = 0; c < compressed[i + 1]; c++) out.push(compressed[i + 2]);
      i += 3;
    } else {
      out.push(compressed[i++]);
    }
  }
  return Uint8Array.from(out);
}

describe('DatCodec duplicate level numbers', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('gives distinct ids to levels that share a number, keeping the first id and the number', () => {
    const encoded = DatCodec.encodeLevels([blankLevel(5), blankLevel(5), blankLevel(7), blankLevel(5)]);
    const decoded = DatCodec.decodeBuffer(toBuffer(encoded), PREFIX);
    const ids = decoded.map((l) => l.id);
    expect(new Set(ids).size).toBe(4);
    expect(ids[0]).toBe(`${PREFIX}_level_5`);
    expect(ids[2]).toBe(`${PREFIX}_level_7`);
    expect(decoded.map((l) => l.number)).toEqual([5, 5, 7, 5]);
  });

  it('keeps the plain ids of a pack whose numbers are unique', () => {
    const encoded = DatCodec.encodeLevels([blankLevel(1), blankLevel(2), blankLevel(3)]);
    const ids = DatCodec.decodeBuffer(toBuffer(encoded), PREFIX).map((l) => l.id);
    expect(ids).toEqual([1, 2, 3].map((n) => `${PREFIX}_level_${n}`));
  });
});

describe('DatCodec export fidelity', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it.each([
    ['N', 14],
    ['W', 15],
    ['S', 16],
    ['E', 17]
  ] as const)('writes the cloner template byte for a block facing %s on a clone machine', (dir, byte) => {
    const lvl = blankLevel(1);
    lvl.terrain[10][6] = 'clone_machine';
    lvl.entities = [{ x: 6, y: 10, type: 'dirt_block', dir }];
    lvl.cloneLinks = [
      { buttonX: 3, buttonY: 10, clonerX: 6, clonerY: 10, templateType: 'dirt_block', templateDir: dir }
    ];
    const encoded = DatCodec.encodeLevelsWithReport([lvl]);
    const { mapWidth } = ConfigRegistry.getGame().grid;
    expect(firstLayer1(encoded.bytes)[10 * mapWidth + 6]).toBe(byte);
    expect(encoded.lost).toEqual([]);

    const [decoded] = DatCodec.decodeBuffer(toBuffer(encoded.bytes), PREFIX);
    expect(decoded.terrain[10][6]).toBe('clone_machine');
    expect(decoded.entities).toContainEqual({ x: 6, y: 10, type: 'dirt_block', dir });
    expect(decoded.cloneLinks[0].templateDir).toBe(dir);
  });

  it('writes the plain block byte for a block that is not on a clone machine', () => {
    const lvl = blankLevel(1);
    lvl.entities = [{ x: 6, y: 10, type: 'dirt_block', dir: 'N' }];
    const { mapWidth } = ConfigRegistry.getGame().grid;
    expect(firstLayer1(DatCodec.encodeLevels([lvl]))[10 * mapWidth + 6]).not.toBe(14);
  });

  it('closes a level smaller than the format with wall and reports the padding', () => {
    const lvl = blankLevel(1);
    lvl.terrain = [
      ['wall', 'wall', 'wall', 'wall', 'wall'],
      ['wall', 'floor', 'floor', 'floor', 'wall'],
      ['wall', 'wall', 'wall', 'wall', 'wall']
    ];
    lvl.items = lvl.terrain.map((row) => row.map(() => null));
    lvl.playerStart = { x: 1, y: 1, dir: 'S' };
    const encoded = DatCodec.encodeLevelsWithReport([lvl]);
    expect(encoded.padded).toEqual([lvl.id]);
    expect(encoded.refused).toEqual([]);

    const [decoded] = DatCodec.decodeBuffer(toBuffer(encoded.bytes), PREFIX);
    expect(decoded.terrain[1][2]).toBe('floor');
    expect(decoded.terrain[1][5]).toBe('wall');
    expect(decoded.terrain[3][0]).toBe('wall');
    expect(decoded.terrain[31][31]).toBe('wall');
    expect(decoded.playerStart).toEqual({ x: 1, y: 1, dir: 'S' });
  });

  it('does not report padding for a full size level', () => {
    expect(DatCodec.encodeLevelsWithReport([blankLevel(1)]).padded).toEqual([]);
  });

  it('refuses a level larger than the format and keeps the others', () => {
    const big = blankLevel(1);
    big.terrain = Array.from({ length: 33 }, () => Array.from({ length: 33 }, () => 'floor'));
    const encoded = DatCodec.encodeLevelsWithReport([big, blankLevel(2)]);
    expect(encoded.refused).toEqual([{ levelId: big.id, reason: 'too_large' }]);
    expect(encoded.levelCount).toBe(1);
    const decoded = DatCodec.decodeBuffer(toBuffer(encoded.bytes), PREFIX);
    expect(decoded.map((l) => l.number)).toEqual([2]);
  });

  it('refuses a level whose player start is out of range', () => {
    const lvl = blankLevel(1);
    lvl.playerStart = { x: 40, y: 2, dir: 'S' };
    const encoded = DatCodec.encodeLevelsWithReport([lvl]);
    expect(encoded.refused).toEqual([{ levelId: lvl.id, reason: 'player_out_of_range' }]);
    expect(encoded.levelCount).toBe(0);
  });

  it('names the refusal reason of a level without encoding it', () => {
    const big = blankLevel(1);
    big.terrain = Array.from({ length: 33 }, () => Array.from({ length: 33 }, () => 'floor'));
    const outside = blankLevel(2);
    outside.playerStart = { x: 40, y: 2, dir: 'S' };
    const targets = { ...blankLevel(3), winRule: 'targets' as const };
    expect(datRefusalReason(blankLevel(4))).toBeNull();
    expect(datRefusalReason(big)).toBe('too_large');
    expect(datRefusalReason(outside)).toBe('player_out_of_range');
    expect(datRefusalReason(targets)).toBe('targets_win_rule');
  });

  it('reports what a stacked cell cannot hold', () => {
    const lvl = blankLevel(1);
    // player start (2,2) over a bug and a chip: the bug is dropped, so is the fire under them
    lvl.terrain[2][2] = 'fire';
    lvl.items[2][2] = 'chip';
    // bug and chip on water: the water is covered
    lvl.terrain[4][4] = 'water';
    lvl.items[4][4] = 'chip';
    lvl.entities = [
      { x: 2, y: 2, type: 'bug', dir: 'E' },
      { x: 4, y: 4, type: 'bug', dir: 'E' }
    ];
    const encoded = DatCodec.encodeLevelsWithReport([lvl]);
    expect(encoded.lost.sort()).toEqual(['bug', 'fire', 'water']);
  });
});

/** Every bundled pack, inlined by Vite as base64 data URLs. */
const BUNDLED_PACK_URLS = Object.values(
  import.meta.glob('../../public/packs/*.DAT', { query: '?inline', import: 'default', eager: true })
) as string[];

describe('DatCodec bundled pack ids', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('keeps the plain id of every level of every bundled pack', () => {
    expect(BUNDLED_PACK_URLS.length).toBeGreaterThan(0);
    for (const url of BUNDLED_PACK_URLS) {
      const bytes = Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), (c) => c.charCodeAt(0));
      const levels = DatCodec.decodeBuffer(bytes.buffer, PREFIX);
      expect(levels.length).toBeGreaterThan(0);
      levels.forEach((level, idx) => {
        expect(level.id).toBe(`${PREFIX}_level_${level.number || idx + 1}`);
      });
    }
  });
});
