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
import { Box, LevelAssembler } from '../generator/LevelAssembler';
import { LevelProver } from '../generator/LevelProver';
import { ProgressionPlanner } from '../generator/ProgressionPlanner';
import { SeededRandom } from './Random';
import { CompiledLevel, Direction, ProceduralConfig } from './types';

const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const PASSWORD_HASH_MULTIPLIER = 7919;
const PASSWORD_HASH_OFFSET = 104729;
const PASSWORD_LENGTH = 4;
const TITLE_KEY_PREFIX = 'levels.procedural.';
const TITLE_KEY_SUFFIX = '.title';
const HINT_KEY = 'levels.procedural.default.hint';

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
  /** Winning move list, proven by replay in the game engine. */
  solution: Direction[];
  /** Motifs the level is built from, in the order they appear. */
  motifs: string[];
  /** Attempts used, 1 when the first layout fitted and proved. */
  attempts: number;
  /** Bounds of every piece, finale last; lets tests check no piece can be skipped. */
  pieceBoxes: Box[];
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
   * Generates a pack. The seed is part of every level id (proc_<seed>_<n>),
   * so a high score never attaches to a different layout.
   */
  public static generatePack(count?: number, seed: number = this.createSeed()): CompiledLevel[] {
    const total = count || this.config().defaultLevelCount;
    return Array.from({ length: total }, (_, i) => this.generateLevel(i + 1, seed));
  }

  public static generateLevel(levelNumber: number, seed: number = this.createSeed()): CompiledLevel {
    return this.generateDetailed(levelNumber, seed).level;
  }

  public static generateDetailed(levelNumber: number, seed: number): GeneratedLevel {
    const cfg = this.config();
    const packSeed = seed >>> 0;
    const rng = new SeededRandom(SeededRandom.seedFromString(`${packSeed}:${levelNumber}`));
    const motifs = ConfigRegistry.getMotifs();
    const library = this.compiledLibrary(motifs);
    const regionSize = cfg.baseRegionSize + cfg.regionGrowthPerLevel * (levelNumber - 1);

    for (let attempt = 0; attempt < cfg.maxGenerationAttempts; attempt++) {
      const plan = ProgressionPlanner.plan(levelNumber, library, motifs.motifRules ?? {}, rng);
      const assembled = LevelAssembler.assemble(
        plan,
        regionSize + attempt * cfg.regionGrowthPerRetry,
        cfg,
        rng
      );
      if (!assembled) continue;

      const level: CompiledLevel = {
        id: `proc_${packSeed}_${levelNumber}`,
        number: levelNumber,
        titleKey: `${TITLE_KEY_PREFIX}${this.dominantMotif(plan.steps.map((s) => s.piece.motif))}${TITLE_KEY_SUFFIX}`,
        hintKey: HINT_KEY,
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

      level.timeLimitSeconds = this.timeLimit(proof.ticks, cfg);
      return {
        level,
        solution: proof.moves,
        motifs: plan.motifs,
        attempts: attempt + 1,
        pieceBoxes: assembled.pieceBoxes
      };
    }
    throw new ProceduralGenerationError(levelNumber, `no level after ${cfg.maxGenerationAttempts} attempts`);
  }

  private static config(): ProceduralConfig {
    const cfg = ConfigRegistry.getGame().procedural;
    if (!cfg) throw new ProceduralGenerationError(0, 'game.json has no procedural section');
    return cfg;
  }

  private static compiledLibrary(motifs: MotifsConfig): CompiledPiece[] {
    if (this.libraryFor !== motifs) {
      const legend = ConfigRegistry.getPieceLegend();
      this.library = motifs.pieces.map((def) => compilePiece(def, legend));
      this.libraryFor = motifs;
    }
    return this.library;
  }

  /** The motif with the most pieces, ties going to the earliest; the finale is ignored. */
  private static dominantMotif(pieceMotifs: string[]): string {
    const playable = pieceMotifs.slice(0, -1);
    const counts = new Map<string, number>();
    for (const motif of playable) counts.set(motif, (counts.get(motif) ?? 0) + 1);
    let best = playable[0];
    for (const motif of playable) {
      if ((counts.get(motif) ?? 0) > (counts.get(best) ?? 0)) best = motif;
    }
    return best;
  }

  /** The proven run time stretched by the slack factor, rounded up. */
  private static timeLimit(ticks: number, cfg: ProceduralConfig): number {
    const seconds = (ticks / ConfigRegistry.getGame().timing.ticksPerSecond) * cfg.timeSlackFactor;
    const rounded = Math.ceil(seconds / cfg.timeRoundingSeconds) * cfg.timeRoundingSeconds;
    return Math.max(cfg.minTimeLimitSeconds, rounded);
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
