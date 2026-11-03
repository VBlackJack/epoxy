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
import {
  CC3D_COLORS,
  CC3D_ITEM_KINDS,
  CC3D_MOB_KINDS,
  type Cc3dCell,
  type Cc3dItem,
  type Cc3dLevel,
  type Cc3dMob,
  type Cc3dTerrain,
  type Cc3dTerrainKind
} from '../core/cc3d/model';
import type { Direction } from '../core/types';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { decodeCc3dLevel, parseXmlDocument } from './Cc3dXmlCodec';
import { CC3D_XML_DECLARATION, encodeCc3dLevel, encodeCc3dLevelReport, escapeCc3dAttribute } from './Cc3dXmlEncoder';
import { CC3D_ENTRY_BY_ID, CC3D_SECTIONS, CC3D_WRITE_INDEX, PANEL_FILE_DIRECTION, PIXELS_PER_CELL, mobKey, sectionRank } from './Cc3dTypeTable';

const META = { name: 'Fixture', author: 'Someone' };
const MAP_ID = 'fixture';
const GRID_WIDTH = 16;
const GRID_HEIGHT = 16;
const DIRECTIONS: readonly Direction[] = ['N', 'E', 'S', 'W'];
const FLOOR: Cc3dTerrain = { kind: 'floor' };
const MIRRORS = ['LU', 'DL', 'UR', 'RD'];
const ICE_CORNERS: ReadonlyArray<[Direction, Direction]> = [
  ['S', 'W'],
  ['N', 'W'],
  ['N', 'E'],
  ['E', 'S']
];
const ASTRAL_CODE_POINT = 0x1f41f;
const ACCENT_CODE_POINT = 0xe9;
const CONTROL_CODE_POINT = 0x01;
const ASCII_ONLY = /^[\x20-\x7e]*$/;

function emptyCell(): Cc3dCell {
  return { terrain: [{ ...FLOOR }], panels: [], item: null };
}

/** A grid of plain floor, with the given stacks laid out in reading order from the top left. */
function levelWith(stacks: readonly Cc3dTerrain[][], extra: Partial<Cc3dLevel> = {}): Cc3dLevel {
  const cells = Array.from({ length: GRID_WIDTH * GRID_HEIGHT }, emptyCell);
  stacks.forEach((stack, index) => {
    cells[index] = { terrain: stack.map((layer) => ({ ...layer })), panels: [], item: null };
  });
  return {
    width: GRID_WIDTH,
    height: GRID_HEIGHT,
    cells,
    mobs: [],
    player: { x: GRID_WIDTH - 1, y: GRID_HEIGHT - 1, dir: 'W' },
    mapId: MAP_ID,
    background: 2,
    ...extra
  };
}

function terrainOf(kind: Cc3dTerrainKind, rest: Omit<Cc3dTerrain, 'kind'> = {}): Cc3dTerrain {
  return { kind, ...rest };
}

/** Every terrain stack the model can hold once, base first. */
function everyStack(): Cc3dTerrain[][] {
  const stacks: Cc3dTerrain[][] = [];
  const base = (layer: Cc3dTerrain): void => {
    stacks.push([layer]);
  };
  for (const kind of ['floor', 'water', 'fire', 'ice', 'force_random', 'exit', 'slime', 'turtle', 'dirt', 'gravel', 'sand', 'teleport_blue', 'teleport_red'] as const) {
    base(terrainOf(kind));
  }
  for (const corner of ICE_CORNERS) base(terrainOf('ice_corner', { corner: [...corner] }));
  for (const dir of DIRECTIONS) base(terrainOf('force', { dir }));
  const onFloor = (layer: Cc3dTerrain): void => {
    stacks.push([{ ...FLOOR }, layer]);
  };
  for (const kind of ['bomb', 'trap', 'trap_control', 'clone_switch', 'golem_control_blue', 'golem_control_yellow', 'laser_controller', 'gate_tools', 'gate_keys'] as const) {
    onFloor(terrainOf(kind));
  }
  for (const dir of DIRECTIONS) onFloor(terrainOf('clone_machine', { dir }));
  for (const color of CC3D_COLORS) {
    onFloor(terrainOf('plate', { color }));
    onFloor(terrainOf('toggle_control', { color }));
    onFloor(terrainOf('door', { color }));
    onFloor(terrainOf('hold_door', { color }));
    onFloor(terrainOf('toggle_door', { color, open: false }));
    onFloor(terrainOf('toggle_door', { color, open: true }));
  }
  for (const kind of ['wall', 'socket', 'socket_red', 'push_up_wall', 'appearing_wall', 'false_wall'] as const) {
    onFloor(terrainOf(kind));
  }
  // Stacks of several layers.
  stacks.push([terrainOf('ice'), terrainOf('bomb'), terrainOf('door', { color: 'blue' })]);
  stacks.push([terrainOf('gravel'), terrainOf('wall')]);
  stacks.push([terrainOf('force', { dir: 'E' }), terrainOf('toggle_door', { color: 'green', open: true })]);
  stacks.push([terrainOf('sand'), terrainOf('plate', { color: 'red' })]);
  return stacks;
}

