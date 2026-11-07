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
import { DEFAULT_MONSTER_MOVE_INTERVAL_TICKS } from '../coreConstants';
import { monsterSlowdown } from './epoxyWorld';
import type { EpoxyWorld } from './epoxyWorld';

/**
 * Wakes every sleeping lurker orthogonally next to the player: its type becomes the awake kind its definition
 * names (the same swap a transmogrifier makes; uid, cell and facing stay). It starts its first step after a full
 * pause, stretched by slow time like any monster step, and an awake lurker is a different type, so it never sleeps again. Called once the player's arrival
 * (a step, a slide step or a teleport) is settled and the player is alive.
 */
export function wakeLurkersNearPlayer(w: EpoxyWorld): void {
  const { x, y } = w.player;
  for (const entity of w.entities) {
    const awake = ConfigRegistry.getEntityDef(entity.type)?.wakesTo;
    if (awake === undefined) continue;
    if (Math.abs(entity.x - x) + Math.abs(entity.y - y) !== 1) continue;
    entity.type = awake;
    const interval = ConfigRegistry.getEntityDef(awake)?.moveIntervalTicks ?? DEFAULT_MONSTER_MOVE_INTERVAL_TICKS;
    entity.cooldownTicks = (interval + 1) * monsterSlowdown(w) - 1;
  }
}
