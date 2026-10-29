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
import { budgetFor, ProgressionPlanner } from './ProgressionPlanner';

const LEAD_STREAM = 'lead';
const SHAPE_STREAM = 'shape';

/** Whether level `levelNumber` of a pack is laid out as a hub. */
export function isHubLevel(levelNumber: number, cfg: ProceduralConfig): boolean {
  return levelNumber >= cfg.hub.fromLevel;
}

/**
 * Walks the levels 1..n of a pack, drawing each one's value from the choices
 * the level allows while keeping out the last `window` values. The draw of
 * level k depends only on the pack seed and k, so level n can be rebuilt
 * alone and still agrees with its neighbours.
 */
function drawSequence(
  stream: string,
  seed: number,
  levelNumber: number,
  firstLevel: number,
  window: number,
  choicesFor: (level: number) => string[]
): { value: string | undefined; recent: string[] } {
  const history: string[] = [];
  let value: string | undefined;
  let recent: string[] = [];
  for (let level = firstLevel; level <= levelNumber; level++) {
    const all = choicesFor(level);
    recent = history.slice(-window);
    const fresh = all.filter((c) => !recent.includes(c));
    const pool = fresh.length > 0 ? fresh : all;
    value = undefined;
    if (pool.length > 0) {
      const rng = new SeededRandom(SeededRandom.seedFromString(`${seed >>> 0}:${stream}:${level}`));
      value = pool[rng.nextInt(0, pool.length - 1)];
      history.push(value);
    }
  }
  return { value, recent };
}

/**
 * The lead motif of a level in a pack: the motif its puzzles are built around
 * and its title names. Derived for the whole pack from the seed, so no two
 * levels within the no-repeat window share one.
 */
export function leadMotifFor(
  levelNumber: number,
  seed: number,
  library: CompiledPiece[],
  rules: Record<string, MotifRule>,
  cfg: ProceduralConfig
): string | undefined {
  const motifsAt = (level: number): string[] => {
    const accept = isHubLevel(level, cfg) ? HubPlanner.fitsWing : () => true;
    const pieces = ProgressionPlanner.playablePieces(level, library, rules, budgetFor(level, cfg).maxTier, accept);
    return [...new Set(pieces.map((p) => p.motif))];
  };
  return drawSequence(LEAD_STREAM, seed, levelNumber, 1, cfg.noRepeatWindow, motifsAt).value;
}

/** Hub outlines a hub level may use: the one drawn for it first, then every outline outside the window. */
export interface HubShapeChoice {
  preferred: string | undefined;
  allowed: string[];
}

/**
 * The hub outline of a level in a pack, drawn like the lead motif over the
 * hub levels only. `allowed` is the fallback list for a level whose preferred
 * outline did not fit its wings.
 */
export function hubShapeFor(levelNumber: number, seed: number, cfg: ProceduralConfig): HubShapeChoice {
  const ids = cfg.hub.shapes.map((s) => s.id);
  const { value, recent } = drawSequence(SHAPE_STREAM, seed, levelNumber, cfg.hub.fromLevel, cfg.noRepeatWindow, () => ids);
  const allowed = ids.filter((id) => !recent.includes(id));
  return { preferred: value, allowed: allowed.length > 0 ? allowed : ids };
}
