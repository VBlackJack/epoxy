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

import pilotLevels from '../../public/configs/pilot-levels.json';
import { CompiledLevel, LevelBlueprint } from '../core/types';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { blockBudgetProblems } from '../test/pilotBlockBudget';
import { ConfigRegistry } from './ConfigRegistry';
import { stripInvalidTextFields } from './ConfigValidation';

/** A one-block room: push the block east onto the target. */
function pushRoom(extra: Partial<LevelBlueprint> = {}): LevelBlueprint {
  return {
    id: 'epoxy_p_budget',
    number: 1,
    password: 'BUDG',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    winRule: 'targets',
    playerStart: { x: 1, y: 1, dir: 'E' },
    rows: ['####', '#@.#', '####'],
    terrainOverrides: [{ x: 3, y: 1, id: 'block_target' }],
    items: [],
    entities: [{ type: 'dirt_block', x: 2, y: 1, dir: 'S' }],
    trapLinks: [],
    cloneLinks: [],
    solution: 'E',
    ...extra
  };
}

function compiled(extra: Partial<LevelBlueprint>): CompiledLevel {
  return ConfigRegistry.compileBlueprint(pushRoom(extra));
}

describe('pilot block budget', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  it('passes through the compiled level, keeping only the two counts', () => {
    const level = compiled({ blockBudget: { waters: 0, targets: 1 } });
    expect(level.blockBudget).toEqual({ waters: 0, targets: 1 });
    const stray = { waters: 0, targets: 1, spare: 4 } as unknown as LevelBlueprint['blockBudget'];
    expect(compiled({ blockBudget: stray }).blockBudget).toEqual({ waters: 0, targets: 1 });
  });

  it('drops a malformed budget instead of passing it on', () => {
    const bad = { waters: -1, targets: 1.5 } as unknown as LevelBlueprint['blockBudget'];
    expect(compiled({ blockBudget: bad }).blockBudget).toBeUndefined();
    const level = { ...compiled({}), blockBudget: bad } as CompiledLevel;
    expect('blockBudget' in stripInvalidTextFields(level)).toBe(false);
  });

  it('has no problem without a budget, and none when blocks equal waters plus targets and the solution wins', () => {
    expect(blockBudgetProblems(compiled({}))).toEqual([]);
    expect(blockBudgetProblems(compiled({ blockBudget: { waters: 0, targets: 1 } }))).toEqual([]);
  });

  it('refuses a spare block and a missing block', () => {
    expect(blockBudgetProblems(compiled({ blockBudget: { waters: 1, targets: 1 } }))).toEqual(
      expect.arrayContaining([expect.stringContaining('1 blocks, but the budget is 1 waters + 1 targets')])
    );
    const twoBlocks = compiled({
      blockBudget: { waters: 0, targets: 1 },
      entities: [
        { type: 'dirt_block', x: 2, y: 1, dir: 'S' },
        { type: 'dirt_block', x: 1, y: 1, dir: 'S' }
      ]
    });
    expect(blockBudgetProblems(twoBlocks).join('|')).toContain('2 blocks');
  });

  it('refuses targets that differ from the block targets drawn, and water that is not there', () => {
    const wrongTargets = compiled({ blockBudget: { waters: 0, targets: 0 } });
    expect(blockBudgetProblems(wrongTargets).join('|')).toContain('1 block targets drawn');
    const noWater = compiled({ blockBudget: { waters: 1, targets: 0 } });
    expect(blockBudgetProblems(noWater).join('|')).toContain('0 water cells drawn');
  });

  it('is accepted only when the stored solution replays to a win', () => {
    const wrongWay = compiled({ blockBudget: { waters: 0, targets: 1 }, solution: 'W' });
    expect(blockBudgetProblems(wrongWay)).toEqual(['the stored solution does not replay to a win']);
    const missing = compiled({ blockBudget: { waters: 0, targets: 1 }, solution: undefined });
    expect(blockBudgetProblems(missing)).toEqual(['the stored solution does not replay to a win']);
  });

  it('holds for every pilot level that declares a budget, and compile keeps each declared budget', () => {
    const raw = (pilotLevels as { levels: LevelBlueprint[] }).levels.filter((bp) => bp.blockBudget !== undefined);
    const compiledById = new Map(ConfigRegistry.getPilotLevels().map((level) => [level.id, level]));
    for (const bp of raw) {
      const level = compiledById.get(bp.id);
      expect({ id: bp.id, budget: level?.blockBudget }).toEqual({ id: bp.id, budget: bp.blockBudget });
      if (level) expect({ id: bp.id, problems: blockBudgetProblems(level) }).toEqual({ id: bp.id, problems: [] });
    }
  });
});
