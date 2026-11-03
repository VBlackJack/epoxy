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

import { CompiledLevel } from '../core/types';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { blockCheckApplies, describeBlockVerdict, evaluateBlocks } from './blockCheck';

function sokobanRoom(): CompiledLevel {
  const rows = [
    ['wall', 'wall', 'wall', 'wall', 'wall'],
    ['wall', 'floor', 'floor', 'block_target', 'wall'],
    ['wall', 'wall', 'wall', 'wall', 'wall']
  ];
  return {
    id: 'check_room',
    winRule: 'targets',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    playerStart: { x: 1, y: 1, dir: 'E' },
    terrain: rows,
    items: rows.map((row) => row.map(() => null)),
    entities: [{ type: 'dirt_block', x: 2, y: 1, dir: 'S' }],
    trapLinks: [],
    cloneLinks: []
  };
}

beforeEach(() => {
  loadTestConfigs();
});

describe('describeBlockVerdict', () => {
  it('carries the push count of a solved puzzle only', () => {
    expect(describeBlockVerdict({ kind: 'solved', pushes: 3 })).toEqual({
      key: 'editor.check.blocks.solved',
      params: { count: 3 }
    });
    expect(describeBlockVerdict({ kind: 'unsolvable' })).toEqual({ key: 'editor.check.blocks.unsolvable' });
    expect(describeBlockVerdict({ kind: 'not_checked' })).toEqual({ key: 'editor.check.blocks.not_checked' });
    expect(describeBlockVerdict({ kind: 'none' })).toBeNull();
  });
});

describe('blockCheckApplies', () => {
  it('is true for Epoxy levels only', () => {
    expect(blockCheckApplies(sokobanRoom())).toBe(true);
    expect(blockCheckApplies({ ...sokobanRoom(), ruleset: 'epoxy' })).toBe(true);
    expect(blockCheckApplies({ ...sokobanRoom(), ruleset: 'lynx' })).toBe(false);
    expect(blockCheckApplies({ ...sokobanRoom(), ruleset: 'cc3d' })).toBe(false);
  });
});

describe('evaluateBlocks', () => {
  it('solves a Sokoban room on the Epoxy rules', () => {
    expect(evaluateBlocks(sokobanRoom())).toEqual({ kind: 'solved', pushes: 1 });
  });

  it('is hidden for the Lynx and CC3D rulesets', () => {
    expect(evaluateBlocks({ ...sokobanRoom(), ruleset: 'lynx' })).toBeNull();
    expect(evaluateBlocks({ ...sokobanRoom(), ruleset: 'cc3d' })).toBeNull();
  });

  it('is skipped when the start lies outside the map', () => {
    expect(evaluateBlocks({ ...sokobanRoom(), playerStart: { x: 9, y: 9, dir: 'E' } })).toBeNull();
  });
});
