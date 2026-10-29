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
import { DatCodec } from './DatCodec';
import { ConfigBundle, ConfigRegistry } from '../config/ConfigRegistry';
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
