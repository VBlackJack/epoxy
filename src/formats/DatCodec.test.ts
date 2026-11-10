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
import { DEFAULT_RULESET } from '../core/coreConstants';
import { CompiledLevel, Direction } from '../core/types';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { documentFromLevel, levelFromDocument } from '../editor/editorLevelIo';
import { withEditedMap } from '../editor/editorDocument';
import { paintTerrain } from '../editor/mapEdits';

const PREFIX = 'test';
/** CCLP 2, inlined by Vite as a base64 data URL so the test needs no file system access. */
const CCLP2_DATA_URL = Object.values(
  import.meta.glob('../../public/packs/CCLP2.DAT', { query: '?inline', import: 'default', eager: true })
)[0] as string;
/** Codes 0x33-0x38 are the unused wall (0x33-0x35) and invisible wall (0x36-0x38) codes; the bundled pack holds some. */
const UNUSED_CODE_FIRST = 0x33;
const UNUSED_WALL_LAST = 0x35;
const UNUSED_CODE_LAST = 0x38;
const CCLP2_UNUSED_CODE_LEVELS = [71, 98, 127];
/** Pack header (magic and level count) and the level record length word that precede the first layer length. */
const PACK_HEADER_BYTES = 6;
const RECORD_HEADER_BYTES = 10;

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

/** Pack header: magic number plus level count. */
const TEST_PACK_HEADER_BYTES = 6;
/** Level record: length word, then number, time limit, chips and map detail words. */
const TEST_RECORD_FIXED_BYTES = 2 + 4 * 2;

