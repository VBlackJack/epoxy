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

import { DifficultyMetrics } from './DifficultyMetrics';
import { MECHANICS } from './LevelMetrics';
import { buildTestLevel } from '../test/buildTestLevel';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { CompiledLevel } from './types';

/** Seconds a time limit exceeds the solution by in the timed test. */
const GENEROUS_LIMIT_SECONDS = 100;
/** Distance within which the monster test expects the route to come to the monster. */
const DANGER_BOUND = 2;

function withSolution(level: CompiledLevel, solution: string): CompiledLevel {
  return { ...level, solution };
}

describe('DifficultyMetrics', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('measures a straight corridor', () => {
    const level = withSolution(buildTestLevel(['#######', '#@...E#', '#######']), 'EEEE');
    const report = DifficultyMetrics.measure(level);
    expect(report.solved).toBe(true);
    expect(report.moves).toBe(4);
    expect(report.waits).toBe(0);
    expect(report.pushes).toBe(0);
    expect(report.reversals).toBe(0);
    expect(report.distinctCells).toBe(5);
    expect(report.revisitRatio).toBe(1);
    expect(report.stepsPerWalkableCell).toBeCloseTo(4 / 5);
    expect(report.irreversibleEvents).toBe(0);
    expect(report.firstIrreversibleStep).toBeNull();
    expect(report.shareAfterFirstIrreversible).toBeNull();
    expect(report.minMonsterDistance).toBeNull();
    expect(report.timeMarginSeconds).toBeNull();
  });

  it('flags a solution that does not win', () => {
    const level = withSolution(buildTestLevel(['#######', '#@...E#', '#######']), 'EE');
    expect(DifficultyMetrics.measure(level).solved).toBe(false);
    expect(DifficultyMetrics.measure(buildTestLevel(['#####', '#@.E#', '#####'])).solved).toBe(false);
  });

  it('counts reversals and revisits', () => {
    const level = withSolution(buildTestLevel(['#######', '#@...E#', '#######']), 'EEWEEEE');
    const report = DifficultyMetrics.measure(level);
    expect(report.solved).toBe(true);
    expect(report.reversals).toBe(2);
    expect(report.distinctCells).toBe(5);
    expect(report.revisitRatio).toBeCloseTo(8 / 5);
  });

  it('counts a push and the block sinking into water as one irreversible event', () => {
    const level = withSolution(
      buildTestLevel(['#########', '#@.W...E#', '#########'], {
        entities: [{ x: 2, y: 1, type: 'dirt_block', dir: 'S' }]
      }),
      'EEEEEE'
    );
    const report = DifficultyMetrics.measure(level);
    expect(report.solved).toBe(true);
    expect(report.pushes).toBe(1);
    expect(report.irreversibleByKind.water_filled).toBe(1);
    expect(report.irreversibleByKind.block_lost).toBe(0);
    // Walking over the dirt the block left behind clears it: a second event.
    expect(report.irreversibleByKind.dirt_cleared).toBe(1);
    expect(report.irreversibleEvents).toBe(2);
    expect(report.firstIrreversibleStep).toBe(1);
    expect(report.shareAfterFirstIrreversible).toBeCloseTo(5 / 6);
  });

  it('counts a door opened with a key', () => {
    const level = withSolution(buildTestLevel(['#########', '#@.rR..E#', '#########']), 'EEEEEE');
    const report = DifficultyMetrics.measure(level);
    expect(report.solved).toBe(true);
    expect(report.irreversibleByKind.door_opened).toBe(1);
    expect(report.mechanics).toContain(MECHANICS.KEYS_DOORS);
  });

  it('measures the distance to monsters', () => {
    const level = withSolution(
      buildTestLevel(['#########', '#@.....E#', '#.......#', '#.......#', '#########'], {
        entities: [{ x: 7, y: 3, type: 'bug', dir: 'N' }]
      }),
      'EEEEEE'
    );
    const report = DifficultyMetrics.measure(level);
    expect(report.minMonsterDistance).not.toBeNull();
    expect(report.minMonsterDistance).toBeLessThanOrEqual(DANGER_BOUND);
    expect(report.dangerSteps).toBeGreaterThan(0);
    expect(report.dangerSteps).toBeLessThanOrEqual(report.moves + report.waits);
  });

  it('reports the time margin of a timed level', () => {
    const level = withSolution(
      buildTestLevel(['#######', '#@...E#', '#######'], { timeLimitSeconds: GENEROUS_LIMIT_SECONDS }),
      'EEEE'
    );
    const report = DifficultyMetrics.measure(level);
    expect(report.solutionSeconds).toBeGreaterThan(0);
    expect(report.timeMarginSeconds).toBeCloseTo(GENEROUS_LIMIT_SECONDS - report.solutionSeconds);
    expect(report.timeRatio).toBeCloseTo(GENEROUS_LIMIT_SECONDS / report.solutionSeconds);
  });

  it('splits mechanics into known and new', () => {
    const level = withSolution(buildTestLevel(['#########', '#@.rR..E#', '#########']), 'EEEEEE');
    const known = DifficultyMetrics.measure(level, new Set([MECHANICS.KEYS_DOORS]));
    expect(known.knownMechanics).toEqual([MECHANICS.KEYS_DOORS]);
    expect(known.newMechanics).toEqual([]);
    const fresh = DifficultyMetrics.measure(level);
    expect(fresh.newMechanics).toEqual([MECHANICS.KEYS_DOORS]);
  });
});
