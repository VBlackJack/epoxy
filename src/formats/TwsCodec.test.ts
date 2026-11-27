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

import { describe, expect, it } from 'vitest';
import { twsFileBytes, twsSolutionRecord, u32le, oneByteMove, TwsTestRecord } from '../test/twsTestBytes';
import { decodeTwsMoves, parseTwsIndex, TwsIndex, TwsLimits, TwsParseError, twsBitsToDirections } from './TwsCodec';

const LIMITS: TwsLimits = { maxFileBytes: 4096, maxSolutionTicks: 100000, maxSetNameChars: 64 };

function codeOf(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof TwsParseError ? e.code : 'other';
  }
}

function indexOf(ruleset: number, records: TwsTestRecord[], limits: TwsLimits = LIMITS): TwsIndex {
  return parseTwsIndex(twsFileBytes(ruleset, records), limits);
}

function movesOf(index: TwsIndex, number: number, limits: TwsLimits = LIMITS): { ticks: number[]; bits: number[] } {
  const entry = index.entries.get(number);
  if (!entry) throw new Error(`no entry ${number}`);
  const moves = decodeTwsMoves(index, entry, limits);
  return { ticks: Array.from(moves.ticks), bits: Array.from(moves.bits) };
}

/** A long (fourth) packing of 2 bytes: a 9-bit direction and a 2-bit time. */
function longTwoBytes(direction: number, time: number): number[] {
  return [0x3 | 0x10 | ((direction & 0x7) << 5), (direction >> 3) | (time << 6)];
}

