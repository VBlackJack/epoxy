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
import { findTouchConfigErrors } from '../config/ConfigValidation';
import { ConfigRegistry } from '../config/ConfigRegistry';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { heldSetForTick } from './padDirections';
import {
  joystickDiagonalConfigFrom,
  joystickKeys,
  OPEN_TOUCH_GATE,
  sameKeys,
  TouchKeySteer,
  type TouchGate
} from './touchDirections';

const CONFIG = joystickDiagonalConfigFrom(undefined);
const FOLLOW_RADIUS_PX = 24;
/** The shipped press distance (0.5 of the base follow radius) and release distance (0.35). */
const PRESS_PX = 12;
const RELEASE_PX = 8.4;

describe('joystickDiagonalConfigFrom', () => {
  it('turns the shipped ratios into distances of the base follow radius, and takes a given section over them', () => {
    expect(CONFIG.enabled).toBe(true);
    expect(CONFIG.pressPx).toBeCloseTo(PRESS_PX, 9);
    expect(CONFIG.releasePx).toBeCloseTo(RELEASE_PX, 9);
    const given = joystickDiagonalConfigFrom({ joystickDiagonalPressRatio: 0.75, joystickBaseFollowRadiusPx: 40, joystickDiagonals: false });
    expect(given.enabled).toBe(false);
    expect(given.pressPx).toBeCloseTo(30, 9);
    expect(given.releasePx).toBeCloseTo(14, 9);
  });
});

describe('joystickKeys', () => {
  it('holds nothing while the joystick is idle, whatever the offset', () => {
    expect(joystickKeys(null, 20, 20, [], CONFIG)).toEqual([]);
    expect(joystickKeys(null, 20, 20, ['N', 'E'], CONFIG)).toEqual([]);
  });

  it('adds the perpendicular key strictly past the press distance', () => {
    expect(joystickKeys('E', 20, 12, [], CONFIG)).toEqual(['E']);
    expect(joystickKeys('E', 20, 12.1, [], CONFIG)).toEqual(['E', 'S']);
    expect(joystickKeys('E', 20, -12.1, [], CONFIG)).toEqual(['N', 'E']);
    expect(joystickKeys('W', -20, 12.1, [], CONFIG)).toEqual(['S', 'W']);
    expect(joystickKeys('N', -12.1, -20, [], CONFIG)).toEqual(['N', 'W']);
    expect(joystickKeys('S', 12.1, 20, [], CONFIG)).toEqual(['E', 'S']);
  });

  it('keeps a held perpendicular key down to the release distance (hysteresis)', () => {
    expect(joystickKeys('E', 20, 9, ['E', 'S'], CONFIG)).toEqual(['E', 'S']);
    expect(joystickKeys('E', 20, 8.5, ['E', 'S'], CONFIG)).toEqual(['E', 'S']);
    expect(joystickKeys('E', 20, 8.3, ['E', 'S'], CONFIG)).toEqual(['E']);
    // The release distance only holds the key that was held: north at 9 px is not south.
    expect(joystickKeys('E', 20, -9, ['E', 'S'], CONFIG)).toEqual(['E']);
  });

  it('keeps the same diagonal when the primary axis switches inside it', () => {
    // East engaged, the finger turns toward south: resolveJoystick hands the primary to south, east stays as the second key.
    expect(joystickKeys('S', 14, 17, ['E', 'S'], CONFIG)).toEqual(['E', 'S']);
  });

  it('at full reach (the 24 px base follow) a diagonal spans 30 to 60 degrees from rest, like the gamepad press throw', () => {
    const at = (deg: number): [number, number] => [
      FOLLOW_RADIUS_PX * Math.cos((deg * Math.PI) / 180),
      FOLLOW_RADIUS_PX * Math.sin((deg * Math.PI) / 180)
    ];
    expect(joystickKeys('E', ...at(29.9), [], CONFIG)).toEqual(['E']);
    expect(joystickKeys('E', ...at(30.1), [], CONFIG)).toEqual(['E', 'S']);
  });

  it('follows the base follow radius: the same ratios on a bigger radius need a bigger finger', () => {
    const wide = joystickDiagonalConfigFrom({ joystickBaseFollowRadiusPx: 48 });
    expect(joystickKeys('E', 40, 20, [], wide)).toEqual(['E']);
    expect(joystickKeys('E', 40, 24.1, [], wide)).toEqual(['E', 'S']);
  });
});

