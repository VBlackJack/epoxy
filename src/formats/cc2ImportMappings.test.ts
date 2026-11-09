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

/**
 * CC2 import mappings: letter tiles as floor, yellow teleports as forward pads, and wires reaching track switches.
 * Every level is a synthetic map built here; the rules follow the Lexy's Labyrinth engine (floor_letter,
 * teleport_yellow, railroad on_power).
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../audio/AudioManager', () => import('../test/silentAudio'));

import { loadTestConfigs } from '../test/loadTestConfigs';
import { GameEngine } from '../core/GameEngine';
import { CC2_COVERAGE } from '../core/cc2/cc2Coverage';
import { convertCc2Map } from './cc2ToEpoxy';
import type { Cc2ConvertOptions } from './cc2ToEpoxy';
import { FLOOR_CODE, makeMap, modTile, player, put } from './cc2TestMaps';

const OPTIONS: Cc2ConvertOptions = { file: 'one.c2m', order: 3, sha256: 'ab'.repeat(32) };
const E = 0x2;
const W = 0x8;
const DIR_E = 1;
const LETTER = 0x71;
const YELLOW_TELEPORT = 0x12;
const PINK = 0x5e;
const TRACK = 0x4f;
/** North-east and south-east segments plus the switch flag, the active segment being north-east. */
const TRACK_TWO_SEGMENT_SWITCH = 0x43;
/** North-east segment plus the switch flag. */
const TRACK_ONE_SEGMENT_SWITCH = 0x41;
const ACTIVE_NORTH_EAST = 0;
const ACTIVE_SOUTH_EAST = 1;
const MAX_WAIT_TICKS = 40;

beforeAll(() => {
  loadTestConfigs();
});

describe('letter tiles', () => {
  it('maps a letter tile to plain floor with no hint, keeping the approximate letter key', () => {
    const { level, coverage, report } = convertCc2Map(makeMap(3, 1, [player(0, 0, DIR_E), put(1, 0, { code: LETTER })]), OPTIONS);
    expect(level.terrain[0][1]).toBe('floor');
    expect(level.terrain.flat()).not.toContain('hint');
    expect(coverage.approx).toEqual(['letter']);
    expect(report.approx.map((entry) => entry.key)).toContain('letter');
    expect(CC2_COVERAGE.letter.level).toBe('approx');
    expect(CC2_COVERAGE.letter.reason).toMatch(/glyph is lost/);
  });
});

describe('yellow teleports', () => {
  it('maps a yellow teleport to the forward pad and states the pick-up difference', () => {
    const { level, coverage } = convertCc2Map(
      makeMap(5, 1, [player(0, 0, DIR_E), put(2, 0, { code: YELLOW_TELEPORT }), put(4, 0, { code: YELLOW_TELEPORT })]),
      OPTIONS
    );
    expect(level.terrain[0][2]).toBe('teleport_forward');
    expect(level.terrain[0][4]).toBe('teleport_forward');
    expect(coverage.approx).toEqual(['teleport_yellow']);
    expect(CC2_COVERAGE.teleport_yellow.reason).toMatch(/picked up as an item/);
  });
});

describe('wired track switches', () => {
  const WIDTH = 5;
  const HEIGHT = 1;

  /** Player, pink button, floor wire, track switch in a row: walking east presses the button. */
  function wiredSwitchLevel(trackMod: number) {
    return convertCc2Map(
      makeMap(WIDTH, HEIGHT, [
        player(0, 0, DIR_E),
        put(1, 0, modTile(PINK, E)),
        put(2, 0, modTile(FLOOR_CODE, E | W)),
        put(3, 0, modTile(TRACK, trackMod))
      ]),
      OPTIONS
    );
  }

  function step(engine: GameEngine, dir: 'E' | 'W'): void {
    for (let waited = 0; waited <= MAX_WAIT_TICKS; waited++) {
      if (engine.getPlayer().moveCooldown === 0) {
        engine.attemptPlayerMove(dir);
        return;
      }
      engine.tick();
    }
    throw new Error('the player never became able to move');
  }

  function activeOf(engine: GameEngine): number | undefined {
    return engine.getRailState()?.find(([cell]) => cell === 3)?.[1];
  }

  it('links the wire to the track cell and reports wired_track as exact', () => {
    const { level, coverage, report } = wiredSwitchLevel(TRACK_TWO_SEGMENT_SWITCH);
    expect(level.signalLinks).toEqual([{ fromX: 1, fromY: 0, toX: 3, toY: 0 }]);
    expect(level.terrain[0][3]).toBe('rail_junction');
    expect(coverage.approx).not.toContain('wired_track');
    expect(report.exact).toContain('wired_track');
    expect(CC2_COVERAGE.wired_track.level).toBe('exact');
  });

  it('links nothing for a track without a switch or a switch without a wire', () => {
    const noSwitch = convertCc2Map(
      makeMap(WIDTH, HEIGHT, [player(0, 0, DIR_E), put(1, 0, modTile(PINK, E)), put(2, 0, modTile(FLOOR_CODE, E | W)), put(3, 0, modTile(TRACK, 0x03))]),
      OPTIONS
    );
    expect(noSwitch.level.signalLinks ?? []).toEqual([]);
    const free = convertCc2Map(makeMap(WIDTH, HEIGHT, [player(0, 0, DIR_E), put(3, 0, modTile(TRACK, TRACK_TWO_SEGMENT_SWITCH))]), OPTIONS);
    expect(free.level.signalLinks ?? []).toEqual([]);
  });

  it('advances the switch on the rising edge of the wire only', () => {
    const { level } = wiredSwitchLevel(TRACK_TWO_SEGMENT_SWITCH);
    const engine = new GameEngine();
    engine.loadLevel(level);
    expect(activeOf(engine)).toBe(ACTIVE_NORTH_EAST);

    // Onto the pink button: the wire rises, the switch advances once.
    step(engine, 'E');
    expect(activeOf(engine)).toBe(ACTIVE_SOUTH_EAST);

    // Off the button: the wire falls, the switch stays.
    step(engine, 'E');
    expect(activeOf(engine)).toBe(ACTIVE_SOUTH_EAST);

    // Back onto the button: a new rising edge advances it again, back to the first segment.
    step(engine, 'W');
    expect(activeOf(engine)).toBe(ACTIVE_NORTH_EAST);

    // Off again: the falling edge changes nothing.
    step(engine, 'W');
    expect(activeOf(engine)).toBe(ACTIVE_NORTH_EAST);
  });

  it('keeps a one-segment wired switch on its segment', () => {
    const { level } = wiredSwitchLevel(TRACK_ONE_SEGMENT_SWITCH);
    const engine = new GameEngine();
    engine.loadLevel(level);
    step(engine, 'E');
    expect(activeOf(engine)).toBe(ACTIVE_NORTH_EAST);
  });
});
