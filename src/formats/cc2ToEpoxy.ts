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
  KEY_BUTTON_ORANGE_SHARED,
  KEY_CANOPY,
  KEY_HELMET_NO_SIGN,
  KEY_MULTIPLE_PLAYERS,
  KEY_WIRED_TELEPORT,
  KEY_WIRED_TRACK,
  KEY_WIRED_TRACK_UNLINKED,
  KEY_WIRED_TRANSMOGRIFIER,
  KEY_UNKNOWN,
  KEY_WIRE,
  KEY_WIRE_TUNNEL,
  classifyCc2Level
} from '../core/cc2/cc2Coverage';
import { CC2_ID_PREFIX, DEFAULT_PLAYER_CHARACTER, EXTRA_PLAYERS_MAX, LOCKED_ARROW_BLOCK_ID, MELINDA_CHARACTER, NO_SIGN_ITEM_IDS, NO_SIGN_ITEM_PREFIX, RAIL_JUNCTION_TILE_ID, SIGNAL_COUNTER_TILE_ID_PREFIX, SIGNAL_GATE_CC2_ID_SUFFIX, WIRE_FLOOR_TILE_ID } from '../core/coreConstants';
import type {
  Cc2Coverage,
  CellEdge,
  CellHint,
  CloneLink,
  CompiledLevel,
  Direction,
  EntityPlacement,
  ExtraPlayerStart,
  RailTrackCell,
  SignalLink,
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
import { Cc2Layer, Cc2OptionsSection, cc2Map, cc2Options, cc2Text } from './cc2Model';
import {
  CC2_CODE_MELINDA,
  DIRT_BLOCK_ID,
  WARD_ID,
  ENTITY_MAP,
  FLOOR_ID,
  GENDER_SIGN_MAP,
  ITEM_LOST_KEYS,
  ITEM_MAP,
  KEY_MELINDA_PLAYER,
  HINT_ID,
  KEY_NO_SIGN,
  KEY_NO_SIGN_BONUS,
  KEY_NO_SIGN_EMPTY,
  KEY_NO_SIGN_ITEM,
  KEY_NO_SIGN_NO_EFFECT,
  NO_SIGN_BLOCKED_TERRAIN,
  NO_SIGN_FORBID_MAP,
  NO_SIGN_INERT_ITEMS,
  NO_SIGN_NEVER_CARRIED_ITEMS,
  TERRAIN_MAP,
  UNKNOWN_ID,
  UNKNOWN_KEY,
  WIRED_FLAME_JET_OFF,
  WIRED_FLAME_JET_ON,
  WIRED_TELEPORT_RED_OFF,
  WIRED_TRANSMOGRIFIER_OFF,
  WIRED_TRAP
} from './cc2Mapping';
import type { Cc2TileMapping } from './cc2Mapping';
import { decodeCc2Track, isCc2Junction } from './cc2Tracks';
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
/** Offset of the blob behavior byte in the options section. */
const OPTIONS_BLOB_BEHAVIOR_AT = 24;
/** Offset of the use_cc1_boots byte in the options section (nonzero: the level plays with the CC1 boot rules and has no four-tool belt). */
const OPTIONS_USE_CC1_BOOTS_AT = 23;
/** Edge and arrow bits: north 1, east 2, south 4, west 8. */
const SIDE_BITS: readonly number[] = [0x01, 0x02, 0x04, 0x08];
const CANOPY_BIT = 0x10;
const QUARTER_TURN = 1;
const HALF_TURN = 2;
const DIRECTION_COUNT = 4;
const DEFAULT_ID_PREFIX = 'cc2';
const EPOXY_RULESET = 'epoxy';
const KEY_ARROW_BLOCK = 'arrow_block';
const KEY_ARROW_BLOCK_CROSS = 'arrow_block_cross';
const ARROW_BLOCK_CROSS_ID = 'arrow_block_cross';

/** Coverage keys of a track cell: a plain one segment track, and a junction (several segments or a switch). */
const TRACK_KEY = 'track';
const TRACK_JUNCTION_KEY = 'track_junction';
const WIRED_TELEPORT_CODE = 0x11;
const WIRED_TELEPORT_KEY = 'teleport_blue_wired';
const WIRE_NIBBLE_MASK = 0x0f;

/** Codes the converter reads by themselves. */
const CODE_TRAP = 0x42;
const CODE_OPEN_TRAP = 0x41;
const CODE_FLAME_JET_OFF = 0x5f;
const CODE_FLAME_JET_ON = 0x60;
const CODE_CLONER_CC1 = 0x43;
const CODE_CLONER = 0x44;
const CODE_BUTTON_BROWN = 0x3a;
const CODE_BUTTON_RED = 0x39;
const CODE_BUTTON_ORANGE = 0x61;
/** Steps of one side of the diamond search ring: north-west, south-west, south-east, north-east. */
const DIAMOND_STEPS: readonly (readonly [number, number])[] = [[-1, -1], [-1, 1], [1, 1], [1, -1]];
const HELMET_ID = 'helmet';
const CODE_LOGIC_GATE = 0x5c;
/** The lightning bolt item: while held, the player powers the wire nets of the floor they stand on. */
const CODE_LIGHTNING_BOLT = 0x62;
/** The counter gates are the modifiers 0x1e..0x27, the digit they start with plus 0x1e. */
const COUNTER_MODIFIER_BASE = 0x1e;
const KEY_COUNTER_GATE = 'counter_gate';
const KEY_NAND_GATE = 'nand_gate';
/** The CC2 green chip; counted toward the chip requirement like the computer chips [medium confidence]. */
const CODE_GREEN_CHIP = 0x84;
const CODE_SOCKET = 0x2c;
/** The custom floor and the custom wall: plain floor and wall tiles that bar ghosts, so their cells are listed. */
const CODE_CUSTOM_FLOOR = 0x6b;
const CODE_CUSTOM_WALL = 0x70;
const TELEPORT_FIRST = 0x10;
const TELEPORT_LAST = 0x13;
const TRANSMOGRIFIER = 0x4e;
const CODE_TELEPORT_RED = 0x10;

/**
 * The passable CC2 form of each gate (`<gate>_cc2`): a CC2 logic gate has no collision, so every actor walks through it.
 * The impassable gates stay for native levels.
 */
const GATE_IDS: Readonly<Record<string, string>> = {
  not: `signal_gate_not${SIGNAL_GATE_CC2_ID_SUFFIX}`,
  and: `signal_gate_and${SIGNAL_GATE_CC2_ID_SUFFIX}`,
  or: `signal_gate_or${SIGNAL_GATE_CC2_ID_SUFFIX}`,
  xor: `signal_gate_xor${SIGNAL_GATE_CC2_ID_SUFFIX}`,
  nand: `signal_gate_nand${SIGNAL_GATE_CC2_ID_SUFFIX}`,
  /** Both CC2 latches are data latches; the Epoxy toggle latch (signal_latch_off) is no longer what they become. */
  latch: `signal_gate_dlatch${SIGNAL_GATE_CC2_ID_SUFFIX}`,
  /** A diode passes its single input to its output: an OR gate with one input does the same. */
  diode: `signal_gate_or${SIGNAL_GATE_CC2_ID_SUFFIX}`
};

/** Tags of the note that start a block; only a [CLUE] block is a hint. */
const NOTE_TAG_PATTERN = /\[(CLUE|JETLIFE|COM)\]/;
const CLUE_TAG = 'CLUE';

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
  /** The level hint: shown by every hint tile that has no text of its own. */
  hint?: string;
  /** The text of each hint tile, in reading order of the tiles (row by row, left to right); tiles beyond it show the level hint. */
  hintBlocks?: readonly string[];
  /** The blob behavior byte of the options section (0 to 255); absent when the file has none. */
  blobBehavior?: number;
  /** The use_cc1_boots byte of the options section as a flag; absent when the file has none. */
  useCc1Boots?: boolean;
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
  'terrain' | 'items' | 'entities' | 'trapLinks' | 'cloneLinks' | 'playerStart' | 'cellEdges' | 'signalLinks' | 'railTracks'
>;

/** Hash of the converted grid: terrain, items, entities, edges, links and the start. Titles and limits are outside. */
export function cc2GridHash(level: Cc2GridParts): string {
  return stableHash(
    JSON.stringify([
      level.terrain,
      level.items,
      level.entities.map((e) => [e.x, e.y, e.type, e.dir]),
      (level.cellEdges ?? []).map((e) => (e.canopy === true ? [e.x, e.y, e.sides, true] : [e.x, e.y, e.sides])),
      level.trapLinks.map((l) => [l.buttonX, l.buttonY, l.trapX, l.trapY]),
      level.cloneLinks.map((l) => [l.buttonX, l.buttonY, l.clonerX, l.clonerY, l.templateType, l.templateDir]),
      (level.signalLinks ?? []).map((l) => [l.fromX, l.fromY, l.toX, l.toY]),
      [level.playerStart.x, level.playerStart.y, level.playerStart.dir],
      // Only a level with track cells carries them, so the hash of every other level stays as it was.
      ...(level.railTracks ? [level.railTracks.map((t) => [t.x, t.y, t.mask, t.active ?? null, t.entry ?? null])] : [])
    ])
  );
}

/**
 * The level hint of a file: the text of its CLUE section. The [CLUE] blocks of the note are not part of it: each one
 * belongs to one hint tile (see cc2ClueBlocks).
 */
export function cc2HintText(file: Cc2File): string | undefined {
  const clue = cc2Text(file, 'CLUE')?.replace(/\r\n?/g, '\n').trim();
  return clue ? clue : undefined;
}

/**
 * The hint texts of the note, in order of appearance. The note is split on the lines that hold a [CLUE], [JETLIFE] or
 * [COM] tag; the text before the first tag is the author's own comment, and only the [CLUE] blocks are hints (a
 * [JETLIFE] or [COM] block is not). Blocks are trimmed; an empty one is kept as an empty text, so the n-th block
 * still goes to the n-th hint tile. Empty when the note holds no [CLUE] block.
 */
export function cc2ClueBlocks(file: Cc2File): string[] {
  const note = cc2Text(file, 'NOTE')?.replace(/\r\n?/g, '\n');
  if (note === undefined) return [];
  const blocks: string[] = [];
  let current: string[] | null = null;
  const close = (): void => {
    if (current !== null) blocks.push(current.join('\n').trim());
    current = null;
  };
  for (const line of note.split('\n')) {
    const tag = NOTE_TAG_PATTERN.exec(line);
    if (tag === null) {
      current?.push(line);
      continue;
    }
    close();
    // The whole line holding a tag is the separator: any other text on it is ignored.
    current = tag[1] === CLUE_TAG ? [] : null;
  }
  close();
  return blocks;
}

/**
 * Gives the n-th text to the n-th hint tile in reading order (row by row, left to right). A tile beyond the texts, an
 * empty text and a text beyond the tiles give nothing, so those tiles show the level hint.
 */
function assignHintBlocks(terrain: readonly (readonly string[])[], blocks: readonly string[]): CellHint[] {
  const hints: CellHint[] = [];
  let next = 0;
  terrain.forEach((row, y) =>
    row.forEach((id, x) => {
      if (id !== HINT_ID) return;
      const text = blocks[next++];
      if (text) hints.push({ x, y, text });
    })
  );
  return hints;
}

/** Converts a whole decoded file: reads the map, the options and the texts, then converts the map. */
export function convertCc2File(file: Cc2File, options: Omit<Cc2ConvertOptions, 'timeLimit' | 'title' | 'author' | 'hint' | 'hintBlocks' | 'blobBehavior' | 'useCc1Boots'>): Cc2ConversionResult {
  const map = cc2Map(file);
  if (map === undefined) throw new Error(`CC2 converter: ${options.file} holds no decodable map`);
  const title = cc2Text(file, 'TITL')?.trim();
  const author = cc2Text(file, 'AUTH')?.trim();
  const hint = cc2HintText(file);
  const hintBlocks = cc2ClueBlocks(file);
  const optionsSection = file.sections.find((s): s is Cc2OptionsSection => s.kind === 'options');
  const blobBehavior = optionsSection !== undefined && optionsSection.raw.length > OPTIONS_BLOB_BEHAVIOR_AT ? optionsSection.raw[OPTIONS_BLOB_BEHAVIOR_AT] : undefined;
  const useCc1Boots = optionsSection !== undefined && optionsSection.raw.length > OPTIONS_USE_CC1_BOOTS_AT ? optionsSection.raw[OPTIONS_USE_CC1_BOOTS_AT] !== 0 : undefined;
  return convertCc2Map(map, {
    ...options,
    timeLimit: cc2Options(file)?.timeLimit ?? 0,
    ...(blobBehavior !== undefined ? { blobBehavior } : {}),
    ...(useCc1Boots !== undefined ? { useCc1Boots } : {}),
    ...(title ? { title } : {}),
    ...(author ? { author } : {}),
    ...(hint ? { hint } : {}),
    ...(hintBlocks.length > 0 ? { hintBlocks } : {})
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

/** The Epoxy track cell of a track modifier, with the coverage key of a plain track or a junction. */
function trackMapping(mod: number | undefined): Cc2TileMapping {
  return { id: RAIL_JUNCTION_TILE_ID, key: isCc2Junction(mod) ? TRACK_JUNCTION_KEY : TRACK_KEY };
}

/** Arrow-block entity of a directional block. A four-arrow block is the cross block. */
function directionalBlock(tile: Cc2Tile): { type: string; dir: Direction; key?: string } {
  const arrows = (tile.arrows ?? 0) & WIRE_NIBBLE_MASK;
  const sides = sidesOf(arrows);
  const own = cc2Direction(tile.dir);
  if (sides.length === 0) return { type: LOCKED_ARROW_BLOCK_ID, dir: own };
  if (sides.length === DIRECTION_COUNT) {
    return { type: ARROW_BLOCK_CROSS_ID, dir: own, key: KEY_ARROW_BLOCK_CROSS };
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
  const railTracks: RailTrackCell[] = [];
  const traps: number[] = [];
  const cloners = new Map<number, { type: string; dir: Direction } | null>();
  const brownButtons: number[] = [];
  const redButtons: number[] = [];
  const orangeButtons: number[] = [];
  const flameJets = new Set<number>();
  const ghostBarCells: number[] = [];
  let chips = 0;
  let hasSocket = false;
  let playerIndex = -1;
  let playerTile: Cc2Tile | undefined;
  const extraPlayers: ExtraPlayerStart[] = [];
  let wiredDevices = false;

  // The wires come first: a trap or flame jet that a wire reaches is placed in its wired form.
  // A lightning bolt makes the wire floors sources: the player holding it powers the nets of the floor they stand on.
  const hasLightningBolt = map.cells.some((cell) => cell.tiles.some((tile) => tile.code === CODE_LIGHTNING_BOLT));
  const wires = buildCc2Wires(map, { chargeFloors: hasLightningBolt });
  const chargeFloorCells = new Set((wires.chargeFloors ?? []).map((floor) => floor.y * width + floor.x));
  const wiredSinkCells = new Set(wires.wiredSinks.map((sink) => sink.y * width + sink.x));
  const linkedCells = new Set(wires.links.map((link) => link.toY * width + link.toX));

  // The player is the first chip or Melinda in reading order; every other one is an inert placeholder.
  const parts: CellParts[] = map.cells.map(partsOf);
  parts.forEach((part, index) => {
    const code = part.actor?.code;
    if (code === CC2_CODE_PLAYER || code === CC2_CODE_MELINDA) {
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
        const mapping = terrainMapping(tile, warnings, where, wiredSinkCells.has(index));
        terrainId = chargeFloorCells.has(index) ? WIRE_FLOOR_TILE_ID : mapping.id;
        keys.add(mapping.key);
        if (code === CODE_CUSTOM_FLOOR || code === CODE_CUSTOM_WALL) ghostBarCells.push(index);
        if (code === CC2_CODE_TRACK) railTracks.push({ x, y, ...decodeCc2Track(tile.mod) });
        if (code === CODE_SOCKET) hasSocket = true;
        if (code === CODE_TRAP || code === CODE_OPEN_TRAP) traps.push(index);
        if (code === CODE_CLONER || code === CODE_CLONER_CC1) cloners.set(index, null);
        if (code === CODE_BUTTON_BROWN) brownButtons.push(index);
        if (code === CODE_BUTTON_RED) redButtons.push(index);
        if (code === CODE_BUTTON_ORANGE) orangeButtons.push(index);
        if (code === CODE_FLAME_JET_OFF || code === CODE_FLAME_JET_ON) flameJets.add(index);
        // A red pad or a transmogrifier that a wire network reaches is played by its wire (off form, linked); every other
        // wired pad, and a wire nibble no network reaches, keeps the plain device and the key that says so.
        const wireFollowed = wiredSinkCells.has(index) && (code === CODE_TELEPORT_RED || code === TRANSMOGRIFIER);
        if (code >= TELEPORT_FIRST && code <= TELEPORT_LAST && ((tile.mod ?? 0) & WIRE_NIBBLE_MASK) !== 0) {
          wiredDevices = true;
          if (!wireFollowed) keys.add(KEY_WIRED_TELEPORT);
          if (code === WIRED_TELEPORT_CODE) {
            keys.delete(mapping.key);
            keys.add(WIRED_TELEPORT_KEY);
          }
        }
        if (code === TRANSMOGRIFIER && ((tile.mod ?? 0) & WIRE_NIBBLE_MASK) !== 0) {
          wiredDevices = true;
          if (!wireFollowed) keys.add(KEY_WIRED_TRANSMOGRIFIER);
        }
        if (code === CC2_CODE_TRACK && wiredSinkCells.has(index)) {
          wiredDevices = true;
          // Only a switch a link reaches is wire-only in Epoxy; a wire with no supported source leaves it moving on departure.
          keys.add(linkedCells.has(index) ? KEY_WIRED_TRACK : KEY_WIRED_TRACK_UNLINKED);
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
          itemId = mapping.id;
          keys.add(mapping.key);
          if (code === CC2_CODE_COMPUTER_CHIP || code === CODE_GREEN_CHIP) chips += 1;
        } else {
          keys.add(KEY_UNKNOWN);
          warnings.push(`item code 0x${code.toString(16)} at ${where} is not mapped`);
        }
      }

      // Hidden sign marker.
      if (part.noSign !== undefined && part.noSign.code === CC2_CODE_NO_SIGN) {
        // No sign tile exists for the helmet: it falls back to the ward, whose sign does.
        if (itemId === HELMET_ID && !NO_SIGN_ITEM_IDS.includes(HELMET_ID)) {
          itemId = WARD_ID;
          keys.add(KEY_HELMET_NO_SIGN);
        }
        const forbid = itemId !== null && terrainId === FLOOR_ID ? NO_SIGN_FORBID_MAP.get(itemId) : undefined;
        if (forbid !== undefined) {
          // The item is replaced by the forbid tile: it cannot be picked up, and carrying it bars the cell.
          terrainId = forbid.id;
          itemId = null;
          keys.add(forbid.key);
        } else if (itemId === null) keys.add(KEY_NO_SIGN_EMPTY);
        else if (NO_SIGN_BLOCKED_TERRAIN.has(terrainId) || NO_SIGN_NEVER_CARRIED_ITEMS.has(itemId)) {
          // A wall stops everyone and no player carries a chip or a bomb: the sign bars nobody, so it is dropped.
          keys.add(KEY_NO_SIGN_NO_EFFECT);
        } else if (
          NO_SIGN_ITEM_IDS.includes(itemId) &&
          !NO_SIGN_BLOCKED_TERRAIN.has(terrainId) &&
          !terrainId.startsWith(CC2_ID_PREFIX)
        ) {
          // The sign lies on the item layer: it cannot be picked up, bars a player carrying the item, and the terrain keeps working.
          itemId = `${NO_SIGN_ITEM_PREFIX}${itemId}`;
          keys.add(KEY_NO_SIGN_ITEM);
        } else if (NO_SIGN_INERT_ITEMS.has(itemId)) {
          itemId = null;
          keys.add(KEY_NO_SIGN_BONUS);
        } else keys.add(KEY_NO_SIGN);
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
        const canopy = panelCode === CC2_CODE_THIN_WALL && ((part.panel.flags ?? 0) & CANOPY_BIT) !== 0;
        if (canopy) keys.add(KEY_CANOPY);
        const sides = sidesOf(mask);
        if (sides.length > 0 || canopy) edges.push({ x, y, sides, ...(canopy ? { canopy: true as const } : {}) });
      }

      // Actor.
      if (part.actor !== undefined) {
        const actor = part.actor;
        const code = actor.code;
        const isPlayer = code === CC2_CODE_PLAYER || code === CC2_CODE_MELINDA;
        if (isPlayer && index === playerIndex) {
          // Melinda plays as the melinda character, whether she is alone or the first of several players.
          if (code === CC2_CODE_MELINDA) keys.add(KEY_MELINDA_PLAYER);
        } else if (isPlayer) {
          // Every further player is a start of its own, in reading order, with its character and facing.
          if (extraPlayers.length < EXTRA_PLAYERS_MAX) {
            extraPlayers.push({
              x,
              y,
              dir: cc2Direction(actor.dir),
              character: code === CC2_CODE_MELINDA ? MELINDA_CHARACTER : DEFAULT_PLAYER_CHARACTER
            });
          } else warnings.push(`player at ${where} is dropped: Epoxy plays at most ${EXTRA_PLAYERS_MAX + 1} players`);
          if (code === CC2_CODE_MELINDA) keys.add(KEY_MELINDA_PLAYER);
        } else {
          const placed = actorEntity(actor, warnings, where);
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
  if (extraPlayers.length > 0) keys.add(KEY_MULTIPLE_PLAYERS);
  const melindaFirst = playerTile?.code === CC2_CODE_MELINDA;

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

  // Orange buttons: each one toggles the flame jet CC2 connects it to (a diamond search from the button), on press and on
  // release. Epoxy links the pressure plate to that jet; a jet reached by another button or a wire has its sources ORed.
  const signalLinks: SignalLink[] = [...wires.links];
  const orangeLinkCount = new Map<number, number>();
  for (const button of orangeButtons) {
    const jet = findFlameJetByDiamond(button, width, height, flameJets);
    const bx = button % width;
    const by = Math.floor(button / width);
    if (jet === undefined) {
      warnings.push(`orange button at ${bx},${by} has no flame jet to work`);
      continue;
    }
    signalLinks.push({ fromX: bx, fromY: by, toX: jet % width, toY: Math.floor(jet / width) });
    orangeLinkCount.set(jet, (orangeLinkCount.get(jet) ?? 0) + 1);
  }
  for (const [jet, count] of orangeLinkCount) {
    if (count > 1 || linkedCells.has(jet)) {
      keys.add(KEY_BUTTON_ORANGE_SHARED);
      break;
    }
  }

  // Wires.
  warnings.push(...wires.warnings);
  for (const node of wires.unsupported) {
    warnings.push(`${node.end === 'source' ? 'source' : 'sink'} ${node.kind} at ${node.x},${node.y} is not played by Epoxy`);
  }
  if (wires.hasWires || wiredDevices) keys.add(KEY_WIRE);
  if (wires.hasTunnels) keys.add(KEY_WIRE_TUNNEL);

  if (chips > 0 && !hasSocket) warnings.push('chips placed but no socket: chips required is 0');

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
    ...(melindaFirst ? { character: MELINDA_CHARACTER } : {}),
    playerStart,
    terrain,
    items,
    entities,
    trapLinks,
    cloneLinks
  };
  if (edges.length > 0) level.cellEdges = edges;
  if (extraPlayers.length > 0) level.extraPlayers = extraPlayers;
  if (railTracks.length > 0) level.railTracks = railTracks;
  const cellHints = assignHintBlocks(terrain, options.hintBlocks ?? []);
  if (cellHints.length > 0) level.cellHints = cellHints;
  if (signalLinks.length > 0) level.signalLinks = signalLinks;
  level.rulesFlavor = 'cc';
  level.cc2 = {
    v: 1,
    sha256: options.sha256,
    file: options.file,
    order: options.order,
    ...(options.music !== undefined ? { music: options.music } : {}),
    gridHash: cc2GridHash(level),
    coverage,
    ...(options.blobBehavior !== undefined ? { blobBehavior: options.blobBehavior } : {}),
    ...(options.useCc1Boots !== undefined ? { useCc1Boots: options.useCc1Boots } : {}),
    ...(ghostBarCells.length > 0 ? { ghostBarCells } : {})
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

/**
 * The flame jet an orange button connects to: the first jet found by the diamond search of Lexy's Labyrinth
 * (find_terrain_diamond), rings of growing distance around the button, each ring starting east and turning
 * counterclockwise. Returns the cell index, or undefined when no jet lies within the search radius.
 */
function findFlameJetByDiamond(button: number, width: number, height: number, jets: ReadonlySet<number>): number | undefined {
  const startX = button % width;
  const startY = Math.floor(button / width);
  const radius = Math.max(width, height) + 1;
  for (let dist = 1; dist <= radius; dist++) {
    let sx = startX + dist;
    let sy = startY;
    for (const [dx, dy] of DIAMOND_STEPS) {
      for (let i = 0; i < dist; i++) {
        if (sx >= 0 && sx < width && sy >= 0 && sy < height && jets.has(sy * width + sx)) return sy * width + sx;
        sx += dx;
        sy += dy;
      }
    }
  }
  return undefined;
}

/** The mapping of a terrain tile, with the cases that read the modifier. */
function terrainMapping(tile: Cc2Tile, warnings: string[], where: string, wired: boolean): Cc2TileMapping {
  const code = tile.code;
  if (wired) {
    // The pre-opened trap (0x41) is the open trap as it stands: the link that ends on it closes it into a wired trap.
    if (code === CODE_TRAP) return WIRED_TRAP;
    if (code === CODE_TELEPORT_RED) return WIRED_TELEPORT_RED_OFF;
    if (code === TRANSMOGRIFIER) return WIRED_TRANSMOGRIFIER_OFF;
    if (code === CODE_FLAME_JET_OFF) return WIRED_FLAME_JET_OFF;
    if (code === CODE_FLAME_JET_ON) return WIRED_FLAME_JET_ON;
  }
  if (code === CC2_CODE_TRACK) return trackMapping(tile.mod);
  if (code === CODE_LOGIC_GATE) {
    const gate = decodeCc2Gate(tile.mod);
    if (gate.kind === 'unknown') return { id: UNKNOWN_ID, key: UNKNOWN_KEY };
    if (gate.kind === 'nand') return { id: GATE_IDS.nand, key: KEY_NAND_GATE };
    // The counter starts with the digit its modifier names; it has no facing.
    if (gate.kind === 'counter') return { id: `${SIGNAL_COUNTER_TILE_ID_PREFIX}${(tile.mod ?? COUNTER_MODIFIER_BASE) - COUNTER_MODIFIER_BASE}${SIGNAL_GATE_CC2_ID_SUFFIX}`, key: KEY_COUNTER_GATE };
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
  warnings: string[],
  where: string
): { type: string; dir: Direction; key?: string } {
  const code = actor.code;
  const dir = cc2Direction(actor.dir);
  if (code === CC2_CODE_DIRECTIONAL_BLOCK) {
    const block = directionalBlock(actor);
    return { ...block, key: block.key ?? KEY_ARROW_BLOCK };
  }
  const mapping = ENTITY_MAP.get(code);
  if (mapping !== undefined) return { type: mapping.id, dir, key: mapping.key };
  warnings.push(`actor code 0x${code.toString(16)} at ${where} is not mapped`);
  return { type: DIRT_BLOCK_ID, dir, key: KEY_UNKNOWN };
}
