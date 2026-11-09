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
import { removeEntity } from './epoxyWorld';
import type { EpoxyWorld } from './epoxyWorld';

/** Id of the boots held that absorb a monster contact, or undefined when the player holds none. */
export function wardBootsHeld(boots: Iterable<string>): string | undefined {
  for (const bootId of boots) {
    if (ConfigRegistry.getTile(bootId).absorbsMonsterContact === true) return bootId;
  }
  return undefined;
}

/** True when the player holds boots that shield from monster and block contact (the CC2 helmet). */
export function shieldedFromContact(p: { boots: Iterable<string> }): boolean {
  for (const bootId of p.boots) {
    if (ConfigRegistry.getTile(bootId).shieldsFromContact === true) return true;
  }
  return false;
}

/**
 * Settles a contact between the player and a monster. When the player wears a ward, the ward is used up, the
 * monster is removed and true is returned: the player lives. Without a ward nothing changes and false is returned.
 * Only a monster contact is absorbed; bombs, blasts, shots, beams, water and fire never reach this.
 */
export function absorbMonsterContact(w: EpoxyWorld, monsterUid: number): boolean {
  const ward = wardBootsHeld(w.player.boots);
  if (ward === undefined) return false;
  w.player.boots.delete(ward);
  removeEntity(w, monsterUid);
  w.statusBannerKey = 'hud.messages.ward_spent';
  AudioManager.playSfx('item');
  return true;
}
