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

import { beforeAll, describe, expect, it } from 'vitest';
import { loadTestConfigs } from '../test/loadTestConfigs';
import {
  featuresFor,
  hasColorChannelContent,
  hasEpoxyOnlyContent,
  isColorChannelTileId,
  isEpoxyOnlyEntityType,
  isEpoxyOnlyTileId
} from './RulesetFeatures';
import { CompiledLevel } from './types';

describe('featuresFor rulesets', () => {
  it('turns every Epoxy play aid off for a cc3d level, even with a win rule', () => {
    for (const level of [{ ruleset: 'cc3d' as const }, { ruleset: 'cc3d' as const, winRule: 'receivers' as const }]) {
      const f = featuresFor(level);
      expect(f.tapToPath).toBe(false);
      expect(f.objectiveMarker).toBe(false);
      expect(f.blockHint).toBe(false);
      expect(f.deadEndWatch).toBe(false);
      expect(f.solutionReplay).toBe(false);
      expect(f.itemDrop).toBe(false);
    }
  });

  it('matches the lynx aids for cc3d and keeps the Epoxy aids otherwise', () => {
    expect(featuresFor({ ruleset: 'cc3d' })).toEqual(featuresFor({ ruleset: 'lynx' }));
    expect(featuresFor({ ruleset: 'epoxy' }).tapToPath).toBe(true);
    expect(featuresFor(undefined).deadEndWatch).toBe(true);
  });
});

describe('colour channel aids', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  const grid = (cell: string): string[][] => [['wall', 'wall', 'wall'], ['wall', cell, 'wall'], ['wall', 'wall', 'wall']];
  const levelWith = (cell: string, entityType?: string): Pick<CompiledLevel, 'ruleset' | 'terrain' | 'items' | 'entities'> => ({
    ruleset: 'epoxy',
    terrain: grid(cell),
    items: grid('x').map((row) => row.map(() => null)),
    entities: entityType ? [{ type: entityType, x: 1, y: 1, dir: 'S' }] : []
  });

  it('names the slow-time item as Epoxy only, alone and in a level', () => {
    expect(isEpoxyOnlyTileId('slow_time')).toBe(true);
    expect(isEpoxyOnlyTileId('boots_fire')).toBe(false);
    const level = levelWith('floor');
    level.items[1][1] = 'slow_time';
    expect(hasEpoxyOnlyContent(level)).toBe(true);
  });

  it('names the channel tiles and colour blocks as Epoxy only', () => {
    for (const id of ['pressure_plate_red', 'hold_door_blue_open', 'toggle_wall_yellow_closed', 'toggle_button_red', 'floating_block_green']) {
      expect(isColorChannelTileId(id), id).toBe(true);
      expect(isEpoxyOnlyTileId(id), id).toBe(true);
    }
    for (const id of ['floor', 'toggle_wall_closed', 'button_green', 'button_red']) {
      expect(isColorChannelTileId(id), id).toBe(false);
    }
    expect(isEpoxyOnlyTileId('laser_emitter_e')).toBe(true);
    expect(isEpoxyOnlyEntityType('color_block_red')).toBe(true);
    expect(isEpoxyOnlyEntityType('mirror_slash')).toBe(true);
    expect(isEpoxyOnlyEntityType('dirt_block')).toBe(false);
  });

  it('turns the block hint, the dead end watch and tap to path off on a colour level', () => {
    const features = featuresFor(levelWith('pressure_plate_red'));
    expect(features.blockHint).toBe(false);
    expect(features.deadEndWatch).toBe(false);
    expect(features.tapToPath).toBe(false);
    expect(features.objectiveMarker).toBe(true);
    expect(featuresFor(levelWith('floor', 'color_block_red')).tapToPath).toBe(false);
    expect(featuresFor(levelWith('floor')).tapToPath).toBe(true);
  });

  it('turns tap to path off on a receivers level that also has colour content', () => {
    const colour = { ...levelWith('pressure_plate_red'), winRule: 'receivers' as const };
    const features = featuresFor(colour);
    expect(features.tapToPath).toBe(false);
    expect(features.objectiveMarker).toBe(false);
    expect(features.blockHint).toBe(false);
    expect(featuresFor({ ...levelWith('floor'), winRule: 'receivers' as const }).tapToPath).toBe(true);
  });

  it('returns the same features object for every laser and colour level', () => {
    const first = featuresFor(levelWith('laser_emitter_e', 'color_block_red'));
    expect(featuresFor(levelWith('laser_emitter_e', 'color_block_blue'))).toBe(first);
  });

  it('keeps the laser aids off when a level has lasers and colours', () => {
    const features = featuresFor(levelWith('laser_emitter_e', 'color_block_red'));
    expect(features.blockHint).toBe(false);
    expect(features.tapToPath).toBe(false);
  });

  it('detects colour and epoxy-only content', () => {
    expect(hasColorChannelContent(levelWith('hold_door_red_closed'))).toBe(true);
    expect(hasColorChannelContent(levelWith('floor'))).toBe(false);
    expect(hasEpoxyOnlyContent(levelWith('laser_emitter_e'))).toBe(true);
    expect(hasEpoxyOnlyContent(levelWith('floor', 'color_block_blue'))).toBe(true);
    expect(hasEpoxyOnlyContent(levelWith('floor', 'dirt_block'))).toBe(false);
  });
});
