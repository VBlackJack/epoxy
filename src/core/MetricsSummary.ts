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

import { LevelMetricsReport } from './LevelMetrics';

/** Numeric fields of a metrics report that a summary aggregates. */
export const SUMMARIZED_FIELDS = [
  'usedAreaRatio',
  'walkableCells',
  'deadEndRatio',
  'estimatedSolutionSteps',
  'revisitRatio',
  'tourCoverageRatio',
  'mechanicCount',
  'chipsPlaced',
  'chipsRequired',
  'chipSpread',
  'monsterCount',
  'hasMonsters',
  'playfieldCells',
  'playfieldFill',
  'openShare',
  'deadShare',
  'junctionShare',
  'symmetry',
  'timeSlackRatio'
] as const satisfies readonly (keyof LevelMetricsReport)[];

export type SummarizedField = (typeof SUMMARIZED_FIELDS)[number];

const LOW_PERCENTILE = 0.1;
const MEDIAN_PERCENTILE = 0.5;
const HIGH_PERCENTILE = 0.9;

export interface FieldSummary {
  mean: number | null;
  p10: number | null;
  median: number | null;
  p90: number | null;
  /** Share of levels for which the field is null (no tour, no time limit). */
  nullRate: number;
}

export interface MetricsSummary {
  levelCount: number;
  validRate: number;
  fields: Record<SummarizedField, FieldSummary>;
  /** Share of levels using each mechanic, sorted from most to least used. */
  mechanicUsage: Array<{ mechanic: string; rate: number }>;
}

function percentile(sorted: number[], fraction: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.floor(fraction * (sorted.length - 1)));
  return sorted[index];
}

export function summarizeField(values: (number | null)[]): FieldSummary {
  const present = values.filter((v): v is number => v !== null).sort((a, b) => a - b);
  return {
    mean: present.length > 0 ? present.reduce((sum, v) => sum + v, 0) / present.length : null,
    p10: percentile(present, LOW_PERCENTILE),
    median: percentile(present, MEDIAN_PERCENTILE),
    p90: percentile(present, HIGH_PERCENTILE),
    nullRate: values.length > 0 ? (values.length - present.length) / values.length : 0
  };
}

export function summarizeReports(reports: LevelMetricsReport[]): MetricsSummary {
  const count = reports.length;
  const fields = Object.fromEntries(
    SUMMARIZED_FIELDS.map((field) => [field, summarizeField(reports.map((r) => r[field]))])
  ) as Record<SummarizedField, FieldSummary>;

  const usage = new Map<string, number>();
  for (const report of reports) {
    for (const mechanic of report.mechanics) usage.set(mechanic, (usage.get(mechanic) ?? 0) + 1);
  }

  return {
    levelCount: count,
    validRate: count > 0 ? reports.filter((r) => r.valid).length / count : 0,
    fields,
    mechanicUsage: [...usage.entries()]
      .map(([mechanic, used]) => ({ mechanic, rate: used / count }))
      .sort((a, b) => b.rate - a.rate)
  };
}
