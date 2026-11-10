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
import { findFormat15ConfigErrors } from './ConfigValidation';
import { ConfigRegistry } from './ConfigRegistry';
import { PACK_JSON_MAX_VERSION, PACK_JSON_VERSION_V14_IDS, PACK_JSON_VERSION_V15, PACK_JSON_VERSION_V17, PACK_JSON_VERSION_V15_IDS } from './constants';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { parsePackJson, serializePack } from '../packs/packJson';
import { idSetVersionOf } from '../core/signalLinks';
import { makeLevel } from '../test/packFixtures';
import { EPOXY_ONLY_REASON_KEY, tileAvailability } from '../editor/paletteAvailability';
import { usesPoweredTwinSinkFormat } from '../core/signalLinks';
import { isEpoxyOnlyEntityType, isEpoxyOnlyTileId } from '../core/RulesetFeatures';

const MIRROR_AND_TURRET_BLOCKS = [
  'mirror_slash', 'mirror_backslash', 'one_sided_mirror_ne', 'one_sided_mirror_nw', 'one_sided_mirror_se', 'one_sided_mirror_sw',
  'turret_fixed', 'turret_cw', 'turret_ccw', 'turret_multi'
];

const NEW_IDS = [
  'dirt_3d',
  'popup_wall_cc2',
  'trap_open',
  'appearing_wall_any',
  'slime_3d',
  'teleport_red_cc2_off',
  'transmogrifier_cc2_off',
  'ice_block_3d'
];

function clones() {
  return {
    tiles: structuredClone(ConfigRegistry.getTiles().tiles),
    entities: structuredClone(ConfigRegistry.getMonsters().entities)
  };
}

describe('format 15 ids', () => {
  beforeEach(() => loadTestConfigs());

  it('lists exactly the new ids, none of them in an older format', () => {
    expect([...PACK_JSON_VERSION_V15_IDS].sort()).toEqual([...NEW_IDS].sort());
    for (const id of NEW_IDS) expect(PACK_JSON_VERSION_V14_IDS.has(id), id).toBe(false);
    expect(PACK_JSON_MAX_VERSION).toBe(PACK_JSON_VERSION_V17);
  });

  it('defines every new id in the shipped configs', () => {
    const { tiles, entities } = clones();
    for (const id of NEW_IDS) expect(tiles[id] !== undefined || entities[id] !== undefined, id).toBe(true);
  });

  it('accepts the shipped configs', () => {
    const { tiles, entities } = clones();
    expect(findFormat15ConfigErrors(tiles, entities)).toEqual({ tiles: [], monsters: [] });
  });

  it('writes a pack holding one of the new ids in format 15, and an older reader refuses it', () => {
    const { tiles } = clones();
    for (const id of NEW_IDS) {
      const level = makeLevel('f15');
      if (tiles[id] === undefined) level.entities.push({ x: 1, y: 1, type: id, dir: 'S' });
      else if (tiles[id].layer === 'item') level.items[1][1] = id;
      else level.terrain[1][1] = id;
      expect(idSetVersionOf(level), id).toBe(PACK_JSON_VERSION_V15);
      const written = serializePack('P', [level]);
      expect(JSON.parse(written).version, id).toBe(PACK_JSON_VERSION_V15);
      expect(parsePackJson(written, ConfigRegistry.getLevelSizeBounds(), new Set<string>(), () => 0)).toMatchObject({ ok: true });
    }
    expect(JSON.parse(serializePack('P', [makeLevel('plain')])).version).toBeLessThan(PACK_JSON_VERSION_V15);
  });

  it('refuses a file of the next format version', () => {
    const level = makeLevel('f15');
    level.terrain[1][1] = 'dirt_3d';
    const file = JSON.parse(serializePack('P', [level]));
    const read = parsePackJson(JSON.stringify({ ...file, version: PACK_JSON_VERSION_V17 + 1 }), ConfigRegistry.getLevelSizeBounds(), new Set<string>(), () => 0);
    expect(read).toEqual({ ok: false, error: 'version' });
  });

  it('marks the powered twins and the CC3D ice block Epoxy-only', () => {
    for (const id of ['teleport_red_cc2_off', 'transmogrifier_cc2_off', 'transmogrifier_cc2']) {
      expect(isEpoxyOnlyTileId(id), id).toBe(true);
      expect(tileAvailability('lynx', id), id).toEqual({ available: false, reasonKey: EPOXY_ONLY_REASON_KEY });
    }
    expect(isEpoxyOnlyEntityType('ice_block_3d')).toBe(true);
  });

  it('leaves the existing CC2 red teleporter as it was: allowed under Lynx', () => {
    expect(isEpoxyOnlyTileId('teleport_red_cc2')).toBe(false);
    expect(tileAvailability('lynx', 'teleport_red_cc2')).toEqual({ available: true });
  });

  it('writes a level with a signal link ending on a powered device in format 15, and only then', () => {
    const level = makeLevel('wire');
    level.terrain[1][1] = 'teleport_red_cc2';
    level.terrain[1][2] = 'signal_plate';
    level.signalLinks = [{ fromX: 2, fromY: 1, toX: 1, toY: 1 }];
    expect(usesPoweredTwinSinkFormat(level)).toBe(true);
    expect(JSON.parse(serializePack('P', [level])).version).toBe(PACK_JSON_VERSION_V15);
    for (const id of ['teleport_red_cc2_off', 'transmogrifier_cc2', 'transmogrifier_cc2_off']) {
      level.terrain[1][1] = id;
      expect(usesPoweredTwinSinkFormat(level), id).toBe(true);
    }
    level.terrain[1][1] = 'wall';
    expect(usesPoweredTwinSinkFormat(level)).toBe(false);
    level.terrain[1][1] = 'teleport_red_cc2';
    level.signalLinks = undefined;
    expect(usesPoweredTwinSinkFormat(level)).toBe(false);
  });
});