describe('sameKeys', () => {
  it('compares the keys held, not their order', () => {
    expect(sameKeys(['E', 'S'], ['S', 'E'])).toBe(true);
    expect(sameKeys(['E'], ['E', 'S'])).toBe(false);
    expect(sameKeys([], [])).toBe(true);
  });
});

describe('TouchKeySteer', () => {
  it('east then south-east presses exactly [S, E], the most recent key first, as the keyboard lists its own', () => {
    const steer = new TouchKeySteer();
    expect(steer.update(['E'])).toEqual({ kind: 'single', dir: 'E' });
    expect(steer.update(['E', 'S'])).toEqual({ kind: 'press', keys: ['S', 'E'] });
    expect(steer.holdFor('S')).toEqual(['S', 'E']);
  });

  it('south-east then east presses nothing, and the key that stays is the held direction', () => {
    const steer = new TouchKeySteer();
    expect(steer.update(['E', 'S'])).toEqual({ kind: 'press', keys: ['E', 'S'] });
    expect(steer.update(['E'])).toEqual({ kind: 'hold', keys: ['E'] });
    expect(steer.holdFor('E')).toBe('E');
  });

  it('dropping a key presses nothing, whichever key it is', () => {
    const steer = new TouchKeySteer();
    steer.update(['E']);
    steer.update(['E', 'S']);
    expect(steer.update(['S'])).toEqual({ kind: 'hold', keys: ['S'] });
    expect(steer.holdFor('S')).toBe('S');
  });

  it('both keys in one move press in the canonical order [E, S], and the hold keeps both', () => {
    const steer = new TouchKeySteer();
    expect(steer.update(['E', 'S'])).toEqual({ kind: 'press', keys: ['E', 'S'] });
    expect(steer.holdFor('E')).toEqual(['E', 'S']);
  });

  it('reads the diagonal only while its first key is the held direction', () => {
    const steer = new TouchKeySteer();
    steer.update(['E', 'S']);
    expect(steer.holdFor('W')).toBe('W');
    expect(steer.holdFor(null)).toBeNull();
    steer.forgetKeys();
    expect(steer.holdFor('E')).toBe('E');
  });

  it('a release is a release, and the next touch starts from a single key again', () => {
    const steer = new TouchKeySteer();
    steer.update(['E']);
    steer.update(['E', 'S']);
    expect(steer.update([])).toEqual({ kind: 'release' });
    expect(steer.holdFor('E')).toBe('E');
    expect(steer.update(['S'])).toEqual({ kind: 'single', dir: 'S' });
  });

  it('a level loaded under the finger: nothing steers until the finger has lifted, then a single key again', () => {
    const steer = new TouchKeySteer();
    steer.update(['E']);
    steer.update(['E', 'S']);
    steer.requireRelease();
    expect(steer.holdFor('E')).toBe('E');
    expect(steer.update(['E', 'S'])).toEqual({ kind: 'release' });
    expect(steer.update(['S'])).toEqual({ kind: 'release' });
    expect(steer.update([])).toEqual({ kind: 'release' });
    expect(steer.update(['W'])).toEqual({ kind: 'single', dir: 'W' });
  });

  it('a level loaded with no finger down does not make the next touch wait', () => {
    const steer = new TouchKeySteer();
    steer.update(['E']);
    steer.update([]);
    steer.requireRelease();
    expect(steer.update(['W'])).toEqual({ kind: 'single', dir: 'W' });
    expect(steer.update(['W', 'N'])).toEqual({ kind: 'press', keys: ['N', 'W'] });
  });

  it('an engine that stopped reading pairs under the finger gets one key, the first, and a release', () => {
    const steer = new TouchKeySteer();
    const single: TouchGate = { ...OPEN_TOUCH_GATE, pairs: false };
    steer.update(['E']);
    expect(steer.update(['E', 'S'], single)).toEqual({ kind: 'single', dir: 'E' });
    expect(steer.holdFor('E')).toBe('E');
    expect(steer.update(['S'], single)).toEqual({ kind: 'single', dir: 'S' });
    expect(steer.update([], single)).toEqual({ kind: 'release' });
  });

  it('a Tile World solution playing: a first reading with both keys is the single press that takes the game back, never a pair press', () => {
    const steer = new TouchKeySteer();
    const takeover: TouchGate = { ...OPEN_TOUCH_GATE, takeover: true, replaying: true };
    expect(steer.update(['E', 'S'], takeover)).toEqual({ kind: 'single', dir: 'E' });
    expect(steer.holdFor('E')).toBe('E');
    expect(steer.update(['E'], takeover)).toEqual({ kind: 'none' });
  });

  it('a replay playing presses and holds nothing', () => {
    const steer = new TouchKeySteer();
    const replaying: TouchGate = { ...OPEN_TOUCH_GATE, replaying: true };
    expect(steer.update(['E', 'S'], replaying)).toEqual({ kind: 'none' });
    expect(steer.update(['E'], replaying)).toEqual({ kind: 'none' });
    expect(steer.holdFor('E')).toBe('E');
    expect(steer.update([], replaying)).toEqual({ kind: 'release' });
  });

  it('aiming turns with one direction, never a pair', () => {
    const steer = new TouchKeySteer();
    const aiming: TouchGate = { ...OPEN_TOUCH_GATE, aiming: true };
    expect(steer.update(['N', 'W'], aiming)).toEqual({ kind: 'single', dir: 'N' });
    expect(steer.update(['W'], aiming)).toEqual({ kind: 'none' });
  });
});

