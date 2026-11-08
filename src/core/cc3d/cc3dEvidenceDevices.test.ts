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

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { expectAgree, expectDisagree } from './cc3dEvidenceAsserts';
import { EPOXY_COVERAGE } from './epoxyCoverage';
import { device, holdDoor, plate, playTimeline, room, withMob } from './cc3dEvidenceRig';
import { cc3dLevel } from './cc3dTestMaps';
import type { GlyphMeaning } from './cc3dTestMaps';
import { convertCc3dLevel } from './cc3dToEpoxy';
import { DifferentialPair } from './cc3dToEpoxyDifferential';
import { CC3D_COLORS } from './model';
import type { Cc3dColor, Cc3dMobKind } from './model';

/**
 * Coverage evidence for the devices: traps and their controls, clone machines and switches, the blue golem and
 * its control, and the four colours of plate. Each case plays a tiny CC3D map on the CC3D engine and on its
 * conversion and compares the two (see cc3dEvidenceRig): after every move for a map where the monsters stand
 * still, and as a timeline for a golem, whose pace differs from Epoxy's.
 */

beforeEach(() => {
  loadTestConfigs();
});

const PLATE_GLYPH: Record<Cc3dColor, string> = { red: '=', blue: '+', yellow: '~', green: '$' };
const DOOR_GLYPH: Record<Cc3dColor, string> = { red: 'd', blue: 'b', yellow: 'c', green: 'h' };
const GLYPHS: Record<string, GlyphMeaning> = {
  R: { mob: { kind: 'block_color', color: 'red' } },
  p: device('trap'),
  q: device('trap_control'),
  x: device('clone_switch'),
  '*': device('golem_control_blue'),
  // A golem facing east, and one facing west.
  B: withMob(device('floor'), { kind: 'golem_blue', dir: 'E' }),
  '(': withMob(device('floor'), { kind: 'golem_blue', dir: 'W' }),
  // Clone machines facing east, holding a template.
  m: withMob(device('clone_machine', { dir: 'E' }), { kind: 'block_dirt' }),
  n: withMob(device('clone_machine'), { kind: 'block_ice', dir: 'E' }),
  r: withMob(device('clone_machine', { dir: 'E' }), { kind: 'block_color', color: 'red' }),
  g: withMob(device('clone_machine', { dir: 'E' }), { kind: 'golem_blue', dir: 'E' }),
  ...Object.fromEntries(CC3D_COLORS.flatMap((color) => [[PLATE_GLYPH[color], plate(color)], [DOOR_GLYPH[color], holdDoor(color)]]))
};
const doorOpen = (color: Cc3dColor): string => `cc3d_hold_door_${color}_open`;
const doorClosed = (color: Cc3dColor): string => `cc3d_hold_door_${color}_closed`;

/** The player sealed in a corner cell, so that only the monsters move. */
const SEALED_START = '@#########';

/** A corridor with a sealed player and the given row of cells. */
function corridor(cells: string): string[] {
  return room(SEALED_START, `#${cells}#`);
}

// ------------------------------------------------------------------- traps

describe('trap and trap control', () => {
  it('holds the player in a closed trap, while the control is not pressed', () => {
    expectAgree({ rows: room('@p.q'), moves: 'EEE', glyphs: GLYPHS }, (pair) => {
      expect(pair.rig.player.x).toBe(2);
    });
  });

  it('holds a block pushed into a closed trap', () => {
    expectAgree({ rows: room('@Kp..'), moves: 'EE', glyphs: GLYPHS }, (pair) => {
      expect(pair.rig.player.x).toBe(2);
      expect(pair.rig.entities.map((e) => e.x)).toEqual([3]);
    });
  });

  it('opens the next trap in reading order while a block rests on the control', () => {
    expectAgree({ rows: room('@Kq...', '....p.'), moves: 'ESEEEE', glyphs: GLYPHS }, (pair) => {
      expect(pair.rig.player).toMatchObject({ x: 6, y: 2 });
    });
  });

  it('works the first trap from a control that comes after the last one, and keeps it shut otherwise', () => {
    expectAgree({ rows: room('.p....', '@Kq...'), moves: 'ENE', glyphs: GLYPHS }, (pair) => {
      expect(pair.rig.player).toMatchObject({ x: 3, y: 1 });
    });
    expectAgree({ rows: room('.p....', '@Kq...'), moves: 'NEE', glyphs: GLYPHS }, (pair) => {
      expect(pair.rig.player).toMatchObject({ x: 2, y: 1 });
    });
  });

  it('opens one trap from either of two controls before it', () => {
    expectAgree({ rows: room('@Kq.q..', '...p...'), moves: 'ESEEE', glyphs: GLYPHS }, (pair) => {
      expect(pair.rig.player).toMatchObject({ x: 5, y: 2 });
    });
  });

  it('differs for a trap no control works: CC3D keeps it shut, Epoxy opens it with any brown button held', () => {
    expectDisagree({ rows: room('@Kq....', '..p.p..'), moves: 'ESEEEE', glyphs: GLYPHS }, 'player', (pair) => {
      expect(pair.rig.player).toMatchObject({ x: 5, y: 2 });
    });
  });
});

