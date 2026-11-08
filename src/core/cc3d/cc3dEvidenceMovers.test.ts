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
import { EPOXY_COVERAGE } from './epoxyCoverage';
import { expectAgree } from './cc3dEvidenceAsserts';
import { device, playTimeline, room, stack, withMob } from './cc3dEvidenceRig';
import type { GlyphMeaning } from './cc3dTestMaps';

/**
 * Coverage evidence for the elements whose rule Epoxy plays with dedicated tiles: the blue socket (the Epoxy fish
 * gate, which every mover enters once no chip is left) and the two teleporters (whose exits follow the CC3D order).
 * Each case plays a tiny CC3D map on the CC3D engine and on its conversion and compares the two after every move
 * (see cc3dEvidenceRig); the check proves the case did something on the CC3D side.
 */

beforeEach(() => {
  loadTestConfigs();
});

const FLOOR = 'floor';
/** A bouncer walking east: it goes straight on and turns round when blocked. */
const BOUNCER: Record<string, GlyphMeaning> = { b: withMob(device('floor'), { kind: 'bouncer', dir: 'E' }) };
const SEALED_START = '@#######';
const BOUNCER_ROW_START = '##.b.';
const BOUNCER_ROW_END = '..#';

/** Cells of the trail of the first monster the pace of each engine shares: the pads it only brushes are left out. */
const TRAIL_CELLS_COMPARED = 5;

/** The cells a single monster stood on, in order, without the pads and without repeats. */
function trailOf(bodies: readonly string[], pads: readonly string[]): string[] {
  const cells = bodies.map((body) => /@(\d+,\d+)/.exec(body)?.[1] ?? '').filter((cell) => cell !== '' && !pads.includes(cell));
  return cells.filter((cell, index) => index === 0 || cell !== cells[index - 1]);
}

/**
 * Both engines walk the monster through the same cells in the same order. The pace differs (a CC3D monster is seen
 * on a pad for a step before it goes), so the pads are left out and only the first cells are compared.
 */
function expectSameTrail(t: ReturnType<typeof playTimeline>, pads: readonly string[], label: string): void {
  const cc3d = trailOf(t.cc3d.bodies, pads).slice(0, TRAIL_CELLS_COMPARED);
  const epoxy = trailOf(t.epoxy.bodies, pads).slice(0, TRAIL_CELLS_COMPARED);
  expect(cc3d.length, label).toBe(TRAIL_CELLS_COMPARED);
  expect(epoxy, label).toEqual(cc3d);
}

function bouncerInto(glyph: string): string[] {
  return room(SEALED_START, `${BOUNCER_ROW_START}${glyph}${BOUNCER_ROW_END}`);
}

