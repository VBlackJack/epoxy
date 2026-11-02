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
import { ConfigRegistry } from '../config/ConfigRegistry';
import { isCompiledLevelShape } from '../config/ConfigValidation';
import { DEFAULT_LEVEL_PASSWORD } from '../config/constants';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { CC3D_ERROR_KEYS, Cc3dImportError, decodeCc3dFiles, decodeCc3dLevel, parseXmlDocument } from './Cc3dXmlCodec';

const OPTIONS = { packName: 'pack', mapId: '7', number: 3 };
const CELL = 64;
const PLAYER_TYPE = 22;

interface TileSpec {
  type: number;
  x: number;
  y: number;
  dir?: number;
  flags?: number;
  name?: string;
}

function tile(spec: TileSpec): string {
  const dir = spec.dir ?? 0;
  const flags = spec.flags ?? 0;
  return `<tile image_index="${spec.type}" x="${spec.x * CELL}" y="${spec.y * CELL}" direction="${dir}" type="${spec.type}"><attributes flags="${flags}" editor_category="0" name="${spec.name ?? 'Stored'}" /></tile>`;
}

interface MapSpec {
  width?: number;
  height?: number;
  name?: string;
  /** Tiles by section name; sections are written in the order of the keys. */
  sections?: Record<string, TileSpec[]>;
  declaration?: string;
}

const DEFAULT_PLAYER: TileSpec = { type: PLAYER_TYPE, x: 0, y: 0, dir: 3 };

function mapXml(spec: MapSpec = {}): string {
  const sections = spec.sections ?? { player: [DEFAULT_PLAYER] };
  const body = Object.entries(sections)
    .map(([name, tiles]) => (tiles.length === 0 ? `<${name} />` : `<${name}>${tiles.map(tile).join('')}</${name}>`))
    .join('');
  const declaration = spec.declaration ?? '<?xml version="1.0" encoding="utf-16"?>';
  return `${declaration}<map name="${spec.name ?? 'Test'}" author="Someone" width="${spec.width ?? 4}" height="${spec.height ?? 4}" background="0">${body}</map>`;
}

function withTiles(tiles: TileSpec[], extra: Partial<MapSpec> = {}): string {
  return mapXml({ ...extra, sections: { player: [DEFAULT_PLAYER], tiles } });
}

function importOf(xml: string) {
  return decodeCc3dLevel(xml, OPTIONS);
}

function errorOf(fn: () => unknown): Cc3dImportError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(Cc3dImportError);
    return err as Cc3dImportError;
  }
  throw new Error('expected an import error');
}

function cellOf(xml: string, x: number, y: number, width = 4) {
  return importOf(xml).cc3d!.cells[y * width + x];
}

function utf16(text: string, littleEndian: boolean, bom: boolean): Uint8Array {
  const units = (bom ? '﻿' : '') + text;
  const out = new Uint8Array(units.length * 2);
  for (let i = 0; i < units.length; i++) {
    const code = units.charCodeAt(i);
    out[i * 2] = littleEndian ? code & 0xff : code >> 8;
    out[i * 2 + 1] = littleEndian ? code >> 8 : code & 0xff;
  }
  return out;
}

beforeEach(() => {
  loadTestConfigs();
});

describe('decodeCc3dLevel output', () => {
  it('builds a cc3d compiled level that passes the shape check', () => {
    const level = importOf(
      withTiles([
        { type: 42, x: 1, y: 0 },
        { type: 42, x: 2, y: 0 },
        { type: 20, x: 3, y: 3 },
        { type: 53, x: 1, y: 1, dir: 1 }
      ])
    );
    expect(level.ruleset).toBe('cc3d');
    expect(level.id).toBe('pack-7');
    expect(level.number).toBe(3);
    expect(level.timeLimitSeconds).toBe(0);
    expect(level.password).toBe(DEFAULT_LEVEL_PASSWORD);
    expect(level.chipsRequired).toBe(2);
    expect(level.customTitle).toBe('Test');
    expect(level.author).toBe('Someone');
    expect(level.trapLinks).toEqual([]);
    expect(level.cloneLinks).toEqual([]);
    expect(level.playerStart).toEqual({ x: 0, y: 0, dir: 'W' });
    expect(level.cc3d!.player).toEqual({ x: 0, y: 0, dir: 'W' });
    expect(level.terrain[3][3]).toBe('exit');
    expect(level.items[0][1]).toBe('chip');
    expect(level.entities).toEqual([{ x: 1, y: 1, type: 'pink_ball', dir: 'E' }]);
    expect(level.cc3d!.mapId).toBe('7');
    expect(isCompiledLevelShape(level, ConfigRegistry.getLevelSizeBounds())).toBe(true);
  });

  it('puts plain floor under a lone blocker and drops it under another floor kind', () => {
    const xml = withTiles([
      { type: 2, x: 1, y: 0 },
      { type: 1, x: 2, y: 0 },
      { type: 3, x: 2, y: 0 }
    ]);
    expect(cellOf(xml, 1, 0).terrain.map((t) => t.kind)).toEqual(['floor', 'wall']);
    expect(cellOf(xml, 2, 0).terrain.map((t) => t.kind)).toEqual(['ice']);
  });
});

