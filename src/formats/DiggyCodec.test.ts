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

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../audio/AudioManager', () => import('../test/silentAudio'));

import { ConfigRegistry } from '../config/ConfigRegistry';
import { isCompiledLevelShape, sanitizeStoredLevels } from '../config/ConfigValidation';
import { GameEngine } from '../core/GameEngine';
import { LevelValidator } from '../core/LevelValidator';
import type { CompiledLevel, Direction } from '../core/types';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { decodeDiggyFiles, decodeDiggyJson, isDiggyFloorFileName, isDiggyJson } from './DiggyCodec';

function replaySolution(level: CompiledLevel): boolean {
  const engine = new GameEngine();
  engine.loadLevel(level);
  for (const ch of level.solution ?? '') {
    while (engine.getPlayer().moveCooldown > 0 && engine.getPlayer().alive && !engine.isLevelCompleted()) {
      engine.tick();
    }
    if (!engine.attemptPlayerMove(ch as Direction)) return false;
    if (engine.isLevelCompleted()) return true;
  }
  return engine.isLevelCompleted();
}

beforeEach(() => {
  loadTestConfigs();
});

describe('isDiggyFloorFileName and isDiggyJson', () => {
  it('recognises Diggy floor file names regardless of case', () => {
    expect(isDiggyFloorFileName('floors_4295.json')).toBe(true);
    expect(isDiggyFloorFileName('FLOORS_12.JSON')).toBe(true);
    expect(isDiggyFloorFileName('custom.diggy.json')).toBe(true);
    expect(isDiggyFloorFileName('pack.json')).toBe(false);
    expect(isDiggyFloorFileName('level.xml')).toBe(false);
  });

  it('distinguishes Diggy floor payloads from Epoxy packs and blueprints', () => {
    expect(isDiggyJson({ floor: [{ def_id: 1, rows: 5, columns: 5 }] })).toBe(true);
    expect(isDiggyJson({ floors: { def_id: 1, rows: 5, columns: 5 } })).toBe(true);
    expect(isDiggyJson({ location: { floor: { def_id: 1, rows: 5, columns: 5 } } })).toBe(true);
    expect(isDiggyJson({ floor_id: 100, rows: 5, columns: 5, blocked: '0_0' })).toBe(true);
    expect(isDiggyJson({ version: 1, name: 'Epoxy Pack', levels: [] })).toBe(false);
    expect(isDiggyJson({ id: 'lvl-1', number: 1, rows: ['###', '#@#', '###'] })).toBe(false);
    expect(isDiggyJson(null)).toBe(false);
    expect(isDiggyJson([])).toBe(false);
  });
});

