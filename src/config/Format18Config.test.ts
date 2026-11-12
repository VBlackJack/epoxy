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
import { ConfigRegistry } from './ConfigRegistry';
import { PACK_JSON_MAX_VERSION, PACK_JSON_VERSION_V17_IDS, PACK_JSON_VERSION_V18, PACK_JSON_VERSION_V18_IDS } from './constants';
import { CC2_GATE_BASE_IDS, SIGNAL_GATE_CC2_ID_SUFFIX } from '../core/coreConstants';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { parsePackJson, serializePack } from '../packs/packJson';
import { idSetVersionOf } from '../core/signalLinks';
import { makeLevel } from '../test/packFixtures';

const NEW_IDS = ['dirt_cc2', ...CC2_GATE_BASE_IDS.map((id) => `${id}${SIGNAL_GATE_CC2_ID_SUFFIX}`)];

function bounds() {
  return ConfigRegistry.getLevelSizeBounds();
}

describe('format 18 ids', () => {
  beforeEach(() => loadTestConfigs());

  it('lists the CC2 dirt and the 16 passable gate forms, none of them in an older format', () => {
    expect(NEW_IDS).toHaveLength(17);
    expect([...PACK_JSON_VERSION_V18_IDS].sort()).toEqual([...NEW_IDS].sort());
    for (const id of NEW_IDS) expect(PACK_JSON_VERSION_V17_IDS.has(id), id).toBe(false);
    expect(PACK_JSON_MAX_VERSION).toBe(PACK_JSON_VERSION_V18);
  });

  it('defines every new id in the shipped tiles', () => {
    const defined = ConfigRegistry.getTiles().tiles;
    for (const id of NEW_IDS) expect(defined[id], id).toBeDefined();
  });

  it('writes a pack holding one of the new ids in format 18, and reads it back', () => {
    for (const id of NEW_IDS) {
      const level = makeLevel('f18');
      level.terrain[1][1] = id;
      expect(idSetVersionOf(level), id).toBe(PACK_JSON_VERSION_V18);
      const written = serializePack('P', [level]);
      expect(JSON.parse(written).version, id).toBe(PACK_JSON_VERSION_V18);
      expect(parsePackJson(written, bounds(), new Set<string>(), () => 0), id).toMatchObject({ ok: true });
    }
    expect(JSON.parse(serializePack('P', [makeLevel('plain')])).version).toBeLessThan(PACK_JSON_VERSION_V18);
  });

  it('keeps a pack with a format 17 id in format 17', () => {
    const level = makeLevel('f17');
    level.terrain[1][1] = 'trap_sealed';
    expect(JSON.parse(serializePack('P', [level])).version).toBe(17);
  });

  it('refuses a file of the next format version', () => {
    const level = makeLevel('f18');
    level.terrain[1][1] = 'dirt_cc2';
    const file = JSON.parse(serializePack('P', [level]));
    const read = parsePackJson(JSON.stringify({ ...file, version: PACK_JSON_VERSION_V18 + 1 }), bounds(), new Set<string>(), () => 0);
    expect(read).toEqual({ ok: false, error: 'version' });
  });
});
