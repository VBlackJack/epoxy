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
 * Touch diagonals for the engines that read two held keys (engine.readsHeldKeyPairs). Only the floating joystick offers
 * them: the direction it already resolves stays the first key, and the perpendicular axis joins as a second key once its
 * component passes a press distance, with a release distance below it, exactly as each stick axis of the gamepad is its
 * own key (padDirections.stickKeys). The on-screen d-pad and the canvas swipe stay 4-way on every engine.
 *
 * Two parts: joystickKeys reads the finger (pure), and TouchKeySteer turns the keys the joystick holds into the actions the
 * page executes, in the order a keyboard would give them (pure too, so the tests drive the class the page runs).
 */

import type { Direction, TouchConfig } from '../core/types';
import { PadKeyOrder } from './padDirections';
import { TOUCH_DEFAULTS } from './uiConstants';

export interface JoystickDiagonalConfig {
  /** False: the joystick never reads two keys (game.json touch.joystickDiagonals). */
  enabled: boolean;
  /** Off-axis distance from the base past which the perpendicular key is held, in CSS pixels. */
  pressPx: number;
  /** Off-axis distance under which a held perpendicular key lets go, in CSS pixels. */
  releasePx: number;
}

/** The order keys held at the same moment are listed in (the Lynx input bits: north, east, south, west). */
const SIMULTANEOUS_KEY_ORDER: readonly Direction[] = ['N', 'E', 'S', 'W'];

/**
 * The diagonal settings: the game.json touch section over TOUCH_DEFAULTS, the two ratios turned into distances of the base
 * follow radius. Read at use (bindJoystick), never kept in a field initializer or a constructor default.
 */
export function joystickDiagonalConfigFrom(touch?: Partial<TouchConfig>): JoystickDiagonalConfig {
  const merged = { ...TOUCH_DEFAULTS, ...touch };
  return {
    enabled: merged.joystickDiagonals,
    pressPx: merged.joystickDiagonalPressRatio * merged.joystickBaseFollowRadiusPx,
    releasePx: merged.joystickDiagonalReleaseRatio * merged.joystickBaseFollowRadiusPx
  };
}

function isHorizontal(dir: Direction): boolean {
  return dir === 'E' || dir === 'W';
}

/**
 * The keys the joystick holds on an engine that reads two keys, in SIMULTANEOUS_KEY_ORDER. `primary` is the direction
 * resolveJoystick gave (null when idle: no key); `dx`, `dy` the finger from the base (y grows downward, south);
 * `previous` the keys held at the last reading (the release distance reads it). The perpendicular key joins when its
 * component is strictly past pressPx, and stays while strictly past releasePx.
 */
export function joystickKeys(
  primary: Direction | null,
  dx: number,
  dy: number,
  previous: readonly Direction[],
  config: JoystickDiagonalConfig
): Direction[] {
  if (primary === null) return [];
  const off = isHorizontal(primary) ? dy : dx;
  const offKey: Direction = isHorizontal(primary) ? (off >= 0 ? 'S' : 'N') : off >= 0 ? 'E' : 'W';
  const reach = Math.abs(off);
  const held = reach > config.pressPx || (previous.includes(offKey) && reach > config.releasePx);
  const keys = held ? [primary, offKey] : [primary];
  return SIMULTANEOUS_KEY_ORDER.filter((d) => keys.includes(d));
}

/** True when two key lists hold the same keys (the joystick reports a change only then). */
export function sameKeys(a: readonly Direction[], b: readonly Direction[]): boolean {
  return a.length === b.length && a.every((d) => b.includes(d));
}

/** What the page knows when the joystick keys change; each flag turns the pair move into something safer. */
export interface TouchGate {
  /** The engine still reads two held keys (a level of another engine may have loaded under the finger). */
  pairs: boolean;
  /** A Tile World solution plays: any press takes the game back and moves nothing. */
  takeover: boolean;
  /** A replay owns the engine (a stored solution or a Tile World one): a press injects nothing. */
  replaying: boolean;
  /** Aim mode turns the player in place with one direction. */
  aiming: boolean;
}

