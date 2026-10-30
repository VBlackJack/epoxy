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
import { DifficultyProfile, profileFor } from './DifficultyProfile';
import { ALL_ORIENTATIONS, IDENTITY_ORIENTATION, orientPiece } from './PieceCompiler';
import { CompiledPiece, MotifRule } from './PieceTypes';

/** One step of a level: the items to hand over first, then the piece to cross. */
export interface PlannedStep {
  piece: CompiledPiece;
  /** Boots and keys placed on the corridor just before the piece. */
  giveBefore: string[];
}

export interface LevelPlan {
  steps: PlannedStep[];
  /** Motifs of the level, in the order they are introduced. */
  motifs: string[];
}

/**
 * A hand-written level brief, used to script a campaign: the motifs to teach,
 * in order, how many puzzles and the hardest tier allowed. It replaces the
 * budget the level number would give.
 */
export interface LevelScript {
  motifs: string[];
  pieceCount: number;
  maxTier: number;
  /** Chain of puzzles, or hub with locked wings; defaults to the level number's layout. */
  layout?: 'chain' | 'hub';
}

export interface PuzzleSelection {
  /** Unoriented puzzles, easiest first. */
  puzzles: CompiledPiece[];
  motifs: string[];
  finale: CompiledPiece;
  restRooms: CompiledPiece[];
}

/** Fewest puzzles a level keeps when pieces are dropped to make it fit. */
const MIN_PUZZLES = 2;

/** Budget of a level, derived from its number and the procedural config. */
export interface LevelBudget {
  pieceCount: number;
  motifCount: number;
  maxTier: number;
}

