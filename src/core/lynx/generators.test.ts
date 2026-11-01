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
import { drawMainDirection, drawWalker, newMainGenerator, newWalkerGenerator } from './generators';

describe('walker generator', () => {
  it('reproduces the specified test vector from zero state', () => {
    const state = newWalkerGenerator();
    const draws = Array.from({ length: 12 }, () => drawWalker(state));
    expect(draws).toEqual([1, 3, 7, 15, 31, 63, 127, 255, 127, 63, 31, 15]);
    expect(draws.map((d) => d % 4)).toEqual([1, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3]);
  });
});

describe('main generator', () => {
  it('reproduces the specified test vector from seed 0', () => {
    const state = newMainGenerator(0);
    const values: number[] = [];
    const dirs = Array.from({ length: 8 }, () => {
      const dir = drawMainDirection(state);
      values.push(state.value);
      return dir;
    });
    expect(values).toEqual([12345, 1406932606, 654583775, 1449466924, 229283573, 1109335178, 1051550459, 1293799192]);
    expect(dirs).toEqual(['N', 'S', 'E', 'S', 'N', 'S', 'E', 'S']);
  });

  it('keeps the seed modulo 2^31', () => {
    expect(newMainGenerator(0x80000005).value).toBe(5);
  });
});
