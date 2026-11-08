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

import { DEFAULT_LEVEL_PASSWORD } from '../config/constants';
import {
  CC2_COVERAGE,
  KEY_CANOPY,
  KEY_MULTIPLE_PLAYERS,
  KEY_STEEL_WALL_DESTROYER,
  KEY_UNKNOWN,
  KEY_WIRE,
  KEY_WIRE_TUNNEL,
  classifyCc2Level
} from '../core/cc2/cc2Coverage';
import type {
  Cc2Coverage,
  CellEdge,
  CloneLink,
  CompiledLevel,
  Direction,
  EntityPlacement,
  TrapLink
} from '../core/types';
import {
  CC2_CODE_COMPUTER_CHIP,
  CC2_CODE_DIRECTIONAL_BLOCK,
  CC2_CODE_NO_SIGN,
  CC2_CODE_PLAYER,
  CC2_CODE_THIN_WALL,
  CC2_CODE_THIN_WALL_E,
  CC2_CODE_THIN_WALL_S,
  CC2_CODE_THIN_WALL_SE,
  CC2_CODE_TRACK,
  cc2TileInfo
} from './cc2TileTable';
import type { Cc2Cell, Cc2File, Cc2Map, Cc2Tile } from './cc2Model';
import { Cc2Layer, cc2Map, cc2Options, cc2Text } from './cc2Model';
import {
  CC2_CODE_MELINDA,
  COUNTER_GATE,
  DIRT_BLOCK_ID,
  ENTITY_MAP,
  FLOOR_ID,
  GENDER_SIGN_MAP,
  ITEM_LOST_KEYS,
  ITEM_MAP,
  KEY_NO_SIGN,
  KEY_NO_SIGN_EMPTY,
  NAND_GATE,
  NO_SIGN_FORBID_MAP,
  RESERVED_PLAYER_ENTITIES,
  TERRAIN_MAP,
  TRACK_JUNCTION,
  UNKNOWN_ID,
  UNKNOWN_KEY
} from './cc2Mapping';
import type { Cc2TileMapping } from './cc2Mapping';
import { buildCc2Wires, decodeCc2Gate } from './cc2Wires';

/**
 * Converts a decoded CC2 level to a native Epoxy level. Pure and deterministic; the input is never mutated. What Epoxy
 * cannot play is kept as a reserved cc2_* placeholder (or dropped when no placeholder exists), and every such element
 * is named in the coverage of the level. The converter does not replay anything: coverage says what the mapping
 * guarantees, the replay check of the importer says whether it is enough.
 */

/** Facing byte of an actor to direction: 0 north, 1 east, 2 south, 3 west (the order seen on the official levels). */
const DIRECTIONS: readonly Direction[] = ['N', 'E', 'S', 'W'];
const DEFAULT_ACTOR_DIR: Direction = 'S';
const DIRECTION_MASK = 0x03;
/** Edge and arrow bits: north 1, east 2, south 4, west 8. */
const SIDE_BITS: readonly number[] = [0x01, 0x02, 0x04, 0x08];
const CANOPY_BIT = 0x10;
const QUARTER_TURN = 1;
const HALF_TURN = 2;
const DIRECTION_COUNT = 4;
const DEFAULT_ID_PREFIX = 'cc2';
const EPOXY_RULESET = 'epoxy';
const KEY_ARROW_BLOCK = 'arrow_block';
const KEY_ARROW_BLOCK_LOCKED = 'arrow_block_locked';
const KEY_ARROW_BLOCK_CROSS = 'arrow_block_cross';
const WIRED_SINK_KEYS: Readonly<Record<string, string>> = { trap: 'wired_trap', flame_jet: 'wired_flame_jet' };

/** Track segments in the low bits of the track modifier (bit order not verified against a reference). */
const TRACK_SEGMENTS: ReadonlyArray<{ bit: number; id: string }> = [
  { bit: 0x01, id: 'rail_nw' },
  { bit: 0x02, id: 'rail_ne' },
  { bit: 0x04, id: 'rail_se' },
  { bit: 0x08, id: 'rail_sw' },
  { bit: 0x10, id: 'rail_ew' },
  { bit: 0x20, id: 'rail_ns' }
];
const TRACK_SEGMENT_MASK = 0x3f;
const TRACK_KEY = 'track';
const WIRED_TELEPORT_CODE = 0x11;
const WIRED_TELEPORT_KEY = 'teleport_blue_wired';
const WIRE_NIBBLE_MASK = 0x0f;

