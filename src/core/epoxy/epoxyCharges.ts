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
import { CHARGE_BLAST_RADIUS, CHARGE_BLAST_SFX, CHARGE_DEATH_REASON_KEY } from '../coreConstants';
import { isPhasingEntityType } from '../RulesetFeatures';
import { LitCharge } from '../types';
import { blastDynamite, lightDepartedDynamite } from './epoxyDynamite';
import { EpoxyContext, EpoxyWorld, killPlayer, removeEntity } from './epoxyWorld';

/** True when the item id is a lit blast charge, which blocks nothing and cannot be picked up. */
export function isLitChargeItem(itemId: string | null | undefined): boolean {
  return !!itemId && ConfigRegistry.getTile(itemId).litCharge === true;
}

/** True when the tile is a blast charge, the item the player carries and drops. */
export function isChargeTile(id: string | null | undefined): boolean {
  return !!id && ConfigRegistry.getTile(id).collectible === 'charge';
}

/**
 * Lights the charge on the cell: the lit item is put down and the blast is scheduled `fuseTicks` after
 * `tick`, in absolute ticks, so nothing that stretches a monster's step stretches the fuse.
 */
export function lightCharge(w: EpoxyWorld, x: number, y: number, litItemId: string, tick: number, fuseTicks: number): void {
  w.items[y][x] = litItemId;
  w.litCharges.push({ x, y, detonateTick: tick + fuseTicks });
}

/** A copy of the lit charges for a snapshot, in the order they were lit. */
export function copyLitCharges(w: EpoxyWorld): LitCharge[] {
  return w.litCharges.map((charge) => ({ ...charge }));
}

/** True when the cell is within the blast of a charge on (cx, cy). */
function inBlast(cx: number, cy: number, x: number, y: number): boolean {
  return Math.max(Math.abs(cx - x), Math.abs(cy - y)) <= CHARGE_BLAST_RADIUS;
}

/**
 * Blasts every charge whose fuse has run out at `tick`, in the order they were lit. A blast destroys the
 * monsters and the blocks in the square around its cell and kills the player standing in it; the terrain,
 * the items (bombs and other lit charges included) and the template mobs sitting on clone machines stay.
 * Called at the start of the entity phase of the tick.
 */
export function detonateCharges(ctx: EpoxyContext, tick: number): void {
  const w = ctx.world;
  if (w.litCharges.length === 0) return;
  // A dynamite whose player has left its cell lights now.
  lightDepartedDynamite(w, tick);
  const due = w.litCharges.filter((charge) => charge.detonateTick <= tick);
  if (due.length === 0) return;
  w.litCharges = w.litCharges.filter((charge) => charge.detonateTick > tick);
  // A dynamite blast destroys the lit charges inside it, those of this very tick included: they leave `pending`.
  const pending = new Set(due);
  for (const charge of due) {
    if (!pending.has(charge)) continue;
    pending.delete(charge);
    if (charge.dynamite === true) blastDynamite(ctx, charge, pending);
    else blast(ctx, charge);
  }
}

function blast(ctx: EpoxyContext, charge: LitCharge): void {
  const w = ctx.world;
  if (isLitChargeItem(w.items[charge.y]?.[charge.x])) w.items[charge.y][charge.x] = null;
  AudioManager.playSfx(CHARGE_BLAST_SFX);
  ctx.emitVisual('explosion', charge.x, charge.y);
  for (const entity of [...w.entities]) {
    if (!inBlast(charge.x, charge.y, entity.x, entity.y)) continue;
    // A mob sitting on a clone machine is the machine's template, not a creature on the map.
    if (ConfigRegistry.getTile(w.terrain[entity.y]?.[entity.x]).isCloneMachine && !isPhasingEntityType(entity.type)) continue;
    removeEntity(w, entity.uid);
    ctx.emitVisual('explosion', entity.x, entity.y);
  }
  // A blast changes what stands on a beam path.
  w.beamDirty = true;
  if (w.player.alive && inBlast(charge.x, charge.y, w.player.x, w.player.y)) {
    killPlayer(ctx, CHARGE_DEATH_REASON_KEY, CHARGE_BLAST_SFX);
  }
}

/**
 * Search state key of the lit charges: where each is and how many ticks its fuse has left. Empty when none is lit. A
 * set-down dynamite whose player has not left yet has no fuse: it reads "w".
 */
export function litChargesStateKey(w: EpoxyWorld, tick: number): string {
  return w.litCharges
    .map((charge) => `${charge.x},${charge.y}:${charge.awaitingDeparture === true ? 'w' : charge.detonateTick - tick}`)
    .join(';');
}
