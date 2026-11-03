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
 * Exporter of a CC3D level to the XML file the community editor writes. The output follows the shape measured
 * on the 485 community files: the declaration as they have it, root attributes `author name height width
 * background`, tile attributes `image_index x y direction type`, one line, seven sections in a fixed order with
 * the empty ones self-closed, and pure ASCII. The decoder reads the result back to the same level.
 *
 * The `<attributes>` child of a tile carries the measured `flags` and an empty `name`: the editor labels and
 * palette categories the game's editor writes are not reproduced. Nothing here reads them (the importer takes the
 * flags of a toggle door and ignores the rest), so the child is kept only for its `flags`.
 */

import {
  type Cc3dCell,
  type Cc3dLevel,
  type Cc3dMob,
  type Cc3dTerrain,
  cellIndex,
  terrainClass
} from '../core/cc3d/model';
import type { Direction } from '../core/types';
import {
  ATTR_AUTHOR,
  ATTR_BACKGROUND,
  ATTR_DIRECTION,
  ATTR_FLAGS,
  ATTR_HEIGHT,
  ATTR_IMAGE_INDEX,
  ATTR_NAME,
  ATTR_TYPE,
  ATTR_WIDTH,
  ATTR_X,
  ATTR_Y,
  CC3D_SECTIONS,
  CC3D_WRITE_INDEX,
  DEFAULT_BACKGROUND,
  DEFAULT_PLAYER_DIRECTION,
  DIRECTIONS_BY_VALUE,
  DIRECTION_NONE,
  KINDS_WITHOUT_FLOOR_TILE,
  PANEL_FILE_DIRECTION,
  PIXELS_PER_CELL,
  ROOT_ELEMENT,
  TILE_ATTRIBUTES_ELEMENT,
  TILE_ELEMENT,
  TOGGLE_DOOR_STATE_MASK,
  itemKey,
  mobKey,
  sectionRank,
  terrainKey,
  type Cc3dSection,
  type Cc3dTypeEntry
} from './Cc3dTypeTable';

/** Output direction of a clone machine that has none and no template standing on it. */
const DEFAULT_MACHINE_DIRECTION: Direction = 'N';

/** Declaration line of the files, as the community editor writes it (the encoding it names is not the real one). */
export const CC3D_XML_DECLARATION = '<?xml version="1.0" encoding="utf-16"?>';

/** Text of a level that the file stores: the title and the author. */
export interface Cc3dEncodeMeta {
  name: string;
  author: string;
}

/**
 * The exported text, and how the order of the level was kept. `alternateCount` is the number of tiles written in
 * another section the community files also store their type in; `fallbackCount` is the number written in a
 * section the files never store their type in (the previous tile's), because no stored one came late enough.
 */
export interface Cc3dEncodeReport {
  xml: string;
  alternateCount: number;
  fallbackCount: number;
}

/* ------------------------------------------------------------------ */
/* Escaping                                                            */
/* ------------------------------------------------------------------ */

const TAB = 0x09;
const LINE_FEED = 0x0a;
const CARRIAGE_RETURN = 0x0d;
const ASCII_MIN_PRINTABLE = 0x20;
const ASCII_MAX_PRINTABLE = 0x7e;
const DELETE_CODE = 0x7f;
const SURROGATE_MIN = 0xd800;
const SURROGATE_MAX = 0xdfff;
/** The two code points XML forbids at the end of the basic plane. */
const NONCHARACTERS: ReadonlySet<number> = new Set([0xfffe, 0xffff]);
const PREDEFINED_ESCAPES: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
/** Characters that XML would normalise inside an attribute value, so they are written as numeric references. */
const NUMERIC_REFERENCE_CODES: ReadonlySet<number> = new Set([TAB, LINE_FEED, CARRIAGE_RETURN]);

function numericReference(code: number): string {
  return `&#${code};`;
}

/**
 * Escapes text for a double-quoted attribute value: the five-character set that needs it, tab, line feed and
 * carriage return as references, other control characters and unpaired surrogates dropped, and every
 * non-ASCII code point as one numeric reference. The result is pure ASCII.
 */