/** Codes the converter reads by themselves. */
const CODE_TRAP = 0x42;
const CODE_OPEN_TRAP = 0x41;
const CODE_CLONER_CC1 = 0x43;
const CODE_CLONER = 0x44;
const CODE_BUTTON_BROWN = 0x3a;
const CODE_BUTTON_RED = 0x39;
const CODE_LOGIC_GATE = 0x5c;
const CODE_STEEL_WALL = 0x50;
const CODE_DYNAMITE = 0x51;
const CODE_SOCKET = 0x2c;
const TELEPORT_FIRST = 0x10;
const TELEPORT_LAST = 0x13;
const TRANSMOGRIFIER = 0x4e;

const GATE_IDS: Readonly<Record<string, string>> = {
  not: 'signal_gate_not',
  and: 'signal_gate_and',
  or: 'signal_gate_or',
  xor: 'signal_gate_xor',
  latch: 'signal_latch_off'
};

/** Markers in the note block that start a hint. */
const CLUE_MARKER = '[CLUE]';
const HINT_SEPARATOR = '\n\n';

/** What the caller knows about the source file. */
export interface Cc2ConvertOptions {
  /** File name of the source level (as read from the folder or the game script). */
  file: string;
  /** Position of the level in the game script, 1-based. */
  order: number;
  /** SHA-256 (hex) of the source bytes. */
  sha256: string;
  /** Music track named by the game script. */
  music?: string;
  /** Prefix of the level id (default 'cc2'). */
  idPrefix?: string;
  /** Time limit in seconds, 0 when untimed. */
  timeLimit?: number;
  title?: string;
  author?: string;
  hint?: string;
}

/** One element of a verdict list in the report. */
export interface Cc2ReportEntry {
  key: string;
  reason: string;
}

/** Per-level report of a conversion. */
export interface Cc2ConversionReport {
  file: string;
  title: string;
  /** Worst verdict of the level. */
  verdict: Cc2Coverage['verdict'];
  /** Mechanics Epoxy plays exactly, sorted. */
  exact: string[];
  /** Mechanics Epoxy plays approximately. */
  approx: Cc2ReportEntry[];
  /** Mechanics Epoxy cannot play. */
  lost: Cc2ReportEntry[];
  /** What the converter did that a reader should know (dropped links, unsupported wire ends, uncertain rules). */
  warnings: string[];
}

export interface Cc2ConversionResult {
  level: CompiledLevel;
  report: Cc2ConversionReport;
  coverage: Cc2Coverage;
}

// ------------------------------------------------------------------ helpers

/** Direction of a facing byte. */
export function cc2Direction(byte: number | undefined): Direction {
  return byte === undefined ? DEFAULT_ACTOR_DIR : DIRECTIONS[byte & DIRECTION_MASK];
}

function turnClockwise(dir: Direction, quarterTurns: number): Direction {
  return DIRECTIONS[(DIRECTIONS.indexOf(dir) + quarterTurns) % DIRECTION_COUNT];
}

/** Sides of an edge or arrow mask, in N, E, S, W order. */
function sidesOf(mask: number): Direction[] {
  return DIRECTIONS.filter((_, i) => (mask & SIDE_BITS[i]) !== 0);
}

function layerOf(tile: Cc2Tile): Cc2Layer | undefined {
  return cc2TileInfo(tile.code)?.layer;
}

