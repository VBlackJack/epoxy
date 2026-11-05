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
import { loadTestConfigs } from '../test/loadTestConfigs';
import { BlockPuzzleSolver } from './BlockPuzzleSolver';
import { GameEngine } from './GameEngine';
import { DOOR_ORDER_MAX_WALKS, LevelValidator, ValidateWorkMeter } from './LevelValidator';
import { CompiledLevel, EntityPlacement } from './types';

const UNSOLVABLE_KEY = 'validator.issues.targets_unsolvable.label';
/**
 * Ceiling on the cells the reach walks touch while validating the huge targets level: about 1.5x the 621576 measured
 * on 2026-11-05 (one walk, two passes). It counts `ValidateWorkMeter.cells`, work and not time, so it holds on any machine.
 */
const HUGE_TARGETS_CELL_BUDGET = 930000;
/** Side of the huge playfield, far above the cell cap of the block search. */
const HUGE_SIDE = 128;
/** Set to run the timing report below. */
const MEASURE_ENV = 'EPOXY_MEASURE_VALIDATE';

const TERRAIN_CODES: Record<string, string> = {
  '#': 'wall',
  '.': 'floor',
  P: 'floor',
  $: 'floor',
  m: 'floor',
  C: 'clone_machine',
  T: 'block_target'
};

/** Rows: # wall, . floor, P player, T target, $ block, m monster. */
function room(rows: string[]): CompiledLevel {
  let start = { x: 1, y: 1 };
  const entities: EntityPlacement[] = [];
  const terrain = rows.map((row, y) =>
    [...row].map((ch, x) => {
      if (ch === 'P') start = { x, y };
      if (ch === '$') entities.push({ type: 'dirt_block', x, y, dir: 'S' });
      if (ch === 'm') entities.push({ type: 'bug', x, y, dir: 'S' });
      return TERRAIN_CODES[ch];
    })
  );
  return {
    id: 'targets_budget_room',
    winRule: 'targets',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    playerStart: { ...start, dir: 'E' },
    terrain,
    items: terrain.map((row) => row.map(() => null)),
    entities,
    trapLinks: [],
    cloneLinks: []
  };
}

function hugeRoom(side: number): CompiledLevel {
  const rows: string[] = [];
  for (let y = 0; y < side; y++) {
    if (y === 0 || y === side - 1) rows.push('#'.repeat(side));
    else rows.push('#' + '.'.repeat(side - 2) + '#');
  }
  const set = (x: number, y: number, ch: string): void => {
    rows[y] = rows[y].slice(0, x) + ch + rows[y].slice(x + 1);
  };
  set(1, 1, 'P');
  set(2, 1, '$');
  set(side - 2, side - 2, 'T');
  return room(rows);
}

function newMeter(): ValidateWorkMeter {
  return { cells: 0, walks: 0, passes: 0, blockNodes: 0 };
}

function warns(level: CompiledLevel, blockSearch?: 'watch' | 'exhaustive'): boolean {
  const report = LevelValidator.validate(level, undefined, blockSearch ? { blockSearch } : undefined);
  return report.issues.some((i) => i.i18nKey === UNSOLVABLE_KEY);
}

describe('targets_unsolvable in the validator', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('warns on a genuinely stuck, fully modelled level in both modes', () => {
    const level = room(['######', '#$...#', '#.P..#', '#...T#', '######']);
    expect(warns(level)).toBe(true);
    expect(warns(level, 'exhaustive')).toBe(true);
  });

  it('does not warn when the quick test calls stuck a level holding a moving monster', () => {
    // The bug sits in the corridor cell the block must cross; the quick test reads it as a wall.
    // The monster is an entity the search does not model, so the check stays silent
    // rather than claim anything about the level.
    const level = room(['#######', '#.....#', '#.P$mT#', '#.....#', '#######']);
    const engine = new GameEngine();
    engine.loadLevel(level);
    expect(BlockPuzzleSolver.isStuck(engine)).toBe(true);
    expect(warns(level)).toBe(false);
    expect(warns(level, 'exhaustive')).toBe(false);
  });

  it('validates a huge targets level fast and without a warning', () => {
    const level = hugeRoom(HUGE_SIDE);
    expect(HUGE_SIDE * HUGE_SIDE).toBeGreaterThan(ConfigRegistry.getGame().blockPuzzle.watchMaxCells);
    const meter = newMeter();
    const report = LevelValidator.validate(level, undefined, { meter });
    expect(meter.blockNodes).toBe(0);
    expect(meter.cells).toBeLessThanOrEqual(HUGE_TARGETS_CELL_BUDGET);
    expect(meter.walks).toBeLessThanOrEqual(1 + DOOR_ORDER_MAX_WALKS);
    expect(report.issues.map((i) => i.i18nKey)).not.toContain(UNSOLVABLE_KEY);
  });

  it('reports the same with and without the work meter on the huge level', () => {
    const level = hugeRoom(HUGE_SIDE);
    const plain = LevelValidator.validate(level);
    const metered = LevelValidator.validate(level, undefined, { meter: newMeter() });
    expect(JSON.stringify(metered)).toBe(JSON.stringify(plain));
  });

  it('counts the block search nodes on a genuinely stuck level', () => {
    const meter = newMeter();
    LevelValidator.validate(room(['######', '#$...#', '#.P..#', '#...T#', '######']), undefined, { meter });
    expect(meter.blockNodes).toBeGreaterThan(0);
  });

  it.skipIf(!process.env[MEASURE_ENV])('reports validate timings (manual)', () => {
    const lines: string[] = [];
    const time = (label: string, level: CompiledLevel, mode: 'watch' | 'exhaustive'): void => {
      const started = performance.now();
      LevelValidator.validate(level, undefined, { blockSearch: mode });
      lines.push(`${label} ${mode}: ${Math.round(performance.now() - started)} ms`);
    };
    const pilot = ConfigRegistry.getPilotLevels().find((l) => l.id === 'epoxy_p_25');
    if (pilot) for (const mode of ['watch', 'exhaustive'] as const) time('epoxy_p_25', pilot, mode);
    for (const side of [20, 32, 128]) {
      for (const mode of ['watch', 'exhaustive'] as const) time(`synthetic ${side}x${side}`, hugeRoom(side), mode);
    }
    console.log(lines.join('\n'));
  });
});