export function escapeCc3dAttribute(text: string): string {
  let out = '';
  for (const char of text) {
    const code = char.codePointAt(0) as number;
    if (char in PREDEFINED_ESCAPES) out += PREDEFINED_ESCAPES[char];
    else if (NUMERIC_REFERENCE_CODES.has(code)) out += numericReference(code);
    else if (code >= ASCII_MIN_PRINTABLE && code <= ASCII_MAX_PRINTABLE) out += char;
    else if (code < ASCII_MIN_PRINTABLE || code === DELETE_CODE) continue;
    else if ((code >= SURROGATE_MIN && code <= SURROGATE_MAX) || NONCHARACTERS.has(code)) continue;
    else out += numericReference(code);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Sections                                                            */
/* ------------------------------------------------------------------ */

interface SectionChoice {
  section: Cc3dSection;
  /** The section is not the usual one but another the type is stored in. */
  alternate: boolean;
  /** The section is one the type is never stored in: it only keeps the order. */
  fallback: boolean;
}

/**
 * The section for a tile that must not come earlier in the file than the one before it: its most frequent
 * section when that is not earlier, else the earliest of its other stored sections that is not (an alternate),
 * else the section of the previous tile (a fallback). The first tile of a sequence has no constraint.
 */
function chooseSection(entry: Cc3dTypeEntry, previous: Cc3dSection | undefined): SectionChoice {
  const preferred = entry.sections[0];
  if (previous === undefined || sectionRank(preferred) >= sectionRank(previous)) {
    return { section: preferred, alternate: false, fallback: false };
  }
  const later = entry.sections
    .filter((section) => sectionRank(section) >= sectionRank(previous))
    .sort((a, b) => sectionRank(a) - sectionRank(b));
  if (later.length > 0) return { section: later[0], alternate: true, fallback: false };
  return { section: previous, alternate: false, fallback: true };
}

/* ------------------------------------------------------------------ */
/* Tiles                                                               */
/* ------------------------------------------------------------------ */

interface PendingTile {
  section: Cc3dSection;
  /** Reading-order position of the cell. */
  position: number;
  xml: string;
}

function tileXml(entry: Cc3dTypeEntry, x: number, y: number, direction: number, flags: number): string {
  return (
    `<${TILE_ELEMENT} ${ATTR_IMAGE_INDEX}="${entry.id}" ${ATTR_X}="${x * PIXELS_PER_CELL}" ${ATTR_Y}="${y * PIXELS_PER_CELL}" ` +
    `${ATTR_DIRECTION}="${direction}" ${ATTR_TYPE}="${entry.id}">` +
    `<${TILE_ATTRIBUTES_ELEMENT} ${ATTR_FLAGS}="${flags}" ${ATTR_NAME}="" /></${TILE_ELEMENT}>`
  );
}

function directionValue(dir: Direction): number {
  return DIRECTIONS_BY_VALUE.indexOf(dir);
}

function missingRow(what: string): Error {
  return new Error(`CC3D export: no type id for ${what}`);
}

/** Output state of one export. */
class Writer {
  alternateCount = 0;
  fallbackCount = 0;
  readonly staticTiles: PendingTile[] = [];
  readonly mobTiles: PendingTile[] = [];

  constructor(private readonly level: Cc3dLevel) {}

  private place(entry: Cc3dTypeEntry, previous: Cc3dSection | undefined): Cc3dSection {
    const choice = chooseSection(entry, previous);
    if (choice.alternate) this.alternateCount++;
    if (choice.fallback) this.fallbackCount++;
    return choice.section;
  }

  /** The output direction of a clone machine: its own, else the facing of the template standing on it, else north. */
  private machineDirection(layer: Cc3dTerrain, x: number, y: number): number {
    if (layer.dir !== undefined) return directionValue(layer.dir);
    const template = this.level.mobs.find((mob) => mob.x === x && mob.y === y);
    return directionValue(template ? template.dir : DEFAULT_MACHINE_DIRECTION);
  }

  private terrainTile(layer: Cc3dTerrain, x: number, y: number, previous: Cc3dSection | undefined): { tile: PendingTile; section: Cc3dSection } {
    const entry = CC3D_WRITE_INDEX.terrain.get(terrainKey(layer));
    if (!entry) throw missingRow(`terrain ${layer.kind}`);
    const section = this.place(entry, previous);
    const flags = layer.kind === 'toggle_door' && layer.open === true ? entry.flags | TOGGLE_DOOR_STATE_MASK : entry.flags;
    const direction = layer.kind === 'clone_machine' ? this.machineDirection(layer, x, y) : DIRECTION_NONE;
    const position = cellIndex(this.level, x, y);
    return { tile: { section, position, xml: tileXml(entry, x, y, direction, flags) }, section };
  }

  addCell(cell: Cc3dCell, x: number, y: number): void {
    const position = cellIndex(this.level, x, y);
    const omitFloor = cell.terrain.slice(1).some((layer) => KINDS_WITHOUT_FLOOR_TILE.has(layer.kind));
    // Only layers of one stacking class keep their relative order through the importer, so the section order
    // is enforced inside a class, not across classes.
    const previousByClass = new Map<number, Cc3dSection>();
    cell.terrain.forEach((layer, index) => {
      if (index === 0 && omitFloor && layer.kind === 'floor') return;
      const stackClass = terrainClass(layer.kind) as number;
      const { tile, section } = this.terrainTile(layer, x, y, previousByClass.get(stackClass));
      previousByClass.set(stackClass, section);
      this.staticTiles.push(tile);
    });
    for (const side of cell.panels) {
      const entry = CC3D_WRITE_INDEX.panel.get(side);
      if (!entry) throw missingRow(`panel ${side}`);
      this.staticTiles.push({ section: entry.sections[0], position, xml: tileXml(entry, x, y, PANEL_FILE_DIRECTION[side], entry.flags) });
    }
    if (cell.item) {
      const entry = CC3D_WRITE_INDEX.item.get(itemKey(cell.item));
      if (!entry) throw missingRow(`item ${cell.item.kind}`);
      this.staticTiles.push({ section: entry.sections[0], position, xml: tileXml(entry, x, y, DIRECTION_NONE, entry.flags) });
    }
  }

  addPlayer(): void {
    const { x, y, dir } = this.level.player;
    const entry = CC3D_WRITE_INDEX.player;
    const facing = directionValue(dir ?? DEFAULT_PLAYER_DIRECTION);
    this.staticTiles.push({ section: entry.sections[0], position: cellIndex(this.level, x, y), xml: tileXml(entry, x, y, facing, entry.flags) });
  }

  /** The mobs in model order, each in a section not earlier than the one before it. */
  addMobs(): void {
    let previous: Cc3dSection | undefined;
    for (const mob of this.level.mobs) {
      const entry = CC3D_WRITE_INDEX.mob.get(mobKey(mob));
      if (!entry) throw missingRow(`mob ${mob.kind}`);
      const section = this.place(entry, previous);
      previous = section;
      this.mobTiles.push({ section, position: cellIndex(this.level, mob.x, mob.y), xml: tileXml(entry, mob.x, mob.y, mobDirection(mob), entry.flags) });
    }
  }
}

function mobDirection(mob: Cc3dMob): number {
  return directionValue(mob.dir);
}

/**
 * The tiles of one section: everything but mobs in reading order, mobs in model order, merged by position (a
 * tile that is not a mob first on a tie).
 */
function mergeSection(staticTiles: readonly PendingTile[], mobTiles: readonly PendingTile[]): string[] {
  // Array.prototype.sort is stable, so the stack order of a cell holds on equal positions.
  const fixed = [...staticTiles].sort((a, b) => a.position - b.position);
  const merged: string[] = [];
  let f = 0;
  let m = 0;
  while (f < fixed.length || m < mobTiles.length) {
    const takeMob = f >= fixed.length || (m < mobTiles.length && mobTiles[m].position < fixed[f].position);
    merged.push(takeMob ? mobTiles[m++].xml : fixed[f++].xml);
  }
  return merged;
}

/* ------------------------------------------------------------------ */
/* Level                                                               */
/* ------------------------------------------------------------------ */

function backgroundOf(level: Cc3dLevel): number {
  const value = level.background;
  return value !== undefined && Number.isInteger(value) && value >= 0 ? value : DEFAULT_BACKGROUND;
}

/**
 * Exports a level to the XML text of a level file, and reports how many tiles left their usual section to keep
 * the order of the level. Throws an Error for a level the file cannot hold (a kind with no type id).
 */
export function encodeCc3dLevelReport(level: Cc3dLevel, meta: Cc3dEncodeMeta): Cc3dEncodeReport {
  const writer = new Writer(level);
  for (let y = 0; y < level.height; y++) {
    for (let x = 0; x < level.width; x++) writer.addCell(level.cells[cellIndex(level, x, y)], x, y);
  }
  writer.addPlayer();
  writer.addMobs();

  const body = CC3D_SECTIONS.map((section) => {
    const tiles = mergeSection(
      writer.staticTiles.filter((tile) => tile.section === section),
      writer.mobTiles.filter((tile) => tile.section === section)
    );
    return tiles.length === 0 ? `<${section} />` : `<${section}>${tiles.join('')}</${section}>`;
  }).join('');

  const root =
    `<${ROOT_ELEMENT} ${ATTR_AUTHOR}="${escapeCc3dAttribute(meta.author)}" ${ATTR_NAME}="${escapeCc3dAttribute(meta.name)}" ` +
    `${ATTR_HEIGHT}="${level.height}" ${ATTR_WIDTH}="${level.width}" ${ATTR_BACKGROUND}="${backgroundOf(level)}">`;
  return { xml: `${CC3D_XML_DECLARATION}${root}${body}</${ROOT_ELEMENT}>`, alternateCount: writer.alternateCount, fallbackCount: writer.fallbackCount };
}

/** Exports a level to the XML text of a level file. */
export function encodeCc3dLevel(level: Cc3dLevel, meta: Cc3dEncodeMeta): string {
  return encodeCc3dLevelReport(level, meta).xml;
}
