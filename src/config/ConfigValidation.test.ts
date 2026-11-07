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

import { beforeEach, describe, expect, it } from 'vitest';
import {
  findEyeBootsConfigErrors,
  findPullBootsConfigErrors,
  findSignalConfigErrors,
  findTouchConfigErrors,
  isCompiledLevelShape,
  isRuleset,
  LevelSizeBounds,
  normalizeCellEdges,
  normalizeUnderlays,
  sanitizeStoredLevels
} from './ConfigValidation';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { ConfigRegistry } from './ConfigRegistry';
import type { Cc3dCell, Cc3dLevel } from '../core/cc3d/model';
import type { TileDefinition } from '../core/types';

const BOUNDS: LevelSizeBounds = { minSize: 3, maxSize: 32 };
const SIZE = 4;

function cc3dLevel(overrides: Partial<Record<keyof Cc3dLevel, unknown>> = {}): Record<string, unknown> {
  const cell = (): Cc3dCell => ({ terrain: [{ kind: 'floor' }], panels: [], item: null });
  return {
    width: SIZE,
    height: SIZE,
    cells: Array.from({ length: SIZE * SIZE }, cell),
    mobs: [],
    player: { x: 1, y: 2 },
    ...overrides
  };
}

function level(cc3d?: unknown, ruleset: string | null = 'cc3d'): Record<string, unknown> {
  const grid = <T>(v: T): T[][] => Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => v));
  return {
    id: 'c1',
    number: 1,
    ...(ruleset === null ? {} : { ruleset }),
    password: 'AAAA',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    playerStart: { x: 1, y: 2, dir: 'S' },
    terrain: grid('floor'),
    items: grid(null),
    entities: [],
    trapLinks: [],
    cloneLinks: [],
    ...(cc3d === undefined ? {} : { cc3d })
  };
}

describe('cc3d ruleset in config validation', () => {
  it('knows the cc3d ruleset', () => {
    expect(isRuleset('cc3d')).toBe(true);
    expect(isRuleset('other')).toBe(false);
  });

  it('accepts a cc3d level with a well-formed cc3d field, and other levels without one', () => {
    expect(isCompiledLevelShape(level(cc3dLevel()), BOUNDS)).toBe(true);
    for (const ruleset of [null, 'epoxy', 'lynx']) {
      expect(isCompiledLevelShape(level(undefined, ruleset), BOUNDS), String(ruleset)).toBe(true);
    }
  });

  it('refuses a cc3d level without its cc3d field', () => {
    expect(isCompiledLevelShape(level(), BOUNDS)).toBe(false);
    expect(sanitizeStoredLevels([level()], BOUNDS)).toEqual([]);
  });

  it('refuses a cc3d field on a level of another ruleset', () => {
    for (const ruleset of [null, 'epoxy', 'lynx']) {
      expect(isCompiledLevelShape(level(cc3dLevel(), ruleset), BOUNDS), String(ruleset)).toBe(false);
    }
  });

  it('keeps the ruleset of a stored cc3d level', () => {
    const [kept] = sanitizeStoredLevels([level(cc3dLevel())], BOUNDS);
    expect(kept.ruleset).toBe('cc3d');
    expect(kept.cc3d?.width).toBe(SIZE);
  });

  it('accepts mobs inside the grid and a player direction', () => {
    const ok = cc3dLevel({ mobs: [{ kind: 'walker', x: 3, y: 3, dir: 'N' }], player: { x: 1, y: 2, dir: 'E' } });
    expect(isCompiledLevelShape(level(ok), BOUNDS)).toBe(true);
  });

  it.each([
    ['not an object', 'x'],
    ['zero width', cc3dLevel({ width: 0 })],
    ['fractional height', cc3dLevel({ height: 2.5 })],
    ['oversized width', cc3dLevel({ width: 99 })],
    ['cells of the wrong length', cc3dLevel({ cells: [] })],
    ['a cell with an empty terrain stack', cc3dLevel({ cells: Array.from({ length: SIZE * SIZE }, () => ({ terrain: [], panels: [], item: null })) })],
    ['a cell without panels', cc3dLevel({ cells: Array.from({ length: SIZE * SIZE }, () => ({ terrain: [{ kind: 'floor' }], item: null })) })],
    ['a cell with an undefined item', cc3dLevel({ cells: Array.from({ length: SIZE * SIZE }, () => ({ terrain: [{ kind: 'floor' }], panels: [] })) })],
    ['mobs not an array', cc3dLevel({ mobs: null })],
    ['player outside the grid', cc3dLevel({ player: { x: SIZE, y: 0 } })],
    ['player with fractional coordinates', cc3dLevel({ player: { x: 0.5, y: 0 } })],
    ['no player', cc3dLevel({ player: undefined })],
    ['a mob outside the grid', cc3dLevel({ mobs: [{ kind: 'walker', x: SIZE, y: 0, dir: 'N' }] })],
    ['a mob that is not an object', cc3dLevel({ mobs: [null] })],
    ['a player direction that is not one', cc3dLevel({ player: { x: 1, y: 2, dir: 'Q' } })]
  ])('rejects a level whose cc3d field has %s', (_name, bad) => {
    expect(isCompiledLevelShape(level(bad), BOUNDS)).toBe(false);
  });
});

