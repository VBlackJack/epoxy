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

import type { ConfigBundle } from '../config/ConfigRegistry';
import { CC2_COVERAGE } from '../core/cc2/cc2Coverage';
import { GameEngine } from '../core/GameEngine';
import { LevelValidator } from '../core/LevelValidator';
import { loadTestConfigs } from '../test/loadTestConfigs';
import type { Cc2File } from './cc2Model';
import {
  ENTITY_MAP,
  GENDER_SIGN_MAP,
  ITEM_MAP,
  RESERVED_PLAYER_ENTITIES,
  TERRAIN_MAP,
  TRACK_JUNCTION,
  NAND_GATE,
  COUNTER_GATE
} from './cc2Mapping';
import { cc2ClueBlocks, cc2GridHash, cc2HintText, convertCc2File, convertCc2Map } from './cc2ToEpoxy';
import type { Cc2ConvertOptions } from './cc2ToEpoxy';
import { cc2TileInfo } from './cc2TileTable';
import { Cc2Layer } from './cc2Model';
import { actorTile, FLOOR_CODE, makeMap, modTile, player, put } from './cc2TestMaps';

const OPTIONS: Cc2ConvertOptions = { file: 'one.c2m', order: 3, sha256: 'ab'.repeat(32) };
const N = 0x1;
const E = 0x2;
const S = 0x4;
const W = 0x8;
const DIR_N = 0;
const DIR_E = 1;
const DIR_S = 2;
const DIR_W = 3;
const CHIP = 0x2a;
const WALL = 0x02;
const PURPLE_WALL = 0x73;
const THIN_WALL = 0x6d;
const CANOPY = 0x10;
const CLONER_CC1 = 0x43;
const CLONER = 0x44;
const RED_BUTTON = 0x39;
const BROWN_BUTTON = 0x3a;
const TRAP = 0x42;
const BUG = 0x33;
const DIRECTIONAL_BLOCK = 0x81;
const MELINDA = 0x56;
const MIRROR_CHIP = 0x65;
const STEEL_WALL = 0x50;
const DYNAMITE = 0x51;
const PINK = 0x5e;
const GATE = 0x5c;

let bundle: ConfigBundle;

beforeAll(() => {
  bundle = loadTestConfigs();
});

function convert(placements: ReturnType<typeof put>[], width = 6, height = 4, options: Cc2ConvertOptions = OPTIONS) {
  return convertCc2Map(makeMap(width, height, [player(0, 0), ...placements]), options);
}

