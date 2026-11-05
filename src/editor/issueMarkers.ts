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

import { ValidationIssue } from '../core/types';
import { issueCell } from './issueList';

export type IssueSeverity = ValidationIssue['severity'];

/** The mark drawn on one cell: the worst severity of the issues that name it, and how many name it. */
export interface IssueMarker {
  x: number;
  y: number;
  severity: IssueSeverity;
  count: number;
}

export type MarkerFreshness = 'fresh' | 'stale';

const SEVERITY_RANK: Record<IssueSeverity, number> = { error: 3, warning: 2, info: 1 };

/**
 * One marker per cell that issues name (an issue naming no cell, a fractional cell or one off the grid has none).
 * The marker takes the worst severity of its cell and counts every issue there, info included.
 */
export function buildIssueMarkers(issues: readonly ValidationIssue[], width: number, height: number): IssueMarker[] {
  const byCell = new Map<string, IssueMarker>();
  for (const issue of issues) {
    const cell = issueCell(issue, width, height);
    if (cell === null) continue;
    const key = `${cell.x},${cell.y}`;
    const marker = byCell.get(key);
    if (!marker) {
      byCell.set(key, { x: cell.x, y: cell.y, severity: issue.severity, count: 1 });
      continue;
    }
    marker.count++;
    if (SEVERITY_RANK[issue.severity] > SEVERITY_RANK[marker.severity]) marker.severity = issue.severity;
  }
  return [...byCell.values()];
}

/**
 * Whether the report the markers come from describes the level as it is now: its content key (load and document
 * revision, whatever the language) equals the current one. A language switch changes the check key but not the
 * content, so the markers stay fresh; an edit before the next check makes them stale.
 * There is no check-overlay parameter on purpose: while a check runs or was abandoned, the report we hold still
 * describes its own content, so the content keys alone say whether it matches the level.
 */
export function markerFreshness(reportContentKey: string | null, currentContentKey: string): MarkerFreshness {
  return reportContentKey !== null && reportContentKey === currentContentKey ? 'fresh' : 'stale';
}
