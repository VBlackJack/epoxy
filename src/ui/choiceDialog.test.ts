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
import { ChoiceOption, closesDialog, findOption } from './choiceDialog';

const options: ChoiceOption[] = [
  { id: 'export', label: 'Export first', keepOpen: true },
  { id: 'delete', label: 'Delete', primary: true }
];

describe('findOption', () => {
  it('maps an answer id to its option', () => {
    expect(findOption(options, 'delete')?.label).toBe('Delete');
  });

  it('never maps cancel (null id or an unknown id) to an option', () => {
    expect(findOption(options, 'cancel')).toBeNull();
    expect(findOption(options, '')).toBeNull();
  });
});

describe('closesDialog', () => {
  it('keeps the dialog open only for a keep-open option', () => {
    expect(closesDialog(options[0])).toBe(false);
    expect(closesDialog(options[1])).toBe(true);
  });
});
