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
import { nearestMachine } from './cc3dDevices';
import { nearestShooter } from './cc3dLasers';
import { cc3dLinks, holdDoorWanted, nearestPoint, NO_LINK, teleportCandidatesBefore, trapTargets } from './cc3dLinks';
import { buildWorld } from './cc3dWorld';
import type { Cc3dCell, Cc3dLevel, Cc3dMob, Cc3dTerrain } from './model';

const WIDTH = 6;
const HEIGHT = 3;

function levelWith(put: Record<string, Cc3dTerrain[]>, mobs: Cc3dMob[] = []): Cc3dLevel {
  const cells: Cc3dCell[] = Array.from({ length: WIDTH * HEIGHT }, () => ({ terrain: [{ kind: 'floor' }], panels: [], item: null }));
  for (const [key, layers] of Object.entries(put)) {
    const [x, y] = key.split(',').map(Number);
    cells[y * WIDTH + x].terrain = [{ kind: 'floor' }, ...layers];
  }
  return { width: WIDTH, height: HEIGHT, cells, mobs, player: { x: 0, y: 0 } };
}

const at = (x: number, y: number): number => y * WIDTH + x;

describe('link primitives', () => {
  it('works the next trap in reading order and wraps', () => {
    expect(trapTargets([5, 20], [3, 10, 25])).toEqual([10, 25]);
    expect(trapTargets([30], [3, 10])).toEqual([3]);
    expect(trapTargets([4], [])).toEqual([NO_LINK]);
  });

  it('lists teleport candidates previous first, wrapping', () => {
    expect(teleportCandidatesBefore([2, 5, 9], 5)).toEqual([2, 9]);
    expect(teleportCandidatesBefore([2, 5, 9], 2)).toEqual([9, 5]);
    expect(teleportCandidatesBefore([2, 5, 9], 9)).toEqual([5, 2]);
    expect(teleportCandidatesBefore([2, 5], 7)).toEqual([5, 2]);
    expect(teleportCandidatesBefore([4], 4)).toEqual([]);
  });

  it('picks the nearest point and breaks a tie in reading order', () => {
    const items = [
      { x: 4, y: 0 },
      { x: 0, y: 2 },
      { x: 2, y: 0 }
    ];
    expect(nearestPoint(items, { x: 0, y: 1 }, WIDTH)).toEqual({ x: 0, y: 2 });
    // Two points at distance 1 from (3, 0): the one first in reading order wins, whatever the list order.
    expect(nearestPoint(items, { x: 3, y: 0 }, WIDTH)).toEqual({ x: 2, y: 0 });
    expect(nearestPoint([{ x: 2, y: 1 }, { x: 1, y: 0 }], { x: 1, y: 1 }, WIDTH)).toEqual({ x: 1, y: 0 });
    expect(nearestPoint([], { x: 0, y: 0 }, WIDTH)).toBeNull();
  });

  it('opens a hold door only when every plate is pressed', () => {
    expect(holdDoorWanted(0, 0)).toBe(false);
    expect(holdDoorWanted(2, 1)).toBe(false);
    expect(holdDoorWanted(2, 2)).toBe(true);
  });
});