/** Lists the field codes of the optional block of the first level in an encoded pack. */
function optionalFieldCodes(pack: Uint8Array): number[] {
  const view = new DataView(pack.buffer, pack.byteOffset, pack.byteLength);
  const recordEnd = TEST_PACK_HEADER_BYTES + 2 + view.getUint16(TEST_PACK_HEADER_BYTES, true);
  let pos = TEST_PACK_HEADER_BYTES + TEST_RECORD_FIXED_BYTES;
  for (let layer = 0; layer < 2; layer++) {
    pos += 2 + view.getUint16(pos, true);
  }
  const optionalEnd = pos + 2 + view.getUint16(pos, true);
  expect(optionalEnd).toBeLessThanOrEqual(recordEnd);
  pos += 2;
  const codes: number[] = [];
  while (pos < optionalEnd) {
    codes.push(pack[pos]);
    pos += 2 + pack[pos + 1];
  }
  return codes;
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
    const decoded = DatCodec.decodeBuffer(toBuffer(DatCodec.encodeLevels(source)), PREFIX, DEFAULT_RULESET);

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
    const [decoded] = DatCodec.decodeBuffer(toBuffer(DatCodec.encodeLevels([lvl])), PREFIX, DEFAULT_RULESET);
    expect(decoded.customTitle).toBe('?t? ? No?l');
  });

  it('round-trips an ASCII level author', () => {
    const lvl = blankLevel(1);
    lvl.author = 'Tyler Sontag';
    const encoded = DatCodec.encodeLevels([lvl]);
    expect(optionalFieldCodes(encoded)).toContain(ConfigRegistry.getDatFormat().fieldCodes.author);
    const [decoded] = DatCodec.decodeBuffer(toBuffer(encoded), PREFIX, DEFAULT_RULESET);
    expect(decoded.author).toBe('Tyler Sontag');
  });

  it('writes no author field when the level has none', () => {
    const encoded = DatCodec.encodeLevels([blankLevel(1)]);
    expect(optionalFieldCodes(encoded)).not.toContain(ConfigRegistry.getDatFormat().fieldCodes.author);
    const [decoded] = DatCodec.decodeBuffer(toBuffer(encoded), PREFIX, DEFAULT_RULESET);
    expect('author' in decoded).toBe(false);
  });

  it('replaces non-ASCII characters of an author like those of a title', () => {
    const lvl = blankLevel(1);
    lvl.author = 'Rock Généreux';
    const [decoded] = DatCodec.decodeBuffer(toBuffer(DatCodec.encodeLevels([lvl])), PREFIX, DEFAULT_RULESET);
    expect(decoded.author).toBe('Rock G?n?reux');
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
    const [decoded] = DatCodec.decodeBuffer(toBuffer(DatCodec.encodeLevels([lvl])), PREFIX, DEFAULT_RULESET);
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
    const decoded = DatCodec.decodeBuffer(toBuffer(encoded.bytes), PREFIX, DEFAULT_RULESET);
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
    expect(() => DatCodec.decodeBuffer(new ArrayBuffer(3), PREFIX, DEFAULT_RULESET)).toThrow();
  });

  it('keeps the complete levels of a truncated pack', () => {
    const encoded = DatCodec.encodeLevels([richLevel(1), richLevel(2)]);
    const firstLen = firstRecord(encoded).length;
    const cut = encoded.slice(0, 6 + firstLen + 20);
    expect(DatCodec.decodeBuffer(toBuffer(cut), PREFIX, DEFAULT_RULESET)).toHaveLength(1);
    expect(DatCodec.decodeBuffer(toBuffer(encoded.slice(0, 12)), PREFIX, DEFAULT_RULESET)).toHaveLength(0);
  });

  it('skips a zero-length record and decodes the next one', () => {
    const valid = firstRecord(DatCodec.encodeLevels([richLevel(3)]));
    const decoded = DatCodec.decodeBuffer(rawPack(2, new Uint8Array([0, 0]), valid), PREFIX, DEFAULT_RULESET);
    expect(decoded).toHaveLength(1);
    expect(decoded[0].number).toBe(3);
  });

  it('skips a record whose layer length runs past its end', () => {
    const broken = new Uint8Array(2 + 14);
    const view = new DataView(broken.buffer);
    view.setUint16(0, 14, true);
    view.setUint16(2 + 8, 5000, true);
    const valid = firstRecord(DatCodec.encodeLevels([blankLevel(4)]));
    const decoded = DatCodec.decodeBuffer(rawPack(2, broken, valid), PREFIX, DEFAULT_RULESET);
    expect(decoded.map((l) => l.number)).toEqual([4]);
  });

  it('does not trust a huge level count', () => {
    const valid = firstRecord(DatCodec.encodeLevels([blankLevel(1)]));
    expect(DatCodec.decodeBuffer(rawPack(0xffff, valid), PREFIX, DEFAULT_RULESET)).toHaveLength(1);

    bundle.datFormat.maxLevelCount = 1;
    const three = DatCodec.encodeLevels([blankLevel(1), blankLevel(2), blankLevel(3)]);
    expect(DatCodec.decodeBuffer(toBuffer(three), PREFIX, DEFAULT_RULESET)).toHaveLength(1);
  });

  it('round-trips with a layer wider than the grid, using the layer width as stride', () => {
    const { mapWidth, mapHeight } = ConfigRegistry.getGame().grid;
    bundle.datFormat.layerWidth = mapWidth + 4;
    bundle.datFormat.layerHeight = mapHeight;
    bundle.datFormat.layerByteLength = (mapWidth + 4) * mapHeight;
    const encoded = DatCodec.encodeLevels([richLevel(1)]);
    const [decoded] = DatCodec.decodeBuffer(toBuffer(encoded), PREFIX, DEFAULT_RULESET);
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
    const [decoded] = DatCodec.decodeBuffer(toBuffer(encoded), PREFIX, DEFAULT_RULESET);
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
    const levels = DatCodec.decodeBuffer(bytes.buffer, 'cclp1', DEFAULT_RULESET);
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
    const decoded = DatCodec.decodeBuffer(toBuffer(encoded), PREFIX, DEFAULT_RULESET);
    const ids = decoded.map((l) => l.id);
    expect(new Set(ids).size).toBe(4);
    expect(ids[0]).toBe(`${PREFIX}_level_5`);
    expect(ids[2]).toBe(`${PREFIX}_level_7`);
    expect(decoded.map((l) => l.number)).toEqual([5, 5, 7, 5]);
  });

  it('keeps the plain ids of a pack whose numbers are unique', () => {
    const encoded = DatCodec.encodeLevels([blankLevel(1), blankLevel(2), blankLevel(3)]);
    const ids = DatCodec.decodeBuffer(toBuffer(encoded), PREFIX, DEFAULT_RULESET).map((l) => l.id);
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

    const [decoded] = DatCodec.decodeBuffer(toBuffer(encoded.bytes), PREFIX, DEFAULT_RULESET);
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

    const [decoded] = DatCodec.decodeBuffer(toBuffer(encoded.bytes), PREFIX, DEFAULT_RULESET);
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
    const decoded = DatCodec.decodeBuffer(toBuffer(encoded.bytes), PREFIX, DEFAULT_RULESET);
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

  it('refuses a CC3D level, by its ruleset or by its cc3d data, and the pack encoder leaves it out', () => {
    const byRuleset = { ...blankLevel(1), ruleset: 'cc3d' as const };
    const byData = { ...blankLevel(2), cc3d: { width: 1, height: 1, cells: [], mobs: [], player: { x: 0, y: 0 } } };
    expect(datRefusalReason(byRuleset)).toBe('cc3d_ruleset');
    expect(datRefusalReason(byData)).toBe('cc3d_ruleset');
    const encoded = DatCodec.encodeLevelsWithReport([byRuleset, blankLevel(3)]);
    expect(encoded.refused).toEqual([{ levelId: byRuleset.id, reason: 'cc3d_ruleset' }]);
    expect(encoded.levelCount).toBe(1);
  });

  it('refuses a receivers level and any level with laser tiles or mirrors', () => {
    const receivers = { ...blankLevel(1), winRule: 'receivers' as const };
    const emitter = blankLevel(2);
    emitter.terrain[3][3] = 'laser_emitter_e';
    const gate = blankLevel(3);
    gate.terrain[3][3] = 'laser_gate_red_closed';
    const mirror = blankLevel(4);
    mirror.entities = [{ type: 'mirror_slash', x: 3, y: 3, dir: 'S' }];
    // A turret fires a beam the format cannot hold: it would be written as a plain block.
    const turretLevel = blankLevel(6);
    turretLevel.entities = [{ type: 'turret_cw', x: 3, y: 3, dir: 'S' }];
    expect(datRefusalReason(receivers)).toBe('receivers_win_rule');
    expect(datRefusalReason(emitter)).toBe('laser_content');
    expect(datRefusalReason(gate)).toBe('laser_content');
    expect(datRefusalReason(mirror)).toBe('laser_content');
    expect(datRefusalReason(turretLevel)).toBe('laser_content');
    const encoded = DatCodec.encodeLevelsWithReport([emitter, mirror, blankLevel(5)]);
    expect(encoded.refused.map((r) => r.reason)).toEqual(['laser_content', 'laser_content']);
    expect(encoded.levelCount).toBe(1);
  });

  it('refuses any level with colour channel tiles or colour blocks', () => {
    const plate = blankLevel(1);
    plate.terrain[3][3] = 'pressure_plate_red';
    const door = blankLevel(2);
    door.terrain[3][3] = 'hold_door_blue_closed';
    const wall = blankLevel(3);
    wall.terrain[3][3] = 'toggle_wall_yellow_open';
    const block = blankLevel(4);
    block.entities = [{ type: 'color_block_green', x: 3, y: 3, dir: 'S' }];
    for (const level of [plate, door, wall, block]) {
      expect(datRefusalReason(level)).toBe('color_channel_content');
    }
    const encoded = DatCodec.encodeLevelsWithReport([plate, block, blankLevel(5)]);
    expect(encoded.refused.map((r) => r.reason)).toEqual(['color_channel_content', 'color_channel_content']);
    expect(encoded.levelCount).toBe(1);
  });

  it('refuses a level with cell edges and leaves it out of the pack', () => {
    const edged = { ...blankLevel(1), cellEdges: [{ x: 3, y: 3, sides: ['N' as const] }] };
    expect(datRefusalReason(edged)).toBe('cell_edges');
    expect(datRefusalReason({ ...blankLevel(2), cellEdges: [] })).toBeNull();
    const encoded = DatCodec.encodeLevelsWithReport([edged, blankLevel(2)]);
    expect(encoded.refused.map((r) => r.reason)).toEqual(['cell_edges']);
    expect(encoded.levelCount).toBe(1);
  });

  it('refuses a level that holds a slow-time charm and leaves it out of the pack', () => {
    const charmed = blankLevel(1);
    charmed.items[3][3] = 'slow_time';
    expect(datRefusalReason(charmed)).toBe('epoxy_only_items');
    expect(datRefusalReason(blankLevel(2))).toBeNull();
    const encoded = DatCodec.encodeLevelsWithReport([charmed, blankLevel(2)]);
    expect(encoded.refused.map((r) => r.reason)).toEqual(['epoxy_only_items']);
    expect(encoded.levelCount).toBe(1);
  });

  it('refuses a level that holds speed boots and leaves it out of the pack', () => {
    const hasted = blankLevel(1);
    hasted.items[3][3] = 'boots_speed';
    expect(datRefusalReason(hasted)).toBe('epoxy_only_items');
    const encoded = DatCodec.encodeLevelsWithReport([hasted, blankLevel(2)]);
    expect(encoded.refused.map((r) => r.reason)).toEqual(['epoxy_only_items']);
    expect(encoded.levelCount).toBe(1);
  });

  it('refuses a level that holds eye boots and leaves it out of the pack', () => {
    const eyed = blankLevel(1);
    eyed.items[3][3] = 'boots_eye';
    expect(datRefusalReason(eyed)).toBe('epoxy_only_items');
    const encoded = DatCodec.encodeLevelsWithReport([eyed, blankLevel(2)]);
    expect(encoded.refused.map((r) => r.reason)).toEqual(['epoxy_only_items']);
    expect(encoded.levelCount).toBe(1);
  });

  it('refuses a level that holds pull boots and leaves it out of the pack', () => {
    const pulled = blankLevel(1);
    pulled.items[3][3] = 'boots_pull';
    expect(datRefusalReason(pulled)).toBe('epoxy_only_items');
    const encoded = DatCodec.encodeLevelsWithReport([pulled, blankLevel(2)]);
    expect(encoded.refused.map((r) => r.reason)).toEqual(['epoxy_only_items']);
    expect(encoded.levelCount).toBe(1);
  });

  it('refuses a level with a puppet, a puppet control or a skitter and leaves it out of the pack', () => {
    const puppet = blankLevel(1);
    puppet.entities = [{ type: 'puppet', x: 3, y: 3, dir: 'E' }];
    const control = blankLevel(2);
    control.terrain[3][3] = 'puppet_control';
    const skitter = blankLevel(3);
    skitter.entities = [{ type: 'skitter', x: 3, y: 3, dir: 'E' }];
    const cloned = blankLevel(4);
    cloned.cloneLinks = [{ buttonX: 1, buttonY: 1, clonerX: 2, clonerY: 2, templateType: 'puppet', templateDir: 'E' }];
    for (const level of [puppet, control, skitter, cloned]) {
      expect(datRefusalReason(level), level.id).toBe('epoxy_only_monsters');
    }
    expect(datRefusalReason(blankLevel(5))).toBeNull();
    const encoded = DatCodec.encodeLevelsWithReport([puppet, control, skitter, blankLevel(5)]);
    expect(encoded.refused.map((r) => r.reason)).toEqual(['epoxy_only_monsters', 'epoxy_only_monsters', 'epoxy_only_monsters']);
    expect(encoded.levelCount).toBe(1);
  });

  it('refuses a level that holds a turning force floor and leaves it out of the pack', () => {
    const turning = blankLevel(1);
    turning.terrain[3][3] = 'force_cycle';
    expect(datRefusalReason(turning)).toBe('epoxy_only_monsters');
    const encoded = DatCodec.encodeLevelsWithReport([turning, blankLevel(2)]);
    expect(encoded.refused.map((r) => r.reason)).toEqual(['epoxy_only_monsters']);
    expect(encoded.levelCount).toBe(1);
  });

  it('refuses a level with an arrow block and leaves it out of the pack', () => {
    const placed = blankLevel(1);
    placed.entities = [{ type: 'arrow_block_line', x: 3, y: 3, dir: 'E' }];
    const cloned = blankLevel(2);
    cloned.cloneLinks = [{ buttonX: 1, buttonY: 1, clonerX: 2, clonerY: 2, templateType: 'arrow_block_one', templateDir: 'E' }];
    expect(datRefusalReason(placed)).toBe('epoxy_only_monsters');
    expect(datRefusalReason(cloned)).toBe('epoxy_only_monsters');
    const encoded = DatCodec.encodeLevelsWithReport([placed, blankLevel(3)]);
    expect(encoded.refused.map((r) => r.reason)).toEqual(['epoxy_only_monsters']);
    expect(encoded.levelCount).toBe(1);
  });

  it('refuses a level that holds a transmogrifier and leaves it out of the pack', () => {
    const swapping = blankLevel(1);
    swapping.terrain[3][3] = 'transmogrifier';
    expect(datRefusalReason(swapping)).toBe('epoxy_only_monsters');
    const encoded = DatCodec.encodeLevelsWithReport([swapping, blankLevel(2)]);
    expect(encoded.refused.map((r) => r.reason)).toEqual(['epoxy_only_monsters']);
    expect(encoded.levelCount).toBe(1);
  });

  it('refuses a level that holds a turn plate and leaves it out of the pack', () => {
    const turning = blankLevel(1);
    turning.terrain[3][3] = 'turn_plate_cw';
    expect(datRefusalReason(turning)).toBe('epoxy_only_monsters');
    const encoded = DatCodec.encodeLevelsWithReport([turning, blankLevel(2)]);
    expect(encoded.refused.map((r) => r.reason)).toEqual(['epoxy_only_monsters']);
    expect(encoded.levelCount).toBe(1);
  });

  it('refuses a level with signal wires and leaves it out of the pack', () => {
    const wired = { ...blankLevel(1), signalLinks: [{ fromX: 2, fromY: 2, toX: 3, toY: 2 }] };
    expect(datRefusalReason(wired)).toBe('signal_content');
    expect(datRefusalReason({ ...blankLevel(2), signalLinks: [] })).toBeNull();
    const encoded = DatCodec.encodeLevelsWithReport([wired, blankLevel(2)]);
    expect(encoded.refused.map((r) => r.reason)).toEqual(['signal_content']);
    expect(encoded.levelCount).toBe(1);
  });

  it('refuses a level with underlays and leaves it out of the pack', () => {
    const hidden = { ...blankLevel(1), underlays: [{ x: 3, y: 3, terrain: 'ice' }] };
    hidden.terrain[3][3] = 'door_red';
    expect(datRefusalReason(hidden)).toBe('cell_underlays');
    expect(datRefusalReason({ ...blankLevel(2), underlays: [] })).toBeNull();
    const encoded = DatCodec.encodeLevelsWithReport([hidden, blankLevel(2)]);
    expect(encoded.refused.map((r) => r.reason)).toEqual(['cell_underlays']);
    expect(encoded.levelCount).toBe(1);
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

describe('DatCodec Chip codes on export', () => {
  const SWIMMING_CHIP_FIRST_CODE = 0x3c;
  const SWIMMING_CHIP_LAST_CODE = 0x3f;
  const START_X = 2;
  const START_Y = 2;
  const FACING_CODES: Array<[Direction, number]> = [
    ['N', 0x6c],
    ['W', 0x6d],
    ['S', 0x6e],
    ['E', 0x6f]
  ];

  /** The first layer of the single level of an encoded pack, read back through the codec's own RLE rules. */
  function topLayerOf(bytes: Uint8Array): Uint8Array {
    const { layerByteLength, rleMarkerByte } = ConfigRegistry.getDatFormat();
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const lengthOffset = PACK_HEADER_BYTES + RECORD_HEADER_BYTES;
    const compressedLength = view.getUint16(lengthOffset, true);
    const compressed = bytes.subarray(lengthOffset + 2, lengthOffset + 2 + compressedLength);
    const out: number[] = [];
    for (let i = 0; i < compressed.length && out.length < layerByteLength; i++) {
      if (compressed[i] === rleMarkerByte) {
        for (let n = 0; n < compressed[i + 1]; n++) out.push(compressed[i + 2]);
        i += 2;
      } else {
        out.push(compressed[i]);
      }
    }
    return Uint8Array.from(out);
  }

  it.each(FACING_CODES)('writes Chip facing %s as code %i', (dir, code) => {
    const lvl = blankLevel(1);
    lvl.playerStart = { x: START_X, y: START_Y, dir };
    const { layerWidth } = ConfigRegistry.getDatFormat();
    expect(layerWidth).toBeDefined();
    const top = topLayerOf(DatCodec.encodeLevels([lvl]));
    expect(top[START_Y * (layerWidth as number) + START_X]).toBe(code);
    expect(top.some((b) => b >= SWIMMING_CHIP_FIRST_CODE && b <= SWIMMING_CHIP_LAST_CODE)).toBe(false);
  });

  it.each(FACING_CODES)('keeps the player of an exported level under Lynx reading (%s)', (dir) => {
    const lvl = blankLevel(1);
    lvl.playerStart = { x: 5, y: 4, dir };
    const bytes = DatCodec.encodeLevels([lvl]);
    const [decoded] = DatCodec.decodeBuffer(toBuffer(bytes), PREFIX, 'lynx');
    expect(decoded.playerStart).toEqual({ x: 5, y: 4, dir });
    expect(decoded.terrain[4][5]).toBe('floor');
  });

  it('never writes a decode-only code', () => {
    const lvl = richLevel(1);
    const top = topLayerOf(DatCodec.encodeLevels([lvl]));
    const decodeOnly = Object.entries(ConfigRegistry.getDatFormat().byteToElement)
      .filter(([, mapping]) => mapping.decodeOnly)
      .map(([code]) => Number(code));
    expect(decodeOnly.length).toBeGreaterThan(0);
    expect(top.some((b) => decodeOnly.includes(b))).toBe(false);
  });
});


/** Every bundled pack, inlined by Vite as base64 data URLs. */
const BUNDLED_PACKS = import.meta.glob('../../public/packs/*.DAT', {
  query: '?inline',
  import: 'default',
  eager: true
}) as Record<string, string>;
const BUNDLED_PACK_URLS = Object.values(BUNDLED_PACKS);
/** Bundled packs whose levels all carry a field 9 author; the others carry none. */
const AUTHORED_PACK_NAMES = ['CCLP1', 'CCLP4', 'CCLP5'];

describe('DatCodec bundled pack ids', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('keeps the plain id of every level of every bundled pack', () => {
    expect(BUNDLED_PACK_URLS.length).toBeGreaterThan(0);
    for (const url of BUNDLED_PACK_URLS) {
      const bytes = Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), (c) => c.charCodeAt(0));
      const levels = DatCodec.decodeBuffer(bytes.buffer, PREFIX, DEFAULT_RULESET);
      expect(levels.length).toBeGreaterThan(0);
      levels.forEach((level, idx) => {
        expect(level.id).toBe(`${PREFIX}_level_${level.number || idx + 1}`);
      });
    }
  });

  it('reads the level author of the packs that carry one', () => {
    expect(Object.keys(BUNDLED_PACKS).length).toBeGreaterThan(0);
    for (const [path, url] of Object.entries(BUNDLED_PACKS)) {
      const name = path.slice(path.lastIndexOf('/') + 1).replace(/\.DAT$/i, '');
      const bytes = Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), (c) => c.charCodeAt(0));
      const levels = DatCodec.decodeBuffer(bytes.buffer, PREFIX, DEFAULT_RULESET);
      const authored = AUTHORED_PACK_NAMES.includes(name.toUpperCase());
      for (const level of levels) {
        expect(Boolean(level.author), `${name} level ${level.number}`).toBe(authored);
      }
      if (name.toUpperCase() === 'CCLP1') {
        expect(levels[0].author).toBe('Tyler Sontag');
      }
    }
  });
});

