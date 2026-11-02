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

import { ORDERED_DIRECTIONS } from '../../config/constants';
import type { Direction } from '../types';
import {
  Actor,
  MobState,
  PlayerData,
  World,
  actingTerrain,
  isBlockKind,
  opposite,
  replaceTop
} from './cc3dWorld';
import type { Cell } from './cc3dWorld';
import { Hazard, MONSTER_TRAITS, TERRAIN_REFUSED_BY_MONSTERS } from './cc3dMonsterTraits';
import type { Cc3dCell, Cc3dItemKind, Cc3dTerrain } from './model';
import { cellOf } from './cc3dWorld';

/**
 * Small terrain rule functions of the CC3D engine. Each one answers a single
 * question so a rule that turns out wrong in play can change in one place.
 * Marks follow the rules spec: [P] verified in play, [U] hypothesis.
 */

const HAZARD_TOOL: Partial<Record<Hazard, Cc3dItemKind>> = {
  ice: 'orb_ice',
  force: 'orb_force',
  water: 'orb_water',
  fire: 'orb_fire'
};

/** Whether the actor is unaffected by a hazard: the player by his tools, a monster by its traits. */
export function isImmune(actor: Actor, hazard: Hazard): boolean {
  if (actor.kind === 'player') {
    const tool = HAZARD_TOOL[hazard];
    return tool !== undefined && actor.tools.includes(tool);
  }
  return MONSTER_TRAITS[actor.kind]?.immunities.includes(hazard) ?? false;
}

/**
 * Who slides on ice: the player without the ice orb, every block and reflector and bot [S, 10 item 24], and the
 * monsters not immune to it.
 */
export function slidesOnIce(actor: Actor): boolean {
  if (actor.kind === 'player') return !isImmune(actor, 'ice');
  if (isBlockKind(actor.kind)) return true;
  return MONSTER_TRAITS[actor.kind] !== undefined && !isImmune(actor, 'ice');
}

/** Who a force floor carries: every mover without immunity [U]. */
export function isCarriedByForce(actor: Actor): boolean {
  return !isImmune(actor, 'force');
}

/** A player holding both the fire and the water orb survives slime and cleans it into floor [S, 10 items 17]; otherwise it kills. */
export function playerSurvivesSlime(player: PlayerData): boolean {
  return player.tools.includes('orb_fire') && player.tools.includes('orb_water');
}

/**
 * The terrain a monster enters [U genre default, one table in cc3dMonsterTraits]:
 * never gravel, sand, dirt, slime, bombs or the exit; water and fire only
 * with the matching immunity.
 */
export function monsterMayEnterTerrain(monster: MobState, terrain: Cc3dTerrain): boolean {
  if (MONSTER_TRAITS[monster.kind]?.entersTerrain.includes(terrain.kind)) return true;
  if (terrain.kind === 'slime') return isImmune(monster, 'slime');
  if (TERRAIN_REFUSED_BY_MONSTERS.includes(terrain.kind)) return false;
  if (terrain.kind === 'water') return isImmune(monster, 'water');
  if (terrain.kind === 'fire') return isImmune(monster, 'fire');
  return true;
}

/** Held on a closed trap or on a clone machine: such a cell cannot be left by a normal step. */
export function mayLeaveCell(cell: Cc3dCell): boolean {
  const terrain = actingTerrain(cell);
  if (terrain.kind === 'trap') return terrain.open === true;
  return terrain.kind !== 'clone_machine';
}

type MoverClass = 'player' | 'block' | 'monster';

function classOf(actor: Actor): MoverClass {
  if (actor.kind === 'player') return 'player';
  return isBlockKind(actor.kind) ? 'block' : 'monster';
}

/** Blocks that fill water: a dirt block makes dirt, an ice block ice, a colour block floats [P]/[U]. */
const BLOCKS_THAT_ENTER_WATER: readonly string[] = ['block_dirt', 'block_ice', 'block_color'];
/** Only an ice block enters fire, and melts into water [U]. */
const BLOCKS_THAT_ENTER_FIRE: readonly string[] = ['block_ice'];
/** A reflector and a bot never clean slime [U]. */
const BLOCKS_THAT_CLEAN_SLIME: readonly string[] = ['block_dirt', 'block_ice', 'block_color'];

/** True when the key colour is in the player's hands (the green key is never used up). */
function holdsKey(actor: Actor, terrain: Cc3dTerrain): boolean {
  return actor.kind === 'player' && terrain.color !== undefined && actor.keys[terrain.color] > 0;
}

/**
 * Floor-like kinds whose answer depends on who asks. Dirt and gravel: the player and blocks, not reflectors nor
 * monsters; sand: also reflectors; a bomb: any mob [S, 10 items 18, 20]. Dirt is cleared by the player and by
 * blocks other than the ice block (see the arrival rules).
 */
function hazardAdmits(actor: Actor, who: MoverClass, terrain: Cc3dTerrain): boolean {
  if (who === 'monster') return monsterMayEnterTerrain(actor as MobState, terrain);
  if (who === 'player') return true;
  switch (terrain.kind) {
    case 'dirt':
    case 'gravel':
      return actor.kind !== 'reflector';
    case 'sand':
    case 'bomb':
      return true;
    case 'water':
      return BLOCKS_THAT_ENTER_WATER.includes(actor.kind);
    case 'fire':
      return BLOCKS_THAT_ENTER_FIRE.includes(actor.kind);
    case 'slime':
      return BLOCKS_THAT_CLEAN_SLIME.includes(actor.kind);
    default:
      return false;
  }
}

