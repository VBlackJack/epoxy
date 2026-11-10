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
import { findFormat17ConfigErrors } from './ConfigValidation';
import { ConfigRegistry } from './ConfigRegistry';
import { PACK_JSON_MAX_VERSION, PACK_JSON_VERSION_V16_IDS, PACK_JSON_VERSION_V17, PACK_JSON_VERSION_V17_IDS } from './constants';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { parsePackJson, serializePack } from '../packs/packJson';
import { idSetVersionOf } from '../core/signalLinks';
import { makeLevel } from '../test/packFixtures';
import en from '../locales/en.json';
import fr from '../locales/fr.json';

const NEW_IDS = ['trap_sealed'];

function tiles() {
  return structuredClone(ConfigRegistry.getTiles().tiles);
}

describe('format 17 ids', () => {
  beforeEach(() => loadTestConfigs());

  it('lists exactly the new ids, none of them in an older format', () => {
    expect([...PACK_JSON_VERSION_V17_IDS].sort()).toEqual([...NEW_IDS].sort());
    for (const id of NEW_IDS) expect(PACK_JSON_VERSION_V16_IDS.has(id), id).toBe(false);
    expect(PACK_JSON_MAX_VERSION).toBe(PACK_JSON_VERSION_V17);
  });

  it('defines every new id in the shipped configs, with a name and a description in both languages', () => {
    const defined = tiles();
    for (const id of NEW_IDS) {
      expect(defined[id], id).toBeDefined();
      for (const locale of [en, fr]) {
        const entry = (locale.tiles as Record<string, { name?: string; desc?: { label?: string } }>)[id];
        expect(entry?.name, id).toBeTruthy();
        expect(entry?.desc?.label, id).toBeTruthy();
      }
    }
  });

  it('writes a pack holding the sealed trap in format 17, and an older reader refuses it', () => {
    const level = makeLevel('f17');
    level.terrain[1][1] = 'trap_sealed';
    expect(idSetVersionOf(level)).toBe(PACK_JSON_VERSION_V17);
    const written = serializePack('P', [level]);
    expect(JSON.parse(written).version).toBe(PACK_JSON_VERSION_V17);
    expect(parsePackJson(written, ConfigRegistry.getLevelSizeBounds(), new Set<string>(), () => 0)).toMatchObject({ ok: true });
    expect(JSON.parse(serializePack('P', [makeLevel('plain')])).version).toBeLessThan(PACK_JSON_VERSION_V17);
  });

  it('keeps a pack with a format 16 id in format 16', () => {
    const level = makeLevel('f16');
    level.terrain[1][1] = 'button_orange_cc2';
    expect(JSON.parse(serializePack('P', [level])).version).toBe(16);
  });

  it('refuses a file of the next format version', () => {
    const level = makeLevel('f17');
    level.terrain[1][1] = 'trap_sealed';
    const file = JSON.parse(serializePack('P', [level]));
    const read = parsePackJson(JSON.stringify({ ...file, version: PACK_JSON_VERSION_V17 + 1 }), ConfigRegistry.getLevelSizeBounds(), new Set<string>(), () => 0);
    expect(read).toEqual({ ok: false, error: 'version' });
  });
});

describe('shipped format 17 fields', () => {
  beforeEach(() => loadTestConfigs());

  it('describes the sealed trap: a trap, never opened, neither an open trap nor a wired one', () => {
    const sealed = tiles().trap_sealed;
    expect(sealed.isTrap).toBe(true);
    expect(sealed.sealedTrap).toBe(true);
    expect(sealed.closesTo).toBeUndefined();
    expect(sealed.wiredTrap).toBeUndefined();
  });
});

describe('findFormat17ConfigErrors', () => {
  beforeEach(() => loadTestConfigs());

  it('accepts the shipped configs', () => {
    expect(findFormat17ConfigErrors(tiles())).toEqual([]);
  });

  it('refuses sealedTrap on a tile that is not a trap, or that is not true', () => {
    const all = tiles();
    const errors = (patch: Record<string, unknown>) => findFormat17ConfigErrors({ ...all, trap_sealed: { ...all.trap_sealed, ...patch } });
    expect(errors({ sealedTrap: false })).toEqual(['trap_sealed.sealedTrap: expected true']);
    expect(errors({ isTrap: false })).toEqual(['trap_sealed.sealedTrap: only a trap is sealed']);
    expect(findFormat17ConfigErrors({ ...all, floor: { ...all.floor, sealedTrap: true } })).toEqual(['floor.sealedTrap: only a trap is sealed']);
  });

  it('refuses sealedTrap on an open trap or a wired trap', () => {
    const all = tiles();
    const errors = (patch: Record<string, unknown>) => findFormat17ConfigErrors({ ...all, trap_sealed: { ...all.trap_sealed, ...patch } });
    expect(errors({ closesTo: 'trap' })).toHaveLength(1);
    expect(errors({ wiredTrap: true })).toHaveLength(1);
  });
});
