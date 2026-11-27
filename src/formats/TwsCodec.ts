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
 * Reader of Tile World solution files (.tws). A file holds, per level, the moves Tile World recorded and the start state
 * that makes them replay: the stepping, the random seed and the start direction of the random force floors.
 *
 * Layout (little endian):
 *   header   u32 signature, u8 ruleset (1 Lynx, 2 MS), u16 last level visited, u8 count of extra header bytes, extra bytes
 *   records  u32 size, then size bytes; a size of 0xFFFFFFFF ends the file early
 *            a record of level number 0 names the level set (name from byte 16, NUL ended); a record of 6 bytes holds a
 *            level number and its password only; a longer record holds the solution:
 *              u16 number, 4 bytes password, u8 flags, u8 start state (bits 0-2 force floor start, bits 3-5 stepping),
 *              u32 random seed, u32 solution time in ticks, then the moves
 *   moves    four packings, told apart by the low bits of the first byte (see MoveWalker.readMove)
 *
 * The reader works in two steps so that a file stays cheap to keep: parseTwsIndex walks every record once, checks every move
 * without keeping any, and keeps one small entry per level (where its moves are, how many, when they end); decodeTwsMoves
 * then decodes the moves of the one level being played, into typed arrays.
 *
 * The reader is strict, and a bad record refuses the whole file: a damaged record means the file is not trustworthy, and a
 * partial read would hide it. Every read is bounds checked, a refusal is a TwsParseError, and the caller's limits cap the
 * file size and the ticks a solution may span.
 */

import type { Direction } from '../core/types';

/** The 4-byte signature at the start of every TWS file (0x999B3335 read little endian). */
const TWS_SIGNATURE = 0x999b3335;
const HEADER_FIXED_BYTES = 8;
const HEADER_RULESET_OFFSET = 4;
const HEADER_EXTRA_COUNT_OFFSET = 7;
const RECORD_SIZE_BYTES = 4;
const END_OF_FILE_SIZE = 0xffffffff;
const PASSWORD_ONLY_RECORD_BYTES = 6;
const SOLUTION_HEADER_BYTES = 16;
const PASSWORD_OFFSET = 2;
const PASSWORD_BYTES = 4;
const FLAGS_OFFSET = 6;
const START_STATE_OFFSET = 7;
const SEED_OFFSET = 8;
const TIME_OFFSET = 12;
const SET_NAME_OFFSET = 16;
const START_FORCE_MASK = 0x7;
const STEPPING_SHIFT = 3;
const STEPPING_MASK = 0x7;
/** Raw start direction of the random force floors as Tile World stores it (Lynx turns it before its first use). */
const RAW_FORCE_START: readonly Direction[] = ['N', 'W', 'S', 'E'];

/** Tile World's own direction bits, used by the fourth packing and kept as the move value. */
export const TWS_NORTH = 0x1;
export const TWS_WEST = 0x2;
export const TWS_SOUTH = 0x4;
export const TWS_EAST = 0x8;
/** The fourth packing stores mouse moves from this value up: MS only, never played. */
const FIRST_MOUSE_MOVE = 16;
/** Index of the compact packings into the direction bits: N, W, S, E, NW, SW, NE, SE. */
const COMPACT_DIRECTIONS: readonly number[] = [
  TWS_NORTH,
  TWS_WEST,
  TWS_SOUTH,
  TWS_EAST,
  TWS_NORTH | TWS_WEST,
  TWS_SOUTH | TWS_WEST,
  TWS_NORTH | TWS_EAST,
  TWS_SOUTH | TWS_EAST
];
const PACK_FORMAT_MASK = 0x3;
const PACK_THREE_MOVES = 0;
const PACK_ONE_BYTE = 1;
const PACK_TWO_BYTES = 2;
const PACK_LONG_FLAG = 0x10;
/** Each move of the three-in-a-byte packing comes 4 ticks after the previous one. */
const THREE_MOVES_GAP = 4;
const THREE_MOVES_FIELD_BITS = 2;
const THREE_MOVES_FIRST_SHIFT = 2;
const THREE_MOVES_COUNT = 3;
const DIRECTION_SHIFT = 2;
const COMPACT_DIRECTION_MASK = 0x7;
const COMPACT_TIME_SHIFT = 5;
/**
 * The four-byte packing holds 23 bits of time. The bits above are not time: the public Lynx files carry 0x90000000 in the
 * four-byte packings (15942 of them in one 149-level file, measured), so the field is read in 23 bits, as other readers do.
 * Reading them as time would refuse every one of those files. A gap past the file's tick limit is still refused.
 */
