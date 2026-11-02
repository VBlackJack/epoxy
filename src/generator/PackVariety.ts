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

import { SeededRandom } from '../core/Random';
import { ProceduralConfig } from '../core/types';
import { HubPlanner } from './HubPlanner';
import { CompiledPiece, MotifRule } from './PieceTypes';
import { GenerationMode, profileFor } from './DifficultyProfile';
import { ENDLESS_TIER_SPREAD_FROM, MIN_ENDLESS_PUZZLE_MOVES, ProgressionPlanner } from './ProgressionPlanner';

const LEAD_STREAM = 'lead';
const SHAPE_STREAM = 'shape';
const PIECE_COOLDOWN_STREAM = 'piece_cooldown';
const MULTI_PIECE_COHORT_MIN_POOL = 4;
const MULTI_PIECE_COHORT_SIZE = 2;

/** Whether level `levelNumber` is laid out as a hub. */
export function isHubLevel(levelNumber: number, cfg: ProceduralConfig, mode: GenerationMode = 'pack'): boolean {
  return profileFor(mode, levelNumber, cfg).layout === 'hub';
}

/** First level that can be a hub, which is where the hub outline draw starts. */
function firstHubLevel(cfg: ProceduralConfig, mode: GenerationMode): number {
  return mode === 'endless' ? 1 : cfg.hub.fromLevel;
}

/** One level's draw in a pack sequence, with the values kept out of it. */
interface Draw {
  level: number;
  value: string | undefined;
  /** Values drawn for the previous `window` levels. */
  recent: string[];
}

/**
 * Walks the levels firstLevel..lastLevel of a pack, drawing each one's value
 * from the choices the level allows while keeping out the last `window`
 * values. The draw of level k depends only on the pack seed and k, so level n
 * can be rebuilt alone and still agrees with its neighbours.
 */
function drawSequence(
  stream: string,
  seed: number,
  lastLevel: number,
  firstLevel: number,
  window: number,
  choicesFor: (level: number) => string[]
): Draw[] {
  const history: string[] = [];
  const draws: Draw[] = [];
  for (let level = firstLevel; level <= lastLevel; level++) {
    const all = choicesFor(level);
    const recent = history.slice(-window);
    const fresh = all.filter((c) => !recent.includes(c));
    const pool = fresh.length > 0 ? fresh : all;
    let value: string | undefined;
    if (pool.length > 0) {
      const rng = new SeededRandom(SeededRandom.seedFromString(`${seed >>> 0}:${stream}:${level}`));
      value = pool[rng.nextInt(0, pool.length - 1)];
      history.push(value);
    }
    draws.push({ level, value, recent });
  }
  return draws;
}

/**
 * What a level is asked for and what it keeps clear of. `avoid` holds the
 * values drawn for the levels within the window on either side, so a level
 * that falls back from its own draw still differs from its neighbours.
 */
function choiceAt(draws: Draw[], levelNumber: number, window: number): { preferred: string | undefined; avoid: string[] } {
  const own = draws.find((d) => d.level === levelNumber);
  const avoid = draws
    .filter((d) => d.level !== levelNumber && Math.abs(d.level - levelNumber) <= window && d.value !== undefined)
    .map((d) => d.value as string);
  return { preferred: own?.value, avoid: [...new Set(avoid)] };
}

/** The lead motif a level is asked for, and the motifs its neighbours lead with. */
export interface LeadChoice {
  preferred: string | undefined;
  avoid: string[];
}

/**
 * The lead motif of a level in a pack: the motif its puzzles are built around
 * and its title names. Derived for the whole pack from the seed, so no two
 * levels within the no-repeat window share one.
 */
export function leadChoiceFor(
  levelNumber: number,
  seed: number,
  library: CompiledPiece[],
  rules: Record<string, MotifRule>,
  cfg: ProceduralConfig,
  mode: GenerationMode = 'pack'
): LeadChoice {
  // The motifs a level allows depend only on the few profile fields playablePieces
  // reads, and those take few values over any run of levels: compute each once.
  const motifsByProfile = new Map<string, string[]>();
  const motifsAt = (level: number): string[] => {
    const profile = profileFor(mode, level, cfg);
    const isLoop = cfg.hub.loopModes.includes(profile.mode);
    const key = `${profile.layout}|${isLoop}|${profile.maxTier}|${profile.onboarding}|${profile.allowOneShot}`;
    let motifs = motifsByProfile.get(key);
    if (!motifs) {
      const accept =
        profile.layout !== 'hub'
          ? () => true
          : isLoop
            ? (p: CompiledPiece) => HubPlanner.fitsLoopWing(p, cfg.hub)
            : HubPlanner.fitsWing;
      const pieces = ProgressionPlanner.playablePieces(profile, library, rules, profile.maxTier, accept);
      motifs = [...new Set(pieces.map((p) => p.motif))];
      motifsByProfile.set(key, motifs);
    }
    return motifs;
  };
  const last = levelNumber + cfg.noRepeatWindow;
  return choiceAt(drawSequence(LEAD_STREAM, seed, last, 1, cfg.noRepeatWindow, motifsAt), levelNumber, cfg.noRepeatWindow);
}