describe('parseTwsIndex', () => {
  it('reads the header ruleset, the set name record and the start state of a solution record', () => {
    const index = indexOf(1, [
      { setName: 'MYSET.dac' },
      twsSolutionRecord({ number: 3, password: 'ABCD', state: (5 << 3) | 2, seed: 0x01020304, time: 777, moves: [oneByteMove(0, 2)] })
    ]);
    expect(index.ruleset).toBe('lynx');
    expect(index.setName).toBe('MYSET.dac');
    expect(index.entries.get(3)).toMatchObject({
      number: 3,
      password: 'ABCD',
      hasSolution: true,
      flags: 0,
      stepping: 5,
      forceStart: 'S',
      seed: 0x01020304,
      time: 777,
      hasMouseMoves: false,
      moveCount: 1,
      endTick: 3
    });
    // One-byte packing: direction index 0 (N), time 2, so the first move lands on tick 2.
    expect(movesOf(index, 3)).toEqual({ ticks: [2], bits: [0x1] });
  });

  it('keeps no decoded moves in the index', () => {
    const index = indexOf(1, [twsSolutionRecord({ number: 1, moves: [oneByteMove(3, 0), oneByteMove(3, 0)] })]);
    expect(Object.keys(index.entries.get(1) ?? {})).not.toContain('moves');
    expect(index.entries.get(1)?.moveCount).toBe(2);
  });

  it('maps the raw force floor start 0..3 to N, W, S, E', () => {
    const starts = [0, 1, 2, 3].map((s) => indexOf(1, [twsSolutionRecord({ number: 1, state: s, moves: [] })]).entries.get(1)?.forceStart);
    expect(starts).toEqual(['N', 'W', 'S', 'E']);
  });

  it('decodes the three-moves, two-byte, four-byte and long packings with their gaps', () => {
    // Three moves N, S, E: fields 0, 2, 3 at bits 2, 4, 6; each 4 ticks after the previous.
    const three = (0 << 2) | (2 << 4) | (3 << 6);
    // Two bytes: format 2, direction 7 (SE), time 100.
    const two = 0x2 | (7 << 2) | (100 << 5);
    // Four bytes: format 3 with bit 4 clear, direction 1 (W), time 70000.
    const four = (0x3 | (1 << 2) | (70000 << 5)) >>> 0;
    // Long packing, 3 bytes: low nibble 3, bit 4 set, size field 1; direction 0xA (W + E), time 1 + (2 << 2) = 9.
    const longFirst = 0x3 | (1 << 2) | 0x10 | ((0xa & 0x7) << 5);
    const longSecond = (0xa >> 3) | (1 << 6);
    const index = indexOf(1, [twsSolutionRecord({ number: 9, moves: [three, two & 0xff, two >> 8, ...u32le(four), longFirst, longSecond, 2] })]);
    expect(movesOf(index, 9)).toEqual({
      ticks: [3, 7, 11, 112, 70113, 70123],
      bits: [0x1, 0x4, 0x8, 0x4 | 0x8, 0x2, 0xa]
    });
    expect(index.entries.get(9)?.endTick).toBe(70124);
  });

  it('keeps a password-only record without a solution, and skips an empty record', () => {
    const index = indexOf(2, [{ raw: [] }, { passwordOnly: { number: 4, password: 'WXYZ' } }]);
    expect(index.ruleset).toBe('ms');
    expect(index.entries.get(4)).toMatchObject({ number: 4, password: 'WXYZ', hasSolution: false, moveCount: 0, endTick: 0 });
  });

  it('flags a mouse move (direction 16 and up) instead of refusing the file, and reads direction 15 as the four keys', () => {
    const mouse = indexOf(2, [twsSolutionRecord({ number: 1, moves: longTwoBytes(196, 0) })]);
    expect(mouse.entries.get(1)?.hasMouseMoves).toBe(true);
    expect(movesOf(mouse, 1)).toEqual({ ticks: [0], bits: [0] });
    const sixteen = indexOf(2, [twsSolutionRecord({ number: 1, moves: longTwoBytes(16, 0) })]);
    expect(sixteen.entries.get(1)?.hasMouseMoves).toBe(true);
    const fifteen = indexOf(1, [twsSolutionRecord({ number: 1, moves: longTwoBytes(15, 0) })]);
    expect(fifteen.entries.get(1)?.hasMouseMoves).toBe(false);
    expect(movesOf(fifteen, 1)).toEqual({ ticks: [0], bits: [0xf] });
  });

  it('stops at an end marker and skips the extra header bytes', () => {
    const bytes = twsFileBytes(1, [twsSolutionRecord({ number: 1, moves: [] }), { raw: null }, twsSolutionRecord({ number: 2, moves: [] })], [9, 9, 9]);
    expect([...parseTwsIndex(bytes, LIMITS).entries.keys()]).toEqual([1]);
  });

  it('lets the second record of a level number win, password included', () => {
    const index = indexOf(1, [twsSolutionRecord({ number: 3, password: 'AAAA', moves: [] }), twsSolutionRecord({ number: 3, password: 'BBBB', moves: [] })]);
    expect(index.entries.size).toBe(1);
    expect(index.entries.get(3)?.password).toBe('BBBB');
  });

  it('gives no set name for a level number 0 record of 6 bytes, and caps a long set name', () => {
    expect(indexOf(1, [{ raw: [0, 0, 65, 66, 67, 68] }]).setName).toBeNull();
    expect(indexOf(1, [{ setName: 'ABCDEFGH' }], { ...LIMITS, maxSetNameChars: 4 }).setName).toBe('ABCD');
    expect(indexOf(1, [{ setName: 'ABCDEFGH' }], { ...LIMITS, maxSetNameChars: 8 }).setName).toBe('ABCDEFGH');
  });

  it('classifies a record by its size: 5 refused, 6 password only, 15 refused, 16 a solution without moves', () => {
    const five = twsFileBytes(1, [{ raw: [1, 0, 65, 66, 67] }]);
    expect(codeOf(() => parseTwsIndex(five, LIMITS))).toBe('record_size');
    const six = indexOf(1, [{ raw: [1, 0, 65, 66, 67, 68] }]).entries.get(1);
    expect(six).toMatchObject({ hasSolution: false, password: 'ABCD' });
    const fifteen = twsFileBytes(1, [{ raw: [1, 0, 65, 66, 67, 68, 0, 0, 0, 0, 0, 0, 0, 0, 0] }]);
    expect(codeOf(() => parseTwsIndex(fifteen, LIMITS))).toBe('record_size');
    const sixteen = indexOf(1, [{ raw: [1, 0, 65, 66, 67, 68, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] }]).entries.get(1);
    expect(sixteen).toMatchObject({ hasSolution: true, moveCount: 0, endTick: 0 });
  });

  it('refuses a start state above 3 in its force floor bits', () => {
    expect(codeOf(() => indexOf(1, [twsSolutionRecord({ number: 1, state: 4, moves: [] })]))).toBe('start_state');
    expect(codeOf(() => indexOf(1, [twsSolutionRecord({ number: 1, state: 7, moves: [] })]))).toBe('start_state');
  });

  it('refuses a bad signature, an unknown ruleset, a file over the limit and a truncated file', () => {
    const good = twsFileBytes(1, [twsSolutionRecord({ number: 1, moves: [0x01] })]);
    const badSig = good.slice();
    badSig[0] = 0;
    const badRules = good.slice();
    badRules[4] = 3;
    expect(codeOf(() => parseTwsIndex(badSig, LIMITS))).toBe('signature');
    expect(codeOf(() => parseTwsIndex(badRules, LIMITS))).toBe('ruleset');
    expect(codeOf(() => parseTwsIndex(good, { ...LIMITS, maxFileBytes: good.length - 1 }))).toBe('too_large');
    expect(codeOf(() => parseTwsIndex(good.slice(0, good.length - 1), LIMITS))).toBe('truncated');
    expect(codeOf(() => parseTwsIndex(good.slice(0, 6), LIMITS))).toBe('truncated');
  });

  it('accepts a file exactly as long as the limit', () => {
    const good = twsFileBytes(1, [twsSolutionRecord({ number: 1, moves: [] })]);
    expect(parseTwsIndex(good, { ...LIMITS, maxFileBytes: good.length }).entries.size).toBe(1);
  });

  it('refuses a record size that runs past the file (0xFFFFFFFE) and 255 extra header bytes in an 8 byte file', () => {
    const header = twsFileBytes(1, []);
    const huge = new Uint8Array([...header, ...u32le(0xfffffffe)]);
    expect(codeOf(() => parseTwsIndex(huge, LIMITS))).toBe('truncated');
    const extra = new Uint8Array([...header.slice(0, 7), 255]);
    expect(extra.length).toBe(8);
    expect(codeOf(() => parseTwsIndex(extra, LIMITS))).toBe('truncated');
  });

  it('refuses a move packing cut by the record end', () => {
    // A two-byte packing with only its first byte inside the record.
    expect(codeOf(() => indexOf(1, [twsSolutionRecord({ number: 1, moves: [0x02] })]))).toBe('truncated');
  });

  it('accepts a move on the last allowed tick and refuses one tick later', () => {
    const atLimit = { ...LIMITS, maxSolutionTicks: 7 };
    // One-byte packing, time 7: the move lands on tick 7.
    const records = [twsSolutionRecord({ number: 1, moves: [oneByteMove(0, 7)] })];
    expect(indexOf(1, records, atLimit).entries.get(1)?.endTick).toBe(8);
    expect(codeOf(() => indexOf(1, records, { ...LIMITS, maxSolutionTicks: 6 }))).toBe('too_long');
  });

  it('reads the time of a four-byte packing in 23 bits: the spare high bits public files set are not time', () => {
    // Format 3, direction index 1 (W), bit 4 clear, and 0x90000000 on top, as the public Lynx files write it.
    const withFlags = (0x3 | (1 << 2) | (3 << 5) | 0x90000000) >>> 0;
    const index = indexOf(1, [twsSolutionRecord({ number: 1, moves: u32le(withFlags) })]);
    expect(movesOf(index, 1)).toEqual({ ticks: [3], bits: [0x2] });
    expect(index.entries.get(1)?.endTick).toBe(4);
  });

  it('refuses a four-byte gap that does not fit the tick limit, high bits or not', () => {
    // A 23 bit gap of 2^22 ticks is past a limit of 100000, whatever sits above it.
    const gap = 2 ** 22;
    const plain = (0x3 | (1 << 2) | (gap * 32)) >>> 0;
    const flagged = (plain | 0x90000000) >>> 0;
    expect(codeOf(() => indexOf(1, [twsSolutionRecord({ number: 1, moves: u32le(plain) })]))).toBe('too_long');
    expect(codeOf(() => indexOf(1, [twsSolutionRecord({ number: 1, moves: u32le(flagged) })]))).toBe('too_long');
    // The same bytes are fine for a limit that allows the gap, and land on that tick exactly.
    const roomy = { ...LIMITS, maxSolutionTicks: 20_000_000 };
    expect(movesOf(indexOf(1, [twsSolutionRecord({ number: 1, moves: u32le(plain) })], roomy), 1, roomy)).toEqual({ ticks: [gap], bits: [0x2] });
  });

  it('refuses a move past the tick limit in a four-byte packing', () => {
    const four = (0x3 | (200000 << 5)) >>> 0;
    expect(codeOf(() => indexOf(1, [twsSolutionRecord({ number: 1, moves: u32le(four) })]))).toBe('too_long');
  });
});

describe('decodeTwsMoves', () => {
  it('decodes only the record asked for', () => {
    const index = indexOf(1, [
      twsSolutionRecord({ number: 1, moves: [oneByteMove(0, 1)] }),
      twsSolutionRecord({ number: 2, moves: [oneByteMove(3, 0), oneByteMove(2, 5)] })
    ]);
    expect(movesOf(index, 1)).toEqual({ ticks: [1], bits: [0x1] });
    expect(movesOf(index, 2)).toEqual({ ticks: [0, 6], bits: [0x8, 0x4] });
  });
});

describe('twsBitsToDirections', () => {
  it('lists the held keys in the Lynx reader order N, S, W, E', () => {
    expect(twsBitsToDirections(0)).toEqual([]);
    expect(twsBitsToDirections(0x2 | 0x4)).toEqual(['S', 'W']);
    expect(twsBitsToDirections(0xf)).toEqual(['N', 'S', 'W', 'E']);
  });
});
