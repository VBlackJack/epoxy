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
 * CC2 wave 22, RBG: a monster clone released onto a gray area button pulses its area when its step ends (Lexy button_gray on_arrive
 * from step_on_cell, tiletypes.js 2446-2451), like the red button press of wave 20. Lane w22_nest_gray: a plate opens a cloner whose
 * glider walks onto a gray button; the flame jet in the button's area is lit by the end of Lexy t8.
 *
 * The lane carries its own replay; the harness feeds it as the Lexy harness does (the keys held at each tic, one engine tick per tic),
 * so "after tick t" is the end of Lexy t.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { decodeC2m } from '../../formats/C2mCodec';
import { cc2ReplaySections } from '../../formats/cc2Model';
import { CC2_FRAMES_PER_TICK, CC2_REPLAY_KEY_BITS, decodeCc2Replay } from '../../formats/cc2Replay';
import { loadCc2Lane } from '../../test/cc2LaneFixture';
import { ROOM_ROW, room } from '../../test/cc2Room';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { GameEngine } from '../GameEngine';
import type { Direction } from '../types';
import type { EpoxyWorld } from './epoxyWorld';

beforeEach(() => {
  loadTestConfigs();
});

const LANE = 'nest_gray';
const LANE_PREFIX = 'w22_';
const LANE_FILE = `./__fixtures__/cc2-lanes/${LANE_PREFIX}${LANE}.c2m`;
const LANE_TICKS = 24;
const DIRECTIONS: readonly Direction[] = ['N', 'E', 'S', 'W'];
/** The jet of the lane, in the area of the gray button (11,7). */
const JET_X = 13;
const JET_Y = 8;
const JET_ON = 'flame_jet_cc2_on';
const JET_OFF = 'flame_jet_cc2_off';
/** Lexy: the jet is lit by the end of t8 (harness tick 8, counted from 0 as the Lexy harness does). */
const LIT_TICK = 8;
const SEED = 3;
const GRAY_BUTTON = 'button_gray_area';
const RED_BUTTON = 'button_red';
const CLONER = 'clone_machine';
const BLOCK = 'dirt_block';
/** The control room: the player steps onto the red button, its cloner faces a gray button, a jet lies beside the button. */
const START_X = 2;
const RED_X = 3;
const CLONER_X = 4;
const BUTTON_X = 5;
const JET_ROOM_X = 6;
/** The tick the jet of the control room lights (the player's step, the release and the clone's step onto the button). */
const ROOM_LIT_TICK = 8;
const CONTROL_TICKS = 40;

const worldOf = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;

/** Plays the lane with the keys of its replay; returns the first harness tick (0-based) after which the jet is lit, or undefined. */
async function jetLitTick(): Promise<number | undefined> {
  const level = await loadCc2Lane(LANE, LANE_PREFIX);
  const bytes = new Uint8Array(readFileSync(fileURLToPath(new URL(LANE_FILE, import.meta.url))));
  const replay = decodeCc2Replay(cc2ReplaySections(decodeC2m(bytes))[0]);
  const engine = new GameEngine();
  engine.loadLevel(level, replay.blobSeed);
  let keys = 0;
  let next = 0;
  for (let tick = 0; tick < LANE_TICKS; tick++) {
    while (next < replay.inputs.length && replay.inputs[next].frame < (tick + 1) * CC2_FRAMES_PER_TICK) keys = replay.inputs[next++].keys;
    const held = DIRECTIONS.filter((d) => (keys & CC2_REPLAY_KEY_BITS[d]) !== 0);
    if (held.length > 0) engine.attemptPlayerMoveHeld(held);
    engine.tick();
    if (worldOf(engine).terrain[JET_Y][JET_X] === JET_ON) return tick;
  }
  return undefined;
}

/** The player steps onto the red button; the clone of `templateType` is released onto the gray button. Returns the tick the jet lights, or undefined. */
function cloneOntoGray(templateType: string): number | undefined {
  const engine = new GameEngine();
  const row = ROOM_ROW;
  engine.loadLevel({
    ...room({
      mode: 'cc2',
      startX: START_X,
      terrain: { [`${RED_X},${row}`]: RED_BUTTON, [`${CLONER_X},${row}`]: CLONER, [`${BUTTON_X},${row}`]: GRAY_BUTTON, [`${JET_ROOM_X},${row}`]: JET_OFF }
    }),
    entities: [{ type: templateType, x: CLONER_X, y: row, dir: 'E' }],
    cloneLinks: [{ buttonX: RED_X, buttonY: row, clonerX: CLONER_X, clonerY: row, templateType, templateDir: 'E' }]
  }, SEED);
  engine.attemptPlayerMove('E');
  for (let tick = 0; tick < CONTROL_TICKS; tick++) {
    engine.tick();
    if (worldOf(engine).terrain[row][JET_ROOM_X] === JET_ON) return tick;
  }
  return undefined;
}

describe('RBG: a clone released onto a gray button pulses its area when its step ends (CC2 engine)', () => {
  // Lane nest_gray (Lexy): plate -> cloner (glider) -> gray button, jet in its area. Lexy lights the jet by the end of t8; without the
  // rule the clone's release never pulsed the button and the jet stayed dark.
  it('lane nest_gray: the jet is lit by the end of t8', async () => {
    expect(await jetLitTick()).toBe(LIT_TICK);
  });

  // The same clone released by the red button of a room: the glider's step onto the gray button ends at tick 8 and lights the jet.
  it('a glider clone on a gray button lights the jet when its step ends', () => {
    expect(cloneOntoGray('glider')).toBe(ROOM_LIT_TICK);
  });

  // Control: a block clone released onto the gray button was already pulsing it (a block is not a monster step end): the rule leaves it.
  it('a block clone on a gray button lights the jet at the same tick as before the rule', () => {
    expect(cloneOntoGray(BLOCK)).toBe(ROOM_LIT_TICK);
  });
});