describe('cell edges in config validation', () => {
  const edged = (cellEdges: unknown, ruleset: string | null = 'epoxy'): Record<string, unknown> => ({
    ...level(undefined, ruleset),
    cellEdges
  });
  const keptEdges = (value: Record<string, unknown>) => sanitizeStoredLevels([value], BOUNDS)[0].cellEdges;

  it('keeps well-formed edges untouched, as the same list', () => {
    const edges = [
      { x: 1, y: 0, sides: ['N', 'W'] },
      { x: 2, y: 2, sides: ['E'] }
    ];
    expect(keptEdges(edged(edges))).toBe(edges);
  });

  it('sorts, merges and trims edges into canonical form', () => {
    const messy = [
      { x: 2, y: 2, sides: ['W', 'E', 'E'] },
      { x: 1, y: 0, sides: ['S'] },
      { x: 1, y: 0, sides: ['N'] },
      { x: 3, y: 3, sides: [] },
      { x: 9, y: 0, sides: ['N'] },
      { x: 0, y: 1, sides: ['X'] },
      null,
      { x: 0, y: 0, sides: 'N' }
    ];
    expect(keptEdges(edged(messy))).toEqual([
      { x: 1, y: 0, sides: ['N', 'S'] },
      { x: 2, y: 2, sides: ['E', 'W'] }
    ]);
  });

  it('drops edges that are not a usable list, and edges of a ruleset that has none', () => {
    expect(keptEdges(edged('N'))).toBeUndefined();
    expect(keptEdges(edged([{ x: 1, y: 1, sides: [] }]))).toBeUndefined();
    expect(keptEdges(edged([{ x: 1, y: 1, sides: ['N'] }], 'lynx'))).toBeUndefined();
  });

  it('refuses a strict level with more edge entries than cells, and keeps a plain level without edges as it is', () => {
    const tooMany = Array.from({ length: SIZE * SIZE + 1 }, () => ({ x: 0, y: 0, sides: ['N'] }));
    expect(isCompiledLevelShape(edged(tooMany), BOUNDS, true)).toBe(false);
    expect(isCompiledLevelShape(edged(tooMany), BOUNDS, false)).toBe(true);
    const plain = level(undefined, 'epoxy');
    expect(sanitizeStoredLevels([plain], BOUNDS)[0]).toBe(plain);
  });

  it('normalises to null when nothing is left', () => {
    expect(normalizeCellEdges([], level().terrain as string[][], 'epoxy')).toBeNull();
  });
});

