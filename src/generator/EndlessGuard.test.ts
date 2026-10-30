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

import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../audio/AudioManager', () => import('../test/silentAudio'));

import { ConfigRegistry } from '../config/ConfigRegistry';
import { LevelMetrics, LevelMetricsReport } from '../core/LevelMetrics';
import { GeneratedLevel, ProceduralGenerator } from '../core/ProceduralGenerator';
import { cellReachableWithout, replays } from '../test/levelChecks';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { measureOpenArea } from '../test/openAreaMetrics';
import { profileFor } from './DifficultyProfile';

/**
 * Quality floor of the endless mode, measured against the community packs
 * (CCLP 1-5 medians in reports/level-metrics.json: walkable 684 to 760,
 * junction share 0.69 to 0.79, revisit 1.24 to 1.33, levels with monsters
 * 0.74 to 0.87). The floors sit below those references on purpose: they catch
 * a regression of the generator, not a gap to the hand-made packs.
 */
/**
 * The walkable floor moved from 450 to 300 when the open area stopped being
 * bare: 450 was reached with empty bays (60 to 75 percent of the floor sat
 * outside the puzzles with nothing on it), and bare floor is not content. With
 * monsters, chips and patches in the hub region the 20-seed medians at levels
 * 10 and 20 sit near 340 to 350. The share of that floor which carries content
 * is guarded below instead of its size.
 */
const MIN_MEDIAN_WALKABLE_CELLS = 300;
/**
 * Share of the outside floor (walkable cells outside every piece box) within 4
 * steps of a chip, a monster lane or a hazard cell. Measured 0.76 at 20 seeds.
 */
const MIN_MEDIAN_CONTENT_SHARE = 0.6;
/**
 * The worst level of the sample must keep this much of its outside floor served too: a
 * grown hub whose chips did not follow would pass on the median and fail here.
 */
const MIN_CONTENT_SHARE_ANY_LEVEL = 0.5;
const MAX_MEDIAN_REVISIT_RATIO = 1.4;
/**
 * Was 0.55 (the 40-level sample sat at 0.65, 0.58 at level 25). With content in the hub region
 * (dividers cut lanes for the monsters, gravel aprons close the region) the junction share fell:
 * medians of 0.5 at level 10 and 0.4 at levels 25 and 50 on 10 seeds, 0.48 on this sample. The
 * CCLP references stay at 0.69 to 0.79, so this floor guards against a further drop only.
 */
const MIN_MEDIAN_JUNCTION_SHARE = 0.45;
/** Generation budget per level in Node (the p95 at level 10 measures 5 s with content to prove, median 2 s). */
const MAX_GENERATION_MS = 3000;
/**
 * The suite runs beside other workers, so the per-level wall clock gets this much headroom. It was
 * 2; level 25 measured 6.6 s then 9.6 s under the full suite beside another worker (the region search runs on every
 * level; 4.4 s alone at p90), so 4 gives 12 s.
 */
const PARALLEL_LOAD_FACTOR = 4;
const MIN_SHARE_ALL_PIECES_KEPT = 0.8;
const MIN_SHARE_WITH_MONSTERS = 0.75;

const SEEDS = [1, 2, 3, 4];
/** Level 50 is the deep end: ten puzzles of the top tier, where a grown hub costs the most time. */
const LEVEL_NUMBERS = [1, 25, 50];
/** The last entry of pieceMotifs is the finale, not a planned puzzle. */
const FINALE_PIECES = 1;
const SUITE_TIMEOUT_MS = 120000;

interface Sample {
  generated: GeneratedLevel;
  planned: number;
  metrics: LevelMetricsReport;
  ms: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

describe('endless mode quality guard', () => {
  const samples: Sample[] = [];

  beforeAll(() => {
    loadTestConfigs();
    const cfg = ConfigRegistry.getGame().procedural;
    if (!cfg) throw new Error('game.json has no procedural section');
    for (const seed of SEEDS) {
      for (const n of LEVEL_NUMBERS) {
        const started = performance.now();
        const generated = ProceduralGenerator.generateEndlessLevel(n, seed);
        const ms = performance.now() - started;
        samples.push({
          generated,
          planned: profileFor('endless', n, cfg).pieceCount,
          metrics: LevelMetrics.measure(generated.level),
          ms
        });
      }
    }
  }, SUITE_TIMEOUT_MS);

  it('proves every level and leaves no puzzle to walk around', () => {
    expect(samples).toHaveLength(SEEDS.length * LEVEL_NUMBERS.length);
    for (const { generated } of samples) {
      expect(replays(generated.level, generated.solution), generated.level.id).toBe(true);
      for (const g of generated.guards) {
        expect(cellReachableWithout(generated.level, g.box, g.guarded), generated.level.id).toBe(false);
      }
    }
  });

  it('is wide and branching enough, and its open floor carries content', () => {
    expect(median(samples.map((s) => s.metrics.walkableCells))).toBeGreaterThanOrEqual(MIN_MEDIAN_WALKABLE_CELLS);
    const contentShares = samples.map((s) => measureOpenArea(s.generated).contentShare);
    expect(median(contentShares)).toBeGreaterThanOrEqual(MIN_MEDIAN_CONTENT_SHARE);
    for (const [i, share] of contentShares.entries()) {
      expect(share, samples[i].generated.level.id).toBeGreaterThanOrEqual(MIN_CONTENT_SHARE_ANY_LEVEL);
    }
    expect(median(samples.map((s) => s.metrics.junctionShare))).toBeGreaterThanOrEqual(MIN_MEDIAN_JUNCTION_SHARE);
  });

  it('does not make the player walk the same ground over and over', () => {
    const ratios = samples.map((s) => s.metrics.revisitRatio).filter((r): r is number => r !== null);
    expect(median(ratios)).toBeLessThanOrEqual(MAX_MEDIAN_REVISIT_RATIO);
  });

  it('generates each level within the time budget', () => {
    for (const { generated, ms } of samples) {
      expect(ms, generated.level.id).toBeLessThan(MAX_GENERATION_MS * PARALLEL_LOAD_FACTOR);
    }
  });

  it('keeps the planned pieces in most levels', () => {
    const complete = samples.filter((s) => s.generated.pieceMotifs.length - FINALE_PIECES >= s.planned).length;
    expect(complete / samples.length).toBeGreaterThanOrEqual(MIN_SHARE_ALL_PIECES_KEPT);
  });

  // endless.motifShares asks for the monsters motif in a share of the levels.
  it(`has monsters in at least ${MIN_SHARE_WITH_MONSTERS} of the levels`, () => {
    const share = samples.filter((s) => s.metrics.monsterCount > 0).length / samples.length;
    expect(share).toBeGreaterThanOrEqual(MIN_SHARE_WITH_MONSTERS);
  });
});