// ------------------------------------------------------------------ clones

describe('clone machine and clone switch', () => {
  it('releases a copy of the template in the direction of the machine, whatever block it is', () => {
    for (const machine of ['m', 'n', 'r']) {
      expectAgree({ rows: room(`@x.${machine}..`), moves: 'E', glyphs: GLYPHS }, (pair) => {
        expect(pair.rig.entities.map((e) => e.x).sort()).toEqual([4, 5]);
      });
    }
  });

  it('takes the template direction when the machine has none', () => {
    expectAgree({ rows: room('@xn..'), moves: 'E', glyphs: GLYPHS }, (pair) => {
      expect(pair.rig.entities.map((e) => e.x).sort()).toEqual([3, 4]);
    });
  });

  it('does nothing when the way out is blocked, by a block or by the previous copy', () => {
    expectAgree({ rows: room('@xmK.'), moves: 'E', glyphs: GLYPHS }, (pair) => {
      expect(pair.rig.entities).toHaveLength(2);
    });
    expectAgree({ rows: room('x@m..'), moves: 'WEW', glyphs: GLYPHS }, (pair) => {
      expect(pair.rig.entities).toHaveLength(2);
    });
  });

  it('works from the nearest machine, and from a block pushed onto the switch', () => {
    expectAgree({ rows: room('@xm...n', '.......'), moves: 'E', glyphs: GLYPHS }, (pair) => {
      expect(pair.rig.entities.map((e) => e.x).sort()).toEqual([3, 4, 7]);
    });
    expectAgree({ rows: room('@Kx.m..'), moves: 'E', glyphs: GLYPHS }, (pair) => {
      expect(pair.rig.entities.map((e) => e.x).sort()).toEqual([3, 5, 6]);
    });
  });

  it('refuses the player entry to the machine', () => {
    expectAgree({ rows: room('@m.'), moves: 'E', glyphs: GLYPHS }, (pair) => {
      expect(pair.rig.player.x).toBe(1);
    });
  });

  it('clones a golem that then walks off, as a timeline', () => {
    const t = playTimeline({ rows: room('@x#######', '##g.....#'), moves: '', glyphs: GLYPHS }, 'E');
    expect(t.sameFinal).toBe(true);
    expect(t.cc3d.final.match(/tank@/g)).toHaveLength(2);
  });
});

// ------------------------------------------------------------------ golems

