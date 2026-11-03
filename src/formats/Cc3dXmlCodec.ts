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
 * Importer for community levels stored as one XML `<map>` per file. The bytes
 * are decoded by sniffing (the declared encoding is ignored), parsed by a
 * small strict XML reader written for this one shape, and turned into a
 * CompiledLevel of the 'cc3d' ruleset: the cc3d field carries the data the
 * engine reads, the usual layers carry display ids.
 */

import { ConfigRegistry } from '../config/ConfigRegistry';
import { DEFAULT_LEVEL_PASSWORD } from '../config/constants';
import type { LevelSizeBounds } from '../config/ConfigValidation';
import {
  type Cc3dCell,
  type Cc3dColor,
  type Cc3dItem,
  type Cc3dLevel,
  type Cc3dMob,
  type Cc3dMobKind,
  type Cc3dTerrain,
  type Cc3dTerrainKind,
  baseConflict,
  normalizeCell,
  terrainClass
} from '../core/cc3d/model';
import { deriveDisplayLayers } from '../core/cc3d/cc3dLayers';
import type { CompiledLevel, Direction } from '../core/types';

/** File extension of a level file. */
export const CC3D_XML_EXTENSION = '.xml';

/** i18n keys of import errors; the UI adds the strings. Params are listed per key. */
export const CC3D_ERROR_KEYS = {
  /** detail, position */
  malformedXml: 'cc3d.import.error.malformed_xml.label',
  /** (none) */
  invalidEncoding: 'cc3d.import.error.invalid_encoding.label',
  /** (none) */
  emptyInput: 'cc3d.import.error.empty_input.label',
  /** root */
  notMap: 'cc3d.import.error.not_map.label',
  /** element, attribute, value */
  badAttribute: 'cc3d.import.error.bad_attribute.label',
  /** width, height, min, max */
  badSize: 'cc3d.import.error.bad_size.label',
  /** id, name */
  unknownType: 'cc3d.import.error.unknown_type.label',
  /** id, x, y */
  offGrid: 'cc3d.import.error.off_grid.label',
  /** count */
  playerCount: 'cc3d.import.error.player_count.label',
  /** x, y */
  twoMobs: 'cc3d.import.error.two_mobs.label',
  /** x, y */
  twoItems: 'cc3d.import.error.two_items.label',
  /** x, y, first, second (type ids) */
  twoFloors: 'cc3d.import.error.two_floors.label',
  /** detail */
  unexpected: 'cc3d.import.error.unexpected.label'
} as const;

export type Cc3dImportErrorParams = Readonly<Record<string, string | number>>;

/** Raised when a level file cannot be imported; the UI translates `key` with `params`. */
export class Cc3dImportError extends Error {
  constructor(
    public readonly key: string,
    public readonly params: Cc3dImportErrorParams = {}
  ) {
    super(`${key} ${JSON.stringify(params)}`);
    this.name = 'Cc3dImportError';
  }
}

/** Pixels per cell in the file. */
const PIXELS_PER_CELL = 64;
/** Mask of the flag bits that carry the initial state of a toggle door. */
const TOGGLE_DOOR_STATE_MASK = 0b1111;
/** Id of the tile that marks the player start. */
const PLAYER_TYPE_ID = 22;
/** Id of the tile counted as a required fish. */
const FISH_TYPE_ID = 42;
/** Directions by the value of the direction attribute. */
const DIRECTIONS_BY_VALUE: readonly Direction[] = ['N', 'E', 'S', 'W'];
const PANEL_SIDE_ORDER: readonly Direction[] = ['N', 'E', 'S', 'W'];
/** Facing of the player when the file gives none. */
const DEFAULT_PLAYER_DIRECTION: Direction = 'W';
/** How many leading bytes are inspected to recognise UTF-16 without a byte order mark. */
const ENCODING_SNIFF_BYTES = 256;
/** Deepest element nesting accepted; the real shape is three levels deep. */
const XML_MAX_DEPTH = 16;
/** Separator between the pack name and the map id in a level id. */
const LEVEL_ID_SEPARATOR = '-';

