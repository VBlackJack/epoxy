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
import { BUILTIN_PACK_IDS } from '../config/constants';
import { isRemovablePack, removablePackIds } from './importedPacks';

describe('importedPacks', () => {
  it('never treats the campaign or custom pack as removable', () => {
    expect(isRemovablePack({ id: BUILTIN_PACK_IDS.CAMPAIGN })).toBe(false);
    expect(isRemovablePack({ id: BUILTIN_PACK_IDS.CUSTOM })).toBe(false);
    expect(isRemovablePack({ id: 'imported_a', builtIn: false })).toBe(true);
  });

  it('excludes built-in packs and keeps imported ones', () => {
    expect(isRemovablePack({ id: 'bundled_x', builtIn: true })).toBe(false);
    expect(
      removablePackIds([
        { id: 'bundled_x', builtIn: true },
        { id: 'imported_a', builtIn: false },
        { id: 'imported_b' }
      ])
    ).toEqual(['imported_a', 'imported_b']);
  });

  it('lists only removable ids, in order and without duplicates', () => {
    const packs = [
      { id: BUILTIN_PACK_IDS.CAMPAIGN },
      { id: 'imported_a' },
      { id: BUILTIN_PACK_IDS.CUSTOM },
      { id: 'imported_b' },
      { id: 'imported_a' }
    ];
    expect(removablePackIds(packs)).toEqual(['imported_a', 'imported_b']);
  });

  it('returns an empty list when nothing is removable', () => {
    expect(removablePackIds([{ id: BUILTIN_PACK_IDS.CAMPAIGN }])).toEqual([]);
    expect(removablePackIds([])).toEqual([]);
  });
});
