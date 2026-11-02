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

import { bandStops } from './gradientBands';

const BLACK_TO_WHITE = [
  { offset: 0, colour: '#000000' },
  { offset: 1, colour: '#ffffff' }
];

describe('gradient bands', () => {
  it('cuts a gradient into flat bands with hard edges covering 0..1', () => {
    const out = bandStops(BLACK_TO_WHITE, 3);
    expect(out).toHaveLength(6);
    expect(out[0].offset).toBe(0);
    expect(out[5].offset).toBe(1);
    for (let band = 0; band < 3; band++) {
      expect(out[band * 2].colour).toBe(out[band * 2 + 1].colour);
      expect(out[band * 2 + 1].offset).toBeCloseTo((band + 1) / 3);
    }
  });

  it('takes the colour of the middle of each band, darkest first', () => {
    const colours = bandStops(BLACK_TO_WHITE, 4).map((stop) => stop.colour);
    expect(colours).toEqual(['#202020', '#202020', '#606060', '#606060', '#9f9f9f', '#9f9f9f', '#dfdfdf', '#dfdfdf']);
  });

  it('follows every stop of the gradient', () => {
    const out = bandStops([
      { offset: 0, colour: '#ff0000' },
      { offset: 0.5, colour: '#00ff00' },
      { offset: 1, colour: '#0000ff' }
    ], 2);
    expect(out.map((stop) => stop.colour)).toEqual(['#808000', '#808000', '#008080', '#008080']);
  });

  it('keeps and interpolates alpha', () => {
    const out = bandStops([
      { offset: 0, colour: 'rgba(0, 0, 0, 0.5)' },
      { offset: 1, colour: 'rgba(0, 0, 0, 0)' }
    ], 2);
    expect(out[0].colour).toBe('rgba(0, 0, 0, 0.375)');
    expect(out[2].colour).toBe('rgba(0, 0, 0, 0.125)');
  });

  it('returns stops it cannot band unchanged', () => {
    const odd = [{ offset: 0, colour: 'red' }, { offset: 1, colour: '#ffffff' }];
    expect(bandStops(odd, 3)).toEqual(odd);
    expect(bandStops(BLACK_TO_WHITE, 1)).toEqual(BLACK_TO_WHITE);
    expect(bandStops([], 3)).toEqual([]);
  });
});
