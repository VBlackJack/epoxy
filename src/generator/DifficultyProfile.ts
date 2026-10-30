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

import { ProceduralConfig } from '../core/types';

/** Where a level is generated: a pack with a learning curve, or the endless mode at full strength. */
export type GenerationMode = 'pack' | 'endless';

/**
 * Everything the generator derives from the position of a level in its
 * sequence. The level number stays only as identity (random stream, id,
 * password); every difficulty decision reads this profile instead.
 */
export interface DifficultyProfile {
  mode: GenerationMode;
  pieceCount: number;
  motifCount: number;
  /** Highest piece tier a puzzle may have; also the pool lead motifs are drawn from. */
  maxTier: number;
  layout: 'chain' | 'hub';
  /** Whether the motifs kept for later (firstLevelExcludedMotifs) are left out. */
  onboarding: boolean;
  allowOneShot: boolean;
  /** Puzzles are drawn from the hardest tier allowed. */
  preferHard: boolean;
  timed: boolean;
  /** Run length the scorer aims for. */
  targetMoves: number;
  /** Side of the square area a chain layout is built in. */
  regionSize: number;
  /** Motifs added to a level's focus with the given probability (endless.motifShares). */
  motifShares: Record<string, number>;
}

function byLevel(values: number[], levelNumber: number): number {
  return values[Math.min(values.length, Math.max(1, levelNumber)) - 1];
}

function grown(start: number, max: number, perStep: number, levelNumber: number): number {
  return Math.min(max, start + Math.floor((Math.max(1, levelNumber) - 1) / perStep));
}

function packProfile(levelNumber: number, cfg: ProceduralConfig): DifficultyProfile {
  const extra = Math.floor((Math.max(1, levelNumber) - 1) / cfg.levelsPerExtraPiece);
  const target = cfg.scoring.targetMovesBase + cfg.scoring.targetMovesPerLevel * (levelNumber - 1);
  return {
    mode: 'pack',
    pieceCount: Math.min(cfg.maxPieceCount, cfg.basePieceCount + extra),
    motifCount: byLevel(cfg.motifCountByLevel, levelNumber),
    maxTier: byLevel(cfg.maxTierByLevel, levelNumber),
    layout: levelNumber >= cfg.hub.fromLevel ? 'hub' : 'chain',
    onboarding: levelNumber === 1,
    allowOneShot: levelNumber >= cfg.oneShotFromLevel,
    preferHard: levelNumber >= cfg.hardPiecesFromLevel,
    timed: levelNumber > cfg.untimedUpToLevel,
    targetMoves: Math.min(cfg.scoring.targetMovesMax, target),
    regionSize: cfg.baseRegionSize + cfg.regionGrowthPerLevel * (levelNumber - 1),
    motifShares: {}
  };
}

function endlessProfile(levelNumber: number, cfg: ProceduralConfig): DifficultyProfile {
  const e = cfg.endless;
  const pieceCount = grown(e.pieceCountStart, e.pieceCountMax, e.levelsPerExtraPiece, levelNumber);
  const target = e.targetMovesStart + e.targetMovesPerLevel * (Math.max(1, levelNumber) - 1);
  return {
    mode: 'endless',
    pieceCount,
    motifCount: grown(e.motifCountStart, e.motifCountMax, e.levelsPerExtraMotif, levelNumber),
    maxTier: grown(e.maxTierStart, e.maxTierMax, e.levelsPerExtraTier, levelNumber),
    layout: 'hub',
    onboarding: false,
    allowOneShot: true,
    preferHard: true,
    timed: true,
    targetMoves: Math.min(e.targetMovesMax, cfg.scoring.targetMovesMax, target),
    regionSize: cfg.baseRegionSize + cfg.regionGrowthPerLevel * (pieceCount - 1),
    motifShares: e.motifShares
  };
}

/** The difficulty of level `levelNumber` in the given mode. Pure. */
export function profileFor(mode: GenerationMode, levelNumber: number, cfg: ProceduralConfig): DifficultyProfile {
  return mode === 'endless' ? endlessProfile(levelNumber, cfg) : packProfile(levelNumber, cfg);
}
