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

import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../audio/AudioManager', () => import('../test/silentAudio'));

import { GAMEPAD_DEFAULTS } from '../config/constants';
import { ConfigRegistry } from '../config/ConfigRegistry';
import { findGamepadConfigErrors } from '../config/ConfigValidation';
import { CclpEngine } from '../core/cclp/CclpEngine';
import { GameEngine } from '../core/GameEngine';
import { LynxEngine } from '../core/lynx/LynxEngine';
import { lynxLevel } from '../core/lynx/lynxTestMaps';
import { featuresFor } from '../core/RulesetFeatures';
import type { Direction, GamepadConfig } from '../core/types';
import { room } from '../test/cc2Room';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { padKeysCancelWalk } from './cclpAutoWalk';
import {
  dpadKeys,
  gamepadConfigFrom,
  heldSetForTick,
  PadKeyOrder,
  padKeys,
  padSteer,
  PadSnapshot,
  singlePadDirection,
  stickKeys
} from './padDirections';
import { GAMEPAD_BUTTONS } from './uiConstants';

beforeAll(() => {
  loadTestConfigs();
});

const SILENT = { effect: () => undefined, step: () => undefined };
const CFG: GamepadConfig = { stickPressThreshold: 0.5, stickReleaseThreshold: 0.35 };
const BUTTON_COUNT = 17;

function snapshot(axes: [number, number], held: number[] = []): PadSnapshot {
  return { axes, buttons: Array.from({ length: BUTTON_COUNT }, (_, i) => ({ pressed: held.includes(i) })) };
}

describe('stickKeys: each axis is a virtual key with its own press and release throw', () => {
  it('presses past 0.5 (strictly) and lets go at 0.35 or under, per axis', () => {
    expect(stickKeys(0.5, 0, [], CFG)).toEqual([]);
    expect(stickKeys(0.51, 0, [], CFG)).toEqual(['E']);
    expect(stickKeys(0.36, 0, ['E'], CFG)).toEqual(['E']);
    expect(stickKeys(0.35, 0, ['E'], CFG)).toEqual([]);
    expect(stickKeys(0, -0.51, [], CFG)).toEqual(['N']);
    expect(stickKeys(0, -0.36, ['N'], CFG)).toEqual(['N']);
    expect(stickKeys(0, -0.35, ['N'], CFG)).toEqual([]);
    expect(stickKeys(-0.51, 0, [], CFG)).toEqual(['W']);
    expect(stickKeys(0, 0.51, [], CFG)).toEqual(['S']);
  });

  it('a push of 0.4 on both axes from rest is nothing: there is no round dead zone', () => {
    expect(stickKeys(0.4, 0.4, [], CFG)).toEqual([]);
  });

  it('both axes past the throw are two keys, in N E S W order', () => {
    expect(stickKeys(0.6, 0.6, [], CFG)).toEqual(['E', 'S']);
    expect(stickKeys(-0.6, -0.6, [], CFG)).toEqual(['N', 'W']);
    expect(stickKeys(0.6, -0.6, [], CFG)).toEqual(['N', 'E']);
    expect(stickKeys(-0.6, 0.6, [], CFG)).toEqual(['S', 'W']);
  });

  it('the axes let go independently', () => {
    expect(stickKeys(0.6, 0.36, ['E', 'S'], CFG)).toEqual(['E', 'S']);
    expect(stickKeys(0.6, 0.35, ['E', 'S'], CFG)).toEqual(['E']);
    expect(stickKeys(0.35, 0.6, ['E', 'S'], CFG)).toEqual(['S']);
    expect(stickKeys(0.4, 0.4, ['E', 'S'], CFG)).toEqual(['E', 'S']);
  });

  it('a stick thrown across to the other side swaps the key at once', () => {
    expect(stickKeys(-0.51, 0, ['E'], CFG)).toEqual(['W']);
    expect(stickKeys(0, -0.51, ['S'], CFG)).toEqual(['N']);
  });

  it('reads the thresholds it is given', () => {
    const wide: GamepadConfig = { stickPressThreshold: 0.8, stickReleaseThreshold: 0.2 };
    expect(stickKeys(0.79, 0, [], wide)).toEqual([]);
    expect(stickKeys(0.81, 0, [], wide)).toEqual(['E']);
    expect(stickKeys(0.21, 0, ['E'], wide)).toEqual(['E']);
    expect(stickKeys(0.19, 0, ['E'], wide)).toEqual([]);
  });
});