describe('blue golem', () => {
  /** Corridors where the golem path is the same state by state, whatever the pace. */
  const SAME_PATH: Array<[string, string]> = [
    ['walks straight on and stops at the wall', '.B.....'],
    ['turns round at its control and walks back', '.B...*...'],
    ['turns round together with a second golem', '.B.(.*..'],
    ['is stopped by a golem coming the other way', '.B...(..'],
    ['is stopped by dirt', '.B..D.'],
    ['is stopped by gravel', '.B..G.'],
    ['is stopped by sand', '.B..A.'],
    ['is stopped by the exit', '.B..X.'],
    ['is stopped by an item', '.B..i.'],
    ['is stopped by a block', '.B..K.'],
    ['is stopped by a security gate', '.B..N.'],
    ['is carried by ice', '.B..I...'],
    ['is carried by a force floor', '.B..>...'],
    ['is turned back by a force floor against it', '.B..<...'],
    ['walks into a trap', '.B..p..'],
    ['walks through an open toggle door', '.B..j.']
  ];

  it.each(SAME_PATH)('%s', (_name, cells) => {
    const t = playTimeline({ rows: corridor(cells), moves: '', glyphs: GLYPHS });
    expect(t.cc3d.bodies.length, 'the golem moved').toBeGreaterThan(1);
    expect(t.cc3d.bodies).toEqual(t.epoxy.bodies);
    expect(t.cc3d.terrain).toEqual(t.epoxy.terrain);
  });

  it('presses a plate while it stands on it, and the door follows', () => {
    const t = playTimeline({ rows: corridor('.B.=...d.'), moves: '', glyphs: GLYPHS });
    expect(t.cc3d.terrain).toHaveLength(3);
    expect(t.cc3d.terrain).toEqual(t.epoxy.terrain);
    expect(t.cc3d.final).toBe(t.epoxy.final);
  });

  it('differs at water and at slime: a CC3D golem stops before it, an Epoxy one walks in and is lost', () => {
    for (const hazard of ['W', 'L']) {
      const t = playTimeline({ rows: corridor(`.B..${hazard}.`), moves: '', glyphs: GLYPHS });
      expect(t.sameFinal).toBe(false);
      expect(t.cc3d.final).toContain('tank@');
      expect(t.epoxy.final).not.toContain('tank@');
    }
  });

  it('enters an open blue gate and clears it, as the Epoxy fish gate does', () => {
    const t = playTimeline({ rows: corridor('.B..S.'), moves: '', glyphs: GLYPHS });
    expect(t.sameFinal).toBe(true);
    expect(t.cc3d.terrain.length).toBeGreaterThan(1);
    expect(t.epoxy.terrain.length).toBeGreaterThan(1);
  });

  it('differs at an appearing wall: CC3D golems open it, Epoxy ones are refused', () => {
    const t = playTimeline({ rows: corridor('.B..Q.'), moves: '', glyphs: GLYPHS });
    expect(t.sameFinal).toBe(false);
    expect(t.cc3d.terrain.length).toBeGreaterThan(t.epoxy.terrain.length);
  });

  it('differs on contact: a CC3D golem stops next to the player, an Epoxy one steps onto his cell', () => {
    const t = playTimeline({ rows: room('@..(...#'), moves: '', glyphs: GLYPHS });
    expect(t.sameFinal).toBe(false);
    expect(t.cc3d.final).toContain('tank@2,1');
    expect(t.cc3d.final).toContain('P1,1x');
    expect(t.epoxy.final).toContain('tank@1,1');
  });

  it('differs in pace: a CC3D golem crosses a cell in 4 ticks, an Epoxy one in 6', () => {
    const source = cc3dLevel(corridor('.B.......'), { glyphs: GLYPHS });
    const pair = new DifferentialPair(source, convertCc3dLevel(source).level, 1);
    const started = { cc3d: pair.rig.entities[0].x, epoxy: pair.epoxy.getEntities()[0].x };
    const crossed = { cc3d: 0, epoxy: 0 };
    const CELLS = 3;
    for (let tick = 1; tick <= 200; tick++) {
      pair.rig.tick(1);
      pair.epoxy.tick();
      if (crossed.cc3d === 0 && pair.rig.entities[0].x - started.cc3d >= CELLS) crossed.cc3d = tick;
      if (crossed.epoxy === 0 && pair.epoxy.getEntities()[0].x - started.epoxy >= CELLS) crossed.epoxy = tick;
    }
    expect(crossed.cc3d).toBeGreaterThan(0);
    expect(crossed.cc3d).toBeLessThan(crossed.epoxy);
  });
});

describe('blue golem control', () => {
  it('turns every golem round when the player steps onto it', () => {
    const t = playTimeline({ rows: room('@*######', '##(....#'), moves: '', glyphs: GLYPHS }, 'E');
    expect(t.sameFinal).toBe(true);
    expect(t.cc3d.final).toContain('tank@7,2');
  });

  it('turns every golem round when a block is pushed onto it', () => {
    const t = playTimeline({ rows: room('@K*#####', '###(....#'), moves: '', glyphs: GLYPHS }, 'E');
    expect(t.sameFinal).toBe(true);
    expect(t.cc3d.final).toContain('tank@8,2');
  });

  it('turns every golem round when a golem steps onto it, as the golem cases above show', () => {
    const t = playTimeline({ rows: corridor('.B.(.*..'), moves: '', glyphs: GLYPHS });
    expect(t.cc3d.bodies).toEqual(t.epoxy.bodies);
  });
});

// ------------------------------------------------------------------ plates

/** Monsters that press a plate they stand on in CC3D and in Epoxy alike. */
const PRESSING_BOTH: Cc3dMobKind[] = [
  'walker', 'limpa', 'limpy', 'bouncer', 'omni', 'snappy', 'nibble', 'golem_blue', 'golem_yellow',
  'bot_static', 'bot_cw', 'bot_ccw', 'bot_multi', 'block_dirt', 'block_ice', 'block_color'
];
/** Monsters that press in neither: the adult blinky and the adult screamer. */
const PRESSING_NEITHER: Cc3dMobKind[] = ['blinky', 'screamer'];
/** Monsters that press in CC3D and fly over the plate in Epoxy. */
const PRESSING_CC3D_ONLY: Cc3dMobKind[] = ['baby_blinky', 'baby_screamer', 'legs_green', 'legs_red'];