describe('decodeDiggyJson', () => {
  it('ignores 0x0 default placeholder floors and decodes legacy blocked/background floors with push and lever puzzles', () => {
    const payload = {
      floor: [
        {
          def_id: 0,
          floor_id: 0,
          name: 'Default',
          rows: 0,
          columns: 0,
          blocked: {}
        },
        {
          def_id: 1,
          floor_id: 101,
          name: 'Synthetic Mine 1',
          rows: 7,
          columns: 9,
          bg_id: 5,
          backgrounds: {
            background: {
              id: 118,
              tiles:
                '1,1;1,2;1,3;1,4;1,5;1,6;1,7;' +
                '2,1;2,2;2,3;2,4;2,5;2,6;2,7;' +
                '3,1;3,2;3,3;3,4;3,5;3,6;3,7;' +
                '4,1;4,2;4,3;4,4;4,5;4,6;4,7;' +
                '5,1;5,2;5,3;5,4;5,5;5,6;5,7'
            }
          },
          blocked: '1_4;2_4;4_4;5_4',
          loot_areas: {
            loot_area: [
              { area_id: 1, type: 'token', min: 1, max: 1, tiles: '2,6;4,6' },
              { area_id: 2, type: 'material', min: 1, max: 1, tiles: '3,2;3,6' },
              { area_id: 3, type: 'system', min: 9999, max: 9999, tiles: '0,0' }
            ]
          },
          beacons: {
            beacon: [
              {
                beacon_id: 10,
                parts: { part: { part_id: 1, req_drag: 500, activation: 'push', gr_clip: 'farm_drag_place_x' } },
                actions: { action: { tiles: '2,2', layer: 'drag', values: 0 } }
              },
              {
                beacon_id: 11,
                parts: { part: { part_id: 1, req_drag: 0, activation: 'use', gr_clip: 'lever_wooden' } },
                actions: { action: { tiles: '3,4', layer: 'misc', values: 'B_12_1_1' } }
              }
            ]
          }
        }
      ]
    };

    const result = decodeDiggyJson(payload, 'synth');
    expect(result.skipped).toEqual([]);
    expect(result.levels).toHaveLength(1);

    const level = result.levels[0];
    expect(level.customTitle).toBe('Synthetic Mine 1');
    expect(level.chipsRequired).toBeGreaterThanOrEqual(2);
    expect(level.entities.some((e) => e.type === 'dirt_block')).toBe(true);
    expect(level.underlays).toEqual([{ x: level.underlays![0].x, y: level.underlays![0].y, terrain: 'exit' }]);

    const bounds = ConfigRegistry.getLevelSizeBounds();
    expect(isCompiledLevelShape(level, bounds)).toBe(true);
    expect(sanitizeStoredLevels(structuredClone([level]), bounds)).toEqual([level]);

    const validation = LevelValidator.validate(level);
    expect(validation.issues.filter((i) => i.severity === 'error' || i.severity === 'warning')).toEqual([]);
    expect(replaySolution(level)).toBe(true);
  });

  it('decodes transposed blocked_tiles (col,row) and links multi-island floors with teleporters', () => {
    const blockedColsRows: string[] = [];
    for (let c = 0; c < 12; c++) {
      for (let r = 0; r < 6; r++) {
        const inLeftRoom = c >= 1 && c <= 4 && r >= 1 && r <= 4;
        const inRightRoom = c >= 7 && c <= 10 && r >= 1 && r <= 4;
        if (!inLeftRoom && !inRightRoom) {
          blockedColsRows.push(`${c},${r}`);
        }
      }
    }

    const payload = {
      floor: {
        def_id: 2,
        floor_id: 202,
        name: 'Teleport Islands',
        rows: 6,
        columns: 12,
        underwater: 1,
        bg_id: 1,
        blocked_tiles: blockedColsRows.join(';'),
        loot_areas: {
          loot_area: { area_id: 1, type: 'token', min: 1, max: 1, tiles: '2,9' }
        },
        teleports: {
          teleport: [
            { teleport_id: 1, target_teleport_id: 2, beacon_id: 0 },
            { teleport_id: 2, target_teleport_id: 1, beacon_id: 0 }
          ]
        }
      }
    };

    const result = decodeDiggyJson(payload, 'islands');
    expect(result.skipped).toEqual([]);
    expect(result.levels).toHaveLength(1);

    const level = result.levels[0];
    expect(level.theme).toBe('arctic_lab');
    const flatTerrain = level.terrain.flat();
    expect(flatTerrain.filter((t) => t === 'teleport')).toHaveLength(2);

    const validation = LevelValidator.validate(level);
    expect(validation.issues.filter((i) => i.severity === 'error' || i.severity === 'warning')).toEqual([]);
    expect(replaySolution(level)).toBe(true);
  });

  it('decodes runtime MineData tiles when provided and omits underlays when chipsRequired is zero', () => {
    const payload = {
      floor_id: 303,
      name: 'Runtime Mine',
      rows: 5,
      columns: 5,
      bg_id: 1,
      tiles: [
        { row: 0, column: 0, type: 'wall' },
        { row: 0, column: 1, type: 'wall' },
        { row: 0, column: 2, type: 'wall' },
        { row: 0, column: 3, type: 'wall' },
        { row: 0, column: 4, type: 'wall' },
        { row: 4, column: 0, type: 'wall' },
        { row: 4, column: 1, type: 'wall' },
        { row: 4, column: 2, type: 'wall' },
        { row: 4, column: 3, type: 'wall' },
        { row: 4, column: 4, type: 'wall' }
      ]
    };

    const result = decodeDiggyJson(payload, 'runtime');
    expect(result.levels).toHaveLength(1);
    const level = result.levels[0];
    expect(level.theme).toBe('magma_core');
    expect(level.chipsRequired).toBe(0);
    expect('underlays' in level).toBe(false);
    expect(replaySolution(level)).toBe(true);
  });

  it('reports skipped floors when dimensions are out of bounds or open space is too small', () => {
    const payload = {
      floor: [
        { floor_id: 1, name: 'Oversized', rows: 500, columns: 10 },
        { floor_id: 2, name: 'Tiny Sealed', rows: 4, columns: 4, blocked: '0_0;0_1;0_2;0_3;1_0;1_1;1_2;1_3;2_0;2_1;2_2;2_3;3_0;3_1' }
      ]
    };

    const result = decodeDiggyJson(payload, 'invalid');
    expect(result.levels).toHaveLength(0);
    expect(result.skipped).toEqual([
      { floorId: 1, title: 'Oversized', reason: 'bad_size' },
      { floorId: 2, title: 'Tiny Sealed', reason: 'too_few_open_cells' }
    ]);
  });
});

describe('decodeDiggyFiles', () => {
  it('sorts files in natural numeric order and counts unreadable files in skipped', () => {
    const makeFloorJson = (id: number, name: string): string =>
      JSON.stringify({
        floor: {
          floor_id: id,
          name,
          rows: 5,
          columns: 5,
          bg_id: 1,
          blocked: '0_0;0_1;0_2;0_3;0_4;4_0;4_1;4_2;4_3;4_4'
        }
      });

    const result = decodeDiggyFiles(
      [
        { name: 'floors_10.json', text: makeFloorJson(10, 'Ten') },
        { name: 'floors_2.json', text: makeFloorJson(2, 'Two') },
        { name: 'floors_bad.json', text: '{not valid json' }
      ],
      'batch'
    );

    expect(result.levels.map((l) => l.customTitle)).toEqual(['Two', 'Ten']);
    expect(result.levels.map((l) => l.number)).toEqual([1, 2]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].title).toBe('floors_bad.json');
  });
});
