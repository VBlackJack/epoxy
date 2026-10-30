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

import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../audio/AudioManager', () => import('../test/silentAudio'));

import { ProceduralGenerator } from '../core/ProceduralGenerator';
import baseline from '../test/fixtures/packBaseline.json';
import { loadTestConfigs } from '../test/loadTestConfigs';

/** [seed, level, content hash] captured before the difficulty profile refactor. */
const ENTRIES = baseline as Array<[number, number, string]>;
const HASH_LENGTH = 16;
const HEX_RADIX = 16;
const HEX_BYTE_WIDTH = 2;

async function contentHash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(HEX_RADIX).padStart(HEX_BYTE_WIDTH, '0')).join('');
  return hex.slice(0, HASH_LENGTH);
}

describe('pack mode regression', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  // The level id embeds a hash of the whole procedural config, which changes whenever a
  // config key is added, so only the _seed_n suffix and the content hash are compared.
  it('generates the same content for seeds 1-5 and levels 1-10 as before the profile', async () => {
    for (const [seed, levelNumber, hash] of ENTRIES) {
      const level = ProceduralGenerator.generateLevel(levelNumber, seed);
      expect(level.id.endsWith(`_${seed}_${levelNumber}`), level.id).toBe(true);
      const actual = await contentHash(
        JSON.stringify({ terrain: level.terrain, items: level.items, entities: level.entities })
      );
      expect(actual, level.id).toBe(hash);
    }
  }, 120000);
});
