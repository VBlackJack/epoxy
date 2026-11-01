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

import { ADMISSION } from '../tileRules';
import { RuleModule, TileRule } from '../ruleApi';

/** Tile ids of the walls that change (spec 9.2). */
const WALL_TILE = 'wall';
const FLOOR_TILE = 'floor';
const APPEARING_WALL = 'appearing_wall';
const BLUE_WALL_REAL = 'blue_wall_real';
const BLUE_WALL_FAKE = 'blue_wall_fake';
const RECESSED_WALL = 'recessed_wall';
const TOGGLE_WALL_OPEN = 'toggle_wall_open';
const TOGGLE_WALL_CLOSED = 'toggle_wall_closed';

/**
 * A wall that is solid for everyone and turns into a plain wall when Chip tries
 * to step into it. Only a real attempt (phase C, a release) reveals it; a
 * decision or a teleport test must change nothing.
 */
function revealedWall(): TileRule {
  return {
    admits: ADMISSION.chipOnly,
    yieldsToPush: true,
    mayEnter: (probe) => {
      if (probe.mode === 'attempt') probe.ctx.setTerrain(probe.to.x, probe.to.y, WALL_TILE);
      return false;
    }
  };
}

/**
 * Hidden, appearing, blue, popup and toggle walls. The state of a toggle wall
 * is its tile id: the buttons module flips it with setTerrain, and the rule of
 * the current id applies at once.
 */
export const specialWallRules: RuleModule = {
  name: 'specialWalls',
  tiles: {
    [APPEARING_WALL]: revealedWall(),
    [BLUE_WALL_REAL]: revealedWall(),
    [BLUE_WALL_FAKE]: {
      admits: ADMISSION.chipOnly,
      arrival: { chip: (ctx, chip) => ctx.setTerrain(chip.x, chip.y, FLOOR_TILE) }
    },
    [RECESSED_WALL]: {
      admits: ADMISSION.chipOnly,
      arrival: { chip: (ctx, chip) => ctx.setTerrain(chip.x, chip.y, WALL_TILE) }
    },
    [TOGGLE_WALL_OPEN]: { admits: ADMISSION.everyone },
    [TOGGLE_WALL_CLOSED]: { admits: ADMISSION.nobody }
  }
};
