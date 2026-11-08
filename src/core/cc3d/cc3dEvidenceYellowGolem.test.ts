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

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { ConfigRegistry } from '../../config/ConfigRegistry';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { EPOXY_COVERAGE } from './epoxyCoverage';
import { device, playSettled, playTimeline, room, withMob } from './cc3dEvidenceRig';
import type { SettledRun } from './cc3dEvidenceRig';
import type { GlyphMeaning } from './cc3dTestMaps';

/**
 * Coverage evidence for the yellow golem, its control and sand. Each case plays a tiny CC3D map on the CC3D engine
 * and on its conversion and compares the whole state after each press of the player (see cc3dEvidenceRig.playSettled),
 * and as a timeline where the timing of a step is the point.
 */

beforeEach(() => {
  loadTestConfigs();
});

const GLYPHS: Record<string, GlyphMeaning> = {
  '*': device('golem_control_yellow'),
  '%': device('golem_control_blue'),
  // A yellow golem facing east, one facing west, and a blue golem.
  Y: withMob(device('floor'), { kind: 'golem_yellow', dir: 'E' }),
  y: withMob(device('floor'), { kind: 'golem_yellow', dir: 'W' }),
  B: withMob(device('floor'), { kind: 'golem_blue', dir: 'E' }),
  p: device('trap'),
  m: withMob(device('clone_machine', { dir: 'E' }), { kind: 'golem_yellow', dir: 'E' }),
  x: device('clone_switch'),
  '=': device('plate', { color: 'yellow' }),
  d: device('hold_door', { color: 'yellow', open: false }),
  R: { mob: { kind: 'block_color', color: 'red' } },
  k: device('teleport_blue'),
  S: device('socket')
};

/** The player at the left end, the controls in a row, then the golem and what lies to its east. */
const FOUR_PRESSES = 'EEEE';
const FOUR_CONTROLS = '****';

/** A corridor: the player, `controls` yellow controls, a golem and the cells that follow. */
function lane(controls: string, ahead: string): string[] {
  return room(`@${controls}Y${ahead}`);
}

function play(rows: string[], presses = FOUR_PRESSES): SettledRun {
  return playSettled({ rows, moves: '', glyphs: GLYPHS }, presses);
}

/** The two engines showed the same state after every press, and something did change in CC3D. */
function expectSame(run: SettledRun): void {
  expect(new Set(run.cc3d).size, 'something moved').toBeGreaterThan(1);
  const short = (states: string[]): string[] => states.map((state) => state.split(' wall,')[0]);
  expect(short(run.epoxy)).toEqual(short(run.cc3d));
  expect(run.epoxy).toEqual(run.cc3d);
}

describe('yellow golem', () => {
  /** Cells east of the golem where the path is the same, state by state. */
  const SAME_PATH: Array<[string, string]> = [
    ['steps once per entry of the player onto the control and stops at the wall', '.......'],
    ['is lost in water', '.W...'],
    ['is lost in fire', '.F...'],
    ['is lost in slime', '.L...'],
    ['walks over sand', '.A...'],
    ['is stopped by gravel', '.G...'],
    ['is stopped by dirt', '.D...'],
    ['is stopped by the exit', '.X...'],
    ['is stopped by an item', '.i...'],
    ['is stopped by a security gate', '.N...'],
    ['is stopped by a key gate', '.n...'],
    ['is not carried by ice', '.I...'],
    ['is not carried by a force floor', '.>...'],
    ['is not carried by a force floor against it', '.<...'],
    ['is not carried by a force floor across it', '.^...'],
    ['walks over a turtle and sinks it', '.T....'],
    ['sets off a bomb and is gone with it', '.O...'],
    ['pushes a dirt block', '.K....'],
    ['pushes an ice block', '.Z....'],
    ['pushes a colour block', '.C....'],
    ['cannot push two blocks', '.KK...'],
    ['cannot push a block against a wall', '..K#'],
    ['pushes a block into water, where it floats', '.KW...'],
    ['pushes a block onto sand', '.KA...'],
    ['presses a plate and holds a door open while it stands on it', '.=.d.'],
    ['walks into a closed trap and is held there', '.p...'],
    ['walks through an open toggle door', '.j...'],
    ['is stopped by a closed toggle door', '.J...'],
    ['is stopped by a closed hold door', '.H...'],
    ['is stopped by a second golem in its way', '.B...'],
    ['is stopped by a golem coming the other way', '.y...'],
    ['is stopped by a false wall', '.V...'],
    ['is stopped by a push-up wall', '.P...'],
    ['is not turned by a random force floor', '.?...'],
    ['is stopped by a chip socket', '.S...'],
    ['is stopped by a door', '.1...'],
    ['pushes an ice block into water', '.ZW...'],
    ['walks into a teleport and comes out of the other', '.t...t..']
  ];

  it.each(SAME_PATH)('%s', (_name, ahead) => {
    expectSame(play(lane(FOUR_CONTROLS, ahead)));
  });

  it('steps one cell for each entry of the player onto a control', () => {
    const run = play(lane('***', '.....'), 'EEE');
    expectSame(run);
    expect(run.cc3d.at(-1)).toContain('golem_yellow@8,1');
  });

  it('differs at an appearing wall: a CC3D golem makes it a wall, an Epoxy one leaves it as it is', () => {
    const run = play(lane(FOUR_CONTROLS, '.Q...'));
    expect(run.same).toBe(false);
    expect(run.cc3d.at(-1)).toContain('wall,floor');
    expect(run.epoxy.at(-1)).toContain('appearing_wall');
  });

  it('differs in the timing of a step only: CC3D walks a cell in 4 ticks, from a tick after the player settles, Epoxy steps at once', () => {
    const t = playTimeline({ rows: lane('*', '.....'), moves: '', glyphs: GLYPHS }, 'E');
    expect(t.sameSequence).toBe(false);
    expect(t.sameFinal).toBe(true);
    expect(t.cc3d.bodies).toHaveLength(t.epoxy.bodies.length + 1);
  });
});

