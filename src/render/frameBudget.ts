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

import { FrameBudgetSettings } from './renderSettings';

/**
 * Watches how long frames take to render. Once a full window of frames averages
 * over the budget, it reports it a single time and starts a fresh window, so the
 * next decision is based on frames rendered after the change it triggered.
 */
export class FrameBudgetGuard {
  private total = 0;
  private count = 0;

  /** Records one frame; returns true when the window just closed over budget. */
  public record(frameMs: number, budget: FrameBudgetSettings): boolean {
    if (!Number.isFinite(frameMs) || frameMs < 0) return false;
    this.total += frameMs;
    this.count++;
    if (this.count < Math.max(1, budget.frameBudgetWindow)) return false;
    const overBudget = this.total / this.count > budget.frameBudgetMs;
    this.reset();
    return overBudget;
  }

  public reset(): void {
    this.total = 0;
    this.count = 0;
  }
}
