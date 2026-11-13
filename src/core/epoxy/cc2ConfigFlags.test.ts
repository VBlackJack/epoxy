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

/** CC2 rules that used to key on an entity id now key on a flag of the entity definition, validated like the other flags. */

import { beforeEach, describe, expect, it } from 'vitest';

import { findMonsterBehaviourConfigErrors } from '../../config/ConfigValidation';
import { ConfigRegistry } from '../../config/ConfigRegistry';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import type { EntityDefinition, TileDefinition } from '../types';

beforeEach(() => {
  loadTestConfigs();
});

const ARROW_BLOCKS = ['arrow_block_one', 'arrow_block_line', 'arrow_block_corner', 'arrow_block_tee', 'arrow_block_cross', 'arrow_block_none'];

describe('CC2 entity flags in the shipped config', () => {
  it('flags the fireball as the monster that melts bumped ice and no other monster', () => {
    expect(ConfigRegistry.getEntityDef('fireball')?.meltsIceOnBumpCc2).toBe(true);
    expect(ConfigRegistry.getEntityDef('glider')?.meltsIceOnBumpCc2).toBeUndefined();
  });

  it('flags every arrow block, and no other block, as turning water into floor', () => {
    for (const id of ARROW_BLOCKS) expect(ConfigRegistry.getEntityDef(id)?.waterBecomesFloorCc2).toBe(true);
    expect(ConfigRegistry.getEntityDef('dirt_block')?.waterBecomesFloorCc2).toBeUndefined();
    expect(ConfigRegistry.getEntityDef('ice_block')?.waterBecomesFloorCc2).toBeUndefined();
  });
});

describe('validation of the CC2 entity flags', () => {
  const tiles: Record<string, TileDefinition> = {};
  const entity = (fields: Partial<EntityDefinition>): Record<string, EntityDefinition> => ({
    probe: { id: 'probe', category: 'entities', kind: 'monster', i18nKey: 'x', ...fields } as EntityDefinition
  });

  it('accepts the flags on the right kind of entity', () => {
    expect(findMonsterBehaviourConfigErrors(tiles, entity({ meltsIceOnBumpCc2: true }))).toEqual([]);
    expect(findMonsterBehaviourConfigErrors(tiles, entity({ kind: 'block', waterBecomesFloorCc2: true }))).toEqual([]);
  });

  it('refuses a non-boolean value and the wrong kind', () => {
    expect(findMonsterBehaviourConfigErrors(tiles, entity({ meltsIceOnBumpCc2: 'yes' as unknown as boolean }))).toHaveLength(1);
    expect(findMonsterBehaviourConfigErrors(tiles, entity({ kind: 'block', meltsIceOnBumpCc2: true }))).toHaveLength(1);
    expect(findMonsterBehaviourConfigErrors(tiles, entity({ waterBecomesFloorCc2: true }))).toHaveLength(1);
  });
});