describe('underlays in config validation', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  const hidden = (underlays: unknown, ruleset: string | null = 'epoxy'): Record<string, unknown> => {
    const value = level(undefined, ruleset);
    (value.terrain as string[][])[1][1] = 'door_red';
    (value.terrain as string[][])[2][2] = 'socket';
    return { ...value, underlays };
  };
  const keptUnderlays = (value: Record<string, unknown>) => sanitizeStoredLevels([value], BOUNDS)[0].underlays;

  it('keeps well-formed underlays untouched, as the same list', () => {
    const list = [
      { x: 1, y: 1, terrain: 'ice' },
      { x: 2, y: 2, terrain: 'water' }
    ];
    expect(keptUnderlays(hidden(list))).toBe(list);
  });

  it('sorts, keeps the first entry of a cell and drops what cannot be an underlay', () => {
    const messy = [
      { x: 2, y: 2, terrain: 'water' },
      { x: 1, y: 1, terrain: 'ice' },
      { x: 1, y: 1, terrain: 'wall' },
      { x: 3, y: 3, terrain: 'door_blue' },
      { x: 3, y: 0, terrain: 'dirt' },
      { x: 0, y: 3, terrain: 'chip' },
      { x: 0, y: 0, terrain: 'no_such_tile' },
      { x: 9, y: 0, terrain: 'ice' },
      { x: 0, y: 1, terrain: 7 },
      null
    ];
    expect(keptUnderlays(hidden(messy))).toEqual([
      { x: 1, y: 1, terrain: 'ice' },
      { x: 2, y: 2, terrain: 'water' }
    ]);
  });

  it('drops underlays that are not a usable list, and those of a ruleset that has none', () => {
    expect(keptUnderlays(hidden('ice'))).toBeUndefined();
    expect(keptUnderlays(hidden([{ x: 1, y: 1, terrain: 'door_red' }]))).toBeUndefined();
    expect(keptUnderlays(hidden([{ x: 1, y: 1, terrain: 'ice' }], 'lynx'))).toBeUndefined();
    expect(normalizeUnderlays([{ x: 1, y: 1, terrain: 'ice' }], level().terrain as string[][], 'cc3d')).toBeNull();
  });

  it('refuses a strict level with more underlay entries than cells, and keeps a plain level as it is', () => {
    const tooMany = Array.from({ length: SIZE * SIZE + 1 }, () => ({ x: 1, y: 1, terrain: 'ice' }));
    expect(isCompiledLevelShape(hidden(tooMany), BOUNDS, true)).toBe(false);
    expect(isCompiledLevelShape(hidden(tooMany), BOUNDS, false)).toBe(true);
    const plain = level(undefined, 'epoxy');
    expect(sanitizeStoredLevels([plain], BOUNDS)[0]).toBe(plain);
  });

  it('drops an underlay that could reveal a second time, sits under a non-removable top or is a live device', () => {
    const grid = (top: string): string[][] => {
      const rows = level().terrain as string[][];
      rows[1][1] = top;
      return rows;
    };
    const under = (id: string) => [{ x: 1, y: 1, terrain: id }];
    // Dirt over water: a block sunk in the water makes dirt again, which would reveal the water twice.
    expect(normalizeUnderlays(under('water'), grid('dirt'), 'epoxy')).toBeNull();
    expect(normalizeUnderlays(under('ice'), grid('dirt'), 'epoxy')).toEqual(under('ice'));
    // Ice under a wall: a wall is no removable top.
    expect(normalizeUnderlays(under('ice'), grid('wall'), 'epoxy')).toBeNull();
    // Plates, hold doors and toggle walls keep run-time state: refused under a top that is not a door or a socket.
    for (const id of ['pressure_plate_red', 'hold_door_red_closed', 'toggle_wall_closed']) {
      expect(normalizeUnderlays(under(id), grid('dirt'), 'epoxy')).toBeNull();
      expect(normalizeUnderlays(under(id), grid('blue_wall_fake'), 'epoxy')).toBeNull();
    }
  });

  it('keeps sockets, dirt, blue fake walls and live devices only under a door or a socket', () => {
    const grid = (top: string): string[][] => {
      const rows = level().terrain as string[][];
      rows[1][1] = top;
      return rows;
    };
    const under = (id: string) => [{ x: 1, y: 1, terrain: id }];
    const widened = [
      'socket', 'dirt', 'blue_wall_fake', 'toggle_wall_closed', 'toggle_wall_open', 'toggle_wall_red_closed',
      'toggle_wall_blue_open', 'toggle_wall_yellow_closed', 'hold_door_red_closed', 'hold_door_blue_open',
      'pressure_plate_red', 'pressure_plate_green'
    ];
    for (const top of ['door_red', 'door_blue', 'socket']) {
      for (const id of widened) {
        const expected = id === top ? null : under(id);
        expect(normalizeUnderlays(under(id), grid(top), 'epoxy'), `${id} under ${top}`).toEqual(expected);
      }
    }
    // Never a key door, whatever the top.
    for (const top of ['door_red', 'socket']) {
      expect(normalizeUnderlays(under('door_blue'), grid(top), 'epoxy')).toBeNull();
      expect(normalizeUnderlays(under('door_red'), grid(top), 'epoxy')).toBeNull();
    }
    // Other tops (dirt, a blue fake wall, plain ground) accept none of the new kinds.
    for (const top of ['dirt', 'blue_wall_fake', 'floor', 'wall']) {
      for (const id of widened) {
        expect(normalizeUnderlays(under(id), grid(top), 'epoxy'), `${id} under ${top}`).toBeNull();
      }
    }
  });

  it('still keeps every static underlay it kept before the widening', () => {
    const grid = (top: string): string[][] => {
      const rows = level().terrain as string[][];
      rows[1][1] = top;
      return rows;
    };
    const under = (id: string) => [{ x: 1, y: 1, terrain: id }];
    const statics = ['ice', 'wall', 'exit', 'floor', 'teleport', 'button_green', 'recessed_wall', 'appearing_wall', 'trap'];
    for (const top of ['door_red', 'socket', 'dirt', 'blue_wall_fake']) {
      for (const id of statics) {
        expect(normalizeUnderlays(under(id), grid(top), 'epoxy'), `${id} under ${top}`).toEqual(under(id));
      }
    }
    expect(normalizeUnderlays(under('ice'), grid('dirt'), 'epoxy')).toEqual(under('ice'));
  });

  it('normalises to null when nothing is left', () => {
    expect(normalizeUnderlays([], level().terrain as string[][], 'epoxy')).toBeNull();
    expect(normalizeUnderlays([{ x: 0, y: 0, terrain: 'door_red' }], level().terrain as string[][], 'epoxy')).toBeNull();
  });
});

