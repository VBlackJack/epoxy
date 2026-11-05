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

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { loadTestConfigs } from '../test/loadTestConfigs';
import {
  featuresFor,
  hasColorChannelContent,
  hasEpoxyOnlyContent,
  hasEpoxyOnlyMonsterContent,
  hasLaserContent,
  hasSignalContent,
  hasSteeringContent,
  hasTurretContent,
  isColorChannelTileId,
  isEpoxyOnlyEntityType,
  isEpoxyOnlyItemId,
  isEpoxyOnlyTileId,
  isEyeBootsTileId,
  isFleeingEntityType,
  isSteeredEntityType,
  isSteeringTileId,
  isSignalTileId,
  isTurnPlateTileId,
  isTurretEntityType,
  isArrowBlockEntityType
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

describe('signal content', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  const level = (): Pick<CompiledLevel, 'ruleset' | 'terrain' | 'items' | 'entities'> &
    Partial<Pick<CompiledLevel, 'signalLinks'>> => ({
    ruleset: 'epoxy',
    terrain: [['wall', 'wall', 'wall'], ['wall', 'floor', 'wall'], ['wall', 'wall', 'wall']],
    items: [[null, null, null], [null, null, null], [null, null, null]],
    entities: []
  });

  it('is false for a plain level and true once it has wires', () => {
    expect(hasSignalContent(level())).toBe(false);
    expect(hasEpoxyOnlyContent(level())).toBe(false);
    const wired = { ...level(), signalLinks: [{ fromX: 1, fromY: 1, toX: 2, toY: 1 }] };
    expect(hasSignalContent(wired)).toBe(true);
    expect(hasEpoxyOnlyContent(wired)).toBe(true);
    expect(hasSignalContent({ ...level(), signalLinks: [] })).toBe(false);
  });

  it('turns the tapped path, the hint and the watch off for a wired level and keeps the rest', () => {
    const plain = featuresFor(level());
    expect(plain.tapToPath).toBe(true);
    const wired = featuresFor({ ...level(), signalLinks: [{ fromX: 1, fromY: 1, toX: 2, toY: 1 }] });
    expect(wired.tapToPath).toBe(false);
    expect(wired.blockHint).toBe(false);
    expect(wired.deadEndWatch).toBe(false);
    expect(wired.objectiveMarker).toBe(plain.objectiveMarker);
  });
});

