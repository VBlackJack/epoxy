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
 * Floating joystick of the phone layout: the base appears where the thumb lands, a direction is read
 * from the drag, and the base trails the finger. `resolveJoystick` is the pure math; `FloatingJoystick`
 * binds it to Pointer Events on a zone element and reports through callbacks (it knows nothing of the game).
 */

import type { Direction, TouchConfig } from '../core/types';
import { TOUCH_DEFAULTS } from './uiConstants';

export interface Point {
  x: number;
  y: number;
}

export interface JoystickConfig {
  /** Distance from the base before a direction engages. */
  deadZonePx: number;
  /** Distance under which an engaged direction lets go (smaller than the dead zone). */
  releaseRadiusPx: number;
  /** The off-axis component must exceed the current axis component times this ratio to switch axis. */
  axisSwitchRatio: number;
  /** Distance past which the base follows the finger. */
  baseFollowRadiusPx: number;
  /** Radius the knob is drawn within (visual only). */
  knobRadiusPx: number;
}

export interface JoystickOptions {
  config: JoystickConfig;
  /** A touch that moves at most this far and ends within the duration is a tap. */
  tapMaxDistancePx: number;
  tapMaxDurationMs: number;
}

export interface JoystickResolution {
  /** Direction held, or null when idle. */
  dir: Direction | null;
  /** Base position after the follow rule. */
  origin: Point;
  /** Knob offset from the base, clamped to the knob radius, for drawing. */
  knob: Point;
}

/** Builds the options from the optional game.json touch section, falling back to TOUCH_DEFAULTS. */
export function joystickOptionsFromTouchConfig(touch?: Partial<TouchConfig>): JoystickOptions {
  const merged = { ...TOUCH_DEFAULTS, ...touch };
  return {
    config: {
      deadZonePx: merged.joystickDeadZonePx,
      releaseRadiusPx: merged.joystickReleaseRadiusPx,
      axisSwitchRatio: merged.joystickAxisSwitchRatio,
      baseFollowRadiusPx: merged.joystickBaseFollowRadiusPx,
      knobRadiusPx: merged.joystickKnobRadiusPx
    },
    tapMaxDistancePx: merged.tapMaxDistancePx,
    tapMaxDurationMs: merged.tapMaxDurationMs
  };
}

function isHorizontal(dir: Direction): boolean {
  return dir === 'E' || dir === 'W';
}

/**
 * Pure joystick step. `origin` is the base, `current` the direction held so far (null when idle),
 * `point` the finger. Rules, in order:
 * - the base follows the finger once it is farther than baseFollowRadiusPx;
 * - idle: a direction engages at deadZonePx, on the dominant axis;
 * - engaged: it lets go under releaseRadiusPx (hysteresis);
 * - engaged: the sign flips at once on the same axis, and the axis changes only when the other
 *   component exceeds the current one times axisSwitchRatio (a strict comparison, so a tie stays).
 */
export function resolveJoystick(
  origin: Point,
  current: Direction | null,
  point: Point,
  config: JoystickConfig
): JoystickResolution {
  let base = origin;
  let dx = point.x - base.x;
  let dy = point.y - base.y;
  const distance = Math.hypot(dx, dy);
  if (distance > config.baseFollowRadiusPx && distance > 0) {
    const pull = (distance - config.baseFollowRadiusPx) / distance;
    base = { x: base.x + dx * pull, y: base.y + dy * pull };
    dx = point.x - base.x;
    dy = point.y - base.y;
  }
  const reach = Math.hypot(dx, dy);
  const knobScale = reach > config.knobRadiusPx && reach > 0 ? config.knobRadiusPx / reach : 1;
  const knob = { x: dx * knobScale, y: dy * knobScale };

  const threshold = current === null ? config.deadZonePx : config.releaseRadiusPx;
  if (reach < threshold) return { dir: null, origin: base, knob };

  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  let horizontal: boolean;
  if (current === null) horizontal = ax >= ay;
  else if (isHorizontal(current)) horizontal = !(ay > ax * config.axisSwitchRatio);
  else horizontal = ax > ay * config.axisSwitchRatio;

  let dir: Direction;
  if (horizontal) dir = dx >= 0 ? 'E' : 'W';
  else dir = dy >= 0 ? 'S' : 'N';
  return { dir, origin: base, knob };
}

export interface JoystickCallbacks {
  /** The held direction changed; null means released. */
  onDirection: (dir: Direction | null) => void;
  /** A short touch: client coordinates. */
  onTap: (x: number, y: number) => void;
  /** The joystick went from idle to a direction (the moment for a haptic pulse). */
  onEngage: (dir: Direction) => void;
}

/** Classes the controller puts on the elements it creates and on the zone, for the stylesheet. */
export const JOYSTICK_BASE_CLASS = 'joystick-base';
export const JOYSTICK_KNOB_CLASS = 'joystick-knob';
export const JOYSTICK_ACTIVE_CLASS = 'joystick-active';
/** Touches that start on these elements belong to them, not to the joystick. */
const JOYSTICK_IGNORED_SELECTOR = 'button, a, input, select, textarea, [role="button"]';
/** The only mouse button that steers (a mouse stands in for a finger on a desktop test). */
const PRIMARY_MOUSE_BUTTON = 0;

interface Gesture {
  pointerId: number;
  startedAt: number;
  start: Point;
  origin: Point;
  maxTravel: number;
  engaged: boolean;
}

