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
import { blockCellsKey, collectBlockCells } from './blockCover';

const MAP_WIDTH = 10;

describe('collectBlockCells', () => {
  it('collects blocks and ignores other entities', () => {
    const cells = collectBlockCells(
      [
        { kind: 'block', x: 2, y: 3 },
        { kind: 'monster', x: 4, y: 4 },
        { kind: 'block', x: 0, y: 1 }
      ],
      MAP_WIDTH,
      new Set()
    );
    expect([...cells].sort((a, b) => a - b)).toEqual([10, 32]);
  });

  it('clears and reuses the output set', () => {
    const out = new Set<number>([999]);
    const first = collectBlockCells([{ kind: 'block', x: 1, y: 1 }], MAP_WIDTH, out);
    expect(first).toBe(out);
    expect([...out]).toEqual([11]);
    collectBlockCells([], MAP_WIDTH, out);
    expect(out.size).toBe(0);
  });
});

describe('blockCellsKey', () => {
  it('is stable regardless of insertion order', () => {
    expect(blockCellsKey(new Set([5, 1, 9]))).toBe(blockCellsKey(new Set([9, 5, 1])));
  });

  it('changes when a block moves', () => {
    const before = collectBlockCells([{ kind: 'block', x: 1, y: 1 }], MAP_WIDTH, new Set());
    const after = collectBlockCells([{ kind: 'block', x: 2, y: 1 }], MAP_WIDTH, new Set());
    expect(blockCellsKey(before)).not.toBe(blockCellsKey(after));
  });
});
