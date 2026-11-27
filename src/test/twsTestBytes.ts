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

/** Test helper: synthetic Tile World solution file bytes, so no test depends on a third-party solution file. */

const SIGNATURE = [0x35, 0x33, 0x9b, 0x99];
const SET_NAME_PADDING = 16;
const END_MARKER = 0xffffffff;

/** One record of a synthetic file: a set name, a password-only record, raw record bytes, or null for the end marker. */
export type TwsTestRecord = { setName: string } | { passwordOnly: { number: number; password: string } } | { raw: number[] | null };

export function u32le(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

function ascii(text: string): number[] {
  return [...text].map((c) => c.charCodeAt(0));
}

/** A solution record body: number, password, flags 0, start state, seed, time, then the packed move bytes. */
export function twsSolutionRecord(opts: { number: number; password?: string; state?: number; seed?: number; time?: number; moves: number[] }): TwsTestRecord {
  const raw = [
    opts.number & 0xff,
    opts.number >> 8,
    ...ascii(opts.password ?? 'PASS'),
    0,
    opts.state ?? 0,
    ...u32le(opts.seed ?? 0),
    ...u32le(opts.time ?? 0),
    ...opts.moves
  ];
  return { raw };
}

/** The packed byte of one move in the one-byte packing: a direction index (0 N, 1 W, 2 S, 3 E) and a time of 0 to 7. */
export function oneByteMove(directionIndex: number, time: number): number {
  return 0x1 | (directionIndex << 2) | (time << 5);
}

/** A whole file: signature, ruleset byte (1 Lynx, 2 MS), last level 0, the extra header bytes, then the records. */
export function twsFileBytes(ruleset: number, records: TwsTestRecord[], extra: number[] = []): Uint8Array {
  const out: number[] = [...SIGNATURE, ruleset, 0, 0, extra.length, ...extra];
  for (const rec of records) {
    let body: number[];
    if ('setName' in rec) body = [...new Array<number>(SET_NAME_PADDING).fill(0), ...ascii(rec.setName), 0];
    else if ('passwordOnly' in rec) body = [rec.passwordOnly.number & 0xff, rec.passwordOnly.number >> 8, ...ascii(rec.passwordOnly.password)];
    else if (rec.raw === null) {
      out.push(...u32le(END_MARKER));
      continue;
    } else body = rec.raw;
    out.push(...u32le(body.length), ...body);
  }
  return new Uint8Array(out);
}
