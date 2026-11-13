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

import type { Direction } from '../types';

/** Pairs of opposing directions: when one pair is held at once, CC2 ignores all direction input. */
export const CC2_OPPOSING_PAIRS: readonly (readonly [Direction, Direction])[] = [
  ['N', 'S'],
  ['E', 'W']
];

/** The horizontal directions: with two keys held and neither matching the facing, CC2 prefers the horizontal one. */
export const CC2_HORIZONTAL_DIRECTIONS: readonly Direction[] = ['E', 'W'];

/** How many direction keys CC2 reads at once; with more, every direction input is ignored. */
export const CC2_MAX_HELD_KEYS = 2;

/** True when two opposing keys are held (up and down, or left and right). */
export function hasOpposingPair(held: readonly Direction[]): boolean {
  return CC2_OPPOSING_PAIRS.some(([a, b]) => held.includes(a) && held.includes(b));
}

/**
 * The order in which CC2 tries the held direction keys. An opposing pair held (up and down, or left and right) cancels
 * every direction that tick; otherwise, with one vertical and one horizontal key held, the key matching the current
 * facing is tried first, then the horizontal one, and the other key is the fallback when the first is blocked.
 */
export function resolveCc2HeldOrder(held: readonly Direction[], facing: Direction): Direction[] {
  if (hasOpposingPair(held)) return [];
  const rank = (dir: Direction): number => (dir === facing ? 2 : CC2_HORIZONTAL_DIRECTIONS.includes(dir) ? 1 : 0);
  return [...held].sort((a, b) => rank(b) - rank(a));
}
