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
import { compilePiece } from '../generator/PieceCompiler';
import { CompiledPiece, MotifsConfig } from '../generator/PieceTypes';
import { AssembledLevel, Box, LevelAssembler } from '../generator/LevelAssembler';
import { HubAssembler, LevelGuard } from '../generator/HubAssembler';
import { HubPlanner } from '../generator/HubPlanner';
import { cellReachableWithout } from '../generator/GuardCheck';
import { LevelProver } from '../generator/LevelProver';
import { encodeActions, SolverAction } from '../generator/PieceSolver';
import { scoreLevel } from '../generator/LevelScorer';
import { budgetFor, LevelScript, ProgressionPlanner } from '../generator/ProgressionPlanner';
import { SeededRandom } from './Random';
import { CompiledLevel, ProceduralConfig } from './types';

const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const PASSWORD_HASH_MULTIPLIER = 7919;
const PASSWORD_HASH_OFFSET = 104729;
const PASSWORD_LENGTH = 4;
const MOTIF_KEY_PREFIX = 'levels.procedural.';
const TITLE_KEY_SUFFIX = '.title';
const HINT_KEY_SUFFIX = '.hint';
const CONTENT_HASH_RADIX = 16;
const CONTENT_HASH_LENGTH = 8;

/** Raised when every attempt to build a level failed to fit or to prove. */
export class ProceduralGenerationError extends Error {
  constructor(public readonly levelNumber: number, detail: string) {
    super(`procedural level ${levelNumber}: ${detail}`);
    this.name = 'ProceduralGenerationError';
  }
}

/** A generated level with what it took to make it. */
export interface GeneratedLevel {
  level: CompiledLevel;
  /** Winning action list (moves and waits), proven by replay in the game engine. */
  solution: SolverAction[];
  /** Motifs the level is built from, in the order they appear. */
  motifs: string[];
  /** Attempts used by the kept candidate, 1 when its first layout fitted and proved. */
  attempts: number;
  /** Best-of-N score of the kept candidate (LevelScorer). */
  score: number;
  /** Solution actions walked between pieces over actions spent inside them. */
  walkPerDecision: number;
  /** Bounds of every piece, finale last; lets tests check no piece can be skipped. */
  pieceBoxes: Box[];
  /** Motif of each piece, in the same order as pieceBoxes. */
  pieceMotifs: string[];
  /** Walling a guard's box must cut its guarded cell off: no puzzle can be walked around. */
  guards: LevelGuard[];
  layout: 'chain' | 'hub';
  /** Hub outline id, for hub levels. */
  hubShape?: string;
}

/** What both layouts hand over to the proof and the scoring. */
interface BuiltLayout {
  assembled: AssembledLevel;
  hubShape?: string;
  guards: LevelGuard[];
  motifs: string[];
  pieceMotifs: string[];
}

/**
 * Builds levels from hand-drawn motif pieces (public/configs/motifs.json):
 * ProgressionPlanner picks a focused chain of pieces for the level number,
 * LevelAssembler lays it out with corridors that cannot be skipped, and
 * LevelProver plays the whole level in the game engine. Only a level whose
 * replay ends on the exit with every chip is returned, so every generated
 * level is solvable by construction and by proof. The same seed and level
 * number always give the same level.
 */
export class ProceduralGenerator {
  private static libraryFor: MotifsConfig | null = null;
  private static library: CompiledPiece[] = [];

  /** Returns a fresh pack seed when the caller does not provide one. */
  public static createSeed(): number {
    return Date.now() >>> 0;
  }

  /**
   * Generates a pack. Level ids are proc_<content hash>_<seed>_<n>, so a high
   * score never attaches to a different layout.
   */
  public static generatePack(count?: number, seed: number = this.createSeed()): CompiledLevel[] {
    const total = count || this.config().defaultLevelCount;
    return Array.from({ length: total }, (_, i) => this.generateLevel(i + 1, seed));
  }