/** The fixture: every terrain, panels on every side, every item, every mob, the player. */
function fullLevel(): Cc3dLevel {
  const level = levelWith(everyStack(), { background: 0, player: { x: 3, y: 12, dir: 'E' } });
  const stackCount = everyStack().length;
  // Panels: each side alone, a pair, all four.
  const panelSets: Direction[][] = [['N'], ['E'], ['S'], ['W'], ['N', 'S'], ['E', 'W'], ['N', 'E', 'S', 'W']];
  panelSets.forEach((panels, index) => {
    level.cells[stackCount + index].panels = [...panels];
  });
  // Items, one per cell, on cells that also hold terrain, a panel, or nothing else.
  const items: Cc3dItem[] = CC3D_ITEM_KINDS.flatMap((kind): Cc3dItem[] => (kind === 'key' ? CC3D_COLORS.map((color) => ({ kind, color })) : [{ kind }]));
  items.forEach((item, index) => {
    level.cells[stackCount + panelSets.length + index].item = { ...item };
  });
  // Mobs in model order (not reading order): every kind, every facing in turn, on free floor cells.
  const mobStart = stackCount + panelSets.length + items.length;
  const specs: Array<Pick<Cc3dMob, 'kind' | 'color' | 'mirror'>> = [];
  for (const kind of CC3D_MOB_KINDS) {
    if (kind === 'block_color') for (const color of CC3D_COLORS) specs.push({ kind, color });
    else if (kind === 'reflector') for (const mirror of MIRRORS) specs.push({ kind, mirror });
    else specs.push({ kind });
  }
  // Model order that needs no section fallback: the mobs of the earlier sections first.
  const rankOf = (spec: Pick<Cc3dMob, 'kind' | 'color' | 'mirror'>): number => {
    const entry = CC3D_WRITE_INDEX.mob.get(mobKey(spec));
    return entry ? sectionRank(entry.sections[0]) : 0;
  };
  specs.sort((a, b) => rankOf(a) - rankOf(b));
  specs.forEach((spec, index) => {
    const cell = mobStart + (specs.length - 1 - index);
    const x = cell % GRID_WIDTH;
    const y = Math.floor(cell / GRID_WIDTH);
    level.mobs.push({ ...spec, x, y, dir: DIRECTIONS[index % DIRECTIONS.length] });
  });
  return level;
}

beforeEach(() => {
  loadTestConfigs();
});

function roundTrip(level: Cc3dLevel, meta = META): Cc3dLevel {
  const decoded = decodeCc3dLevel(encodeCc3dLevel(level, meta), { packName: 'pack', mapId: MAP_ID, number: 1 });
  return decoded.cc3d as Cc3dLevel;
}

