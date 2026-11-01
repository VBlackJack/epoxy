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

import { PlayerState, RuntimeEntity } from '../types';
import { FIRST_SPARE_PLACE, TILE } from './lynxConstants';
import { Creature, World, isCreature } from './model';

/** Ticks until the step in progress completes: remaining units over units per tick, rounded up. */
export function cooldownTicks(creature: Creature): number {
  return creature.remaining === 0 ? 0 : Math.ceil(creature.remaining / creature.unitsPerTick);
}

/** One entity per live monster or block, in list order from the second place. */
export function entitiesOf(world: World): RuntimeEntity[] {
  return world.slots
    .slice(FIRST_SPARE_PLACE)
    .filter(isCreature)
    .map((c) => ({
      uid: c.uid,
      type: c.type,
      kind: c.kind === 'block' ? 'block' : 'monster',
      x: c.x,
      y: c.y,
      dir: c.dir,
      cooldownTicks: cooldownTicks(c),
      isSliding: c.sliding
    }));
}

export function playerOf(world: World): PlayerState {
  const { chip, chipState } = world;
  const cooldown = cooldownTicks(chip);
  const sliding = chipState.alive && chip.sliding;
  const standingInWater =
    chipState.alive &&
    chip.remaining === 0 &&
    (world.items[chip.y]?.[chip.x] ?? world.terrain[chip.y]?.[chip.x]) === TILE.water;
  return {
    x: chip.x,
    y: chip.y,
    dir: chip.dir,
    alive: chipState.alive,
    deathReasonKey: chipState.deathReasonKey,
    isSliding: sliding,
    slideDir: sliding ? chip.dir : null,
    moveCooldown: cooldown,
    slideCooldown: sliding ? cooldown : 0,
    inWater: standingInWater,
    keys: { ...chipState.keys },
    boots: new Set(chipState.boots)
  };
}
