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

import { GridPoint, ValidationIssue } from '../core/types';
import { t } from '../i18n/I18nManager';

/**
 * The message without its leading severity word, for a row that already shows the severity as a badge.
 * Only the word of the same severity in the current language is removed, with its colon; any other text is returned as is.
 */
export function stripSeverityPrefix(text: string, severity: ValidationIssue['severity']): string {
  const word = t(`editor.issues.severity.${severity}.label`);
  if (!text.startsWith(word)) return text;
  const rest = text.slice(word.length).match(/^ *: */);
  return rest ? text.slice(word.length + rest[0].length) : text;
}

/** How many issues the list shows before it folds the rest into "and N more". */
export const ISSUE_LIST_CAP = 100;

export interface IssueRow {
  issue: ValidationIssue;
  /** The grid cell the issue points at, or null when it names none that exists. */
  cell: GridPoint | null;
}

export interface IssueRows {
  rows: IssueRow[];
  /** Issues beyond the cap, not shown. */
  hidden: number;
}

/** The in-grid cell an issue names through its x and y parameters, or null (missing, fractional, off the grid). */
export function issueCell(issue: ValidationIssue, width: number, height: number): GridPoint | null {
  const x = issue.params?.x;
  const y = issue.params?.y;
  if (typeof x !== 'number' || typeof y !== 'number') return null;
  if (!Number.isInteger(x) || !Number.isInteger(y)) return null;
  if (x < 0 || y < 0 || x >= width || y >= height) return null;
  return { x, y };
}

/**
 * The issues whose subject cell is (x, y), errors first, then warnings, then info, each group in its original order.
 * An issue that names no cell on the grid belongs to no cell.
 */
export function issuesAtCell(issues: readonly ValidationIssue[], x: number, y: number, width: number, height: number): ValidationIssue[] {
  const here = issues.filter((issue) => {
    const cell = issueCell(issue, width, height);
    return cell !== null && cell.x === x && cell.y === y;
  });
  return [
    ...here.filter((issue) => issue.severity === 'error'),
    ...here.filter((issue) => issue.severity === 'warning'),
    ...here.filter((issue) => issue.severity === 'info')
  ];
}

/** The rows to show: errors first, then warnings, then info, each group in its original order, capped, with the count left out. */
export function issueRows(issues: readonly ValidationIssue[], width: number, height: number, cap: number = ISSUE_LIST_CAP): IssueRows {
  const ordered = [
    ...issues.filter((issue) => issue.severity === 'error'),
    ...issues.filter((issue) => issue.severity === 'warning'),
    ...issues.filter((issue) => issue.severity === 'info')
  ];
  const shown = ordered.slice(0, Math.max(0, cap));
  return {
    rows: shown.map((issue) => ({ issue, cell: issueCell(issue, width, height) })),
    hidden: ordered.length - shown.length
  };
}
