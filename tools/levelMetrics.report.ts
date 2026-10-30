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
 * Measures level quality for the procedural generator, the Epoxy campaign and
 * the bundled community packs, and writes the summaries to
 * reports/level-metrics.json. Community packs are the human-made reference
 * the generator is compared against.
 *
 * Run with: npm run report:levels
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { it, vi } from 'vitest';

vi.mock('../src/audio/AudioManager', () => import('../src/test/silentAudio'));

import { ConfigRegistry } from '../src/config/ConfigRegistry';
import { LevelMetrics, LevelMetricsReport } from '../src/core/LevelMetrics';
import { MetricsSummary, summarizeField, summarizeReports } from '../src/core/MetricsSummary';
import { ProceduralGenerator } from '../src/core/ProceduralGenerator';
import { CompiledLevel } from '../src/core/types';
import { profileFor } from '../src/generator/DifficultyProfile';
import { DatCodec } from '../src/formats/DatCodec';
import { cellReachableWithout, replays } from '../src/test/levelChecks';
import { loadTestConfigs } from '../src/test/loadTestConfigs';

/** The whole report takes several minutes. */
const REPORT_TIMEOUT_MS = 1_800_000;

/** The finale is the last piece of pieceMotifs and is not a planned puzzle. */
const FINALE_PIECES = 1;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_FILE = resolve(ROOT, 'reports', 'level-metrics.json');

/** Seeds of the procedural sample: each seed yields one pack of levels 1 to N. */
const PROCEDURAL_SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);
const PROCEDURAL_LEVELS_PER_SEED = 10;

/** Endless sample: seeds 1 to 10 at these level numbers (level 1 is already full difficulty). */
const ENDLESS_SEEDS = Array.from({ length: 10 }, (_, i) => i + 1);
const ENDLESS_LEVEL_NUMBERS = [1, 10, 25, 50];

interface SetReport {
  summary: MetricsSummary;
  extra?: Record<string, unknown>;
}

function measureAll(levels: CompiledLevel[]): LevelMetricsReport[] {
  return levels.map((level) => LevelMetrics.measure(level));
}

/**
 * Generates the sample and checks every level independently of the
 * generator: its solution must win in a fresh engine, and walling off any
 * piece must cut the exit off.
 */
function measureProcedural(): SetReport {
  const levels: CompiledLevel[] = [];
  const durations: number[] = [];
  const attempts: number[] = [];
  const walkPerDecision: number[] = [];
  let repeatedLeads = 0;
  const hubShapes: Record<string, number> = {};
  const themes: Record<string, number> = {};
  let failures = 0;
  let unproven = 0;
  let bypassable = 0;
  for (const seed of PROCEDURAL_SEEDS) {
    let previousLead = '';
    for (let n = 1; n <= PROCEDURAL_LEVELS_PER_SEED; n++) {
      const started = performance.now();
      try {
        const generated = ProceduralGenerator.generateDetailed(n, seed);
        durations.push(performance.now() - started);
        attempts.push(generated.attempts);
        walkPerDecision.push(generated.walkPerDecision);
        const lead = generated.motifs[0] ?? '';
        if (lead === previousLead) repeatedLeads++;
        previousLead = lead;
        if (generated.hubShape) hubShapes[generated.hubShape] = (hubShapes[generated.hubShape] ?? 0) + 1;
        const theme = generated.level.theme ?? 'default';
        themes[theme] = (themes[theme] ?? 0) + 1;
        levels.push(generated.level);
        if (!replays(generated.level, generated.solution)) unproven++;
        if (generated.guards.some((g) => cellReachableWithout(generated.level, g.box, g.guarded))) {
          bypassable++;
        }
      } catch {
        failures++;
      }
    }
  }
  return {
    summary: summarizeReports(measureAll(levels)),
    extra: {
      requested: PROCEDURAL_SEEDS.length * PROCEDURAL_LEVELS_PER_SEED,
      generationFailures: failures,
      unprovenLevels: unproven,
      bypassableLevels: bypassable,
      attempts: summarizeField(attempts),
      walkPerDecision: summarizeField(walkPerDecision),
      consecutiveSameLeadMotif: repeatedLeads,
      hubShapes,
      themes,
      generationMs: summarizeField(durations)
    }
  };
}

/** Accumulates the endless sample of one level number, or of all of them. */
interface EndlessBucket {
  levels: CompiledLevel[];
  durations: number[];
  plannedPieces: number[];
  keptPieces: number[];
  monsterCounts: number[];
  motifUsage: Record<string, number>;
  failures: number;
  unproven: number;
  bypassable: number;
  allPlannedKept: number;
}

