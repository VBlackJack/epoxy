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
import { findFishGateAndExitErrors, findFormat14ConfigErrors } from './ConfigValidation';
import { ConfigRegistry } from './ConfigRegistry';
import { PACK_JSON_VERSION_V13_IDS, PACK_JSON_VERSION_V14, PACK_JSON_VERSION_V14_IDS } from './constants';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { serializePack } from '../packs/packJson';
import { idSetVersionOf } from '../core/signalLinks';
import { makeLevel } from '../test/packFixtures';

const NEW_IDS = [
  'slime_cc2',
  'turtle_cc2',
  'flame_jet_cc2_off',
  'flame_jet_cc2_on',
  'block_barrier_floor',
  'arrow_block_cross',
  'transmogrifier_cc2',
  'teleport_random',
  'teleport_red_cc2',
  'helmet'
];

function clones() {
  return {
    tiles: structuredClone(ConfigRegistry.getTiles().tiles),
    entities: structuredClone(ConfigRegistry.getMonsters().entities)
  };
}

describe('format 14 ids', () => {
  beforeEach(() => loadTestConfigs());

  it('lists exactly the ten new ids, none of them in an older format', () => {
    expect([...PACK_JSON_VERSION_V14_IDS].sort()).toEqual([...NEW_IDS].sort());
    for (const id of NEW_IDS) expect(PACK_JSON_VERSION_V13_IDS.has(id), id).toBe(false);
  });

  it('defines every new id in the shipped configs', () => {
    const { tiles, entities } = clones();
    for (const id of NEW_IDS) expect(tiles[id] !== undefined || entities[id] !== undefined, id).toBe(true);
  });

  it('accepts the shipped configs', () => {
    const { tiles, entities } = clones();
    expect(findFormat14ConfigErrors(tiles, entities)).toEqual({ tiles: [], monsters: [] });
    expect(findFishGateAndExitErrors(tiles)).toEqual([]);
  });

  it('writes a pack holding one of the new ids in format 14, and an older version refuses it by version', () => {
    const { tiles } = clones();
    for (const id of NEW_IDS) {
      const level = makeLevel('f14');
      if (tiles[id] === undefined) level.entities.push({ x: 1, y: 1, type: id, dir: 'S' });
      else if (tiles[id].layer === 'item') level.items[1][1] = id;
      else level.terrain[1][1] = id;
      expect(idSetVersionOf(level), id).toBe(PACK_JSON_VERSION_V14);
      expect(JSON.parse(serializePack('P', [level])).version, id).toBe(PACK_JSON_VERSION_V14);
    }
    expect(JSON.parse(serializePack('P', [makeLevel('plain')])).version).toBeLessThan(PACK_JSON_VERSION_V14);
  });
});

