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
import { PACK_JSON_MAX_VERSION, PACK_JSON_VERSION_V16_IDS, PACK_JSON_VERSION_V17, PACK_JSON_VERSION_V17_IDS, PACK_JSON_VERSION_V18 } from './constants';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { parsePackJson, serializePack } from '../packs/packJson';
import { idSetVersionOf } from '../core/signalLinks';
import { isEpoxyOnlyTileId } from '../core/RulesetFeatures';
import { EPOXY_ONLY_REASON_KEY, tileAvailability } from '../editor/paletteAvailability';
import { makeLevel } from '../test/packFixtures';
import en from '../locales/en.json';
import fr from '../locales/fr.json';

const NEW_IDS = [
  'trap_sealed', 'color_block_3d_red', 'color_block_3d_green', 'color_block_3d_blue', 'color_block_3d_yellow',
  'ice_corner_3d_nw', 'ice_corner_3d_ne', 'ice_corner_3d_sw', 'ice_corner_3d_se'
];

function tiles() {
  return structuredClone(ConfigRegistry.getTiles().tiles);
}

describe('format 17 ids', () => {
  beforeEach(() => loadTestConfigs());

  it('lists exactly the new ids, none of them in an older format', () => {
    expect([...PACK_JSON_VERSION_V17_IDS].sort()).toEqual([...NEW_IDS].sort());
    for (const id of NEW_IDS) expect(PACK_JSON_VERSION_V16_IDS.has(id), id).toBe(false);
    expect(PACK_JSON_MAX_VERSION).toBe(PACK_JSON_VERSION_V18);
  });

  it('defines every new id in the shipped configs, with a name and a description in both languages', () => {
    const defined = tiles();
    const entities = ConfigRegistry.getMonsters().entities;
    for (const id of NEW_IDS) {
      expect(defined[id] ?? entities[id], id).toBeDefined();
      for (const locale of [en, fr]) {
        const entry = (defined[id] === undefined ? locale.entities : locale.tiles) as Record<string, { name?: string; desc?: { label?: string } }>;
        const found = entry[id];
        expect(found?.name, id).toBeTruthy();
        expect(found?.desc?.label, id).toBeTruthy();
      }
    }
  });

  it('writes a pack holding one of the new ids in format 17, and an older reader refuses it', () => {
    const defined = tiles();
    for (const id of NEW_IDS) {
      const level = makeLevel('f17');
      if (defined[id] === undefined) level.entities.push({ x: 1, y: 1, type: id, dir: 'S' });
      else level.terrain[1][1] = id;
      expect(idSetVersionOf(level), id).toBe(PACK_JSON_VERSION_V17);
      const written = serializePack('P', [level]);
      expect(JSON.parse(written).version, id).toBe(PACK_JSON_VERSION_V17);
      expect(parsePackJson(written, ConfigRegistry.getLevelSizeBounds(), new Set<string>(), () => 0)).toMatchObject({ ok: true });
    }
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
    const read = parsePackJson(JSON.stringify({ ...file, version: PACK_JSON_VERSION_V18 + 1 }), ConfigRegistry.getLevelSizeBounds(), new Set<string>(), () => 0);
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

describe('Epoxy-only format 17 tiles', () => {
  beforeEach(() => loadTestConfigs());

  it('refuses the sealed trap and the CC3D ice corners under the Lynx rules, and not the native corners', () => {
    for (const id of ['trap_sealed', 'ice_corner_3d_nw', 'ice_corner_3d_ne', 'ice_corner_3d_sw', 'ice_corner_3d_se']) {
      expect(isEpoxyOnlyTileId(id), id).toBe(true);
      expect(tileAvailability('lynx', id), id).toEqual({ available: false, reasonKey: EPOXY_ONLY_REASON_KEY });
    }
    expect(isEpoxyOnlyTileId('ice_nw')).toBe(false);
    expect(tileAvailability('lynx', 'ice_nw')).toEqual({ available: true });
  });
});

describe('shipped CC3D colour blocks', () => {
  beforeEach(() => loadTestConfigs());

  it('are the native colour blocks that also stop against a wall on ice and crush a monster they slide into', () => {
    const entities = ConfigRegistry.getMonsters().entities;
    for (const c of ['red', 'green', 'blue', 'yellow']) {
      const { stopsAtWall, crushesMonsters, id, i18nKey, ...rest } = entities[`color_block_3d_${c}`];
      const { id: nativeId, i18nKey: nativeKey, ...native } = entities[`color_block_${c}`];
      expect(stopsAtWall, id).toBe(true);
      expect(i18nKey).toBe(`entities.color_block_3d_${c}.name`);
      expect(nativeId).toBe(`color_block_${c}`);
      expect(nativeKey).toBe(`entities.color_block_${c}.name`);
      expect(rest, c).toEqual(native);
      expect(entities[`color_block_${c}`].stopsAtWall).toBeUndefined();
    }
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

  it('refuses cc3dCornerBounce on a tile that is not ice, has no deflection map, or is not true', () => {
    const all = tiles();
    const errors = (patch: Record<string, unknown>) => findFormat17ConfigErrors({ ...all, ice_corner_3d_ne: { ...all.ice_corner_3d_ne, ...patch } });
    expect(errors({ cc3dCornerBounce: false })).toEqual(['ice_corner_3d_ne.cc3dCornerBounce: expected true']);
    expect(errors({ slideType: undefined })).toHaveLength(1);
    expect(errors({ deflectionMap: undefined })).toHaveLength(1);
  });
});
