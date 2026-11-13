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

/** State and hooks the CC2 wave 5 rules build on: held tools in snapshots, the shared pickup predicates, the rolling ball flag. */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => ({
  AudioManager: { playSfx: vi.fn(), playStep: vi.fn() }
}));

import { findCharacterItemConfigErrors } from '../../config/ConfigValidation';
import { ConfigRegistry } from '../../config/ConfigRegistry';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { GameEngine } from '../GameEngine';
import { CC2_ENTITY_TOOL_CAPACITY, CC_MONSTER_STEP_TICKS, MONSTER_IGNORED_KEY_COLOR, MONSTER_PICKUP_COLLECTIBLES, ccStepTicks, followsCcCadence, registerCcCadenceLookup } from '../coreConstants';
import { monsterPicksUp, rollingBallPicksUp } from './epoxyMonsters';
import type { CompiledLevel, TileDefinition } from '../types';

/** Id of the rolling ball entity (what the hurl stone becomes when set down on a CC2-engine level). */
const ROLLING_BALL_ID = 'rolling_ball';

beforeEach(() => {
  loadTestConfigs();
});

function levelWithGhost(): CompiledLevel {
  const { mapWidth, mapHeight } = ConfigRegistry.getGame().grid;
  return {
    id: 'held_tools',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    playerStart: { x: 2, y: 2, dir: 'S' },
    terrain: Array.from({ length: mapHeight }, (_, y) =>
      Array.from({ length: mapWidth }, (_, x) => (x === 0 || y === 0 || x === mapWidth - 1 || y === mapHeight - 1 ? 'wall' : 'floor'))
    ),
    items: Array.from({ length: mapHeight }, () => Array.from({ length: mapWidth }, () => null)),
    entities: [{ type: 'ghost', x: 6, y: 6, dir: 'S' }],
    trapLinks: [],
    cloneLinks: []
  };
}

describe('held tools in snapshots', () => {
  it('keeps the capacity constant at four', () => {
    expect(CC2_ENTITY_TOOL_CAPACITY).toBe(4);
  });

  it('does not let a live entity change a snapshot taken before', () => {
    const engine = new GameEngine();
    engine.loadLevel(levelWithGhost());
    const ghost = engine.getEntities()[0];
    ghost.heldTools = ['boots_water'];
    const snap = engine.captureState();
    ghost.heldTools.push('boots_fire');
    expect(snap.entities[0].heldTools).toEqual(['boots_water']);
  });

  it('gives a restored entity its own array', () => {
    const engine = new GameEngine();
    engine.loadLevel(levelWithGhost());
    engine.getEntities()[0].heldTools = ['boots_water'];
    const snap = engine.captureState();
    engine.restoreState(snap);
    const restored = engine.getEntities()[0];
    expect(restored.heldTools).toEqual(['boots_water']);
    expect(restored.heldTools).not.toBe(snap.entities[0].heldTools);
    restored.heldTools?.push('boots_fire');
    expect(snap.entities[0].heldTools).toEqual(['boots_water']);
  });

  it('leaves heldTools unset on an entity that holds nothing', () => {
    const engine = new GameEngine();
    engine.loadLevel(levelWithGhost());
    const snap = engine.captureState();
    expect('heldTools' in snap.entities[0]).toBe(false);
  });
});

describe('pickup predicates', () => {
  const legacy = (itemId: string): boolean => {
    const item = ConfigRegistry.getTile(itemId);
    return item.collectible !== undefined && MONSTER_PICKUP_COLLECTIBLES.includes(item.collectible) && item.colorKey !== MONSTER_IGNORED_KEY_COLOR;
  };

  it('keeps the picking monster predicate as it was on every item of the config', () => {
    const items = Object.values(ConfigRegistry.getTiles().tiles).filter((t) => t.layer === 'item');
    expect(items.length).toBeGreaterThan(10);
    for (const item of items) expect(monsterPicksUp(item.id), item.id).toBe(legacy(item.id));
  });

  it('takes the keys but the red one and the tools, and leaves chips and bonuses', () => {
    expect(monsterPicksUp('key_blue')).toBe(true);
    expect(monsterPicksUp('boots_water')).toBe(true);
    expect(monsterPicksUp('key_red')).toBe(false);
    expect(monsterPicksUp('chip')).toBe(false);
    expect(monsterPicksUp('score_100')).toBe(false);
  });

  it('lets the rolling ball take the same plus the flagged score bonuses only', () => {
    expect(rollingBallPicksUp('key_blue')).toBe(true);
    expect(rollingBallPicksUp('boots_water')).toBe(true);
    expect(rollingBallPicksUp('key_red')).toBe(false);
    expect(rollingBallPicksUp('chip')).toBe(false);
    for (const id of ['score_10', 'score_100', 'score_1000', 'score_2x']) expect(rollingBallPicksUp(id), id).toBe(true);
    expect(rollingBallPicksUp('stopwatch_bonus')).toBe(false);
    expect(rollingBallPicksUp('stopwatch_penalty')).toBe(false);
  });
});

describe('rolling ball pace', () => {
  it('walks at the classic monster pace, by the default step ticks of the cadence', () => {
    expect(ConfigRegistry.getEntityDef(ROLLING_BALL_ID)?.ccStepTicks).toBeUndefined();
    expect(ccStepTicks(ROLLING_BALL_ID)).toBe(CC_MONSTER_STEP_TICKS);
    expect(followsCcCadence(ROLLING_BALL_ID, true)).toBe(true);
  });
});

describe('cadence lookup', () => {
  it('throws a clear error when the monster definitions were not registered', () => {
    registerCcCadenceLookup(null);
    try {
      expect(() => followsCcCadence('glider', false)).toThrow(/registerCcCadenceLookup/);
      expect(() => ccStepTicks('glider')).toThrow(/registerCcCadenceLookup/);
    } finally {
      registerCcCadenceLookup((type) => ConfigRegistry.getEntityDef(type));
    }
    expect(followsCcCadence('glider', false)).toBe(true);
  });
});

describe('validation of takenByNormalPickupCc2', () => {
  const tile = (fields: Partial<TileDefinition>): Record<string, TileDefinition> => ({
    probe: { id: 'probe', category: 'items', layer: 'item', i18nKey: 'x', ...fields } as TileDefinition
  });

  it('accepts a boolean on a bonus item', () => {
    expect(findCharacterItemConfigErrors(tile({ collectible: 'bonus', takenByNormalPickupCc2: true }))).toEqual([]);
  });

  it('refuses a non-boolean value and an item that is no bonus', () => {
    expect(findCharacterItemConfigErrors(tile({ collectible: 'bonus', takenByNormalPickupCc2: 'yes' as unknown as boolean }))).toHaveLength(1);
    expect(findCharacterItemConfigErrors(tile({ collectible: 'chip', takenByNormalPickupCc2: true }))).toHaveLength(1);
    expect(findCharacterItemConfigErrors(tile({ takenByNormalPickupCc2: true }))).toHaveLength(1);
  });

  it('leaves the shipped config valid', () => {
    expect(findCharacterItemConfigErrors(ConfigRegistry.getTiles().tiles)).toEqual([]);
  });
});
