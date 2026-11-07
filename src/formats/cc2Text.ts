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

/** Windows-1252 text codec for the null-terminated text fields of a C2M file. */

/** First byte of the range where Windows-1252 differs from Latin-1. */
const CP1252_SPECIAL_START = 0x80;
/** Number of bytes in that range (0x80 to 0x9F). */
const CP1252_SPECIAL_COUNT = 0x20;
/** Replacement byte for characters Windows-1252 cannot represent. */
const CP1252_REPLACEMENT_BYTE = 0x3f;
/** Highest code unit that maps to a single byte unchanged (Latin-1 range). */
const LATIN1_MAX = 0xff;

/**
 * Code points of bytes 0x80..0x9F. The five bytes Windows-1252 leaves undefined
 * (0x81, 0x8D, 0x8F, 0x90, 0x9D) map to the matching C1 control so the
 * conversion stays reversible.
 */
const CP1252_SPECIAL_CODEPOINTS: readonly number[] = [
  0x20ac, 0x0081, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021,
  0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x008d, 0x017d, 0x008f,
  0x0090, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x009d, 0x017e, 0x0178
];

const CODEPOINT_TO_SPECIAL_BYTE: ReadonlyMap<number, number> = new Map(
  CP1252_SPECIAL_CODEPOINTS.map((codePoint, index) => [codePoint, CP1252_SPECIAL_START + index])
);

/** Decodes Windows-1252 bytes to a string. */
export function decodeWindows1252(bytes: Uint8Array): string {
  let text = '';
  for (const byte of bytes) {
    const isSpecial = byte >= CP1252_SPECIAL_START && byte < CP1252_SPECIAL_START + CP1252_SPECIAL_COUNT;
    text += String.fromCharCode(isSpecial ? CP1252_SPECIAL_CODEPOINTS[byte - CP1252_SPECIAL_START] : byte);
  }
  return text;
}

/** Encodes a string to Windows-1252, replacing unrepresentable characters with '?'. */
export function encodeWindows1252(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    const special = CODEPOINT_TO_SPECIAL_BYTE.get(unit);
    if (special !== undefined) out[i] = special;
    else if (unit <= LATIN1_MAX && !(unit >= CP1252_SPECIAL_START && unit < CP1252_SPECIAL_START + CP1252_SPECIAL_COUNT)) out[i] = unit;
    else out[i] = CP1252_REPLACEMENT_BYTE;
  }
  return out;
}
