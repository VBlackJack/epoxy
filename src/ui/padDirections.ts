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

import { GAMEPAD_DEFAULTS } from '../config/constants';
import type { Direction, GamepadConfig } from '../core/types';
import { GAMEPAD_AXIS_X, GAMEPAD_AXIS_Y, GAMEPAD_BUTTONS } from './uiConstants';

/** The part of a Gamepad API snapshot the pad reading needs (a real Gamepad satisfies it). */
export interface PadSnapshot {
  readonly axes: readonly number[];
  readonly buttons: readonly { readonly pressed: boolean }[];
}

/** The order keys pressed at the same moment are listed in (the Lynx input bits: north, east, south, west). */
const SIMULTANEOUS_KEY_ORDER: readonly Direction[] = ['N', 'E', 'S', 'W'];
/** The one direction a single-key engine takes when several keys are down: up, down, left, right. */
const SINGLE_KEY_PRIORITY: readonly Direction[] = ['N', 'S', 'W', 'E'];

/** The gamepad settings: the game.json "gamepad" section over GAMEPAD_DEFAULTS. Read at use, never kept in a field initializer. */
export function gamepadConfigFrom(section?: Partial<GamepadConfig>): GamepadConfig {
  return { ...GAMEPAD_DEFAULTS, ...section };
}

function inCanonicalOrder(keys: Iterable<Direction>): Direction[] {
  const set = new Set(keys);
  return SIMULTANEOUS_KEY_ORDER.filter((d) => set.has(d));
}

/** One stick axis as a virtual key: pressed past the press throw, kept while over the release throw (per-axis hysteresis). */
function axisKey(value: number, negative: Direction, positive: Direction, previous: readonly Direction[], config: GamepadConfig): Direction | null {
  if (value < -config.stickPressThreshold) return negative;
  if (value > config.stickPressThreshold) return positive;
  if (previous.includes(negative) && value < -config.stickReleaseThreshold) return negative;
  if (previous.includes(positive) && value > config.stickReleaseThreshold) return positive;
  return null;
}

/**
 * The keys an analog stick holds, in SIMULTANEOUS_KEY_ORDER: each axis is its own key, so a stick pushed into a corner holds
 * two (a diagonal), exactly as two keyboard keys. `previous` is what the stick held at the last poll (the release throw
 * reads it); with no previous keys the stick is read by the press throw alone. Axis y grows downward (south).
 */
export function stickKeys(x: number, y: number, previous: readonly Direction[], config: GamepadConfig): Direction[] {
  const keys: Direction[] = [];
  const vertical = axisKey(y, 'N', 'S', previous, config);
  const horizontal = axisKey(x, 'W', 'E', previous, config);
  if (vertical) keys.push(vertical);
  if (horizontal) keys.push(horizontal);
  return inCanonicalOrder(keys);
}

/** The d-pad buttons held, in SIMULTANEOUS_KEY_ORDER (two adjacent buttons make a diagonal). */
export function dpadKeys(pad: PadSnapshot): Direction[] {
  const pressed = (idx: number): boolean => Boolean(pad.buttons[idx]?.pressed);
  const keys: Direction[] = [];
  if (pressed(GAMEPAD_BUTTONS.DPAD_UP)) keys.push('N');
  if (pressed(GAMEPAD_BUTTONS.DPAD_RIGHT)) keys.push('E');
  if (pressed(GAMEPAD_BUTTONS.DPAD_DOWN)) keys.push('S');
  if (pressed(GAMEPAD_BUTTONS.DPAD_LEFT)) keys.push('W');
  return keys;
}

function stickOf(pad: PadSnapshot, previous: readonly Direction[], config: GamepadConfig): Direction[] {
  return stickKeys(pad.axes[GAMEPAD_AXIS_X] || 0, pad.axes[GAMEPAD_AXIS_Y] || 0, previous, config);
}

/** The keys the pad holds when the engine reads two keys: the d-pad when any of its buttons is down, else the stick. */
export function padKeys(pad: PadSnapshot, previousStick: readonly Direction[], config: GamepadConfig): { keys: Direction[]; stick: Direction[] } {
  const stick = stickOf(pad, previousStick, config);
  const dpad = dpadKeys(pad);
  return { keys: dpad.length > 0 ? dpad : stick, stick };
}

