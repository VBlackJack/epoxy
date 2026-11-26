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

import { beforeAll, describe, expect, it } from 'vitest';
import { lynxLevel } from '../core/lynx/lynxTestMaps';
import { CompiledLevel } from '../core/types';
import { documentFromLevel, levelFromDocument } from '../editor/editorLevelIo';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { stripInvalidTextFields } from './ConfigValidation';

const TEXTS = { title: 'T', hint: '' };
const CONTEXT = { id: 'copy', number: 1, password: 'ABCD', fallbackTitle: 'T' };

function cclpLevel(): CompiledLevel {
  return { ...lynxLevel(['###', '#@#', '###']), ruleset: 'lynx', rulesProfile: 'cclp' };
}

describe('the CCLP rule profile on a stored or edited level', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  it('survives validation on a Lynx level and is stripped anywhere else', () => {
    expect(stripInvalidTextFields(cclpLevel()).rulesProfile).toBe('cclp');
    expect('rulesProfile' in stripInvalidTextFields({ ...cclpLevel(), ruleset: undefined })).toBe(false);
    expect('rulesProfile' in stripInvalidTextFields({ ...cclpLevel(), rulesProfile: 'other' as never })).toBe(false);
  });

  it('stays through an editor copy, and goes when the document leaves the Lynx ruleset', () => {
    const doc = documentFromLevel(cclpLevel(), TEXTS);
    expect(levelFromDocument(doc, CONTEXT).rulesProfile).toBe('cclp');
    expect('rulesProfile' in levelFromDocument({ ...doc, ruleset: undefined }, CONTEXT)).toBe(false);
  });
});