const ROOT_ELEMENT = 'map';
const TILE_ELEMENT = 'tile';
const TILE_ATTRIBUTES_ELEMENT = 'attributes';
const ATTR_NAME = 'name';
const ATTR_AUTHOR = 'author';
const ATTR_WIDTH = 'width';
const ATTR_HEIGHT = 'height';
const ATTR_TYPE = 'type';
const ATTR_X = 'x';
const ATTR_Y = 'y';
const ATTR_DIRECTION = 'direction';
const ATTR_FLAGS = 'flags';

/* ------------------------------------------------------------------ */
/* Decoding of the bytes                                               */
/* ------------------------------------------------------------------ */

const UTF16_LE = 'utf-16le';
const UTF16_BE = 'utf-16be';
const UTF8 = 'utf-8';
const BOM_CHAR = '\uFEFF';
const BOM_FIRST_BYTE_LE = 0xff;
const BOM_FIRST_BYTE_BE = 0xfe;

function decodeStrict(bytes: Uint8Array, label: string): string {
  try {
    return new TextDecoder(label, { fatal: true }).decode(bytes);
  } catch {
    throw new Cc3dImportError(CC3D_ERROR_KEYS.invalidEncoding);
  }
}

/** The encoding of the bytes: byte order mark first, then the NUL pattern of ASCII stored as UTF-16, else UTF-8. */
function sniffEncoding(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === BOM_FIRST_BYTE_LE && bytes[1] === BOM_FIRST_BYTE_BE) return UTF16_LE;
  if (bytes.length >= 2 && bytes[0] === BOM_FIRST_BYTE_BE && bytes[1] === BOM_FIRST_BYTE_LE) return UTF16_BE;
  const limit = Math.min(bytes.length, ENCODING_SNIFF_BYTES);
  let nulEven = 0;
  let nulOdd = 0;
  for (let i = 0; i < limit; i++) {
    if (bytes[i] !== 0) continue;
    if (i % 2 === 0) nulEven++;
    else nulOdd++;
  }
  if (nulOdd > 0 && nulEven === 0) return UTF16_LE;
  if (nulEven > 0 && nulOdd === 0) return UTF16_BE;
  return UTF8;
}

/** Decodes the bytes of a level file to text; the encoding declared in the file is ignored. */
export function decodeCc3dText(input: ArrayBuffer | Uint8Array | string): string {
  if (typeof input === 'string') return input.startsWith(BOM_CHAR) ? input.slice(1) : input;
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length === 0) throw new Cc3dImportError(CC3D_ERROR_KEYS.emptyInput);
  // The decoder drops a leading byte order mark (UTF-8 included) on its own.
  const text = decodeStrict(bytes, sniffEncoding(bytes));
  return text.startsWith(BOM_CHAR) ? text.slice(1) : text;
}

/* ------------------------------------------------------------------ */
/* Strict XML reader                                                   */
/* ------------------------------------------------------------------ */

interface XmlElement {
  name: string;
  attrs: Map<string, string>;
  children: XmlElement[];
}