describe('yellow golem and its surroundings', () => {
  it('follows the player who walks on, one cell behind', () => {
    expectSame(play(room('Y@**....'), 'EE'));
  });

  it('leaves its template on a clone machine where it is, and steers the copy', () => {
    const run = play(room('@x*m......'), 'EEE');
    expectSame(run);
    expect(run.cc3d.at(-1)?.match(/golem_yellow@/g)).toHaveLength(2);
  });

  it('walks over a teleport and comes out of the other one', () => {
    expectSame(play(room('@***Y.k.....k..'), 'EEEE'));
  });

  it('is stopped by a chip socket', () => {
    expectSame(play(room('@***Y.S..'), 'EEE'));
  });

  it('presses a plate when it stands on it, and the door follows', () => {
    const run = play(room('@****Y=.d..'), 'EEEE');
    expectSame(run);
    expect(run.cc3d.some((state) => state.includes('hold_door_yellow_open'))).toBe(true);
  });

  it('pushes a block of another colour onto a yellow plate, which stays unpressed', () => {
    expectSame(play(room('@****YR=.d..'), 'EEEE'));
  });
});

describe('yellow golem control', () => {
  it('does nothing when a golem steps onto it', () => {
    expectSame(play(room('@*Y*Y...'), 'EE'));
  });

  it('moves every golem, the one ahead first, so a line moves together', () => {
    expectSame(play(room('@****YY.....')));
    expectSame(play(room('@****YYY....')));
  });

  it('moves a golem on another row as well, in the direction the player moved', () => {
    expectSame(play(room('@****Y.....', '......Y.....')));
  });

  it('does not turn a blue golem, and the blue control does not turn a yellow golem', () => {
    expectSame(play(room('@****Y.%...', '.......B....')));
  });
});

describe('yellow golem pace', () => {
  it.each([4, 5, 6, 8])('follows a player who presses every %i ticks', (spacing) => {
    const run = playSettled({ rows: room('@******Y.......'), moves: '', glyphs: GLYPHS }, 'EEEEEE', spacing);
    const short = (states: string[]): string[] => states.map((state) => state.split(' wall,')[0]);
    expect(short(run.epoxy)).toEqual(short(run.cc3d));
  });
});

describe('sand', () => {
  it('is entered by the player and by blocks, as gravel is', () => {
    expectSame(play(room('@AAK.....'), 'EEE'));
  });
});

describe('yellow golem in Epoxy', () => {
  it('is an Epoxy-only monster steered by the puppet control and pushing one block', () => {
    const def = ConfigRegistry.getEntityDef('golem_yellow');
    expect(def?.kind).toBe('monster');
    expect(def?.epoxyOnly).toBe(true);
    expect(def?.steeredBy).toBe('steer_monsters');
    expect(def?.pushesBlocks).toBe(true);
    expect(def?.passesTiles).toEqual(['sand', 'fire']);
  });

  it('keeps the entries of the coverage table', () => {
    expect(EPOXY_COVERAGE.golem_yellow).toBeDefined();
    expect(EPOXY_COVERAGE.sand).toBeDefined();
  });
});
