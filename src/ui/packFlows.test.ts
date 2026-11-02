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
import { planLibraryChange } from './packFlows';

const base = {
  deletedPackIds: [] as string[],
  playedPackId: 'a',
  activePackId: 'a',
  activeLevelIds: ['l1', 'l2', 'l3'],
  engineLevelId: 'l2'
};

describe('planLibraryChange', () => {
  it('restarts when the pack being played was deleted', () => {
    expect(planLibraryChange({ ...base, deletedPackIds: ['a'], activePackId: 'epoxy_campaign' })).toEqual({
      restart: true,
      newIndex: null
    });
  });

  it('ignores the deletion of another pack', () => {
    expect(planLibraryChange({ ...base, deletedPackIds: ['b'] })).toEqual({ restart: false, newIndex: 1 });
  });

  it('follows the level on screen when levels were reordered', () => {
    expect(planLibraryChange({ ...base, activeLevelIds: ['l2', 'l1', 'l3'] })).toEqual({
      restart: false,
      newIndex: 0
    });
  });

  it('leaves the index alone when the level on screen left the pack', () => {
    expect(planLibraryChange({ ...base, activeLevelIds: ['l1', 'l3'] })).toEqual({
      restart: false,
      newIndex: null
    });
  });

  it('does nothing when the played pack is no longer the active one', () => {
    expect(planLibraryChange({ ...base, playedPackId: 'x' })).toEqual({ restart: false, newIndex: null });
  });
});
