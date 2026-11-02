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

import { triggerEntryDevice } from './cc3dDevices';
import { onShotArrival } from './cc3dLasers';
import { MAX_TOOLS, SFX, STEP_TICKS, VISUAL_COLOR } from './cc3dConstants';
import { MONSTER_TRAITS } from './cc3dMonsterTraits';
import { playerSurvivesSlime, cornerExit, isCarriedByForce, isImmune, slidesOnIce } from './cc3dTerrainRules';
import { teleportOnArrival } from './cc3dTeleports';
import {
  Actor,
  Cell,
  MobState,
  PlayerData,
  RuleContext,
  actingTerrain,
  cellOf,
  hasFloatingBlock,
  isBlockKind,
  removeMob,
  removeTop,
  speedOrbFactor,
  replaceTop,
  touch
} from './cc3dWorld';
import type { Cc3dItem } from './model';

/**
 * What happens when a mover finishes a step onto a cell (arrival) and when the
 * player starts a step onto a door, dirt, false wall or socket (entry).
 */

/**
 * Opens what the player walks into: key doors, dirt, false walls, sockets [U].
 * Returns whether it removed the top layer (the step must then be planned again,
 * because the layer below may refuse).
 */
export function openOnEntry(ctx: RuleContext, player: PlayerData, at: Cell): boolean {
  const terrain = actingTerrain(cellOf(ctx.world, at));
  switch (terrain.kind) {
    case 'door':
      if (terrain.color && terrain.color !== 'green') player.keys[terrain.color] -= 1;
      removeTop(ctx.world, at);
      ctx.emitVisual('unlock', at.x, at.y, terrain.color);
      ctx.playSfx(SFX.door);
      return true;
    case 'socket':
    case 'socket_red':
      removeTop(ctx.world, at);
      ctx.emitVisual('unlock', at.x, at.y, VISUAL_COLOR.socket);
      ctx.playSfx(SFX.socket);
      return true;
    case 'false_wall':
    case 'dirt':
      removeTop(ctx.world, at);
      return true;
    default:
      return false;
  }
}

/** Called when the actor's step ends on its cell. */
export function onArrival(ctx: RuleContext, actor: Actor): void {
  if (actor.kind === 'shot') {
    onShotArrival(actor);
    return;
  }
  const chosen = actor.chose;
  actor.drift = null;
  actor.carried = false;
  actor.chose = false;
  triggerEntryDevice(ctx, actor);
  if (actor.kind === 'player') {
    // A golem behind him may have stepped onto him: the dead take nothing.
    if (actor.alive) arrivePlayer(ctx, actor);
    return;
  }
  // Snappy and Nibble rest for a step's worth after a step they chose (not one forced or released from a clone machine); ice, force floors and teleports still act [U, 07 section 7.9 item 5].
  if (chosen && MONSTER_TRAITS[actor.kind]?.restsBetweenSteps) {
    actor.restUntilTick = ctx.world.tick + 1 + STEP_TICKS.normal * speedOrbFactor(ctx.world);
  }
  arriveMob(ctx, actor);
}

function arrivePlayer(ctx: RuleContext, player: PlayerData): void {
  const { world } = ctx;
  const at: Cell = { x: player.x, y: player.y };
  const terrain = actingTerrain(cellOf(world, at));
  switch (terrain.kind) {
    case 'water':
      if (!isImmune(player, 'water') && !hasFloatingBlock(world, at)) ctx.killPlayer('water');
      break;
    case 'fire':
      if (!isImmune(player, 'fire')) ctx.killPlayer('fire');
      break;
    case 'slime':
      if (!playerSurvivesSlime()) ctx.killPlayer('slime');
      break;
    case 'bomb':
      removeTop(world, at);
      ctx.killPlayer('bomb');
      break;
    case 'exit':
      world.complete = true;
      break;
    case 'gate_tools':
      player.tools = [];
      ctx.playSfx(SFX.thief);
      break;
    case 'gate_keys':
      player.keys = { red: 0, green: 0, blue: 0, yellow: 0 };
      ctx.playSfx(SFX.thief);
      break;
    case 'teleport_red':
    case 'teleport_blue':
      teleportOnArrival(ctx, player, terrain.kind);
      break;
    default:
      applyDrift(ctx, player);
  }
  if (player.alive) {
    pickUp(ctx, at);
    // A teleport moved the player: the item of the cell he now stands on is his too [U].
    if (player.x !== at.x || player.y !== at.y) pickUp(ctx, { x: player.x, y: player.y });
  }
}