describe('stacking', () => {
  it('stores two and four panels as a set in N,E,S,W order', () => {
    const two = withTiles([
      { type: 150, x: 1, y: 1 },
      { type: 147, x: 1, y: 1 }
    ]);
    expect(cellOf(two, 1, 1).panels).toEqual(['N', 'W']);
    const four = withTiles([150, 149, 148, 147].map((type) => ({ type, x: 2, y: 2 })));
    const cell = cellOf(four, 2, 2);
    expect(cell.panels).toEqual(['N', 'E', 'S', 'W']);
    expect(cell.terrain).toEqual([{ kind: 'floor' }]);
  });

  it('keeps floor under a colour block as a mob on a floor cell', () => {
    const level = importOf(
      withTiles([
        { type: 1, x: 1, y: 1 },
        { type: 163, x: 1, y: 1, dir: 2 }
      ])
    );
    expect(level.cc3d!.cells[5].terrain).toEqual([{ kind: 'floor' }]);
    expect(level.cc3d!.mobs).toEqual([{ kind: 'block_color', color: 'red', x: 1, y: 1, dir: 'S' }]);
    expect(level.entities[0].type).toBe('cc3d_block_red');
  });

  it('reads the toggle door state from the flags, not from the type', () => {
    const xml = withTiles([
      { type: 14, x: 1, y: 0, flags: 15, name: 'Closed toggle door' },
      { type: 15, x: 2, y: 0, flags: 0, name: 'Open toggle door' },
      { type: 165, x: 3, y: 0, flags: 15 }
    ]);
    expect(cellOf(xml, 1, 0).terrain[1]).toEqual({ kind: 'toggle_door', color: 'green', open: true });
    expect(cellOf(xml, 2, 0).terrain[1]).toEqual({ kind: 'toggle_door', color: 'green', open: false });
    expect(cellOf(xml, 3, 0).terrain[1]).toMatchObject({ color: 'blue', open: true });
  });

  it('keeps the exit under a panel', () => {
    const cell = cellOf(
      withTiles([
        { type: 149, x: 2, y: 2 },
        { type: 20, x: 2, y: 2 }
      ]),
      2,
      2
    );
    expect(cell.terrain).toEqual([{ kind: 'exit' }]);
    expect(cell.panels).toEqual(['S']);
  });

  it('keeps the exit under a key door', () => {
    const cell = cellOf(
      withTiles([
        { type: 34, x: 2, y: 2 },
        { type: 20, x: 2, y: 2 }
      ]),
      2,
      2
    );
    expect(cell.terrain).toEqual([{ kind: 'exit' }, { kind: 'door', color: 'red' }]);
  });

  it('stacks a key door over a toggle control over a bomb', () => {
    const cell = cellOf(
      withTiles([
        { type: 37, x: 1, y: 2 },
        { type: 64, x: 1, y: 2 },
        { type: 158, x: 1, y: 2 }
      ]),
      1,
      2
    );
    expect(cell.terrain.map((t) => t.kind)).toEqual(['floor', 'bomb', 'toggle_control', 'door']);
  });

  it('reads force floors and clone machines direction as documented', () => {
    const xml = withTiles([
      { type: 12, x: 1, y: 0, dir: 3 },
      { type: 68, x: 2, y: 0, dir: 1 }
    ]);
    expect(cellOf(xml, 1, 0).terrain[0]).toEqual({ kind: 'force', dir: 'S' });
    expect(cellOf(xml, 2, 0).terrain[1]).toEqual({ kind: 'clone_machine', dir: 'E' });
  });
});

