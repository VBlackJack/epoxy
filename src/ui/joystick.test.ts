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

import { describe, expect, it } from 'vitest';
import type { Direction } from '../core/types';
import { joystickOptionsFromTouchConfig, resolveJoystick } from './joystick';
import type { Point } from './joystick';

const OPTIONS = joystickOptionsFromTouchConfig();
const CONFIG = OPTIONS.config;
const ORIGIN: Point = { x: 0, y: 0 };

/** Degrees to a point at `radius` from the origin, 0 = East, positive = towards South (screen axes). */
function polar(radius: number, degrees: number): Point {
  const rad = (degrees * Math.PI) / 180;
  return { x: radius * Math.cos(rad), y: radius * Math.sin(rad) };
}

describe('joystickOptionsFromTouchConfig', () => {
  it('uses the shipped values when the section is missing', () => {
    expect(CONFIG).toEqual({
      deadZonePx: 14,
      releaseRadiusPx: 10,
      axisSwitchRatio: 1.25,
      baseFollowRadiusPx: 24,
      knobRadiusPx: 48
    });
    expect(OPTIONS.tapMaxDistancePx).toBe(14);
    expect(OPTIONS.tapMaxDurationMs).toBe(280);
  });

  it('takes the values of a given touch section', () => {
    const custom = joystickOptionsFromTouchConfig({ joystickDeadZonePx: 20, tapMaxDurationMs: 100 });
    expect(custom.config.deadZonePx).toBe(20);
    expect(custom.tapMaxDurationMs).toBe(100);
    expect(custom.config.releaseRadiusPx).toBe(10);
  });
});

describe('dead zone and release', () => {
  it('stays idle under the dead zone and engages at it', () => {
    expect(resolveJoystick(ORIGIN, null, { x: 13.9, y: 0 }, CONFIG).dir).toBeNull();
    expect(resolveJoystick(ORIGIN, null, { x: 14, y: 0 }, CONFIG).dir).toBe('E');
    expect(resolveJoystick(ORIGIN, null, { x: 0, y: -14 }, CONFIG).dir).toBe('N');
  });

  it('keeps an engaged direction between the release radius and the dead zone (hysteresis)', () => {
    expect(resolveJoystick(ORIGIN, 'E', { x: 12, y: 0 }, CONFIG).dir).toBe('E');
    expect(resolveJoystick(ORIGIN, 'E', { x: 10, y: 0 }, CONFIG).dir).toBe('E');
    expect(resolveJoystick(ORIGIN, 'E', { x: 9.9, y: 0 }, CONFIG).dir).toBeNull();
  });

  it('does not engage from the same spot that keeps an engaged direction', () => {
    expect(resolveJoystick(ORIGIN, null, { x: 12, y: 0 }, CONFIG).dir).toBeNull();
  });
});

describe('dominant axis and switch ratio', () => {
  const cases: Array<[number, Direction | null, Direction]> = [
    // [angle from East in degrees, current direction, expected]
    [47, 'E', 'E'],
    [50, 'E', 'E'],
    [52, 'E', 'S'],
    [90, 'E', 'S'],
    [43, 'S', 'S'],
    [35, 'S', 'E'],
    [45, null, 'E']
  ];
  for (const [degrees, current, expected] of cases) {
    it(`${degrees} degrees with ${current ?? 'no direction'} held gives ${expected}`, () => {
      expect(resolveJoystick(ORIGIN, current, polar(20, degrees), CONFIG).dir).toBe(expected);
    });
  }

  it('keeps the axis on an exact tie at the ratio (vertical component 1.25 times the horizontal one)', () => {
    expect(resolveJoystick(ORIGIN, 'E', { x: 8, y: 10 }, CONFIG).dir).toBe('E');
    expect(resolveJoystick(ORIGIN, 'E', { x: 8, y: 10.1 }, CONFIG).dir).toBe('S');
  });

  it('keeps the axis on an exact tie at the ratio (horizontal component 1.25 times the vertical one)', () => {
    expect(resolveJoystick(ORIGIN, 'S', { x: 10, y: 8 }, CONFIG).dir).toBe('S');
    expect(resolveJoystick(ORIGIN, 'S', { x: 10.1, y: 8 }, CONFIG).dir).toBe('E');
  });

  it('breaks a tie from idle towards the horizontal axis', () => {
    expect(resolveJoystick(ORIGIN, null, { x: 15, y: 15 }, CONFIG).dir).toBe('E');
  });
});

describe('opposite flip', () => {
  it('flips at once to the opposite direction of the same axis, inside the dead zone', () => {
    expect(resolveJoystick(ORIGIN, 'E', { x: -10, y: 0 }, CONFIG).dir).toBe('W');
    expect(resolveJoystick(ORIGIN, 'N', { x: 0, y: 11 }, CONFIG).dir).toBe('S');
  });

  it('needs at most 40 px of finger travel to reverse after a long drag', () => {
    let origin: Point = ORIGIN;
    let dir: Direction | null = null;
    let finger: Point = ORIGIN;
    for (let x = 0; x <= 300; x += 2) {
      finger = { x, y: 0 };
      const step = resolveJoystick(origin, dir, finger, CONFIG);
      origin = step.origin;
      dir = step.dir;
    }
    expect(dir).toBe('E');
    const reversalStart = finger.x;
    let travel = 0;
    while (dir !== 'W' && travel < 200) {
      travel += 1;
      const step = resolveJoystick(origin, dir, { x: reversalStart - travel, y: 0 }, CONFIG);
      origin = step.origin;
      dir = step.dir;
    }
    expect(dir).toBe('W');
    expect(travel).toBeLessThanOrEqual(40);
  });
});

describe('base follow', () => {
  it('leaves the base in place up to the follow radius', () => {
    expect(resolveJoystick(ORIGIN, 'E', { x: 24, y: 0 }, CONFIG).origin).toEqual(ORIGIN);
  });

  it('moves the base just past the follow radius, keeping the finger at that distance', () => {
    const step = resolveJoystick(ORIGIN, 'E', { x: 25, y: 0 }, CONFIG);
    expect(step.origin.x).toBeCloseTo(1, 9);
    expect(step.origin.y).toBeCloseTo(0, 9);
    const far = resolveJoystick(ORIGIN, 'E', { x: 100, y: 0 }, CONFIG);
    expect(far.origin.x).toBeCloseTo(76, 9);
    expect(far.knob.x).toBeCloseTo(24, 9);
  });

  it('follows along the direction of the finger on a diagonal', () => {
    const step = resolveJoystick(ORIGIN, 'E', { x: 60, y: 80 }, CONFIG);
    expect(Math.hypot(60 - step.origin.x, 80 - step.origin.y)).toBeCloseTo(CONFIG.baseFollowRadiusPx, 9);
    expect(step.origin.y / step.origin.x).toBeCloseTo(80 / 60, 9);
  });
});

describe('knob clamp', () => {
  it('draws the knob at the finger offset inside the knob radius', () => {
    expect(resolveJoystick(ORIGIN, 'E', { x: 20, y: 5 }, CONFIG).knob).toEqual({ x: 20, y: 5 });
  });

  it('clamps the knob to the knob radius when it is smaller than the follow radius', () => {
    const small = { ...CONFIG, knobRadiusPx: 10 };
    const knob = resolveJoystick(ORIGIN, 'E', { x: 20, y: 0 }, small).knob;
    expect(Math.hypot(knob.x, knob.y)).toBeCloseTo(10, 9);
    expect(knob.y).toBeCloseTo(0, 9);
  });
});