describe.each(CC3D_COLORS)('%s plate', (color) => {
  const glyph = PLATE_GLYPH[color];
  const door = DOOR_GLYPH[color];

  it('opens the doors of its colour while the player stands on it, and closes them when he leaves', () => {
    expectAgree({ rows: room(`@${glyph}.${door}.`), moves: 'E', glyphs: GLYPHS }, (pair) => {
      expect(pair.rig.terrainAt(4, 1)).toBe(doorOpen(color));
    });
    expectAgree({ rows: room(`@${glyph}.${door}.`), moves: 'EW', glyphs: GLYPHS }, (pair) => {
      expect(pair.rig.terrainAt(4, 1)).toBe(doorClosed(color));
    });
  });

  it('keeps the doors closed without a plate, and lets the occupant out of a door that closes on him', () => {
    expectAgree({ rows: room(`@.${door}.`), moves: 'EE', glyphs: GLYPHS }, (pair) => {
      expect(pair.rig.player.x).toBe(2);
      expect(pair.rig.terrainAt(3, 1)).toBe(doorClosed(color));
    });
    expectAgree({ rows: room(`@${glyph}${door}.`), moves: 'EEEW', glyphs: GLYPHS }, (pair) => {
      expect(pair.rig.player.x).toBe(4);
    });
  });

  it('needs every plate of its colour pressed at once', () => {
    const rows = room(`@K${glyph}....`, `.....${glyph}${door}`);
    expectAgree({ rows, moves: 'E', glyphs: GLYPHS }, (pair) => {
      expect(pair.rig.terrainAt(7, 2)).toBe(doorClosed(color));
    });
    expectAgree({ rows, moves: 'ESEEEE', glyphs: GLYPHS }, (pair) => {
      expect(pair.rig.player).toMatchObject({ x: 6, y: 2 });
      expect(pair.rig.terrainAt(7, 2)).toBe(doorOpen(color));
    });
  });

  it('is pressed by a dirt block, an ice block and a colour block of its own colour, and not by another colour', () => {
    const blocks = ['K', 'Z', ...(color === 'red' ? ['R'] : [])];
    for (const block of blocks) {
      expectAgree({ rows: room(`@${block}${glyph}.${door}.`), moves: 'E', glyphs: GLYPHS }, (pair) => {
        expect(pair.rig.terrainAt(5, 1)).toBe(doorOpen(color));
      });
    }
    const foreign = color === 'red' ? 'C' : 'R';
    expectAgree({ rows: room(`@${foreign}${glyph}.${door}.`), moves: 'E', glyphs: GLYPHS }, (pair) => {
      expect(pair.rig.terrainAt(5, 1)).toBe(doorClosed(color));
    });
  });

  it.each([...PRESSING_BOTH, ...PRESSING_NEITHER])('is pressed alike by a resting %s', (kind) => {
    const glyphs: Record<string, GlyphMeaning> = {
      ...GLYPHS,
      M: withMob(plate(color), { kind, color: kind === 'block_color' ? color : undefined }),
      [door]: holdDoor(color)
    };
    expectAgree({ rows: room('@.' + door + '.', '####', '#M#'), moves: 'EEW', glyphs, compareEntities: kind !== 'nibble' }, (pair) => {
      const expectOpen = PRESSING_BOTH.includes(kind);
      expect(pair.rig.terrainAt(3, 1)).toBe(expectOpen ? doorOpen(color) : doorClosed(color));
    });
  });

  it.each(PRESSING_CC3D_ONLY)('differs for a resting %s: CC3D presses the plate, the Epoxy flyer it becomes does not', (kind) => {
    const glyphs: Record<string, GlyphMeaning> = { ...GLYPHS, M: withMob(plate(color), { kind }), [door]: holdDoor(color) };
    expectDisagree({ rows: room('@.' + door + '.', '####', '#M#'), moves: 'EEW', glyphs }, 'cells', (pair) => {
      expect(pair.rig.terrainAt(3, 1)).toBe(doorOpen(color));
    });
  });
});

describe('coverage verdicts that rest on this evidence', () => {
  it('plays the trap, the clone machine and the golem control as CC3D does, each reason citing this file', () => {
    for (const key of ['trap', 'trap_control', 'clone_machine', 'clone_switch', 'golem_control_blue']) {
      expect(EPOXY_COVERAGE[key].level, key).toBe('exact');
      expect(EPOXY_COVERAGE[key].reason, key).toContain('cc3dEvidenceDevices.test.ts');
    }
  });

  it('keeps the golem and the four plates approximate, each reason citing this file', () => {
    for (const key of ['golem_blue', ...CC3D_COLORS.map((color) => `plate_${color}`)]) {
      expect(EPOXY_COVERAGE[key].level, key).toBe('approx');
      expect(EPOXY_COVERAGE[key].reason, key).toContain('cc3dEvidenceDevices.test.ts');
    }
  });

  it('keeps a trap no control works lost, since an Epoxy trap link has no empty form', () => {
    expect(EPOXY_COVERAGE.trap_unworked.level).toBe('lost');
    expect(EPOXY_COVERAGE.trap_unworked.reason).toContain('cc3dEvidenceDevices.test.ts');
  });
});