describe('encodeCc3dLevel round trip', () => {
  it('gives back a canonical level with every kind exactly', () => {
    const level = fullLevel();
    expect(roundTrip(level)).toEqual(level);
  });

  it('covers every terrain kind, item kind and mob kind of the model', () => {
    const level = fullLevel();
    const kinds = new Set(level.cells.flatMap((cell) => cell.terrain.map((layer) => layer.kind)));
    const itemKinds = new Set(level.cells.flatMap((cell) => (cell.item ? [cell.item.kind] : [])));
    const mobKinds = new Set(level.mobs.map((mob) => mob.kind));
    const tableKinds = new Set<string>();
    const tableItems = new Set<string>();
    const tableMobs = new Set<string>();
    for (const entry of CC3D_ENTRY_BY_ID.values()) {
      if (entry.content.role === 'terrain') tableKinds.add(entry.content.terrain.kind);
      if (entry.content.role === 'item') tableItems.add(entry.content.item.kind);
      if (entry.content.role === 'mob') tableMobs.add(entry.content.spec.kind);
    }
    expect([...kinds].sort()).toEqual([...tableKinds].sort());
    expect([...itemKinds].sort()).toEqual([...tableItems].sort());
    expect([...mobKinds].sort()).toEqual([...tableMobs].sort());
  });

  it('keeps the background and writes 2 when the level has none', () => {
    expect(roundTrip(levelWith([], { background: 0 })).background).toBe(0);
    expect(roundTrip(levelWith([], { background: 5 })).background).toBe(5);
    expect(roundTrip(levelWith([])).background).toBe(2);
  });

  it('keeps each facing of the player and reads a missing one as west', () => {
    for (const dir of DIRECTIONS) expect(roundTrip(levelWith([], { player: { x: 1, y: 1, dir } })).player).toEqual({ x: 1, y: 1, dir });
    expect(roundTrip(levelWith([], { player: { x: 1, y: 1 } })).player).toEqual({ x: 1, y: 1, dir: 'W' });
  });

  it('keeps the model order of the mobs, whatever the reading order', () => {
    const level = levelWith([], {
      mobs: [
        { kind: 'bouncer', x: 5, y: 5, dir: 'S' },
        { kind: 'walker', x: 1, y: 1, dir: 'N' },
        { kind: 'omni', x: 9, y: 0, dir: 'E' },
        { kind: 'walker', x: 0, y: 8, dir: 'W' }
      ]
    });
    expect(roundTrip(level).mobs).toEqual(level.mobs);
  });

  it('keeps a mob standing on a clone machine, and the machine direction', () => {
    const level = levelWith([[FLOOR, terrainOf('clone_machine', { dir: 'S' })]], {
      mobs: [{ kind: 'limpa', x: 0, y: 0, dir: 'E' }]
    });
    expect(roundTrip(level)).toEqual(level);
  });

  it('writes a clone machine with no direction facing its template, else north', () => {
    const bare = terrainOf('clone_machine');
    const withTemplate = levelWith([[FLOOR, bare]], { mobs: [{ kind: 'limpa', x: 0, y: 0, dir: 'E' }] });
    expect(roundTrip(withTemplate).cells[0].terrain[1].dir).toBe('E');
    expect(roundTrip(levelWith([[FLOOR, bare]])).cells[0].terrain[1].dir).toBe('N');
  });

  it('keeps the stacking order of devices that share a cell', () => {
    const level = levelWith([[FLOOR, terrainOf('bomb'), terrainOf('plate', { color: 'red' }), terrainOf('clone_switch'), terrainOf('wall')]]);
    expect(roundTrip(level)).toEqual(level);
  });
});

