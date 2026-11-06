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

/**
 * Every id the game can draw belongs to exactly one of the three Runeward sets: painted by a
 * Runeward painter, kept on the shared drawing, or part of the CC3D ruleset. A new tile, item or
 * entity makes this test fail until someone decides which set it joins.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { ConfigRegistry } from '../../../config/ConfigRegistry';
import { loadTestConfigs } from '../../../test/loadTestConfigs';
import { findRunewardPainter, RUNEWARD_CC3D_IDS, RUNEWARD_FALLBACK, RUNEWARD_PAINTERS } from './runewardTiles';

const ITEM_LAYER = 'item';

/** Every id with a Runeward painter, over all the dispatch tables. */
function painterIds(): Set<string> {
  return new Set([
    ...Object.keys(RUNEWARD_PAINTERS.tiles),
    ...Object.keys(RUNEWARD_PAINTERS.items),
    ...Object.keys(RUNEWARD_PAINTERS.entities)
  ]);
}

/** How many of the three sets hold the id. */
function membership(id: string): number {
  return [painterIds().has(id), RUNEWARD_FALLBACK.has(id), RUNEWARD_CC3D_IDS.has(id)].filter(Boolean).length;
}

describe('Runeward painter coverage', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  it('leaves the fallback set empty: only CC3D display ids keep the shared drawing', () => {
    expect(RUNEWARD_FALLBACK.size).toBe(0);
    const cc3dIds = Object.keys(ConfigRegistry.getCc3dTiles().tiles);
    expect(cc3dIds.filter((id) => !RUNEWARD_CC3D_IDS.has(id) && !painterIds().has(id))).toEqual([]);
    expect(cc3dIds.filter((id) => RUNEWARD_CC3D_IDS.has(id) && painterIds().has(id))).toEqual([]);
  });

  it('places every tile id in exactly one set', () => {
    const wrong = Object.keys(ConfigRegistry.getTiles().tiles).filter((id) => membership(id) !== 1);
    expect(wrong).toEqual([]);
  });

  it('places every item id in exactly one set', () => {
    const items = Object.values(ConfigRegistry.getTiles().tiles).filter((tile) => tile.layer === ITEM_LAYER);
    expect(items.length).toBeGreaterThan(0);
    expect(items.map((tile) => tile.id).filter((id) => membership(id) !== 1)).toEqual([]);
  });

  it('places every entity id in exactly one set', () => {
    const ids = Object.keys(ConfigRegistry.getMonsters().entities);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.filter((id) => membership(id) !== 1)).toEqual([]);
  });

  it('places every CC3D display id in exactly one set', () => {
    const ids = Object.keys(ConfigRegistry.getCc3dTiles().tiles);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.filter((id) => membership(id) !== 1)).toEqual([]);
  });

  it('keeps the fallback and CC3D sets free of ids the game no longer has', () => {
    const known = new Set([
      ...Object.keys(ConfigRegistry.getTiles().tiles),
      ...Object.keys(ConfigRegistry.getMonsters().entities),
      ...Object.keys(ConfigRegistry.getCc3dTiles().tiles)
    ]);
    expect([...RUNEWARD_FALLBACK, ...RUNEWARD_CC3D_IDS].filter((id) => !known.has(id))).toEqual([]);
    expect([...painterIds()].filter((id) => !known.has(id))).toEqual([]);
  });

  it('finds a painter by its own key only', () => {
    const table = { floor: 1 };
    expect(findRunewardPainter(table, 'floor')).toBe(1);
    expect(findRunewardPainter(table, 'toString')).toBeUndefined();
    expect(findRunewardPainter(table, 'wall')).toBeUndefined();
  });

  it('gives every animated tile a tile painter, and the player a painter', () => {
    expect(RUNEWARD_PAINTERS.animatedTiles.size).toBeGreaterThan(0);
    expect([...RUNEWARD_PAINTERS.animatedTiles].filter((id) => !(id in RUNEWARD_PAINTERS.tiles))).toEqual([]);
    expect(RUNEWARD_PAINTERS.player).not.toBeNull();
  });
});