describe('blue socket (the fish gate)', () => {
  it('stays shut to the player while a chip is left, and the chip count is the same', () => {
    expectAgree({ rows: room('@S.i'), moves: 'EE' }, (pair) => {
      expect(pair.rig.player.x).toBe(1);
      expect(pair.rig.engine.getChipsRemaining()).toBe(1);
    });
  });

  it('opens for the player once the last chip is in, and turns into floor', () => {
    expectAgree({ rows: room('@iS.'), moves: 'EEE' }, (pair) => {
      expect(pair.rig.player.x).toBe(4);
      expect(pair.rig.terrainAt(3, 1)).toBe(FLOOR);
    });
  });

  it('opens at once when the level holds no chip', () => {
    expectAgree({ rows: room('@S.'), moves: 'EE' }, (pair) => {
      expect(pair.rig.player.x).toBe(3);
    });
  });

  it('stays shut to a block while a chip is left', () => {
    expectAgree({ rows: room('@KS.i'), moves: 'E' }, (pair) => {
      expect(pair.rig.player.x).toBe(1);
      expect(pair.rig.terrainAt(3, 1)).toBe('socket');
    });
  });

  it('is entered by a block once no chip is left, and the block clears it', () => {
    expectAgree({ rows: room('@K.S.'), moves: 'EEE' }, (pair) => {
      expect(pair.rig.terrainAt(4, 1)).toBe(FLOOR);
      expect(pair.rig.entities.map((e) => e.x)).toEqual([5]);
    });
  });

  it('is entered by a monster once no chip is left, and the monster clears it', () => {
    const t = playTimeline({ rows: bouncerInto('S'), moves: '', glyphs: BOUNCER });
    expect(t.sameFinal).toBe(true);
    expect(t.cc3d.terrain.length).toBeGreaterThan(1);
    expect(t.cc3d.final).toContain(FLOOR);
  });

  it('is refused by a monster while a chip is left', () => {
    const t = playTimeline({ rows: room('@iS#####', `${BOUNCER_ROW_START}S${BOUNCER_ROW_END}`), moves: '', glyphs: BOUNCER });
    expect(t.sameFinal).toBe(true);
    expect(t.cc3d.final).toContain('fish_gate');
  });

  it('does not judge the mover again on what it hid: a block that clears a gate over water stays on the water', () => {
    const glyphs: Record<string, GlyphMeaning> = { Y: stack({ kind: 'water' }, { kind: 'socket' }) };
    expectAgree({ rows: room('@KY.'), moves: 'E', glyphs }, (pair) => {
      expect(pair.rig.player.x).toBe(2);
      expect(pair.rig.terrainAt(3, 1)).toBe('water');
      expect(pair.rig.entities.map((e) => e.x)).toEqual([3]);
    });
  });

  it('keeps the red socket for the player alone', () => {
    const redGlyph: Record<string, GlyphMeaning> = { R: device('socket_red') };
    expectAgree({ rows: room('@R.'), moves: 'EE', glyphs: redGlyph }, (pair) => {
      expect(pair.rig.player.x).toBe(3);
    });
    expectAgree({ rows: room('@KR.'), moves: 'E', glyphs: redGlyph }, (pair) => {
      expect(pair.rig.player.x).toBe(1);
    });
  });

  it('is coverage exact', () => {
    expect(EPOXY_COVERAGE.socket.level).toBe('exact');
  });
});

describe('blue teleporter (leaves ahead only)', () => {
  it('sends the player to the previous teleporter in reading order and out ahead', () => {
    expectAgree({ rows: room('@.k..k..'), moves: 'EE' }, (pair) => {
      expect(pair.rig.player.x).toBe(7);
    });
  });

  it('does not turn the player aside when the way ahead is shut', () => {
    expectAgree({ rows: room('@.k..k#', '.......'), moves: 'EE' }, (pair) => {
      expect(pair.rig.player.x).toBe(3);
    });
  });

  it('sends a pushed block out ahead of the target', () => {
    expectAgree({ rows: room('@Kk..k..'), moves: 'EE' }, (pair) => {
      expect(pair.rig.entities.map((e) => e.x)).toEqual([7]);
    });
  });

  it('keeps a pushed block on the entry pad when the way ahead of the target is shut', () => {
    expectAgree({ rows: room('@Kk..k#', '.......'), moves: 'EE' }, (pair) => {
      expect(pair.rig.entities).toHaveLength(1);
    });
  });

  it('sends a monster out ahead of the target', () => {
    const t = playTimeline({ rows: room(SEALED_START, '##.bk..k..'), moves: '', glyphs: BOUNCER });
    expectSameTrail(t, ['5,2', '8,2'], 'k');
  });

  it('falls back to the teleporter before the target when the way ahead of the target is shut', () => {
    // Facing west: the previous pad (x = 5) has a wall ahead, so the one before it (x = 2) takes the player.
    expectAgree({ rows: room('.k.#k..k@'), moves: 'W' }, (pair) => {
      expect(pair.rig.player.x).toBe(1);
    });
  });

  it('does not send a monster out onto the player', () => {
    // The player waits ahead of the last pad: the monster has no other way out, so it walks on from the first pad.
    const t = playTimeline({ rows: room('########', '##.bk..k@.'), moves: '', glyphs: BOUNCER }, '', 40);
    const early = (bodies: readonly string[]): string[] => trailOf(bodies, []).slice(0, 4);
    expect(early(t.cc3d.bodies)).toEqual(['4,2', '5,2', '6,2', '7,2']);
    expect(early(t.epoxy.bodies)).toEqual(early(t.cc3d.bodies));
  });

  it('does not land on a teleporter that holds a block', () => {
    const glyphs: Record<string, GlyphMeaning> = { L: withMob(device('teleport_blue'), { kind: 'block_dirt' }) };
    expectAgree({ rows: room('@.k..L..'), moves: 'EE', glyphs }, (pair) => {
      expect(pair.rig.player.x).toBe(3);
    });
  });

  it('is coverage exact', () => {
    expect(EPOXY_COVERAGE.teleport_blue.level).toBe('exact');
  });
});

