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
import {
  classifyMapPair,
  divergenceBucket,
  gatePasses,
  levelNumberOfFile,
  pairedWins,
  rankBuckets,
  titlesMatch,
  type MapLike,
  type PairedOutcome
} from './cc1Fidelity';
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

describe('cc1Fidelity paired helpers', () => {
  const map = (extra: Partial<MapLike> = {}): MapLike => ({
    terrain: [['floor']],
    items: [[null]],
    entities: [{ x: 0, y: 0, type: 'bug', dir: 'N' }],
    playerStart: { x: 1, y: 1 },
    ...extra
  });

  it('classifies equal maps as exact, even when the entity order differs', () => {
    const a = map({ entities: [{ x: 0, y: 0, type: 'bug', dir: 'N' }, { x: 1, y: 0, type: 'ball', dir: 'E' }] });
    const b = map({ entities: [{ x: 1, y: 0, type: 'ball', dir: 'E' }, { x: 0, y: 0, type: 'bug', dir: 'N' }] });
    expect(classifyMapPair(a, b)).toBe('exact');
  });

  it('classifies a map with the same terrain only as terrain, and another terrain as differs', () => {
    expect(classifyMapPair(map(), map({ items: [['key']] }))).toBe('terrain');
    expect(classifyMapPair(map(), map({ terrain: [['wall']] }))).toBe('differs');
  });

  it('ignores the direction of a dirt block', () => {
    const a = map({ entities: [{ x: 2, y: 2, type: 'dirt_block', dir: 'N' }] });
    const b = map({ entities: [{ x: 2, y: 2, type: 'dirt_block', dir: 'S' }] });
    expect(classifyMapPair(a, b)).toBe('exact');
  });

  it('reads the level number of a file name', () => {
    expect(levelNumberOfFile('MAP012.c2m')).toBe(12);
    expect(levelNumberOfFile('intro.c2m')).toBeNull();
  });

  it('compares titles without case or outer spaces', () => {
    expect(titlesMatch(' Lesson 1 ', 'LESSON 1')).toBe(true);
    expect(titlesMatch('a', undefined)).toBe(false);
  });

  it('sums paired wins, overall and per map class', () => {
    const outcome = (mapClass: PairedOutcome['mapClass'], c2mEpoxy: boolean, datLynx: boolean): PairedOutcome => ({
      mapClass,
      c2mEpoxy,
      c2mLynx: false,
      datEpoxy: true,
      datLynx
    });
    const all = [outcome('exact', true, false), outcome('exact', false, true), outcome('differs', true, true)];
    expect(pairedWins(all)).toEqual({ levels: 3, c2mEpoxy: 2, c2mLynx: 0, datEpoxy: 3, datLynx: 2 });
    expect(pairedWins(all, 'exact')).toEqual({ levels: 2, c2mEpoxy: 1, c2mLynx: 0, datEpoxy: 2, datLynx: 1 });
    expect(pairedWins(all, 'terrain').levels).toBe(0);
  });
});