describe('the d-pad', () => {
  it('two adjacent buttons are a diagonal', () => {
    expect(dpadKeys(snapshot([0, 0], [GAMEPAD_BUTTONS.DPAD_LEFT, GAMEPAD_BUTTONS.DPAD_UP]))).toEqual(['N', 'W']);
    expect(dpadKeys(snapshot([0, 0], [GAMEPAD_BUTTONS.DPAD_RIGHT, GAMEPAD_BUTTONS.DPAD_DOWN]))).toEqual(['E', 'S']);
  });

  it('wins over the stick when any button is down', () => {
    expect(padKeys(snapshot([0.9, 0.9], [GAMEPAD_BUTTONS.DPAD_UP]), [], CFG)).toEqual({ keys: ['N'], stick: ['E', 'S'] });
    expect(padKeys(snapshot([0.9, 0.9]), [], CFG)).toEqual({ keys: ['E', 'S'], stick: ['E', 'S'] });
  });
});

/** The reading the pad has always had on an engine that reads one key: the if-chain, per axis 0.5, strictly past. */
function todaysSingleReading(pad: PadSnapshot): Direction | null {
  const axX = pad.axes[0] || 0;
  const axY = pad.axes[1] || 0;
  const pressed = (idx: number): boolean => Boolean(pad.buttons[idx]?.pressed);
  if (pressed(GAMEPAD_BUTTONS.DPAD_UP) || axY < -0.5) return 'N';
  if (pressed(GAMEPAD_BUTTONS.DPAD_DOWN) || axY > 0.5) return 'S';
  if (pressed(GAMEPAD_BUTTONS.DPAD_LEFT) || axX < -0.5) return 'W';
  if (pressed(GAMEPAD_BUTTONS.DPAD_RIGHT) || axX > 0.5) return 'E';
  return null;
}

describe('an engine that reads one key keeps the pad reading it always had', () => {
  const AXIS_VALUES = [-1, -0.51, -0.5, -0.36, -0.35, 0, 0.35, 0.36, 0.5, 0.51, 1];
  const BUTTON_SETS: number[][] = [
    [],
    [GAMEPAD_BUTTONS.DPAD_UP],
    [GAMEPAD_BUTTONS.DPAD_DOWN],
    [GAMEPAD_BUTTONS.DPAD_LEFT],
    [GAMEPAD_BUTTONS.DPAD_RIGHT],
    [GAMEPAD_BUTTONS.DPAD_UP, GAMEPAD_BUTTONS.DPAD_DOWN],
    [GAMEPAD_BUTTONS.DPAD_LEFT, GAMEPAD_BUTTONS.DPAD_RIGHT],
    [GAMEPAD_BUTTONS.DPAD_DOWN, GAMEPAD_BUTTONS.DPAD_RIGHT],
    [GAMEPAD_BUTTONS.DPAD_UP, GAMEPAD_BUTTONS.DPAD_LEFT, GAMEPAD_BUTTONS.DPAD_DOWN, GAMEPAD_BUTTONS.DPAD_RIGHT]
  ];

  it('gives the same direction as the old if-chain for every stick position and button set tried', () => {
    let compared = 0;
    for (const x of AXIS_VALUES) {
      for (const y of AXIS_VALUES) {
        for (const buttons of BUTTON_SETS) {
          const pad = snapshot([x, y], buttons);
          expect(singlePadDirection(pad, CFG)).toBe(todaysSingleReading(pad));
          compared += 1;
        }
      }
    }
    expect(compared).toBe(AXIS_VALUES.length * AXIS_VALUES.length * BUTTON_SETS.length);
  });

  it('takes up before down before left before right when several are down', () => {
    expect(singlePadDirection(snapshot([0.9, 0.9]), CFG)).toBe('S');
    expect(singlePadDirection(snapshot([0.9, -0.9]), CFG)).toBe('N');
    expect(singlePadDirection(snapshot([-0.9, 0.9]), CFG)).toBe('S');
    expect(singlePadDirection(snapshot([-0.9, 0]), CFG)).toBe('W');
    expect(singlePadDirection(snapshot([0, 0], [GAMEPAD_BUTTONS.DPAD_RIGHT, GAMEPAD_BUTTONS.DPAD_DOWN]), CFG)).toBe('S');
  });

  it('has no release throw: a stick back to 0.4 is nothing', () => {
    expect(singlePadDirection(snapshot([0.4, 0]), CFG)).toBeNull();
  });
});