const COMPACT_TIME_MASK = 0x7fffff;
const LONG_SIZE_SHIFT = 2;
const LONG_SIZE_MASK = 0x3;
const LONG_MIN_BYTES = 2;
const LONG_DIRECTION_LOW_SHIFT = 5;
const LONG_DIRECTION_HIGH_MASK = 0x3f;
const LONG_DIRECTION_HIGH_SHIFT = 3;
const LONG_TIME_LOW_SHIFT = 6;
const LONG_TIME_BYTE_SHIFT = 2;
const BITS_PER_BYTE = 8;
const BYTE_MASK = 0xff;
/** Two-byte and four-byte packings are read as one little endian integer. */
const TWO_BYTES = 2;
const FOUR_BYTES = 4;

export type TwsRuleset = 'lynx' | 'ms';
const RULESET_BY_BYTE: Readonly<Record<number, TwsRuleset>> = { 1: 'lynx', 2: 'ms' };

/** Why a file or a record was refused; the i18n key of each reason is chosen from it. */
export type TwsErrorCode = 'too_large' | 'signature' | 'ruleset' | 'truncated' | 'record_size' | 'start_state' | 'too_long';

export class TwsParseError extends Error {
  constructor(
    public readonly code: TwsErrorCode,
    public readonly offset: number
  ) {
    super(`TWS ${code} at byte ${offset}`);
  }
}

/** What the reader needs to know about its caller's limits. */
export interface TwsLimits {
  /** Largest file accepted, in bytes. */
  maxFileBytes: number;
  /** Largest tick a solution may reach. */
  maxSolutionTicks: number;
  /** Most characters kept of the level set name. */
  maxSetNameChars: number;
}

/** What the index keeps of one record: its start state, and where its moves are in the file. */
export interface TwsEntry {
  number: number;
  /** The level password the record was made on, as 4 ASCII characters. */
  password: string;
  /** False for a password-only record. */
  hasSolution: boolean;
  /** The record flags byte (unused by Tile World replays; kept for diagnostics). */
  flags: number;
  /** 0 to 7: the stepping (step phase) the solution was recorded with. */
  stepping: number;
  /** The start direction of the random force floors, raw as stored (the Lynx engine turns it before use). */
  forceStart: Direction;
  seed: number;
  /** The solution time Tile World stored, in ticks. */
  time: number;
  /** How many moves the record holds. */
  moveCount: number;
  /** The tick after the last move (0 when there is none). */
  endTick: number;
  /** True when the solution holds a mouse move (MS only): it cannot be played. */
  hasMouseMoves: boolean;
  /** Where the packed moves start and end in the file bytes. */
  movesStart: number;
  movesEnd: number;
}

export interface TwsIndex {
  ruleset: TwsRuleset;
  /** The level set name of the first set name record, or null. */
  setName: string | null;
  /** By level number; the last record of a number wins. */
  entries: Map<number, TwsEntry>;
  /** The file bytes the entries point into. */
  bytes: Uint8Array;
}

/** The moves of one level, in tick order: the keys `bits` (TWS_* direction bits) are held for the one tick `ticks[i]`. */
export interface TwsMoves {
  ticks: Uint32Array;
  bits: Uint8Array;
}

/** A bounds checked reader over the file bytes. */
class Reader {
  private readonly view: DataView;
  constructor(readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  need(offset: number, count: number, end: number = this.bytes.length): void {
    if (offset < 0 || count < 0 || offset + count > end) throw new TwsParseError('truncated', offset);
  }
  u8(offset: number, end?: number): number {
    this.need(offset, 1, end);
    return this.bytes[offset];
  }
  u16(offset: number, end?: number): number {
    this.need(offset, 2, end);
    return this.view.getUint16(offset, true);
  }
  u32(offset: number, end?: number): number {
    this.need(offset, 4, end);
    return this.view.getUint32(offset, true);
  }
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  let out = '';
  for (let i = start; i < end; i++) out += String.fromCharCode(bytes[i]);
  return out;
}

/**
 * Walks the packed moves of one record. With no arrays it only checks them and counts them (no allocation per move); with
 * arrays it also writes each move down.
 */
class MoveWalker {
  tick = -1;
  count = 0;
  mouse = false;