describe('findFormat14ConfigErrors', () => {
  beforeEach(() => loadTestConfigs());

  it('refuses clearedByBlocks without a floor to clear into, or naming a non-block', () => {
    const { tiles, entities } = clones();
    expect(findFormat14ConfigErrors({ ...tiles, slime_cc2: { ...tiles.slime_cc2, blockTransformsTo: undefined } }, entities).tiles).toEqual([
      'slime_cc2.clearedByBlocks: needs a blockTransformsTo terrain to clear into'
    ]);
    expect(findFormat14ConfigErrors({ ...tiles, slime_cc2: { ...tiles.slime_cc2, clearedByBlocks: ['bug'] } }, entities).tiles).toEqual([
      'slime_cc2.clearedByBlocks: "bug" is not the id of an existing block'
    ]);
    expect(findFormat14ConfigErrors({ ...tiles, slime_cc2: { ...tiles.slime_cc2, clearedByBlocks: [] } }, entities).tiles).toHaveLength(1);
  });

  it('refuses barsMonsters on a tile monsters cannot enter, or naming a non-monster', () => {
    const { tiles, entities } = clones();
    expect(findFormat14ConfigErrors({ ...tiles, turtle_cc2: { ...tiles.turtle_cc2, passableByMonster: false } }, entities).tiles).toEqual([
      'turtle_cc2.barsMonsters: only a tile monsters may enter bars some of them'
    ]);
    expect(findFormat14ConfigErrors({ ...tiles, turtle_cc2: { ...tiles.turtle_cc2, barsMonsters: ['dirt_block'] } }, entities).tiles).toEqual([
      'turtle_cc2.barsMonsters: "dirt_block" is not the id of an existing monster'
    ]);
  });

  it('refuses burnsOccupants that is not true or sits on a tile without the fire hazard', () => {
    const { tiles, entities } = clones();
    expect(findFormat14ConfigErrors({ ...tiles, flame_jet_cc2_on: { ...tiles.flame_jet_cc2_on, hazard: undefined } }, entities).tiles).toEqual([
      'flame_jet_cc2_on.burnsOccupants: only a tile with the hazard "fire" burns its occupants'
    ]);
    const falsy = { ...tiles.flame_jet_cc2_on, burnsOccupants: false } as unknown as typeof tiles.flame_jet_cc2_on;
    expect(findFormat14ConfigErrors({ ...tiles, flame_jet_cc2_on: falsy }, entities).tiles).toEqual(['flame_jet_cc2_on.burnsOccupants: expected true']);
  });

  it('refuses a transmogrify table other than cc2, or on a tile that does not transmogrify', () => {
    const { tiles, entities } = clones();
    const other = { ...tiles.transmogrifier_cc2, transmogrifyTable: 'classic' } as unknown as typeof tiles.transmogrifier_cc2;
    expect(findFormat14ConfigErrors({ ...tiles, transmogrifier_cc2: other }, entities).tiles).toEqual(['transmogrifier_cc2.transmogrifyTable: expected "cc2"']);
    expect(findFormat14ConfigErrors({ ...tiles, floor: { ...tiles.floor, transmogrifyTable: 'cc2' } }, entities).tiles).toEqual([
      'floor.transmogrifyTable: only a transmogrifier names a table'
    ]);
  });

  it('refuses shieldsFromContact on anything but boots', () => {
    const { tiles, entities } = clones();
    expect(findFormat14ConfigErrors({ ...tiles, floor: { ...tiles.floor, shieldsFromContact: true } }, entities).tiles).toEqual([
      'floor.shieldsFromContact: only boots (collectible "boot") shield from contact'
    ]);
    const falsy = { ...tiles.helmet, shieldsFromContact: false } as unknown as typeof tiles.helmet;
    expect(findFormat14ConfigErrors({ ...tiles, helmet: falsy }, entities).tiles).toEqual(['helmet.shieldsFromContact: expected true']);
  });

  it('refuses a CC2 transmogrify target that is unknown, of another kind, itself or already taken', () => {
    const { tiles, entities } = clones();
    const withTarget = (id: string, target: string) => ({ ...entities, [id]: { ...entities[id], transmogrifiesToCc2: target } });
    expect(findFormat14ConfigErrors(tiles, withTarget('bug', 'nowhere')).monsters).toEqual(['bug.transmogrifiesToCc2: unknown entity nowhere']);
    expect(findFormat14ConfigErrors(tiles, withTarget('bug', 'dirt_block')).monsters).toContain('bug.transmogrifiesToCc2: dirt_block is not of the same kind');
    expect(findFormat14ConfigErrors(tiles, withTarget('bug', 'bug')).monsters).toContain('bug.transmogrifiesToCc2: an entity cannot transmogrify into itself');
    expect(findFormat14ConfigErrors(tiles, withTarget('walker', 'glider')).monsters).toEqual(['walker.transmogrifiesToCc2: bug already becomes glider']);
  });

  it('gives the blob a pool of monsters, exclusive with a fixed target, each an existing monster', () => {
    const { tiles, entities } = clones();
    expect(entities.blob.transmogrifiesToCc2Pool).toEqual(['glider', 'paramecium', 'fireball', 'bug', 'walker', 'pink_ball', 'teeth', 'tank', 'timid_teeth']);
    const withBlob = (patch: Record<string, unknown>) => ({ ...entities, blob: { ...entities.blob, ...patch } });
    expect(findFormat14ConfigErrors(tiles, withBlob({ transmogrifiesToCc2Pool: [] })).monsters).toEqual(['blob.transmogrifiesToCc2Pool: expected a non-empty list of monster ids']);
    expect(findFormat14ConfigErrors(tiles, withBlob({ transmogrifiesToCc2Pool: ['dirt_block'] })).monsters).toEqual(['blob.transmogrifiesToCc2Pool: "dirt_block" is not the id of an existing monster']);
    expect(findFormat14ConfigErrors(tiles, withBlob({ transmogrifiesToCc2: 'bug' })).monsters).toContain('blob.transmogrifiesToCc2Pool: exclusive with transmogrifiesToCc2');
  });

  it('refuses a boot that both shields from contact and absorbs monster contact', () => {
    const { tiles, entities } = clones();
    const both = { ...tiles.helmet, absorbsMonsterContact: true } as typeof tiles.helmet;
    expect(findFormat14ConfigErrors({ ...tiles, helmet: both }, entities).tiles).toEqual(['helmet.shieldsFromContact: a boot does not also absorb monster contact']);
  });

  it('keeps the CC2 table a permutation: the cycle of the four flyers and walkers, and the pairs', () => {
    const { entities } = clones();
    const table = Object.fromEntries(
      Object.values(entities)
        .filter((entity) => entity.transmogrifiesToCc2 !== undefined)
        .map((entity) => [entity.id, entity.transmogrifiesToCc2])
    );
    expect(table).toEqual({
      bug: 'glider',
      glider: 'paramecium',
      paramecium: 'fireball',
      fireball: 'bug',
      pink_ball: 'walker',
      walker: 'pink_ball',
      teeth: 'timid_teeth',
      timid_teeth: 'teeth',
      dirt_block: 'ice_block',
      ice_block: 'dirt_block'
    });
  });
});