describe('mapping tables', () => {
  it('maps every code to an id that exists on the right layer', () => {
    const tiles = { ...bundle.tiles.tiles, ...bundle.cc2Tiles?.tiles };
    const entities = { ...bundle.monsters.entities, ...bundle.cc2Tiles?.entities };
    for (const [code, mapping] of TERRAIN_MAP) {
      expect(tiles[mapping.id]?.layer, `0x${code.toString(16)} ${mapping.id}`).toBe('terrain');
      expect(cc2TileInfo(code)?.layer, `0x${code.toString(16)}`).toBe(Cc2Layer.Terrain);
    }
    for (const [code, mapping] of ITEM_MAP) {
      expect(tiles[mapping.id]?.layer, `0x${code.toString(16)} ${mapping.id}`).toBe('item');
      expect(cc2TileInfo(code)?.layer, `0x${code.toString(16)}`).toBe(Cc2Layer.Item);
    }
    for (const [code, mapping] of ENTITY_MAP) {
      expect(entities[mapping.id], `0x${code.toString(16)} ${mapping.id}`).toBeDefined();
      expect(cc2TileInfo(code)?.layer, `0x${code.toString(16)}`).toBe(Cc2Layer.Actor);
    }
    for (const mapping of RESERVED_PLAYER_ENTITIES.values()) expect(entities[mapping.id]).toBeDefined();
    for (const [code, mapping] of GENDER_SIGN_MAP) {
      expect(tiles[mapping.id]?.layer).toBe('terrain');
      expect(cc2TileInfo(code)?.layer).toBe(Cc2Layer.Terrain);
    }
    for (const mapping of [TRACK_JUNCTION, NAND_GATE, COUNTER_GATE]) expect(tiles[mapping.id]).toBeDefined();
  });

  it('agrees with the epoxyId of the tile table', () => {
    for (const [code, mapping] of TERRAIN_MAP) {
      const declared = cc2TileInfo(code)?.epoxyId;
      if (declared !== undefined) expect(mapping.id, `0x${code.toString(16)}`).toBe(declared);
    }
  });

  it('maps no code twice across the terrain, item and actor tables', () => {
    const all = [...TERRAIN_MAP.keys(), ...ITEM_MAP.keys(), ...ENTITY_MAP.keys()];
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('terrain, items and entities', () => {
  it('maps exact elements to Epoxy ids', () => {
    const { level, coverage } = convert([
      put(1, 0, { code: CHIP }, { code: WALL }),
      put(2, 0, { code: 0x27 }, { code: FLOOR_CODE }),
      put(3, 0, actorTile(BUG, DIR_E), { code: FLOOR_CODE })
    ]);
    expect(level.terrain[0][1]).toBe('wall');
    expect(level.items[0][1]).toBe('chip');
    expect(level.items[0][2]).toBe('key_blue');
    expect(level.entities).toEqual([{ x: 3, y: 0, type: 'bug', dir: 'E' }]);
    expect(coverage).toEqual({ verdict: 'exact', lost: [], approx: [] });
  });

  it('plays the floor mimic, timid teeth, ghost and rover as Epoxy monsters, two exact and two approximate', () => {
    const { level, coverage } = convert([
      put(1, 0, actorTile(0x82, DIR_E), { code: FLOOR_CODE }),
      put(2, 0, actorTile(0x57, DIR_E), { code: FLOOR_CODE }),
      put(3, 0, actorTile(0x8b, DIR_E), { code: FLOOR_CODE }),
      put(4, 0, actorTile(0x69, DIR_E), { code: FLOOR_CODE })
    ]);
    expect(level.entities.map((entity) => entity.type)).toEqual(['floor_mimic', 'timid_teeth', 'ghost', 'rover']);
    expect(coverage.verdict).toBe('approx');
    expect(coverage.lost).toEqual([]);
    expect(coverage.approx).toEqual(['ghost', 'rover']);
  });

  it('maps approximate elements to Epoxy ids and says so', () => {
    const { level, coverage } = convert([put(1, 0, { code: 0x46 }), put(2, 0, { code: 0x10 }), put(3, 0, { code: 0x68 }, { code: FLOOR_CODE })]);
    expect(level.terrain[0][1]).toBe('force_cycle');
    expect(level.terrain[0][2]).toBe('teleport_red_cc2');
    expect(level.items[0][3]).toBe('hurl_stone');
    expect(coverage.verdict).toBe('approx');
    expect(coverage.approx).toEqual(['bowling_ball', 'force_floor_random', 'teleport_red']);
  });

  it('keeps reserved ids for what Epoxy lacks', () => {
    const { level, coverage, report } = convertCc2Map(
      makeMap(5, 3, [player(1, 0, DIR_S), put(2, 2, { code: 0xfa })]),
      OPTIONS
    );
    expect(level.terrain[2][2]).toBe('cc2_unknown');
    expect(coverage.verdict).toBe('lost');
    expect(coverage.lost).toEqual(['unknown']);
    expect(report.lost.map((entry) => entry.key)).toEqual(coverage.lost);
    expect(report.lost.every((entry) => entry.reason.length > 0)).toBe(true);
  });

  it('plays the mirror players as Epoxy monsters, approximately', () => {
    const { level, coverage } = convert([
      put(3, 0, actorTile(MIRROR_CHIP, DIR_W), { code: FLOOR_CODE }),
      put(4, 0, actorTile(0x66, DIR_E), { code: FLOOR_CODE })
    ]);
    expect(level.entities).toEqual([
      { x: 3, y: 0, type: 'mirror_chip', dir: 'W' },
      { x: 4, y: 0, type: 'mirror_melinda', dir: 'E' }
    ]);
    expect(coverage.verdict).toBe('approx');
    expect(coverage.lost).toEqual([]);
    expect(coverage.approx).toEqual(['mirror_chip', 'mirror_melinda']);
  });

  it('keeps cc2_unknown for cells past an undecodable code', () => {
    const map = makeMap(3, 2, [player(0, 0)]);
    map.cells.length = 4;
    const { level, coverage } = convertCc2Map(map, OPTIONS);
    expect(level.terrain[1][1]).toBe('cc2_unknown');
    expect(level.terrain[1][2]).toBe('cc2_unknown');
    expect(coverage.lost).toEqual(['unknown']);
  });

  it('maps the wave 2 items: the bribe and the steel foil are exact, the toggle clock is approximate', () => {
    const bribe = convert([put(1, 0, { code: 0x8f }, { code: FLOOR_CODE })]);
    expect(bribe.level.items[0][1]).toBe('bribe');
    expect(bribe.coverage).toEqual({ verdict: 'exact', lost: [], approx: [] });
    const both = convert([put(1, 0, { code: 0x8c }, { code: FLOOR_CODE }), put(2, 0, { code: 0x4d }, { code: FLOOR_CODE })]);
    expect(both.level.items[0].slice(1, 3)).toEqual(['steel_foil', 'toggle_clock']);
    expect(both.coverage).toEqual({ verdict: 'approx', lost: [], approx: ['toggle_clock'] });
    expect(both.report.exact).toContain('steel_foil');
    expect(both.report.approx.every((entry) => entry.reason.length > 0)).toBe(true);
  });

  it('maps the CC2 wave 1 elements to their Epoxy ids, exactly', () => {
    const { level, coverage } = convert([
      put(1, 0, { code: 0x5a }),
      put(2, 0, { code: 0x5b }),
      put(3, 0, { code: STEEL_WALL }),
      put(4, 0, { code: 0x84 }, { code: FLOOR_CODE }),
      put(5, 0, { code: 0x83 }, { code: FLOOR_CODE }),
      put(0, 1, { code: 0x59 }, { code: FLOOR_CODE }),
      put(1, 1, { code: 0x1f })
    ]);
    expect(level.terrain[0].slice(1, 4)).toEqual(['sign_chip_only', 'sign_melinda_only', 'steel_wall']);
    expect(level.items[0].slice(4, 6)).toEqual(['green_chip', 'green_bomb']);
    expect(level.items[1][0]).toBe('hiking_boots');
    expect(coverage).toEqual({ verdict: 'exact', lost: [], approx: [] });
  });

  it('drops a no-sign on a wall or a steel wall and keeps the cell, approximately', () => {
    const { level, coverage } = convert([
      put(1, 0, { code: 0x7f }, { code: 0x26 }, { code: WALL }),
      put(2, 0, { code: 0x7f }, { code: 0x26 }, { code: STEEL_WALL })
    ]);
    expect(level.terrain[0].slice(1, 3)).toEqual(['wall', 'steel_wall']);
    expect(level.items[0].slice(1, 3)).toEqual(['key_red', 'key_red']);
    expect(coverage.lost).toEqual([]);
    expect(coverage.approx).toEqual(['no_sign_no_effect']);
  });

  it('drops a no-sign over a chip or a bomb, which no player carries, and keeps the item', () => {
    const { level, coverage } = convert([
      put(1, 0, { code: 0x7f }, { code: 0x2a }, { code: FLOOR_CODE }),
      put(2, 0, { code: 0x7f }, { code: 0x40 }, { code: FLOOR_CODE }),
      put(3, 0, { code: 0x7f }, { code: 0x84 }, { code: FLOOR_CODE }),
      put(4, 0, { code: 0x7f }, { code: 0x83 }, { code: FLOOR_CODE })
    ]);
    expect(level.terrain[0].slice(1, 5)).toEqual(['floor', 'floor', 'floor', 'floor']);
    expect(level.items[0].slice(1, 5)).toEqual(['chip', 'bomb', 'green_chip', 'green_bomb']);
    expect(coverage.lost).toEqual([]);
    expect(coverage.approx).toEqual(['no_sign_no_effect']);
  });

  it('turns a no-sign over a key into a forbid tile with no item', () => {
    const { level, coverage } = convert([put(1, 0, { code: 0x7f }, { code: 0x27 }, { code: FLOOR_CODE })]);
    expect(level.terrain[0][1]).toBe('forbid_key_blue');
    expect(level.items[0][1]).toBeNull();
    expect(coverage.lost).toEqual([]);
    expect(coverage.approx).toEqual([]);
    expect(coverage.verdict).toBe('exact');
  });

  it('turns a no-sign over boots into the matching forbid tile', () => {
    const cells = [
      put(1, 0, { code: 0x7f }, { code: 0x3b }, { code: FLOOR_CODE }),
      put(2, 0, { code: 0x7f }, { code: 0x3c }, { code: FLOOR_CODE }),
      put(3, 0, { code: 0x7f }, { code: 0x3d }, { code: FLOOR_CODE }),
      put(4, 0, { code: 0x7f }, { code: 0x3e }, { code: FLOOR_CODE })
    ];
    const { level, coverage } = convert(cells);
    expect(level.terrain[0].slice(1, 5)).toEqual([
      'forbid_boots_ice', 'forbid_boots_force', 'forbid_boots_fire', 'forbid_boots_water'
    ]);
    expect(level.items[0].slice(1, 5)).toEqual([null, null, null, null]);
    expect(coverage.approx).toEqual([]);
    expect(coverage.verdict).toBe('exact');
  });

  it('puts a no-sign over any other carried item on the item layer, keeping the terrain', () => {
    const { level, coverage } = convert([
      put(1, 0, { code: 0x7f }, { code: DYNAMITE }, { code: FLOOR_CODE }),
      put(2, 0, { code: 0x7f }, { code: 0x68 }, { code: FLOOR_CODE }),
      put(3, 0, { code: 0x7f }, { code: 0x52 }, { code: FLOOR_CODE }),
      put(4, 0, { code: 0x7f }, { code: 0x90 }, { code: FLOOR_CODE }),
      put(5, 0, { code: 0x7f }, { code: 0x59 }, { code: FLOOR_CODE })
    ]);
    expect(level.terrain[0].slice(1, 6)).toEqual(['floor', 'floor', 'floor', 'floor', 'floor']);
    expect(level.items[0].slice(1, 6)).toEqual([
      'no_sign_dynamite', 'no_sign_hurl_stone', 'no_sign_ward', 'no_sign_boots_speed', 'no_sign_hiking_boots'
    ]);
    expect(coverage.lost).toEqual([]);
    expect(coverage.approx).not.toContain('no_sign_item');
  });

  it('puts a no-sign over a key or boots on any terrain but plain floor on the item layer', () => {
    const { level, coverage } = convert([
      put(1, 0, { code: 0x7f }, { code: 0x26 }, { code: 0x1e }),
      put(2, 0, { code: 0x7f }, { code: 0x3e }, { code: 0x08 }),
      put(3, 0, { code: 0x7f }, { code: 0x27 }, { code: 0x03 })
    ]);
    expect(level.terrain[0].slice(1, 4)).toEqual(['gravel', 'water', 'ice']);
    expect(level.items[0].slice(1, 4)).toEqual(['no_sign_key_red', 'no_sign_boots_water', 'no_sign_key_blue']);
    expect(coverage.lost).toEqual([]);
    expect(coverage.approx).toEqual([]);
    expect(coverage.verdict).toBe('exact');
  });

  it('puts a no-sign over the steel foil and the bribe on the item layer, and drops the toggle clock', () => {
    const { level, coverage } = convert([
      put(1, 0, { code: 0x7f }, { code: 0x8c }, { code: FLOOR_CODE }),
      put(2, 0, { code: 0x7f }, { code: 0x8f }, { code: FLOOR_CODE }),
      put(3, 0, { code: 0x7f }, { code: 0x4d }, { code: FLOOR_CODE })
    ]);
    expect(level.items[0].slice(1, 4)).toEqual(['no_sign_steel_foil', 'no_sign_bribe', null]);
    expect(coverage.lost).toEqual([]);
    expect(coverage.approx).toEqual(['no_sign_bonus', 'toggle_clock']);
  });

  it('drops a bonus item under a no-sign and signs the lightning bolt and the railroad sign', () => {
    const bonus = convert([put(1, 0, { code: 0x7f }, { code: 0x7a }, { code: FLOOR_CODE })]);
    expect(bonus.level.items[0][1]).toBeNull();
    expect(bonus.coverage.lost).toEqual([]);
    expect(bonus.coverage.approx).toEqual(['no_sign_bonus']);
    const bolt = convert([put(1, 0, { code: 0x7f }, { code: 0x62 }, { code: FLOOR_CODE })]);
    expect(bolt.level.items[0][1]).toBe('no_sign_lightning_bolt');
    expect(bolt.coverage.approx).toEqual(['lightning_bolt']);
    const railroad = convert([put(1, 0, { code: 0x7f }, { code: 0x6f }, { code: FLOOR_CODE })]);
    expect(railroad.level.items[0][1]).toBe('no_sign_railroad_sign');
    expect(railroad.coverage.lost).toEqual([]);
    expect(railroad.coverage.approx).toEqual([]);
  });

  it('plays an empty no-sign as the plain floor, exactly', () => {
    const { level, coverage } = convert([put(1, 0, { code: 0x7f }, { code: FLOOR_CODE })]);
    expect(level.terrain[0][1]).toBe('floor');
    expect(coverage.verdict).toBe('exact');
  });

  it('plays a custom floor and a custom wall as plain ones, exactly', () => {
    const { level, coverage } = convert([put(1, 0, modTile(0x6b, 3)), put(2, 0, modTile(0x70, 2))]);
    expect(level.terrain[0][1]).toBe('floor');
    expect(level.terrain[0][2]).toBe('wall');
    expect(coverage.verdict).toBe('exact');
  });

  it('reads every track as a track cell and keeps its segments in the level', () => {
    const { level, coverage } = convert([put(1, 0, modTile(0x4f, 0x10)), put(2, 0, modTile(0x4f, 0x11))]);
    expect(level.terrain[0][1]).toBe('rail_junction');
    expect(level.terrain[0][2]).toBe('rail_junction');
    expect(level.railTracks).toEqual([
      { x: 1, y: 0, mask: 0x10 },
      { x: 2, y: 0, mask: 0x11 }
    ]);
    expect(coverage.lost).not.toContain('track_junction');
    expect(coverage.approx).toContain('track');
    expect(coverage.approx).toContain('track_junction');
  });

  it('keeps each track bit as its Lexy railroad segment', () => {
    for (let bit = 0; bit < 6; bit++) {
      const { level, coverage } = convert([put(1, 0, modTile(0x4f, 1 << bit))]);
      expect(level.railTracks, `bit ${bit}`).toEqual([{ x: 1, y: 0, mask: 1 << bit }]);
      // One segment and no switch is a plain track; the junction key is for several segments or a switch.
      expect(coverage.approx, `bit ${bit}`).toContain('track');
      expect(coverage.approx, `bit ${bit}`).not.toContain('track_junction');
    }
  });

  it('reads the switch flag, the active track and the entered side', () => {
    const switched = 0x40 | 0x02 | (1 << 8) | (2 << 12);
    const { level, coverage } = convert([put(1, 0, modTile(0x4f, switched))]);
    // Moving south when it came in: it entered from the north.
    expect(level.railTracks).toEqual([{ x: 1, y: 0, mask: 0x02, active: 1, entry: 'N' }]);
    expect(coverage.approx).toContain('track_junction');
  });

  it('plays the railroad sign as the Epoxy item', () => {
    const { level, coverage, report } = convert([put(1, 0, { code: 0x6f }, { code: FLOOR_CODE })]);
    expect(level.items[0][1]).toBe('railroad_sign');
    expect(coverage.lost).not.toContain('railroad_sign');
    expect(report.exact).toContain('railroad_sign');
  });

  it('plays a steel wall next to dynamite as dynamite alone is played', () => {
    expect(convert([put(1, 0, { code: STEEL_WALL })]).coverage.verdict).toBe('exact');
    const withDynamite = convert([put(1, 0, { code: STEEL_WALL }), put(2, 0, { code: DYNAMITE }, { code: FLOOR_CODE })]);
    expect(withDynamite.coverage.lost).toEqual([]);
    expect(withDynamite.coverage.approx).toEqual(['dynamite']);
    expect(withDynamite.level.items[0][2]).toBe('dynamite');
  });
});

describe('thin walls', () => {
  it('turns panel flags into cell edges and leaves the terrain alone', () => {
    const { level, coverage } = convert([
      put(1, 0, { code: THIN_WALL, flags: N | S }, { code: WALL }),
      put(2, 0, { code: 0x1b }, { code: FLOOR_CODE }),
      put(3, 0, { code: 0x1c }, { code: FLOOR_CODE }),
      put(4, 0, { code: 0x1d }, { code: FLOOR_CODE })
    ]);
    expect(level.cellEdges).toEqual([
      { x: 1, y: 0, sides: ['N', 'S'] },
      { x: 2, y: 0, sides: ['S'] },
      { x: 3, y: 0, sides: ['E'] },
      { x: 4, y: 0, sides: ['E', 'S'] }
    ]);
    expect(level.terrain[0][1]).toBe('wall');
    expect(coverage.verdict).toBe('exact');
  });

  it('keeps the canopy flag with the real edges and plays it exactly', () => {
    const { level, coverage } = convert([put(1, 0, { code: THIN_WALL, flags: W | CANOPY }, { code: FLOOR_CODE })]);
    expect(level.cellEdges).toEqual([{ x: 1, y: 0, sides: ['W'], canopy: true }]);
    expect(coverage.lost).toEqual([]);
    expect(coverage.approx).toEqual([]);
    expect(coverage.verdict).toBe('exact');
  });

  it('keeps a canopy alone as an edge entry with no side', () => {
    const { level, coverage } = convert([put(1, 0, { code: THIN_WALL, flags: CANOPY }, { code: FLOOR_CODE })]);
    expect(level.cellEdges).toEqual([{ x: 1, y: 0, sides: [], canopy: true }]);
    expect(coverage.lost).toEqual([]);
    expect(coverage.approx).toEqual([]);
  });
});

describe('players', () => {
  it('starts on the first player with its facing', () => {
    const { level } = convertCc2Map(makeMap(5, 3, [player(3, 1, DIR_W)]), OPTIONS);
    expect(level.playerStart).toEqual({ x: 3, y: 1, dir: 'W' });
    expect(level.entities).toEqual([]);
  });

  it('makes every further player a start of its own and plays the level approximately', () => {
    const { level, coverage } = convertCc2Map(
      makeMap(5, 3, [player(1, 0, DIR_S), player(2, 2, DIR_E, MELINDA), player(4, 2, DIR_N, MIRROR_CHIP)]),
      OPTIONS
    );
    expect(level.playerStart).toEqual({ x: 1, y: 0, dir: 'S' });
    expect(level.extraPlayers).toEqual([{ x: 2, y: 2, dir: 'E', character: 'melinda' }]);
    expect(level.character).toBeUndefined();
    expect(level.entities).toEqual([{ x: 4, y: 2, type: 'mirror_chip', dir: 'N' }]);
    expect(coverage.lost).toEqual([]);
    expect(coverage.approx).toEqual(['mirror_chip', 'multiple_players']);
  });

  it('plays a level whose only player is Melinda with her character, exactly', () => {
    const { level, coverage } = convertCc2Map(makeMap(3, 3, [player(1, 1, DIR_N, MELINDA)]), OPTIONS);
    expect(level.playerStart).toEqual({ x: 1, y: 1, dir: 'N' });
    expect(level.character).toBe('melinda');
    expect(coverage).toEqual({ verdict: 'exact', lost: [], approx: [] });
  });

  it('leaves Chip as the default character, plays two players and a mirror player', () => {
    expect(convertCc2Map(makeMap(3, 3, [player(1, 1, DIR_N)]), OPTIONS).level.character).toBeUndefined();
    const pair = convertCc2Map(makeMap(5, 3, [player(1, 1, DIR_N), player(3, 1, DIR_N, MELINDA)]), OPTIONS);
    expect(pair.level.character).toBeUndefined();
    expect(pair.level.extraPlayers).toEqual([{ x: 3, y: 1, dir: 'N', character: 'melinda' }]);
    expect(pair.coverage.lost).toEqual([]);
    expect(pair.coverage.approx).toEqual(['multiple_players']);
    const melindaFirst = convertCc2Map(makeMap(5, 3, [player(1, 1, DIR_N, MELINDA), player(3, 1, DIR_S)]), OPTIONS);
    expect(melindaFirst.level.character).toBe('melinda');
    expect(melindaFirst.level.playerStart).toEqual({ x: 1, y: 1, dir: 'N' });
    expect(melindaFirst.level.extraPlayers).toEqual([{ x: 3, y: 1, dir: 'S', character: 'chip' }]);
    expect(convertCc2Map(makeMap(3, 3, [player(1, 1, DIR_N)]), OPTIONS).level.extraPlayers).toBeUndefined();
    const mirror = convertCc2Map(makeMap(5, 3, [player(1, 1, DIR_N, MELINDA), player(3, 1, DIR_N, MIRROR_CHIP)]), OPTIONS);
    expect(mirror.coverage.lost).toEqual([]);
    expect(mirror.coverage.approx).toEqual(['mirror_chip']);
  });

  it('warns about a level with no player', () => {
    const { level, report } = convertCc2Map(makeMap(3, 3), OPTIONS);
    expect(level.playerStart).toEqual({ x: 0, y: 0, dir: 'S' });
    expect(report.warnings).toContain('no player found');
  });
});

describe('directional blocks', () => {
  const block = (arrows: number, dir = DIR_S) => convert([put(1, 0, { code: DIRECTIONAL_BLOCK, dir, arrows }, { code: FLOOR_CODE })]).level.entities[0];

  it('maps one arrow to a one-way block facing it', () => {
    expect(block(E)).toEqual({ x: 1, y: 0, type: 'arrow_block_one', dir: 'E' });
  });

  it('maps opposite arrows to a line and adjacent ones to a corner', () => {
    expect(block(N | S).type).toBe('arrow_block_line');
    expect(block(E | W).type).toBe('arrow_block_line');
    // Forward and right: facing south, the right-hand arrow points west.
    expect(block(S | W)).toEqual({ x: 1, y: 0, type: 'arrow_block_corner', dir: 'S' });
    expect(block(N | E)).toEqual({ x: 1, y: 0, type: 'arrow_block_corner', dir: 'N' });
    expect(block(W | N)).toEqual({ x: 1, y: 0, type: 'arrow_block_corner', dir: 'W' });
  });

  it('maps three arrows to a tee facing away from the missing side', () => {
    expect(block(E | S | W)).toEqual({ x: 1, y: 0, type: 'arrow_block_tee', dir: 'S' });
    expect(block(N | E | S)).toEqual({ x: 1, y: 0, type: 'arrow_block_tee', dir: 'E' });
  });

  it('plays four arrows as the cross block, exactly (the sliding push is played)', () => {
    expect(block(N | E | S | W).type).toBe('arrow_block_cross');
    const { coverage, report } = convert([put(1, 0, { code: DIRECTIONAL_BLOCK, dir: DIR_S, arrows: N | E | S | W }, { code: FLOOR_CODE })]);
    expect(coverage).toEqual({ verdict: 'exact', lost: [], approx: [] });
    expect(report.exact).toContain('arrow_block_cross');
    expect(CC2_COVERAGE.arrow_block_cross.reason).not.toMatch(/deferred/);
    expect(report.warnings).toEqual([]);
  });

  it('plays a block with no arrow as the locked arrow block, exactly', () => {
    const { level, coverage, report } = convert([put(1, 0, { code: DIRECTIONAL_BLOCK, dir: DIR_S, arrows: 0 }, { code: FLOOR_CODE })]);
    expect(level.entities[0].type).toBe('arrow_block_none');
    expect(coverage).toEqual({ verdict: 'exact', lost: [], approx: [] });
    expect(report.warnings).toEqual([]);
  });

  it('plays the solid green wall and the popdown floor exactly', () => {
    const { level, coverage } = convert([put(1, 0, { code: 0x7d }), put(2, 0, { code: 0x7e })]);
    expect(level.terrain[0].slice(1, 3)).toEqual(['wall', 'block_barrier_floor']);
    expect(coverage).toEqual({ verdict: 'exact', lost: [], approx: [] });
  });

  it('keeps arrow blocks exact in coverage', () => {
    const { coverage } = convert([put(1, 0, { code: DIRECTIONAL_BLOCK, dir: DIR_S, arrows: N | S }, { code: FLOOR_CODE })]);
    expect(coverage.verdict).toBe('exact');
  });
});

describe('cloners and links', () => {
  it('turns a CC1-style cloner with an actor into a clone machine, a template and a link', () => {
    const { level, coverage } = convert([
      put(1, 0, { code: RED_BUTTON }),
      put(3, 0, actorTile(BUG, DIR_E), { code: CLONER_CC1 })
    ]);
    expect(level.terrain[0][3]).toBe('clone_machine');
    expect(level.entities).toEqual([{ x: 3, y: 0, type: 'bug', dir: 'E' }]);
    expect(level.cloneLinks).toEqual([
      { buttonX: 1, buttonY: 0, clonerX: 3, clonerY: 0, templateType: 'bug', templateDir: 'E' }
    ]);
    expect(coverage.verdict).toBe('exact');
  });

  it('keeps the template facing and warns when the cloner arrow differs', () => {
    const { level, report } = convert([
      put(1, 0, { code: RED_BUTTON }),
      put(3, 0, actorTile(BUG, DIR_N), modTile(CLONER, W))
    ]);
    expect(level.cloneLinks[0].templateDir).toBe('N');
    expect(level.entities[0].dir).toBe('N');
    expect(report.warnings.some((w) => w.includes('differs'))).toBe(true);
  });

  it('keeps the template direction when it is one of the arrows', () => {
    const { level } = convert([
      put(1, 0, { code: RED_BUTTON }),
      put(3, 0, actorTile(BUG, DIR_E), modTile(CLONER, N | E))
    ]);
    expect(level.cloneLinks[0].templateDir).toBe('E');
  });

  it('plays a trap or flame jet that a live wire reaches in its wired form', () => {
    const map = makeMap(4, 3, [
      player(0, 2),
      put(1, 0, modTile(PINK, 0x4)),
      put(1, 1, modTile(FLOOR_CODE, 0x1 | 0x2 | 0x8)),
      put(0, 1, { code: TRAP }),
      put(2, 1, { code: 0x5f })
    ]);
    const { level, coverage, report } = convertCc2Map(map, OPTIONS);
    expect(level.terrain[1][0]).toBe('trap_wired');
    expect(level.terrain[1][2]).toBe('flame_jet_cc2_off');
    expect(level.signalLinks).toEqual([
      { fromX: 1, fromY: 0, toX: 0, toY: 1 },
      { fromX: 1, fromY: 0, toX: 2, toY: 1 }
    ]);
    expect(coverage.lost).toEqual([]);
    expect(coverage.approx).toEqual(['wired_flame_jet']);
    expect(report.exact).toEqual(expect.arrayContaining(['wire', 'wired_trap']));
  });

  it('keeps an unwired trap plain and plays flame jets as the CC2 jets, wired or not', () => {
    const plain = convert([put(1, 0, { code: TRAP }), put(2, 0, { code: 0x60 })]);
    expect(plain.level.terrain[0][1]).toBe('trap');
    expect(plain.level.terrain[0][2]).toBe('flame_jet_cc2_on');
    expect(plain.coverage).toEqual({ verdict: 'approx', lost: [], approx: ['flame_jet'] });
    const map = makeMap(4, 3, [
      player(0, 2),
      put(1, 0, modTile(PINK, 0x4)),
      put(1, 1, modTile(FLOOR_CODE, 0x1 | 0x2)),
      put(2, 1, { code: 0x60 })
    ]);
    expect(convertCc2Map(map, OPTIONS).level.terrain[1][2]).toBe('flame_jet_cc2_on');
  });

  it('maps the purple tiles, the switches and the gray button to their Epoxy ids', () => {
    const { level, coverage } = convert([
      put(1, 0, { code: 0x72 }),
      put(2, 0, { code: 0x73 }),
      put(3, 0, { code: 0x87 }),
      put(4, 0, { code: 0x88 }),
      put(5, 0, { code: 0x89 }),
      put(1, 1, { code: 0x47 })
    ]);
    expect(level.terrain[0].slice(1)).toEqual([
      'purple_floor',
      'purple_wall',
      'black_button',
      'toggle_switch_off',
      'toggle_switch_on'
    ]);
    expect(level.terrain[1][1]).toBe('button_gray_area');
    expect(coverage.lost).toEqual([]);
    expect(coverage.approx).toEqual(['button_gray']);
  });

  it('links a toggle switch and a black button to the purple tiles they wire', () => {
    const map = makeMap(5, 2, [
      player(0, 1),
      put(0, 0, modTile(0x88, 0x2)),
      put(1, 0, modTile(FLOOR_CODE, 0x2 | 0x8)),
      put(2, 0, { code: 0x73 }),
      put(0, 1, modTile(0x87, 0x2)),
      put(1, 1, modTile(FLOOR_CODE, 0x2 | 0x8)),
      put(2, 1, { code: 0x72 })
    ]);
    const { level, coverage } = convertCc2Map(map, OPTIONS);
    expect(level.signalLinks).toEqual([
      { fromX: 0, fromY: 0, toX: 2, toY: 0 },
      { fromX: 0, fromY: 1, toX: 2, toY: 1 }
    ]);
    expect(coverage.lost).toEqual([]);
  });

  it('works the next clone machine in reading order, wrapping round', () => {
    const { level } = convertCc2Map(
      makeMap(4, 2, [
        player(0, 0),
        put(0, 1, actorTile(BUG, DIR_S), { code: CLONER_CC1 }),
        put(3, 1, { code: RED_BUTTON })
      ]),
      OPTIONS
    );
    expect(level.cloneLinks).toEqual([
      { buttonX: 3, buttonY: 1, clonerX: 0, clonerY: 1, templateType: 'bug', templateDir: 'S' }
    ]);
  });

  it('links a brown button to the next trap in reading order', () => {
    const { level } = convert([
      put(1, 0, { code: BROWN_BUTTON }),
      put(2, 1, { code: TRAP }),
      put(4, 0, { code: TRAP })
    ]);
    expect(level.trapLinks).toEqual([{ buttonX: 1, buttonY: 0, trapX: 4, trapY: 0 }]);
  });

  it('wraps to the first trap when none follows the button', () => {
    const { level } = convert([put(4, 2, { code: BROWN_BUTTON }), put(2, 0, { code: TRAP })]);
    expect(level.trapLinks).toEqual([{ buttonX: 4, buttonY: 2, trapX: 2, trapY: 0 }]);
  });

  it('warns about a button with nothing to work and about a cloner with no template', () => {
    const lonely = convert([put(1, 0, { code: BROWN_BUTTON }), put(2, 0, { code: RED_BUTTON })]);
    expect(lonely.level.trapLinks).toEqual([]);
    expect(lonely.level.cloneLinks).toEqual([]);
    expect(lonely.report.warnings.length).toBe(2);
    const empty = convert([put(1, 0, { code: RED_BUTTON }), put(2, 0, { code: CLONER })]);
    expect(empty.level.cloneLinks).toEqual([]);
    expect(empty.report.warnings.some((w) => w.includes('no template'))).toBe(true);
  });
});

describe('chips and metadata', () => {
  it('counts the computer chips and the green chips (not the extra chip), and only where a socket asks for them', () => {
    const { level, report } = convert([
      put(5, 0, { code: 0x2c }),
      put(1, 0, { code: CHIP }, { code: FLOOR_CODE }),
      put(2, 0, { code: CHIP }, { code: FLOOR_CODE }),
      put(3, 0, { code: 0x84 }, { code: FLOOR_CODE }),
      put(4, 0, { code: 0x2b }, { code: FLOOR_CODE })
    ]);
    expect(level.chipsRequired).toBe(3);
    expect(level.items[0][4]).toBe('chip');
    expect(level.cc2?.coverage.lost).not.toContain('extra_chip');
    expect(report.exact).toContain('extra_chip');
    expect(report.warnings).toEqual([]);
    const noSocket = convert([put(1, 0, { code: CHIP }, { code: FLOOR_CODE })]);
    expect(noSocket.level.chipsRequired).toBe(0);
    expect(noSocket.report.warnings).toContain('chips placed but no socket: chips required is 0');
  });

  it('reads the time limit, title, author and hint from a file', () => {
    const file: Cc2File = {
      sections: [
        { kind: 'text', tag: 'TITL', text: ' Warm Up ', terminated: true, extra: new Uint8Array(0) },
        { kind: 'text', tag: 'AUTH', text: 'Someone', terminated: true, extra: new Uint8Array(0) },
        { kind: 'text', tag: 'CLUE', text: 'Mind the\r\nfire.', terminated: true, extra: new Uint8Array(0) },
        { kind: 'options', tag: 'OPTN', raw: new Uint8Array([0x2c, 0x01, 0, 0, 0, 0]), options: { timeLimit: 300, flags: [] } },
        { kind: 'map', tag: 'PACK', map: makeMap(3, 3, [player(1, 1)]) }
      ],
      trailing: new Uint8Array(0)
    };
    const { level, report } = convertCc2File(file, { file: 'a.c2m', order: 7, sha256: '00'.repeat(32), music: 'Track01' });
    expect(level.customTitle).toBe('Warm Up');
    expect(level.author).toBe('Someone');
    expect(level.customHint).toBe('Mind the\nfire.');
    expect(level.timeLimitSeconds).toBe(300);
    expect(level.number).toBe(7);
    expect(level.cc2?.music).toBe('Track01');
    expect(report.title).toBe('Warm Up');
  });

  it('keeps the level hint to the CLUE section and does not glue the note blocks into it', () => {
    const note = (text: string): Cc2File => ({
      sections: [{ kind: 'text', tag: 'NOTE', text, terminated: true, extra: new Uint8Array(0) }],
      trailing: new Uint8Array(0)
    });
    expect(cc2HintText(note('intro\r\n[CLUE]\r\nfirst hint\r\n[CLUE]\r\nsecond hint'))).toBeUndefined();
    expect(cc2HintText(note('no hint here'))).toBeUndefined();
  });

  it('splits the note on its tags: the author comment, JETLIFE and COM blocks are not hints', () => {
    const note = (text: string): Cc2File => ({
      sections: [{ kind: 'text', tag: 'NOTE', text, terminated: true, extra: new Uint8Array(0) }],
      trailing: new Uint8Array(0)
    });
    expect(cc2ClueBlocks(note('intro\r\n[CLUE]\r\nfirst hint\r\n[CLUE]\r\nsecond\r\nhint\r\n'))).toEqual(['first hint', 'second\nhint']);
    expect(cc2ClueBlocks(note('comment\n[COM]\nnot a hint\n[CLUE]\none\n[JETLIFE]\n12\n[CLUE]\ntwo'))).toEqual(['one', 'two']);
    expect(cc2ClueBlocks(note('only a comment'))).toEqual([]);
    // Text on the tag line itself is dropped, before or after the tag.
    expect(cc2ClueBlocks(note('x\nbefore [CLUE] after\nbody'))).toEqual(['body']);
    expect(cc2ClueBlocks({ sections: [], trailing: new Uint8Array(0) })).toEqual([]);
    // An empty block still holds its place, so the next one goes to the next tile.
    expect(cc2ClueBlocks(note('[CLUE]\n[CLUE]\nsecond'))).toEqual(['', 'second']);
  });

  describe('hint tiles', () => {
    const HINT_CODE = 0x45;
    const hintMap = (tiles: Array<[number, number]>, width = 6, height = 4) =>
      makeMap(width, height, [player(0, 0), ...tiles.map(([x, y]) => put(x, y, { code: HINT_CODE }))]);
    const withBlocks = (blocks: string[], hint?: string) => ({ ...OPTIONS, hintBlocks: blocks, ...(hint ? { hint } : {}) });

    it('gives the n-th block to the n-th hint tile in reading order, not in placement order', () => {
      const { level } = convertCc2Map(hintMap([[4, 2], [1, 0], [3, 0]]), withBlocks(['first', 'second', 'third']));
      expect(level.cellHints).toEqual([
        { x: 1, y: 0, text: 'first' },
        { x: 3, y: 0, text: 'second' },
        { x: 4, y: 2, text: 'third' }
      ]);
      expect(level.customHint).toBeUndefined();
    });

    it('leaves the tiles beyond the blocks on the level hint (the CLUE section)', () => {
      const { level } = convertCc2Map(hintMap([[1, 0], [2, 0], [3, 0]]), withBlocks(['only one'], 'Section text'));
      expect(level.cellHints).toEqual([{ x: 1, y: 0, text: 'only one' }]);
      expect(level.customHint).toBe('Section text');
    });

    it('drops the blocks beyond the tiles', () => {
      const { level } = convertCc2Map(hintMap([[1, 0]]), withBlocks(['one', 'two', 'three']));
      expect(level.cellHints).toEqual([{ x: 1, y: 0, text: 'one' }]);
    });

    it('writes no cell hint when there are no blocks or no hint tile', () => {
      expect(convertCc2Map(hintMap([[1, 0]]), OPTIONS).level.cellHints).toBeUndefined();
      expect(convertCc2Map(hintMap([]), withBlocks(['lost'])).level.cellHints).toBeUndefined();
    });

    it('reads the blocks of a file, with the CLUE section as the level hint', () => {
      const text = (tag: string, body: string) => ({ kind: 'text' as const, tag, text: body, terminated: true, extra: new Uint8Array(0) });
      const file: Cc2File = {
        sections: [
          text('NOTE', 'by me\r\n[CLUE]\r\nLeft sign\r\n[CLUE]\r\nRight sign'),
          text('CLUE', 'Default sign'),
          { kind: 'map', tag: 'PACK', map: hintMap([[3, 1], [1, 1], [5, 3]]) }
        ],
        trailing: new Uint8Array(0)
      };
      const { level } = convertCc2File(file, { file: 'a.c2m', order: 1, sha256: '00'.repeat(32) });
      expect(level.customHint).toBe('Default sign');
      expect(level.cellHints).toEqual([
        { x: 1, y: 1, text: 'Left sign' },
        { x: 3, y: 1, text: 'Right sign' }
      ]);
    });
  });

  it('rejects a file with no map', () => {
    expect(() => convertCc2File({ sections: [], trailing: new Uint8Array(0) }, OPTIONS)).toThrow(/no decodable map/);
  });
});

describe('the cc2 record', () => {
  it('holds the source, the grid hash and the coverage', () => {
    const { level, coverage } = convert([put(1, 0, { code: PURPLE_WALL })]);
    expect(level.cc2).toEqual({
      v: 1,
      sha256: OPTIONS.sha256,
      file: 'one.c2m',
      order: 3,
      gridHash: cc2GridHash(level),
      coverage
    });
    expect(level.id).toBe('cc2_level_3');
    expect(level.ruleset).toBe('epoxy');
  });

  it('hashes the grid stably and notices a change', () => {
    const first = convert([put(1, 0, { code: WALL })]);
    const again = convert([put(1, 0, { code: WALL })]);
    const other = convert([put(2, 0, { code: WALL })]);
    expect(first.level.cc2?.gridHash).toBe(again.level.cc2?.gridHash);
    expect(first.level.cc2?.gridHash).not.toBe(other.level.cc2?.gridHash);
    expect(first.level.cc2?.gridHash).toMatch(/^[0-9a-f]{14}$/);
  });

  it('leaves titles and limits out of the grid hash', () => {
    const plain = convert([]);
    const titled = convert([], 6, 4, { ...OPTIONS, title: 'Name', timeLimit: 90, hint: 'Text' });
    expect(titled.level.cc2?.gridHash).toBe(plain.level.cc2?.gridHash);
  });

  it('hashes an edited grid differently', () => {
    const { level } = convert([put(1, 0, { code: WALL })]);
    const edited = { ...level, terrain: level.terrain.map((row, y) => (y === 0 ? [row[0], 'floor', ...row.slice(2)] : row)) };
    expect(cc2GridHash(edited)).not.toBe(level.cc2?.gridHash);
  });
});

describe('wires', () => {
  const wired = () =>
    convertCc2Map(
      makeMap(5, 3, [
        player(0, 2),
        put(0, 0, modTile(PINK, E)),
        put(1, 0, modTile(FLOOR_CODE, E | W)),
        put(2, 0, modTile(FLOOR_CODE, E | W)),
        put(3, 0, actorTile(BUG, DIR_E), modTile(CLONER, E)),
        put(1, 2, { code: RED_BUTTON })
      ]),
      OPTIONS
    );

  it('emits signal links and marks the level approximate', () => {
    const { level, coverage } = wired();
    expect(level.terrain[0][0]).toBe('signal_plate');
    expect(level.signalLinks).toEqual([{ fromX: 0, fromY: 0, toX: 3, toY: 0 }]);
    expect(coverage.verdict).toBe('exact');
    expect(coverage.approx).toEqual([]);
  });

  it('plays the held pink button as the pressure plate, not the pulse button', () => {
    const { level } = wired();
    expect(level.terrain[0][0]).not.toBe('signal_button');
  });

  it('marks tunnels', () => {
    const map = makeMap(6, 1, [
      player(5, 0),
      put(0, 0, modTile(PINK, E)),
      put(1, 0, modTile(FLOOR_CODE, E | W | 0x20)),
      put(4, 0, modTile(FLOOR_CODE, E | W | 0x80))
    ]);
    const tunnels = convertCc2Map(map, OPTIONS);
    expect(tunnels.coverage.approx).toEqual([]);
    expect(tunnels.report.exact).toEqual(expect.arrayContaining(['wire', 'wire_tunnel']));
  });

  it('maps gates to Epoxy gates and the placeholder for an unknown one', () => {
    const cells = [
      put(0, 0, modTile(GATE, 0x01)),
      put(1, 0, modTile(GATE, 0x05)),
      put(2, 0, modTile(GATE, 0x09)),
      put(3, 0, modTile(GATE, 0x0d)),
      put(4, 0, modTile(GATE, 0x11)),
      put(5, 0, modTile(GATE, 0x15)),
      put(6, 0, modTile(GATE, 0x1e)),
      put(7, 0, modTile(GATE, 0x44))
    ];
    const { level, coverage, report } = convertCc2Map(makeMap(8, 2, [player(0, 1), ...cells]), OPTIONS);
    expect(level.terrain[0]).toEqual([
      'signal_gate_not_cc2',
      'signal_gate_and_cc2',
      'signal_gate_or_cc2',
      'signal_gate_xor_cc2',
      'signal_gate_dlatch_cc2',
      'signal_gate_nand_cc2',
      'signal_counter_0_cc2',
      'cc2_unknown'
    ]);
    expect(coverage.lost).toEqual(['unknown']);
    expect(report.warnings.some((w) => w.includes('latch'))).toBe(false);
    expect(coverage.approx).toContain('counter_gate');
    expect(coverage.approx).not.toContain('data_latch');
  });

  it('plays each latch rotation and the diode as an Epoxy gate', () => {
    const cells = [put(0, 0, modTile(GATE, 0x10)), put(1, 0, modTile(GATE, 0x40)), put(2, 0, modTile(GATE, 0x43)), put(3, 0, modTile(GATE, 0x18))];
    const { level, coverage } = convertCc2Map(makeMap(4, 2, [player(0, 1), ...cells]), OPTIONS);
    expect(level.terrain[0]).toEqual(['signal_gate_dlatch_cc2', 'signal_gate_dlatch_cc2', 'signal_gate_dlatch_cc2', 'signal_gate_or_cc2']);
    expect(coverage.approx).not.toContain('data_latch');
    expect(coverage.lost).toEqual([]);
  });

  it('reports unsupported wire ends as warnings', () => {
    // A blue teleporter the wires reach cannot be played as a link end (only the red pad follows its wire).
    const map = makeMap(4, 1, [
      player(3, 0),
      put(0, 0, modTile(PINK, E)),
      put(1, 0, modTile(FLOOR_CODE, E | W)),
      put(2, 0, modTile(0x11, W))
    ]);
    const { report } = convertCc2Map(map, OPTIONS);
    expect(report.warnings.some((w) => w.includes('teleport') && w.includes('not played'))).toBe(true);
  });

  it('counts a wired teleport as the wired blue teleport', () => {
    const { coverage } = convert([put(1, 0, modTile(0x11, E)), put(2, 0, { code: 0x11 })]);
    expect(coverage.approx).toContain('teleport_blue_wired');
    expect(coverage.approx).toContain('wired_teleport');
    expect(coverage.approx).not.toContain('wire');
  });
});

describe('the validator', () => {
  it('accepts a small exact level and refuses a placeholder', () => {
    const exact = convertCc2Map(
      makeMap(5, 3, [player(0, 1, DIR_E), put(1, 1, { code: CHIP }, { code: FLOOR_CODE }), put(3, 0, { code: WALL }), put(3, 1, { code: 0x2c }), put(3, 2, { code: WALL }), put(4, 1, { code: 0x14 })]),
      OPTIONS
    );
    const clean = LevelValidator.validate(exact.level);
    expect(clean.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
    const lost = convertCc2Map(makeMap(5, 3, [player(0, 1, DIR_E), put(2, 1, { code: 0xfa }), put(4, 1, { code: 0x14 })]), OPTIONS);
    expect(LevelValidator.validate(lost.level).issues.some((issue) => issue.i18nKey === 'validator.issues.cc2_unsupported.label')).toBe(true);
  });
});

describe('coverage truth', () => {
  const ICE_BLOCK = 0x1a;
  const DIRT_BLOCK = 0x17;
  const ROVER = 0x69;
  const POPUP_WALL = 0x2d;
  const OPEN_TRAP = 0x41;
  const TRANSMOGRIFIER = 0x4e;
  const TRACK = 0x4f;
  const TRACK_SWITCH_NORTH_EAST = 0x41;

  it('plays a pop-up wall as the CC2 pop-up wall, exact whatever else the level holds', () => {
    const { level, coverage, report } = convert([put(1, 0, { code: POPUP_WALL }), put(2, 0, actorTile(DIRT_BLOCK), { code: FLOOR_CODE })]);
    expect(level.terrain[0][1]).toBe('popup_wall_cc2');
    expect(coverage).toEqual({ verdict: 'exact', lost: [], approx: [] });
    expect(report.exact).toContain('popup_wall');
  });

  it('keeps a pop-up wall exact when the level holds an ice block, an arrow block or a rover (they enter it in Epoxy too)', () => {
    const withIce = convert([put(1, 0, { code: POPUP_WALL }), put(2, 0, actorTile(ICE_BLOCK), { code: FLOOR_CODE })]);
    expect(withIce.coverage).toEqual({ verdict: 'exact', lost: [], approx: [] });
    expect(withIce.report.exact).toContain('popup_wall');
    const withArrow = convert([put(1, 0, { code: POPUP_WALL }), put(2, 0, { code: DIRECTIONAL_BLOCK, dir: DIR_S, arrows: N | S }, { code: FLOOR_CODE })]);
    expect(withArrow.coverage.approx).not.toContain('popup_wall_blocks');
    const withRover = convert([put(1, 0, { code: POPUP_WALL }), put(2, 0, actorTile(ROVER), { code: FLOOR_CODE })]);
    expect(withRover.coverage.approx).not.toContain('popup_wall_blocks');
    expect(withRover.level.terrain[0][1]).toBe('popup_wall_cc2');
  });

  it('keeps the retired popup_wall_blocks key classified for levels stored by an earlier import', () => {
    expect(CC2_COVERAGE.popup_wall_blocks.level).toBe('approx');
    expect(CC2_COVERAGE.popup_wall.level).toBe('exact');
    const { coverage } = convert([put(1, 0, { code: POPUP_WALL }), put(2, 0, actorTile(ICE_BLOCK), { code: CLONER })]);
    expect(coverage.approx).not.toContain('popup_wall_blocks');
  });

  it('plays the open trap (0x41) as trap_open, exact, and the plain trap as the closed trap', () => {
    const { level, coverage, report } = convert([put(1, 0, { code: OPEN_TRAP }), put(2, 0, { code: TRAP })]);
    expect(level.terrain[0].slice(1, 3)).toEqual(['trap_open', 'trap']);
    expect(coverage).toEqual({ verdict: 'exact', lost: [], approx: [] });
    expect(report.exact).toContain('trap_open');
    const plain = convert([put(1, 0, { code: TRAP })]);
    expect(plain.coverage).toEqual({ verdict: 'exact', lost: [], approx: [] });
  });

  it('links a brown button to an open trap like to any trap', () => {
    const { level } = convert([put(1, 0, { code: BROWN_BUTTON }), put(3, 0, { code: OPEN_TRAP }), put(4, 0, { code: 0x14 })]);
    expect(level.trapLinks).toEqual([{ buttonX: 1, buttonY: 0, trapX: 3, trapY: 0 }]);
    expect(LevelValidator.validate(level).issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  });

  it('keeps a wired open trap as trap_open (the wire is a link to it) and a wired plain trap as trap_wired', () => {
    const wiredTrap = (code: number) =>
      convertCc2Map(makeMap(4, 3, [player(0, 2), put(1, 0, modTile(PINK, 0x4)), put(1, 1, modTile(FLOOR_CODE, 0x1 | 0x2 | 0x8)), put(0, 1, { code })]), OPTIONS);
    const open = wiredTrap(OPEN_TRAP);
    expect(open.level.terrain[1][0]).toBe('trap_open');
    expect(open.level.signalLinks).toEqual([{ fromX: 1, fromY: 0, toX: 0, toY: 1 }]);
    expect(open.coverage.approx).toEqual([]);
    expect(open.report.exact).toContain('trap_open');
    const plain = wiredTrap(TRAP);
    expect(plain.level.terrain[1][0]).toBe('trap_wired');
    expect(plain.coverage.approx).toEqual([]);
    expect(plain.report.exact).toContain('wired_trap');
  });

  const wiredPad = (code: number, source: number = PINK, extra?: { code: number }) =>
    convert([put(0, 0, modTile(source, E)), put(1, 0, modTile(FLOOR_CODE, E | W)), put(2, 0, modTile(code, W)), ...(extra ? [put(3, 0, extra)] : [])]);

  it('plays a wired transmogrifier as its switched-off form, linked to the wire that reaches it', () => {
    const { level, coverage, report } = wiredPad(TRANSMOGRIFIER);
    expect(level.terrain[0][2]).toBe('transmogrifier_cc2_off');
    expect(level.signalLinks).toEqual([{ fromX: 0, fromY: 0, toX: 2, toY: 0 }]);
    expect(coverage.approx).toEqual(['transmogrifier']);
    expect(report.warnings.some((w) => w.includes('not played'))).toBe(false);
  });

  it('plays an unwired transmogrifier as the always-on one', () => {
    const { level } = convert([put(2, 0, { code: TRANSMOGRIFIER })]);
    expect(level.terrain[0][2]).toBe('transmogrifier_cc2');
    expect(level.signalLinks).toBeUndefined();
  });

  it('keeps wired_transmogrifier for a wire nibble no net reaches (the device stays always on)', () => {
    const { level, coverage } = convert([put(2, 0, modTile(TRANSMOGRIFIER, W))]);
    expect(level.terrain[0][2]).toBe('transmogrifier_cc2');
    expect(coverage.approx).toContain('wired_transmogrifier');
  });

  it('plays a wired red teleport as its switched-off form, linked to the wire that reaches it', () => {
    const { level, coverage, report } = wiredPad(0x10);
    expect(level.terrain[0][2]).toBe('teleport_red_cc2_off');
    expect(level.signalLinks).toEqual([{ fromX: 0, fromY: 0, toX: 2, toY: 0 }]);
    expect(coverage.approx).toEqual(['teleport_red']);
    expect(report.warnings.some((w) => w.includes('not played'))).toBe(false);
  });

  it('keeps wired_teleport for a red wire nibble no net reaches', () => {
    const { level, coverage } = convert([put(1, 0, modTile(0x10, E)), put(2, 0, { code: 0x10 })]);
    expect(level.terrain[0].slice(1, 3)).toEqual(['teleport_red_cc2', 'teleport_red_cc2']);
    expect(coverage.approx).toContain('wired_teleport');
  });

  it('still reports a wire that reaches a blue, yellow or green teleport as wired_teleport', () => {
    for (const code of [0x11, 0x12, 0x13]) {
      const { level, coverage } = wiredPad(code);
      expect(level.signalLinks, `0x${code.toString(16)}`).toBeUndefined();
      expect(coverage.approx, `0x${code.toString(16)}`).toContain('wired_teleport');
    }
  });

  it('starts a wired pad in the form its source asks for once the engine has loaded the level', () => {
    // A toggle switch feeds the pad; the converter places the off form and the load settle swaps it when the switch is on.
    const SWITCH_ON = 0x89;
    const SWITCH_OFF = 0x88;
    const loaded = (source: number, code: number): string => {
      const engine = new GameEngine();
      engine.loadLevel(wiredPad(code, source).level);
      return engine.getTerrain()[0][2];
    };
    expect(loaded(SWITCH_ON, 0x10)).toBe('teleport_red_cc2');
    expect(loaded(SWITCH_OFF, 0x10)).toBe('teleport_red_cc2_off');
    expect(loaded(SWITCH_ON, TRANSMOGRIFIER)).toBe('transmogrifier_cc2');
    expect(loaded(SWITCH_OFF, TRANSMOGRIFIER)).toBe('transmogrifier_cc2_off');
  });

  it('validates a converted level with a wired pad without an error or an unwired-twin warning', () => {
    const issues = LevelValidator.validate(wiredPad(0x10, PINK, { code: 0x14 }).level).issues;
    expect(issues.filter((issue) => issue.severity === 'error')).toEqual([]);
    expect(issues.some((issue) => issue.i18nKey.includes('unwired_off_twin'))).toBe(false);
  });

  it('reports a wire that reaches a track switch as exact wired_track, and a free switch as plain track', () => {
    const wired = convert([put(0, 0, modTile(PINK, E)), put(1, 0, modTile(FLOOR_CODE, E | W)), put(2, 0, modTile(TRACK, TRACK_SWITCH_NORTH_EAST))]);
    expect(wired.coverage.approx).not.toContain('wired_track');
    expect(wired.report.exact).toContain('wired_track');
    const free = convert([put(2, 0, modTile(TRACK, TRACK_SWITCH_NORTH_EAST))]);
    expect(free.coverage.approx).not.toContain('wired_track');
    expect(free.report.exact).not.toContain('wired_track');
  });
});
