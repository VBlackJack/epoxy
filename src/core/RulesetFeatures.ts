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
import { channelOfButtonAction } from './coreConstants';
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

/** True when the tile id is a laser emitter, receiver or gate, as the tile config defines them. */
export function isLaserTileId(id: string | null | undefined): boolean {
  if (!id) return false;
  const tile = ConfigRegistry.getTile(id);
  return tile.laserEmitter !== undefined || tile.laserReceiverGroup !== undefined || tile.laserGateGroup !== undefined;
}

/** True when the entity type is a laser mirror, as the monster config defines it. */
export function isMirrorEntityType(type: string): boolean {
  return ConfigRegistry.getEntityDef(type)?.mirrorAxis !== undefined;
}

/** True when the level places a laser tile (terrain or item layer) or a mirror, as the configs define them. */
export function hasLaserContent(level: Pick<CompiledLevel, 'terrain' | 'items' | 'entities'>): boolean {
  const hasTile = (grid: Array<Array<string | null>> | undefined): boolean =>
    grid?.some((row) => row.some(isLaserTileId)) ?? false;
  if (hasTile(level.terrain) || hasTile(level.items)) return true;
  return (level.entities ?? []).some((e) => isMirrorEntityType(e.type));
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

/** True when the tile only exists under the Epoxy rules: a laser tile or a colour channel tile. */
export function isEpoxyOnlyTileId(id: string | null | undefined): boolean {
  return isLaserTileId(id) || isColorChannelTileId(id);
}

/** True when the entity only exists under the Epoxy rules: a laser mirror or a colour block. */
export function isEpoxyOnlyEntityType(type: string): boolean {
  return isMirrorEntityType(type) || isColorBlockEntityType(type);
}

/** True when the level places a colour channel tile (terrain or item layer) or a colour block. */
export function hasColorChannelContent(level: Pick<CompiledLevel, 'terrain' | 'items' | 'entities'>): boolean {
  const hasTile = (grid: Array<Array<string | null>> | undefined): boolean =>
    grid?.some((row) => row.some(isColorChannelTileId)) ?? false;
  if (hasTile(level.terrain) || hasTile(level.items)) return true;
  return (level.entities ?? []).some((e) => isColorBlockEntityType(e.type));
}

/** True when the level uses a mechanic that only the Epoxy engine plays: lasers or colour channels. */
export function hasEpoxyOnlyContent(level: Pick<CompiledLevel, 'terrain' | 'items' | 'entities'>): boolean {
  return hasLaserContent(level) || hasColorChannelContent(level);
}

/** The parts of a level that decide its aids; a level without a grid only gets the ruleset's aids. */
type FeatureLevel = Pick<CompiledLevel, 'ruleset'> &
  Partial<Pick<CompiledLevel, 'terrain' | 'items' | 'entities' | 'winRule'>>;

/** Laser and colour content never change on a compiled level, so the answers are kept per level object. */
const laserContentCache = new WeakMap<object, boolean>();
const colorContentCache = new WeakMap<object, boolean>();

/** The aids available on a level, by the ruleset it is played under and the mechanics it uses. */
export function featuresFor(level: FeatureLevel | undefined): RulesetFeatures {
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
  if (level.winRule === 'receivers') return RECEIVER_LEVEL_FEATURES;
  if (!level.terrain) return EPOXY_FEATURES;
  let laser = laserContentCache.get(level);
  if (laser === undefined) {
    laser = hasLaserContent({ terrain: level.terrain, items: level.items ?? [], entities: level.entities ?? [] });
    laserContentCache.set(level, laser);
  }
  let color = colorContentCache.get(level);
  if (color === undefined) {
    color = hasColorChannelContent({ terrain: level.terrain, items: level.items ?? [], entities: level.entities ?? [] });
    colorContentCache.set(level, color);
  }
  if (!color) return laser ? LASER_LEVEL_FEATURES : EPOXY_FEATURES;
  // Laser features win for the aids a laser level already loses; the colour aids are turned off too.
  return laser ? { ...LASER_LEVEL_FEATURES, tapToPath: COLOR_LEVEL_FEATURES.tapToPath } : COLOR_LEVEL_FEATURES;
}
