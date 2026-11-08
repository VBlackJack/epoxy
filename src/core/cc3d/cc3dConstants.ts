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

/** Suffix that makes the id of a converted level differ from the id of its CC3D source. */
export const CONVERTED_ID_SUFFIX = '~epoxy';

/**
 * Whether the level is a CC3D level converted to Epoxy. In CC3D the exit is never gated by the chips (arrival on it
 * completes the level); the fish gate only closes a way. A converted level keeps that rule, so its sockets are optional
 * gates and an exit reachable without one is a design of the source, not a mistake.
 */
export function isConvertedCc3dLevel(level: { id: string }): boolean {
  return level.id.endsWith(CONVERTED_ID_SUFFIX);
}

/** Step durations in engine ticks (the game runs at 20 ticks per second). */
export const STEP_TICKS = {
  /** The player, pushed blocks and most monsters. */
  normal: 4,
  /** Ice slide, force floors, teleport exits. */
  fast: 2,
  /** Omni (monsters arrive in lot C2). */
  slow: 8
} as const;

/** While the player holds the speed orb, monster-started steps and rests take this many times longer. */
export const SPEED_ORB_SLOWDOWN = 2;

/** Cells a security bot's beam covers [U guess; the free run in front of regular bots peaks at 3 in the data]. */
export const BOT_BEAM_LENGTH = 3;

/** Seconds between two quarter turns of a rotating bot [U guess, to measure in play]. */
export const BOT_ROTATION_SECONDS = 3;

/** Used when the rotation period is not given in ticks (the game runs at 20 ticks per second). */
export const FALLBACK_TICKS_PER_SECOND = 20;

/** A trap that no trap control works stays closed [P: in the observed layout the trap no control pointed at stayed closed, 05 session 4]. */
export const UNCONTROLLED_TRAP_OPEN = false;

/** The direction a random force floor gives to the 1st, 2nd, 3rd and 4th entry, then again [S, 10 item 14]. */
export const RANDOM_FORCE_ORDER: readonly Direction[] = ['E', 'S', 'W', 'N'];

/** The player carries at most this many tools; the oldest one is dropped for a new one. */
export const MAX_TOOLS = 4;

/** The facing of the player at the start of a stored level that carries none (the corpus files all face west). */
export const PLAYER_START_FACING: Direction = 'W';

/** Sound effect ids (audio.json). */
export const SFX = {
  blocked: 'blocked',
  chip: 'chip',
  item: 'item',
  door: 'door',
  socket: 'socket',
  button: 'button',
  teleport: 'teleport',
  thief: 'thief',
  splash: 'splash',
  burn: 'burn',
  bomb: 'bomb',
  death: 'death',
  win: 'win'
} as const;

/** Colour keys of visual events. */
export const VISUAL_COLOR = {
  item: 'blue',
  fish: 'green',
  socket: 'yellow',
  death: 'red'
} as const;

/** Death reason i18n keys shown by the page (all exist in the locales). */
export const DEATH_KEY = {
  water: 'hud.messages.death_water',
  fire: 'hud.messages.death_fire',
  slime: 'hud.messages.death_slime',
  bomb: 'hud.messages.death_bomb',
  monster: 'hud.messages.death_monster',
  time: 'hud.messages.death_time',
  laser: 'hud.messages.death_laser'
} as const;

export type DeathCause = keyof typeof DEATH_KEY;
