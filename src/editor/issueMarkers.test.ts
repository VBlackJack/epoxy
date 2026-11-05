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
import { ValidationIssue } from '../core/types';
import { buildIssueMarkers, markerFreshness } from './issueMarkers';

const WIDTH = 10;
const HEIGHT = 8;

const issue = (severity: ValidationIssue['severity'], params?: ValidationIssue['params']): ValidationIssue => ({
  severity,
  i18nKey: 'k',
  params
});

describe('buildIssueMarkers', () => {
  it('makes one marker per cell with the worst severity and the summed count', () => {
    const markers = buildIssueMarkers(
      [issue('info', { x: 2, y: 3 }), issue('error', { x: 2, y: 3 }), issue('warning', { x: 2, y: 3 }), issue('warning', { x: 5, y: 1 })],
      WIDTH,
      HEIGHT
    );
    expect(markers).toHaveLength(2);
    expect(markers.find((m) => m.x === 2 && m.y === 3)).toEqual({ x: 2, y: 3, severity: 'error', count: 3 });
    expect(markers.find((m) => m.x === 5 && m.y === 1)).toEqual({ x: 5, y: 1, severity: 'warning', count: 1 });
  });

  it('keeps a lone info issue', () => {
    expect(buildIssueMarkers([issue('info', { x: 1, y: 1 })], WIDTH, HEIGHT)).toEqual([{ x: 1, y: 1, severity: 'info', count: 1 }]);
  });

  it('drops issues that name no cell, a fractional cell or a cell off the grid', () => {
    const markers = buildIssueMarkers(
      [issue('error'), issue('error', { x: 1.5, y: 2 }), issue('error', { x: WIDTH, y: 0 }), issue('error', { x: -1, y: 0 }), issue('error', { x: 0, y: HEIGHT })],
      WIDTH,
      HEIGHT
    );
    expect(markers).toEqual([]);
  });

  it('does not let a lower severity lower the marker', () => {
    const markers = buildIssueMarkers([issue('warning', { x: 0, y: 0 }), issue('info', { x: 0, y: 0 })], WIDTH, HEIGHT);
    expect(markers).toEqual([{ x: 0, y: 0, severity: 'warning', count: 2 }]);
  });
});

describe('markerFreshness', () => {
  it('is fresh when the report is for the current content', () => {
    expect(markerFreshness('3:7', '3:7')).toBe('fresh');
  });

  it('is stale after an edit or another load', () => {
    expect(markerFreshness('3:7', '3:8')).toBe('stale');
    expect(markerFreshness('3:7', '4:7')).toBe('stale');
  });

  it('is stale without a report', () => {
    expect(markerFreshness(null, '3:7')).toBe('stale');
  });
});