export class FloatingJoystick {
  private readonly base: HTMLElement;
  private readonly knobEl: HTMLElement;
  private gesture: Gesture | null = null;
  private dir: Direction | null = null;
  private enabled = true;

  constructor(
    private readonly zone: HTMLElement,
    private options: JoystickOptions,
    private readonly callbacks: JoystickCallbacks,
    private readonly now: () => number = () => performance.now()
  ) {
    this.base = zone.ownerDocument.createElement('div');
    this.base.className = JOYSTICK_BASE_CLASS;
    this.base.setAttribute('aria-hidden', 'true');
    this.base.hidden = true;
    this.knobEl = zone.ownerDocument.createElement('div');
    this.knobEl.className = JOYSTICK_KNOB_CLASS;
    this.base.appendChild(this.knobEl);
    zone.appendChild(this.base);
    zone.addEventListener('pointerdown', this.onPointerDown);
    zone.addEventListener('pointermove', this.onPointerMove);
    zone.addEventListener('pointerup', this.onPointerUp);
    zone.addEventListener('pointercancel', this.onPointerCancel);
    zone.addEventListener('lostpointercapture', this.onLostCapture);
  }

  /** Replaces the thresholds (the touch section of game.json can be reloaded). */
  setOptions(options: JoystickOptions): void {
    this.options = options;
  }

  /** The direction currently held. */
  getDirection(): Direction | null {
    return this.dir;
  }

  /** While disabled the zone ignores touches; disabling lets go of a gesture in progress. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.release(true);
  }

  /**
   * Lets go of the gesture in progress. The finger that made it is ignored from then on (moves and
   * lift alike): the next input must be a fresh pointerdown. Called when a dialog opens or closes,
   * so a thumb still on the glass does not steer.
   */
  requireFreshPointerDown(): void {
    this.release(true);
  }

  /** Removes the listeners and the elements the controller created. */
  destroy(): void {
    this.release(true);
    this.zone.removeEventListener('pointerdown', this.onPointerDown);
    this.zone.removeEventListener('pointermove', this.onPointerMove);
    this.zone.removeEventListener('pointerup', this.onPointerUp);
    this.zone.removeEventListener('pointercancel', this.onPointerCancel);
    this.zone.removeEventListener('lostpointercapture', this.onLostCapture);
    this.base.remove();
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (!this.enabled || this.gesture) return;
    const target = event.target as Element | null;
    if (target && typeof target.closest === 'function' && target.closest(JOYSTICK_IGNORED_SELECTOR)) return;
    if (event.pointerType === 'mouse' && event.button !== PRIMARY_MOUSE_BUTTON) return;
    event.preventDefault();
    const start = { x: event.clientX, y: event.clientY };
    this.gesture = {
      pointerId: event.pointerId,
      startedAt: this.now(),
      start,
      origin: start,
      maxTravel: 0,
      engaged: false
    };
    try {
      this.zone.setPointerCapture?.(event.pointerId);
    } catch {
      // The pointer is already gone; the pointerup or cancel that follows ends the gesture.
    }
    this.draw(start, { x: 0, y: 0 });
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    const gesture = this.gesture;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const point = { x: event.clientX, y: event.clientY };
    gesture.maxTravel = Math.max(gesture.maxTravel, Math.hypot(point.x - gesture.start.x, point.y - gesture.start.y));
    const resolved = resolveJoystick(gesture.origin, this.dir, point, this.options.config);
    gesture.origin = resolved.origin;
    this.draw(resolved.origin, resolved.knob);
    if (resolved.dir === this.dir) return;
    const wasIdle = this.dir === null;
    this.dir = resolved.dir;
    if (resolved.dir !== null) {
      gesture.engaged = true;
      if (wasIdle) this.callbacks.onEngage(resolved.dir);
    }
    this.callbacks.onDirection(resolved.dir);
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    const gesture = this.gesture;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const isTap =
      !gesture.engaged &&
      gesture.maxTravel <= this.options.tapMaxDistancePx &&
      this.now() - gesture.startedAt <= this.options.tapMaxDurationMs;
    this.release(true);
    if (isTap) this.callbacks.onTap(event.clientX, event.clientY);
  };

  private readonly onPointerCancel = (event: PointerEvent): void => {
    if (this.gesture && event.pointerId === this.gesture.pointerId) this.release(true);
  };

  private readonly onLostCapture = (event: PointerEvent): void => {
    if (this.gesture && event.pointerId === this.gesture.pointerId) this.release(false);
  };

  /** Ends the gesture; reports the release when a direction was held. */
  private release(releaseCapture: boolean): void {
    const gesture = this.gesture;
    this.gesture = null;
    this.base.hidden = true;
    this.zone.classList.remove(JOYSTICK_ACTIVE_CLASS);
    if (gesture && releaseCapture) {
      try {
        this.zone.releasePointerCapture?.(gesture.pointerId);
      } catch {
        // Capture already released by the browser.
      }
    }
    if (this.dir !== null) {
      this.dir = null;
      this.callbacks.onDirection(null);
    }
  }

  /** Moves the base to client point `origin` and the knob to `knob` pixels from it. */
  private draw(origin: Point, knob: Point): void {
    const rect = this.zone.getBoundingClientRect();
    this.base.hidden = false;
    this.zone.classList.add(JOYSTICK_ACTIVE_CLASS);
    this.base.style.transform = `translate(${origin.x - rect.left}px, ${origin.y - rect.top}px)`;
    this.knobEl.style.transform = `translate(${knob.x}px, ${knob.y}px)`;
  }
}
