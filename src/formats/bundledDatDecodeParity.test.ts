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

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_RULESET } from '../core/coreConstants';
import { CompiledLevel } from '../core/types';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { DatCodec } from './DatCodec';

const PACKS_DIR = resolve(__dirname, '..', '..', 'public', 'packs');

/** Bundled packs whose Epoxy and Lynx readings hold the same map; CCLP2 is read differently on purpose. */
const SAME_MAP_PACKS = ['TW_INTRO', 'CCLP1', 'CCLP3', 'CCLP4', 'CCLP5'] as const;

/** The compared fields of a level, each reduced to a short digest so a failure never prints map content. */
function digests(level: CompiledLevel): Record<'terrain' | 'items' | 'entities' | 'start', string> {
  const digest = (value: unknown): string => createHash('sha1').update(JSON.stringify(value)).digest('hex');
  // Monster order and the idle facing of a block are the only things the two readings may differ on.
  const entities = level.entities
    .map((entity) => (entity.type === 'dirt_block' ? { ...entity, dir: 'N' } : entity))
    .sort((a, b) => a.y - b.y || a.x - b.x || a.type.localeCompare(b.type));
  return {
    terrain: digest(level.terrain),
    items: digest(level.items),
    entities: digest(entities),
    start: digest(level.playerStart)
  };
}

describe('bundled .DAT packs: Epoxy and Lynx readings', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  for (const name of SAME_MAP_PACKS) {
    it(`${name} decodes to the same terrain, items, entities and start`, () => {
      const file = readFileSync(resolve(PACKS_DIR, `${name}.DAT`));
      const bytes = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
      const epoxy = DatCodec.decodeBuffer(bytes, name.toLowerCase(), DEFAULT_RULESET);
      const lynx = DatCodec.decodeBuffer(bytes, name.toLowerCase(), 'lynx');
      expect(epoxy.length).toBeGreaterThan(0);
      expect(epoxy.length).toBe(lynx.length);
      const mismatches: string[] = [];
      epoxy.forEach((level, index) => {
        expect(level.id).toBe(lynx[index].id);
        const a = digests(level);
        const b = digests(lynx[index]);
        for (const field of Object.keys(a) as Array<keyof typeof a>) {
          if (a[field] !== b[field]) mismatches.push(`${level.id}:${field}`);
        }
      });
      expect(mismatches).toEqual([]);
    });
  }
});
