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

import { ConfigRegistry } from '../config/ConfigRegistry';
import { FIRE_LAUNCHERS_ACTION, FLEE_PLAYER_PATTERN, STEER_MONSTERS_ACTION, channelOfButtonAction } from './coreConstants';
import { CompiledLevel } from './types';

/**
 * The play aids a ruleset supports. Each aid was built on the Epoxy engine,
 * so a Lynx level only gets the ones that do not depend on it.
 */
export interface RulesetFeatures {
  /** Click or tap on the board plans a path to the tile. */
  tapToPath: boolean;
  /** The objective marker and the help that points to the next goal. */
  objectiveMarker: boolean;
  /** The hint that plays the next push of a block puzzle. */
  blockHint: boolean;
  /** The watch that warns when block puzzles reach a dead end. */
  deadEndWatch: boolean;
  /** The stored solution and its replay. */
  solutionReplay: boolean;
  /** Putting a held key or pair of boots down. */
  itemDrop: boolean;
  /** Replaying the run behind a high score. */
  highScoreReplay: boolean;
}

const EPOXY_FEATURES: RulesetFeatures = {
  tapToPath: true,
  objectiveMarker: true,
  blockHint: true,
  deadEndWatch: true,
  solutionReplay: true,
  itemDrop: true,
  highScoreReplay: true
};

const LYNX_FEATURES: RulesetFeatures = {
  tapToPath: false,
  objectiveMarker: false,
  blockHint: false,
  deadEndWatch: false,
  solutionReplay: false,
  itemDrop: false,
  highScoreReplay: true
};

/** CC3D levels are played by their own engine: no Epoxy play aid applies, only the high score replay. */
const CC3D_FEATURES: RulesetFeatures = {
  tapToPath: false,
  objectiveMarker: false,
  blockHint: false,
  deadEndWatch: false,
  solutionReplay: false,
  itemDrop: false,
  highScoreReplay: true
};

/** The aids that stay off on a level with lasers: both search for pushes that cover buttons or targets. */
const LASER_LEVEL_FEATURES: RulesetFeatures = { ...EPOXY_FEATURES, blockHint: false, deadEndWatch: false };

/** The aids a laser level won by lighting receivers also loses: its goal is not a place to walk to. */
const RECEIVER_LEVEL_FEATURES: RulesetFeatures = { ...LASER_LEVEL_FEATURES, objectiveMarker: false };

/**
 * The aids that stay off on a level with colour channels (plates, hold doors, colour walls and blocks):
 * the hint and the watch model pushes onto buttons and targets, not plates, and a tapped path does not
 * press a plate to hold a door open.
 */
const COLOR_LEVEL_FEATURES: RulesetFeatures = {
  ...EPOXY_FEATURES,
  tapToPath: false,
  blockHint: false,
  deadEndWatch: false
};

/** Laser aids win for what a laser level already loses; the colour aids are turned off too. */
const LASER_COLOR_LEVEL_FEATURES: RulesetFeatures = { ...LASER_LEVEL_FEATURES, tapToPath: COLOR_LEVEL_FEATURES.tapToPath };

/** A receivers level with colour content: the receivers aids and the colour aids are both off. */
const RECEIVER_COLOR_LEVEL_FEATURES: RulesetFeatures = {
  ...RECEIVER_LEVEL_FEATURES,
  tapToPath: COLOR_LEVEL_FEATURES.tapToPath
};

/**
 * True when the tile id is a laser emitter, receiver or gate, a shot launcher or a shot trigger, as the tile
 * config defines them. Shots count as laser content: they are stopped and turned by the same mirrors and
 * walls, and the aids that skip laser levels skip them too.
 */
export function isLaserTileId(id: string | null | undefined): boolean {
  if (!id) return false;
  const tile = ConfigRegistry.getTile(id);
  return (
    tile.laserEmitter !== undefined ||
    tile.laserReceiverGroup !== undefined ||
    tile.laserGateGroup !== undefined ||
    tile.shotLauncher !== undefined ||
    tile.buttonAction === FIRE_LAUNCHERS_ACTION
  );
}

