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
import { cc2GridHash, cc2HintText, convertCc2File, convertCc2Map } from './cc2ToEpoxy';
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
    expect(level.terrain[0][2]).toBe('teleport_red');
    expect(level.items[0][3]).toBe('hurl_stone');
    expect(coverage.verdict).toBe('approx');
    expect(coverage.approx).toEqual(['bowling_ball', 'force_floor_random', 'teleport_red']);
  });

  it('keeps reserved ids for what Epoxy lacks', () => {
    const { level, coverage, report } = convert([
      put(1, 0, { code: 0x8c }, { code: FLOOR_CODE }),
      put(2, 0, { code: 0x62 }, { code: FLOOR_CODE }),
      put(3, 0, actorTile(0x65, DIR_W), { code: FLOOR_CODE })
    ]);
    expect(level.items[0][1]).toBe('cc2_steel_foil');
    expect(level.items[0][2]).toBe('cc2_lightning_bolt');
    expect(level.entities).toEqual([{ x: 3, y: 0, type: 'cc2_mirror_chip', dir: 'W' }]);
    expect(coverage.verdict).toBe('lost');
    expect(coverage.lost).toEqual(['lightning_bolt', 'mirror_chip', 'steel_foil']);
    expect(report.lost.map((entry) => entry.key)).toEqual(coverage.lost);
    expect(report.lost.every((entry) => entry.reason.length > 0)).toBe(true);
  });

  it('keeps cc2_unknown for cells past an undecodable code', () => {
    const map = makeMap(3, 2, [player(0, 0)]);
    map.cells.length = 4;
    const { level, coverage } = convertCc2Map(map, OPTIONS);
    expect(level.terrain[1][1]).toBe('cc2_unknown');
    expect(level.terrain[1][2]).toBe('cc2_unknown');
    expect(coverage.lost).toEqual(['unknown']);
  });

  it('drops an item that has no placeholder and loses its key', () => {
    const { level, coverage } = convert([put(1, 0, { code: 0x8f }, { code: FLOOR_CODE })]);
    expect(level.items[0][1]).toBeNull();
    expect(coverage.lost).toEqual(['bribe']);
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

  it('keeps the cell and loses the key when a no-sign sits on a wall', () => {
    const { level, coverage } = convert([put(1, 0, { code: 0x7f }, { code: 0x26 }, { code: WALL })]);
    expect(level.terrain[0][1]).toBe('wall');
    expect(coverage.lost).toEqual(['no_sign']);
  });

  it('loses a no-sign over an item that has no forbid tile', () => {
    const { level, coverage } = convert([put(1, 0, { code: 0x7f }, { code: 0x2a }, { code: FLOOR_CODE })]);
    expect(level.terrain[0][1]).toBe('floor');
    expect(coverage.lost).toEqual(['no_sign']);
  });

  it('turns a no-sign over a key into a forbid tile with no item', () => {
    const { level, coverage } = convert([put(1, 0, { code: 0x7f }, { code: 0x27 }, { code: FLOOR_CODE })]);
    expect(level.terrain[0][1]).toBe('forbid_key_blue');
    expect(level.items[0][1]).toBeNull();
    expect(coverage.lost).toEqual([]);
    expect(coverage.approx).toEqual(['no_sign_key']);
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
    expect(coverage.approx).toEqual(['no_sign_boots']);
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

  it('reads a track with one segment as a rail and several as a junction', () => {
    const { level, coverage } = convert([put(1, 0, modTile(0x4f, 0x10)), put(2, 0, modTile(0x4f, 0x11))]);
    expect(level.terrain[0][1]).toBe('rail_ew');
    expect(level.terrain[0][2]).toBe('cc2_track_junction');
    expect(coverage.lost).toContain('track_junction');
    expect(coverage.approx).toContain('track');
  });

  it('approximates a steel wall only next to dynamite', () => {
    expect(convert([put(1, 0, { code: STEEL_WALL })]).coverage.verdict).toBe('exact');
    const withDynamite = convert([put(1, 0, { code: STEEL_WALL }), put(2, 0, { code: DYNAMITE }, { code: FLOOR_CODE })]);
    expect(withDynamite.coverage.lost).toEqual([]);
    expect(withDynamite.coverage.approx).toEqual(['dynamite', 'steel_wall_with_destroyer']);
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

  it('drops the canopy flag, loses it in coverage and keeps the real edges', () => {
    const { level, coverage } = convert([put(1, 0, { code: THIN_WALL, flags: W | CANOPY }, { code: FLOOR_CODE })]);
    expect(level.cellEdges).toEqual([{ x: 1, y: 0, sides: ['W'] }]);
    expect(coverage.lost).toEqual(['canopy']);
  });

  it('records a canopy alone without an edge', () => {
    const { level, coverage } = convert([put(1, 0, { code: THIN_WALL, flags: CANOPY }, { code: FLOOR_CODE })]);
    expect(level.cellEdges).toBeUndefined();
    expect(coverage.lost).toEqual(['canopy']);
  });
});

describe('players', () => {
  it('starts on the first player with its facing', () => {
    const { level } = convertCc2Map(makeMap(5, 3, [player(3, 1, DIR_W)]), OPTIONS);
    expect(level.playerStart).toEqual({ x: 3, y: 1, dir: 'W' });
    expect(level.entities).toEqual([]);
  });

  it('keeps extra players as reserved entities and loses the level', () => {
    const { level, coverage } = convertCc2Map(
      makeMap(5, 3, [player(1, 0, DIR_S), player(2, 2, DIR_E, MELINDA), player(4, 2, DIR_N, MIRROR_CHIP)]),
      OPTIONS
    );
    expect(level.playerStart).toEqual({ x: 1, y: 0, dir: 'S' });
    expect(level.entities).toEqual([
      { x: 2, y: 2, type: 'cc2_melinda', dir: 'E' },
      { x: 4, y: 2, type: 'cc2_mirror_chip', dir: 'N' }
    ]);
    expect(coverage.lost).toEqual(['melinda', 'mirror_chip', 'multiple_players']);
  });

  it('plays a level whose only player is Melinda with her character, exactly', () => {
    const { level, coverage } = convertCc2Map(makeMap(3, 3, [player(1, 1, DIR_N, MELINDA)]), OPTIONS);
    expect(level.playerStart).toEqual({ x: 1, y: 1, dir: 'N' });
    expect(level.character).toBe('melinda');
    expect(coverage).toEqual({ verdict: 'exact', lost: [], approx: [] });
  });

  it('leaves Chip as the default character, and loses two players or a mirror player', () => {
    expect(convertCc2Map(makeMap(3, 3, [player(1, 1, DIR_N)]), OPTIONS).level.character).toBeUndefined();
    const pair = convertCc2Map(makeMap(5, 3, [player(1, 1, DIR_N), player(3, 1, DIR_N, MELINDA)]), OPTIONS);
    expect(pair.level.character).toBeUndefined();
    expect(pair.coverage.lost).toEqual(['melinda', 'multiple_players']);
    const mirror = convertCc2Map(makeMap(5, 3, [player(1, 1, DIR_N, MELINDA), player(3, 1, DIR_N, MIRROR_CHIP)]), OPTIONS);
    expect(mirror.coverage.lost).toEqual(['mirror_chip']);
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

  it('plays four arrows as a dirt block, with a warning and an approximate key', () => {
    expect(block(N | E | S | W).type).toBe('dirt_block');
    const { coverage, report } = convert([put(1, 0, { code: DIRECTIONAL_BLOCK, dir: DIR_S, arrows: N | E | S | W }, { code: FLOOR_CODE })]);
    expect(coverage).toEqual({ verdict: 'approx', lost: [], approx: ['arrow_block_cross'] });
    expect(report.warnings.some((w) => w.includes('four arrows'))).toBe(true);
  });

  it('loses a block with no arrow, which cannot be pushed in CC2', () => {
    const { level, coverage } = convert([put(1, 0, { code: DIRECTIONAL_BLOCK, dir: DIR_S, arrows: 0 }, { code: FLOOR_CODE })]);
    expect(level.entities[0].type).toBe('dirt_block');
    expect(coverage.lost).toEqual(['arrow_block_locked']);
  });

  it('gives the green walls their own approximate keys', () => {
    const { level, coverage } = convert([put(1, 0, { code: 0x7d }), put(2, 0, { code: 0x7e })]);
    expect(level.terrain[0].slice(1, 3)).toEqual(['wall', 'blue_wall_fake']);
    expect(coverage.approx).toEqual(['green_wall', 'green_wall_fake']);
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
    const { level, coverage } = convertCc2Map(map, OPTIONS);
    expect(level.terrain[1][0]).toBe('trap_wired');
    expect(level.terrain[1][2]).toBe('flame_jet_wired_off');
    expect(level.signalLinks).toEqual([
      { fromX: 1, fromY: 0, toX: 0, toY: 1 },
      { fromX: 1, fromY: 0, toX: 2, toY: 1 }
    ]);
    expect(coverage.lost).toEqual([]);
    expect(coverage.approx).toEqual(['wire', 'wired_flame_jet', 'wired_trap']);
  });

  it('keeps an unwired trap and flame jet plain, and a lit wired jet as the wired on form', () => {
    const plain = convert([put(1, 0, { code: TRAP }), put(2, 0, { code: 0x60 })]);
    expect(plain.level.terrain[0][1]).toBe('trap');
    expect(plain.level.terrain[0][2]).toBe('flame_jet_on');
    expect(plain.coverage.approx).toEqual(['flame_jet']);
    const map = makeMap(4, 3, [
      player(0, 2),
      put(1, 0, modTile(PINK, 0x4)),
      put(1, 1, modTile(FLOOR_CODE, 0x1 | 0x2)),
      put(2, 1, { code: 0x60 })
    ]);
    expect(convertCc2Map(map, OPTIONS).level.terrain[1][2]).toBe('flame_jet_wired_on');
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

  it('reads hints from CLUE blocks of the note when there is no CLUE section', () => {
    const note = (text: string): Cc2File => ({
      sections: [{ kind: 'text', tag: 'NOTE', text, terminated: true, extra: new Uint8Array(0) }],
      trailing: new Uint8Array(0)
    });
    expect(cc2HintText(note('intro\r\n[CLUE]\r\nfirst hint\r\n[CLUE]\r\nsecond hint'))).toBe('first hint\n\nsecond hint');
    expect(cc2HintText(note('no hint here'))).toBeUndefined();
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
    expect(coverage.verdict).toBe('approx');
    expect(coverage.approx).toEqual(['wire']);
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
    expect(convertCc2Map(map, OPTIONS).coverage.approx).toEqual(['wire', 'wire_tunnel']);
  });

  it('maps gates to Epoxy gates and the reserved ids for the others', () => {
    const cells = [
      put(0, 0, modTile(GATE, 0x01)),
      put(1, 0, modTile(GATE, 0x05)),
      put(2, 0, modTile(GATE, 0x09)),
      put(3, 0, modTile(GATE, 0x0d)),
      put(4, 0, modTile(GATE, 0x11)),
      put(5, 0, modTile(GATE, 0x15)),
      put(6, 0, modTile(GATE, 0x1e)),
      put(7, 0, modTile(GATE, 0x42))
    ];
    const { level, coverage, report } = convertCc2Map(makeMap(8, 2, [player(0, 1), ...cells]), OPTIONS);
    expect(level.terrain[0]).toEqual([
      'signal_gate_not',
      'signal_gate_and',
      'signal_gate_or',
      'signal_gate_xor',
      'signal_latch_off',
      'cc2_nand_gate',
      'cc2_counter_gate',
      'cc2_unknown'
    ]);
    expect(coverage.lost).toEqual(['counter_gate', 'nand_gate', 'unknown']);
    expect(report.warnings.some((w) => w.includes('latch'))).toBe(true);
  });

  it('reports unsupported wire ends as warnings', () => {
    const map = makeMap(3, 1, [
      player(2, 0),
      put(0, 0, modTile(0x5c, 0x15)),
      put(1, 0, modTile(FLOOR_CODE, E | W)),
      put(2, 0, modTile(CLONER, E))
    ]);
    const { level, report } = convertCc2Map(map, OPTIONS);
    expect(level.signalLinks).toBeUndefined();
    expect(report.warnings.some((w) => w.includes('gate of kind nand'))).toBe(true);
  });

  it('counts a wired teleport as the wired blue teleport', () => {
    const { coverage } = convert([put(1, 0, modTile(0x11, E)), put(2, 0, { code: 0x11 })]);
    expect(coverage.approx).toContain('teleport_blue_wired');
    expect(coverage.approx).toContain('wire');
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
    const lost = convertCc2Map(
      makeMap(5, 3, [player(0, 1, DIR_E), put(2, 1, { code: 0x8c }, { code: FLOOR_CODE }), put(4, 1, { code: 0x14 })]),
      OPTIONS
    );
    expect(LevelValidator.validate(lost.level).issues.some((issue) => issue.i18nKey === 'validator.issues.cc2_unsupported.label')).toBe(true);
  });
});
