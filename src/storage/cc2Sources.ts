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

import { SHA256_HEX_LENGTH } from '../config/constants';
import type { CompiledLevel } from '../core/types';

/** Byte helpers for the raw CC2 sources: SHA-256 as lower case hex, and base64 for the pack file. */

const SHA256_ALGORITHM = 'SHA-256';
const HEX_RADIX = 16;
const HEX_BYTE_WIDTH = 2;
/** Chunk of bytes turned into a binary string at once, small enough for String.fromCharCode. */
const BASE64_CHUNK_BYTES = 0x8000;
const SHA256_HEX_PATTERN = new RegExp(`^[0-9a-f]{${SHA256_HEX_LENGTH}}$`);

/** True for a lower case hex SHA-256 digest. */
export function isSha256Hex(value: unknown): value is string {
  return typeof value === 'string' && SHA256_HEX_PATTERN.test(value);
}

/** Round constants of SHA-256 (the first 32 bits of the fractional parts of the cube roots of the first 64 primes). */
const SHA256_K: readonly number[] = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
  0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
  0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];
const SHA256_INITIAL: readonly number[] = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
];
const SHA256_BLOCK_BYTES = 64;
const SHA256_LENGTH_BYTES = 8;
const SHA256_WORDS = 64;
const BITS_PER_BYTE = 8;
const UINT32_RANGE = 0x100000000;

function rotr(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

/** Pure-JS SHA-256, for a page without crypto.subtle (served over plain http). */
export function sha256Fallback(bytes: Uint8Array): Uint8Array {
  const padded = Math.ceil((bytes.length + 1 + SHA256_LENGTH_BYTES) / SHA256_BLOCK_BYTES) * SHA256_BLOCK_BYTES;
  const data = new Uint8Array(padded);
  data.set(bytes);
  data[bytes.length] = 0x80;
  const view = new DataView(data.buffer);
  const bitLength = bytes.length * BITS_PER_BYTE;
  view.setUint32(padded - SHA256_LENGTH_BYTES, Math.floor(bitLength / UINT32_RANGE));
  view.setUint32(padded - SHA256_LENGTH_BYTES / 2, bitLength >>> 0);
  const state = [...SHA256_INITIAL];
  const w = new Array<number>(SHA256_WORDS).fill(0);
  for (let block = 0; block < padded; block += SHA256_BLOCK_BYTES) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(block + i * 4);
    for (let i = 16; i < SHA256_WORDS; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = state;
    for (let i = 0; i < SHA256_WORDS; i++) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + SHA256_K[i] + w[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    [a, b, c, d, e, f, g, h].forEach((value, i) => {
      state[i] = (state[i] + value) >>> 0;
    });
  }
  const out = new Uint8Array(state.length * 4);
  const outView = new DataView(out.buffer);
  state.forEach((value, i) => outView.setUint32(i * 4, value));
  return out;
}

/** Lower case hex SHA-256 of some bytes: the browser digest when there is one, else the pure-JS one. */
export async function sha256OfBytes(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  const digest = subtle
    ? new Uint8Array(await subtle.digest(SHA256_ALGORITHM, bytes as unknown as BufferSource))
    : sha256Fallback(bytes);
  return Array.from(digest, (b) => b.toString(HEX_RADIX).padStart(HEX_BYTE_WIDTH, '0')).join('');
}

/** Base64 text of some bytes. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let at = 0; at < bytes.length; at += BASE64_CHUNK_BYTES) {
    binary += String.fromCharCode(...bytes.subarray(at, at + BASE64_CHUNK_BYTES));
  }
  return btoa(binary);
}

/** The bytes of a base64 text, or null when the text is not base64. */
export function base64ToBytes(text: string): Uint8Array | null {
  try {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/** The SHA-256 hashes of the sources the levels name, each once, in level order. */
export function cc2SourceHashes(levels: readonly Pick<CompiledLevel, 'cc2'>[]): string[] {
  return [...new Set(levels.flatMap((level) => (level.cc2 ? [level.cc2.sha256] : [])))];
}