/**
 * Whether the acting terrain of a cell lets the actor in (the "top acts" rule,
 * 06 section 6.2). Occupancy, panels and pushing are not asked here.
 */
export function terrainAdmits(world: World, actor: Actor, cell: Cc3dCell): boolean {
  const terrain = actingTerrain(cell);
  const who = classOf(actor);
  // A cell holding a F.I.S.H., a key or an orb is refused by monsters and by ordinary blocks; the ice block slides over it [S, 10 items 7, 23].
  if (cell.item !== null && who !== 'player' && actor.kind !== 'block_ice') return false;
  switch (terrain.kind) {
    case 'wall':
    case 'appearing_wall':
    case 'clone_machine':
      return false;
    case 'door':
      return holdsKey(actor, terrain);
    case 'toggle_door':
    case 'hold_door':
      return terrain.open === true;
    case 'socket':
      // The blue gate: anyone, once open; the first mob to enter turns it into floor [S, 10 item 22].
      return world.fishRemaining <= 0;
    case 'socket_red':
      return who === 'player' && world.fishRemaining <= 0;
    case 'false_wall':
    case 'push_up_wall':
    case 'exit':
      return who === 'player';
    case 'gate_tools':
    case 'gate_keys':
      return who === 'player' || actor.kind === 'block_ice';
    case 'dirt':
    case 'gravel':
    case 'sand':
    case 'bomb':
    case 'water':
    case 'fire':
    case 'slime':
      return hazardAdmits(actor, who, terrain);
    default:
      return who !== 'monster' || monsterMayEnterTerrain(actor as MobState, terrain);
  }
}

/** Fast steps: entering ice or a force floor is already a fast step unless the mover is immune to it [S, 10 item 15]. */
export function entersFast(world: World, actor: Actor, at: Cell): boolean {
  const kind = actingTerrain(cellOf(world, at)).kind;
  if (kind === 'ice' || kind === 'ice_corner') return !isImmune(actor, 'ice');
  if (kind === 'force' || kind === 'force_random') return !isImmune(actor, 'force');
  return false;
}

/** The closed sides of an ice corner, or none for any other terrain. */
function closedSides(cell: Cc3dCell): readonly Direction[] {
  const terrain = actingTerrain(cell);
  return terrain.kind === 'ice_corner' && terrain.corner ? terrain.corner : [];
}

/**
 * Panels and ice corners: a step across a closed side is refused, in or out
 * (02: panels are thin walls [D name, U behaviour]; corner sides [D]).
 */
export function sidesAllow(from: Cc3dCell, to: Cc3dCell, dir: Direction): boolean {
  const entering = opposite(dir);
  if (from.panels.includes(dir) || to.panels.includes(entering)) return false;
  return !closedSides(from).includes(dir) && !closedSides(to).includes(entering);
}

/**
 * The direction an ice corner turns a slide into: the open side that is not the
 * side the mover came in through [U for the turning]. Null when it came through a closed side.
 */
export function cornerExit(terrain: Cc3dTerrain, travelDir: Direction): Direction | null {
  const closed: readonly Direction[] = terrain.corner ?? [];
  const entry = opposite(travelDir);
  const open = ORDERED_DIRECTIONS.filter((d) => !closed.includes(d));
  if (!open.includes(entry)) return null;
  return open.find((d) => d !== entry) ?? null;
}

/** What the floor under an idle mover pushes it to do. */
export interface ForcedMove {
  dir: Direction;
  source: 'exit' | 'ice' | 'force';
}

/**
 * The move the floor imposes on an idle mover, or null. Teleport exits come
 * first, then ice drift, then force floors [P for the player stepping off one sideways].
 */
export function forcedMoveOf(world: World, actor: Actor): ForcedMove | null {
  if (actor.exitDir) return { dir: actor.exitDir, source: 'exit' };
  const terrain = actingTerrain(cellOf(world, actor));
  switch (terrain.kind) {
    case 'ice':
    case 'ice_corner':
      return actor.drift && slidesOnIce(actor) ? { dir: actor.drift, source: 'ice' } : null;
    case 'force':
      return terrain.dir && isCarriedByForce(actor) ? { dir: terrain.dir, source: 'force' } : null;
    case 'force_random':
      return actor.drift && isCarriedByForce(actor) ? { dir: actor.drift, source: 'force' } : null;
    default:
      return null;
  }
}

/** The player may step off a force floor sideways [P]; any other forced move overrides his input. */
export function inputAllowed(forced: ForcedMove | null, wanted: Direction): boolean {
  if (forced === null) return true;
  if (forced.source !== 'force') return false;
  return wanted !== forced.dir && wanted !== opposite(forced.dir);
}

/** What happens to a cell when a mover leaves it: turtles sink (the blinkies cross them [S]), push up walls rise [U]. */
export function onLeave(world: World, at: Cell, actor?: Actor): void {
  const terrain = actingTerrain(cellOf(world, at));
  const crosses = actor !== undefined && actor.kind !== 'player' && (MONSTER_TRAITS[actor.kind]?.crossesTurtles ?? false);
  if (terrain.kind === 'turtle' && !crosses) replaceTop(world, at, { kind: 'water' });
  else if (terrain.kind === 'push_up_wall') replaceTop(world, at, { kind: 'wall' });
}