describe('PadKeyOrder: most recent first, as the keyboard lists its keys', () => {
  it('puts a new key in front, keeps a held one in place, and tells a press only when a key is added', () => {
    const order = new PadKeyOrder();
    expect(order.update(['E'])).toEqual({ keys: ['E'], added: true });
    expect(order.update(['E'])).toEqual({ keys: ['E'], added: false });
    expect(order.update(['N', 'E'])).toEqual({ keys: ['N', 'E'], added: true });
    expect(order.update(['E', 'S'])).toEqual({ keys: ['S', 'E'], added: true });
    expect(order.update(['S'])).toEqual({ keys: ['S'], added: false });
    expect(order.update([])).toEqual({ keys: [], added: false });
  });

  it('two keys arriving at the same poll come in N E S W order', () => {
    expect(new PadKeyOrder().update(['E', 'S'])).toEqual({ keys: ['E', 'S'], added: true });
    expect(new PadKeyOrder().update(['S', 'W'])).toEqual({ keys: ['S', 'W'], added: true });
  });

  it('after requireRelease it reads nothing until the pad has been seen at rest', () => {
    const order = new PadKeyOrder();
    order.update(['E']);
    order.requireRelease();
    expect(order.update(['E'])).toEqual({ keys: [], added: false });
    expect(order.update(['E', 'S'])).toEqual({ keys: [], added: false });
    expect(order.update([])).toEqual({ keys: [], added: false });
    expect(order.update(['S'])).toEqual({ keys: ['S'], added: true });
  });

  it('clear forgets the keys, so a held key is a press again', () => {
    const order = new PadKeyOrder();
    order.update(['E']);
    order.clear();
    expect(order.update(['E'])).toEqual({ keys: ['E'], added: true });
  });
});

describe('padSteer', () => {
  it('a hold engine hears a press once, when a key is added; the hold is every pad key', () => {
    expect(padSteer({ keys: ['E', 'S'], added: true, keyboardDown: false, engineKind: 'hold' })).toEqual({ press: ['E', 'S'], hold: ['E', 'S'] });
    expect(padSteer({ keys: ['E', 'S'], added: false, keyboardDown: false, engineKind: 'hold' })).toEqual({ hold: ['E', 'S'] });
  });

  it('a resend engine is sent the keys every tick', () => {
    expect(padSteer({ keys: ['S', 'E'], added: true, keyboardDown: false, engineKind: 'resend' })).toEqual({ press: ['S', 'E'], hold: ['S', 'E'] });
    expect(padSteer({ keys: ['S', 'E'], added: false, keyboardDown: false, engineKind: 'resend' })).toEqual({ press: ['S', 'E'], hold: ['S', 'E'] });
  });

  it('keeps the order of the keys it is given', () => {
    expect(padSteer({ keys: ['S', 'E'], added: true, keyboardDown: false, engineKind: 'hold' }).press).toEqual(['S', 'E']);
    expect(padSteer({ keys: ['E', 'S'], added: true, keyboardDown: false, engineKind: 'hold' }).press).toEqual(['E', 'S']);
  });

  it('sends nothing when the pad holds no key', () => {
    expect(padSteer({ keys: [], added: false, keyboardDown: false, engineKind: 'hold' })).toEqual({ hold: [] });
    expect(padSteer({ keys: [], added: false, keyboardDown: false, engineKind: 'resend' })).toEqual({ hold: [] });
  });

  it('sends no move while the keyboard holds a key, whatever the engine', () => {
    expect(padSteer({ keys: ['E'], added: true, keyboardDown: true, engineKind: 'hold' })).toEqual({ hold: ['E'] });
    expect(padSteer({ keys: ['E'], added: true, keyboardDown: true, engineKind: 'resend' })).toEqual({ hold: ['E'] });
  });
});

describe('heldSetForTick', () => {
  it('keyboard first, then touch, then the pad; nothing while a replay plays', () => {
    expect(heldSetForTick(['E'], 'N', ['S', 'W'], false)).toEqual(['E']);
    expect(heldSetForTick([], 'N', ['S', 'W'], false)).toEqual(['N']);
    expect(heldSetForTick([], null, ['S', 'W'], false)).toEqual(['S', 'W']);
    expect(heldSetForTick(['E'], 'N', ['S', 'W'], true)).toEqual([]);
  });
});

