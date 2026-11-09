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

import { describe, expect, it } from 'vitest';
import { PACK_JSON_VERSION_V12_IDS } from '../../config/constants';
import {
  CC2_COVERAGE,
  CC2_COVERAGE_KEYS,
  CC2_KEY_GROUPS,
  KEY_CANOPY,
  KEY_UNKNOWN,
  KEY_MULTIPLE_PLAYERS,
  KEY_STEEL_WALL_DESTROYER,
  KEY_WIRE,
  cc2KeyOfReservedId,
  classifyCc2Level,
  worstVerdict
} from './cc2Coverage';

/** Reserved ids that a mapping plays as an Epoxy element instead of losing. */
const MAPPED_RESERVED = [
  'helmet', 'steel_wall', 'extra_chip', 'purple_wall', 'purple_floor', 'toggle_switch', 'black_button', 'button_gray',
  'green_chip', 'green_bomb', 'hiking_boots', 'gender_sign_male', 'gender_sign_female', 'steel_foil', 'toggle_clock',
  'ghost', 'rover', 'floor_mimic', 'timid_teeth', 'nand_gate', 'counter_gate', 'lightning_bolt', 'track_junction', 'railroad_sign', 'mirror_chip', 'mirror_melinda'
];

describe('cc2 coverage table', () => {
  it('plays the extra chip as an exact chip', () => {
    expect(CC2_COVERAGE.extra_chip.level).toBe('exact');
  });

  it('has an entry for every reserved id', () => {
    for (const id of PACK_JSON_VERSION_V12_IDS) {
      const key = cc2KeyOfReservedId(id);
      expect(CC2_COVERAGE[key], id).toBeDefined();
      if (!MAPPED_RESERVED.includes(key)) expect(CC2_COVERAGE[key].level, id).toBe('lost');
    }
  });

  it('gives every entry a level and a reason', () => {
    for (const [key, found] of Object.entries(CC2_COVERAGE)) {
      expect(['exact', 'approx', 'lost'], key).toContain(found.level);
      expect(found.reason.length, key).toBeGreaterThan(0);
    }
  });

  it('holds the three levels', () => {
    const levels = new Set(Object.values(CC2_COVERAGE).map((found) => found.level));
    expect([...levels].sort()).toEqual(['approx', 'exact', 'lost']);
  });
});

describe('classifyCc2Level', () => {
  it('is exact when every element is exact', () => {
    expect(classifyCc2Level(['floor', 'wall', 'chip', 'exit'])).toEqual({ verdict: 'exact', lost: [], approx: [] });
    expect(classifyCc2Level([])).toEqual({ verdict: 'exact', lost: [], approx: [] });
  });

  it('is approximate when the worst element is approximate', () => {
    expect(classifyCc2Level(['floor', 'teleport_red', 'slime', 'bug', 'bug'])).toEqual({
      verdict: 'approx',
      lost: [],
      approx: ['slime', 'teleport_red']
    });
  });

  it('is lost when any element is lost, whatever else the level holds', () => {
    const coverage = classifyCc2Level(['floor', 'bug', 'time_bomb', KEY_MULTIPLE_PLAYERS, 'chip']);
    expect(coverage.verdict).toBe('lost');
    expect(coverage.lost).toEqual(['time_bomb']);
    expect(coverage.approx).toEqual([KEY_MULTIPLE_PLAYERS]);
  });

  it('reads the structural keys', () => {
    expect(classifyCc2Level([KEY_WIRE]).verdict).toBe('exact');
    expect(classifyCc2Level(['steel_wall']).verdict).toBe('exact');
    expect(classifyCc2Level(['steel_wall', KEY_STEEL_WALL_DESTROYER]).verdict).toBe('approx');
    expect(classifyCc2Level(['green_chip', 'green_bomb', 'button_green', 'melinda_player']).verdict).toBe('exact');
    expect(classifyCc2Level(['melinda']).verdict).toBe('lost');
  });

  it('counts a key the table does not know as the unknown placeholder, which is lost', () => {
    expect(classifyCc2Level(['floor', 'no_such_element'])).toEqual({ verdict: 'lost', lost: [KEY_UNKNOWN], approx: [] });
  });

  it('classifies the items the converter maps beyond the first table', () => {
    expect(classifyCc2Level(['time_penalty']).verdict).toBe('exact');
    expect(classifyCc2Level(['speed_boots', 'hook']).approx).toEqual(['hook']);
  });

  it('plays monsters, blocks and the canopy flag as exact', () => {
    expect(classifyCc2Level(['bug', 'tank', 'dirt_block', 'cleats']).verdict).toBe('exact');
    expect(classifyCc2Level([KEY_CANOPY]).verdict).toBe('exact');
  });
});

