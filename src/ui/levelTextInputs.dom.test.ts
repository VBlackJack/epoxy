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

// @vitest-environment happy-dom
// DOM tests opt in with the line above; the default environment stays node (see vitest.config.ts).

import { beforeEach, describe, expect, it } from 'vitest';
import { LevelTextConfig } from '../core/types';
import { applyLevelTextInputLimits } from './levelTextInputs';

const LIMITS: LevelTextConfig = {
  titleMaxLength: 50,
  hintMaxLength: 60,
  authorMaxLength: 70,
  passwordMaxLength: 16,
  solutionMaxLength: 1000,
  themeMaxLength: 10,
  keyMaxLength: 10,
  idMaxLength: 10
};

function input(id: string): HTMLInputElement {
  return document.getElementById(id) as HTMLInputElement;
}

describe('applyLevelTextInputLimits', () => {
  beforeEach(() => {
    document.body.innerHTML =
      '<input id="editor-meta-title"><input id="editor-meta-hint"><input id="editor-meta-author"><input id="editor-meta-password" maxlength="4">';
  });

  it('caps the free text inputs at their limits', () => {
    applyLevelTextInputLimits(LIMITS);
    expect(input('editor-meta-title').maxLength).toBe(50);
    expect(input('editor-meta-hint').maxLength).toBe(60);
    expect(input('editor-meta-author').maxLength).toBe(70);
  });

  it('keeps a tighter cap that is already set', () => {
    applyLevelTextInputLimits(LIMITS);
    expect(input('editor-meta-password').maxLength).toBe(4);
  });

  it('ignores an input that is not on the page', () => {
    document.body.innerHTML = '';
    expect(() => applyLevelTextInputLimits(LIMITS)).not.toThrow();
  });
});