describe('encodeCc3dLevel text', () => {
  const level = fullLevel();
  const xml = encodeCc3dLevel(level, META);

  it('is one pure-ASCII line with the declaration of the corpus', () => {
    expect(xml.startsWith(CC3D_XML_DECLARATION)).toBe(true);
    expect(CC3D_XML_DECLARATION).toBe('<?xml version="1.0" encoding="utf-16"?>');
    expect(ASCII_ONLY.test(xml)).toBe(true);
  });

  it('writes the root attributes and the tile attributes in the order of the corpus', () => {
    expect(xml).toContain('<map author="Someone" name="Fixture" height="16" width="16" background="0">');
    expect(xml).toMatch(/<tile image_index="\d+" x="\d+" y="\d+" direction="\d" type="\d+"><attributes flags="\d+" name="" \/><\/tile>/);
    expect(xml).not.toContain('editor_category');
  });

  it('writes the seven sections in order and self-closes the empty ones', () => {
    const empty = encodeCc3dLevel(levelWith([[FLOOR]], { player: { x: 0, y: 0, dir: 'W' } }), META);
    expect(empty).toContain('<objects /><enemies /><blocks /><walls /><switches /></map>');
    const names = parseXmlDocument(xml).children.map((child) => child.name);
    expect(names).toEqual([...CC3D_SECTIONS]);
  });

  it('writes the player alone in its section, with its facing', () => {
    const root = parseXmlDocument(xml);
    const player = root.children[0].children;
    expect(player).toHaveLength(1);
    expect(player[0].attrs.get('type')).toBe('22');
    expect(player[0].attrs.get('x')).toBe(String(3 * PIXELS_PER_CELL));
    expect(player[0].attrs.get('direction')).toBe('1');
  });

  it('writes the panels with the direction offset of the corpus', () => {
    const lone = levelWith([], {});
    lone.cells[0].panels = ['N', 'E', 'S', 'W'];
    const walls = parseXmlDocument(encodeCc3dLevel(lone, META)).children.find((child) => child.name === 'walls');
    const byType = new Map((walls?.children ?? []).map((tile) => [tile.attrs.get('type'), tile.attrs.get('direction')]));
    expect(byType.get('147')).toBe(String(PANEL_FILE_DIRECTION.N));
    expect(byType.get('148')).toBe(String(PANEL_FILE_DIRECTION.E));
    expect(byType.get('149')).toBe(String(PANEL_FILE_DIRECTION.S));
    expect(byType.get('150')).toBe(String(PANEL_FILE_DIRECTION.W));
    expect([...byType.values()]).toEqual(['3', '0', '1', '2']);
  });

  it('chooses the toggle door id by colour and state and sets the state bits', () => {
    const doors = (color: 'green' | 'blue' | 'red' | 'yellow', open: boolean) =>
      parseXmlDocument(encodeCc3dLevel(levelWith([[FLOOR, terrainOf('toggle_door', { color, open })]]), META))
        .children.find((child) => child.name === 'walls')!
        .children.map((tile) => [tile.attrs.get('type'), tile.children[0].attrs.get('flags')]);
    expect(doors('green', false)).toEqual([['14', '327680']]);
    expect(doors('green', true)).toEqual([['15', '327695']]);
    expect(doors('blue', false)).toEqual([['168', '327680']]);
    expect(doors('blue', true)).toEqual([['165', '327695']]);
    expect(doors('red', false)).toEqual([['169', '327680']]);
    expect(doors('red', true)).toEqual([['166', '327695']]);
    expect(doors('yellow', false)).toEqual([['170', '327680']]);
    expect(doors('yellow', true)).toEqual([['167', '327695']]);
  });

  it('writes colour blocks with their canonical ids 161 to 164', () => {
    const blocks = CC3D_COLORS.map((color): Cc3dMob => ({ kind: 'block_color', color, x: 0, y: 0, dir: 'N' }));
    const out = encodeCc3dLevel(levelWith([], { mobs: blocks }), META);
    const ids = [...out.matchAll(/type="(\d+)"/g)].map((m) => m[1]).filter((id) => id !== '1' && id !== '22');
    expect(ids.sort()).toEqual(['161', '162', '163', '164']);
  });

  it('leaves out the plain floor under the kinds the corpus never floors, and writes it elsewhere', () => {
    const typesIn = (stack: Cc3dTerrain[]): string[] => {
      const tiles = parseXmlDocument(encodeCc3dLevel(levelWith([stack]), META)).children.flatMap((s) => s.children);
      return tiles.filter((t) => t.attrs.get('x') === '0' && t.attrs.get('y') === '0').map((t) => t.attrs.get('type') as string);
    };
    expect(typesIn([FLOOR, terrainOf('wall')])).toEqual(['2']);
    expect(typesIn([FLOOR, terrainOf('door', { color: 'red' })])).toEqual(['1', '34']);
    expect(typesIn([FLOOR, terrainOf('clone_machine', { dir: 'N' })])).toEqual(['68']);
    expect(typesIn([FLOOR])).toEqual(['1']);
  });

  it('puts every type in a section its row lists', () => {
    const root = parseXmlDocument(xml);
    for (const section of root.children) {
      for (const tile of section.children) {
        const entry = CC3D_ENTRY_BY_ID.get(Number(tile.attrs.get('type')));
        expect(entry?.sections).toContain(section.name);
      }
    }
  });
});

