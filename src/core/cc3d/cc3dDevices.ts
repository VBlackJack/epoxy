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

import type { Direction } from '../types';
import { SFX } from './cc3dConstants';
import { fireNearestShooter } from './cc3dLasers';
import { MONSTER_TRAITS } from './cc3dMonsterTraits';
import { planStep } from './cc3dMovement';
import {
  Actor,
  Cell,
  MobState,
  RuleContext,
  World,
  actingTerrain,
  isBlockKind,
  isOccupied,
  mobAt,
  opposite,
  spawnCopy,
  touch
} from './cc3dWorld';
import type { Cc3dColor, Cc3dTerrain, Cc3dTerrainKind } from './model';

/**
 * Devices of 02 section 2.5: hold plates and doors, toggle controls and doors,
 * traps, clone machines, the blue golem control. Pressure devices (plates, trap
 * controls) are recomputed at the end of every tick from who stands on them;
 * entry devices (toggle controls, clone switches, golem controls) act once per
 * arrival. Marks follow the rules spec.
 */

function pointOf(world: World, index: number): Cell {
  return { x: index % world.width, y: Math.floor(index / world.width) };
}

function layerAt(world: World, index: number, kind: Cc3dTerrainKind): Cc3dTerrain {
  const layer = world.cells[index].terrain.find((t) => t.kind === kind);
  if (!layer) throw new Error(`CC3D: no ${kind} in the stack of cell ${index}`);
  return layer;
}

// ---------------------------------------------------------------- pressing

/** Reflectors and security bots are pushed around but press and trigger nothing [U]. */
const INERT_BLOCKS: readonly string[] = ['reflector', 'bot_static', 'bot_cw', 'bot_ccw', 'bot_multi'];

/** Who presses a plate of a colour: the player, dirt and ice blocks [P dirt, U ice], a colour block only its own colour [P other colours, U own]. */
function pressesPlate(actor: Actor, color: Cc3dColor | undefined): boolean {
  if (actor.kind === 'player') return true;
  if (actor.kind === 'block_color') return color === undefined || actor.color === color;
  if (isBlockKind(actor.kind)) return !INERT_BLOCKS.includes(actor.kind);
  return MONSTER_TRAITS[actor.kind]?.pressesPlates ?? false;
}

/** Who works an entry device (toggle control, clone switch, golem control). */
function triggersSwitch(actor: Actor): boolean {
  if (actor.kind === 'player') return true;
  if (isBlockKind(actor.kind)) return !INERT_BLOCKS.includes(actor.kind);
  return MONSTER_TRAITS[actor.kind]?.triggersSwitches ?? false;
}

/** True when something at rest on the cell presses a device of that colour. */
function isPressed(world: World, index: number, color: Cc3dColor | undefined): boolean {
  const { player } = world;
  const at = pointOf(world, index);
  if (player.alive && player.remaining === 0 && player.x === at.x && player.y === at.y) return true;
  const mob = world.occupancy.get(index);
  return mob !== undefined && !mob.floating && mob.remaining === 0 && pressesPlate(mob, color);
}

// -------------------------------------------------------------- hold doors

/**
 * [P] A hold door of a colour is open only while every plate of its colour is
 * pressed. A colour without plates keeps its doors closed [U]. A door with
 * something in its cell does not close until the cell is free [U].
 */
function updateHoldDoors(world: World): void {
  const { plates, holdDoors } = world.devices;
  if (holdDoors.length === 0) return;
  const total: Record<Cc3dColor, number> = { red: 0, green: 0, blue: 0, yellow: 0 };
  const pressed: Record<Cc3dColor, number> = { red: 0, green: 0, blue: 0, yellow: 0 };
  for (const index of plates) {
    const color = layerAt(world, index, 'plate').color;
    if (!color) continue;
    total[color] += 1;
    if (isPressed(world, index, color)) pressed[color] += 1;
  }
  for (const index of holdDoors) {
    const layer = layerAt(world, index, 'hold_door');
    const color = layer.color;
    const wanted = color !== undefined && total[color] > 0 && pressed[color] === total[color];
    const open = wanted || (layer.open === true && isOccupied(world, pointOf(world, index)));
    if (layer.open !== open) {
      touch(world, pointOf(world, index));
      layer.open = open;
    }
  }
}

// ------------------------------------------------------------------- traps

/**
 * A trap holds what enters until its control is pressed. Traps and trap
 * controls are paired by reading order (02) [U]; a trap without a control is open [U].
 */
function updateTraps(world: World): void {
  const { traps, trapControls } = world.devices;
  traps.forEach((index, i) => {
    const layer = layerAt(world, index, 'trap');
    const open = i >= trapControls.length || isPressed(world, trapControls[i], undefined);
    if (layer.open !== open) {
      touch(world, pointOf(world, index));
      layer.open = open;
    }
  });
}

// ----------------------------------------------------------------- toggles

