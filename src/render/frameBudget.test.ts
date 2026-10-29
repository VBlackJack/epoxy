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

import { describe, expect, it } from 'vitest';
import { FrameBudgetGuard } from './frameBudget';

const BUDGET = { frameBudgetMs: 10, frameBudgetWindow: 4 };

describe('FrameBudgetGuard', () => {
  it('decides only once a full window has been recorded', () => {
    const guard = new FrameBudgetGuard();
    expect([30, 30, 30].map((ms) => guard.record(ms, BUDGET))).toEqual([false, false, false]);
    expect(guard.record(30, BUDGET)).toBe(true);
  });

  it('judges the average, not single slow frames', () => {
    const guard = new FrameBudgetGuard();
    const results = [2, 2, 2, 30].map((ms) => guard.record(ms, BUDGET));
    expect(results).toEqual([false, false, false, false]);
  });

  it('starts a fresh window after each decision', () => {
    const guard = new FrameBudgetGuard();
    for (let i = 0; i < 3; i++) guard.record(30, BUDGET);
    expect(guard.record(30, BUDGET)).toBe(true);
    for (let i = 0; i < 3; i++) expect(guard.record(1, BUDGET)).toBe(false);
    expect(guard.record(1, BUDGET)).toBe(false);
  });

  it('ignores invalid samples', () => {
    const guard = new FrameBudgetGuard();
    expect(guard.record(Number.NaN, BUDGET)).toBe(false);
    expect(guard.record(-5, BUDGET)).toBe(false);
    for (let i = 0; i < 3; i++) guard.record(30, BUDGET);
    expect(guard.record(30, BUDGET)).toBe(true);
  });
});