describe('signal content before the configs are loaded', () => {
  it('reads a level without crashing and finds no signal tile', async () => {
    vi.resetModules();
    const features = await import('./RulesetFeatures');
    const codec = await import('../formats/DatCodec');
    const terrain = [['wall', 'floor'], ['floor', 'wall']];
    const level = { ruleset: 'epoxy' as const, terrain, items: [[null, null], [null, null]], entities: [] };
    expect(features.hasSignalContent(level)).toBe(false);
    expect(features.hasSignalContent({ terrain, underlays: [{ x: 1, y: 0, terrain: 'floor' }] })).toBe(false);
    expect(features.hasSignalContent({ signalLinks: [{ fromX: 0, fromY: 0, toX: 1, toY: 0 }] })).toBe(true);
    expect(() => codec.datRefusalReason({ ...level, winRule: 'targets', playerStart: { x: 0, y: 0 } } as never)).not.toThrow();
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
    expect(isEpoxyOnlyTileId('boots_speed')).toBe(true);
    expect(isEpoxyOnlyTileId('boots_eye')).toBe(true);
    expect(isEyeBootsTileId('boots_eye')).toBe(true);
    expect(isEyeBootsTileId('boots_speed')).toBe(false);
    expect(isEpoxyOnlyItemId('boots_eye')).toBe(true);
    expect(isEpoxyOnlyItemId('boots_fire')).toBe(false);
    const eyed = levelWith('floor');
    eyed.items[1][1] = 'boots_eye';
    expect(hasEpoxyOnlyContent(eyed)).toBe(true);
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

  it('names the turrets as Epoxy only and as laser content, and turns the laser aids and tap to path off', () => {
    for (const id of ['turret_fixed', 'turret_cw', 'turret_ccw', 'turret_multi']) {
      expect(isTurretEntityType(id), id).toBe(true);
      expect(isEpoxyOnlyEntityType(id), id).toBe(true);
    }
    expect(isTurretEntityType('dirt_block')).toBe(false);
    const level = levelWith('floor', 'turret_cw');
    expect(hasTurretContent(level)).toBe(true);
    expect(hasLaserContent(level)).toBe(true);
    expect(hasEpoxyOnlyContent(level)).toBe(true);
    const features = featuresFor(level);
    expect(features.tapToPath).toBe(false);
    expect(features.blockHint).toBe(false);
    expect(features.deadEndWatch).toBe(false);
    expect(features.objectiveMarker).toBe(true);
    // A clone machine linked to a turret template counts without a turret on the grid.
    const linked = {
      ...levelWith('floor'),
      cloneLinks: [{ buttonX: 1, buttonY: 1, clonerX: 2, clonerY: 2, templateType: 'turret_fixed', templateDir: 'E' as const }]
    };
    expect(hasLaserContent(linked)).toBe(true);
    expect(featuresFor(linked).tapToPath).toBe(false);
    expect(featuresFor({ ...level, winRule: 'receivers' }).tapToPath).toBe(false);
    expect(featuresFor({ ...levelWith('floor'), winRule: 'receivers' }).tapToPath).toBe(true);
  });

  it('names the arrow blocks as Epoxy only, whether placed or linked to a clone machine', () => {
    for (const id of ['arrow_block_one', 'arrow_block_line', 'arrow_block_corner', 'arrow_block_tee']) {
      expect(isArrowBlockEntityType(id), id).toBe(true);
      expect(isEpoxyOnlyEntityType(id), id).toBe(true);
      expect(hasEpoxyOnlyContent(levelWith('floor', id)), id).toBe(true);
    }
    expect(isArrowBlockEntityType('dirt_block')).toBe(false);
    expect(hasEpoxyOnlyContent(levelWith('floor', 'dirt_block'))).toBe(false);
    const linked = {
      ...levelWith('floor'),
      cloneLinks: [{ buttonX: 1, buttonY: 1, clonerX: 2, clonerY: 2, templateType: 'arrow_block_one', templateDir: 'E' as const }]
    };
    expect(hasEpoxyOnlyContent(linked)).toBe(true);
  });

  it('counts a level with launcher links as laser content even when the grids show no launcher', () => {
    const level = levelWith('floor');
    expect(hasLaserContent(level)).toBe(false);
    const linked = { ...level, launcherLinks: [{ buttonX: 1, buttonY: 1, launcherX: 2, launcherY: 2 }] };
    expect(hasLaserContent(linked)).toBe(true);
    expect(hasLaserContent({ ...level, launcherLinks: [] })).toBe(false);
  });

  it('names the puppet, its control and the skitter as Epoxy only', () => {
    expect(isSteeredEntityType('puppet')).toBe(true);
    expect(isSteeredEntityType('skitter')).toBe(false);
    expect(isFleeingEntityType('skitter')).toBe(true);
    expect(isFleeingEntityType('teeth')).toBe(false);
    expect(isSteeringTileId('puppet_control')).toBe(true);
    expect(isSteeringTileId('button_green')).toBe(false);
    for (const id of ['puppet', 'skitter']) expect(isEpoxyOnlyEntityType(id), id).toBe(true);
    expect(isEpoxyOnlyTileId('puppet_control')).toBe(true);
    expect(isEpoxyOnlyEntityType('teeth')).toBe(false);
  });

  it('names the turn plates as Epoxy only', () => {
    for (const id of ['turn_plate_cw', 'turn_plate_ccw']) {
      expect(isTurnPlateTileId(id), id).toBe(true);
      expect(isEpoxyOnlyTileId(id), id).toBe(true);
      expect(hasEpoxyOnlyMonsterContent(levelWith(id)), id).toBe(true);
    }
    expect(isTurnPlateTileId('floor')).toBe(false);
    expect(isTurnPlateTileId(null)).toBe(false);
    expect(hasEpoxyOnlyMonsterContent(levelWith('floor'))).toBe(false);
  });

  it('names the signal plate and gates as Epoxy only', () => {
    const ids = ['signal_plate', 'signal_gate_and', 'signal_gate_or', 'signal_gate_not', 'signal_gate_xor', 'signal_latch_off', 'signal_latch_on'];
    for (const id of ids) {
      expect(isSignalTileId(id), id).toBe(true);
      expect(isEpoxyOnlyTileId(id), id).toBe(true);
    }
    expect(isSignalTileId('floor')).toBe(false);
    expect(isSignalTileId('hold_door_red_closed')).toBe(false);
    expect(isSignalTileId(null)).toBe(false);
  });

  it('turns tap to path, the block hint and the dead end watch off on a steering level, and keeps the rest', () => {
    for (const level of [levelWith('puppet_control'), levelWith('floor', 'puppet')]) {
      expect(hasSteeringContent(level)).toBe(true);
      expect(hasEpoxyOnlyContent(level)).toBe(true);
      const features = featuresFor(level);
      expect(features.tapToPath).toBe(false);
      expect(features.blockHint).toBe(false);
      expect(features.deadEndWatch).toBe(false);
      expect(features.objectiveMarker).toBe(true);
      expect(features.solutionReplay).toBe(true);
    }
    // A clone machine linked to a puppet template counts without a puppet on the grid.
    const linked = {
      ...levelWith('floor'),
      cloneLinks: [{ buttonX: 1, buttonY: 1, clonerX: 2, clonerY: 2, templateType: 'puppet', templateDir: 'E' as const }]
    };
    expect(hasSteeringContent(linked)).toBe(true);
    expect(featuresFor(linked).tapToPath).toBe(false);
    expect(featuresFor(levelWith('floor')).tapToPath).toBe(true);
  });

  it('puts the steering overlay on top of the laser, colour and receivers rules, as one object per case', () => {
    const lasers = featuresFor(levelWith('puppet_control', 'mirror_slash'));
    expect(lasers.tapToPath).toBe(false);
    expect(lasers.blockHint).toBe(false);
    const receivers = featuresFor({ ...levelWith('puppet_control'), winRule: 'receivers' as const });
    expect(receivers.objectiveMarker).toBe(false);
    expect(receivers.tapToPath).toBe(false);
    const colour = featuresFor(levelWith('pressure_plate_red', 'puppet'));
    expect(colour.tapToPath).toBe(false);
    expect(featuresFor(levelWith('puppet_control', 'color_block_red'))).toBe(featuresFor(levelWith('puppet_control', 'color_block_blue')));
    // The overlay is a new aid set only where it changes something.
    const plain = featuresFor(levelWith('puppet_control'));
    expect(plain).toBe(featuresFor(levelWith('puppet_control')));
    expect(plain).not.toBe(featuresFor(levelWith('floor')));
  });

  it('leaves a lynx or cc3d level as it was, whatever it holds', () => {
    expect(featuresFor({ ...levelWith('puppet_control'), ruleset: 'lynx' })).toEqual(featuresFor({ ruleset: 'lynx' }));
    expect(featuresFor({ ...levelWith('puppet_control'), ruleset: 'cc3d' })).toEqual(featuresFor({ ruleset: 'cc3d' }));
  });

  it('counts a skitter as Epoxy only without turning any aid off', () => {
    const level = levelWith('floor', 'skitter');
    expect(hasSteeringContent(level)).toBe(false);
    expect(hasEpoxyOnlyMonsterContent(level)).toBe(true);
    expect(hasEpoxyOnlyContent(level)).toBe(true);
    expect(featuresFor(level).tapToPath).toBe(true);
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
