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
 * The small stable hash of the Runeward painters, kept apart so the ink helpers and the painters can
 * both use it without importing each other.
 */

const HASH_MULTIPLIER_X = 374761393;
const HASH_MULTIPLIER_Y = 668265263;
const HASH_MIX_MULTIPLIER = 1274126177;
const HASH_SHIFT_MIDDLE = 13;
const HASH_SHIFT_FINAL = 16;

/** A small stable hash of a tile position, for texture variety without randomness. */
export function tileHash(x: number, y: number): number {
  let h = (Math.imul(x, HASH_MULTIPLIER_X) + Math.imul(y, HASH_MULTIPLIER_Y)) >>> 0;
  h = Math.imul(h ^ (h >>> HASH_SHIFT_MIDDLE), HASH_MIX_MULTIPLIER) >>> 0;
  return (h ^ (h >>> HASH_SHIFT_FINAL)) >>> 0;
}