describe('gamepad config', () => {
  it('falls back to the defaults key by key', () => {
    expect(gamepadConfigFrom(undefined)).toEqual({ stickPressThreshold: 0.5, stickReleaseThreshold: 0.35 });
    expect(gamepadConfigFrom({ stickPressThreshold: 0.7 })).toEqual({ stickPressThreshold: 0.7, stickReleaseThreshold: 0.35 });
  });

  it('the shipped game.json section is valid and matches the defaults', () => {
    const section = ConfigRegistry.getGame().gamepad;
    expect(findGamepadConfigErrors(section)).toEqual([]);
    expect(gamepadConfigFrom(section)).toEqual({ ...GAMEPAD_DEFAULTS });
  });

  it('accepts no section, an empty one and a consistent partial one', () => {
    expect(findGamepadConfigErrors(undefined)).toEqual([]);
    expect(findGamepadConfigErrors({})).toEqual([]);
    expect(findGamepadConfigErrors({ stickPressThreshold: 0.8 })).toEqual([]);
    expect(findGamepadConfigErrors({ stickReleaseThreshold: 0.2 })).toEqual([]);
  });

  it('judges a partial section against the defaults of the other key', () => {
    expect(findGamepadConfigErrors({ stickReleaseThreshold: 0.6 })).toEqual(['gamepad.stickReleaseThreshold: not under stickPressThreshold']);
    expect(findGamepadConfigErrors({ stickReleaseThreshold: 0.5 })).toEqual(['gamepad.stickReleaseThreshold: not under stickPressThreshold']);
    expect(findGamepadConfigErrors({ stickPressThreshold: 0.3 })).toEqual(['gamepad.stickReleaseThreshold: not under stickPressThreshold']);
    expect(findGamepadConfigErrors({ stickPressThreshold: 0.35 })).toEqual(['gamepad.stickReleaseThreshold: not under stickPressThreshold']);
  });

  it('refuses what is not a throw strictly between 0 and 1', () => {
    expect(findGamepadConfigErrors(null)).toEqual(['gamepad: not an object']);
    expect(findGamepadConfigErrors([])).toEqual(['gamepad: not an object']);
    expect(findGamepadConfigErrors({ stickPressThreshold: 0 })).toEqual(['gamepad.stickPressThreshold: not a number in (0, 1)']);
    expect(findGamepadConfigErrors({ stickPressThreshold: 1 })).toEqual(['gamepad.stickPressThreshold: not a number in (0, 1)']);
    expect(findGamepadConfigErrors({ stickPressThreshold: 1.2 })).toEqual(['gamepad.stickPressThreshold: not a number in (0, 1)']);
    expect(findGamepadConfigErrors({ stickPressThreshold: '0.5' })).toEqual(['gamepad.stickPressThreshold: not a number in (0, 1)']);
    expect(findGamepadConfigErrors({ stickReleaseThreshold: -0.1 })).toEqual(['gamepad.stickReleaseThreshold: not a number in (0, 1)']);
    expect(findGamepadConfigErrors({ stickReleaseThreshold: Number.NaN })).toEqual(['gamepad.stickReleaseThreshold: not a number in (0, 1)']);
  });
});

describe('padKeysCancelWalk: pad keys take the move from a tapped path', () => {
  it('on the CCLP engine, for any key', () => {
    const cclp = new CclpEngine(SILENT);
    cclp.loadLevel(lynxLevel(['###', '#@#', '###']));
    expect(padKeysCancelWalk(cclp, ['E'])).toBe(true);
    expect(padKeysCancelWalk(cclp, ['E', 'S'])).toBe(true);
    expect(padKeysCancelWalk(cclp, [])).toBe(false);
  });

  it('on a CC2-engine level that lets a tap plan a path', () => {
    const level = room({ mode: 'cc2' });
    expect(featuresFor(level).tapToPath).toBe(true);
    const engine = new GameEngine();
    engine.loadLevel(level);
    expect(padKeysCancelWalk(engine, ['E', 'S'])).toBe(true);
    expect(padKeysCancelWalk(engine, [])).toBe(false);
  });

  it('not on a CC2-engine level where a tap plans no path', () => {
    const level = room({ mode: 'cc2', entities: [{ type: 'turret_fixed', x: 8, y: 8, dir: 'N' }] });
    const engine = new GameEngine();
    engine.loadLevel(level);
    expect(engine.readsHeldKeyPairs()).toBe(true);
    expect(featuresFor(level).tapToPath).toBe(false);
    expect(padKeysCancelWalk(engine, ['E'])).toBe(false);
  });

  it('not on an engine that reads one key', () => {
    const lynx = new LynxEngine(SILENT);
    lynx.loadLevel(lynxLevel(['###', '#@#', '###']));
    expect(padKeysCancelWalk(lynx, ['E'])).toBe(false);
    const native = new GameEngine();
    native.loadLevel(room({ mode: 'native' }));
    expect(padKeysCancelWalk(native, ['E'])).toBe(false);
  });
});