function newBucket(): EndlessBucket {
  return {
    levels: [],
    durations: [],
    plannedPieces: [],
    keptPieces: [],
    monsterCounts: [],
    motifUsage: {},
    failures: 0,
    unproven: 0,
    bypassable: 0,
    allPlannedKept: 0
  };
}

function reportBucket(bucket: EndlessBucket, requested: number): SetReport {
  const metrics = measureAll(bucket.levels);
  const withMonsters = metrics.filter((m) => m.monsterCount > 0);
  return {
    summary: summarizeReports(metrics),
    extra: {
      requested,
      generationFailures: bucket.failures,
      unprovenLevels: bucket.unproven,
      bypassableLevels: bucket.bypassable,
      plannedPieces: summarizeField(bucket.plannedPieces),
      keptPieces: summarizeField(bucket.keptPieces),
      shareAllPlannedPiecesKept: bucket.levels.length > 0 ? bucket.allPlannedKept / bucket.levels.length : null,
      shareWithMonsters: bucket.levels.length > 0 ? withMonsters.length / bucket.levels.length : null,
      monsterCountWhereAny: summarizeField(withMonsters.map((m) => m.monsterCount)),
      motifUsage: Object.fromEntries(
        Object.entries(bucket.motifUsage)
          .sort((a, b) => b[1] - a[1])
          .map(([motif, count]) => [motif, count / Math.max(1, bucket.levels.length)])
      ),
      generationMs: summarizeField(bucket.durations)
    }
  };
}

/**
 * Endless mode at levels 1, 10, 25 and 50, checked like the procedural sample
 * (replay, no bypass), with the planned and kept piece counts, the monsters,
 * the motifs and a sub-summary per level number.
 */
function measureEndless(): SetReport & { byLevel: Record<string, SetReport> } {
  const cfg = ConfigRegistry.getGame().procedural;
  if (!cfg) throw new Error('game.json has no procedural section');
  const total = newBucket();
  const perLevel = new Map<number, EndlessBucket>(ENDLESS_LEVEL_NUMBERS.map((n) => [n, newBucket()]));
  for (const seed of ENDLESS_SEEDS) {
    for (const n of ENDLESS_LEVEL_NUMBERS) {
      const bucket = perLevel.get(n) as EndlessBucket;
      const started = performance.now();
      try {
        const generated = ProceduralGenerator.generateEndlessLevel(n, seed);
        const elapsed = performance.now() - started;
        const planned = profileFor('endless', n, cfg).pieceCount;
        const kept = generated.pieceMotifs.length - FINALE_PIECES;
        const proven = replays(generated.level, generated.solution);
        const bypassable = generated.guards.some((g) => cellReachableWithout(generated.level, g.box, g.guarded));
        for (const target of [bucket, total]) {
          target.levels.push(generated.level);
          target.durations.push(elapsed);
          target.plannedPieces.push(planned);
          target.keptPieces.push(kept);
          if (kept >= planned) target.allPlannedKept++;
          if (!proven) target.unproven++;
          if (bypassable) target.bypassable++;
          for (const motif of new Set(generated.motifs)) {
            target.motifUsage[motif] = (target.motifUsage[motif] ?? 0) + 1;
          }
        }
      } catch {
        bucket.failures++;
        total.failures++;
      }
    }
  }
  const byLevel: Record<string, SetReport> = {};
  for (const [n, bucket] of perLevel) byLevel[`level${n}`] = reportBucket(bucket, ENDLESS_SEEDS.length);
  return {
    ...reportBucket(total, ENDLESS_SEEDS.length * ENDLESS_LEVEL_NUMBERS.length),
    byLevel
  };
}

function measurePacks(): Record<string, SetReport> {
  const result: Record<string, SetReport> = {};
  for (const pack of ConfigRegistry.getGame().ultimatePacks ?? []) {
    const buffer = readFileSync(resolve(ROOT, 'public', pack.url));
    const bytes = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    result[pack.id] = {
      summary: summarizeReports(measureAll(DatCodec.decodeBuffer(bytes, pack.prefix)))
    };
  }
  return result;
}

it('writes the level metrics report', { timeout: REPORT_TIMEOUT_MS }, () => {
  loadTestConfigs();
  const report = {
    procedural: measureProcedural(),
    endless: measureEndless(),
    campaign: {
      summary: summarizeReports(measureAll(ConfigRegistry.getLevels()))
    },
    communityPacks: measurePacks()
  };
  mkdirSync(dirname(OUTPUT_FILE), { recursive: true });
  writeFileSync(OUTPUT_FILE, `${JSON.stringify(report, null, 2)}\n`);
});
