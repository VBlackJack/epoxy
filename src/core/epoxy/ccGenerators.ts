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

/**
 * The random generators of the classic Chip's Challenge monsters on a level made for that game (a .DAT import).
 * The algorithms are the ones the Lynx rule set uses (src/core/lynx/generators.ts), copied here so the Epoxy
 * engine does not depend on the frozen Lynx module. The walker has its own two-byte generator and draws only when
 * its way ahead is blocked; the blob makes one draw from the main generator on every decision.
 */

/** Both walker registers are bytes. */
const BYTE_MODULUS = 256;
const BYTE_HIGH_BIT = 128;
const WALKER_SHIFT_BIT = 2;
const WALKER_QUARTER_DIVISOR = 4;
/** The main generator is a linear congruential generator over 31 bits. */
const MAIN_MULTIPLIER = 1103515245;
const MAIN_INCREMENT = 12345;
const MAIN_MASK = 0x7fffffff;
const MAIN_DIRECTION_SHIFT = 29;
const MAIN_SEED_MODULUS = 0x80000000;
/** The walker draw is reduced to this many quarter turns. */
const QUARTER_TURNS_PER_CIRCLE = 4;

/** The state of both generators; the plain numbers are what an undo snapshot stores. */
export interface CcGenerators {
  walkerHigh: number;
  walkerLow: number;
  main: number;
}

const byteOf = (n: number): number => ((n % BYTE_MODULUS) + BYTE_MODULUS) % BYTE_MODULUS;

/** Both walker bytes are 0 when a level loads; the main generator starts from the given seed. */
export function newCcGenerators(seed: number): CcGenerators {
  const wrapped = ((seed % MAIN_SEED_MODULUS) + MAIN_SEED_MODULUS) % MAIN_SEED_MODULUS;
  return { walkerHigh: 0, walkerLow: 0, main: wrapped };
}

/** One walker draw, a value from 0 to 255. Advances the walker state. */
export function drawWalkerByte(g: CcGenerators): number {
  let feedback = byteOf(Math.floor(g.walkerHigh / WALKER_QUARTER_DIVISOR) - g.walkerHigh);
  if ((g.walkerHigh & WALKER_SHIFT_BIT) === 0) feedback = byteOf(feedback - 1);
  const high = Math.floor(g.walkerHigh / 2) + ((g.walkerLow & BYTE_HIGH_BIT) !== 0 ? BYTE_HIGH_BIT : 0);
  const low = byteOf(2 * g.walkerLow + (feedback % 2));
  g.walkerHigh = high;
  g.walkerLow = low;
  return high ^ low;
}

/** The direction a walker turns to from `facing`: one draw, that many quarter turns clockwise. */
export function drawWalkerTurn(g: CcGenerators, facing: Direction): Direction {
  const turns = drawWalkerByte(g) % QUARTER_TURNS_PER_CIRCLE;
  return ORDERED_DIRECTIONS[(ORDERED_DIRECTIONS.indexOf(facing) + turns) % ORDERED_DIRECTIONS.length];
}

/** One main-generator draw: an absolute direction. Advances the main state. */
export function drawBlobDirection(g: CcGenerators): Direction {
  g.main = (Math.imul(g.main, MAIN_MULTIPLIER) + MAIN_INCREMENT) & MAIN_MASK;
  return ORDERED_DIRECTIONS[g.main >>> MAIN_DIRECTION_SHIFT];
}