  constructor(
    private readonly r: Reader,
    private readonly maxTicks: number,
    private readonly ticks: Uint32Array | null,
    private readonly bits: Uint8Array | null
  ) {}

  /** Each stored time is the gap since the previous move minus one, so the first move of gap g lands on tick g. */
  private push(moveBits: number, gap: number, at: number): void {
    this.tick += gap + 1;
    if (this.tick > this.maxTicks) throw new TwsParseError('too_long', at);
    if (this.ticks !== null && this.bits !== null) {
      this.ticks[this.count] = this.tick;
      this.bits[this.count] = moveBits;
    }
    this.count++;
  }

  run(start: number, end: number): void {
    let q = start;
    while (q < end) q = this.readMove(q, end);
  }

  /** Reads one packed entry at `q` and returns the offset after it. */
  private readMove(q: number, end: number): number {
    const r = this.r;
    const first = r.u8(q, end);
    const format = first & PACK_FORMAT_MASK;
    if (format === PACK_THREE_MOVES) {
      for (let i = 0; i < THREE_MOVES_COUNT; i++) {
        const field = (first >> (THREE_MOVES_FIRST_SHIFT + i * THREE_MOVES_FIELD_BITS)) & PACK_FORMAT_MASK;
        this.push(COMPACT_DIRECTIONS[field], THREE_MOVES_GAP - 1, q);
      }
      return q + 1;
    }
    if (format === PACK_ONE_BYTE || format === PACK_TWO_BYTES || (first & PACK_LONG_FLAG) === 0) {
      const length = format === PACK_ONE_BYTE ? 1 : format === PACK_TWO_BYTES ? TWO_BYTES : FOUR_BYTES;
      const value = length === 1 ? first : length === TWO_BYTES ? r.u16(q, end) : r.u32(q, end);
      // A gap that does not fit the file's tick limit refuses the file.
      this.push(COMPACT_DIRECTIONS[(value >>> DIRECTION_SHIFT) & COMPACT_DIRECTION_MASK], (value >>> COMPACT_TIME_SHIFT) & COMPACT_TIME_MASK, q);
      return q + length;
    }
    // Fourth packing: 2 to 5 bytes, a 9-bit direction and a long time.
    const length = ((first >> LONG_SIZE_SHIFT) & LONG_SIZE_MASK) + LONG_MIN_BYTES;
    r.need(q, length, end);
    const second = r.u8(q + 1, end);
    const direction = (first >> LONG_DIRECTION_LOW_SHIFT) | ((second & LONG_DIRECTION_HIGH_MASK) << LONG_DIRECTION_HIGH_SHIFT);
    let gap = second >> LONG_TIME_LOW_SHIFT;
    for (let i = LONG_MIN_BYTES; i < length; i++) {
      gap += (r.u8(q + i, end) & BYTE_MASK) * 2 ** (LONG_TIME_BYTE_SHIFT + (i - LONG_MIN_BYTES) * BITS_PER_BYTE);
    }
    const isMouse = direction >= FIRST_MOUSE_MOVE;
    if (isMouse) this.mouse = true;
    this.push(isMouse ? 0 : direction, gap, q);
    return q + length;
  }
}

/**
 * Indexes a TWS file: every record is checked, none of its moves is kept. Throws TwsParseError on a refused file; a
 * malformed record refuses the whole file.
 */
export function parseTwsIndex(data: ArrayBuffer | Uint8Array, limits: TwsLimits): TwsIndex {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.length > limits.maxFileBytes) throw new TwsParseError('too_large', 0);
  const r = new Reader(bytes);
  if (r.u32(0) !== TWS_SIGNATURE) throw new TwsParseError('signature', 0);
  const ruleset = RULESET_BY_BYTE[r.u8(HEADER_RULESET_OFFSET)];
  if (ruleset === undefined) throw new TwsParseError('ruleset', HEADER_RULESET_OFFSET);
  let p = HEADER_FIXED_BYTES + r.u8(HEADER_EXTRA_COUNT_OFFSET);
  r.need(0, p);
  let setName: string | null = null;
  const entries = new Map<number, TwsEntry>();
  while (p < bytes.length) {
    const size = r.u32(p);
    p += RECORD_SIZE_BYTES;
    if (size === END_OF_FILE_SIZE) break;
    if (size === 0) continue;
    const end = p + size;
    r.need(p, size);
    if (size < PASSWORD_ONLY_RECORD_BYTES) throw new TwsParseError('record_size', p);
    const number = r.u16(p, end);
    if (number === 0) {
      setName = readSetName(bytes, p, end, limits.maxSetNameChars);
    } else if (size === PASSWORD_ONLY_RECORD_BYTES) {
      entries.set(number, passwordOnly(number, ascii(bytes, p + PASSWORD_OFFSET, p + PASSWORD_OFFSET + PASSWORD_BYTES)));
    } else {
      entries.set(number, readEntry(r, p, end, limits));
    }
    p = end;
  }
  return { ruleset, setName, entries, bytes };
}

