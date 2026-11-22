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

import { AudioManager } from '../../audio/AudioManager';
import { ConfigRegistry } from '../../config/ConfigRegistry';
import { usesCc2Engine } from './ccRules';
import { leaveBlockSplash } from './epoxyBlocks';
import { removeEntity, type EpoxyContext } from './epoxyWorld';

/** The item id of the plain bomb; the green bomb has no stand effect in Lexy and is left alone. */
const PLAIN_BOMB_ITEM_ID = 'bomb';

/** The sound played when a load-time bomb goes off. */
const BOMB_SFX = 'bomb';

/**
 * CC2 engine (never CC3D pace): a block or a monster (not a ghost, not a player) standing on a plain bomb when the level starts is
 * blown up before anything moves (Lexy do_actor_idle -> bomb.on_stand at t0f0; the green bomb has no on_stand). A block leaves its
 * blast like a block destroyed by a bomb on arrival; a monster takes the effects of a bomb removal (item cleared, removed, bomb sound).
 * Called right after the level world is built, so a restart or a replay plays it again and every undo snapshot already holds its result.
 */
export function blowUpLoadBombs(ctx: EpoxyContext): void {
  const w = ctx.world;
  if (!usesCc2Engine(w.level) || w.cc3dPace) return;
  for (const e of [...w.entities]) {
    if (w.items[e.y]?.[e.x] !== PLAIN_BOMB_ITEM_ID) continue;
    const def = ConfigRegistry.getEntityDef(e.type);
    const block = e.kind === 'block' && def?.destroyedByBomb === true;
    const monster = e.kind === 'monster' && def?.ignoresFloorEffects !== true;
    if (!block && !monster) continue;
    w.items[e.y][e.x] = null;
    if (block) leaveBlockSplash(w, e.x, e.y, true);
    removeEntity(w, e.uid);
    w.beamDirty = true;
    AudioManager.playSfx(BOMB_SFX);
    if (block) ctx.emitVisual('explosion', e.x, e.y);
  }
}
