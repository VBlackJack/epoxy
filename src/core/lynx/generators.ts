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

import { ORDERED_DIRECTIONS } from '../../config/constants';
import { Direction } from '../types';
import {
  BYTE_HIGH_BIT,
  BYTE_MODULUS,
  MAIN_DIRECTION_SHIFT,
  MAIN_INCREMENT,
  MAIN_MASK,
  MAIN_MULTIPLIER,
  MAIN_SEED_MODULUS,
  WALKER_QUARTER_DIVISOR,
  WALKER_SHIFT_BIT
} from './lynxConstants';

/** State of the walker generator: two bytes. Both are 0 when a level loads. */
export interface WalkerGeneratorState {
  high: number;
  low: number;
}

/** State of the main generator (blobs): one integer from 0 to 2^31 - 1. */
export interface MainGeneratorState {
  value: number;
}

export function newWalkerGenerator(): WalkerGeneratorState {
  return { high: 0, low: 0 };
}

export function newMainGenerator(seed: number): MainGeneratorState {
  const wrapped = ((seed % MAIN_SEED_MODULUS) + MAIN_SEED_MODULUS) % MAIN_SEED_MODULUS;
  return { value: wrapped };
}

const byteOf = (n: number): number => ((n % BYTE_MODULUS) + BYTE_MODULUS) % BYTE_MODULUS;

/** One walker draw, a value from 0 to 255. Advances the state. */
export function drawWalker(state: WalkerGeneratorState): number {
  let feedback = byteOf(Math.floor(state.high / WALKER_QUARTER_DIVISOR) - state.high);
  if ((state.high & WALKER_SHIFT_BIT) === 0) feedback = byteOf(feedback - 1);
  const high = Math.floor(state.high / 2) + ((state.low & BYTE_HIGH_BIT) !== 0 ? BYTE_HIGH_BIT : 0);
  const low = byteOf(2 * state.low + (feedback % 2));
  state.high = high;
  state.low = low;
  return high ^ low;
}

/** One main-generator draw: a direction (0 = N, 1 = E, 2 = S, 3 = W). Advances the state. */
export function drawMainDirection(state: MainGeneratorState): Direction {
  state.value = (Math.imul(state.value, MAIN_MULTIPLIER) + MAIN_INCREMENT) & MAIN_MASK;
  return ORDERED_DIRECTIONS[state.value >>> MAIN_DIRECTION_SHIFT];
}