describe('findPullBootsConfigErrors', () => {
  beforeEach(() => loadTestConfigs());

  it('accepts the shipped pull boots', () => {
    const tiles = structuredClone(ConfigRegistry.getTiles().tiles);
    expect(tiles.boots_pull.pullsBlocks).toBe(true);
    expect(findPullBootsConfigErrors(tiles)).toEqual([]);
  });

  it('refuses a value other than true, and a carrier that is not a boot', () => {
    const tiles = structuredClone(ConfigRegistry.getTiles().tiles);
    const falsy = { ...tiles, boots_pull: { ...tiles.boots_pull, pullsBlocks: false } };
    expect(findPullBootsConfigErrors(falsy)).toHaveLength(1);
    const notBoot = { ...tiles.score_10, pullsBlocks: true };
    expect(findPullBootsConfigErrors({ ...tiles, score_10: notBoot })).toHaveLength(1);
  });
});

describe('findEyeBootsConfigErrors', () => {
  beforeEach(() => loadTestConfigs());

  it('accepts the shipped eye boots', () => {
    const tiles = structuredClone(ConfigRegistry.getTiles().tiles);
    expect(tiles.boots_eye.revealsHiddenWalls).toBe(true);
    expect(findEyeBootsConfigErrors(tiles)).toEqual([]);
  });

  it('refuses a value other than true, and a carrier that is not a boot', () => {
    const tiles = structuredClone(ConfigRegistry.getTiles().tiles);
    const falsy = { ...tiles, boots_eye: { ...tiles.boots_eye, revealsHiddenWalls: false } };
    expect(findEyeBootsConfigErrors(falsy)).toHaveLength(1);
    const notBoot = { ...tiles.score_10, revealsHiddenWalls: true };
    expect(findEyeBootsConfigErrors({ ...tiles, score_10: notBoot })).toHaveLength(1);
  });
});