describe('cc3dLinks', () => {
  it('links a trap control to the next trap after it, wrapping', () => {
    const level = levelWith({
      '1,0': [{ kind: 'trap' }],
      '3,0': [{ kind: 'trap_control' }],
      '5,1': [{ kind: 'trap_control' }]
    });
    expect(cc3dLinks(level).trapControls).toEqual([
      { from: at(3, 0), to: at(1, 0) },
      { from: at(5, 1), to: at(1, 0) }
    ]);
  });

  it('gives a trap control without a trap no target', () => {
    expect(cc3dLinks(levelWith({ '1,0': [{ kind: 'trap_control' }] })).trapControls).toEqual([{ from: 1, to: null }]);
  });

  it('links a teleport to its predecessor of the same colour only', () => {
    const level = levelWith({});
    level.cells[at(2, 0)].terrain = [{ kind: 'teleport_blue' }];
    level.cells[at(4, 1)].terrain = [{ kind: 'teleport_blue' }];
    level.cells[at(1, 2)].terrain = [{ kind: 'teleport_blue' }];
    level.cells[at(3, 2)].terrain = [{ kind: 'teleport_red' }];
    const { teleports } = cc3dLinks(level);
    expect(teleports).toEqual([
      { from: at(2, 0), to: at(1, 2) },
      { from: at(4, 1), to: at(2, 0) },
      { from: at(1, 2), to: at(4, 1) },
      { from: at(3, 2), to: null }
    ].sort((a, b) => a.from - b.from));
  });

  it('ignores a teleport that something covers (the engine does)', () => {
    const level = levelWith({});
    level.cells[at(1, 0)].terrain = [{ kind: 'teleport_red' }, { kind: 'wall' }];
    level.cells[at(2, 0)].terrain = [{ kind: 'teleport_red' }];
    expect(cc3dLinks(level).teleports).toEqual([{ from: at(2, 0), to: null }]);
  });

  it('links a clone switch to the nearest machine, ties in reading order', () => {
    const level = levelWith({
      '0,0': [{ kind: 'clone_machine', dir: 'E' }],
      '4,0': [{ kind: 'clone_machine', dir: 'E' }],
      '2,2': [{ kind: 'clone_switch' }],
      '5,2': [{ kind: 'clone_switch' }]
    });
    const { cloneSwitches } = cc3dLinks(level);
    expect(cloneSwitches).toEqual([
      { from: at(2, 2), to: at(0, 0) },
      { from: at(5, 2), to: at(4, 0) }
    ]);
    const world = buildWorld(level, 1);
    expect(nearestMachine(world, { x: 2, y: 2 })).toBe(at(0, 0));
    expect(nearestMachine(world, { x: 5, y: 2 })).toBe(at(4, 0));
  });

  it('gives a clone switch without a machine no target', () => {
    expect(cc3dLinks(levelWith({ '2,2': [{ kind: 'clone_switch' }] })).cloneSwitches).toEqual([{ from: at(2, 2), to: null }]);
  });

  it('links a clone machine to the template mob standing on it', () => {
    const level = levelWith(
      { '1,1': [{ kind: 'clone_machine', dir: 'S' }], '3,1': [{ kind: 'clone_machine', dir: 'S' }] },
      [
        { kind: 'walker', x: 0, y: 0, dir: 'N' },
        { kind: 'blinky', x: 3, y: 1, dir: 'N' }
      ]
    );
    expect(cc3dLinks(level).cloneMachines).toEqual([
      { from: at(1, 1), to: null },
      { from: at(3, 1), to: 1 }
    ]);
  });

  it('links a laser controller to the nearest shooter', () => {
    const level = levelWith({ '1,0': [{ kind: 'laser_controller' }], '5,2': [{ kind: 'laser_controller' }] }, [
      { kind: 'walker', x: 2, y: 0, dir: 'N' },
      { kind: 'laser_shooter', x: 0, y: 2, dir: 'N' },
      { kind: 'laser_shooter', x: 4, y: 0, dir: 'N' }
    ]);
    expect(cc3dLinks(level).laserControllers).toEqual([
      { from: at(1, 0), to: 1 },
      { from: at(5, 2), to: 2 }
    ]);
    const world = buildWorld(level, 1);
    expect(nearestShooter(world, { x: 1, y: 0 })?.uid).toBe(2);
    expect(nearestShooter(world, { x: 5, y: 2 })?.uid).toBe(3);
  });

  it('gives a laser controller without a shooter no target', () => {
    expect(cc3dLinks(levelWith({ '1,0': [{ kind: 'laser_controller' }] })).laserControllers).toEqual([{ from: 1, to: null }]);
  });

  it('groups toggle controls and doors, and hold plates and doors, by colour', () => {
    const level = levelWith({
      '0,0': [{ kind: 'toggle_control', color: 'red' }],
      '1,0': [{ kind: 'toggle_door', color: 'red', open: true }],
      '2,0': [{ kind: 'toggle_door', color: 'green' }],
      '3,0': [{ kind: 'plate', color: 'blue' }],
      '4,0': [{ kind: 'plate', color: 'blue' }],
      '5,0': [{ kind: 'hold_door', color: 'blue' }],
      '0,1': [{ kind: 'hold_door', color: 'yellow' }]
    });
    const { toggles, holds } = cc3dLinks(level);
    expect(toggles.find((g) => g.color === 'red')).toEqual({ color: 'red', controls: [at(0, 0)], targets: [at(1, 0)] });
    expect(toggles.find((g) => g.color === 'green')).toEqual({ color: 'green', controls: [], targets: [at(2, 0)] });
    expect(holds.find((g) => g.color === 'blue')).toEqual({ color: 'blue', controls: [at(3, 0), at(4, 0)], targets: [at(5, 0)] });
    expect(holds.find((g) => g.color === 'yellow')).toEqual({ color: 'yellow', controls: [], targets: [at(0, 1)] });
  });

  it('groups golem controls with the golems of their colour', () => {
    const level = levelWith({ '0,0': [{ kind: 'golem_control_blue' }], '1,0': [{ kind: 'golem_control_yellow' }], '2,0': [{ kind: 'golem_control_yellow' }] }, [
      { kind: 'golem_yellow', x: 3, y: 1, dir: 'E' },
      { kind: 'golem_blue', x: 4, y: 1, dir: 'E' }
    ]);
    const { golems } = cc3dLinks(level);
    expect(golems.blue).toEqual({ color: 'blue', controls: [at(0, 0)], targets: [1] });
    expect(golems.yellow).toEqual({ color: 'yellow', controls: [at(1, 0), at(2, 0)], targets: [0] });
  });

  it('matches the trap targets the engine builds', () => {
    const level = levelWith({
      '1,0': [{ kind: 'trap' }],
      '4,1': [{ kind: 'trap' }],
      '2,1': [{ kind: 'trap_control' }],
      '5,2': [{ kind: 'trap_control' }]
    });
    const { devices } = buildWorld(level, 1);
    const fromLinks = cc3dLinks(level).trapControls.map((l) => l.to ?? NO_LINK);
    expect(fromLinks).toEqual(devices.trapTargets);
  });
});