function readSetName(bytes: Uint8Array, start: number, end: number, maxChars: number): string | null {
  if (end - start <= SET_NAME_OFFSET) return null;
  const first = start + SET_NAME_OFFSET;
  const limit = Math.min(end, first + maxChars);
  let stop = first;
  while (stop < limit && bytes[stop] !== 0) stop++;
  return ascii(bytes, first, stop);
}

function passwordOnly(number: number, password: string): TwsEntry {
  return {
    number,
    password,
    hasSolution: false,
    flags: 0,
    stepping: 0,
    forceStart: RAW_FORCE_START[0],
    seed: 0,
    time: 0,
    moveCount: 0,
    endTick: 0,
    hasMouseMoves: false,
    movesStart: 0,
    movesEnd: 0
  };
}

function readEntry(r: Reader, start: number, end: number, limits: TwsLimits): TwsEntry {
  if (end - start < SOLUTION_HEADER_BYTES) throw new TwsParseError('record_size', start);
  const state = r.u8(start + START_STATE_OFFSET, end);
  const forceStart = RAW_FORCE_START[state & START_FORCE_MASK];
  if (forceStart === undefined) throw new TwsParseError('start_state', start + START_STATE_OFFSET);
  const movesStart = start + SOLUTION_HEADER_BYTES;
  const walker = new MoveWalker(r, limits.maxSolutionTicks, null, null);
  walker.run(movesStart, end);
  return {
    number: r.u16(start, end),
    password: ascii(r.bytes, start + PASSWORD_OFFSET, start + PASSWORD_OFFSET + PASSWORD_BYTES),
    hasSolution: true,
    flags: r.u8(start + FLAGS_OFFSET, end),
    stepping: (state >> STEPPING_SHIFT) & STEPPING_MASK,
    forceStart,
    seed: r.u32(start + SEED_OFFSET, end),
    time: r.u32(start + TIME_OFFSET, end),
    moveCount: walker.count,
    endTick: walker.tick + 1,
    hasMouseMoves: walker.mouse,
    movesStart,
    movesEnd: end
  };
}

/** Decodes the moves of one indexed record (already validated by parseTwsIndex, so the limits are the same ones). */
export function decodeTwsMoves(index: TwsIndex, entry: TwsEntry, limits: Pick<TwsLimits, 'maxSolutionTicks'>): TwsMoves {
  const ticks = new Uint32Array(entry.moveCount);
  const bits = new Uint8Array(entry.moveCount);
  new MoveWalker(new Reader(index.bytes), limits.maxSolutionTicks, ticks, bits).run(entry.movesStart, entry.movesEnd);
  return { ticks, bits };
}

const NO_DIRECTIONS: readonly Direction[] = Object.freeze([]);

/** The held directions of a move's TWS bits, in the order the Lynx key reader takes them: N, S, W, E. */
export function twsBitsToDirections(bits: number): readonly Direction[] {
  if (bits === 0) return NO_DIRECTIONS;
  const out: Direction[] = [];
  if (bits & TWS_NORTH) out.push('N');
  if (bits & TWS_SOUTH) out.push('S');
  if (bits & TWS_WEST) out.push('W');
  if (bits & TWS_EAST) out.push('E');
  return out;
}