describe('encoding and parsing', () => {
  it('reads ASCII that declares utf-16', () => {
    const bytes = new TextEncoder().encode(mapXml());
    expect(decodeCc3dLevel(bytes, OPTIONS).customTitle).toBe('Test');
  });

  it('reads real UTF-16 LE with a byte order mark, and BE, and BOM-less LE', () => {
    const xml = mapXml();
    expect(decodeCc3dLevel(utf16(xml, true, true), OPTIONS).customTitle).toBe('Test');
    expect(decodeCc3dLevel(utf16(xml, false, true), OPTIONS).customTitle).toBe('Test');
    expect(decodeCc3dLevel(utf16(xml, true, false), OPTIONS).customTitle).toBe('Test');
    expect(decodeCc3dLevel(utf16(xml, false, false), OPTIONS).customTitle).toBe('Test');
  });

  it('strips a UTF-8 byte order mark', () => {
    const body = new TextEncoder().encode(mapXml());
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...body]);
    expect(decodeCc3dLevel(bytes, OPTIONS).customTitle).toBe('Test');
  });

  it('decodes entities and numeric references', () => {
    expect(importOf(mapXml({ name: 'A &amp; B &#65;&#x42; &lt;&quot;&apos;' })).customTitle).toBe('A & B AB <"\'');
  });

  it('accepts single quotes, comments and self-closing sections', () => {
    const xml = `<?xml version='1.0'?><!-- c --><map name='N' author='A' width='4' height='4'><player><tile x='0' y='0' direction='3' type='22'/></player><tiles/></map>`;
    expect(importOf(xml).customTitle).toBe('N');
  });

  it('rejects malformed XML', () => {
    const bad = [
      '<map name="x" width="4" height="4"',
      '<map name="x" width="4" height="4"></tiles>',
      '<map name=x width="4" height="4"/>',
      '<map name="a &bogus; b" width="4" height="4"/>',
      '<map name="a" name="b" width="4" height="4"/>',
      '<!DOCTYPE map><map width="4" height="4"/>',
      '<map width="4" height="4"/><map width="4" height="4"/>',
      'junk<map width="4" height="4"/>',
      '<map width="4" height="4"><player>'
    ];
    for (const xml of bad) {
      expect(errorOf(() => importOf(xml)).key, xml).toBe(CC3D_ERROR_KEYS.malformedXml);
    }
    expect(() => parseXmlDocument('<a><b/></a>')).not.toThrow();
  });

  it('rejects empty and undecodable bytes, and a wrong root', () => {
    expect(errorOf(() => decodeCc3dLevel(new Uint8Array(0), OPTIONS)).key).toBe(CC3D_ERROR_KEYS.emptyInput);
    expect(errorOf(() => decodeCc3dLevel(new Uint8Array([0xff, 0xfe, 0x3c]), OPTIONS)).key).toBe(
      CC3D_ERROR_KEYS.invalidEncoding
    );
    expect(errorOf(() => importOf('<level/>')).key).toBe(CC3D_ERROR_KEYS.notMap);
  });
});

