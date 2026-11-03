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

/// <reference types="node" />

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const TAB = 0x09;
const LINE_FEED = 0x0a;
const CARRIAGE_RETURN = 0x0d;
const FIRST_PRINTABLE = 0x20;

describe('style.css', () => {
  it('holds no C0 control character besides tab and line breaks (a mangled CSS escape shows as one)', () => {
    const bytes = readFileSync(resolve(__dirname, '../style.css'));
    const offending: number[] = [];
    bytes.forEach((byte, offset) => {
      if (byte < FIRST_PRINTABLE && byte !== TAB && byte !== LINE_FEED && byte !== CARRIAGE_RETURN) offending.push(offset);
    });
    expect(offending).toEqual([]);
  });
});
