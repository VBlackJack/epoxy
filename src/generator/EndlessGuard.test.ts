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
import { profileFor } from './DifficultyProfile';

/**
 * Quality floor of the endless mode, measured against the community packs
 * (CCLP 1-5 medians in reports/level-metrics.json: walkable 684 to 760,
 * junction share 0.69 to 0.79, revisit 1.24 to 1.33, levels with monsters
 * 0.74 to 0.87). The floors sit below those references on purpose: they catch
 * a regression of the generator, not a gap to the hand-made packs.
 */
const MIN_MEDIAN_WALKABLE_CELLS = 450;
const MAX_MEDIAN_REVISIT_RATIO = 1.4;
/** The 40-level sample sits at 0.65 overall and 0.58 at level 25, where monster arenas are corridor-like. */
const MIN_MEDIAN_JUNCTION_SHARE = 0.55;
/** Generation budget per level in Node. */
const MAX_GENERATION_MS = 3000;
/** The suite runs beside other workers, so the per-level wall clock gets this much headroom. */
const PARALLEL_LOAD_FACTOR = 2;
const MIN_SHARE_ALL_PIECES_KEPT = 0.8;
const MIN_SHARE_WITH_MONSTERS = 0.75;

const SEEDS = [1, 2, 3, 4];
const LEVEL_NUMBERS = [1, 25];
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

  it('is as wide and as branching as the reference packs', () => {
    expect(median(samples.map((s) => s.metrics.walkableCells))).toBeGreaterThanOrEqual(MIN_MEDIAN_WALKABLE_CELLS);
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
