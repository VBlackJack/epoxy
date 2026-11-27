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
 * The pad modules are built before the configs are loaded (the page makes them while it starts): they read the gamepad
 * settings only when used, never in a field initializer or a constructor default. No config is loaded in this file.
 */

import { describe, expect, it } from 'vitest';
import { findGamepadConfigErrors } from '../config/ConfigValidation';
import { dpadKeys, gamepadConfigFrom, heldSetForTick, PadKeyOrder, padKeys, padSteer, singlePadDirection, stickKeys } from './padDirections';

describe('the pure pad modules (no page, no engine) without a loaded config', () => {
  it('build and run on the defaults', () => {
    expect(() => new PadKeyOrder()).not.toThrow();
    const config = gamepadConfigFrom(undefined);
    expect(config).toEqual({ stickPressThreshold: 0.5, stickReleaseThreshold: 0.35 });
    const pad = { axes: [0.9, 0.9], buttons: [] };
    expect(dpadKeys(pad)).toEqual([]);
    expect(stickKeys(0.9, 0.9, [], config)).toEqual(['E', 'S']);
    expect(padKeys(pad, [], config).keys).toEqual(['E', 'S']);
    expect(singlePadDirection(pad, config)).toBe('S');
    expect(padSteer({ keys: ['E', 'S'], added: true, keyboardDown: false, engineKind: 'hold' }).press).toEqual(['E', 'S']);
    expect(heldSetForTick([], null, ['E', 'S'], false)).toEqual(['E', 'S']);
  });

  it('the validator reads its defaults from the config layer, not from the UI constants', () => {
    expect(findGamepadConfigErrors(undefined)).toEqual([]);
    expect(findGamepadConfigErrors({ stickReleaseThreshold: 0.6 })).toEqual(['gamepad.stickReleaseThreshold: not under stickPressThreshold']);
  });
});
