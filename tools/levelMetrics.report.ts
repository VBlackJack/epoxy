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
import { DatCodec } from '../src/formats/DatCodec';
import { exitReachableWithout, replays } from '../src/test/levelChecks';
import { loadTestConfigs } from '../src/test/loadTestConfigs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_FILE = resolve(ROOT, 'reports', 'level-metrics.json');

/** Seeds of the procedural sample: each seed yields one pack of levels 1 to N. */
const PROCEDURAL_SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);
const PROCEDURAL_LEVELS_PER_SEED = 10;

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
  let failures = 0;
  let unproven = 0;
  let bypassable = 0;
  for (const seed of PROCEDURAL_SEEDS) {
    for (let n = 1; n <= PROCEDURAL_LEVELS_PER_SEED; n++) {
      const started = performance.now();
      try {
        const generated = ProceduralGenerator.generateDetailed(n, seed);
        durations.push(performance.now() - started);
        attempts.push(generated.attempts);
        levels.push(generated.level);
        if (!replays(generated.level, generated.solution)) unproven++;
        if (generated.pieceBoxes.slice(0, -1).some((box) => exitReachableWithout(generated.level, box))) {
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
      generationMs: summarizeField(durations)
    }
  };
}

function measurePacks(): Record<string, SetReport> {
  const result: Record<string, SetReport> = {};
  for (const pack of ConfigRegistry.getGame().ultimatePacks ?? []) {
    const buffer = readFileSync(resolve(ROOT, 'public', pack.url));
    const bytes = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    result[pack.id] = { summary: summarizeReports(measureAll(DatCodec.decodeBuffer(bytes, pack.prefix))) };
  }
  return result;
}

it('writes the level metrics report', () => {
  loadTestConfigs();
  const report = {
    procedural: measureProcedural(),
    campaign: { summary: summarizeReports(measureAll(ConfigRegistry.getLevels())) },
    communityPacks: measurePacks()
  };
  mkdirSync(dirname(OUTPUT_FILE), { recursive: true });
  writeFileSync(OUTPUT_FILE, `${JSON.stringify(report, null, 2)}\n`);
});
