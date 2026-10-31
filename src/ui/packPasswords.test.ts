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
import { DEFAULT_LEVEL_PASSWORD } from '../config/constants';
import { packUsesPasswords } from './packPasswords';

describe('packUsesPasswords', () => {
  it('is false when every level has the default code', () => {
    expect(packUsesPasswords([{ password: DEFAULT_LEVEL_PASSWORD }, { password: DEFAULT_LEVEL_PASSWORD }])).toBe(false);
  });

  it('is true as soon as one level has its own code', () => {
    expect(packUsesPasswords([{ password: DEFAULT_LEVEL_PASSWORD }, { password: 'ABCD' }])).toBe(true);
  });

  it('is false for an empty pack', () => {
    expect(packUsesPasswords([])).toBe(false);
  });
});