/** Nothing in the way: the gate of a normal run on an engine that reads two keys. */
export const OPEN_TOUCH_GATE: TouchGate = { pairs: true, takeover: false, replaying: false, aiming: false };

/**
 * What the page does with a change of the joystick keys:
 * - `single`: beginHeldMove(dir), the joystick move of today (it also takes the game back from a Tile World solution and
 *   aims in aim mode);
 * - `press`: clearAutoMove, then attemptPlayerMoveHeld(keys) with the keys most recent first, and the held direction is keys[0];
 * - `hold`: a key was let go: no press, the held direction is keys[0] (the keys that remain are held each tick);
 * - `release`: every key is up;
 * - `none`: the change is ignored.
 */
export type TouchAction =
  | { kind: 'single'; dir: Direction }
  | { kind: 'press'; keys: Direction[] }
  | { kind: 'hold'; keys: Direction[] }
  | { kind: 'release' }
  | { kind: 'none' };

/**
 * The state machine between the joystick and the engine on an engine that reads two keys. It lists the joystick's keys as
 * the keyboard lists its own (most recent first, PadKeyOrder), so E then SE presses [S, E] and SE then E presses nothing,
 * and it keeps the two keys of a diagonal for the hold of each tick. It never calls the engine: `update` returns the action.
 */
export class TouchKeySteer {
  private readonly order = new PadKeyOrder();
  private keys: Direction[] = [];
  /** The last reading held a key: a finger is on the glass, steering. */
  private fingerDown = false;
  /** A press was consumed by a gate (takeover, replay, aim): the keys that remain must not turn into a walk until a new press. */
  private suppressed = false;

  /** The joystick now holds `now` (SIMULTANEOUS_KEY_ORDER, empty when released). */
  update(now: readonly Direction[], gate: TouchGate = OPEN_TOUCH_GATE): TouchAction {
    this.fingerDown = now.length > 0;
    if (!gate.pairs) {
      // The engine changed under the finger: one key, as the joystick of a single-key engine sends it.
      // Single-key fallback: one key per change through beginHeldMove, so each change presses that key again (a finger that
      // goes from E to SE re-presses E; nothing is lost, the engine reads one key anyway). update([]) also ends a wait for rest.
      this.keys = [];
      this.suppressed = false;
      this.order.update([]);
      return now.length === 0 ? { kind: 'release' } : { kind: 'single', dir: now[0] };
    }
    const { keys, added } = this.order.update(now);
    if (keys.length === 0) {
      this.keys = [];
      this.suppressed = false;
      return { kind: 'release' };
    }
    if (gate.takeover || gate.aiming) {
      this.keys = [];
      this.suppressed = true;
      return added ? { kind: 'single', dir: keys[0] } : { kind: 'none' };
    }
    if (gate.replaying) {
      this.keys = [];
      this.suppressed = true;
      return { kind: 'none' };
    }
    if (added) this.suppressed = false;
    else if (this.suppressed) return { kind: 'none' };
    if (!added) {
      this.keys = keys.length > 1 ? keys : [];
      return { kind: 'hold', keys };
    }
    if (keys.length === 1) {
      this.keys = [];
      return { kind: 'single', dir: keys[0] };
    }
    this.keys = keys;
    return { kind: 'press', keys };
  }

  /**
   * The touch hold of a tick: the two keys of a diagonal while they still own the held move (`held` is their first key), else
   * the held direction, as before. Another input that took the held move over leaves the keys unread.
   */
  holdFor(held: Direction | null): Direction | Direction[] | null {
    if (this.keys.length > 1 && held === this.keys[0]) return [...this.keys];
    return held;
  }

  /** Another input started a held move: the diagonal is no longer the touch's to hold. */
  forgetKeys(): void {
    this.keys = [];
  }

  /**
   * A level was loaded: a finger still steering steers nothing until it has been lifted. With no finger down there is
   * nothing to wait for (the next touch must not be taken for the old one).
   */
  requireRelease(): void {
    this.keys = [];
    if (this.fingerDown) this.order.requireRelease();
    else this.order.clear();
  }
}
