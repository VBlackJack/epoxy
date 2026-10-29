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

import { beforeEach, describe, expect, it } from 'vitest';
import { LevelMetrics } from './LevelMetrics';
import { summarizeField, summarizeReports } from './MetricsSummary';
import { buildTestLevel } from '../test/buildTestLevel';
import { loadTestConfigs } from '../test/loadTestConfigs';

describe('summarizeField', () => {
  it('computes mean and percentiles over present values', () => {
    const summary = summarizeField([1, 2, 3, 4, null]);
    expect(summary.mean).toBe(2.5);
    expect(summary.median).toBe(2);
    expect(summary.p10).toBe(1);
    expect(summary.p90).toBe(3);
    expect(summary.nullRate).toBeCloseTo(0.2);
  });

  it('returns nulls for an all-null field', () => {
    const summary = summarizeField([null, null]);
    expect(summary.mean).toBeNull();
    expect(summary.nullRate).toBe(1);
  });
});

describe('summarizeReports', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('aggregates validity and mechanic usage', () => {
    const corridor = LevelMetrics.measure(buildTestLevel(['#####', '#@.E#', '#####']));
    const watery = LevelMetrics.measure(buildTestLevel(['######', '#@W.E#', '######']));
    const summary = summarizeReports([corridor, watery]);
    expect(summary.levelCount).toBe(2);
    expect(summary.mechanicUsage).toContainEqual({ mechanic: 'water', rate: 0.5 });
  });
});
