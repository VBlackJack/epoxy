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

/**
 * The Chip's Challenge 2 items of the second wave: the steel foil, the toggle clock and the bribe. The rules follow
 * Lexy's Labyrinth (js/tiletypes.js: `foil`, `stopwatch_toggle`, `bribe` with the two thieves; js/game.js:
 * `pause_timer`). Each function is a small step called from the player module; none of them runs on a level that
 * places none of these items.
 */

import { ConfigRegistry } from '../../config/ConfigRegistry';
import { AudioManager } from '../../audio/AudioManager';
import { BRIBE_ITEM_ID } from '../coreConstants';
import type { TileDefinition } from '../types';
import type { EpoxyWorld } from './epoxyWorld';

/** Banner shown when a bribe paid a thief. */
const THIEF_BRIBED_BANNER = 'hud.messages.thief_bribed';
/** Banners shown when the toggle clock stops and restarts the level timer. */
const TIMER_PAUSED_BANNER = 'hud.messages.timer_paused';
const TIMER_RESUMED_BANNER = 'hud.messages.timer_resumed';

/**
 * A bumped wall under the steel foil: when a held boot item lists the wall in `turnsWallsTo`, the wall becomes the tile
 * it names. The player does not move and the foil stays held (Lexy: `wall.on_bumped` turns the wall into steel for an
 * actor with the foiled trait, and nothing is consumed). A thin wall in the way stops the step before this runs, so the
 * foil never reaches a wall behind one. Returns true when a wall was turned.
 */
export function foilBumpedWall(w: EpoxyWorld, x: number, y: number): boolean {
  if (w.player.boots.size === 0) return false;
  const wallId = w.terrain[y][x];
  for (const bootId of w.player.boots) {
    const turned = ConfigRegistry.getTile(bootId).turnsWallsTo?.[wallId];
    if (turned === undefined) continue;
    w.terrain[y][x] = turned;
    w.gridMutatedByMove = true;
    w.beamDirty = true;
    return true;
  }
  return false;
}

/**
 * The player stepped on a toggle clock: the level timer pauses, or resumes when it was paused. The clock stays on the map.
 * A level without a time limit has no timer to pause, so nothing happens (Lexy: `pause_timer` refuses an untimed level).
 */
export function toggleTimerOnStep(w: EpoxyWorld): void {
  if (w.level.timeLimitSeconds <= 0) return;
  w.timerPaused = !w.timerPaused;
  w.statusBannerKey = w.timerPaused ? TIMER_PAUSED_BANNER : TIMER_RESUMED_BANNER;
  AudioManager.playSfx('item');
}

/** Counts one tick the timer stood paused; called once per engine tick, and does nothing while the timer runs. */
export function countPausedTick(w: EpoxyWorld): void {
  if (w.timerPaused) w.pausedTicks++;
}

/**
 * Entering a thief with a bribe in the pocket: one bribe is spent and the thief takes nothing, whichever thief it is
 * (Lexy: both `thief_tools` and `thief_keys` take a bribe first, even when they had nothing to take). Returns true when
 * a bribe paid the visit; the caller then skips the theft and the toll token.
 */
export function bribeThief(w: EpoxyWorld, tile: TileDefinition): boolean {
  if (tile.stealsBoots !== true && tile.stealsKeys !== true) return false;
  const held = w.player.keys[BRIBE_ITEM_ID] || 0;
  if (held <= 0) return false;
  if (held === 1) delete w.player.keys[BRIBE_ITEM_ID];
  else w.player.keys[BRIBE_ITEM_ID] = held - 1;
  w.statusBannerKey = THIEF_BRIBED_BANNER;
  AudioManager.playSfx('item');
  return true;
}