describe('shipped format 15 fields', () => {
  beforeEach(() => loadTestConfigs());

  it('describes the CC3D dirt: cleared by the player, kept by the ice blocks, closed to monsters', () => {
    const { tiles } = clones();
    expect(tiles.dirt_3d).toMatchObject({
      passableByPlayer: true,
      passableByMonster: false,
      passableByBlock: true,
      transformsToOnStep: 'floor',
      blockClearsTo: 'floor',
      keptBy: ['ice_block', 'ice_block_3d']
    });
    expect(tiles.dirt_3d.barsBlocks).toEqual(MIRROR_AND_TURRET_BLOCKS);
    expect(tiles.dirt_3d.barsBlocks).not.toContain('arrow_block_one');
  });

  it('describes the pop-up wall: no dirt block, only rovers and ghosts, a wall behind the leaver', () => {
    const { tiles } = clones();
    expect(tiles.popup_wall_cc2).toMatchObject({
      passableByPlayer: true,
      passableByMonster: true,
      passableByBlock: true,
      barsBlocks: ['dirt_block'],
      admitsMonsters: ['rover', 'ghost'],
      transformsToOnLeave: 'wall',
      heldWhileOccupied: true
    });
  });

  it('describes the open trap, the any-actor appearing wall and the CC3D slime', () => {
    const { tiles } = clones();
    expect(tiles.trap_open).toMatchObject({ isTrap: true, wiredTrap: true, closesTo: 'trap', closesToWired: 'trap_wired' });
    expect(tiles.turtle_cc2.heldWhileOccupied).toBeUndefined();
    expect(tiles.appearing_wall_any).toMatchObject({ revealsToOnTouch: 'wall', revealedByAny: true });
    expect(tiles.appearing_wall_any.passableByBlock).toBe(false);
    expect(tiles.slime_3d).toMatchObject({ hazard: 'slime', blockTransformsTo: 'floor', sparedByBoots: ['boots_fire', 'boots_water'] });
    expect(tiles.slime_3d.barsBlocks).toEqual(MIRROR_AND_TURRET_BLOCKS);
  });

  it('links each powered device to its off form, which is neither a teleporter nor a transmogrifier', () => {
    const { tiles } = clones();
    expect(tiles.teleport_red_cc2.poweredTwin).toBe('teleport_red_cc2_off');
    expect(tiles.teleport_red_cc2_off.poweredTwin).toBe('teleport_red_cc2');
    expect(tiles.teleport_red_cc2_off.isTeleporter).toBeUndefined();
    expect(tiles.teleport_red_cc2_off.relayPad).toBeUndefined();
    expect(tiles.transmogrifier_cc2.poweredTwin).toBe('transmogrifier_cc2_off');
    expect(tiles.transmogrifier_cc2_off.poweredTwin).toBe('transmogrifier_cc2');
    expect(tiles.transmogrifier_cc2_off.transmogrifies).toBeUndefined();
  });

  it('lets the CC3D ice block push every block kind and slide over the security gates', () => {
    const { entities } = clones();
    const expected = [
      'dirt_block', 'dirt_block_3d', 'ice_block', 'ice_block_3d',
      'color_block_red', 'color_block_green', 'color_block_blue', 'color_block_yellow',
      'arrow_block_one', 'arrow_block_line', 'arrow_block_corner', 'arrow_block_tee', 'arrow_block_cross',
      ...MIRROR_AND_TURRET_BLOCKS
    ];
    expect(entities.ice_block_3d.chainPushes).toEqual(expected);
    expect(entities.ice_block_3d.chainPushesTransitive).toBe(true);
    expect(entities.ice_block_3d.slidesOverTiles).toEqual(['thief', 'thief_keys']);
    expect(entities.ice_block_3d.epoxyOnly).toBe(true);
  });

  it('stops the CC3D dirt and ice blocks at what refuses them on ice, where the other blocks bounce back', () => {
    const { entities } = clones();
    expect(entities.dirt_block_3d.stopsAtWall).toBe(true);
    expect(entities.ice_block_3d.stopsAtWall).toBe(true);
    for (const id of ['dirt_block', 'ice_block', 'color_block_red']) expect(entities[id].stopsAtWall, id).toBeUndefined();
  });
});