/** True when the entity type is a laser mirror, as the monster config defines it. */
export function isMirrorEntityType(type: string): boolean {
  return ConfigRegistry.getEntityDef(type)?.mirrorAxis !== undefined;
}

/** True when the entity type is a turret, a block that fires a short beam, as the monster config defines it. */
export function isTurretEntityType(type: string): boolean {
  return ConfigRegistry.getEntityDef(type)?.turretBeam !== undefined;
}

/** True when the level places a turret, or links a clone machine to a turret template. */
export function hasTurretContent(level: Pick<CompiledLevel, 'entities'> & Partial<Pick<CompiledLevel, 'cloneLinks'>>): boolean {
  return (
    (level.entities ?? []).some((e) => isTurretEntityType(e.type)) ||
    (level.cloneLinks ?? []).some((link) => isTurretEntityType(link.templateType))
  );
}

/** True when the level places a laser tile (terrain or item layer), a mirror or a turret, as the configs define them. */
export function hasLaserContent(
  level: Pick<CompiledLevel, 'terrain' | 'items' | 'entities'> & Partial<Pick<CompiledLevel, 'cloneLinks'>>
): boolean {
  const hasTile = (grid: Array<Array<string | null>> | undefined): boolean =>
    grid?.some((row) => row.some(isLaserTileId)) ?? false;
  if (hasTile(level.terrain) || hasTile(level.items)) return true;
  return (level.entities ?? []).some((e) => isMirrorEntityType(e.type)) || hasTurretContent(level);
}

/** True when the entity type is a steered monster (a puppet), which moves only when a steering pad is worked. */
export function isSteeredEntityType(type: string): boolean {
  return ConfigRegistry.getEntityDef(type)?.steeredBy !== undefined;
}

/** True when the entity type is a monster that steps away from the player (a skitter). */
export function isFleeingEntityType(type: string): boolean {
  return ConfigRegistry.getEntityDef(type)?.movementPattern === FLEE_PLAYER_PATTERN;
}

/** True when the tile id is a steering pad, the button that makes the puppets step. */
export function isSteeringTileId(id: string | null | undefined): boolean {
  return !!id && ConfigRegistry.getTile(id).buttonAction === STEER_MONSTERS_ACTION;
}

/**
 * True when the level places a steering pad or a puppet, or links a clone machine to a puppet template.
 * A control hidden under a removable top (underlays) is not counted here, which is harmless: DAT refuses
 * underlays anyway, and the aids turn off when a puppet is present.
 */
export function hasSteeringContent(
  level: Pick<CompiledLevel, 'terrain' | 'items' | 'entities'> & Partial<Pick<CompiledLevel, 'cloneLinks'>>
): boolean {
  const hasTile = (grid: Array<Array<string | null>> | undefined): boolean =>
    grid?.some((row) => row.some(isSteeringTileId)) ?? false;
  if (hasTile(level.terrain) || hasTile(level.items)) return true;
  return (
    (level.entities ?? []).some((e) => isSteeredEntityType(e.type)) ||
    (level.cloneLinks ?? []).some((link) => isSteeredEntityType(link.templateType))
  );
}

/** True when the level places a monster only the Epoxy engine plays (a puppet or a skitter), or a steering pad. */
export function hasEpoxyOnlyMonsterContent(
  level: Pick<CompiledLevel, 'terrain' | 'items' | 'entities'> & Partial<Pick<CompiledLevel, 'cloneLinks'>>
): boolean {
  if (hasSteeringContent(level)) return true;
  const fleeing = (type: string): boolean => isFleeingEntityType(type);
  return (
    (level.entities ?? []).some((e) => fleeing(e.type)) || (level.cloneLinks ?? []).some((link) => fleeing(link.templateType))
  );
}

