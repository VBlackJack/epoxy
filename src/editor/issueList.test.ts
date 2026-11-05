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

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ValidationIssue } from '../core/types';
import { i18n } from '../i18n/I18nManager';
import { issueCell, issueRows, issuesAtCell, stripSeverityPrefix } from './issueList';

const WIDTH = 10;
const HEIGHT = 8;
const CAP = 3;

const error = (key: string, params?: ValidationIssue['params']): ValidationIssue => ({ severity: 'error', i18nKey: key, params });
const warning = (key: string, params?: ValidationIssue['params']): ValidationIssue => ({ severity: 'warning', i18nKey: key, params });

describe('stripSeverityPrefix', () => {
  const WORDS = {
    en: { error: 'Error', warning: 'Warning', info: 'Info' },
    fr: { error: 'Erreur', warning: 'Avertissement', info: 'Info' }
  } as const;

  for (const locale of ['en', 'fr'] as const) {
    describe(locale, () => {
      beforeEach(() => i18n.setLocale(locale));
      afterEach(() => i18n.setLocale('en'));

      it('removes the word of the same severity with its colon', () => {
        for (const severity of ['error', 'warning', 'info'] as const) {
          const word = WORDS[locale][severity];
          expect(stripSeverityPrefix(`${word}: a trap at (5, 9)`, severity)).toBe('a trap at (5, 9)');
          expect(stripSeverityPrefix(`${word} : a trap at (5, 9)`, severity)).toBe('a trap at (5, 9)');
        }
      });

      it('keeps a message that opens with another severity', () => {
        const text = `${WORDS[locale].warning} : a trap at (5, 9)`;
        expect(stripSeverityPrefix(text, 'info')).toBe(text);
        expect(stripSeverityPrefix(text, 'error')).toBe(text);
      });

      it('keeps a message without a prefix, or with the word but no colon', () => {
        expect(stripSeverityPrefix('a trap at (5, 9)', 'info')).toBe('a trap at (5, 9)');
        const noColon = `${WORDS[locale].info} trap at (5, 9)`;
        expect(stripSeverityPrefix(noColon, 'info')).toBe(noColon);
      });
    });
  }
});

describe('issueCell', () => {
  it('returns the cell of an issue that names one inside the grid', () => {
    expect(issueCell(error('a', { x: 3, y: 4 }), WIDTH, HEIGHT)).toEqual({ x: 3, y: 4 });
    expect(issueCell(error('a', { x: 0, y: 0 }), WIDTH, HEIGHT)).toEqual({ x: 0, y: 0 });
    expect(issueCell(error('a', { x: WIDTH - 1, y: HEIGHT - 1 }), WIDTH, HEIGHT)).toEqual({ x: WIDTH - 1, y: HEIGHT - 1 });
  });

  it('returns null without both coordinates', () => {
    expect(issueCell(error('a'), WIDTH, HEIGHT)).toBeNull();
    expect(issueCell(error('a', { x: 3 }), WIDTH, HEIGHT)).toBeNull();
    expect(issueCell(error('a', { x: '3', y: '4' }), WIDTH, HEIGHT)).toBeNull();
  });

  it('returns null for a cell off the grid, fractional or not finite', () => {
    expect(issueCell(error('a', { x: -1, y: 0 }), WIDTH, HEIGHT)).toBeNull();
    expect(issueCell(error('a', { x: WIDTH, y: 0 }), WIDTH, HEIGHT)).toBeNull();
    expect(issueCell(error('a', { x: 0, y: HEIGHT }), WIDTH, HEIGHT)).toBeNull();
    expect(issueCell(error('a', { x: 1.5, y: 2 }), WIDTH, HEIGHT)).toBeNull();
    expect(issueCell(error('a', { x: Number.NaN, y: 2 }), WIDTH, HEIGHT)).toBeNull();
    expect(issueCell(error('a', { x: Number.POSITIVE_INFINITY, y: 2 }), WIDTH, HEIGHT)).toBeNull();
  });
});

describe('issuesAtCell', () => {
  it('keeps the issues whose subject is the cell, errors first', () => {
    const info: ValidationIssue = { severity: 'info', i18nKey: 'i1', params: { x: 2, y: 2 } };
    const issues = [info, warning('w1', { x: 2, y: 2 }), error('other', { x: 3, y: 2 }), error('e1', { x: 2, y: 2 }), error('none')];
    expect(issuesAtCell(issues, 2, 2, WIDTH, HEIGHT).map((issue) => issue.i18nKey)).toEqual(['e1', 'w1', 'i1']);
  });

  it('is empty for a cell no issue names, and for an issue off the grid', () => {
    expect(issuesAtCell([error('e1', { x: 2, y: 2 })], 0, 0, WIDTH, HEIGHT)).toEqual([]);
    expect(issuesAtCell([error('e1', { x: 99, y: 99 })], 99, 99, WIDTH, HEIGHT)).toEqual([]);
    expect(issuesAtCell([], 1, 1, WIDTH, HEIGHT)).toEqual([]);
  });
});

describe('issueRows', () => {
  it('puts info after warnings', () => {
    const info: ValidationIssue = { severity: 'info', i18nKey: 'i1' };
    const { rows } = issueRows([info, warning('w1'), error('e1')], WIDTH, HEIGHT);
    expect(rows.map((row) => row.issue.i18nKey)).toEqual(['e1', 'w1', 'i1']);
  });

  it('puts errors first and keeps the order inside each group', () => {
    const issues = [warning('w1'), error('e1'), warning('w2'), error('e2')];
    const { rows, hidden } = issueRows(issues, WIDTH, HEIGHT);
    expect(rows.map((row) => row.issue.i18nKey)).toEqual(['e1', 'e2', 'w1', 'w2']);
    expect(hidden).toBe(0);
  });

  it('carries the cell of each row', () => {
    const { rows } = issueRows([error('e1', { x: 1, y: 2 }), error('e2', { x: 99, y: 2 })], WIDTH, HEIGHT);
    expect(rows[0].cell).toEqual({ x: 1, y: 2 });
    expect(rows[1].cell).toBeNull();
  });

  it('caps the rows and counts what is left out', () => {
    const issues = [warning('w1'), error('e1'), error('e2'), error('e3'), error('e4')];
    const { rows, hidden } = issueRows(issues, WIDTH, HEIGHT, CAP);
    expect(rows.map((row) => row.issue.i18nKey)).toEqual(['e1', 'e2', 'e3']);
    expect(hidden).toBe(2);
  });

  it('handles an empty list', () => {
    expect(issueRows([], WIDTH, HEIGHT)).toEqual({ rows: [], hidden: 0 });
  });
});