/** Budget of level `levelNumber` of a pack. */
export function budgetFor(levelNumber: number, cfg: ProceduralConfig): LevelBudget {
  const { pieceCount, motifCount, maxTier } = profileFor('pack', levelNumber, cfg);
  return { pieceCount, motifCount, maxTier };
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
    profile: DifficultyProfile,
    library: CompiledPiece[],
    rules: Record<string, MotifRule>,
    rng: SeededRandom,
    script?: LevelScript,
    lead?: string,
    avoid: string[] = []
  ): LevelPlan {
    const cfg = ConfigRegistry.getGame().procedural as ProceduralConfig;
    const selection = this.selectPuzzles(profile, library, rules, rng, script, undefined, 0, lead, avoid);
    const chosen = this.withRestRooms(
      selection.puzzles.map((p) => this.randomOrientation(p, rng)),
      selection.restRooms,
      cfg.restRoomEvery,
      rng
    );
    const steps = this.handOverItems(chosen);
    steps.push({ piece: this.randomOrientation(selection.finale, rng), giveBefore: [] });
    return { steps, motifs: selection.motifs };
  }

  /**
   * Picks the level's puzzles, unoriented and easiest first, from a focused
   * set of motifs; also returns the finale and the rest rooms. `accept`
   * narrows the pieces a layout can use (a hub wing must be walkable back).
   */
  public static selectPuzzles(
    profile: DifficultyProfile,
    library: CompiledPiece[],
    rules: Record<string, MotifRule>,
    rng: SeededRandom,
    script?: LevelScript,
    accept: (piece: CompiledPiece) => boolean = () => true,
    piecesDropped = 0,
    lead?: string,
    avoid: string[] = []
  ): PuzzleSelection {
    const cfg = ConfigRegistry.getGame().procedural as ProceduralConfig;
    const base = script
      ? { pieceCount: script.pieceCount, motifCount: script.motifs.length, maxTier: script.maxTier }
      : { pieceCount: profile.pieceCount, motifCount: profile.motifCount, maxTier: profile.maxTier };
    // Dropping pieces never goes below MIN_PUZZLES, and never grows a smaller budget.
    const budget = {
      ...base,
      pieceCount: Math.max(Math.min(MIN_PUZZLES, base.pieceCount), base.pieceCount - piecesDropped)
    };
    const finale = library.find((p) => rules[p.motif]?.role === 'finale');
    if (!finale) throw new Error('motifs.json defines no finale piece');

    const restRooms = library.filter((p) => rules[p.motif]?.role === 'rest');
    const playable = this.playablePieces(profile, library, rules, budget.maxTier, accept, !script);
    const motifPool = [...new Set(playable.map((p) => p.motif))];
    rng.shuffle(motifPool);
    // A wanted lead motif goes first; the others fill the motif budget. With none
    // wanted, motifs the neighbouring levels lead with are kept out of the lead spot.
    const wanted = lead !== undefined && motifPool.includes(lead) ? lead : undefined;
    if (wanted === undefined && avoid.length > 0) {
      const apart = motifPool.filter((m) => !avoid.includes(m));
      motifPool.splice(0, motifPool.length, ...apart, ...motifPool.filter((m) => avoid.includes(m)));
    }
    const others = wanted === undefined ? motifPool : motifPool.filter((m) => m !== wanted);
    const motifs = script
      ? script.motifs.filter((m) => motifPool.includes(m))
      : this.withSharedMotifs(
          [...(wanted === undefined ? [] : [wanted]), ...others].slice(0, Math.min(budget.motifCount, motifPool.length)),
          profile.motifShares,
          motifPool,
          budget.motifCount,
          rng
        );

    const puzzles = this.choosePieces(budget.pieceCount, motifs, playable, rules, rng, cfg, profile.preferHard);
    return { puzzles, motifs, finale, restRooms };
  }

  /**
   * Adds the motifs a mode wants in a share of its levels: each is drawn with
   * its probability, in motif id order so the stream is deterministic, and
   * takes the place of the last focus motif (never the lead) when the level
   * has no room left. Modes with no shares draw nothing from the stream.
   */
  private static withSharedMotifs(
    motifs: string[],
    shares: Record<string, number>,
    motifPool: string[],
    motifCount: number,
    rng: SeededRandom
  ): string[] {
    const focus = [...motifs];
    for (const motif of Object.keys(shares).sort()) {
      if (!motifPool.includes(motif) || focus.includes(motif)) continue;
      if (rng.next() >= shares[motif]) continue;
      if (focus.length < motifCount) focus.push(motif);
      else focus[focus.length - 1] = motif;
    }
    return focus;
  }

  /**
   * Puzzle pieces a level may draw from: no role pieces, within the tier cap,
   * one-shots only late, and on the onboarding level of a generated pack
   * none of the motifs kept for later. Pieces that export or import something
   * are left out: the hub planner brings them in by pairs (HubPlanner.addDependencies).
   */
  public static playablePieces(
    profile: DifficultyProfile,
    library: CompiledPiece[],
    rules: Record<string, MotifRule>,
    maxTier: number,
    accept: (piece: CompiledPiece) => boolean = () => true,
    onboarding = true
  ): CompiledPiece[] {
    const cfg = ConfigRegistry.getGame().procedural as ProceduralConfig;
    const excluded = onboarding && profile.onboarding ? cfg.firstLevelExcludedMotifs : [];
    return library.filter(
      (p) =>
        rules[p.motif]?.role === undefined &&
        !excluded.includes(p.motif) &&
        p.tier <= maxTier &&
        (!p.oneShot || profile.allowOneShot) &&
        p.exports === null &&
        p.imports === null &&
        accept(p)
    );
  }

  /** A puzzle that can be failed for good: best met early in a level, before long walks. */
  public static isIrreversible(piece: CompiledPiece, cfg: ProceduralConfig): boolean {
    return piece.oneShot || piece.reversible === false || cfg.irreversibleMotifs.includes(piece.motif);
  }

  private static choosePieces(
    count: number,
    motifs: string[],
    playable: CompiledPiece[],
    rules: Record<string, MotifRule>,
    rng: SeededRandom,
    cfg: ProceduralConfig,
    preferHard = false
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
      const unseen = candidates.filter((p) => !usedIds.has(p.id));
      const fresh = unseen.length > 0 ? unseen : candidates;
      const highestTier = Math.max(...fresh.map((p) => p.tier));
      // Early on, a motif is introduced by one of its easiest pieces; later
      // levels draw its hardest unseen pieces instead.
      const wide = preferHard
        ? fresh.filter((p) => p.tier === highestTier)
        : introduce
          ? candidates.filter((p) => p.tier === lowestTier)
          : fresh;
      // Pieces with few dead ends keep the level open: those within the limit, or
      // the tidiest ones when the motif has none that tidy.
      const limit = Math.max(cfg.maxPieceDeadEnds, Math.min(...wide.map((p) => p.deadEnds)));
      const pool = wide.filter((p) => p.deadEnds <= limit);
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
    // Puzzles that can be failed for good come first, then easier pieces first: a
    // motif is met in its simple form before its twist.
    chosen.sort(
      (a, b) =>
        Number(this.isIrreversible(b, cfg)) - Number(this.isIrreversible(a, cfg)) || a.tier - b.tier
    );
    return chosen;
  }

  /** Puts an open chip room after every `every` puzzles, never last. */
  private static withRestRooms(
    puzzles: CompiledPiece[],
    restRooms: CompiledPiece[],
    every: number,
    rng: SeededRandom
  ): CompiledPiece[] {
    if (every <= 0 || restRooms.length === 0) return puzzles;
    const paced: CompiledPiece[] = [];
    puzzles.forEach((piece, i) => {
      paced.push(piece);
      const isLast = i === puzzles.length - 1;
      if (!isLast && (i + 1) % every === 0) {
        paced.push(this.randomOrientation(restRooms[rng.nextInt(0, restRooms.length - 1)], rng));
      }
    });
    return paced;
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

  public static randomOrientation(piece: CompiledPiece, rng: SeededRandom): CompiledPiece {
    if (!piece.rotatable) return orientPiece(piece, IDENTITY_ORIENTATION);
    return orientPiece(piece, ALL_ORIENTATIONS[rng.nextInt(0, ALL_ORIENTATIONS.length - 1)]);
  }
}