/** Toggle doors that were told to close while something stood in them close once the cell is free [U]. */
function closePendingDoors(world: World): void {
  if (world.closing.length === 0) return;
  world.closing = world.closing.filter((index) => {
    const at = pointOf(world, index);
    if (isOccupied(world, at)) return true;
    touch(world, at);
    layerAt(world, index, 'toggle_door').open = false;
    return false;
  });
}

/** [P] Each entry onto a control flips every toggle door of its colour; leaving changes nothing. */
function flipToggles(world: World, color: Cc3dColor | undefined): void {
  for (const index of world.devices.toggleDoors) {
    const layer = layerAt(world, index, 'toggle_door');
    if (layer.color !== color) continue;
    const at = pointOf(world, index);
    touch(world, at);
    const pending = world.closing.indexOf(index);
    const effectivelyOpen = layer.open === true && pending < 0;
    if (!effectivelyOpen) {
      layer.open = true;
      if (pending >= 0) world.closing.splice(pending, 1);
    } else if (isOccupied(world, at)) {
      world.closing.push(index);
    } else {
      layer.open = false;
    }
  }
}

// ------------------------------------------------------------------ cloning

/** The machine nearest to the switch; the tie goes to the first in reading order [U]. */
function nearestMachine(world: World, from: Cell): number | null {
  let best: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const index of world.devices.machines) {
    const at = pointOf(world, index);
    const distance = (at.x - from.x) ** 2 + (at.y - from.y) ** 2;
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * The template mob stands on the machine, held there. A switch makes it leave in
 * the machine's direction and leaves a copy on the machine. When the way out is
 * blocked nothing happens [U].
 */
function activateMachine(ctx: RuleContext, machineIndex: number): void {
  const { world } = ctx;
  const at = pointOf(world, machineIndex);
  const template = mobAt(world, at);
  if (!template || template.remaining > 0) return;
  const dir = layerAt(world, machineIndex, 'clone_machine').dir ?? template.dir;
  const plan = planStep(world, template, at, dir, true);
  if (!plan.ok || plan.pushes.length > 0 || plan.hitsPlayer) return;
  ctx.releaseMob(template, dir);
  spawnCopy(world, { ...template, x: at.x, y: at.y }, dir);
}

// -------------------------------------------------------------------- golems

/** The blue golem control makes every blue golem turn around [U]. */
function reverseGolems(world: World): void {
  for (const mob of world.mobs) if (mob.kind === 'golem_blue') mob.dir = opposite(mob.dir);
}

/**
 * Each entry of the player onto a yellow control makes every yellow golem try
 * one step in the direction he was moving, front-first along that direction
 * (then list order) so a line of golems moves together; a golem already moving
 * ignores it [U, 07 sections 7.4, 7.9 items 1 and 9].
 */
function moveYellowGolems(ctx: RuleContext, dir: Direction): void {
  const along = (g: MobState): number => (dir === 'E' ? -g.x : dir === 'W' ? g.x : dir === 'S' ? -g.y : g.y);
  const golems = ctx.world.mobs.filter((m) => m.kind === 'golem_yellow').sort((a, b) => along(a) - along(b));
  for (const golem of golems) {
    if (golem.remaining === 0 && !golem.floating) ctx.stepMob(golem, dir);
  }
}

// -------------------------------------------------------------------- entry

/** Entry devices: called when an actor's step ends on a cell. */
export function triggerEntryDevice(ctx: RuleContext, actor: Actor): void {
  if (!triggersSwitch(actor)) return;
  const { world } = ctx;
  const at: Cell = { x: actor.x, y: actor.y };
  const terrain = actingTerrain(world.cells[at.y * world.width + at.x]);
  switch (terrain.kind) {
    case 'toggle_control':
      flipToggles(world, terrain.color);
      ctx.playSfx(SFX.button);
      break;
    case 'clone_switch': {
      const machine = nearestMachine(world, at);
      if (machine) activateMachine(ctx, machine);
      ctx.playSfx(SFX.button);
      break;
    }
    case 'golem_control_yellow':
      // Only the player works it; a golem entering a control does not chain [U, 07 section 7.9 item 9].
      if (actor.kind === 'player') moveYellowGolems(ctx, actor.dir);
      break;
    case 'laser_controller':
      // Only the player works it, by entering it (bumping a shooter standing on one counts too, see the
      // simulation) [U, 08 section 8.5 item 3]: the nearest shooter fires.
      if (actor.kind === 'player') fireNearestShooter(ctx, at);
      break;
    case 'golem_control_blue':
      reverseGolems(world);
      ctx.playSfx(SFX.button);
      break;
    default:
      break;
  }
}

/** Recomputes the pressure devices; called at the end of every tick and at the start. */
export function updateDevices(world: World): void {
  updateHoldDoors(world);
  updateTraps(world);
  closePendingDoors(world);
}