const XML_NAME = /[A-Za-z_:][A-Za-z0-9_:.-]*/y;
const XML_SPACE = /[ \t\r\n]/;
const XML_ENTITY = /&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g;
const XML_STRAY_AMPERSAND = /&(?!(?:#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);)/;
const PREDEFINED_ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const MAX_CODE_POINT = 0x10ffff;
const SURROGATE_MIN = 0xd800;
const SURROGATE_MAX = 0xdfff;
const HEX_PREFIX = '#x';
const DEC_PREFIX = '#';
const HEX_RADIX = 16;
const DEC_RADIX = 10;
const COMMENT_OPEN = '<!--';
const COMMENT_CLOSE = '-->';
const PI_OPEN = '<?';
const PI_CLOSE = '?>';
const CDATA_OPEN = '<![CDATA[';
const CDATA_CLOSE = ']]>';

function malformed(detail: string, position: number): Cc3dImportError {
  return new Cc3dImportError(CC3D_ERROR_KEYS.malformedXml, { detail, position });
}

function decodeEntities(raw: string, position: number): string {
  if (XML_STRAY_AMPERSAND.test(raw)) throw malformed('bad entity', position);
  return raw.replace(XML_ENTITY, (_match, body: string) => {
    if (body in PREDEFINED_ENTITIES) return PREDEFINED_ENTITIES[body];
    const code = body.startsWith(HEX_PREFIX)
      ? parseInt(body.slice(HEX_PREFIX.length), HEX_RADIX)
      : parseInt(body.slice(DEC_PREFIX.length), DEC_RADIX);
    const valid = code > 0 && code <= MAX_CODE_POINT && !(code >= SURROGATE_MIN && code <= SURROGATE_MAX);
    if (!valid) throw malformed('bad character reference', position);
    return String.fromCodePoint(code);
  });
}

/**
 * Parses one XML document: an optional declaration, comments, one root element.
 * Text content is ignored; attributes may use either quote; the five predefined
 * entities and numeric character references are decoded in attribute values.
 * DOCTYPE, CDATA outside elements, and any malformed markup are rejected.
 */
export function parseXmlDocument(text: string): XmlElement {
  let pos = 0;
  const len = text.length;
  let root: XmlElement | null = null;
  const stack: XmlElement[] = [];

  const skipSpace = (): void => {
    while (pos < len && XML_SPACE.test(text[pos])) pos++;
  };
  const skipPast = (terminator: string, what: string): void => {
    const end = text.indexOf(terminator, pos);
    if (end < 0) throw malformed(`unterminated ${what}`, pos);
    pos = end + terminator.length;
  };
  const readName = (what: string): string => {
    XML_NAME.lastIndex = pos;
    const match = XML_NAME.exec(text);
    if (!match) throw malformed(`expected ${what}`, pos);
    pos += match[0].length;
    return match[0];
  };

  while (pos < len) {
    if (text[pos] !== '<') {
      if (stack.length === 0) {
        if (!XML_SPACE.test(text[pos])) throw malformed('text outside the root element', pos);
        pos++;
      } else {
        const next = text.indexOf('<', pos);
        if (next < 0) throw malformed('unclosed element', pos);
        pos = next;
      }
      continue;
    }
    if (text.startsWith(COMMENT_OPEN, pos)) {
      pos += COMMENT_OPEN.length;
      skipPast(COMMENT_CLOSE, 'comment');
    } else if (text.startsWith(PI_OPEN, pos)) {
      pos += PI_OPEN.length;
      skipPast(PI_CLOSE, 'declaration');
    } else if (text.startsWith(CDATA_OPEN, pos)) {
      if (stack.length === 0) throw malformed('CDATA outside the root element', pos);
      pos += CDATA_OPEN.length;
      skipPast(CDATA_CLOSE, 'CDATA section');
    } else if (text.startsWith('<!', pos)) {
      throw malformed('unsupported declaration', pos);
    } else if (text.startsWith('</', pos)) {
      pos += 2;
      const name = readName('closing tag name');
      skipSpace();
      if (text[pos] !== '>') throw malformed('expected > in closing tag', pos);
      pos++;
      const open = stack.pop();
      if (!open || open.name !== name) throw malformed(`unexpected closing tag ${name}`, pos);
    } else {
      pos++;
      const element: XmlElement = { name: readName('tag name'), attrs: new Map(), children: [] };
      let selfClosed = false;
      for (;;) {
        const before = pos;
        skipSpace();
        const spaced = pos > before;
        if (pos >= len) throw malformed('unterminated tag', pos);
        if (text[pos] === '>') {
          pos++;
          break;
        }
        if (text.startsWith('/>', pos)) {
          pos += 2;
          selfClosed = true;
          break;
        }
        if (!spaced) throw malformed('expected whitespace before attribute', pos);
        const attrName = readName('attribute name');
        skipSpace();
        if (text[pos] !== '=') throw malformed('expected = after attribute name', pos);
        pos++;
        skipSpace();
        const quote = text[pos];
        if (quote !== '"' && quote !== "'") throw malformed('expected a quoted attribute value', pos);
        const end = text.indexOf(quote, pos + 1);
        if (end < 0) throw malformed('unterminated attribute value', pos);
        const rawValue = text.slice(pos + 1, end);
        if (rawValue.includes('<')) throw malformed('< in attribute value', pos);
        if (element.attrs.has(attrName)) throw malformed(`duplicate attribute ${attrName}`, pos);
        element.attrs.set(attrName, decodeEntities(rawValue, pos));
        pos = end + 1;
      }
      if (stack.length > 0) stack[stack.length - 1].children.push(element);
      else if (root) throw malformed('several root elements', pos);
      else root = element;
      if (!selfClosed) {
        if (stack.length >= XML_MAX_DEPTH) throw malformed('nesting too deep', pos);
        stack.push(element);
      }
    }
  }
  if (stack.length > 0) throw malformed('unclosed element', pos);
  if (!root) throw malformed('no root element', pos);
  return root;
}

/* ------------------------------------------------------------------ */
/* Reading the tiles                                                   */
/* ------------------------------------------------------------------ */

/** What the importer reads of one `<tile>`. */
interface TileData {
  type: number;
  x: number;
  y: number;
  /** Direction attribute, or null when absent. */
  direction: number | null;
  flags: number;
  name: string;
}

const INTEGER_PATTERN = /^-?[0-9]+$/;

function readInteger(element: string, attr: string, raw: string | undefined): number {
  if (raw === undefined || !INTEGER_PATTERN.test(raw.trim())) {
    throw new Cc3dImportError(CC3D_ERROR_KEYS.badAttribute, { element, attribute: attr, value: raw ?? '' });
  }
  return parseInt(raw.trim(), DEC_RADIX);
}

function readDirection(tile: TileData): Direction {
  const dir = tile.direction === null ? undefined : DIRECTIONS_BY_VALUE[tile.direction];
  if (!dir) {
    throw new Cc3dImportError(CC3D_ERROR_KEYS.badAttribute, {
      element: TILE_ELEMENT,
      attribute: ATTR_DIRECTION,
      value: tile.direction === null ? '' : tile.direction
    });
  }
  return dir;
}

function readTile(element: XmlElement): TileData {
  const type = readInteger(TILE_ELEMENT, ATTR_TYPE, element.attrs.get(ATTR_TYPE));
  const x = readInteger(TILE_ELEMENT, ATTR_X, element.attrs.get(ATTR_X));
  const y = readInteger(TILE_ELEMENT, ATTR_Y, element.attrs.get(ATTR_Y));
  const rawDirection = element.attrs.get(ATTR_DIRECTION);
  const direction = rawDirection === undefined ? null : readInteger(TILE_ELEMENT, ATTR_DIRECTION, rawDirection);
  const details = element.children.find((child) => child.name === TILE_ATTRIBUTES_ELEMENT);
  const rawFlags = details?.attrs.get(ATTR_FLAGS);
  const flags = rawFlags === undefined ? 0 : readInteger(TILE_ATTRIBUTES_ELEMENT, ATTR_FLAGS, rawFlags);
  return { type, x, y, direction, flags, name: details?.attrs.get(ATTR_NAME) ?? '' };
}

/* ------------------------------------------------------------------ */
/* Type id table                                                       */
/* ------------------------------------------------------------------ */

interface MobSpec {
  kind: Cc3dMobKind;
  color?: Cc3dColor;
  mirror?: string;
}

type TableEntry =
  | { role: 'terrain'; build: (tile: TileData) => Cc3dTerrain }
  | { role: 'panel'; side: Direction }
  | { role: 'item'; item: Cc3dItem }
  | { role: 'mob'; spec: MobSpec }
  | { role: 'player' };

const TYPE_TABLE = new Map<number, TableEntry>();

function terrainEntry(ids: readonly number[], build: (tile: TileData, index: number) => Cc3dTerrain): void {
  ids.forEach((id, index) => TYPE_TABLE.set(id, { role: 'terrain', build: (tile) => build(tile, index) }));
}
function plainTerrain(ids: readonly number[], kind: Cc3dTerrainKind): void {
  terrainEntry(ids, () => ({ kind }));
}
function coloredTerrain(kind: Cc3dTerrainKind, colorByIds: ReadonlyArray<readonly [Cc3dColor, readonly number[]]>): void {
  for (const [color, ids] of colorByIds) terrainEntry(ids, () => ({ kind, color }));
}
function itemEntry(ids: readonly number[], items: readonly Cc3dItem[]): void {
  ids.forEach((id, index) => TYPE_TABLE.set(id, { role: 'item', item: items[index] }));
}
function mobEntry(ids: readonly number[], specs: readonly MobSpec[]): void {
  ids.forEach((id, index) => TYPE_TABLE.set(id, { role: 'mob', spec: specs[index] }));
}

const ICE_CORNER_SIDES: ReadonlyArray<readonly [Direction, Direction]> = [
  ['S', 'W'],
  ['N', 'W'],
  ['N', 'E'],
  ['E', 'S']
];
const TOGGLE_DOOR_IDS: ReadonlyArray<readonly [Cc3dColor, readonly number[]]> = [
  ['green', [14, 15]],
  ['blue', [165, 168]],
  ['red', [166, 169]],
  ['yellow', [167, 170]]
];

plainTerrain([1], 'floor');
plainTerrain([2], 'wall');
plainTerrain([3], 'ice');
terrainEntry([4, 5, 6, 7], (_tile, index) => ({
  kind: 'ice_corner',
  corner: [ICE_CORNER_SIDES[index][0], ICE_CORNER_SIDES[index][1]]
}));
plainTerrain([8], 'water');
plainTerrain([9], 'fire');
// Force floors take their direction from the type; the attribute is noise.
terrainEntry([10, 11, 12, 13], (_tile, index) => ({ kind: 'force', dir: DIRECTIONS_BY_VALUE[index] }));
plainTerrain([70], 'force_random');
for (const [color, ids] of TOGGLE_DOOR_IDS) {
  // The initial state comes from the flag bits, never from the type id.
  terrainEntry(ids, (tile) => ({
    kind: 'toggle_door',
    color,
    open: (tile.flags & TOGGLE_DOOR_STATE_MASK) === TOGGLE_DOOR_STATE_MASK
  }));
}
coloredTerrain('toggle_control', [
  ['green', [31]],
  ['blue', [158]],
  ['red', [159]],
  ['yellow', [160]]
]);
coloredTerrain('plate', [
  ['blue', [154]],
  ['green', [155]],
  ['red', [156]],
  ['yellow', [157]]
]);
coloredTerrain('hold_door', [
  ['green', [175]],
  ['blue', [176]],
  ['red', [177]],
  ['yellow', [178]]
]);
plainTerrain([16], 'teleport_red');
plainTerrain([17], 'teleport_blue');
plainTerrain([20], 'exit');
plainTerrain([21], 'slime');
plainTerrain([30], 'gravel');
plainTerrain([198], 'sand');
plainTerrain([50], 'dirt');
coloredTerrain('door', [
  ['red', [34]],
  ['blue', [35]],
  ['yellow', [36]],
  ['green', [37]]
]);
plainTerrain([44], 'socket');
plainTerrain([199], 'socket_red');
plainTerrain([45], 'push_up_wall');
plainTerrain([46], 'appearing_wall');
plainTerrain([49], 'false_wall');
plainTerrain([63], 'gate_tools');
plainTerrain([138], 'gate_keys');
plainTerrain([64], 'bomb');
plainTerrain([65], 'trap');
plainTerrain([66], 'trap_control');
plainTerrain([57], 'clone_switch');
plainTerrain([32], 'golem_control_blue');
plainTerrain([100], 'golem_control_yellow');
plainTerrain([75], 'laser_controller');
plainTerrain([141], 'turtle');
TYPE_TABLE.set(68, { role: 'terrain', build: (tile) => ({ kind: 'clone_machine', dir: readDirection(tile) }) });

[147, 148, 149, 150].forEach((id, index) => TYPE_TABLE.set(id, { role: 'panel', side: PANEL_SIDE_ORDER[index] }));

itemEntry(
  [38, 39, 40, 41],
  [
    { kind: 'key', color: 'red' },
    { kind: 'key', color: 'blue' },
    { kind: 'key', color: 'yellow' },
    { kind: 'key', color: 'green' }
  ]
);
itemEntry([FISH_TYPE_ID, 43], [{ kind: 'fish' }, { kind: 'fish_extra' }]);
itemEntry(
  [59, 60, 61, 62, 144],
  [{ kind: 'orb_ice' }, { kind: 'orb_force' }, { kind: 'orb_fire' }, { kind: 'orb_water' }, { kind: 'orb_speed' }]
);

TYPE_TABLE.set(PLAYER_TYPE_ID, { role: 'player' });

mobEntry([23, 26], [{ kind: 'block_dirt' }, { kind: 'block_ice' }]);
mobEntry(
  [161, 162, 163, 164, 191, 192],
  [
    { kind: 'block_color', color: 'blue' },
    { kind: 'block_color', color: 'green' },
    { kind: 'block_color', color: 'red' },
    { kind: 'block_color', color: 'yellow' },
    { kind: 'block_color', color: 'green' },
    { kind: 'block_color', color: 'red' }
  ]
);
mobEntry(
  [184, 185, 186, 187],
  [
    { kind: 'reflector', mirror: 'LU' },
    { kind: 'reflector', mirror: 'DL' },
    { kind: 'reflector', mirror: 'UR' },
    { kind: 'reflector', mirror: 'RD' }
  ]
);
mobEntry([24, 196, 197], [{ kind: 'walker' }, { kind: 'legs_green' }, { kind: 'legs_red' }]);
mobEntry([25, 194], [{ kind: 'blinky' }, { kind: 'baby_blinky' }]);
mobEntry([51, 52, 53, 54], [{ kind: 'limpa' }, { kind: 'limpy' }, { kind: 'bouncer' }, { kind: 'omni' }]);
mobEntry([55, 56, 195, 87], [{ kind: 'snappy' }, { kind: 'screamer' }, { kind: 'baby_screamer' }, { kind: 'nibble' }]);
mobEntry([33, 99], [{ kind: 'golem_blue' }, { kind: 'golem_yellow' }]);
mobEntry([76], [{ kind: 'laser_shooter' }]);
mobEntry([72, 73, 190, 74], [{ kind: 'bot_static' }, { kind: 'bot_cw' }, { kind: 'bot_ccw' }, { kind: 'bot_multi' }]);

/* ------------------------------------------------------------------ */
/* Stacking                                                            */
/* ------------------------------------------------------------------ */

interface CellDraft {
  /** Terrain with the type id it came from, in document order. */
  terrain: Array<{ terrain: Cc3dTerrain; typeId: number }>;
  panels: Set<Direction>;
  item: Cc3dItem | null;
  hasMob: boolean;
}

function finishCell(draft: CellDraft, x: number, y: number): Cc3dCell {
  for (const entry of draft.terrain) {
    if (terrainClass(entry.terrain.kind) === undefined) {
      throw new Cc3dImportError(CC3D_ERROR_KEYS.unexpected, { detail: `no stacking class for ${entry.terrain.kind}` });
    }
  }
  const layers = draft.terrain.map((entry) => entry.terrain);
  const conflict = baseConflict(layers);
  if (conflict) {
    throw new Cc3dImportError(CC3D_ERROR_KEYS.twoFloors, {
      x,
      y,
      first: draft.terrain[conflict[0]].typeId,
      second: draft.terrain[conflict[1]].typeId
    });
  }
  return {
    terrain: normalizeCell(layers),
    panels: PANEL_SIDE_ORDER.filter((side) => draft.panels.has(side)),
    item: draft.item
  };
}

/* ------------------------------------------------------------------ */
/* Level                                                               */
/* ------------------------------------------------------------------ */

export interface Cc3dDecodeOptions {
  /** Name of the pack the level belongs to; part of the level id. */
  packName: string;
  /** Identifier of the map inside the pack (its file name stem). */
  mapId: string;
  /** Position of the level in the pack. */
  number: number;
  /** Size bounds; defaults to the grid configuration. */
  bounds?: LevelSizeBounds;
}

function cellCoordinate(raw: number, limit: number, tile: TileData): number {
  const cell = raw / PIXELS_PER_CELL;
  if (!Number.isInteger(cell) || cell < 0 || cell >= limit) {
    throw new Cc3dImportError(CC3D_ERROR_KEYS.offGrid, { id: tile.type, x: tile.x, y: tile.y });
  }
  return cell;
}

function collectTiles(root: XmlElement): TileData[] {
  const tiles: TileData[] = [];
  for (const section of root.children) {
    for (const child of section.children) {
      if (child.name === TILE_ELEMENT) tiles.push(readTile(child));
    }
  }
  return tiles;
}

/** Imports one level file. Throws Cc3dImportError when the file cannot be imported. */
export function decodeCc3dLevel(input: ArrayBuffer | Uint8Array | string, options: Cc3dDecodeOptions): CompiledLevel {
  const root = parseXmlDocument(decodeCc3dText(input));
  if (root.name !== ROOT_ELEMENT) throw new Cc3dImportError(CC3D_ERROR_KEYS.notMap, { root: root.name });
  const width = readInteger(ROOT_ELEMENT, ATTR_WIDTH, root.attrs.get(ATTR_WIDTH));
  const height = readInteger(ROOT_ELEMENT, ATTR_HEIGHT, root.attrs.get(ATTR_HEIGHT));
  const bounds = options.bounds ?? ConfigRegistry.getLevelSizeBounds();
  const sizeOk = [width, height].every((side) => side >= bounds.minSize && side <= bounds.maxSize);
  if (!sizeOk) {
    throw new Cc3dImportError(CC3D_ERROR_KEYS.badSize, { width, height, min: bounds.minSize, max: bounds.maxSize });
  }

  const drafts: CellDraft[] = Array.from({ length: width * height }, () => ({
    terrain: [],
    panels: new Set<Direction>(),
    item: null,
    hasMob: false
  }));
  const mobs: Cc3dMob[] = [];
  const players: Array<{ x: number; y: number; dir: Direction }> = [];
  let fishCount = 0;

  for (const tile of collectTiles(root)) {
    const entry = TYPE_TABLE.get(tile.type);
    if (!entry) throw new Cc3dImportError(CC3D_ERROR_KEYS.unknownType, { id: tile.type, name: tile.name });
    const x = cellCoordinate(tile.x, width, tile);
    const y = cellCoordinate(tile.y, height, tile);
    const draft = drafts[y * width + x];
    switch (entry.role) {
      case 'terrain':
        draft.terrain.push({ terrain: entry.build(tile), typeId: tile.type });
        break;
      case 'panel':
        draft.panels.add(entry.side);
        break;
      case 'item':
        if (draft.item) throw new Cc3dImportError(CC3D_ERROR_KEYS.twoItems, { x, y });
        draft.item = { ...entry.item };
        if (tile.type === FISH_TYPE_ID) fishCount++;
        break;
      case 'mob':
        if (draft.hasMob) throw new Cc3dImportError(CC3D_ERROR_KEYS.twoMobs, { x, y });
        draft.hasMob = true;
        mobs.push({ ...entry.spec, x, y, dir: readDirection(tile) });
        break;
      case 'player':
        players.push({ x, y, dir: (tile.direction !== null && DIRECTIONS_BY_VALUE[tile.direction]) || DEFAULT_PLAYER_DIRECTION });
        break;
    }
  }
  if (players.length !== 1) throw new Cc3dImportError(CC3D_ERROR_KEYS.playerCount, { count: players.length });
  const start = players[0];

  const cells = drafts.map((draft, index) => finishCell(draft, index % width, Math.floor(index / width)));
  const cc3d: Cc3dLevel = { width, height, cells, mobs, player: { x: start.x, y: start.y, dir: start.dir }, mapId: options.mapId };

  const { terrain, items, entities } = deriveDisplayLayers(cc3d);

  const name = root.attrs.get(ATTR_NAME) ?? '';
  const author = root.attrs.get(ATTR_AUTHOR) ?? '';
  const level: CompiledLevel = {
    id: `${options.packName}${LEVEL_ID_SEPARATOR}${options.mapId}`,
    ruleset: 'cc3d',
    cc3d,
    number: options.number,
    password: DEFAULT_LEVEL_PASSWORD,
    timeLimitSeconds: 0,
    chipsRequired: fishCount,
    playerStart: { x: start.x, y: start.y, dir: start.dir },
    terrain,
    items,
    entities,
    trapLinks: [],
    cloneLinks: []
  };
  if (name !== '') level.customTitle = name;
  if (author !== '') level.author = author;
  return level;
}

/* ------------------------------------------------------------------ */
/* Pack of files                                                       */
/* ------------------------------------------------------------------ */

export interface Cc3dFile {
  name: string;
  bytes: ArrayBuffer | Uint8Array | string;
}

export interface Cc3dImportFailure {
  name: string;
  error: Cc3dImportError;
}

export interface Cc3dImportResult {
  levels: CompiledLevel[];
  failures: Cc3dImportFailure[];
}

const PATH_SEPARATOR = /[\\/]/;
const DIGIT_RUN = /[0-9]+/;

/** File name without its directory and extension: the map id. */
function mapIdOf(fileName: string): string {
  const base = fileName.split(PATH_SEPARATOR).pop() ?? fileName;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

function mapNumberOf(mapId: string): number | null {
  const match = DIGIT_RUN.exec(mapId);
  return match ? parseInt(match[0], DEC_RADIX) : null;
}

function compareText(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

/**
 * Imports a set of level files. Files are ordered by the number in their name
 * (the map id), those without a number last, ties and the rest by file name;
 * the level number is the position among the files that imported.
 */
export function decodeCc3dFiles(files: readonly Cc3dFile[], packName: string): Cc3dImportResult {
  const ordered = files
    .map((file) => ({ file, mapId: mapIdOf(file.name), order: mapNumberOf(mapIdOf(file.name)) }))
    .sort((a, b) => {
      if (a.order !== null && b.order !== null && a.order !== b.order) return a.order - b.order;
      if ((a.order === null) !== (b.order === null)) return a.order === null ? 1 : -1;
      return compareText(a.file.name, b.file.name);
    });
  const levels: CompiledLevel[] = [];
  const failures: Cc3dImportFailure[] = [];
  for (const { file, mapId } of ordered) {
    try {
      levels.push(decodeCc3dLevel(file.bytes, { packName, mapId, number: levels.length + 1 }));
    } catch (err) {
      const error =
        err instanceof Cc3dImportError
          ? err
          : new Cc3dImportError(CC3D_ERROR_KEYS.unexpected, { detail: err instanceof Error ? err.message : String(err) });
      failures.push({ name: file.name, error });
    }
  }
  return { levels, failures };
}