  /**
   * Same pack as generatePack, built one level at a time with a pause between
   * levels, so the page keeps painting and can show progress.
   */
  public static async generatePackAsync(
    count: number | undefined,
    seed: number,
    onProgress: (done: number, total: number) => void
  ): Promise<CompiledLevel[]> {
    const total = count || this.config().defaultLevelCount;
    const levels: CompiledLevel[] = [];
    for (let n = 1; n <= total; n++) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      levels.push(this.generateLevel(n, seed));
      onProgress(n, total);
    }
    return levels;
  }

  public static generateLevel(levelNumber: number, seed: number = this.createSeed()): CompiledLevel {
    return this.generateDetailed(levelNumber, seed).level;
  }

  /**
   * Builds the configured number of candidates and keeps the best scoring
   * one. Each candidate has its own random stream (seed, level, candidate
   * index), so a candidate stays the same when the candidate count changes.
   */
  public static generateDetailed(levelNumber: number, seed: number, script?: LevelScript): GeneratedLevel {
    const cfg = this.config();
    let best: GeneratedLevel | null = null;
    for (let k = 0; k < cfg.scoring.candidates; k++) {
      let candidate: GeneratedLevel;
      try {
        candidate = this.generateCandidate(levelNumber, seed, k, script);
      } catch (err) {
        if (err instanceof ProceduralGenerationError) continue;
        throw err;
      }
      if (!best || candidate.score > best.score) best = candidate;
    }
    if (!best) throw new ProceduralGenerationError(levelNumber, 'no candidate could be built');
    return best;
  }

  private static generateCandidate(
    levelNumber: number,
    seed: number,
    candidate: number,
    script?: LevelScript
  ): GeneratedLevel {
    const cfg = this.config();
    const packSeed = seed >>> 0;
    const rng = new SeededRandom(
      SeededRandom.seedFromString(`${packSeed}:${levelNumber}:${candidate}`)
    );
    const motifs = ConfigRegistry.getMotifs();
    const library = this.compiledLibrary(motifs);
    const regionSize = cfg.baseRegionSize + cfg.regionGrowthPerLevel * (levelNumber - 1);
    const version = this.contentVersion(motifs, cfg);

    const layout = script?.layout ?? (levelNumber >= cfg.hub.fromLevel ? 'hub' : 'chain');

    for (let attempt = 0; attempt < cfg.maxGenerationAttempts; attempt++) {
      const built =
        layout === 'hub'
          ? this.buildHub(levelNumber, library, motifs, rng, cfg, script, Math.floor(attempt / cfg.hub.attemptsPerDroppedPiece))
          : this.buildChain(levelNumber, library, motifs, rng, cfg, regionSize + attempt * cfg.regionGrowthPerRetry, script);
      if (!built) continue;
      const { assembled } = built;

      const motif = this.dominantMotif(built.motifs, built.pieceMotifs);
      const level: CompiledLevel = {
        id: `proc_${version}_${packSeed}_${levelNumber}`,
        number: levelNumber,
        theme: cfg.motifThemes[motif],
        titleKey: `${MOTIF_KEY_PREFIX}${motif}${TITLE_KEY_SUFFIX}`,
        hintKey: `${MOTIF_KEY_PREFIX}${motif}${HINT_KEY_SUFFIX}`,
        password: this.generatePassword(packSeed + levelNumber),
        timeLimitSeconds: 0,
        chipsRequired: assembled.chipCount,
        playerStart: { ...assembled.playerStart, dir: 'S' },
        terrain: assembled.terrain,
        items: assembled.items,
        entities: assembled.entities,
        trapLinks: assembled.trapLinks,
        cloneLinks: assembled.cloneLinks
      };
      const proof = LevelProver.prove(level, assembled.route);
      if (!proof.solved) continue;
      // No puzzle may be walked around, checked on every level, not only in tests.
      if (built.guards.some((g) => cellReachableWithout(level, g.box, g.guarded))) continue;

      const puzzleCount = built.pieceMotifs.filter((m) => built.motifs.includes(m)).length;
      level.timeLimitSeconds = this.timeLimit(levelNumber, proof.ticks, puzzleCount, cfg);
      level.solution = encodeActions(proof.moves);
      const scored = scoreLevel(
        {
          level,
          pieceBoxes: assembled.pieceBoxes,
          solutionLength: proof.moves.length,
          visitedCells: proof.visitedCells,
          motifCount: built.motifs.length,
          motifBudget: script ? script.motifs.length : budgetFor(levelNumber, cfg).motifCount,
          walkMoves: proof.walkMoves,
          pieceMoves: proof.pieceMoves
        },
        levelNumber,
        cfg.scoring
      );
      return {
        level,
        solution: proof.moves,
        motifs: built.motifs,
        attempts: attempt + 1,
        score: scored.total,
        walkPerDecision: scored.walkPerDecision,
        pieceBoxes: assembled.pieceBoxes,
        pieceMotifs: built.pieceMotifs,
        guards: built.guards,
        layout,
        hubShape: built.hubShape
      };
    }
    throw new ProceduralGenerationError(levelNumber, `no level after ${cfg.maxGenerationAttempts} attempts`);
  }

  /** A chain of puzzles joined by corridors; every puzzle guards the exit. */
  private static buildChain(
    levelNumber: number,
    library: CompiledPiece[],
    motifs: MotifsConfig,
    rng: SeededRandom,
    cfg: ProceduralConfig,
    regionSize: number,
    script?: LevelScript
  ): BuiltLayout | null {
    const plan = ProgressionPlanner.plan(levelNumber, library, motifs.motifRules ?? {}, rng, script);
    const assembled = LevelAssembler.assemble(plan, regionSize, cfg, rng);
    if (!assembled) return null;
    let exit: { x: number; y: number } = assembled.playerStart;
    assembled.terrain.forEach((row, y) =>
      row.forEach((id, x) => {
        if (ConfigRegistry.getTile(id).isLevelExit) exit = { x, y };
      })
    );
    const pieceMotifs = plan.steps.map((s) => s.piece.motif);
    // The finale holds the exit itself, so it guards nothing.
    const guards = assembled.pieceBoxes.slice(0, -1).map((box) => ({ box, guarded: exit }));
    return { assembled, guards, motifs: plan.motifs, pieceMotifs };
  }

  /** A hub with locked wings; each wing puzzle guards its reward room, the last one the exit. */
  private static buildHub(
    levelNumber: number,
    library: CompiledPiece[],
    motifs: MotifsConfig,
    rng: SeededRandom,
    cfg: ProceduralConfig,
    script?: LevelScript,
    piecesDropped = 0
  ): BuiltLayout | null {
    const plan = HubPlanner.plan(levelNumber, library, motifs.motifRules ?? {}, rng, cfg.hub, script, piecesDropped);
    const assembled = HubAssembler.assemble(plan, cfg.hub, rng);
    if (!assembled) return null;
    const pieceMotifs = [...plan.wings.map((w) => w.piece.motif), plan.finale.motif];
    return { assembled, guards: assembled.guards, motifs: plan.motifs, pieceMotifs, hubShape: assembled.hubShape };
  }

  private static config(): ProceduralConfig {
    const cfg = ConfigRegistry.getGame().procedural;
    if (!cfg) throw new ProceduralGenerationError(0, 'game.json has no procedural section');
    return cfg;
  }

  private static compiledLibrary(motifs: MotifsConfig): CompiledPiece[] {
    if (this.libraryFor !== motifs) {
      const legend = ConfigRegistry.getPieceLegend();
      const annotations = ConfigRegistry.getMotifAnnotations();
      this.library = motifs.pieces.map((def) => compilePiece(def, legend, annotations[def.id]));
      this.libraryFor = motifs;
    }
    return this.library;
  }

  /** The puzzle motif with the most pieces, ties going to the earliest. */
  private static dominantMotif(levelMotifs: string[], pieceMotifs: string[]): string {
    const playable = pieceMotifs.filter((m) => levelMotifs.includes(m));
    const counts = new Map<string, number>();
    for (const motif of playable) counts.set(motif, (counts.get(motif) ?? 0) + 1);
    let best = playable[0];
    for (const motif of playable) {
      if ((counts.get(motif) ?? 0) > (counts.get(best) ?? 0)) best = motif;
    }
    return best;
  }

  /**
   * No limit on the first levels. Then the proven run time, which counts no
   * reading or thinking, is stretched by the slack factor, thinking time is
   * added per puzzle, and the result is rounded up.
   */
  private static timeLimit(
    levelNumber: number,
    ticks: number,
    puzzleCount: number,
    cfg: ProceduralConfig
  ): number {
    if (levelNumber <= cfg.untimedUpToLevel) return 0;
    const runSeconds = ticks / ConfigRegistry.getGame().timing.ticksPerSecond;
    const seconds = runSeconds * cfg.timeSlackFactor + cfg.thinkSecondsPerPiece * puzzleCount;
    const rounded = Math.ceil(seconds / cfg.timeRoundingSeconds) * cfg.timeRoundingSeconds;
    return Math.max(cfg.minTimeLimitSeconds, rounded);
  }

  /**
   * Short hash of everything that shapes a level. It is part of level ids, so
   * a level changed by new pieces or settings never inherits old high scores.
   */
  private static contentVersion(motifs: MotifsConfig, cfg: ProceduralConfig): string {
    const hash = SeededRandom.seedFromString(JSON.stringify({ motifs, cfg }));
    return hash.toString(CONTENT_HASH_RADIX).padStart(CONTENT_HASH_LENGTH, '0');
  }

  private static generatePassword(seed: number): string {
    let n = (Math.imul(seed, PASSWORD_HASH_MULTIPLIER) + PASSWORD_HASH_OFFSET) >>> 0;
    let out = '';
    for (let i = 0; i < PASSWORD_LENGTH; i++) {
      out += PASSWORD_ALPHABET[n % PASSWORD_ALPHABET.length];
      n = Math.floor(n / PASSWORD_ALPHABET.length);
    }
    return out;
  }
}