describe('section fallback', () => {
  it('counts nothing when every tile can take its usual section', () => {
    const report = encodeCc3dLevelReport(fullLevel(), META);
    expect(report.fallbackCount).toBe(0);
    expect(report.alternateCount).toBe(0);
  });

  it('does not tie layers of different classes: a switch under a door needs no fallback', () => {
    const level = levelWith([[FLOOR, terrainOf('toggle_control', { color: 'red' }), terrainOf('door', { color: 'red' })]]);
    const report = encodeCc3dLevelReport(level, META);
    expect(report.fallbackCount + report.alternateCount).toBe(0);
    expect(roundTrip(level)).toEqual(level);
  });

  it('moves a mob to another section its type is stored in rather than before the mob ahead of it', () => {
    const level = levelWith([], {
      mobs: [
        { kind: 'walker', x: 1, y: 1, dir: 'N' },
        { kind: 'block_ice', x: 2, y: 2, dir: 'N' },
        { kind: 'block_dirt', x: 3, y: 3, dir: 'N' }
      ]
    });
    const report = encodeCc3dLevelReport(level, META);
    expect(report.alternateCount).toBe(1);
    expect(report.fallbackCount).toBe(0);
    const decoded = decodeCc3dLevel(report.xml, { packName: 'pack', mapId: MAP_ID, number: 1 }).cc3d as Cc3dLevel;
    expect(decoded.mobs).toEqual(level.mobs);
    const sections = parseXmlDocument(report.xml).children;
    expect(sections.find((s) => s.name === 'blocks')?.children.map((t) => t.attrs.get('type'))).toEqual(['26', '23']);
  });

  it('falls back to the previous section when the kind has no later one, and keeps the order', () => {
    const level = levelWith([], {
      mobs: [
        { kind: 'block_dirt', x: 1, y: 1, dir: 'N' },
        { kind: 'walker', x: 2, y: 2, dir: 'N' }
      ]
    });
    const report = encodeCc3dLevelReport(level, META);
    expect(report.fallbackCount).toBe(1);
    const decoded = decodeCc3dLevel(report.xml, { packName: 'pack', mapId: MAP_ID, number: 1 }).cc3d as Cc3dLevel;
    expect(decoded.mobs).toEqual(level.mobs);
  });

  it('applies the same rule to the layers of one stacking class, and only inside a class', () => {
    // A trap lives in tiles only; after a bomb (objects) of the same class it cannot come earlier.
    const level = levelWith([[FLOOR, terrainOf('bomb'), terrainOf('trap')]]);
    const report = encodeCc3dLevelReport(level, META);
    expect(report.fallbackCount).toBe(1);
    expect(roundTrip(level)).toEqual(level);
  });
});

describe('escaping', () => {
  it('escapes the markup characters and writes the white space controls as references', () => {
    expect(escapeCc3dAttribute('a&b<c>d"e\'f')).toBe("a&amp;b&lt;c&gt;d&quot;e'f");
    expect(escapeCc3dAttribute('a\tb\nc\rd')).toBe('a&#9;b&#10;c&#13;d');
  });

  it('drops other control characters and unpaired surrogates', () => {
    expect(escapeCc3dAttribute(`a${String.fromCodePoint(CONTROL_CODE_POINT)}b\u007fc\ud800d`)).toBe('abcd');
  });

  it('writes one reference per code point, an astral one included', () => {
    const accent = String.fromCodePoint(ACCENT_CODE_POINT);
    const fish = String.fromCodePoint(ASTRAL_CODE_POINT);
    expect(escapeCc3dAttribute(`${accent}${fish}`)).toBe(`&#${ACCENT_CODE_POINT};&#${ASTRAL_CODE_POINT};`);
  });

  it('reads back the title and the author through the importer', () => {
    const fish = String.fromCodePoint(ASTRAL_CODE_POINT);
    const accent = String.fromCodePoint(ACCENT_CODE_POINT);
    const name = `Q&A <"x"> '${accent}${fish}'\tline\nnext\rend`;
    const author = `${accent}uthor & co`;
    const xml = encodeCc3dLevel(levelWith([]), { name, author });
    expect(ASCII_ONLY.test(xml)).toBe(true);
    const decoded = decodeCc3dLevel(xml, { packName: 'pack', mapId: MAP_ID, number: 1 });
    expect(decoded.customTitle).toBe(name);
    expect(decoded.author).toBe(author);
  });

  it('writes an empty title and author as empty attributes the importer reads as none', () => {
    const decoded = decodeCc3dLevel(encodeCc3dLevel(levelWith([]), { name: '', author: '' }), { packName: 'pack', mapId: MAP_ID, number: 1 });
    expect(decoded.customTitle).toBeUndefined();
    expect(decoded.author).toBeUndefined();
  });
});

describe('unencodable levels', () => {
  it('refuses the runtime-only laser shot', () => {
    const level = levelWith([], { mobs: [{ kind: 'shot', x: 0, y: 0, dir: 'N' }] });
    expect(() => encodeCc3dLevel(level, META)).toThrow(/no type id/);
  });
});