describe('findFormat15ConfigErrors', () => {
  beforeEach(() => loadTestConfigs());

  it('refuses blockClearsTo without a terrain, a keptBy list or a tile blocks may enter', () => {
    const { tiles, entities } = clones();
    const errors = (patch: Record<string, unknown>) => findFormat15ConfigErrors({ ...tiles, dirt_3d: { ...tiles.dirt_3d, ...patch } }, entities).tiles;
    expect(errors({ blockClearsTo: 'nowhere' })).toEqual(['dirt_3d.blockClearsTo: "nowhere" is not the id of an existing terrain']);
    expect(errors({ keptBy: undefined })).toEqual(['dirt_3d.blockClearsTo: needs a keptBy list']);
    expect(errors({ keptBy: ['bug'] })).toEqual(['dirt_3d.keptBy: "bug" is not the id of an existing block']);
    expect(errors({ passableByBlock: false })).toEqual(['dirt_3d.blockClearsTo: only a tile blocks may enter clears for them', 'dirt_3d.barsBlocks: only a tile blocks may enter bars some of them']);
    expect(findFormat15ConfigErrors({ ...tiles, floor: { ...tiles.floor, keptBy: ['ice_block'] } }, entities).tiles).toEqual([
      'floor.keptBy: needs a blockClearsTo terrain'
    ]);
  });

  it('refuses barsBlocks and admitsMonsters on a tile that does not admit them, or naming the wrong kind', () => {
    const { tiles, entities } = clones();
    const errors = (patch: Record<string, unknown>) => findFormat15ConfigErrors({ ...tiles, popup_wall_cc2: { ...tiles.popup_wall_cc2, ...patch } }, entities).tiles;
    expect(errors({ passableByBlock: false })).toEqual(['popup_wall_cc2.barsBlocks: only a tile blocks may enter bars some of them']);
    expect(errors({ barsBlocks: ['bug'] })).toEqual(['popup_wall_cc2.barsBlocks: "bug" is not the id of an existing block']);
    expect(errors({ barsBlocks: [] })).toEqual(['popup_wall_cc2.barsBlocks: expected a non-empty list of block ids']);
    expect(errors({ passableByMonster: false })).toEqual(['popup_wall_cc2.admitsMonsters: only a tile monsters may enter admits some of them']);
    expect(errors({ admitsMonsters: ['dirt_block'] })).toEqual(['popup_wall_cc2.admitsMonsters: "dirt_block" is not the id of an existing monster']);
  });

  it('refuses closesTo that is not on a trap or does not name a trap that stays closed', () => {
    const { tiles, entities } = clones();
    const errors = (patch: Record<string, unknown>) => findFormat15ConfigErrors({ ...tiles, trap_open: { ...tiles.trap_open, ...patch } }, entities).tiles;
    expect(errors({ closesTo: 'floor' })).toEqual(['trap_open.closesTo: "floor" is not the id of an existing trap']);
    expect(errors({ closesTo: 'trap_open' })).toEqual(['trap_open.closesTo: "trap_open" must be a trap that stays closed']);
    expect(findFormat15ConfigErrors({ ...tiles, floor: { ...tiles.floor, closesTo: 'trap' } }, entities).tiles).toEqual(['floor.closesTo: only a trap closes']);
  });

  it('refuses revealedByAny without a revealed terrain, or that is not true', () => {
    const { tiles, entities } = clones();
    const falsy = { ...tiles.appearing_wall_any, revealedByAny: false } as unknown as typeof tiles.appearing_wall_any;
    expect(findFormat15ConfigErrors({ ...tiles, appearing_wall_any: falsy }, entities).tiles).toEqual(['appearing_wall_any.revealedByAny: expected true']);
    expect(findFormat15ConfigErrors({ ...tiles, floor: { ...tiles.floor, revealedByAny: true } }, entities).tiles).toEqual([
      'floor.revealedByAny: needs a revealsToOnTouch terrain'
    ]);
  });

  it('refuses sparedByBoots off a slime, without a cleaned terrain or naming something that is no boots', () => {
    const { tiles, entities } = clones();
    const errors = (patch: Record<string, unknown>) => findFormat15ConfigErrors({ ...tiles, slime_3d: { ...tiles.slime_3d, ...patch } }, entities).tiles;
    expect(errors({ hazard: 'fire' })).toEqual(['slime_3d.sparedByBoots: only a tile with the hazard "slime" spares its player']);
    expect(errors({ blockTransformsTo: undefined })).toEqual(['slime_3d.sparedByBoots: needs a blockTransformsTo terrain to clean the cell into']);
    expect(errors({ sparedByBoots: ['floor'] })).toEqual(['slime_3d.sparedByBoots: "floor" is not the id of an existing boots']);
    expect(errors({ sparedByBoots: [] })).toEqual(['slime_3d.sparedByBoots: expected a non-empty list of boots ids']);
  });

  it('refuses a powered twin that is missing, one-way, itself or live on both sides', () => {
    const { tiles, entities } = clones();
    const pad = tiles.teleport_red_cc2;
    expect(findFormat15ConfigErrors({ ...tiles, teleport_red_cc2: { ...pad, poweredTwin: 'nowhere' } }, entities).tiles).toContain(
      'teleport_red_cc2.poweredTwin: "nowhere" is not the id of another tile'
    );
    expect(findFormat15ConfigErrors({ ...tiles, teleport_red_cc2: { ...pad, poweredTwin: 'teleport_red_cc2' } }, entities).tiles).toContain(
      'teleport_red_cc2.poweredTwin: "teleport_red_cc2" is not the id of another tile'
    );
    expect(findFormat15ConfigErrors({ ...tiles, teleport_red_cc2_off: { ...tiles.teleport_red_cc2_off, poweredTwin: undefined } }, entities).tiles).toEqual([
      'teleport_red_cc2.poweredTwin: teleport_red_cc2_off does not name it back'
    ]);
    expect(findFormat15ConfigErrors({ ...tiles, teleport_red_cc2_off: { ...tiles.teleport_red_cc2_off, isTeleporter: true } }, entities).tiles).toEqual([
      'teleport_red_cc2.poweredTwin: exactly one of the two forms must be a teleporter or a transmogrifier',
      'teleport_red_cc2_off.poweredTwin: exactly one of the two forms must be a teleporter or a transmogrifier'
    ]);
  });

  it('refuses slidesOverTiles on a monster, empty, or naming an unknown tile', () => {
    const { tiles, entities } = clones();
    const errors = (patch: Record<string, unknown>) => findFormat15ConfigErrors(tiles, { ...entities, ice_block_3d: { ...entities.ice_block_3d, ...patch } }).monsters;
    expect(errors({ slidesOverTiles: ['nowhere'] })).toEqual(['ice_block_3d.slidesOverTiles: "nowhere" is not the id of an existing tile']);
    expect(errors({ slidesOverTiles: [] })).toEqual(['ice_block_3d.slidesOverTiles: expected a non-empty list of tile ids']);
    expect(errors({ kind: 'monster' })).toEqual(['ice_block_3d.slidesOverTiles: only a block slides over tiles']);
  });

  it('refuses stopsAtWall on a block that does not slide on ice, or that is not true', () => {
    const { tiles, entities } = clones();
    const errors = (patch: Record<string, unknown>) => findFormat15ConfigErrors(tiles, { ...entities, ice_block_3d: { ...entities.ice_block_3d, ...patch } }).monsters;
    expect(errors({ stopsAtWall: false })).toEqual(['ice_block_3d.stopsAtWall: expected true']);
    expect(errors({ slidesOnIce: false })).toEqual(['ice_block_3d.stopsAtWall: only a block that slides on ice stops at a wall']);
  });
});