describe('rejections', () => {
  it('rejects an unknown type id with its id and stored name', () => {
    const err = errorOf(() => importOf(withTiles([{ type: 999, x: 1, y: 1, name: 'Mystery' }])));
    expect(err.key).toBe(CC3D_ERROR_KEYS.unknownType);
    expect(err.params).toEqual({ id: 999, name: 'Mystery' });
  });

  it('rejects two mobs on one cell', () => {
    const err = errorOf(() =>
      importOf(
        withTiles([
          { type: 53, x: 1, y: 1 },
          { type: 23, x: 1, y: 1 }
        ])
      )
    );
    expect(err.key).toBe(CC3D_ERROR_KEYS.twoMobs);
  });

  it('rejects two items on one cell', () => {
    const err = errorOf(() =>
      importOf(
        withTiles([
          { type: 38, x: 1, y: 1 },
          { type: 42, x: 1, y: 1 }
        ])
      )
    );
    expect(err.key).toBe(CC3D_ERROR_KEYS.twoItems);
  });

  it('rejects two non-plain floor kinds, naming both ids', () => {
    const err = errorOf(() =>
      importOf(
        withTiles([
          { type: 3, x: 1, y: 1 },
          { type: 8, x: 1, y: 1 }
        ])
      )
    );
    expect(err.key).toBe(CC3D_ERROR_KEYS.twoFloors);
    expect(err.params).toMatchObject({ first: 3, second: 8 });
  });

  it('rejects zero or several players', () => {
    const none = mapXml({ sections: { tiles: [{ type: 1, x: 1, y: 1 }] } });
    expect(errorOf(() => importOf(none)).key).toBe(CC3D_ERROR_KEYS.playerCount);
    const two = mapXml({ sections: { player: [DEFAULT_PLAYER, { type: PLAYER_TYPE, x: 1, y: 1 }] } });
    expect(errorOf(() => importOf(two)).key).toBe(CC3D_ERROR_KEYS.playerCount);
  });

  it('rejects a size outside the configured bounds', () => {
    const { maxSize } = ConfigRegistry.getLevelSizeBounds();
    expect(errorOf(() => importOf(mapXml({ width: maxSize + 1 }))).key).toBe(CC3D_ERROR_KEYS.badSize);
    expect(errorOf(() => importOf(mapXml({ height: 0 }))).key).toBe(CC3D_ERROR_KEYS.badSize);
  });

  it('rejects coordinates off the grid or not on the pixel step', () => {
    const outside = errorOf(() => importOf(withTiles([{ type: 1, x: 4, y: 0 }])));
    expect(outside.key).toBe(CC3D_ERROR_KEYS.offGrid);
    const half = `<map name="a" author="b" width="4" height="4"><player><tile x="0" y="0" direction="3" type="22"/></player><tiles><tile x="32" y="0" direction="0" type="1"/></tiles></map>`;
    expect(errorOf(() => importOf(half)).key).toBe(CC3D_ERROR_KEYS.offGrid);
    const negative = `<map name="a" author="b" width="4" height="4"><player><tile x="-64" y="0" direction="3" type="22"/></player></map>`;
    expect(errorOf(() => importOf(negative)).key).toBe(CC3D_ERROR_KEYS.offGrid);
  });

  it('rejects a missing or out of range mob direction', () => {
    const bad = withTiles([{ type: 53, x: 1, y: 1, dir: 4 }]);
    expect(errorOf(() => importOf(bad)).key).toBe(CC3D_ERROR_KEYS.badAttribute);
  });
});

describe('section order', () => {
  it('does not depend on the section a tile sits in or on the order of sections', () => {
    const tiles: TileSpec[] = [
      { type: 10, x: 1, y: 1 },
      { type: 2, x: 2, y: 2 },
      { type: 38, x: 3, y: 3 }
    ];
    const a = mapXml({ sections: { player: [DEFAULT_PLAYER], tiles: [tiles[0]], walls: [tiles[1]], objects: [tiles[2]] } });
    const b = mapXml({ sections: { objects: [tiles[2]], blocks: [tiles[0]], walls: [tiles[1]], player: [DEFAULT_PLAYER] } });
    expect(importOf(a).cc3d).toEqual(importOf(b).cc3d);
  });
});

describe('decodeCc3dFiles', () => {
  it('orders by the number in the file name, then by name, and numbers the imported levels', () => {
    const good = (title: string) => mapXml({ name: title });
    const result = decodeCc3dFiles(
      [
        { name: 'zeta.xml', bytes: good('Zeta') },
        { name: '15010.xml', bytes: good('B') },
        { name: 'alpha.xml', bytes: good('Alpha') },
        { name: '9.xml', bytes: good('A') },
        { name: 'sub/15004.xml', bytes: '<map width="4" height="4"/>' }
      ],
      'pk'
    );
    expect(result.levels.map((l) => l.customTitle)).toEqual(['A', 'B', 'Alpha', 'Zeta']);
    expect(result.levels.map((l) => l.number)).toEqual([1, 2, 3, 4]);
    expect(result.levels.map((l) => l.id)).toEqual(['pk-9', 'pk-15010', 'pk-alpha', 'pk-zeta']);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].name).toBe('sub/15004.xml');
    expect(result.failures[0].error.key).toBe(CC3D_ERROR_KEYS.playerCount);
  });
});