/** Ice, ice corners and random force floors set the direction the floor keeps pushing in. */
function applyDrift(ctx: RuleContext, actor: Actor): void {
  const terrain = actingTerrain(cellOf(ctx.world, actor));
  if (terrain.kind === 'ice' && slidesOnIce(actor)) actor.drift = actor.dir;
  else if (terrain.kind === 'ice_corner' && slidesOnIce(actor)) actor.drift = cornerExit(terrain, actor.dir);
  else if (terrain.kind === 'force_random' && isCarriedByForce(actor)) actor.drift = ctx.randomDirection();
}

/** A block or a monster ends a step: blocks fill water, melt, clean slime [P]/[U]; a monster the floor carried into a hazard it is not immune to dies [U]. */
function arriveMob(ctx: RuleContext, mob: MobState): void {
  const { world } = ctx;
  const at: Cell = { x: mob.x, y: mob.y };
  const terrain = actingTerrain(cellOf(world, at));
  const block = isBlockKind(mob.kind);
  switch (terrain.kind) {
    case 'water':
      if (block) sinkInWater(ctx, mob, at);
      else if (!isImmune(mob, 'water') && !hasFloatingBlock(world, at)) monsterDies(ctx, mob, 'splash');
      break;
    case 'fire':
      if (block && mob.kind === 'block_ice') {
        removeMob(world, mob);
        replaceTop(world, at, { kind: 'water' });
        ctx.emitVisual('splash', at.x, at.y);
      } else if (!block && !isImmune(mob, 'fire')) {
        monsterDies(ctx, mob, 'explosion');
      }
      break;
    case 'slime':
      if (block) {
        removeMob(world, mob);
        replaceTop(world, at, { kind: 'floor' });
        ctx.emitVisual('splash', at.x, at.y);
      } else if (isImmune(mob, 'slime')) {
        mob.slimed = true;
      } else {
        monsterDies(ctx, mob, 'splash');
      }
      break;
    case 'bomb':
      if (!block) {
        removeTop(world, at);
        monsterDies(ctx, mob, 'explosion');
      }
      break;
    case 'teleport_red':
    case 'teleport_blue':
      teleportOnArrival(ctx, mob, terrain.kind);
      break;
    default:
      applyDrift(ctx, mob);
  }
}

function monsterDies(ctx: RuleContext, mob: MobState, form: 'splash' | 'explosion'): void {
  removeMob(ctx.world, mob);
  ctx.emitVisual(form, mob.x, mob.y);
}

/** Dirt block: water becomes dirt. Ice block: water becomes ice. Colour block: floats as a bridge [P]. */
function sinkInWater(ctx: RuleContext, mob: MobState, at: Cell): void {
  const { world } = ctx;
  if (mob.kind === 'block_color') {
    mob.floating = true;
    touch(world, at);
  } else if (mob.kind === 'block_dirt' || mob.kind === 'block_ice') {
    removeMob(world, mob);
    replaceTop(world, at, { kind: mob.kind === 'block_dirt' ? 'dirt' : 'ice' });
  }
  ctx.emitVisual('splash', at.x, at.y);
  ctx.playSfx(SFX.splash);
}

function addTool(player: PlayerData, cell: { item: Cc3dItem | null }, kind: Cc3dItem['kind']): void {
  player.tools.push(kind);
  if (player.tools.length > MAX_TOOLS) {
    // The oldest tool is dropped on the cell the player stands on [U].
    const dropped = player.tools.shift();
    if (dropped) cell.item = { kind: dropped };
  }
}

/** The player takes the item of the cell he arrived on. */
function pickUp(ctx: RuleContext, at: Cell): void {
  const { world } = ctx;
  const cell = cellOf(world, at);
  const item = cell.item;
  if (!item) return;
  const player = world.player;
  touch(world, at);
  cell.item = null;
  switch (item.kind) {
    case 'fish':
    case 'fish_extra':
      // An extra FISH lowers the count like any FISH; only FISH 42 were counted at the start [U].
      world.fishRemaining -= 1;
      ctx.emitVisual('chip', at.x, at.y, VISUAL_COLOR.fish);
      ctx.playSfx(SFX.chip);
      break;
    case 'key':
      if (item.color) player.keys[item.color] += 1;
      ctx.emitVisual('item', at.x, at.y, item.color);
      ctx.playSfx(SFX.item);
      break;
    default:
      addTool(player, cell, item.kind);
      ctx.emitVisual('item', at.x, at.y, VISUAL_COLOR.item);
      ctx.playSfx(SFX.item);
  }
}
