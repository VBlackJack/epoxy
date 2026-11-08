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

import { neighbour } from '../../lynx/directions';
import { Creature } from '../../lynx/model';
import { RuleContext, RuleModule, StepAttempt } from '../../lynx/ruleApi';

/*
 * Ice blocks. An ice block is an entity of the level that the Lynx core does
 * not know, so this module gives each one a block of its own at load (a block
 * creature of type `ice_block`): it is pushed, it slides and it is crushed
 * exactly like a dirt block. What differs from a dirt block:
 *
 *  - pushed into water, it turns the water into ice (a dirt block turns it into
 *    dirt). The core sinks the block and leaves dirt behind, so the module
 *    notes the water cell when the step starts and swaps the dirt for ice once
 *    the block has gone down;
 *  - on fire, it melts: the block is used up and the fire becomes water.
 */

export const ICE_BLOCK = 'ice_block';
const MODULE_NAME = 'cc2IceBlocks';
const WATER = 'water';
const FIRE = 'fire';
const DIRT = 'dirt';
const ICE = 'ice';
const MELTED_FIRE_TILE = WATER;
const CELL_KEY_SEPARATOR = ',';

/** Plain data kept in `world.moduleData`: the water cells an ice block was pushed into. */
interface IceBlockData {
  flooding: string[];
}

const cellKey = (x: number, y: number): string => `${x}${CELL_KEY_SEPARATOR}${y}`;

function dataOf(ctx: RuleContext): IceBlockData {
  return ctx.world.moduleData[MODULE_NAME] as IceBlockData;
}

const isIceBlock = (creature: Creature): boolean => creature.kind === 'block' && creature.type === ICE_BLOCK;

function noteWater(ctx: RuleContext, attempt: StepAttempt): void {
  if (attempt.outcome !== 'started' || !isIceBlock(attempt.creature)) return;
  const to = neighbour(attempt.from, attempt.dir);
  if (ctx.inMap(to) && ctx.world.terrain[to.y][to.x] === WATER) dataOf(ctx).flooding.push(cellKey(to.x, to.y));
}

/** Water an ice block went down in is ice, not the dirt the core leaves behind. */
function freezeFlooded(ctx: RuleContext): void {
  const data = dataOf(ctx);
  data.flooding = data.flooding.filter((key) => {
    const [x, y] = key.split(CELL_KEY_SEPARATOR).map(Number);
    if (ctx.world.terrain[y][x] !== DIRT) return true;
    ctx.setTerrain(x, y, ICE);
    return false;
  });
}

function meltOnFire(ctx: RuleContext): void {
  for (const creature of ctx.creatures()) {
    if (!isIceBlock(creature) || !ctx.isAtRest(creature)) continue;
    if (ctx.world.terrain[creature.y][creature.x] !== FIRE) continue;
    ctx.setTerrain(creature.x, creature.y, MELTED_FIRE_TILE);
    ctx.kill(creature, 'burn');
  }
}

export const iceBlockRules: RuleModule = {
  name: MODULE_NAME,
  onLoad: (ctx) => {
    ctx.world.moduleData[MODULE_NAME] = { flooding: [] } satisfies IceBlockData;
    for (const entity of ctx.level.entities) {
      if (entity.type === ICE_BLOCK && ctx.inMap(entity)) ctx.spawn(ICE_BLOCK, 'block', entity, entity.dir);
    }
  },
  onStepAttempt: noteWater,
  onMovementEnd: (ctx) => {
    freezeFlooded(ctx);
    meltOnFire(ctx);
  }
};