/** True when the tile id is a colour channel tile: a plate, a hold door, a colour wall or button, or a floating block. */
export function isColorChannelTileId(id: string | null | undefined): boolean {
  if (!id) return false;
  const tile = ConfigRegistry.getTile(id);
  return (
    tile.plateColor !== undefined ||
    tile.holdDoorColor !== undefined ||
    tile.toggleChannel !== undefined ||
    tile.floatingBlockColor !== undefined ||
    channelOfButtonAction(tile.buttonAction) !== undefined
  );
}

/** True when the entity type is a colour block, as the monster config defines it. */
export function isColorBlockEntityType(type: string): boolean {
  return ConfigRegistry.getEntityDef(type)?.plateColor !== undefined;
}

/** True when the tile slows the monsters down while held, which no Lynx or CC3D rule has. */
export function isSlowTimeTileId(id: string | null | undefined): boolean {
  return !!id && ConfigRegistry.getTile(id).slowsMonsters !== undefined;
}

/** True when the tile only exists under the Epoxy rules: a laser tile, a colour channel tile or the slow-time item. */
export function isEpoxyOnlyTileId(id: string | null | undefined): boolean {
  return isLaserTileId(id) || isColorChannelTileId(id) || isSlowTimeTileId(id) || isSteeringTileId(id);
}

/** True when the entity only exists under the Epoxy rules: a laser mirror, a turret, a colour block, a puppet or a skitter. */
export function isEpoxyOnlyEntityType(type: string): boolean {
  return (
    isMirrorEntityType(type) ||
    isTurretEntityType(type) ||
    isColorBlockEntityType(type) ||
    isSteeredEntityType(type) ||
    isFleeingEntityType(type)
  );
}

/** True when the level places a colour channel tile (terrain or item layer) or a colour block. */
export function hasColorChannelContent(level: Pick<CompiledLevel, 'terrain' | 'items' | 'entities'>): boolean {
  const hasTile = (grid: Array<Array<string | null>> | undefined): boolean =>
    grid?.some((row) => row.some(isColorChannelTileId)) ?? false;
  if (hasTile(level.terrain) || hasTile(level.items)) return true;
  return (level.entities ?? []).some((e) => isColorBlockEntityType(e.type));
}

/** True when the level uses a mechanic that only the Epoxy engine plays: lasers, colour channels, slow time or steered monsters. */
export function hasEpoxyOnlyContent(
  level: Pick<CompiledLevel, 'terrain' | 'items' | 'entities'> & Partial<Pick<CompiledLevel, 'cloneLinks'>>
): boolean {
  const hasSlowTime = (grid: Array<Array<string | null>> | undefined): boolean =>
    grid?.some((row) => row.some(isSlowTimeTileId)) ?? false;
  return (
    hasLaserContent(level) ||
    hasColorChannelContent(level) ||
    hasSlowTime(level.terrain) ||
    hasSlowTime(level.items) ||
    hasEpoxyOnlyMonsterContent(level)
  );
}

/**
 * The aids of a level with turrets and nothing else that already turns tapToPath off: the turrets fire
 * on a clock a tapped path does not wait for, and the hint and the watch do not model them.
 */
const TURRET_LEVEL_FEATURES: RulesetFeatures = { ...LASER_LEVEL_FEATURES, tapToPath: false };
/** A receivers level with turrets: the receivers aids and no tapped path. */
const TURRET_RECEIVER_LEVEL_FEATURES: RulesetFeatures = { ...RECEIVER_LEVEL_FEATURES, tapToPath: false };

/** The parts of a level that decide its aids; a level without a grid only gets the ruleset's aids. */
type FeatureLevel = Pick<CompiledLevel, 'ruleset'> &
  Partial<Pick<CompiledLevel, 'terrain' | 'items' | 'entities' | 'winRule' | 'cloneLinks'>>;

