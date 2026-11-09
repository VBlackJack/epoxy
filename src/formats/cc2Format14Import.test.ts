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

import { CC2_COVERAGE } from '../core/cc2/cc2Coverage';
import { convertCc2Map } from './cc2ToEpoxy';
import type { Cc2ConvertOptions } from './cc2ToEpoxy';
import { actorTile, FLOOR_CODE, makeMap, modTile, player, put } from './cc2TestMaps';

/**
 * Pack format 14 import: the CC2 codes that now map to the format 14 ids, the orange button links and the coverage
 * verdicts. Converter output and coverage only; the engine rules of the new ids are tested with them.
 */

const OPTIONS: Cc2ConvertOptions = { file: 'f14.c2m', order: 1, sha256: 'cd'.repeat(32) };
const SLIME = 0x15;
const TURTLE = 0x8d;
const FLAME_JET_OFF = 0x5f;
const FLAME_JET_ON = 0x60;
const ORANGE_BUTTON = 0x61;
const POPDOWN_FLOOR = 0x7e;
const TRANSMOGRIFIER = 0x4e;
const TELEPORT_RED = 0x10;
const TELEPORT_GREEN = 0x13;
const HELMET = 0x52;
const NO_SIGN = 0x7f;
const DIRECTIONAL_BLOCK = 0x81;
const ALL_ARROWS = 0xf;

function convert(placements: ReturnType<typeof put>[], width = 6, height = 4) {
  return convertCc2Map(makeMap(width, height, [player(0, 0), ...placements]), OPTIONS);
}

describe('format 14 id mapping', () => {
  it('maps slime, turtle and the transmogrifier to their CC2 ids', () => {
    const { level } = convert([put(1, 0, { code: SLIME }), put(2, 0, { code: TURTLE }), put(3, 0, { code: TRANSMOGRIFIER })]);
    expect(level.terrain[0].slice(1, 4)).toEqual(['slime_cc2', 'turtle_cc2', 'transmogrifier_cc2']);
  });

  it('maps the flame jets to the CC2 jets, wired or not', () => {
    const plain = convert([put(1, 0, { code: FLAME_JET_OFF }), put(2, 0, { code: FLAME_JET_ON })]);
    expect(plain.level.terrain[0].slice(1, 3)).toEqual(['flame_jet_cc2_off', 'flame_jet_cc2_on']);
    expect(plain.level.signalLinks).toBeUndefined();
    const wired = convertCc2Map(
      makeMap(4, 3, [
        player(0, 2),
        put(1, 0, modTile(0x5e, 0x4)),
        put(1, 1, modTile(FLOOR_CODE, 0x1 | 0x2)),
        put(2, 1, { code: FLAME_JET_ON })
      ]),
      OPTIONS
    );
    expect(wired.level.terrain[1][2]).toBe('flame_jet_cc2_on');
    expect(wired.level.signalLinks).toEqual([{ fromX: 1, fromY: 0, toX: 2, toY: 1 }]);
  });

  it('maps the popdown floor to the block barrier floor and the solid popdown wall to a wall', () => {
    const { level } = convert([put(1, 0, { code: 0x7d }), put(2, 0, { code: POPDOWN_FLOOR })]);
    expect(level.terrain[0].slice(1, 3)).toEqual(['wall', 'block_barrier_floor']);
  });

  it('maps the red and green teleports to their CC2 pads and leaves blue and yellow alone', () => {
    const { level } = convert([
      put(1, 0, { code: TELEPORT_RED }),
      put(2, 0, { code: TELEPORT_GREEN }),
      put(3, 0, { code: 0x11 }),
      put(4, 0, { code: 0x12 })
    ]);
    expect(level.terrain[0].slice(1, 5)).toEqual(['teleport_red_cc2', 'teleport_random', 'teleport_blue', 'teleport_forward']);
  });

  it('maps the helmet to the helmet item and a four-arrow block to the cross block', () => {
    const { level, report } = convert([
      put(1, 0, { code: HELMET }, { code: FLOOR_CODE }),
      put(2, 0, { code: DIRECTIONAL_BLOCK, dir: 2, arrows: ALL_ARROWS }, { code: FLOOR_CODE })
    ]);
    expect(level.items[0][1]).toBe('helmet');
    expect(level.entities).toEqual([{ x: 2, y: 0, type: 'arrow_block_cross', dir: 'S' }]);
    expect(report.warnings.join('\n')).not.toMatch(/played as a dirt block/);
  });

  it('keeps a no-sign over a helmet playable through the ward fallback', () => {
    const { level, coverage } = convert([put(1, 0, { code: NO_SIGN }, { code: HELMET }, { code: FLOOR_CODE })]);
    expect(level.items[0][1]).toBe('no_sign_ward');
    expect(coverage.lost).toEqual([]);
    expect(coverage.approx).toContain('helmet_no_sign');
  });
});