/** Stable text hash (cyrb53) rendered as 14 hex digits: not a security hash, only a change detector. */
function stableHash(text: string): string {
  const MULTIPLIER_A = 2654435761;
  const MULTIPLIER_B = 1597334677;
  const MIX_A = 2246822507;
  const MIX_B = 3266489909;
  const SHIFT_HIGH = 16;
  const SHIFT_MID = 13;
  const HASH_SEED_A = 0xdeadbeef;
  const HASH_SEED_B = 0x41c6ce57;
  const UINT_RANGE = 4294967296;
  const HIGH_MASK = 2097151;
  const HEX = 16;
  const HASH_DIGITS = 14;
  let h1 = HASH_SEED_A;
  let h2 = HASH_SEED_B;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, MULTIPLIER_A);
    h2 = Math.imul(h2 ^ ch, MULTIPLIER_B);
  }
  h1 = Math.imul(h1 ^ (h1 >>> SHIFT_HIGH), MIX_A) ^ Math.imul(h2 ^ (h2 >>> SHIFT_MID), MIX_B);
  h2 = Math.imul(h2 ^ (h2 >>> SHIFT_HIGH), MIX_A) ^ Math.imul(h1 ^ (h1 >>> SHIFT_MID), MIX_B);
  return (UINT_RANGE * (HIGH_MASK & h2) + (h1 >>> 0)).toString(HEX).padStart(HASH_DIGITS, '0');
}

/** The parts of a level the grid hash covers. */
export type Cc2GridParts = Pick<
  CompiledLevel,
  'terrain' | 'items' | 'entities' | 'trapLinks' | 'cloneLinks' | 'playerStart' | 'cellEdges' | 'signalLinks'
>;

/** Hash of the converted grid: terrain, items, entities, edges, links and the start. Titles and limits are outside. */
export function cc2GridHash(level: Cc2GridParts): string {
  return stableHash(
    JSON.stringify([
      level.terrain,
      level.items,
      level.entities.map((e) => [e.x, e.y, e.type, e.dir]),
      (level.cellEdges ?? []).map((e) => [e.x, e.y, e.sides]),
      level.trapLinks.map((l) => [l.buttonX, l.buttonY, l.trapX, l.trapY]),
      level.cloneLinks.map((l) => [l.buttonX, l.buttonY, l.clonerX, l.clonerY, l.templateType, l.templateDir]),
      (level.signalLinks ?? []).map((l) => [l.fromX, l.fromY, l.toX, l.toY]),
      [level.playerStart.x, level.playerStart.y, level.playerStart.dir]
    ])
  );
}

/** Hint text of a file: the CLUE block, else the [CLUE] blocks of the note. */
export function cc2HintText(file: Cc2File): string | undefined {
  const clue = cc2Text(file, 'CLUE')?.replace(/\r\n?/g, '\n').trim();
  if (clue) return clue;
  const note = cc2Text(file, 'NOTE')?.replace(/\r\n?/g, '\n');
  if (note === undefined || !note.includes(CLUE_MARKER)) return undefined;
  const blocks = note
    .split(CLUE_MARKER)
    .slice(1)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);
  return blocks.length > 0 ? blocks.join(HINT_SEPARATOR) : undefined;
}

/** Converts a whole decoded file: reads the map, the options and the texts, then converts the map. */
export function convertCc2File(file: Cc2File, options: Omit<Cc2ConvertOptions, 'timeLimit' | 'title' | 'author' | 'hint'>): Cc2ConversionResult {
  const map = cc2Map(file);
  if (map === undefined) throw new Error(`CC2 converter: ${options.file} holds no decodable map`);
  const title = cc2Text(file, 'TITL')?.trim();
  const author = cc2Text(file, 'AUTH')?.trim();
  const hint = cc2HintText(file);
  return convertCc2Map(map, {
    ...options,
    timeLimit: cc2Options(file)?.timeLimit ?? 0,
    ...(title ? { title } : {}),
    ...(author ? { author } : {}),
    ...(hint ? { hint } : {})
  });
}

// ------------------------------------------------------------------ cell reading

interface CellParts {
  terrain?: Cc2Tile;
  item?: Cc2Tile;
  actor?: Cc2Tile;
  panel?: Cc2Tile;
  noSign?: Cc2Tile;
}

function partsOf(cell: Cc2Cell): CellParts {
  const parts: CellParts = {};
  for (const tile of cell.tiles) {
    switch (layerOf(tile)) {
      case Cc2Layer.Terrain: parts.terrain = tile; break;
      case Cc2Layer.Item: parts.item = tile; break;
      case Cc2Layer.Actor: parts.actor = tile; break;
      case Cc2Layer.Panel: parts.panel = tile; break;
      case Cc2Layer.NoSign: parts.noSign = tile; break;
      default: break;
    }
  }
  return parts;
}

