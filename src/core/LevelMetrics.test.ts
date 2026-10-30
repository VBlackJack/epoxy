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
import { LevelMetrics, MECHANICS } from './LevelMetrics';
import { buildTestLevel } from '../test/buildTestLevel';
import { loadTestConfigs } from '../test/loadTestConfigs';

describe('LevelMetrics', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('measures a straight corridor', () => {
    const report = LevelMetrics.measure(buildTestLevel(['#######', '#@...E#', '#######']));
    expect(report.usedWidth).toBe(5);
    expect(report.usedHeight).toBe(1);
    expect(report.walkableCells).toBe(5);
    expect(report.estimatedSolutionSteps).toBe(4);
    expect(report.revisitRatio).toBeCloseTo(4 / 5);
    expect(report.tourCoverageRatio).toBe(1);
    expect(report.deadEndRatio).toBeCloseTo(2 / 5);
  });

  it('routes through required chips and the socket before the exit', () => {
    const report = LevelMetrics.measure(
      buildTestLevel(['#########', '#C.@.S.E#', '#########'], { chipsRequired: 1 })
    );
    // start -> chip (2 steps) -> socket (4) -> exit (2)
    expect(report.estimatedSolutionSteps).toBe(8);
    expect(report.mechanics).toContain(MECHANICS.SOCKET);
  });

  it('counts a detour as backtracking', () => {
    const report = LevelMetrics.measure(
      buildTestLevel(['#####', '#C#E#', '#.#.#', '#@..#', '#####'], { chipsRequired: 1 })
    );
    // up 2 to the chip, back down 2, then 2 right and 2 up to the exit
    expect(report.estimatedSolutionSteps).toBe(8);
    expect(report.revisitRatio).toBeGreaterThan(1);
  });

  it('includes the key of a locked door in the tour', () => {
    const report = LevelMetrics.measure(buildTestLevel(['########', '#r.@.RE#', '########']));
    // left 2 to the key, then right 5 through the door to the exit
    expect(report.estimatedSolutionSteps).toBe(7);
    expect(report.mechanics).toContain(MECHANICS.KEYS_DOORS);
  });

  it('crosses walls through linked teleporters', () => {
    const report = LevelMetrics.measure(buildTestLevel(['#######', '#@O#O.E', '#######']));
    // one step onto the first teleporter, the jump is free, then two steps to the exit
    expect(report.estimatedSolutionSteps).toBe(3);
    expect(report.mechanics).toContain(MECHANICS.TELEPORT);
  });

  it('reports no tour when the exit is walled off', () => {
    const report = LevelMetrics.measure(buildTestLevel(['#####', '#@.#E', '#####']));
    expect(report.estimatedSolutionSteps).toBeNull();
    expect(report.timeSlackRatio).toBeNull();
  });

  it('lists hazards, sliding floors and monsters as mechanics', () => {
    const report = LevelMetrics.measure(
      buildTestLevel(['#########', '#@WFI>.E#', '#########'], {
        entities: [{ x: 6, y: 1, type: 'bug', dir: 'N' }]
      })
    );
    expect(report.mechanics).toEqual(
      expect.arrayContaining([
        MECHANICS.WATER,
        MECHANICS.FIRE,
        MECHANICS.ICE,
        MECHANICS.FORCE,
        MECHANICS.MONSTERS
      ])
    );
    expect(report.monsterCount).toBe(1);
  });

  it('measures the playfield on cells reachable from the start only', () => {
    const report = LevelMetrics.measure(buildTestLevel(['#######', '#@.#...#', '#######']));
    expect(report.walkableCells).toBe(5);
    expect(report.playfieldCells).toBe(2);
    expect(report.playfieldFill).toBe(1);
    expect(report.deadShare).toBe(1);
  });

  it('reads a room as open and a tube as dead-ended', () => {
    const room = LevelMetrics.measure(buildTestLevel(['#####', '#@..#', '#...#', '#..E#', '#####']));
    const tube = LevelMetrics.measure(buildTestLevel(['#######', '#@...E#', '#######']));
    expect(room.openShare).toBe(1);
    expect(room.deadShare).toBe(0);
    expect(tube.openShare).toBe(0);
    expect(tube.deadShare).toBeCloseTo(2 / 5);
  });

  it('flags the presence of monsters', () => {
    const calm = LevelMetrics.measure(buildTestLevel(['#####', '#@.E#', '#####']));
    const busy = LevelMetrics.measure(
      buildTestLevel(['#####', '#@.E#', '#####'], { entities: [{ x: 2, y: 1, type: 'bug', dir: 'N' }] })
    );
    expect(calm.hasMonsters).toBe(0);
    expect(busy.hasMonsters).toBe(1);
  });

  it('compares the time limit with the estimated walking time', () => {
    const report = LevelMetrics.measure(
      buildTestLevel(['#######', '#@...E#', '#######'], { timeLimitSeconds: 100 })
    );
    expect(report.estimatedSeconds).toBeGreaterThan(0);
    expect(report.timeSlackRatio).toBeCloseTo(100 / (report.estimatedSeconds ?? 1));
  });
});
