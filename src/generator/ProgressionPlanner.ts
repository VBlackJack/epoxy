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
import { SeededRandom } from '../core/Random';
import { ProceduralConfig } from '../core/types';
import { ALL_ORIENTATIONS, IDENTITY_ORIENTATION, orientPiece } from './PieceCompiler';
import { CompiledPiece, MotifRule } from './PieceTypes';

/** One step of a level: the items to hand over first, then the piece to cross. */
export interface PlannedStep {
  piece: CompiledPiece;
  /** Boots and keys placed in an alcove just before the piece. */
  giveBefore: string[];
}

export interface LevelPlan {
  steps: PlannedStep[];
  /** Motifs of the level, in the order they are introduced. */
  motifs: string[];
}

/** Budget of a level, derived from its number and the procedural config. */
export interface LevelBudget {
  pieceCount: number;
  motifCount: number;
  maxTier: number;
}

function byLevel(values: number[], levelNumber: number): number {
  return values[Math.min(values.length, Math.max(1, levelNumber)) - 1];
}

export function budgetFor(levelNumber: number, cfg: ProceduralConfig): LevelBudget {
  const extra = Math.floor((Math.max(1, levelNumber) - 1) / cfg.levelsPerExtraPiece);
  return {
    pieceCount: Math.min(cfg.maxPieceCount, cfg.basePieceCount + extra),
    motifCount: byLevel(cfg.motifCountByLevel, levelNumber),
    maxTier: byLevel(cfg.maxTierByLevel, levelNumber)
  };
}

/**
 * Chooses the pieces of a level, in order. A level focuses on a few motifs
 * (the budget's motifCount), introduces each with its easiest piece first,
 * and never exceeds a motif's maxPerLevel. It then walks the chain keeping
 * track of the boots the player holds: a piece needing boots the player does
 * not have gets them handed over just before it, and a thief empties the
 * inventory. The finale piece always closes the plan.
 */
export class ProgressionPlanner {
  public static plan(
    levelNumber: number,
    library: CompiledPiece[],
    rules: Record<string, MotifRule>,
    rng: SeededRandom
  ): LevelPlan {
    const cfg = ConfigRegistry.getGame().procedural as ProceduralConfig;
    const budget = budgetFor(levelNumber, cfg);
    const finale = library.find((p) => rules[p.motif]?.role === 'finale');
    if (!finale) throw new Error('motifs.json defines no finale piece');

    const playable = library.filter((p) => rules[p.motif]?.role !== 'finale' && p.tier <= budget.maxTier);
    const motifPool = [...new Set(playable.map((p) => p.motif))];
    rng.shuffle(motifPool);
    const motifs = motifPool.slice(0, Math.min(budget.motifCount, motifPool.length));

    const chosen = this.choosePieces(budget.pieceCount, motifs, playable, rules, rng);
    const steps = this.handOverItems(chosen);
    steps.push({ piece: this.randomOrientation(finale, rng), giveBefore: [] });
    return { steps, motifs };
  }

  private static choosePieces(
    count: number,
    motifs: string[],
    playable: CompiledPiece[],
    rules: Record<string, MotifRule>,
    rng: SeededRandom
  ): CompiledPiece[] {
    const used = new Map<string, number>();
    const usedIds = new Set<string>();
    const chosen: CompiledPiece[] = [];
    const allowed = (motif: string): boolean =>
      (used.get(motif) ?? 0) < (rules[motif]?.maxPerLevel ?? Number.POSITIVE_INFINITY);

    const pick = (motif: string, introduce: boolean): CompiledPiece | null => {
      if (!allowed(motif)) return null;
      const candidates = playable.filter((p) => p.motif === motif);
      if (candidates.length === 0) return null;
      const lowestTier = Math.min(...candidates.map((p) => p.tier));
      // The first piece of a motif is one of its easiest; later ones prefer unseen pieces.
      const pool = introduce
        ? candidates.filter((p) => p.tier === lowestTier)
        : candidates.filter((p) => !usedIds.has(p.id)).length > 0
          ? candidates.filter((p) => !usedIds.has(p.id))
          : candidates;
      const piece = pool[rng.nextInt(0, pool.length - 1)];
      used.set(motif, (used.get(motif) ?? 0) + 1);
      usedIds.add(piece.id);
      return piece;
    };

    for (const motif of motifs) {
      if (chosen.length >= count) break;
      const piece = pick(motif, true);
      if (piece) chosen.push(piece);
    }
    let guard = count * motifs.length + 1;
    while (chosen.length < count && guard-- > 0) {
      const piece = pick(motifs[rng.nextInt(0, motifs.length - 1)], false);
      if (piece) chosen.push(piece);
    }
    // Easier pieces first: a motif is met in its simple form before its twist.
    chosen.sort((a, b) => a.tier - b.tier);
    return chosen.map((p) => this.randomOrientation(p, rng));
  }

  /** Simulates the boots the player holds along the chain and fills the gaps. */
  private static handOverItems(pieces: CompiledPiece[]): PlannedStep[] {
    const held = new Set<string>();
    return pieces.map((piece) => {
      const giveBefore: string[] = [];
      for (const itemId of piece.requires) {
        const isBoot = ConfigRegistry.getTile(itemId).collectible === 'boot';
        if (!isBoot) {
          giveBefore.push(itemId);
        } else if (!held.has(itemId)) {
          giveBefore.push(itemId);
          held.add(itemId);
        }
      }
      let stealsBoots = false;
      piece.terrain.forEach((row, y) =>
        row.forEach((id, x) => {
          if (ConfigRegistry.getTile(id).stealsBoots) stealsBoots = true;
          const item = piece.items[y][x];
          if (item && ConfigRegistry.getTile(item).collectible === 'boot') held.add(item);
        })
      );
      // Conservative: whatever a piece with a thief hands out may be stolen.
      if (stealsBoots) held.clear();
      return { piece, giveBefore };
    });
  }

  private static randomOrientation(piece: CompiledPiece, rng: SeededRandom): CompiledPiece {
    if (!piece.rotatable) return orientPiece(piece, IDENTITY_ORIENTATION);
    return orientPiece(piece, ALL_ORIENTATIONS[rng.nextInt(0, ALL_ORIENTATIONS.length - 1)]);
  }
}