describe('DatCodec ruleset tagging', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('tags every decoded level with a non-default ruleset', () => {
    const bytes = toBuffer(DatCodec.encodeLevels([richLevel(1), blankLevel(2)]));
    const decoded = DatCodec.decodeBuffer(bytes, PREFIX, 'lynx');
    expect(decoded).toHaveLength(2);
    expect(decoded.every((level) => level.ruleset === 'lynx')).toBe(true);
  });

  it('flags the Epoxy reading with the classic rules flavor and leaves the Lynx reading alone', () => {
    const bytes = toBuffer(DatCodec.encodeLevels([richLevel(1), blankLevel(2)]));
    const epoxy = DatCodec.decodeBuffer(bytes, PREFIX, 'epoxy');
    const lynx = DatCodec.decodeBuffer(bytes, PREFIX, 'lynx');
    expect(epoxy.every((level) => level.rulesFlavor === 'cc')).toBe(true);
    expect(lynx.some((level) => 'rulesFlavor' in level)).toBe(false);
  });

  it('leaves the ruleset implicit for the default one', () => {
    const bytes = toBuffer(DatCodec.encodeLevels([richLevel(1), blankLevel(2)]));
    const decoded = DatCodec.decodeBuffer(bytes, PREFIX, DEFAULT_RULESET);
    expect(decoded.some((level) => 'ruleset' in level)).toBe(false);
  });
});

