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

// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import type { Direction } from '../core/types';
import { FloatingJoystick, joystickOptionsFromTouchConfig } from './joystick';

function pointer(type: string, target: Element, id: number, x: number, y: number): void {
  target.dispatchEvent(
    new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: id, pointerType: 'touch', clientX: x, clientY: y })
  );
}

interface Rig {
  zone: HTMLElement;
  directions: Array<Direction | null>;
  keys: Direction[][];
  engages: Direction[];
  pairs: { value: boolean };
}

interface SetupOptions {
  withOnKeys?: boolean;
  touch?: Parameters<typeof joystickOptionsFromTouchConfig>[0];
}

function setup(pairs: boolean, { withOnKeys = true, touch }: SetupOptions = {}): Rig {
  document.body.innerHTML = '<div id="zone"></div>';
  const zone = document.getElementById('zone') as HTMLElement;
  const rig: Rig = { zone, directions: [], keys: [], engages: [], pairs: { value: pairs } };
  new FloatingJoystick(zone, joystickOptionsFromTouchConfig(touch), {
    onDirection: (dir) => rig.directions.push(dir),
    onTap: () => undefined,
    onEngage: (dir) => rig.engages.push(dir),
    readsKeyPairs: () => rig.pairs.value,
    ...(withOnKeys ? { onKeys: (keys: Direction[]) => rig.keys.push(keys) } : {})
  });
  return rig;
}

/** One gesture: east, then south-east, then south, then lift. Finger offsets stay inside the 24 px base follow. */
function eastSouthEastSouth(zone: HTMLElement): void {
  pointer('pointerdown', zone, 1, 100, 100);
  pointer('pointermove', zone, 1, 120, 100);
  pointer('pointermove', zone, 1, 116, 113);
  pointer('pointermove', zone, 1, 100, 120);
  pointer('pointerup', zone, 1, 100, 120);
}

describe('FloatingJoystick on an engine that reads two held keys', () => {
  it('reports the keys of each change, a diagonal as two keys, and the release; never a single direction', () => {
    const rig = setup(true);
    eastSouthEastSouth(rig.zone);
    expect(rig.keys).toEqual([['E'], ['E', 'S'], ['S'], []]);
    expect(rig.directions).toEqual([]);
    expect(rig.engages).toEqual(['E']);
  });

  it('a gesture keeps the mode it started with, even if the engine changes under the finger', () => {
    const rig = setup(true);
    pointer('pointerdown', rig.zone, 1, 100, 100);
    pointer('pointermove', rig.zone, 1, 120, 100);
    rig.pairs.value = false;
    pointer('pointermove', rig.zone, 1, 116, 113);
    pointer('pointerup', rig.zone, 1, 116, 113);
    expect(rig.keys).toEqual([['E'], ['E', 'S'], []]);
    expect(rig.directions).toEqual([]);
  });
});

describe('FloatingJoystick on an engine that reads one key: unchanged', () => {
  it('the same gesture reports single directions only (east, south at the axis switch, release)', () => {
    const rig = setup(false);
    eastSouthEastSouth(rig.zone);
    expect(rig.directions).toEqual(['E', 'S', null]);
    expect(rig.keys).toEqual([]);
  });

  it('without an onKeys callback the joystick never reads pairs', () => {
    const rig = setup(true, { withOnKeys: false });
    eastSouthEastSouth(rig.zone);
    expect(rig.directions).toEqual(['E', 'S', null]);
  });
});

describe('joystickDiagonals switched off in game.json', () => {
  it('gives today\'s single directions even on an engine that reads two keys', () => {
    const rig = setup(true, { touch: { joystickDiagonals: false } });
    eastSouthEastSouth(rig.zone);
    expect(rig.directions).toEqual(['E', 'S', null]);
    expect(rig.keys).toEqual([]);
  });

  it('reads the setting when the joystick is built, and a later joystick with the default reads pairs again', () => {
    const off = setup(true, { touch: { joystickDiagonals: false } });
    eastSouthEastSouth(off.zone);
    const on = setup(true);
    eastSouthEastSouth(on.zone);
    expect(on.keys).toEqual([['E'], ['E', 'S'], ['S'], []]);
  });
});