describe('red teleporter (ahead, right, left, back)', () => {
  it('sends the player out ahead of the target when it is free', () => {
    expectAgree({ rows: room('@.t..t..'), moves: 'EE' }, (pair) => {
      expect(pair.rig.player.x).toBe(7);
    });
  });

  it('turns right when ahead is shut', () => {
    expectAgree({ rows: room('@.t..t#', '.......'), moves: 'EE' }, (pair) => {
      expect(pair.rig.player.x).toBe(6);
      expect(pair.rig.player.y).toBe(2);
    });
  });

  it('turns left when ahead and right are shut', () => {
    expectAgree({ rows: room('......#', '@.t..t#', '###.###'), moves: 'EE' }, (pair) => {
      expect(pair.rig.player.y).toBe(1);
    });
  });

  it('turns back when ahead, right and left are shut', () => {
    expectAgree({ rows: room('###.###', '@.t..t#', '###.###'), moves: 'EE' }, (pair) => {
      expect(pair.rig.player.x).toBe(5);
    });
  });

  it('tries right before left whichever way the player faces', () => {
    // Entering the upper teleporter from the north, the exit is the lower one: south is a wall, so right (west) comes before left (east).
    expectAgree({ rows: room('...@...', '...t...', '.......', '...t...', '#######'), moves: 'SS' }, (pair) => {
      expect(pair.rig.player.x).toBe(3);
      expect(pair.rig.player.y).toBe(4);
    });
  });

  it('keeps going from the exit it took', () => {
    expectAgree({ rows: room('@.t..t#', '.......', '.......'), moves: 'EEES' }, (pair) => {
      expect(pair.rig.player.y).toBeGreaterThan(1);
    });
  });

  it('sends a pushed block out the same order', () => {
    expectAgree({ rows: room('@Kt..t#', '.......'), moves: 'EE' }, (pair) => {
      expect(pair.rig.entities).toHaveLength(1);
    });
  });

  it('sends a monster out ahead of the target when it is free', () => {
    const t = playTimeline({ rows: room(SEALED_START, '##.bt..t..'), moves: '', glyphs: BOUNCER });
    expectSameTrail(t, ['5,2', '8,2'], 't');
  });

  it('sends a monster out right of the target when ahead is shut', () => {
    const t = playTimeline({ rows: room(SEALED_START, '##.bt..t#', '.........'), moves: '', glyphs: BOUNCER });
    expectSameTrail(t, ['5,2', '8,2'], 't');
  });

  it('falls back to the teleporter before the target when no side of the target is free', () => {
    // Facing west, the previous pad (x = 5) has every side but the back shut here: it is free, so the player leaves backwards.
    expectAgree({ rows: room('.t.#t..t@'), moves: 'W' }, (pair) => {
      expect(pair.rig.player.x).toBe(6);
    });
  });

  it('does not land on a teleporter that holds a block', () => {
    const glyphs: Record<string, GlyphMeaning> = { L: withMob(device('teleport_red'), { kind: 'block_dirt' }) };
    expectAgree({ rows: room('@.t..L..'), moves: 'EE', glyphs }, (pair) => {
      expect(pair.rig.player.x).toBe(3);
    });
  });

  it('is coverage exact', () => {
    expect(EPOXY_COVERAGE.teleport_red.level).toBe('exact');
  });
});
