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
import { ProgressionPlanner } from './ProgressionPlanner';

const LEAD_STREAM = 'lead';
const SHAPE_STREAM = 'shape';

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
  const motifsAt = (level: number): string[] => {
    const profile = profileFor(mode, level, cfg);
    const accept = profile.layout === 'hub' ? HubPlanner.fitsWing : () => true;
    const pieces = ProgressionPlanner.playablePieces(profile, library, rules, profile.maxTier, accept);
    return [...new Set(pieces.map((p) => p.motif))];
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