/** Laser and colour content never change on a compiled level, so the answers are kept per level object. */
const laserContentCache = new WeakMap<object, boolean>();
const colorContentCache = new WeakMap<object, boolean>();
const turretContentCache = new WeakMap<object, boolean>();
const steeringContentCache = new WeakMap<object, boolean>();
/** The aids of a steering level, kept per aid set so a level of one kind always gets the same object. */
const steeringFeaturesCache = new WeakMap<RulesetFeatures, RulesetFeatures>();

/**
 * The aids a level with puppets loses on top of what its other mechanics already turn off: a tapped path
 * and the push hint and watch do not know the pads' steps. An overlay on the result of the other rules,
 * so a pad never has to be combined by hand with each laser and colour case.
 */
function withoutSteeringAids(base: RulesetFeatures): RulesetFeatures {
  let overlaid = steeringFeaturesCache.get(base);
  if (!overlaid) {
    overlaid = { ...base, tapToPath: false, blockHint: false, deadEndWatch: false };
    steeringFeaturesCache.set(base, overlaid);
  }
  return overlaid;
}

/** The aids available on a level, by the ruleset it is played under and the mechanics it uses. */
export function featuresFor(level: FeatureLevel | undefined): RulesetFeatures {
  const base = baseFeaturesFor(level);
  // Lynx and CC3D levels already have these aids off; a level without a grid has no content to read.
  if (!level?.terrain || level.ruleset === 'lynx' || level.ruleset === 'cc3d') return base;
  let steering = steeringContentCache.get(level);
  if (steering === undefined) {
    steering = hasSteeringContent({
      terrain: level.terrain,
      items: level.items ?? [],
      entities: level.entities ?? [],
      cloneLinks: level.cloneLinks ?? []
    });
    steeringContentCache.set(level, steering);
  }
  return steering ? withoutSteeringAids(base) : base;
}

function baseFeaturesFor(level: FeatureLevel | undefined): RulesetFeatures {
  if (!level) return EPOXY_FEATURES;
  switch (level.ruleset) {
    case 'lynx':
      return LYNX_FEATURES;
    case 'cc3d':
      return CC3D_FEATURES;
    case 'epoxy':
    case undefined:
      break;
    default: {
      const unreachable: never = level.ruleset;
      throw new Error(`Unknown ruleset: ${String(unreachable)}`);
    }
  }
  const receivers = level.winRule === 'receivers';
  if (!level.terrain) return receivers ? RECEIVER_LEVEL_FEATURES : EPOXY_FEATURES;
  let laser = laserContentCache.get(level);
  if (laser === undefined) {
    laser = hasLaserContent({
      terrain: level.terrain,
      items: level.items ?? [],
      entities: level.entities ?? [],
      cloneLinks: level.cloneLinks ?? []
    });
    laserContentCache.set(level, laser);
  }
  let color = colorContentCache.get(level);
  if (color === undefined) {
    color = hasColorChannelContent({ terrain: level.terrain, items: level.items ?? [], entities: level.entities ?? [] });
    colorContentCache.set(level, color);
  }
  let turret = turretContentCache.get(level);
  if (turret === undefined) {
    turret = hasTurretContent({ entities: level.entities ?? [], cloneLinks: level.cloneLinks ?? [] });
    turretContentCache.set(level, turret);
  }
  if (receivers) {
    if (color) return RECEIVER_COLOR_LEVEL_FEATURES;
    return turret ? TURRET_RECEIVER_LEVEL_FEATURES : RECEIVER_LEVEL_FEATURES;
  }
  if (!color) {
    if (turret) return TURRET_LEVEL_FEATURES;
    return laser ? LASER_LEVEL_FEATURES : EPOXY_FEATURES;
  }
  return laser ? LASER_COLOR_LEVEL_FEATURES : COLOR_LEVEL_FEATURES;
}
