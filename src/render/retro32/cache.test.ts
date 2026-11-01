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

import { describe, expect, it, vi } from 'vitest';
import { createRetro32SpriteCache } from './cache';

const pixels = (value: number): Uint8ClampedArray => Uint8ClampedArray.of(value);

describe('createRetro32SpriteCache', () => {
  it('produces once per key', () => {
    const cache = createRetro32SpriteCache(4);
    const produce = vi.fn(() => pixels(1));
    const first = cache.get('default', 'floor', undefined, produce);
    const second = cache.get('default', 'floor', undefined, produce);
    expect(second).toBe(first);
    expect(produce).toHaveBeenCalledTimes(1);
  });

  it('separates theme, name and swap ramp', () => {
    const cache = createRetro32SpriteCache(8);
    cache.get('a', 'x', undefined, () => pixels(1));
    cache.get('b', 'x', undefined, () => pixels(2));
    cache.get('a', 'y', undefined, () => pixels(3));
    cache.get('a', 'x', 'red', () => pixels(4));
    expect(cache.size).toBe(4);
    expect(cache.get('a', 'x', 'red', () => pixels(9))[0]).toBe(4);
  });

  it('evicts the least recently used entry', () => {
    const cache = createRetro32SpriteCache(2);
    cache.get('t', 'a', undefined, () => pixels(1));
    cache.get('t', 'b', undefined, () => pixels(2));
    cache.get('t', 'a', undefined, () => pixels(0));
    cache.get('t', 'c', undefined, () => pixels(3));
    expect(cache.size).toBe(2);
    const keep = vi.fn(() => pixels(8));
    cache.get('t', 'a', undefined, keep);
    expect(keep).not.toHaveBeenCalled();
    const reproduce = vi.fn(() => pixels(7));
    cache.get('t', 'b', undefined, reproduce);
    expect(reproduce).toHaveBeenCalledTimes(1);
  });

  it('rejects an invalid size and can be cleared', () => {
    expect(() => createRetro32SpriteCache(0)).toThrow();
    const cache = createRetro32SpriteCache(2);
    cache.get('t', 'a', undefined, () => pixels(1));
    cache.clear();
    expect(cache.size).toBe(0);
  });
});
