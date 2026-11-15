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
 * CC2 wave 12, config validation: the decision cycle of a monster type (cc2DecisionCycleTicks) and the tiles a monster enters on the
 * CC2 engine only (entersBarredTilesCc2) are checked at load, so a bad value is refused instead of read as a cycle or a tile id.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { ConfigRegistry } from '../../config/ConfigRegistry';
import { findMonsterBehaviourConfigErrors, findSteeringConfigErrors } from '../../config/ConfigValidation';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { CC_TEETH_ACTIVE_TICKS } from '../coreConstants';
import type { EntityDefinition, TileDefinition } from '../types';

beforeEach(() => {
  loadTestConfigs();
});

const MIMIC_ID = 'floor_mimic';
const ROVER_ID = 'rover';
const BLOCK_ID = 'dirt_block';
const UNKNOWN_TILE = 'no_such_tile';
const CC2_ONLY_TILE = 'dirt_cc2';
/** A tile already barred for the rover on every engine (its entersBarredTiles). */
const SHARED_TILE = 'exit';
const TOO_SHORT_CYCLE = CC_TEETH_ACTIVE_TICKS - 1;
const FRACTIONAL_CYCLE = CC_TEETH_ACTIVE_TICKS + 0.5;

const tiles = (): Record<string, TileDefinition> => ConfigRegistry.getTiles().tiles;
const entities = (): Record<string, EntityDefinition> => ConfigRegistry.getMonsters().entities;

describe('cc2DecisionCycleTicks', () => {
  const bad = (id: string, patch: Partial<EntityDefinition>): string[] =>
    findSteeringConfigErrors(tiles(), { ...entities(), [id]: { ...entities()[id], ...patch } }).filter((e) => e.includes('cc2DecisionCycleTicks'));

  it('accepts the shipped value', () => {
    expect(entities()[MIMIC_ID].cc2DecisionCycleTicks).toBeDefined();
    expect(bad(MIMIC_ID, {})).toEqual([]);
  });

  it('refuses a cycle shorter than the teeth window', () => {
    expect(bad(MIMIC_ID, { cc2DecisionCycleTicks: TOO_SHORT_CYCLE })).toHaveLength(1);
  });

  it('refuses a cycle that is not a whole number', () => {
    expect(bad(MIMIC_ID, { cc2DecisionCycleTicks: FRACTIONAL_CYCLE })).toHaveLength(1);
  });

  it('refuses the field on an entity that is not a monster', () => {
    expect(bad(BLOCK_ID, { cc2DecisionCycleTicks: CC_TEETH_ACTIVE_TICKS })).not.toEqual([]);
  });

  it('refuses the field on a monster that is not on the CC2 cadence', () => {
    expect(bad(MIMIC_ID, { cc2Cadence: undefined })).toHaveLength(1);
  });
});

describe('entersBarredTilesCc2', () => {
  const bad = (id: string, patch: Partial<EntityDefinition>): string[] =>
    findMonsterBehaviourConfigErrors(tiles(), { ...entities(), [id]: { ...entities()[id], ...patch } }).filter((e) => e.includes('entersBarredTilesCc2'));

  it('accepts the shipped lists', () => {
    expect(entities()[ROVER_ID].entersBarredTilesCc2).toBeDefined();
    expect(bad(ROVER_ID, {})).toEqual([]);
  });

  it('refuses a tile id that does not exist', () => {
    expect(bad(ROVER_ID, { entersBarredTilesCc2: [UNKNOWN_TILE] })).toHaveLength(1);
  });

  it('refuses a tile that entersBarredTiles already lists', () => {
    expect(entities()[ROVER_ID].entersBarredTiles).toContain(SHARED_TILE);
    expect(bad(ROVER_ID, { entersBarredTilesCc2: [SHARED_TILE] })).toHaveLength(1);
  });

  it('refuses a tile listed twice', () => {
    expect(bad(ROVER_ID, { entersBarredTilesCc2: [CC2_ONLY_TILE, CC2_ONLY_TILE] })).toHaveLength(1);
  });

  it('refuses a value that is not a list', () => {
    expect(bad(ROVER_ID, { entersBarredTilesCc2: CC2_ONLY_TILE as unknown as string[] })).toHaveLength(1);
  });

  it('refuses the field on an entity that is not a monster', () => {
    expect(bad(BLOCK_ID, { entersBarredTilesCc2: [CC2_ONLY_TILE] })).toHaveLength(1);
  });
});