/** Byte codes used by the hand-built Lynx levels. */
const CODE = {
  floor: 0,
  wall: 1,
  chip: 2,
  keyRed: 101,
  water: 3,
  plainBlock: 10,
  blockNorth: 14,
  blockEast: 17,
  unusedFloorCode: 32,
  cloneMachine: 49,
  unusedWallCodes: [51, 52, 53, 58, 59],
  unusedInvisibleCodes: [54, 55, 56],
  sealedExit: 57,
  swimmingChipCodes: [60, 61, 62, 63],
  bugNorth: 64,
  bugEast: 67,
  chipSouth: 110,
  firstHighCode: 112,
  lastHighCode: 254
};
const FIELD_MONSTER_LIST = 10;
const MIN_PLAYER_CODE = 108;
const MAX_PLAYER_CODE = 111;
const PACK_HEADER = 6;
const LEVEL_HEADER = 8;
const HAND_BUILT_TIME_LIMIT = 100;

type Cells = Record<string, number>;

/** One layer of a hand-built level: cells are keyed "x,y", everything else is floor. */
function layerBytes(cells: Cells): Uint8Array {
  const { layerWidth, layerByteLength } = ConfigRegistry.getDatFormat();
  const out = new Uint8Array(layerByteLength);
  for (const [key, code] of Object.entries(cells)) {
    const [x, y] = key.split(',').map(Number);
    out[y * (layerWidth ?? 0) + x] = code;
  }
  return out;
}