describe('heldSetForTick with touch keys', () => {
  it('takes the joystick keys after the keyboard and before the pad', () => {
    expect(heldSetForTick([], ['S', 'E'], ['N'], false)).toEqual(['S', 'E']);
    expect(heldSetForTick(['W'], ['S', 'E'], ['N'], false)).toEqual(['W']);
    expect(heldSetForTick([], [], ['N'], false)).toEqual(['N']);
    expect(heldSetForTick([], 'S', ['N'], false)).toEqual(['S']);
    expect(heldSetForTick([], ['S', 'E'], ['N'], true)).toEqual([]);
  });
});

describe('touch diagonal settings', () => {
  it('accepts the shipped section, a missing one and a section that sets one of the keys', () => {
    loadTestConfigs();
    expect(findTouchConfigErrors(ConfigRegistry.getGame().touch)).toEqual([]);
    expect(findTouchConfigErrors(undefined)).toEqual([]);
    expect(findTouchConfigErrors({})).toEqual([]);
    expect(findTouchConfigErrors({ joystickDiagonals: false })).toEqual([]);
    expect(findTouchConfigErrors({ joystickDiagonalPressRatio: 0.77 })).toEqual([]);
    expect(findTouchConfigErrors({ joystickDiagonalPressRatio: 0.4, joystickDiagonalReleaseRatio: 0.1 })).toEqual([]);
  });

  it('judges a partial section against the defaults of the other key', () => {
    // press 0.3 against the default release 0.35, release 0.6 and 0.5 against the default press 0.5
    const notUnder = ['touch.joystickDiagonalReleaseRatio: not under joystickDiagonalPressRatio'];
    expect(findTouchConfigErrors({ joystickDiagonalPressRatio: 0.3 })).toEqual(notUnder);
    expect(findTouchConfigErrors({ joystickDiagonalReleaseRatio: 0.6 })).toEqual(notUnder);
    expect(findTouchConfigErrors({ joystickDiagonalReleaseRatio: 0.5 })).toEqual(notUnder);
  });

  it('refuses a press ratio that the finger can never reach (0.78 and over) and one that is not above 0', () => {
    const badPress = ['touch.joystickDiagonalPressRatio: not a number in (0, 0.78)'];
    const badRelease = ['touch.joystickDiagonalReleaseRatio: not a number above 0'];
    expect(findTouchConfigErrors({ joystickDiagonalPressRatio: 0.78 })).toEqual(badPress);
    expect(findTouchConfigErrors({ joystickDiagonalPressRatio: 1 })).toEqual(badPress);
    expect(findTouchConfigErrors({ joystickDiagonalPressRatio: 0 })).toEqual(badPress);
    expect(findTouchConfigErrors({ joystickDiagonalPressRatio: Number.NaN })).toEqual(badPress);
    expect(findTouchConfigErrors({ joystickDiagonalReleaseRatio: 0 })).toEqual(badRelease);
    expect(findTouchConfigErrors({ joystickDiagonalReleaseRatio: -0.1 })).toEqual(badRelease);
  });

  it('refuses a switch that is not a boolean and a key it does not know', () => {
    expect(findTouchConfigErrors({ joystickDiagonals: 'yes' })).toEqual(['touch.joystickDiagonals: not a boolean']);
    expect(findTouchConfigErrors({ joystickDiagonalPressPx: 12 })).toEqual(['touch.joystickDiagonalPressPx: unknown key']);
    expect(findTouchConfigErrors({ joystickKnob: 1 })).toEqual(['touch.joystickKnob: unknown key']);
  });
});
