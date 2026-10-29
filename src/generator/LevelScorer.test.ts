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
import { ConfigRegistry } from '../config/ConfigRegistry';
import { scoreLevel, ScoreInputs } from './LevelScorer';
import { buildTestLevel } from '../test/buildTestLevel';
import { loadTestConfigs } from '../test/loadTestConfigs';

function inputs(rows: string[], extra: Partial<ScoreInputs> = {}): ScoreInputs {
  return {
    level: buildTestLevel(rows),
    pieceBoxes: [],
    solutionLength: 50,
    visitedCells: 40,
    motifCount: 1,
    motifBudget: 1,
    walkMoves: 30,
    pieceMoves: 20,
    ...extra
  };
}

describe('scoreLevel', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('rewards a run length close to the target for the level', () => {
    const cfg = ConfigRegistry.getGame().procedural!.scoring;
    const onTarget = scoreLevel(inputs(['#@..E#'], { solutionLength: cfg.targetMovesBase }), 1, cfg);
    const farOff = scoreLevel(inputs(['#@..E#'], { solutionLength: cfg.targetMovesBase * 3 }), 1, cfg);
    expect(onTarget.lengthFit).toBe(1);
    expect(farOff.lengthFit).toBe(0);
    expect(onTarget.total).toBeGreaterThan(farOff.total);
  });

  it('sees open rooms as junctions and bare tubes as corridor', () => {
    const cfg = ConfigRegistry.getGame().procedural!.scoring;
    const room = scoreLevel(inputs(['#####', '#@..#', '#...#', '#..E#', '#####']), 1, cfg);
    const tube = scoreLevel(inputs(['#######', '#@...E#', '#######']), 1, cfg);
    expect(room.junctionShare).toBeGreaterThan(tube.junctionShare);
    // No piece boxes: every walkable cell counts as corridor.
    expect(tube.corridorShare).toBe(1);
  });

  it('measures backtracking from the run', () => {
    const cfg = ConfigRegistry.getGame().procedural!.scoring;
    const score = scoreLevel(inputs(['#@..E#'], { solutionLength: 60, visitedCells: 50 }), 1, cfg);
    expect(score.revisitRatio).toBeCloseTo(1.2);
  });

  it('penalises dead ends on the playfield and rewards open rooms', () => {
    const cfg = ConfigRegistry.getGame().procedural!.scoring;
    const room = scoreLevel(inputs(['#####', '#@..#', '#...#', '#..E#', '#####']), 1, cfg);
    const tube = scoreLevel(inputs(['#######', '#@...E#', '#######']), 1, cfg);
    expect(room.deadShare).toBe(0);
    expect(tube.deadShare).toBeCloseTo(2 / 5);
    // Same inputs apart from the map: the dead-end term alone favours the room.
    const solid = { ...cfg, weightLength: 0, weightJunction: 0, weightCorridor: 0, weightRevisit: 0, weightVariety: 0, weightWalk: 0 };
    expect(scoreLevel(inputs(['#####', '#@..#', '#...#', '#..E#', '#####']), 1, solid).total).toBeGreaterThan(
      scoreLevel(inputs(['#######', '#@...E#', '#######']), 1, solid).total
    );
  });

  it('only counts dead ends reachable from the start', () => {
    const cfg = ConfigRegistry.getGame().procedural!.scoring;
    const score = scoreLevel(inputs(['#######', '#@..#.#', '#######']), 1, cfg);
    expect(score.deadShare).toBeCloseTo(2 / 3);
  });

  it('scores the walk against the thinking inside pieces in a band', () => {
    const cfg = ConfigRegistry.getGame().procedural!.scoring;
    const only = { ...cfg, weightLength: 0, weightJunction: 0, weightCorridor: 0, weightRevisit: 0, weightVariety: 0, weightDeadEnd: 0 };
    const mid = (cfg.walkPerDecisionLow + cfg.walkPerDecisionHigh) / 2;
    const inBand = scoreLevel(inputs(['#@..E#'], { walkMoves: mid * 20, pieceMoves: 20 }), 1, only);
    const walkOnly = scoreLevel(inputs(['#@..E#'], { walkMoves: 400, pieceMoves: 10 }), 1, only);
    expect(inBand.walkPerDecision).toBeCloseTo(mid);
    expect(inBand.total).toBeGreaterThan(walkOnly.total);
  });
});
