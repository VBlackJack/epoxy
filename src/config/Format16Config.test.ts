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
import { findFormat16ConfigErrors } from './ConfigValidation';
import { ConfigRegistry } from './ConfigRegistry';
import { PACK_JSON_MAX_VERSION, PACK_JSON_VERSION_V15_IDS, PACK_JSON_VERSION_V16, PACK_JSON_VERSION_V16_IDS } from './constants';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { parsePackJson, serializePack } from '../packs/packJson';
import { idSetVersionOf } from '../core/signalLinks';
import { makeLevel } from '../test/packFixtures';
import { isEpoxyOnlyEntityType } from '../core/RulesetFeatures';

const NEW_IDS = ['button_orange_cc2', 'dirt_block_3d'];

function clones() {
  return {
    tiles: structuredClone(ConfigRegistry.getTiles().tiles),
    entities: structuredClone(ConfigRegistry.getMonsters().entities)
  };
}

describe('format 16 ids', () => {
  beforeEach(() => loadTestConfigs());

  it('lists exactly the new ids, none of them in an older format', () => {
    expect([...PACK_JSON_VERSION_V16_IDS].sort()).toEqual([...NEW_IDS].sort());
    for (const id of NEW_IDS) expect(PACK_JSON_VERSION_V15_IDS.has(id), id).toBe(false);
    expect(PACK_JSON_MAX_VERSION).toBe(PACK_JSON_VERSION_V16);
  });

  it('defines every new id in the shipped configs', () => {
    const { tiles, entities } = clones();
    for (const id of NEW_IDS) expect(tiles[id] !== undefined || entities[id] !== undefined, id).toBe(true);
  });

  it('writes a pack holding one of the new ids in format 16, and an older reader refuses it', () => {
    const { tiles } = clones();
    for (const id of NEW_IDS) {
      const level = makeLevel('f16');
      if (tiles[id] === undefined) level.entities.push({ x: 1, y: 1, type: id, dir: 'S' });
      else level.terrain[1][1] = id;
      expect(idSetVersionOf(level), id).toBe(PACK_JSON_VERSION_V16);
      const written = serializePack('P', [level]);
      expect(JSON.parse(written).version, id).toBe(PACK_JSON_VERSION_V16);
      expect(parsePackJson(written, ConfigRegistry.getLevelSizeBounds(), new Set<string>(), () => 0)).toMatchObject({ ok: true });
    }
    expect(JSON.parse(serializePack('P', [makeLevel('plain')])).version).toBeLessThan(PACK_JSON_VERSION_V16);
  });

  it('keeps a pack with a format 15 id in format 15', () => {
    const level = makeLevel('f15');
    level.terrain[1][1] = 'dirt_3d';
    expect(JSON.parse(serializePack('P', [level])).version).toBe(15);
  });

  it('refuses a file of the next format version', () => {
    const level = makeLevel('f16');
    level.terrain[1][1] = 'button_orange_cc2';
    const file = JSON.parse(serializePack('P', [level]));
    const read = parsePackJson(JSON.stringify({ ...file, version: PACK_JSON_VERSION_V16 + 1 }), ConfigRegistry.getLevelSizeBounds(), new Set<string>(), () => 0);
    expect(read).toEqual({ ok: false, error: 'version' });
  });

  it('marks the CC3D dirt block Epoxy-only', () => {
    expect(isEpoxyOnlyEntityType('dirt_block_3d')).toBe(true);
  });
});

describe('shipped format 16 fields', () => {
  beforeEach(() => loadTestConfigs());

  it('describes the orange button: a held source that any actor presses', () => {
    const { tiles } = clones();
    expect(tiles.button_orange_cc2).toMatchObject({ signalSource: 'held', pressedByAnyActor: true });
    expect(tiles.signal_plate.pressedByAnyActor).toBeUndefined();
  });

  it('flags the unpowered red pad as a teleport onto itself without making it a teleporter', () => {
    const { tiles } = clones();
    expect(tiles.teleport_red_cc2_off.teleportsToSelf).toBe(true);
    expect(tiles.teleport_red_cc2_off.isTeleporter).toBeUndefined();
    expect(tiles.teleport_red_cc2.teleportsToSelf).toBeUndefined();
  });

  it('describes the CC3D dirt block: dirt_3d from water, no fire, no items, pushed by the CC3D ice block', () => {
    const { entities } = clones();
    expect(entities.dirt_block_3d).toMatchObject({
      kind: 'block',
      pushable: true,
      waterTransformsTo: 'dirt_3d',
      refusesHazards: ['fire'],
      refusesItems: true
    });
    expect(entities.ice_block_3d.chainPushes).toContain('dirt_block_3d');
    expect(entities.dirt_block.refusesItems).toBeUndefined();
  });

  it('leaves a trail of CC3D slime behind the omni', () => {
    const { entities } = clones();
    expect(entities.omni.trailTile).toBe('slime_3d');
  });
});

describe('findFormat16ConfigErrors', () => {
  beforeEach(() => loadTestConfigs());

  it('accepts the shipped configs', () => {
    expect(findFormat16ConfigErrors(clones().tiles)).toEqual([]);
  });

  it('refuses pressedByAnyActor on a tile that is not a held source, or that is not true', () => {
    const { tiles } = clones();
    const errors = (patch: Record<string, unknown>) => findFormat16ConfigErrors({ ...tiles, button_orange_cc2: { ...tiles.button_orange_cc2, ...patch } });
    expect(errors({ signalSource: 'pulse' })).toEqual(['button_orange_cc2.pressedByAnyActor: only a held signal source is pressed']);
    expect(errors({ pressedByAnyActor: false })).toEqual(['button_orange_cc2.pressedByAnyActor: expected true']);
    expect(findFormat16ConfigErrors({ ...tiles, floor: { ...tiles.floor, pressedByAnyActor: true } })).toEqual([
      'floor.pressedByAnyActor: only a held signal source is pressed'
    ]);
  });

  it('refuses teleportsToSelf without a powered twin, on a teleporter, or that is not true', () => {
    const { tiles } = clones();
    const errors = (patch: Record<string, unknown>) => findFormat16ConfigErrors({ ...tiles, teleport_red_cc2_off: { ...tiles.teleport_red_cc2_off, ...patch } });
    expect(errors({ poweredTwin: undefined })).toEqual(['teleport_red_cc2_off.teleportsToSelf: needs a poweredTwin']);
    expect(errors({ isTeleporter: true })).toEqual(['teleport_red_cc2_off.teleportsToSelf: a teleporter has a destination of its own']);
    expect(errors({ teleportsToSelf: false })).toEqual(['teleport_red_cc2_off.teleportsToSelf: expected true']);
  });
});