/** A single-level pack with raw layers (no RLE) and an optional monster list. */
function handBuiltPack(top: Cells, bottom: Cells, monsterOrder: Array<[number, number]> = []): ArrayBuffer {
  const l1 = layerBytes(top);
  const l2 = layerBytes(bottom);
  const optional = monsterOrder.length
    ? Uint8Array.from([FIELD_MONSTER_LIST, monsterOrder.length * 2, ...monsterOrder.flat()])
    : new Uint8Array(0);
  const size = LEVEL_HEADER + 2 + l1.length + 2 + l2.length + 2 + optional.length;
  const record = new Uint8Array(2 + size);
  const view = new DataView(record.buffer);
  view.setUint16(0, size, true);
  view.setUint16(2, 1, true);
  view.setUint16(4, HAND_BUILT_TIME_LIMIT, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, 1, true);
  let pos = 2 + LEVEL_HEADER;
  for (const part of [l1, l2]) {
    view.setUint16(pos, part.length, true);
    record.set(part, pos + 2);
    pos += 2 + part.length;
  }
  view.setUint16(pos, optional.length, true);
  record.set(optional, pos + 2);
  return rawPack(1, record);
}

function decodeOne(top: Cells, bottom: Cells, ruleset: 'epoxy' | 'lynx', order: Array<[number, number]> = []) {
  return DatCodec.decodeBuffer(handBuiltPack(top, bottom, order), PREFIX, ruleset)[0];
}

