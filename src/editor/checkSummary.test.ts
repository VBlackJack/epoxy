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
import { summarizeValidation } from './checkSummary';
import type { ValidationIssue } from '../core/types';

const issue = (severity: ValidationIssue['severity']): ValidationIssue => ({ severity, i18nKey: 'test.key' });

describe('summarizeValidation', () => {
  it('stays valid when only info issues are present', () => {
    expect(summarizeValidation({ issues: [issue('info'), issue('info')] })).toEqual({ state: 'valid', count: 0 });
  });

  it('reports warnings, ignoring info issues in the count', () => {
    expect(summarizeValidation({ issues: [issue('info'), issue('warning')] })).toEqual({ state: 'warnings', count: 1 });
  });

  it('lets errors win over warnings', () => {
    expect(summarizeValidation({ issues: [issue('warning'), issue('error'), issue('info')] })).toEqual({
      state: 'errors',
      count: 1
    });
  });
});
