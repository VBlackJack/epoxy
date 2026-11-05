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
import { ConfigRegistry } from '../config/ConfigRegistry';
import { i18n, t } from '../i18n/I18nManager';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { formatValidationIssue } from './validatorIssueText';

describe('formatValidationIssue', () => {
  beforeEach(() => {
    loadTestConfigs();
    i18n.setLocale('en');
  });

  it('shows a key parameter by the tile name, not by its id', () => {
    const text = formatValidationIssue({
      severity: 'warning',
      i18nKey: 'validator.issues.fewer_keys_than_doors.label',
      params: { key: 'key_yellow', keys: 5, doors: 8 }
    });
    const name = t(ConfigRegistry.getTile('key_yellow').i18nKey);
    expect(text).toContain(name);
    expect(text).not.toContain('key_yellow');
    expect(text).toContain('8');
  });

  it('leaves a key parameter that names no tile as it is', () => {
    const text = formatValidationIssue({
      severity: 'error',
      i18nKey: 'validator.issues.no_matching_key.label',
      params: { key: 'not_a_tile', doors: 2 }
    });
    expect(text).toContain('not_a_tile');
  });

  it('translates an issue that has no parameter', () => {
    const text = formatValidationIssue({ severity: 'error', i18nKey: 'validator.issues.unreachable_exit.label' });
    expect(text).toBe(t('validator.issues.unreachable_exit.label'));
    expect(text).not.toBe('validator.issues.unreachable_exit.label');
  });
});