describe('DatCodec Lynx decoding', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('turns a directional block into a cloner only on a clone machine', () => {
    const top = { '2,2': CODE.blockNorth, '4,4': CODE.blockEast };
    const bottom = { '4,4': CODE.cloneMachine };
    const lynx = decodeOne(top, bottom, 'lynx');
    expect(lynx.terrain[2][2]).toBe('floor');
    expect(lynx.terrain[4][4]).toBe('clone_machine');
    expect(lynx.entities).toEqual([
      { x: 2, y: 2, type: 'dirt_block', dir: 'N' },
      { x: 4, y: 4, type: 'dirt_block', dir: 'E' }
    ]);
    const epoxy = decodeOne(top, bottom, 'epoxy');
    expect(epoxy.terrain[2][2]).toBe('clone_machine');
  });

  it('faces the plain block north under Lynx and south under Epoxy', () => {
    const top = { '3,3': CODE.plainBlock };
    expect(decodeOne(top, {}, 'lynx').entities[0].dir).toBe('N');
    expect(decodeOne(top, {}, 'epoxy').entities[0].dir).toBe('S');
  });

  it('reads the plain block on a clone machine as a cloner facing north', () => {
    const level = decodeOne({ '5,5': CODE.plainBlock }, { '5,5': CODE.cloneMachine }, 'lynx');
    expect(level.terrain[5][5]).toBe('clone_machine');
    expect(level.entities).toEqual([{ x: 5, y: 5, type: 'dirt_block', dir: 'N' }]);
  });

  it('keeps the lower layer only as the floor under a creature', () => {
    const top = {
      '1,1': CODE.chipSouth,
      '2,2': CODE.wall,
      '3,3': CODE.floor,
      '6,6': CODE.plainBlock,
      '9,9': CODE.bugNorth
    };
    const bottom = {
      '2,2': CODE.chip,
      '3,3': CODE.bugEast,
      '6,6': CODE.water,
      '8,8': CODE.chipSouth,
      '9,9': CODE.chip
    };
    const lynx = decodeOne(top, bottom, 'lynx');
    // The only item left is the chip under the bug at 9,9: everything else in the lower layer is ignored.
    expect(lynx.items[9][9]).toBe('chip');
    expect(lynx.items.flat().filter((cell) => cell !== null)).toHaveLength(1);
    expect(lynx.entities.map((e) => `${e.x},${e.y},${e.type}`)).toEqual(['6,6,dirt_block', '9,9,bug']);
    expect(lynx.terrain[6][6]).toBe('water');
    expect(lynx.terrain[2][2]).toBe('wall');
    expect(lynx.playerStart).toMatchObject({ x: 1, y: 1 });
    const epoxy = decodeOne(top, bottom, 'epoxy');
    expect(epoxy.items[2][2]).toBe('chip');
    expect(epoxy.entities.some((e) => e.x === 3 && e.y === 3)).toBe(true);
    expect(epoxy.playerStart).toMatchObject({ x: 8, y: 8 });
  });

  it('keeps an item as the floor under a creature under Lynx', () => {
    const top = { '4,4': CODE.plainBlock, '7,7': CODE.bugNorth };
    const bottom = { '4,4': CODE.chip, '7,7': CODE.keyRed };
    const lynx = decodeOne(top, bottom, 'lynx');
    expect(lynx.items[4][4]).toBe('chip');
    expect(lynx.items[7][7]).toBe('key_red');
    expect(lynx.entities.map((e) => `${e.x},${e.y},${e.type}`)).toEqual(['4,4,dirt_block', '7,7,bug']);
    const epoxy = decodeOne(top, bottom, 'epoxy');
    expect(epoxy.items[4][4]).toBe('chip');
    expect(epoxy.items[7][7]).toBe('key_red');
  });

  it('ignores the monster list under Lynx and follows it under Epoxy', () => {
    const top = { '1,1': CODE.bugNorth, '5,5': CODE.bugEast };
    const order: Array<[number, number]> = [
      [5, 5],
      [1, 1]
    ];
    const lynx = decodeOne(top, {}, 'lynx', order);
    expect(lynx.entities.map((e) => `${e.x},${e.y}`)).toEqual(['1,1', '5,5']);
    const epoxy = decodeOne(top, {}, 'epoxy', order);
    expect(epoxy.entities.map((e) => `${e.x},${e.y}`)).toEqual(['5,5', '1,1']);
  });

  it('gives the unused codes their Lynx meaning', () => {
    const cells: Cells = {};
    const expected = new Map<number, string>();
    let x = 1;
    const add = (code: number, tile: string): void => {
      cells[`${x},1`] = code;
      expected.set(x, tile);
      x++;
    };
    add(CODE.unusedFloorCode, 'wall');
    CODE.unusedWallCodes.forEach((c) => add(c, 'wall'));
    CODE.unusedInvisibleCodes.forEach((c) => add(c, 'invisible_wall'));
    add(CODE.sealedExit, 'wall');
    add(CODE.firstHighCode, 'wall');
    add(CODE.lastHighCode, 'wall');
    const lynx = decodeOne(cells, {}, 'lynx');
    for (const [col, tile] of expected) expect(lynx.terrain[1][col]).toBe(tile);
    // Under Epoxy the unused floor code stays floor and a swimming Chip code is still a player start
    const epoxy = decodeOne({ '1,1': CODE.unusedFloorCode, '2,1': CODE.swimmingChipCodes[0] }, {}, 'epoxy');
    expect(epoxy.terrain[1][1]).toBe('floor');
    expect(epoxy.playerStart).toMatchObject({ x: 2, y: 1 });
  });

  it('reads a swimming Chip code as the player start under Epoxy, and under Lynx only when no other start exists', () => {
    const facings = ['N', 'W', 'S', 'E'];
    CODE.swimmingChipCodes.forEach((code, i) => {
      for (const ruleset of ['lynx', 'epoxy'] as const) {
        const level = decodeOne({ '3,4': code }, { '3,4': CODE.water }, ruleset);
        expect(level.playerStart).toEqual({ x: 3, y: 4, dir: facings[i] });
        expect(level.terrain[4][3]).toBe('water');
        expect(level.missingStart).toBeUndefined();
      }
    });
    // With a regular start present, Lynx keeps today's reading: water, for all four codes
    for (const code of CODE.swimmingChipCodes) {
      const lynx = decodeOne({ '3,4': code, '1,1': CODE.chipSouth }, {}, 'lynx');
      expect(lynx.terrain[4][3]).toBe('water');
      expect(lynx.playerStart).toMatchObject({ x: 1, y: 1 });
    }
  });

  it('reports the unused codes and a missing start without placing one', () => {
    const cells: Cells = { '1,1': 0x33, '2,1': 0x3b, '3,1': CODE.firstHighCode, '4,1': CODE.chipSouth };
    const withStart = DatCodec.decodeBufferWithDiagnostics(handBuiltPack(cells, {}), PREFIX, 'epoxy');
    expect(withStart.diagnostics).toEqual([{ levelNumber: 1, kind: 'unused_code', codes: [0x33, 0x3b, CODE.firstHighCode] }]);
    const noStart = DatCodec.decodeBufferWithDiagnostics(handBuiltPack({ '1,1': CODE.wall }, {}), PREFIX, 'lynx');
    expect(noStart.diagnostics).toEqual([{ levelNumber: 1, kind: 'no_player_start' }]);
    expect(noStart.levels[0].missingStart).toBe(true);
    const { mapWidth, mapHeight } = ConfigRegistry.getGame().grid;
    expect(noStart.levels[0].playerStart).not.toMatchObject({ x: Math.floor(mapWidth / 2), y: Math.floor(mapHeight / 2) });
  });

  it('reads the unused codes 51-56 as walls under Epoxy and keeps the Lynx reading', () => {
    const wallCode = CODE.unusedWallCodes[0];
    const invisibleCode = CODE.unusedInvisibleCodes[CODE.unusedInvisibleCodes.length - 1];
    for (const ruleset of ['epoxy', 'lynx'] as const) {
      const level = decodeOne({ '2,2': wallCode, '3,2': invisibleCode, '4,2': CODE.chipSouth }, {}, ruleset);
      expect(level.terrain[2][2]).toBe('wall');
      expect(level.terrain[2][3]).toBe('invisible_wall');
    }
    const epoxy = DatCodec.decodeBufferWithDiagnostics(handBuiltPack({ '2,2': wallCode, '4,2': CODE.chipSouth }, {}), PREFIX, 'epoxy');
    expect(epoxy.diagnostics).toEqual([{ levelNumber: 1, kind: 'unused_code', codes: [wallCode] }]);
  });

  it('writes the canonical codes, never the unused 51-56, when a decoded level is exported', () => {
    const level = decodeOne({ '2,2': CODE.unusedWallCodes[0], '3,2': CODE.unusedInvisibleCodes[0], '4,2': CODE.chipSouth }, {}, 'epoxy');
    const top = topLayers(toBuffer(DatCodec.encodeLevels([level])))[0];
    const layerWidth = ConfigRegistry.getDatFormat().layerWidth ?? ConfigRegistry.getGame().grid.mapWidth;
    expect(top[2 * layerWidth + 2]).toBe(CODE.wall);
    for (const code of [...CODE.unusedWallCodes.slice(0, 3), ...CODE.unusedInvisibleCodes]) {
      expect(top.includes(code)).toBe(false);
    }
  });

  it('decodes the unused codes held by bundled CCLP2 levels 71, 98 and 127 as walls', () => {
    const base64 = CCLP2_DATA_URL.slice(CCLP2_DATA_URL.indexOf(',') + 1);
    const buffer = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)).buffer;
    const levels = DatCodec.decodeBuffer(buffer, 'cclp2', DEFAULT_RULESET);
    const layers = topLayers(buffer);
    const layerWidth = ConfigRegistry.getDatFormat().layerWidth ?? ConfigRegistry.getGame().grid.mapWidth;
    const found = new Map<number, number>();
    levels.forEach((level, i) => {
      layers[i].forEach((code, idx) => {
        if (code < UNUSED_CODE_FIRST || code > UNUSED_CODE_LAST) return;
        found.set(level.number, (found.get(level.number) ?? 0) + 1);
        expect(level.terrain[Math.floor(idx / layerWidth)][idx % layerWidth]).toBe(code <= UNUSED_WALL_LAST ? 'wall' : 'invisible_wall');
      });
    });
    for (const levelNumber of CCLP2_UNUSED_CODE_LEVELS) expect(found.get(levelNumber)).toBeGreaterThan(0);
  });

  it('keeps the clone machine of an exported block on a cloner', () => {
    const lvl = blankLevel(1);
    lvl.terrain[6][6] = 'clone_machine';
    lvl.entities = [{ x: 6, y: 6, type: 'dirt_block', dir: 'W' }];
    lvl.items[6][6] = 'chip';
    const bytes = toBuffer(DatCodec.encodeLevels([lvl]));
    const lynx = DatCodec.decodeBuffer(bytes, PREFIX, 'lynx')[0];
    expect(lynx.terrain[6][6]).toBe('clone_machine');
    expect(lynx.entities).toContainEqual({ x: 6, y: 6, type: 'dirt_block', dir: 'W' });
  });
});

