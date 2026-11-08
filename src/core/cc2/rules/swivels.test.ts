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

vi.mock('../../../audio/AudioManager', () => ({
  AudioManager: { playSfx: vi.fn() }
}));

import { loadTestConfigs } from '../../../test/loadTestConfigs';
import { lynxLevel } from '../../lynx/lynxTestMaps';
import { LynxRig } from '../../lynx/lynxTestRig';
import { Direction } from '../../types';
import { swivelRules } from './swivels';

beforeAll(() => {
  loadTestConfigs();
});

const STEP_TICKS = 4;
const NE = 'swivel_door_cc2_ne';

/** A door in the middle of a 3 by 3 room, Chip beside or on it. */
function rig(door: string, chip: 'door' | Direction): LynxRig {
  const rows = ['#####', '#...#', '#.D.#', '#...#', '#####'];
  const at: Record<Direction | 'door', [number, number]> = { door: [2, 2], N: [2, 1], E: [3, 2], S: [2, 3], W: [1, 2] };
  const [x, y] = at[chip];
  const marked = rows.map((row, ry) => (ry === y ? row.slice(0, x) + '@' + row.slice(x + 1) : row));
  const level = lynxLevel(marked.map((r) => r.replace('D', '.')), { glyphs: {} });
  level.terrain[2][2] = door;
  return new LynxRig(level, { modules: [swivelRules] });
}

function walk(r: LynxRig, dir: Direction): void {
  r.hold(dir);
  r.tick(STEP_TICKS);
  r.release();
}

describe('CC2 swivel doors', () => {
  it('plays all four doors', () => {
    expect(rig(NE, 'door').engine.getUnsupportedTiles()).toEqual([]);
  });

  it('refuses a step in through a closed side and allows one through an open side', () => {
    const fromNorth = rig(NE, 'N');
    walk(fromNorth, 'S');
    expect(fromNorth.player.y).toBe(1);
    const fromSouth = rig(NE, 'S');
    walk(fromSouth, 'N');
    expect(fromSouth.player.y).toBe(2);
  });

  it('turns clockwise when Chip leaves through a closed side next to another closed side', () => {
    const r = rig(NE, 'door');
    walk(r, 'N');
    expect(r.player.y).toBe(1);
    expect(r.engine.getTerrain()[2][2]).toBe('swivel_door_cc2_se');
  });

  it('turns counter-clockwise when the side clockwise of the exit is open', () => {
    const r = rig(NE, 'door');
    walk(r, 'E');
    expect(r.player.x).toBe(3);
    expect(r.engine.getTerrain()[2][2]).toBe('swivel_door_cc2_nw');
  });

  it('stays put when Chip leaves through an open side', () => {
    const r = rig(NE, 'door');
    walk(r, 'S');
    expect(r.engine.getTerrain()[2][2]).toBe(NE);
  });
});
