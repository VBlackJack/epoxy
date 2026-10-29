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
import { it } from 'vitest';
import { ConfigRegistry } from '../src/config/ConfigRegistry';
import { LevelMetrics, LevelMetricsReport } from '../src/core/LevelMetrics';
import { MetricsSummary, summarizeField, summarizeReports } from '../src/core/MetricsSummary';
import { ProceduralGenerator } from '../src/core/ProceduralGenerator';
import { CompiledLevel } from '../src/core/types';
import { DatCodec } from '../src/formats/DatCodec';
import { loadTestConfigs } from '../src/test/loadTestConfigs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_FILE = resolve(ROOT, 'reports', 'level-metrics.json');

/** Seeds of the procedural sample: each seed yields one pack of levels 1 to N. */
const PROCEDURAL_SEEDS = Array.from({ length: 10 }, (_, i) => i + 1);
const PROCEDURAL_LEVELS_PER_SEED = 10;
/** Id prefix the generator gives to a campaign level used as a fallback. */
const FALLBACK_ID_PREFIX = 'proc_fallback_';

interface SetReport {
  summary: MetricsSummary;
  extra?: Record<string, unknown>;
}

function measureAll(levels: CompiledLevel[]): LevelMetricsReport[] {
  return levels.map((level) => LevelMetrics.measure(level));
}

function measureProcedural(): SetReport {
  const levels: CompiledLevel[] = [];
  const durations: number[] = [];
  for (const seed of PROCEDURAL_SEEDS) {
    for (let n = 1; n <= PROCEDURAL_LEVELS_PER_SEED; n++) {
      const started = performance.now();
      levels.push(ProceduralGenerator.generateLevel(n, seed));
      durations.push(performance.now() - started);
    }
  }
  const fallbacks = levels.filter((l) => l.id.startsWith(FALLBACK_ID_PREFIX)).length;
  const generated = levels.filter((l) => !l.id.startsWith(FALLBACK_ID_PREFIX));
  return {
    summary: summarizeReports(measureAll(generated)),
    extra: {
      requested: levels.length,
      fallbackRate: fallbacks / levels.length,
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
