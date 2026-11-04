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

import { LevelValidationReport } from '../core/types';

/** The verdicts a finished check gives. */
export type CheckVerdict = 'valid' | 'warnings' | 'errors';

/** What the Check badge shows: a verdict, a check in progress, one abandoned as too slow, one interrupted by leaving the view, or one that failed. */
export type CheckState = CheckVerdict | 'checking' | 'skipped' | 'interrupted' | 'error';

export interface CheckSummary {
  state: CheckVerdict;
  /** Errors when there are any, else warnings, else 0. */
  count: number;
}

/** The one-line verdict of the Check badge: errors win over warnings. */
export function summarizeValidation(report: Pick<LevelValidationReport, 'issues'>): CheckSummary {
  const errors = report.issues.filter((issue) => issue.severity === 'error').length;
  if (errors > 0) return { state: 'errors', count: errors };
  const warnings = report.issues.filter((issue) => issue.severity === 'warning').length;
  if (warnings > 0) return { state: 'warnings', count: warnings };
  return { state: 'valid', count: 0 };
}