describe('key list', () => {
  const EXPECTED_KEYS = [
    'flame_jet', 'track', 'turtle', 'yellow_tank', 'button_yellow', 'bribe', 'popup_wall', 'no_sign', 'secret_eye',
    'purple_floor', 'purple_wall', 'cleats', 'suction_boots', 'fire_boots', 'flippers', 'teleport_green', KEY_CANOPY
  ];

  it('has an entry for every listed key and the listed groups hold each key once', () => {
    for (const key of EXPECTED_KEYS) expect(CC2_COVERAGE[key], key).toBeDefined();
    for (const key of CC2_COVERAGE_KEYS) expect(CC2_COVERAGE[key], key).toBeDefined();
    const grouped = Object.values(CC2_KEY_GROUPS).flat();
    expect(new Set(grouped).size).toBe(grouped.length);
    // Reserved ids add their own lost keys on top of the grouped ones.
    expect(CC2_COVERAGE_KEYS.length).toBeGreaterThanOrEqual(grouped.length);
  });

  it('does not reserve an id for the canopy flag', () => {
    expect(PACK_JSON_VERSION_V12_IDS.has('cc2_canopy')).toBe(false);
    expect(PACK_JSON_VERSION_V12_IDS.has('cc2_purple_floor')).toBe(true);
  });
});

describe('wired devices', () => {
  it('plays the purple tiles, the toggle switch and the black button as exact elements', () => {
    expect(classifyCc2Level(['purple_wall', 'purple_floor', 'toggle_switch', 'black_button'])).toEqual({
      verdict: 'exact',
      lost: [],
      approx: []
    });
  });

  it('plays the gray button area and the wired flame jet as approximate, the wired trap as exact', () => {
    expect(classifyCc2Level(['button_gray', 'wired_trap', 'wired_flame_jet'])).toEqual({
      verdict: 'approx',
      lost: [],
      approx: ['button_gray', 'wired_flame_jet']
    });
  });
});

describe('coverage truth policy', () => {
  const EXACT_NOW = [
    'wire', 'wire_tunnel', 'secret_eye', 'speed_boots', 'steel_foil', 'no_sign_key', 'no_sign_boots', 'no_sign_item',
    'wired_trap', 'wired_track', 'green_wall', 'canopy', 'popup_wall', 'trap_open', 'arrow_block_cross'
  ];
  const APPROX_NOW = [
    'popup_wall_blocks', 'wired_teleport', 'wired_transmogrifier', 'wired_track_unlinked', 'wired_flame_jet',
    'hook', 'multiple_players', 'force_floor_random', 'yellow_tank', 'lightning_bolt', 'counter_gate'
  ];

  it('explains the state and result differences of the counter gate and the lightning bolt', () => {
    expect(CC2_COVERAGE.counter_gate.reason).toMatch(/final count|pulse/);
    expect(CC2_COVERAGE.lightning_bolt.reason).toMatch(/stands still/);
  });

  it('plays each reclassified key as exact', () => {
    for (const key of EXACT_NOW) expect(CC2_COVERAGE[key]?.level, key).toBe('exact');
  });

  it('keeps each known mechanism deviation approximate, with a reason', () => {
    for (const key of APPROX_NOW) {
      expect(CC2_COVERAGE[key]?.level, key).toBe('approx');
      expect(CC2_COVERAGE[key].reason.length, key).toBeGreaterThan(0);
    }
  });
});

describe('worstVerdict', () => {
  it('ranks lost above approximate above exact', () => {
    expect(worstVerdict('exact', 'approx')).toBe('approx');
    expect(worstVerdict('lost', 'approx')).toBe('lost');
    expect(worstVerdict('exact', 'exact')).toBe('exact');
    expect(worstVerdict('lost', 'exact')).toBe('lost');
  });
});
