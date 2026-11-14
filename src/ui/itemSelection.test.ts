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
import { BRIBE_ITEM_ID, TOKEN_ITEM_ID } from '../core/coreConstants';
import { engineToolBelt, isItemSelectable, selectableItemOrder } from './itemSelection';

const KEYS = ['key_red', 'key_blue'];
const BOOTS = ['boots_water', 'boots_fire', TOKEN_ITEM_ID, BRIBE_ITEM_ID];

describe('item selection', () => {
  it('excludes the bribe and the token on a native level', () => {
    expect(isItemSelectable(BRIBE_ITEM_ID, undefined)).toBe(false);
    expect(isItemSelectable(TOKEN_ITEM_ID, undefined)).toBe(false);
    expect(selectableItemOrder(KEYS, BOOTS, undefined)).toEqual([...KEYS, 'boots_water', 'boots_fire']);
  });

  it('selects the bribe on a belt level, never the token', () => {
    const belt = ['boots_fire', BRIBE_ITEM_ID];
    expect(isItemSelectable(BRIBE_ITEM_ID, belt)).toBe(true);
    expect(isItemSelectable(TOKEN_ITEM_ID, belt)).toBe(false);
    expect(isItemSelectable('boots_fire', belt)).toBe(true);
  });

  it('follows the belt order, oldest first, with no duplicates', () => {
    const belt = [BRIBE_ITEM_ID, 'boots_fire', BRIBE_ITEM_ID];
    expect(selectableItemOrder(KEYS, BOOTS, belt)).toEqual([...KEYS, BRIBE_ITEM_ID, 'boots_fire', 'boots_water']);
  });

  it('reads the belt from an engine that has one, and nothing from one that has none', () => {
    const belt = [BRIBE_ITEM_ID];
    expect(engineToolBelt({ getToolBelt: () => belt })).toBe(belt);
    expect(engineToolBelt({ getToolBelt: () => undefined })).toBeUndefined();
    expect(engineToolBelt({})).toBeUndefined();
  });
});
