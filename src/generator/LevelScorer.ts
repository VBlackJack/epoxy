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

import { ConfigRegistry } from '../config/ConfigRegistry';
import { DIRECTION_VECTORS, ORDERED_DIRECTIONS } from '../config/constants';
import { measurePlayfield } from '../core/PlayfieldMetrics';
import { CompiledLevel, GridPoint, ProceduralScoringConfig } from '../core/types';
import { isPlayerWalkable } from '../core/Walkability';
import { Box } from './LevelAssembler';

/** Neighbour count from which a cell is a junction, a place with a choice. */
const JUNCTION_MIN_NEIGHBOURS = 3;
/** Cells within this many steps of a junction count as near one. */
const JUNCTION_RADIUS = 2;

export interface ScoreInputs {
  level: CompiledLevel;
  pieceBoxes: Box[];
  solutionLength: number;
  /** Distinct cells the winning run walks over. */
  visitedCells: number;
  motifCount: number;
  motifBudget: number;
  /** Actions of the winning run spent outside pieces, and inside them. */
  walkMoves: number;
  pieceMoves: number;
}

export interface LevelScore {
  total: number;
  lengthFit: number;
  junctionShare: number;
  corridorShare: number;
  revisitRatio: number;
  /** Share of the playfield that is a dead end. */
  deadShare: number;
  /** Moves walked between pieces per move spent solving them. */
  walkPerDecision: number;
}

/** 1 inside [low, high], falling linearly to 0 one band width away. */
function band(value: number, low: number, high: number): number {
  if (value >= low && value <= high) return 1;
  const width = high - low;
  const distance = value < low ? low - value : value - high;
  return Math.max(0, 1 - distance / width);
}

/**
 * Ranks candidate levels; only used to pick among levels that are already
 * proven solvable and fair, so it shapes taste, not correctness. Terms, each
 * in [0, 1], weighted from the scoring config:
 * - lengthFit: winning run length close to the target for the level number;
 * - junctionShare: open floor near places with a choice, against long tubes;
 * - corridor: little of the walkable floor is bare corridor;
 * - revisit: some backtracking, in a band, neither none nor much;
 * - variety: motifs used against the level's budget;
 * - deadEnd: few dead ends on the playfield, the cells reachable from the start;
 * - walk: walking between pieces in proportion to the thinking inside them.
 */
export function scoreLevel(inputs: ScoreInputs, levelNumber: number, cfg: ProceduralScoringConfig): LevelScore {
  const { level } = inputs;
  const height = level.terrain.length;
  const width = height > 0 ? level.terrain[0].length : 0;
  const walkable = level.terrain.map((row) =>
    row.map((id) => isPlayerWalkable(ConfigRegistry.getTile(id)))
  );
  const isOpen = (p: GridPoint): boolean => p.x >= 0 && p.y >= 0 && p.x < width && p.y < height && walkable[p.y][p.x];
  const inBox = (p: GridPoint): boolean =>
    inputs.pieceBoxes.some((b) => p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1);

  let walkableCount = 0;
  let corridorCells = 0;
  const junctions: GridPoint[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!walkable[y][x]) continue;
      walkableCount++;
      if (!inBox({ x, y })) corridorCells++;
      const neighbours = ORDERED_DIRECTIONS.filter((d) =>
        isOpen({ x: x + DIRECTION_VECTORS[d].dx, y: y + DIRECTION_VECTORS[d].dy })
      ).length;
      if (neighbours >= JUNCTION_MIN_NEIGHBOURS) junctions.push({ x, y });
    }
  }
  let nearJunction = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!walkable[y][x]) continue;
      if (junctions.some((j) => Math.abs(j.x - x) + Math.abs(j.y - y) <= JUNCTION_RADIUS)) nearJunction++;
    }
  }

  const target = cfg.targetMovesBase + cfg.targetMovesPerLevel * (levelNumber - 1);
  const lengthFit = 1 - Math.min(1, Math.abs(inputs.solutionLength / target - 1) / cfg.lengthTolerance);
  const junctionShare = walkableCount > 0 ? nearJunction / walkableCount : 0;
  const corridorShare = walkableCount > 0 ? corridorCells / walkableCount : 1;
  const revisitRatio = inputs.visitedCells > 0 ? inputs.solutionLength / inputs.visitedCells : 0;
  const variety = inputs.motifBudget > 0 ? Math.min(1, inputs.motifCount / inputs.motifBudget) : 0;
  const deadShare = measurePlayfield(walkable, level.playerStart).deadShare;
  const walkPerDecision = inputs.pieceMoves > 0 ? inputs.walkMoves / inputs.pieceMoves : 0;

  const total =
    cfg.weightLength * lengthFit +
    cfg.weightJunction * junctionShare +
    cfg.weightCorridor * (1 - Math.min(1, corridorShare / cfg.corridorShareCeiling)) +
    cfg.weightRevisit * band(revisitRatio, cfg.revisitLow, cfg.revisitHigh) +
    cfg.weightVariety * variety +
    cfg.weightDeadEnd * (1 - Math.min(1, deadShare / cfg.deadShareCeiling)) +
    cfg.weightWalk * band(walkPerDecision, cfg.walkPerDecisionLow, cfg.walkPerDecisionHigh);
  return { total, lengthFit, junctionShare, corridorShare, revisitRatio, deadShare, walkPerDecision };
}