/** Epoxy rail piece of a track modifier, or null when it holds several segments (a junction or a switch). */
function trackMapping(mod: number | undefined): Cc2TileMapping {
  const segments = TRACK_SEGMENTS.filter((segment) => ((mod ?? 0) & TRACK_SEGMENT_MASK & segment.bit) !== 0);
  if (segments.length === 1) return { id: segments[0].id, key: TRACK_KEY };
  return TRACK_JUNCTION;
}

/** Arrow-block entity of a directional block. A four-arrow block moves like a dirt block (all pushes allowed). */
function directionalBlock(tile: Cc2Tile, warnings: string[], where: string): { type: string; dir: Direction; key?: string } {
  const arrows = (tile.arrows ?? 0) & WIRE_NIBBLE_MASK;
  const sides = sidesOf(arrows);
  const own = cc2Direction(tile.dir);
  if (sides.length === 0) {
    warnings.push(`directional block without arrows at ${where} cannot be pushed in CC2; played as a dirt block`);
    return { type: DIRT_BLOCK_ID, dir: own, key: KEY_ARROW_BLOCK_LOCKED };
  }
  if (sides.length === DIRECTION_COUNT) {
    warnings.push(`directional block with four arrows at ${where} played as a dirt block`);
    return { type: DIRT_BLOCK_ID, dir: own, key: KEY_ARROW_BLOCK_CROSS };
  }
  if (sides.length === 1) return { type: 'arrow_block_one', dir: sides[0] };
  if (sides.length === 3) {
    const missing = DIRECTIONS.find((dir) => !sides.includes(dir)) as Direction;
    return { type: 'arrow_block_tee', dir: turnClockwise(missing, HALF_TURN) };
  }
  // Two arrows: opposite ones make a line, adjacent ones a corner (forward and right).
  const first = sides[0];
  const second = sides[1];
  if (turnClockwise(first, HALF_TURN) === second) return { type: 'arrow_block_line', dir: first };
  // Adjacent: pick the facing whose clockwise neighbour is the other arrow.
  const forward = turnClockwise(first, QUARTER_TURN) === second ? first : second;
  return { type: 'arrow_block_corner', dir: forward };
}

// ------------------------------------------------------------------ the level