describe('findFormat15ConfigErrors: settled semantics', () => {
  beforeEach(() => loadTestConfigs());

  it('refuses heldWhileOccupied without transformsToOnLeave, or not true', () => {
    const { tiles, entities } = clones();
    expect(findFormat15ConfigErrors({ ...tiles, floor: { ...tiles.floor, heldWhileOccupied: true } }, entities).tiles).toEqual([
      'floor.heldWhileOccupied: needs a transformsToOnLeave terrain'
    ]);
    const falsy = { ...tiles.popup_wall_cc2, heldWhileOccupied: false } as unknown as typeof tiles.popup_wall_cc2;
    expect(findFormat15ConfigErrors({ ...tiles, popup_wall_cc2: falsy }, entities).tiles).toEqual(['popup_wall_cc2.heldWhileOccupied: expected true']);
  });

  it('refuses closesToWired without closesTo, without wiredTrap or naming a tile that is no wired trap', () => {
    const { tiles, entities } = clones();
    const errors = (patch: Record<string, unknown>) => findFormat15ConfigErrors({ ...tiles, trap_open: { ...tiles.trap_open, ...patch } }, entities).tiles;
    expect(errors({ closesToWired: 'trap' })).toEqual(['trap_open.closesToWired: "trap" is not the id of an existing wired trap that stays closed']);
    expect(errors({ wiredTrap: undefined })).toEqual(['trap_open.closesToWired: only a trap a wire may end on closes into a wired trap']);
    expect(errors({ closesTo: undefined })).toEqual(['trap_open.closesToWired: needs a closesTo trap']);
  });

  it('refuses chainPushesTransitive without a chainPushes list, or not true', () => {
    const { tiles, entities } = clones();
    const errors = (patch: Record<string, unknown>) => findFormat15ConfigErrors(tiles, { ...entities, ice_block_3d: { ...entities.ice_block_3d, ...patch } }).monsters;
    expect(errors({ chainPushes: undefined })).toEqual(['ice_block_3d.chainPushesTransitive: needs a chainPushes list']);
    expect(errors({ chainPushesTransitive: false })).toEqual(['ice_block_3d.chainPushesTransitive: expected true']);
  });
});