/** Just the lead motif drawn for the level. */
export function leadMotifFor(
  levelNumber: number,
  seed: number,
  library: CompiledPiece[],
  rules: Record<string, MotifRule>,
  cfg: ProceduralConfig,
  mode: GenerationMode = 'pack'
): string | undefined {
  return leadChoiceFor(levelNumber, seed, library, rules, cfg, mode).preferred;
}

/**
 * Piece ids that endless level `levelNumber` keeps clear of so adjacent levels
 * rotate through each motif's pool and exchange pieces rather than drawing the
 * same rooms back to back. Empty in pack mode, where tiers and motifs ramp up.
 */
export function avoidPiecesFor(
  levelNumber: number,
  seed: number,
  library: CompiledPiece[],
  rules: Record<string, MotifRule>,
  cfg: ProceduralConfig,
  mode: GenerationMode = 'pack'
): string[] {
  if (mode !== 'endless' || levelNumber < 1 || cfg.noRepeatWindow <= 0) return [];
  const profile = profileFor(mode, levelNumber, cfg);
  const accept = (p: CompiledPiece): boolean => HubPlanner.fitsLoopWing(p, cfg.hub);
  const playable = ProgressionPlanner.playablePieces(profile, library, rules, profile.maxTier, accept);
  const motifs = [...new Set(playable.map((p) => p.motif))].sort();
  const avoid = new Set<string>();

  const rotateCohort = (groupKey: string, ids: string[], cohortSize: number): void => {
    if (ids.length <= 1) return;
    const ordered = [...ids].sort();
    const rng = new SeededRandom(SeededRandom.seedFromString(`${seed >>> 0}:${PIECE_COOLDOWN_STREAM}:${groupKey}`));
    rng.shuffle(ordered);
    const cohortAt = (level: number): string[] => {
      const start = ((level - 1) * cohortSize) % ordered.length;
      return Array.from({ length: cohortSize }, (_, i) => ordered[(start + i) % ordered.length]);
    };
    const own = new Set(cohortAt(levelNumber));
    for (let step = 1; step <= cfg.noRepeatWindow; step++) {
      for (const neighbour of [levelNumber - step, levelNumber + step]) {
        if (neighbour < 1) continue;
        for (const id of cohortAt(neighbour)) {
          if (!own.has(id)) avoid.add(id);
        }
      }
    }
  };

  for (const motif of motifs) {
    const candidates = playable.filter((p) => p.motif === motif);
    const substantive = candidates.filter((p) => (p.solution?.length ?? 0) >= MIN_ENDLESS_PUZZLE_MOVES);
    const effective = substantive.length > 0 ? substantive : candidates;
    const highestTier = Math.max(...effective.map((p) => p.tier));
    const minHardTier = highestTier >= ENDLESS_TIER_SPREAD_FROM ? highestTier - 1 : highestTier;
    const wide = profile.preferHard ? effective.filter((p) => p.tier >= minHardTier) : effective;
    const limit = Math.max(cfg.maxPieceDeadEnds, Math.min(...wide.map((p) => p.deadEnds)));
    const tidy = wide.filter((p) => p.deadEnds <= limit).map((p) => p.id);
    const cohortSize = tidy.length >= MULTI_PIECE_COHORT_MIN_POOL ? MULTI_PIECE_COHORT_SIZE : 1;
    rotateCohort(`motif:${motif}`, tidy, cohortSize);
  }

  const exchangePool = library.filter(
    (p) =>
      (p.exports !== null || p.imports !== null) &&
      rules[p.motif]?.role === undefined &&
      p.tier <= profile.maxTier &&
      accept(p)
  );
  const exchangeGroups = new Map<string, string[]>();
  for (const piece of exchangePool) {
    const tag = piece.exports
      ? `exports:${piece.exports.kind}:${piece.exports.item ?? ''}`
      : `imports:${piece.imports?.kind ?? ''}:${piece.imports?.item ?? ''}`;
    const list = exchangeGroups.get(tag) ?? [];
    list.push(piece.id);
    exchangeGroups.set(tag, list);
  }
  for (const [tag, ids] of [...exchangeGroups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    rotateCohort(`exchange:${tag}`, ids, 1);
  }

  return [...avoid];
}

/** Hub outlines a hub level may use: the one drawn for it first, then every outline outside the window. */
export interface HubShapeChoice {
  preferred: string | undefined;
  allowed: string[];
}

/**
 * The hub outline of a level in a pack, drawn like the lead motif over the
 * hub levels only. `allowed` is the fallback list for a level whose preferred
 * outline did not fit its wings: outlines outside the window and not drawn
 * for the neighbouring levels, when any is left.
 */
export function hubShapeFor(
  levelNumber: number,
  seed: number,
  cfg: ProceduralConfig,
  mode: GenerationMode = 'pack'
): HubShapeChoice {
  const ids = cfg.hub.shapes.map((s) => s.id);
  const window = cfg.noRepeatWindow;
  const draws = drawSequence(SHAPE_STREAM, seed, levelNumber + window, firstHubLevel(cfg, mode), window, () => ids);
  const { preferred, avoid } = choiceAt(draws, levelNumber, window);
  const recent = draws.find((d) => d.level === levelNumber)?.recent ?? [];
  const outsideWindow = ids.filter((id) => !recent.includes(id));
  const apart = outsideWindow.filter((id) => !avoid.includes(id));
  const allowed = apart.length > 0 ? apart : outsideWindow;
  return { preferred, allowed: allowed.length > 0 ? allowed : ids };
}