/** Converts a decoded map; see the module comment. */
export function convertCc2Map(map: Cc2Map, options: Cc2ConvertOptions): Cc2ConversionResult {
  const { width, height } = map;
  const keys = new Set<string>();
  const warnings: string[] = [];
  const terrain: string[][] = [];
  const items: (string | null)[][] = [];
  const entities: EntityPlacement[] = [];
  const edges: CellEdge[] = [];
  const traps: number[] = [];
  const cloners = new Map<number, { type: string; dir: Direction } | null>();
  const brownButtons: number[] = [];
  const redButtons: number[] = [];
  let chips = 0;
  let hasDynamite = false;
  let hasSocket = false;
  let hasSteelWall = false;
  let playerCount = 0;
  let playerIndex = -1;
  let playerTile: Cc2Tile | undefined;
  let wiredDevices = false;

  // The player is the first chip or Melinda in reading order; every other one is an inert placeholder.
  const parts: CellParts[] = map.cells.map(partsOf);
  parts.forEach((part, index) => {
    const code = part.actor?.code;
    if (code === CC2_CODE_PLAYER || code === CC2_CODE_MELINDA) {
      playerCount += 1;
      if (playerIndex < 0) {
        playerIndex = index;
        playerTile = part.actor;
      }
    }
  });

  for (let y = 0; y < height; y++) {
    const terrainRow: string[] = [];
    const itemRow: (string | null)[] = [];
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const part = index < parts.length ? parts[index] : undefined;
      const where = `${x},${y}`;
      if (part === undefined) {
        // Cells past an undecodable code.
        terrainRow.push(UNKNOWN_ID);
        itemRow.push(null);
        keys.add(UNKNOWN_KEY);
        continue;
      }

      let terrainId = FLOOR_ID;
      let itemId: string | null = null;

      // Terrain.
      const tile = part.terrain;
      if (tile !== undefined) {
        const code = tile.code;
        const mapping = terrainMapping(tile, warnings, where);
        terrainId = mapping.id;
        keys.add(mapping.key);
        if (code === CODE_SOCKET) hasSocket = true;
        if (code === CODE_STEEL_WALL) hasSteelWall = true;
        if (code === CODE_TRAP || code === CODE_OPEN_TRAP) traps.push(index);
        if (code === CODE_CLONER || code === CODE_CLONER_CC1) cloners.set(index, null);
        if (code === CODE_BUTTON_BROWN) brownButtons.push(index);
        if (code === CODE_BUTTON_RED) redButtons.push(index);
        if (code >= TELEPORT_FIRST && code <= TELEPORT_LAST && ((tile.mod ?? 0) & WIRE_NIBBLE_MASK) !== 0) {
          wiredDevices = true;
          if (code === WIRED_TELEPORT_CODE) {
            keys.delete(mapping.key);
            keys.add(WIRED_TELEPORT_KEY);
          }
        }
        if (code === TRANSMOGRIFIER && ((tile.mod ?? 0) & WIRE_NIBBLE_MASK) !== 0) wiredDevices = true;
        const sign = GENDER_SIGN_MAP.get(code);
        if (sign !== undefined) {
          terrainId = FLOOR_ID;
          itemId = sign.id;
          keys.add(sign.key);
        }
      } else {
        keys.add(UNKNOWN_KEY);
        terrainId = UNKNOWN_ID;
      }

      // Item.
      if (part.item !== undefined) {
        const code = part.item.code;
        const lostKey = ITEM_LOST_KEYS.get(code);
        const mapping = ITEM_MAP.get(code);
        if (lostKey !== undefined) keys.add(lostKey);
        else if (mapping !== undefined) {
          if (itemId !== null) warnings.push(`item at ${where} replaced by a gender sign`);
          else itemId = mapping.id;
          keys.add(mapping.key);
          if (code === CC2_CODE_COMPUTER_CHIP) chips += 1;
          if (code === CODE_DYNAMITE) hasDynamite = true;
        } else {
          keys.add(KEY_UNKNOWN);
          warnings.push(`item code 0x${code.toString(16)} at ${where} is not mapped`);
        }
      }

      // Hidden sign marker.
      if (part.noSign !== undefined && part.noSign.code === CC2_CODE_NO_SIGN) {
        const forbid = itemId !== null && terrainId === FLOOR_ID ? NO_SIGN_FORBID_MAP.get(itemId) : undefined;
        if (forbid !== undefined) {
          // The item is replaced by the forbid tile: it cannot be picked up, and carrying it bars the cell.
          terrainId = forbid.id;
          itemId = null;
          keys.add(forbid.key);
        } else if (itemId === null) keys.add(KEY_NO_SIGN_EMPTY);
        else keys.add(KEY_NO_SIGN);
      }

      // Panel: thin walls.
      if (part.panel !== undefined) {
        const panelCode = part.panel.code;
        let mask = 0;
        if (panelCode === CC2_CODE_THIN_WALL) mask = (part.panel.flags ?? 0) & WIRE_NIBBLE_MASK;
        else if (panelCode === CC2_CODE_THIN_WALL_S) mask = SIDE_BITS[2];
        else if (panelCode === CC2_CODE_THIN_WALL_E) mask = SIDE_BITS[1];
        else if (panelCode === CC2_CODE_THIN_WALL_SE) mask = SIDE_BITS[1] | SIDE_BITS[2];
        keys.add('thin_wall');
        if (panelCode === CC2_CODE_THIN_WALL && ((part.panel.flags ?? 0) & CANOPY_BIT) !== 0) keys.add(KEY_CANOPY);
        const sides = sidesOf(mask);
        if (sides.length > 0) edges.push({ x, y, sides });
      }

      // Actor.
      if (part.actor !== undefined) {
        const actor = part.actor;
        const code = actor.code;
        const isPlayer = code === CC2_CODE_PLAYER || code === CC2_CODE_MELINDA;
        if (isPlayer && index === playerIndex) {
          if (code === CC2_CODE_MELINDA) keys.add(RESERVED_PLAYER_ENTITIES.get(code)?.key ?? KEY_UNKNOWN);
        } else {
          const placed = actorEntity(actor, isPlayer, warnings, where);
          if (placed.key !== undefined) keys.add(placed.key);
          const terrainCode = part.terrain?.code;
          const dir = placed.dir;
          if (terrainCode === CODE_CLONER) {
            // The template keeps its own facing; the arrow only says where the clone may leave.
            const arrow = sidesOf((part.terrain?.mod ?? 0) & WIRE_NIBBLE_MASK);
            if (arrow.length > 0 && !arrow.includes(dir)) warnings.push(`clone machine arrow at ${where} differs from the template facing`);
          }
          entities.push({ x, y, type: placed.type, dir });
          if (terrainCode === CODE_CLONER || terrainCode === CODE_CLONER_CC1) cloners.set(index, { type: placed.type, dir });
        }
      }

      if (part.terrain?.code === CODE_LOGIC_GATE) {
        const gate = decodeCc2Gate(part.terrain.mod);
        if (gate.kind === 'unknown') {
          warnings.push(`gate kind 0x${(part.terrain.mod ?? 0).toString(16)} at ${where} is not known`);
        }
      }

      terrainRow.push(terrainId);
      itemRow.push(itemId);
    }
    terrain.push(terrainRow);
    items.push(itemRow);
  }

  // Players.
  let playerStart: CompiledLevel['playerStart'];
  if (playerTile === undefined) {
    playerStart = { x: 0, y: 0, dir: DEFAULT_ACTOR_DIR };
    warnings.push('no player found');
  } else {
    playerStart = {
      x: playerIndex % width,
      y: Math.floor(playerIndex / width),
      dir: cc2Direction(playerTile.dir)
    };
  }
  if (playerCount > 1) keys.add(KEY_MULTIPLE_PLAYERS);

  // Trap and clone links: a button works the first trap or clone machine after it in reading order, wrapping round
  // [medium confidence: this is the CC2 rule as documented, not checked against the game].
  const total = width * height;
  const nextAfter = (from: number, candidates: readonly number[]): number | undefined => {
    const set = new Set(candidates);
    for (let step = 1; step <= total; step++) {
      const index = (from + step) % total;
      if (set.has(index)) return index;
    }
    return undefined;
  };
  const trapLinks: TrapLink[] = [];
  for (const button of brownButtons) {
    const trap = nextAfter(button, traps);
    if (trap === undefined) {
      warnings.push(`brown button at ${button % width},${Math.floor(button / width)} has no trap to work`);
      continue;
    }
    trapLinks.push({ buttonX: button % width, buttonY: Math.floor(button / width), trapX: trap % width, trapY: Math.floor(trap / width) });
  }
  const cloneLinks: CloneLink[] = [];
  const clonerIndexes = [...cloners.keys()];
  for (const button of redButtons) {
    const cloner = nextAfter(button, clonerIndexes);
    const template = cloner === undefined ? undefined : cloners.get(cloner);
    if (cloner === undefined) {
      warnings.push(`red button at ${button % width},${Math.floor(button / width)} has no clone machine to work`);
      continue;
    }
    if (template === null || template === undefined) {
      warnings.push(`clone machine at ${cloner % width},${Math.floor(cloner / width)} has no template`);
      continue;
    }
    cloneLinks.push({
      buttonX: button % width,
      buttonY: Math.floor(button / width),
      clonerX: cloner % width,
      clonerY: Math.floor(cloner / width),
      templateType: template.type,
      templateDir: template.dir
    });
  }

  // Wires.
  const wires = buildCc2Wires(map);
  warnings.push(...wires.warnings);
  for (const node of wires.unsupported) {
    warnings.push(`${node.end === 'source' ? 'source' : 'sink'} ${node.kind} at ${node.x},${node.y} is not played by Epoxy`);
    const wiredKey = WIRED_SINK_KEYS[node.kind];
    if (wiredKey !== undefined) keys.add(wiredKey);
  }
  if (wires.hasWires || wiredDevices) keys.add(KEY_WIRE);
  if (wires.hasTunnels) keys.add(KEY_WIRE_TUNNEL);

  if (chips > 0 && !hasSocket) warnings.push('chips placed but no socket: chips required is 0');

  // Structural keys.
  if (hasSteelWall && hasDynamite) keys.add(KEY_STEEL_WALL_DESTROYER);

  const coverage = classifyCc2Level(keys);
  const exact = [...keys].filter((key) => CC2_COVERAGE[key]?.level === 'exact').sort();
  const reasonOf = (key: string): string => CC2_COVERAGE[key]?.reason ?? CC2_COVERAGE[KEY_UNKNOWN].reason;

  const level: CompiledLevel = {
    id: `${options.idPrefix ?? DEFAULT_ID_PREFIX}_level_${options.order}`,
    ruleset: EPOXY_RULESET,
    number: options.order,
    ...(options.title ? { customTitle: options.title } : {}),
    ...(options.hint ? { customHint: options.hint } : {}),
    ...(options.author ? { author: options.author } : {}),
    password: DEFAULT_LEVEL_PASSWORD,
    timeLimitSeconds: options.timeLimit ?? 0,
    // The chip count gates the socket only (Epoxy checks it nowhere else), so a level without a socket asks for none.
    chipsRequired: hasSocket ? chips : 0,
    playerStart,
    terrain,
    items,
    entities,
    trapLinks,
    cloneLinks
  };
  if (edges.length > 0) level.cellEdges = edges;
  if (wires.links.length > 0) level.signalLinks = wires.links;
  level.cc2 = {
    v: 1,
    sha256: options.sha256,
    file: options.file,
    order: options.order,
    ...(options.music !== undefined ? { music: options.music } : {}),
    gridHash: cc2GridHash(level),
    coverage
  };

  return {
    level,
    coverage,
    report: {
      file: options.file,
      title: options.title ?? '',
      verdict: coverage.verdict,
      exact,
      approx: coverage.approx.map((key) => ({ key, reason: reasonOf(key) })),
      lost: coverage.lost.map((key) => ({ key, reason: reasonOf(key) })),
      warnings
    }
  };
}