describe('findSignalConfigErrors', () => {
  beforeEach(() => loadTestConfigs());

  const shipped = (): Record<string, TileDefinition> => structuredClone(ConfigRegistry.getTiles().tiles);
  const withTile = (id: string, fields: Partial<TileDefinition>): Record<string, TileDefinition> => {
    const tiles = shipped();
    return { ...tiles, [id]: { ...tiles[id], ...fields } };
  };

  it('accepts the shipped signal tiles', () => {
    const tiles = shipped();
    expect(tiles.signal_plate.signalSource).toBe('held');
    expect(tiles.signal_latch_on.signalLatchStartsOn).toBe(true);
    expect(findSignalConfigErrors(tiles)).toEqual([]);
  });

  it('accepts a pulse source, and the shipped signal button is one', () => {
    expect(shipped().signal_button.signalSource).toBe('pulse');
    expect(findSignalConfigErrors(withTile('signal_plate', { signalSource: 'pulse' }))).toEqual([]);
  });

  it('refuses a source other than held or pulse and a gate that is not one of the five', () => {
    expect(findSignalConfigErrors(withTile('signal_plate', { signalSource: 'toggle' as 'held' }))).toHaveLength(1);
    expect(findSignalConfigErrors(withTile('signal_gate_and', { signalGate: 'nand' as 'and' })).join()).toContain('signalGate');
  });

  it('refuses a latch start flag that is not true or not on a latch', () => {
    expect(findSignalConfigErrors(withTile('signal_latch_on', { signalLatchStartsOn: false as true })).join()).toContain(
      'expected true'
    );
    expect(findSignalConfigErrors(withTile('signal_gate_and', { signalLatchStartsOn: true })).join()).toContain('latch gate');
  });

  it('refuses a signal tile outside the terrain layer', () => {
    expect(findSignalConfigErrors(withTile('signal_plate', { layer: 'item' })).join()).toContain('terrain tile');
  });

  it('refuses a tile with two signal roles or a colour role beside its signal role', () => {
    expect(findSignalConfigErrors(withTile('signal_plate', { signalGate: 'or' })).join()).toContain('both');
    expect(findSignalConfigErrors(withTile('signal_plate', { plateColor: 'red' })).join()).toContain('plate, a hold door');
    expect(findSignalConfigErrors(withTile('signal_gate_or', { holdDoorColor: 'red' })).join()).toContain('plate, a hold door');
    expect(findSignalConfigErrors(withTile('signal_gate_or', { laserReceiverGroup: 'red' })).join()).toContain('plate, a hold door');
  });

  it('refuses a gate that something can walk onto', () => {
    expect(findSignalConfigErrors(withTile('signal_gate_xor', { passableByPlayer: true })).join()).toContain('impassable');
    expect(findSignalConfigErrors(withTile('signal_gate_xor', { passableByBlock: true })).join()).toContain('impassable');
  });
});

describe('findTouchConfigErrors', () => {
  it('accepts the shipped touch section and a missing one', () => {
    loadTestConfigs();
    expect(findTouchConfigErrors(ConfigRegistry.getGame().touch)).toEqual([]);
    expect(findTouchConfigErrors(undefined)).toEqual([]);
  });

  it('accepts a section holding only the older keys', () => {
    expect(findTouchConfigErrors({ swipeDeadzonePx: 20, tapMaxDistancePx: 14, tapMaxDurationMs: 280, hapticPulseMs: 10 })).toEqual([]);
  });

  it('refuses a section that is not an object', () => {
    expect(findTouchConfigErrors(null)).toEqual(['touch: not an object']);
    expect(findTouchConfigErrors([])).toEqual(['touch: not an object']);
  });

  it('refuses negative, non-finite and non-numeric lengths', () => {
    expect(findTouchConfigErrors({ joystickDeadZonePx: -1 })).toEqual(['touch.joystickDeadZonePx: not a non-negative number']);
    expect(findTouchConfigErrors({ swipeDeadzonePx: Number.NaN })).toEqual(['touch.swipeDeadzonePx: not a non-negative number']);
    expect(findTouchConfigErrors({ hapticPulseMs: '10' })).toEqual(['touch.hapticPulseMs: not a non-negative number']);
  });

  it('refuses an axis switch ratio under 1', () => {
    expect(findTouchConfigErrors({ joystickAxisSwitchRatio: 0.9 })).toHaveLength(1);
    expect(findTouchConfigErrors({ joystickAxisSwitchRatio: 1 })).toEqual([]);
  });

  it('refuses a release radius larger than the dead zone', () => {
    expect(findTouchConfigErrors({ joystickDeadZonePx: 14, joystickReleaseRadiusPx: 15 })).toEqual([
      'touch.joystickReleaseRadiusPx: larger than joystickDeadZonePx'
    ]);
    expect(findTouchConfigErrors({ joystickDeadZonePx: 14, joystickReleaseRadiusPx: 14 })).toEqual([]);
  });
});
