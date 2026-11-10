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

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_RULESET } from '../core/coreConstants';
import { Ruleset } from '../core/types';
import { DatCodec } from '../formats/DatCodec';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { ConfigRegistry } from './ConfigRegistry';

const PUBLIC_DIR = resolve(__dirname, '..', '..', 'public');

/** Rulesets the bundled packs must declare; a pack missing here stays on the default ruleset. */
const EXPECTED_PACK_RULESETS: Record<string, Ruleset | undefined> = {
  ccup_tw_intro: undefined,
  ccup_cclp1: undefined,
  ccup_cclp2: undefined,
  ccup_cclp3: undefined,
  ccup_cclp4: undefined,
  ccup_cclp5: undefined
};

describe('bundled pack rulesets', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  it('declares the expected ruleset on every bundled pack', () => {
    const packs = ConfigRegistry.getGame().ultimatePacks ?? [];
    expect(packs.map((pack) => pack.id).sort()).toEqual(Object.keys(EXPECTED_PACK_RULESETS).sort());
    for (const pack of packs) {
      expect(pack.ruleset, pack.id).toBe(EXPECTED_PACK_RULESETS[pack.id]);
    }
  });

  it('tags the levels decoded from each bundled pack accordingly', () => {
    for (const pack of ConfigRegistry.getGame().ultimatePacks ?? []) {
      const file = readFileSync(resolve(PUBLIC_DIR, pack.url));
      const bytes = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
      const levels = DatCodec.decodeBuffer(bytes, pack.prefix, pack.ruleset ?? DEFAULT_RULESET);
      expect(levels.length, pack.id).toBeGreaterThan(0);
      for (const level of levels) {
        expect(level.ruleset, `${pack.id} ${level.id}`).toBe(EXPECTED_PACK_RULESETS[pack.id]);
      }
    }
  });
});