/** The mapping of a terrain tile, with the cases that read the modifier. */
function terrainMapping(tile: Cc2Tile, warnings: string[], where: string): Cc2TileMapping {
  const code = tile.code;
  if (code === CC2_CODE_TRACK) return trackMapping(tile.mod);
  if (code === CODE_LOGIC_GATE) {
    const gate = decodeCc2Gate(tile.mod);
    if (gate.kind === 'nand') return NAND_GATE;
    if (gate.kind === 'counter') return COUNTER_GATE;
    if (gate.kind === 'unknown') return { id: UNKNOWN_ID, key: UNKNOWN_KEY };
    if (gate.kind === 'latch') warnings.push(`latch gate at ${where} played as the Epoxy latch [unverified]`);
    return { id: GATE_IDS[gate.kind], key: KEY_WIRE };
  }
  if (GENDER_SIGN_MAP.has(code)) return GENDER_SIGN_MAP.get(code) as Cc2TileMapping;
  const mapping = TERRAIN_MAP.get(code);
  if (mapping !== undefined) return mapping;
  warnings.push(`terrain code 0x${code.toString(16)} at ${where} is not mapped`);
  return { id: UNKNOWN_ID, key: UNKNOWN_KEY };
}

/** The entity an actor tile becomes. `key` is the coverage key the entity stands for. */
function actorEntity(
  actor: Cc2Tile,
  extraPlayer: boolean,
  warnings: string[],
  where: string
): { type: string; dir: Direction; key?: string } {
  const code = actor.code;
  const dir = cc2Direction(actor.dir);
  if (code === CC2_CODE_DIRECTIONAL_BLOCK) {
    const block = directionalBlock(actor, warnings, where);
    return { ...block, key: block.key ?? KEY_ARROW_BLOCK };
  }
  const reservedPlayer = RESERVED_PLAYER_ENTITIES.get(code);
  if (reservedPlayer !== undefined) return { type: reservedPlayer.id, dir, key: reservedPlayer.key };
  if (extraPlayer) {
    // A second chip: no reserved id of its own, the second-player stand-in is used.
    const stand = RESERVED_PLAYER_ENTITIES.get(CC2_CODE_MELINDA) as Cc2TileMapping;
    return { type: stand.id, dir, key: stand.key };
  }
  const mapping = ENTITY_MAP.get(code);
  if (mapping !== undefined) return { type: mapping.id, dir, key: mapping.key };
  warnings.push(`actor code 0x${code.toString(16)} at ${where} is not mapped`);
  return { type: DIRT_BLOCK_ID, dir, key: KEY_UNKNOWN };
}