describe('orange button links', () => {
  /** Reading order of the emitted links: [button x, button y, jet x, jet y]. */
  const links = (result: ReturnType<typeof convert>): number[][] =>
    (result.level.signalLinks ?? []).map((l) => [l.fromX, l.fromY, l.toX, l.toY]);

  it('places the pressure plate and links it to the nearest jet by the diamond search', () => {
    const result = convert([put(1, 1, { code: ORANGE_BUTTON }), put(4, 3, { code: FLAME_JET_OFF }), put(1, 3, { code: FLAME_JET_ON })], 6, 4);
    expect(result.level.terrain[1][1]).toBe('signal_plate');
    // Distance 2 south (1,3) wins over distance 4 (4,3).
    expect(links(result)).toEqual([[1, 1, 1, 3]]);
  });

  it('walks each ring east first, then counterclockwise', () => {
    // Ring 1 from (2,2): east (3,2), then (2,1) north, (1,2) west, (2,3) south.
    const east = convert([put(2, 2, { code: ORANGE_BUTTON }), put(3, 2, { code: FLAME_JET_OFF }), put(2, 1, { code: FLAME_JET_OFF })], 5, 5);
    expect(links(east)).toEqual([[2, 2, 3, 2]]);
    const north = convert([put(2, 2, { code: ORANGE_BUTTON }), put(2, 1, { code: FLAME_JET_OFF }), put(1, 2, { code: FLAME_JET_OFF }), put(2, 3, { code: FLAME_JET_OFF })], 5, 5);
    expect(links(north)).toEqual([[2, 2, 2, 1]]);
    const west = convert([put(2, 2, { code: ORANGE_BUTTON }), put(1, 2, { code: FLAME_JET_OFF }), put(2, 3, { code: FLAME_JET_OFF })], 5, 5);
    expect(links(west)).toEqual([[2, 2, 1, 2]]);
    const south = convert([put(2, 2, { code: ORANGE_BUTTON }), put(2, 3, { code: FLAME_JET_OFF })], 5, 5);
    expect(links(south)).toEqual([[2, 2, 2, 3]]);
  });

  it('reaches a jet diagonally on the same ring in Lexy order', () => {
    // Ring 2 from (2,2) starts at (4,2) and heads north-west: (4,2), (3,1); then south-west: (2,0), (1,1); then (0,2), (1,3);
    // then south-east (2,4), (3,3); then north-east back round.
    const result = convert([put(2, 2, { code: ORANGE_BUTTON }), put(3, 3, { code: FLAME_JET_OFF }), put(3, 1, { code: FLAME_JET_OFF })], 5, 5);
    expect(links(result)).toEqual([[2, 2, 3, 1]]);
  });

  it('links nothing and warns when no jet exists', () => {
    const result = convert([put(2, 1, { code: ORANGE_BUTTON })]);
    expect(result.level.signalLinks).toBeUndefined();
    expect(result.report.warnings.join('\n')).toMatch(/orange button at 2,1 has no flame jet/);
    expect(result.coverage.approx).not.toContain('button_orange_shared');
  });

  it('links two buttons to one jet and reports the OR as a known approximation', () => {
    const result = convert([put(1, 1, { code: ORANGE_BUTTON }), put(3, 1, { code: ORANGE_BUTTON }), put(2, 1, { code: FLAME_JET_OFF })]);
    expect(links(result)).toEqual([[1, 1, 2, 1], [3, 1, 2, 1]]);
    expect(result.coverage.verdict).toBe('approx');
    expect(result.coverage.approx).toContain('button_orange_shared');
  });

  it('keeps a lone button and jet approximate, with the plate and jet differences stated', () => {
    const result = convert([put(1, 1, { code: ORANGE_BUTTON }), put(2, 1, { code: FLAME_JET_OFF })]);
    expect(result.coverage).toEqual({ verdict: 'approx', lost: [], approx: ['button_orange', 'flame_jet'] });
    expect(CC2_COVERAGE.button_orange.reason).toMatch(/sliding entities and flying monsters/);
    expect(CC2_COVERAGE.flame_jet.reason).toMatch(/on_stand/);
  });

  it('keeps wire links in front of the button links', () => {
    const result = convertCc2Map(
      makeMap(5, 3, [
        player(0, 2),
        put(1, 0, modTile(0x5e, 0x4)),
        put(1, 1, modTile(FLOOR_CODE, 0x1 | 0x2)),
        put(2, 1, { code: FLAME_JET_OFF }),
        put(4, 1, { code: ORANGE_BUTTON })
      ]),
      OPTIONS
    );
    expect(links(result)).toEqual([[1, 0, 2, 1], [4, 1, 2, 1]]);
    expect(result.coverage.approx).toContain('button_orange_shared');
  });
});

