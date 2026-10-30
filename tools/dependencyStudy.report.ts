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

/**
 * Measures the inter-piece dependencies of the endless mode: for a sample of
 * seeds at two level numbers, the share of levels holding at least one
 * exporter and consumer pair, the pairs by kind, the proof and bypass checks,
 * the generation time and the quality floors of EndlessGuard.test.ts. Writes
 * local/dependency-study.json (the folder is not versioned).
 *
 * Run with: npm run report:dependencies
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { it, vi } from 'vitest';

vi.mock('../src/audio/AudioManager', () => import('../src/test/silentAudio'));

import { ConfigRegistry } from '../src/config/ConfigRegistry';
import { LevelMetrics } from '../src/core/LevelMetrics';
import { ProceduralGenerator } from '../src/core/ProceduralGenerator';
import { profileFor } from '../src/generator/DifficultyProfile';
import { cellReachableWithout, replays } from '../src/test/levelChecks';
import { loadTestConfigs } from '../src/test/loadTestConfigs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_FILE = resolve(ROOT, 'local', 'dependency-study.json');
const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);
const LEVEL_NUMBERS = [10, 20];
/** The last entry of pieceMotifs is the finale, not a planned puzzle. */
const FINALE_PIECES = 1;
const P95 = 0.95;
const JSON_INDENT = 2;

interface Bucket {
  requested: number;
  generated: number;
  failures: number;
  withPairs: number;
  pairsByKind: Record<string, number>;
  unproven: number;
  bypassable: number;
  allPlannedKept: number;
  withMonsters: number;
  durations: number[];
  walkable: number[];
  revisit: number[];
  junction: number[];
}

function newBucket(): Bucket {
  return {
    requested: 0,
    generated: 0,
    failures: 0,
    withPairs: 0,
    pairsByKind: {},
    unproven: 0,
    bypassable: 0,
    allPlannedKept: 0,
    withMonsters: 0,
    durations: [],
    walkable: [],
    revisit: [],
    junction: []
  };
}

function quantile(values: number[], q: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))];
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

function report(bucket: Bucket): Record<string, unknown> {
  const n = Math.max(1, bucket.generated);
  return {
    requested: bucket.requested,
    generated: bucket.generated,
    generationFailures: bucket.failures,
    shareWithDependencyPair: bucket.withPairs / n,
    pairsByKind: bucket.pairsByKind,
    unprovenLevels: bucket.unproven,
    bypassableLevels: bucket.bypassable,
    shareAllPlannedPiecesKept: bucket.allPlannedKept / n,
    shareWithMonsters: bucket.withMonsters / n,
    generationMs: { median: median(bucket.durations), p95: quantile(bucket.durations, P95), max: Math.max(...bucket.durations) },
    medianWalkableCells: median(bucket.walkable),
    medianRevisitRatio: median(bucket.revisit),
    medianJunctionShare: median(bucket.junction)
  };
}

it('measures the dependency pairs of endless levels', () => {
  loadTestConfigs();
  const cfg = ConfigRegistry.getGame().procedural;
  if (!cfg) throw new Error('game.json has no procedural section');
  const total = newBucket();
  const perLevel = new Map<number, Bucket>(LEVEL_NUMBERS.map((n) => [n, newBucket()]));
  for (const seed of SEEDS) {
    for (const n of LEVEL_NUMBERS) {
      const bucket = perLevel.get(n) as Bucket;
      const targets = [bucket, total];
      for (const t of targets) t.requested++;
      const started = performance.now();
      try {
        const generated = ProceduralGenerator.generateEndlessLevel(n, seed);
        const elapsed = performance.now() - started;
        const planned = profileFor('endless', n, cfg).pieceCount;
        const kept = generated.pieceMotifs.length - FINALE_PIECES;
        const metrics = LevelMetrics.measure(generated.level);
        const proven = replays(generated.level, generated.solution);
        const bypassable = generated.guards.some((g) => cellReachableWithout(generated.level, g.box, g.guarded));
        for (const t of targets) {
          t.generated++;
          t.durations.push(elapsed);
          if (generated.dependencies.length > 0) t.withPairs++;
          for (const dep of generated.dependencies) t.pairsByKind[dep.kind] = (t.pairsByKind[dep.kind] ?? 0) + 1;
          if (!proven) t.unproven++;
          if (bypassable) t.bypassable++;
          if (kept >= planned) t.allPlannedKept++;
          if (metrics.monsterCount > 0) t.withMonsters++;
          t.walkable.push(metrics.walkableCells);
          if (metrics.revisitRatio !== null) t.revisit.push(metrics.revisitRatio);
          t.junction.push(metrics.junctionShare);
        }
      } catch {
        for (const t of targets) t.failures++;
      }
    }
  }
  const byLevel: Record<string, unknown> = {};
  for (const [n, bucket] of perLevel) byLevel[`level${n}`] = report(bucket);
  const result = { generatedAt: new Date().toISOString(), seeds: SEEDS.length, levels: LEVEL_NUMBERS, all: report(total), byLevel };
  mkdirSync(dirname(OUTPUT_FILE), { recursive: true });
  writeFileSync(OUTPUT_FILE, `${JSON.stringify(result, null, JSON_INDENT)}\n`);
});
