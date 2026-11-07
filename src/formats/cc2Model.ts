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
 * Decoded intermediate model of a Chip's Challenge 2 level file (.c2m).
 *
 * The model is lossless: every byte of a file is either represented by a typed
 * field or kept raw, so C2mEncoder can write it back. Format facts were checked
 * against the 200 official levels; fields that were not are marked as such.
 */

/** Length of a section tag in bytes. */
export const C2M_TAG_BYTES = 4;
/** Section header: tag plus little-endian uint32 payload length. */
export const C2M_SECTION_HEADER_BYTES = 8;

/** Section tags. The two map tags carry a trailing space or a P. */
export const C2M_TAGS = {
  header: 'CC2M',
  lock: 'LOCK',
  version: 'VERS',
  title: 'TITL',
  author: 'AUTH',
  clue: 'CLUE',
  note: 'NOTE',
  options: 'OPTN',
  packedMap: 'PACK',
  map: 'MAP ',
  key: 'KEY ',
  replay: 'REPL',
  packedReplay: 'PRPL',
  end: 'END '
} as const;

/** Tags whose payload is a null-terminated Windows-1252 text. */
export const C2M_TEXT_TAGS: readonly string[] = [
  C2M_TAGS.header,
  C2M_TAGS.version,
  C2M_TAGS.title,
  C2M_TAGS.author,
  C2M_TAGS.clue,
  C2M_TAGS.note
];

/** Layers of a cell stack, in the order they are stored in the file (top first). */
export const Cc2Layer = {
  Item: 0,
  NoSign: 1,
  Panel: 2,
  Actor: 3,
  Terrain: 4
} as const;
export type Cc2Layer = (typeof Cc2Layer)[keyof typeof Cc2Layer];

/** Modifier codes. Each one precedes a tile and carries 1, 2 or 4 bytes of data. */
export const CC2_MODIFIER_CODES = {
  byte: 0x76,
  word: 0x77,
  dword: 0x78
} as const;

/** One tile of a cell stack. */
export interface Cc2Tile {
  /** Tile code, see cc2TileTable. */
  code: number;
  /** Value of the modifier written before the tile (wires, tunnels, tracks), if any. */
  mod?: number;
  /** Width in bytes of that modifier: 1, 2 or 4. */
  modBytes?: 1 | 2 | 4;
  /** Facing byte of an actor or of a directional block. */
  dir?: number;
  /** Allowed-arrows byte of a directional block. */
  arrows?: number;
  /** Edge flags of a thin wall panel (N, E, S, W and canopy bits). */
  flags?: number;
}

/** A cell: tiles from the top layer down, closed by one terrain tile. */
export interface Cc2Cell {
  tiles: Cc2Tile[];
}

/**
 * Part of a map that could not be decoded (a code absent from the tile table,
 * or a modifier stacked on a modifier). Everything from there on is kept raw.
 */
export interface Cc2UnknownRemainder {
  /** Index in reading order of the cell that holds the unknown byte. */
  cellIndex: number;
  /** The unknown code. */
  code: number;
  /** Offset of that code in the uncompressed map bytes. */
  offset: number;
  /** Tiles of that cell read before the unknown code. */
  tiles: Cc2Tile[];
  /** Raw bytes from the unknown code to the end of the map data. */
  raw: Uint8Array;
}

/** Decoded map. `cells` holds the complete cells, in reading order. */
export interface Cc2Map {
  width: number;
  height: number;
  cells: Cc2Cell[];
  /** Bytes after the last cell (empty in every official file). */
  tail: Uint8Array;
  unknown?: Cc2UnknownRemainder;
}

/** Input bits of the options block. Only the time limit is understood. */
export interface Cc2Options {
  /** Time limit in seconds, 0 when the level is untimed (certain). */
  timeLimit: number;
  /**
   * Bytes 2..5 of the block, kept as numbers. Their meaning is not established
   * (they look like view and rule switches), so they carry no name.
   */
  flags: number[];
}

export interface Cc2RawSection {
  kind: 'raw';
  tag: string;
  data: Uint8Array;
}

export interface Cc2TextSection {
  kind: 'text';
  tag: string;
  text: string;
  /** False when the payload had no null terminator. */
  terminated: boolean;
  /** Bytes after the first null terminator (empty in every official file). */
  extra: Uint8Array;
}

export interface Cc2OptionsSection {
  kind: 'options';
  tag: typeof C2M_TAGS.options;
  /** Authoritative bytes, written back as is. */
  raw: Uint8Array;
  /** Values derived from raw. */
  options: Cc2Options;
}

export interface Cc2MapSection {
  kind: 'map';
  tag: typeof C2M_TAGS.map | typeof C2M_TAGS.packedMap;
  map: Cc2Map;
}

export type Cc2Section = Cc2RawSection | Cc2TextSection | Cc2OptionsSection | Cc2MapSection;

/** A whole file: sections in file order plus any bytes after the END section. */
export interface Cc2File {
  sections: Cc2Section[];
  trailing: Uint8Array;
}

/** Error raised for structurally invalid files. */
export const C2M_ERROR_CODES = {
  truncatedSection: 'truncatedSection',
  badPack: 'badPack',
  packTooLarge: 'packTooLarge',
  unknownTileCode: 'unknownTileCode',
  badTile: 'badTile',
  badTag: 'badTag'
} as const;
export type C2mErrorCode = (typeof C2M_ERROR_CODES)[keyof typeof C2M_ERROR_CODES];

export class C2mFormatError extends Error {
  readonly code: C2mErrorCode;
  readonly detail: string;

  constructor(code: C2mErrorCode, detail = '') {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'C2mFormatError';
    this.code = code;
    this.detail = detail;
  }
}

/** First section with this tag, or undefined. */
export function findCc2Section(file: Cc2File, tag: string): Cc2Section | undefined {
  return file.sections.find((section) => section.tag === tag);
}

/** Decoded text of the first text section with this tag (e.g. TITL), or undefined. */
export function cc2Text(file: Cc2File, tag: string): string | undefined {
  const section = findCc2Section(file, tag);
  return section && section.kind === 'text' ? section.text : undefined;
}

/** The decoded map, or undefined when the file has none. */
export function cc2Map(file: Cc2File): Cc2Map | undefined {
  const section = file.sections.find((s): s is Cc2MapSection => s.kind === 'map');
  return section?.map;
}

/** The parsed options block, or undefined when the file has none. */
export function cc2Options(file: Cc2File): Cc2Options | undefined {
  const section = file.sections.find((s): s is Cc2OptionsSection => s.kind === 'options');
  return section?.options;
}

/** Replay sections (REPL and PRPL) in file order, raw. */
export function cc2ReplaySections(file: Cc2File): Cc2RawSection[] {
  return file.sections.filter(
    (s): s is Cc2RawSection =>
      s.kind === 'raw' && (s.tag === C2M_TAGS.replay || s.tag === C2M_TAGS.packedReplay)
  );
}