describe('teleporter exit orders of format 14', () => {
  beforeEach(() => loadTestConfigs());

  it('accepts random and cc2_red, refuses an unknown order', () => {
    const { tiles } = clones();
    expect(tiles.teleport_random.teleportExitOrder).toBe('random');
    expect(tiles.teleport_red_cc2.teleportExitOrder).toBe('cc2_red');
    const unknown = { ...tiles.teleport_random, teleportExitOrder: 'sideways' } as unknown as typeof tiles.teleport_random;
    expect(findFishGateAndExitErrors({ ...tiles, teleport_random: unknown })).toEqual([
      'teleport_random.teleportExitOrder: expected one of forward_only, forward_right_left_back, random, cc2_red'
    ]);
  });
});

describe('shipped format 14 behaviour fields', () => {
  beforeEach(() => loadTestConfigs());

  it('lets the ghost refuse the CC2 turtle and the glider leave turtles afloat', () => {
    const { entities } = clones();
    expect(entities.ghost.blockedByTiles).toContain('turtle_cc2');
    expect(entities.glider.leavesTurtlesAfloat).toBe(true);
  });

  it('lets the arrow blocks and the ice block chain-push the cross block, which shows four arrows', () => {
    const { entities } = clones();
    expect(entities.arrow_block_cross.pushArrows).toEqual(['FORWARD', 'LEFT', 'RIGHT', 'BACK']);
    for (const id of ['ice_block', 'arrow_block_one', 'arrow_block_line', 'arrow_block_corner', 'arrow_block_tee', 'arrow_block_none', 'arrow_block_cross']) {
      expect(entities[id].chainPushes, id).toContain('arrow_block_cross');
    }
  });

  it('keeps the wired CC2 jets off the global orange toggle and bars every block from the barrier floor', () => {
    const { tiles } = clones();
    expect(tiles.flame_jet_cc2_off.flameTogglesTo).toBeUndefined();
    expect(tiles.flame_jet_cc2_on.flameTogglesTo).toBeUndefined();
    expect(tiles.flame_jet_cc2_off.wireTogglesTo).toBe('flame_jet_cc2_on');
    expect(tiles.flame_jet_cc2_on.wireTogglesTo).toBe('flame_jet_cc2_off');
    expect(tiles.flame_jet_cc2_on.passableByMonster).toBe(true);
    expect(tiles.block_barrier_floor).toMatchObject({ passableByPlayer: true, passableByMonster: true, passableByBlock: false });
  });
});