describe('format 14 coverage verdicts', () => {
  it('plays the turtle, the helmet and the popdown floor as exact', () => {
    for (const key of ['turtle', 'helmet', 'green_wall_fake']) {
      expect(CC2_COVERAGE[key].level, key).toBe('exact');
    }
    const result = convert([
      put(1, 0, { code: TURTLE }),
      put(2, 0, { code: POPDOWN_FLOOR }),
      put(1, 1, { code: HELMET }, { code: FLOOR_CODE })
    ]);
    expect(result.coverage).toEqual({ verdict: 'exact', lost: [], approx: [] });
  });

  it('states the known gaps of the other new ids', () => {
    expect(CC2_COVERAGE.teleport_green.level).toBe('approx');
    expect(CC2_COVERAGE.teleport_green.reason).toMatch(/green_teleports_can_fail/);
    expect(CC2_COVERAGE.teleport_green.reason).toMatch(/Epoxy seeded stream/);
    expect(CC2_COVERAGE.wired_flame_jet.reason).toMatch(/once when its signal rises/);
    expect(CC2_COVERAGE.slime.level).toBe('approx');
    expect(CC2_COVERAGE.slime.reason).toMatch(/boulder/);
    expect(CC2_COVERAGE.slime.reason).not.toMatch(/consumes the block/);
    expect(CC2_COVERAGE.transmogrifier.level).toBe('approx');
    expect(CC2_COVERAGE.transmogrifier.reason).toMatch(/blue tank/);
    expect(CC2_COVERAGE.transmogrifier.reason).toMatch(/transmogrifier_cc2_off/);
    expect(CC2_COVERAGE.teleport_red.level).toBe('approx');
    expect(CC2_COVERAGE.teleport_red.reason).toMatch(/player override/);
    expect(CC2_COVERAGE.arrow_block_cross.level).toBe('exact');
    expect(CC2_COVERAGE.arrow_block_cross.reason).toMatch(/shoves the resting block/);
    expect(CC2_COVERAGE.button_orange_shared.reason).toMatch(/ORs the sources/);
  });

  it('reports a level of the changed codes under the right keys', () => {
    const result = convert([
      put(1, 0, { code: SLIME }),
      put(2, 0, { code: TRANSMOGRIFIER }),
      put(3, 0, { code: TELEPORT_RED }),
      put(4, 0, { code: DIRECTIONAL_BLOCK, dir: 2, arrows: ALL_ARROWS }, { code: FLOOR_CODE })
    ]);
    expect(result.coverage.lost).toEqual([]);
    expect(result.coverage.approx).toEqual(['slime', 'teleport_red', 'transmogrifier']);
  });

  it('keeps a level without these codes unchanged', () => {
    const result = convert([put(1, 0, actorTile(0x33), { code: FLOOR_CODE }), put(2, 0, { code: 0x08 })]);
    expect(result.coverage).toEqual({ verdict: 'exact', lost: [], approx: [] });
    expect(result.level.signalLinks).toBeUndefined();
  });
});
