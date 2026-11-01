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

/** The aids available on a level, by the ruleset it is played under. */
export function featuresFor(level: Pick<CompiledLevel, 'ruleset'> | undefined): RulesetFeatures {
  return level?.ruleset === 'lynx' ? LYNX_FEATURES : EPOXY_FEATURES;
}