/**
 * The single direction the pad gives an engine that reads one key: the d-pad buttons and the stick axes past the press
 * throw (no release throw: what the pad has always done) as one key set, up before down before left before right.
 * While a replay plays the pad gives no direction: the replay owns the engine, and a pad move would throw it out of sync.
 */
export function singlePadDirection(pad: PadSnapshot, config: GamepadConfig, replaying = false): Direction | null {
  if (replaying) return null;
  const down = new Set<Direction>([...dpadKeys(pad), ...stickOf(pad, [], config)]);
  return SINGLE_KEY_PRIORITY.find((d) => down.has(d)) ?? null;
}

/**
 * The pad's held keys as the keyboard lists its own: most recent first. A key still held keeps its place, a new key goes in
 * front (keys arriving at the same poll in SIMULTANEOUS_KEY_ORDER). `added` tells a press: a key the last poll did not hold.
 * After requireRelease (a level was loaded, or the engine changed) nothing is read until the pad has been seen at rest, so a
 * stick still held from the last level does not walk the first tick of the next.
 */
export class PadKeyOrder {
  private keys: Direction[] = [];
  private waitingForRest = false;

  update(now: readonly Direction[]): { keys: Direction[]; added: boolean } {
    if (this.waitingForRest) {
      if (now.length > 0) return { keys: [], added: false };
      this.waitingForRest = false;
    }
    const kept = this.keys.filter((d) => now.includes(d));
    const fresh = inCanonicalOrder(now.filter((d) => !this.keys.includes(d)));
    this.keys = [...fresh, ...kept];
    return { keys: [...this.keys], added: fresh.length > 0 };
  }

  /** Forgets the keys and reads nothing until the pad is seen with no key down. */
  requireRelease(): void {
    this.keys = [];
    this.waitingForRest = true;
  }

  clear(): void {
    this.keys = [];
  }
}

/** How an engine hears a held key: told of a press once and of the hold each tick ('hold'), or sent the keys again every tick ('resend'). */
export type PadEngineKind = 'hold' | 'resend';

export interface PadSteerInput {
  /** The pad's keys, most recent first (PadKeyOrder). */
  readonly keys: readonly Direction[];
  /** A key the last poll did not hold (PadKeyOrder). */
  readonly added: boolean;
  /** Keys held on the keyboard or a touch control: they own the cadence, so the pad sends no move of its own. */
  readonly keyboardDown: boolean;
  readonly engineKind: PadEngineKind;
}

export interface PadSteer {
  /** The keys to give attemptPlayerMoveHeld now, or absent when the pad sends no move this tick. */
  press?: Direction[];
  /** The pad's keys for the hold of the tick (heldSetForTick takes the keyboard before them). */
  hold: Direction[];
}

/**
 * What the pad does for an engine that reads two keys, this tick. A 'hold' engine hears a press once, when a key is added;
 * a 'resend' engine is sent the keys every tick, as the keyboard's held move is. Neither moves while the keyboard holds a key
 * (the keyboard wins; one attempt per tick).
 */
export function padSteer(input: PadSteerInput): PadSteer {
  const hold = [...input.keys];
  if (input.keyboardDown || input.keys.length === 0) return { hold };
  if (input.engineKind === 'hold' && !input.added) return { hold };
  return { press: hold, hold };
}

/**
 * What an engine that reads every held key is told for one tick: nothing while a replay plays; the keyboard's held keys
 * (most recent first) when there are any; else the touch hold (one direction, or the joystick's keys of a diagonal); else the pad's keys (one, or two for a diagonal).
 */
export function heldSetForTick(
  keyboard: readonly Direction[],
  touch: Direction | readonly Direction[] | null,
  pad: readonly Direction[],
  replaying: boolean
): Direction[] {
  if (replaying) return [];
  if (keyboard.length > 0) return [...keyboard];
  if (typeof touch === 'string') return [touch];
  if (touch !== null && touch.length > 0) return [...touch];
  return [...pad];
}