/** The uncompressed top layer of every level of a pack. */
function topLayers(buffer: ArrayBuffer): Uint8Array[] {
  const cfg = ConfigRegistry.getDatFormat();
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const layers: Uint8Array[] = [];
  let offset = PACK_HEADER;
  for (let i = 0; i < view.getUint16(4, true); i++) {
    const length = view.getUint16(offset, true);
    const start = offset + 2 + LEVEL_HEADER;
    const compressed = bytes.subarray(start + 2, start + 2 + view.getUint16(start, true));
    const out = new Uint8Array(cfg.layerByteLength);
    let n = 0;
    for (let p = 0; p < compressed.length && n < out.length; ) {
      if (compressed[p] === cfg.rleMarkerByte) {
        for (let c = 0; c < compressed[p + 1]; c++) out[n++] = compressed[p + 2];
        p += 3;
      } else {
        out[n++] = compressed[p++];
      }
    }
    layers.push(out);
    offset += 2 + length;
  }
  return layers;
}

describe('DatCodec Lynx on the bundled packs', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('decodes every bundled pack with exactly one player start per level', () => {
    const failures: string[] = [];
    for (const url of BUNDLED_PACK_URLS) {
      const bytes = Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), (c) => c.charCodeAt(0));
      const levels = DatCodec.decodeBuffer(bytes.buffer, PREFIX, 'lynx');
      const tops = topLayers(bytes.buffer);
      expect(levels.length).toBeGreaterThan(0);
      levels.forEach((level, idx) => {
        const starts = tops[idx].filter((c) => c >= MIN_PLAYER_CODE && c <= MAX_PLAYER_CODE).length;
        if (starts !== 1) failures.push(`${level.id}: ${starts} player starts`);
      });
    }
    expect(failures).toEqual([]);
  });
});

describe('DatCodec level without a player start', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('writes no player tile for a flagged level, so it reads back flagged and start-less', () => {
    const lvl = blankLevel(1);
    lvl.missingStart = true;
    const bytes = toBuffer(DatCodec.encodeLevels([lvl]));
    const [decoded] = DatCodec.decodeBuffer(bytes, PREFIX, DEFAULT_RULESET);
    expect(decoded.missingStart).toBe(true);
  });

  it('keeps a level start-less through an editor wall edit and the export', () => {
    const lvl = blankLevel(1);
    lvl.missingStart = true;
    let doc = documentFromLevel(lvl, { title: 'T', hint: '' });
    doc = withEditedMap(doc, paintTerrain(doc, 3, 3, 'wall').map);
    const exported = levelFromDocument(doc, { id: lvl.id, number: 1, password: 'ABCD', fallbackTitle: 'T' });
    expect(exported.missingStart).toBe(true);
    expect(exported.terrain[3][3]).toBe('wall');
    const [decoded] = DatCodec.decodeBuffer(toBuffer(DatCodec.encodeLevels([exported])), PREFIX, DEFAULT_RULESET);
    expect(decoded.missingStart).toBe(true);
  });
});
