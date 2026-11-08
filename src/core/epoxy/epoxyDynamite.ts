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

import { ConfigRegistry } from '../../config/ConfigRegistry';
import { AudioManager } from '../../audio/AudioManager';
import {
  CHARGE_BLAST_SFX,
  CHARGE_DEATH_REASON_KEY,
  DYNAMITE_BLAST_CORNER_SUM,
  DYNAMITE_BLAST_RADIUS,
  DYNAMITE_FIRE_TILE_ID,
  DYNAMITE_ICE_BLOCK_TYPE,
  DYNAMITE_NOT_LIT_TICK,
  DYNAMITE_WATER_TILE_ID,
  FLOOR_TILE_ID
} from '../coreConstants';
import { isPhasingEntityType } from '../RulesetFeatures';
import { LitCharge } from '../types';
import { EpoxyContext, EpoxyWorld, isInBounds, killPlayer, mapWidth, rebuildDeviceLookups, removeEntity } from './epoxyWorld';

/**
 * Chip's Challenge 2 dynamite, after the rules of the Lexy's Labyrinth engine (tiletypes.js `dynamite`, `dynamite_lit`):
 * the player sets it down on their cell; it lights once the player has left that cell and blasts a fixed number of ticks
 * later. The blast covers the 5 by 5 square around it without its four far corners. In each cell it destroys every item,
 * kills every creature, and turns terrain into floor, except terrain that resists (see `terrainSurvives`). It never
 * sets off another lit dynamite: a lit dynamite caught in the blast is destroyed with its fuse.
 */

/** True when the item id is Chip's Challenge 2 dynamite, lit or not. */
export function isDynamiteItem(itemId: string | null | undefined): boolean {
  return !!itemId && ConfigRegistry.getTile(itemId).cc2Dynamite === true;
}

/**
 * Sets the dynamite down on the player's cell. It stays unlit, as the item the player carried, until the player leaves
 * the cell (see lightDepartedDynamite).
 */
export function setDownDynamite(w: EpoxyWorld, x: number, y: number, itemId: string): void {
  w.items[y][x] = itemId;
  w.litCharges.push({ x, y, detonateTick: DYNAMITE_NOT_LIT_TICK, dynamite: true, awaitingDeparture: true });
}

/**
 * Lights every set-down dynamite whose player has left its cell: the lit item replaces the unlit one and the blast is
 * scheduled `dynamiteFuseTicks` after `tick`. Called at the start of every tick and after each player move.
 */
export function lightDepartedDynamite(w: EpoxyWorld, tick: number): void {
  if (!w.litCharges.some((charge) => charge.awaitingDeparture === true)) return;
  const kept: LitCharge[] = [];
  for (const charge of w.litCharges) {
    if (charge.awaitingDeparture !== true || (w.player.x === charge.x && w.player.y === charge.y)) {
      kept.push(charge);
      continue;
    }
    const itemId = w.items[charge.y]?.[charge.x];
    const litId = itemId ? ConfigRegistry.getTile(itemId).dropsAs : undefined;
    // Nothing to light when the item is gone: the fuse goes with it.
    if (litId === undefined) continue;
    w.items[charge.y][charge.x] = litId;
    delete charge.awaitingDeparture;
    charge.detonateTick = tick + ConfigRegistry.getGame().timing.dynamiteFuseTicks;
    kept.push(charge);
  }
  w.litCharges = kept;
}

/** True when the dynamite blast reaches the cell at (dx, dy) from its centre. */
export function inDynamiteBlast(dx: number, dy: number): boolean {
  return (
    Math.abs(dx) <= DYNAMITE_BLAST_RADIUS &&
    Math.abs(dy) <= DYNAMITE_BLAST_RADIUS &&
    Math.abs(dx) + Math.abs(dy) < DYNAMITE_BLAST_CORNER_SUM
  );
}

/** True when dynamite leaves the terrain as it is: floor itself, a blast-proof wall, the socket and the logic gates. */
function terrainSurvives(terrainId: string): boolean {
  if (terrainId === FLOOR_TILE_ID) return true;
  const tile = ConfigRegistry.getTile(terrainId);
  return tile.blastProof === true || tile.survivesDynamite === true;
}

/**
 * Blasts one dynamite whose fuse ran out. `pending` holds the dynamite of the same tick that has not blasted yet: a
 * lit dynamite inside the blast leaves both it and `w.litCharges`, so it never blasts.
 */
export function blastDynamite(ctx: EpoxyContext, charge: LitCharge, pending: Set<LitCharge>): void {
  const w = ctx.world;
  AudioManager.playSfx(CHARGE_BLAST_SFX);
  const width = mapWidth(w);
  let terrainChanged = false;
  let playerKilled = false;
  for (let dx = -DYNAMITE_BLAST_RADIUS; dx <= DYNAMITE_BLAST_RADIUS; dx++) {
    for (let dy = -DYNAMITE_BLAST_RADIUS; dy <= DYNAMITE_BLAST_RADIUS; dy++) {
      if (!inDynamiteBlast(dx, dy)) continue;
      const x = charge.x + dx;
      const y = charge.y + dy;
      if (!isInBounds(w, x, y)) continue;
      ctx.emitVisual('explosion', x, y);

      // What stands in the cell: creatures, the player, or a lit dynamite (the exploding one included).
      const creatures = w.entities.filter(
        (e) => e.x === x && e.y === y && !(ConfigRegistry.getTile(w.terrain[y][x]).isCloneMachine && !isPhasingEntityType(e.type))
      );
      const playerHere = w.player.alive && w.player.x === x && w.player.y === y;
      const litHere = [...w.litCharges, ...pending].filter(
        (other) => other.x === x && other.y === y && other.dynamite === true && other.awaitingDeparture !== true
      );
      const centre = dx === 0 && dy === 0;
      const actorHere = creatures.length > 0 || playerHere || litHere.length > 0 || centre;

      // Every item goes, and the fuse of any lit charge on it with it.
      w.items[y][x] = null;
      for (const other of [...pending]) if (other.x === x && other.y === y) pending.delete(other);
      w.litCharges = w.litCharges.filter((c) => c.x !== x || c.y !== y);

      const terrainId = w.terrain[y][x];
      if (actorHere) {
        // A creature protects the terrain under it, but plain floor catches fire (water under an ice block).
        if (terrainId === FLOOR_TILE_ID) {
          const overIce = creatures.some((e) => e.type === DYNAMITE_ICE_BLOCK_TYPE);
          w.terrain[y][x] = overIce ? DYNAMITE_WATER_TILE_ID : DYNAMITE_FIRE_TILE_ID;
          terrainChanged = true;
        }
      } else if (!terrainSurvives(terrainId)) {
        w.terrain[y][x] = FLOOR_TILE_ID;
        // A cell whose terrain is blasted away reveals nothing later.
        w.revealedCells.add(y * width + x);
        terrainChanged = true;
      }

      for (const entity of creatures) removeEntity(w, entity.uid);
      if (playerHere) playerKilled = true;
    }
  }
  if (terrainChanged) rebuildDeviceLookups(w);
  // A blast changes what stands on a beam path.
  w.beamDirty = true;
  if (playerKilled) killPlayer(ctx, CHARGE_DEATH_REASON_KEY, CHARGE_BLAST_SFX);
}
