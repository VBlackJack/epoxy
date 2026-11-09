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
import { divergenceBucket, gatePasses, rankBuckets } from './cc1Fidelity';
import type { Cc2Divergence } from './cc2ReplayCheck';

const base = { tick: 10, move: 2, x: 1, y: 1 };
const death = (extra: Partial<Cc2Divergence>): Cc2Divergence => ({ kind: 'death', reasonKey: 'death.test', ...base, ...extra });

describe('cc1Fidelity helpers', () => {
  it('names a monster death after the nearest monster', () => {
    expect(divergenceBucket(death({ monsters: ['alpha', 'beta'], tile: 'floor' }))).toBe('death / death.test / monster alpha');
  });

  it('names another death after the terrain', () => {
    expect(divergenceBucket(death({ tile: 'pool', monsters: [] }))).toBe('death / death.test / tile pool');
  });

  it('keeps only the kind for a non-death end', () => {
    expect(divergenceBucket({ kind: 'stuck', ...base })).toBe('stuck');
    expect(divergenceBucket(null)).toBe('no divergence');
  });

  it('ranks the biggest bucket first and lists its paths', () => {
    const ranked = rankBuckets([
      { path: 'a', divergence: death({ monsters: ['m1'] }) },
      { path: 'b', divergence: { kind: 'no_exit', ...base } },
      { path: 'c', divergence: death({ monsters: ['m1'] }) }
    ]);
    expect(ranked[0]).toEqual({ bucket: 'death / death.test / monster m1', levels: 2, paths: ['a', 'c'] });
    expect(ranked[1].bucket).toBe('no_exit');
  });

  it('passes the gate on equal or higher Epoxy wins', () => {
    expect(gatePasses(50, 50)).toBe(true);
    expect(gatePasses(35, 50)).toBe(false);
  });
});
