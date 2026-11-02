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

/** The aids that stay off on a level with lasers: both search for pushes that cover buttons or targets. */
const LASER_LEVEL_FEATURES: RulesetFeatures = { ...EPOXY_FEATURES, blockHint: false, deadEndWatch: false };

/** The aids a laser level won by lighting receivers also loses: its goal is not a place to walk to. */
const RECEIVER_LEVEL_FEATURES: RulesetFeatures = { ...LASER_LEVEL_FEATURES, objectiveMarker: false };

/** True when the level places a laser tile (terrain or item layer) or a mirror, as the configs define them. */
export function hasLaserContent(level: Pick<CompiledLevel, 'terrain' | 'items' | 'entities'>): boolean {
  const isLaserTile = (id: string | null): boolean => {
    if (!id) return false;
    const tile = ConfigRegistry.getTile(id);
    return tile.laserEmitter !== undefined || tile.laserReceiverGroup !== undefined || tile.laserGateGroup !== undefined;
  };
  const hasTile = (grid: Array<Array<string | null>> | undefined): boolean => grid?.some((row) => row.some(isLaserTile)) ?? false;
  if (hasTile(level.terrain) || hasTile(level.items)) return true;
  return (level.entities ?? []).some((e) => ConfigRegistry.getEntityDef(e.type)?.mirrorAxis !== undefined);
}

/** The parts of a level that decide its aids; a level without a grid only gets the ruleset's aids. */
type FeatureLevel = Pick<CompiledLevel, 'ruleset'> &
  Partial<Pick<CompiledLevel, 'terrain' | 'items' | 'entities' | 'winRule'>>;

/** Laser content never changes on a compiled level, so the answer is kept per level object. */
const laserContentCache = new WeakMap<object, boolean>();

/** The aids available on a level, by the ruleset it is played under and the mechanics it uses. */
export function featuresFor(level: FeatureLevel | undefined): RulesetFeatures {
  if (!level) return EPOXY_FEATURES;
  if (level.ruleset === 'lynx') return LYNX_FEATURES;
  if (level.winRule === 'receivers') return RECEIVER_LEVEL_FEATURES;
  if (!level.terrain) return EPOXY_FEATURES;
  let laser = laserContentCache.get(level);
  if (laser === undefined) {
    laser = hasLaserContent({ terrain: level.terrain, items: level.items ?? [], entities: level.entities ?? [] });
    laserContentCache.set(level, laser);
  }
  return laser ? LASER_LEVEL_FEATURES : EPOXY_FEATURES;
}
