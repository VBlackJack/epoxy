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
import { device, playTimeline, room, withMob } from './cc3dEvidenceRig';
import type { EvidenceTimeline } from './cc3dEvidenceRig';
import type { GlyphMeaning } from './cc3dTestMaps';
import type { Cc3dMobKind } from './model';

/**
 * Coverage evidence for the monsters that have an Epoxy monster of their own: each case plays a tiny CC3D map with
 * one monster and a player sealed in a corner (so that only the monster moves) on the CC3D engine and on its
 * conversion, and compares what the two went through, collapsed to the changes so that pace does not count. The
 * CC3D side is also read, so that a case that agrees proves the rule was exercised.
 */

beforeEach(() => {
  loadTestConfigs();
});

/** The monsters whose path is decided by rule alone, with the Epoxy entity each one becomes (the same name). */
const RULE_MONSTERS: readonly Cc3dMobKind[] = [
  'bouncer', 'blinky', 'baby_blinky', 'limpy', 'limpa', 'legs_green', 'legs_red', 'screamer', 'baby_screamer', 'snappy', 'nibble'
];
/** The monsters that roam the corridor scenarios: snappy chases the sealed player, away from the hazards. */
const ROAMERS: readonly Cc3dMobKind[] = RULE_MONSTERS.filter((kind) => kind !== 'snappy');
/** Immune to water: they enter it. */
const WATER_WALKERS: readonly Cc3dMobKind[] = ['blinky', 'baby_blinky'];
/** Immune to fire: they enter it. */
const FIRE_WALKERS: readonly Cc3dMobKind[] = ['screamer', 'baby_screamer'];
/** Melt the ice blocks they meet. */
const ICE_MELTERS: readonly Cc3dMobKind[] = ['screamer', 'baby_screamer'];
/** Press no plate and work no switch. */
const NON_PRESSERS: readonly Cc3dMobKind[] = ['blinky', 'screamer'];
/** The column of the hazard in the corridor scenarios. */
const HAZARD_X = 8;
/** States both timelines must have gone through before a prefix comparison counts as proof. */
const MIN_SHARED_STATES = 40;

const STARTING_DIR = 'E';

function glyphsOf(kind: Cc3dMobKind): Record<string, GlyphMeaning> {
  return {
    m: withMob(device('floor'), { kind, dir: STARTING_DIR }),
    c: device('toggle_control', { color: 'green' })
  };
}

/** A room with the player sealed in the corner, three rows of floor and the given hazard glyph in column 8. */
function strip(glyph: string, extra: Partial<Record<'top' | 'middle' | 'bottom', string>> = {}): string[] {
  const fill = (cell: string): string => `##.....${cell}..`;
  return room('@#########', extra.top ?? fill(glyph), extra.middle ?? `##m....${glyph}..`, extra.bottom ?? fill(glyph));
}

const MAZE = room('@#########', '##.......#', '##.#.##.##', '##m......#', '##.##.#.##', '##.......#');

function timelineOf(kind: Cc3dMobKind, rows: string[]): EvidenceTimeline {
  return playTimeline({ rows, moves: '', glyphs: glyphsOf(kind) });
}

/** The cells (as columns) of a type in a list of collapsed frames. */
function columnsVisited(frames: readonly string[], type: string): Set<number> {
  const found = new Set<number>();
  for (const frame of frames) {
    for (const match of frame.matchAll(new RegExp(`${type}@(\\d+),\\d+`, 'g'))) found.add(Number(match[1]));
  }
  return found;
}

/** The shorter timeline is the start of the longer one: the same states in the same order, one engine further on. */
function expectSharedPrefix(t: EvidenceTimeline, minStates = MIN_SHARED_STATES): void {
  for (const field of ['bodies', 'terrain'] as const) {
    const shared = Math.min(t.cc3d[field].length, t.epoxy[field].length);
    expect(t.epoxy[field].slice(0, shared)).toEqual(t.cc3d[field].slice(0, shared));
  }
  expect(Math.min(t.cc3d.bodies.length, t.epoxy.bodies.length)).toBeGreaterThanOrEqual(minStates);
}

describe('the path of each monster', () => {
  it.each(RULE_MONSTERS.filter((kind) => kind !== 'snappy' && kind !== 'nibble'))('%s goes through the same cells of a maze as in CC3D', (kind) => {
    const t = timelineOf(kind, MAZE);
    expect(t.sameSequence).toBe(true);
    // The monster really walked: many different cells were visited.
    expect(t.cc3d.bodies.length).toBeGreaterThanOrEqual(MIN_SHARED_STATES);
  });

  it('differs between the monsters: the same maze gives each turn order its own walk', () => {
    const walks = new Set(
      (['bouncer', 'limpy', 'limpa', 'screamer', 'blinky'] as Cc3dMobKind[]).map((kind) => JSON.stringify(timelineOf(kind, MAZE).cc3d.bodies))
    );
    expect(walks.size).toBe(5);
  });
});

describe('hazards and terrain the monsters refuse or enter', () => {
  const cases: Array<{ name: string; glyph: string; enters: (kind: Cc3dMobKind) => boolean }> = [
    { name: 'water', glyph: 'W', enters: (kind) => WATER_WALKERS.includes(kind) },
    { name: 'fire', glyph: 'F', enters: (kind) => FIRE_WALKERS.includes(kind) },
    { name: 'slime', glyph: 'L', enters: () => false },
    { name: 'dirt', glyph: 'D', enters: () => false },
    { name: 'gravel', glyph: 'G', enters: () => false },
    { name: 'sand', glyph: 'A', enters: () => false },
    { name: 'the exit', glyph: 'X', enters: () => false },
    { name: 'a turtle', glyph: 'T', enters: () => true }
  ];

  for (const { name, glyph, enters } of cases) {
    it.each(ROAMERS)(`%s meets ${name} as in CC3D`, (kind) => {
      const t = timelineOf(kind, strip(glyph));
      expect(t.sameSequence).toBe(true);
      expect(columnsVisited(t.cc3d.bodies, kind).has(HAZARD_X)).toBe(enters(kind));
      expect(columnsVisited(t.epoxy.bodies, kind).has(HAZARD_X)).toBe(enters(kind));
    });
  }

  it.each(ROAMERS)('%s refuses both security gates and cells holding an item, as in CC3D', (kind) => {
    for (const rows of [strip('N', { middle: '##m....n..' }), strip('i', { middle: '##m....r..', bottom: '##.....o..' })]) {
      const t = timelineOf(kind, rows);
      expect(t.sameSequence).toBe(true);
      expect(columnsVisited(t.cc3d.bodies, kind).has(HAZARD_X)).toBe(false);
    }
  });

  it.each(ROAMERS)('%s sets off a bomb and is gone with it, in CC3D and in Epoxy', (kind) => {
    const t = timelineOf(kind, strip('O'));
    expect(t.sameFinal).toBe(true);
    expect(t.cc3d.final).not.toContain(kind);
    expect(t.epoxy.final).not.toContain(kind);
    expect(t.cc3d.final).not.toContain('bomb');
  });

  it.each(ROAMERS)('%s sinks the turtle it leaves unless it is a blinky, as in CC3D', (kind) => {
    const t = timelineOf(kind, strip('T'));
    expect(t.sameSequence).toBe(true);
    const sinks = !WATER_WALKERS.includes(kind);
    expect(t.cc3d.terrain.some((frame) => frame.includes('water'))).toBe(sinks);
    expect(t.epoxy.terrain.some((frame) => frame.includes('water'))).toBe(sinks);
  });
});

describe('ice and force floors', () => {
  /** The random force floor pushes the monster into a wall, where it stays: its walk is short. */
  const SHORT_WALK_STATES = 8;
  const floors = [
    { name: 'ice', glyph: 'I', minStates: MIN_SHARED_STATES },
    { name: 'force floors', glyph: '>', minStates: MIN_SHARED_STATES },
    { name: 'the random force floor', glyph: '?', minStates: SHORT_WALK_STATES }
  ];
  for (const { name, glyph, minStates } of floors) {
    it.each(RULE_MONSTERS.filter((kind) => kind !== 'snappy' && kind !== 'nibble'))(`%s crosses ${name} through the same cells as in CC3D`, (kind) => {
      const t = timelineOf(kind, strip(glyph));
      // Entering ice or a force floor is a fast step in CC3D, so CC3D is further on in the same time: the same path.
      expectSharedPrefix(t, minStates);
      expect(columnsVisited(t.cc3d.bodies, kind).has(HAZARD_X)).toBe(true);
    });
  }

  it.each(['snappy', 'nibble'] as Cc3dMobKind[])('%s crosses ice and force floors as in CC3D', (kind) => {
    for (const glyph of ['I', '>']) {
      const t = timelineOf(kind, strip(glyph));
      expect(t.sameSequence).toBe(true);
    }
  });
});

describe('ice blocks', () => {
  const rows = room('@#########', '##..Z.....', '##m.......', '##.....Z..');

  it.each(ROAMERS)('%s melts the ice blocks in its way if it is a screamer, and is stopped by them if not, as in CC3D', (kind) => {
    const t = timelineOf(kind, rows);
    expectSharedPrefixOrSame(t);
    const melts = ICE_MELTERS.includes(kind);
    expect(t.cc3d.terrain.some((frame) => frame.includes('water'))).toBe(melts);
    expect(t.epoxy.terrain.some((frame) => frame.includes('water'))).toBe(melts);
  });
});

/** Same states, or (the pace of the two engines differing) one a prefix of the other. */
function expectSharedPrefixOrSame(t: EvidenceTimeline): void {
  for (const field of ['bodies', 'terrain'] as const) {
    const shared = Math.min(t.cc3d[field].length, t.epoxy[field].length);
    expect(t.epoxy[field].slice(0, shared)).toEqual(t.cc3d[field].slice(0, shared));
  }
}

describe('switches', () => {
  const rows = room('@##########', '##m..c..J..');

  it.each(ROAMERS)('%s works a toggle control as in CC3D, and the blinky and the screamer do not', (kind) => {
    const t = timelineOf(kind, rows);
    expect(t.sameSequence).toBe(true);
    const toggles = !NON_PRESSERS.includes(kind);
    // One terrain state when nothing was worked, several when the control was.
    expect(t.cc3d.terrain.length > 1).toBe(toggles);
    expect(t.epoxy.terrain.length > 1).toBe(toggles);
  });
});

describe('snappy and nibble', () => {
  const open = ['@......', '.......', '...m...', '.......', '.......'];

  it('nibble keeps away from a player it cannot reach and snappy waits when blocked on the line of the player', () => {
    const fleeing = timelineOf('nibble', room(...open));
    expect(fleeing.sameSequence).toBe(true);
    expect(fleeing.cc3d.bodies.length).toBeGreaterThan(2);
    const aligned = timelineOf('snappy', room('@......', '#......', 'm......'));
    expect(aligned.sameSequence).toBe(true);
    // Lined up with the player on a column and blocked by a wall: it waits, so nothing ever changes.
    expect(aligned.cc3d.bodies).toHaveLength(1);
  });

  it('chase and flee go round an obstacle only when not lined up with the player, and keep out of water', () => {
    const wall = ['@..#...', '...#...', '...#m..', '.......', '.......'];
    const water = ['@..W...', '...W...', '...Wm..', '.......', '.......'];
    for (const [kind, rows] of [['snappy', wall], ['nibble', wall], ['snappy', water]] as Array<[Cc3dMobKind, string[]]>) {
      const t = timelineOf(kind, room(...rows));
      expect(t.sameSequence).toBe(true);
    }
  });

  it('differs once snappy reaches the player: CC3D leaves it next to him, Epoxy puts it on his cell', () => {
    const t = timelineOf('snappy', room(...open));
    expect(t.cc3d.final).toContain('x');
    expect(t.epoxy.final).toContain('x');
    // Everything before the last state is the same walk.
    expect(t.epoxy.bodies.slice(0, -1)).toEqual(t.cc3d.bodies.slice(0, -1));
    expect(t.epoxy.bodies.at(-1)).not.toEqual(t.cc3d.bodies.at(-1));
  });
});

describe('the omni', () => {
  it('walks a corridor it cannot leave and leaves a trail of slime only once it has stood on slime', () => {
    const plain = timelineOf('omni', room('@#####', '##m.###'));
    expect(plain.sameSequence).toBe(true);
    expect(plain.cc3d.terrain).toHaveLength(1);
    const slimed = timelineOf('omni', room('@#####', '##mL###'));
    expect(slimed.sameSequence).toBe(true);
    expect(slimed.cc3d.terrain.length).toBeGreaterThan(1);
    expect(slimed.cc3d.terrain.at(-1)).toContain('slime');
    // The trail Epoxy leaves is slime_3d, the tile that lets a player with both orbs through.
    expect(slimed.epoxy.terrain.at(-1)).toContain('slime_3d');
    expect(slimed.cc3d.bodies.length).toBeGreaterThan(4);
  });

  it('refuses water and is not killed by slime, in CC3D and in Epoxy', () => {
    const t = timelineOf('omni', room('@#####', '##mL###'));
    expect(t.cc3d.final).toContain('omni');
    expect(t.epoxy.final).toContain('omni');
    const refused = timelineOf('omni', room('@#####', '##mW###'));
    expect(refused.sameSequence).toBe(true);
    expect(refused.cc3d.bodies).toHaveLength(1);
  });
});

describe('the walker', () => {
  /** A one-cell-wide corridor: whatever the walker draws when blocked, its path is fixed. */
  const corridor = (glyph: string): string[] => room('@#########', `##m....${glyph}..`);

  it.each([
    ['water', 'W', false],
    ['fire', 'F', false],
    ['slime', 'L', false],
    ['dirt', 'D', false],
    ['gravel', 'G', false],
    ['sand', 'A', false],
    ['the exit', 'X', false],
    ['a turtle', 'T', true]
  ] as Array<[string, string, boolean]>)('meets %s as in CC3D', (_name, glyph, enters) => {
    const t = timelineOf('walker', corridor(glyph));
    expect(t.sameSequence).toBe(true);
    expect(columnsVisited(t.cc3d.bodies, 'walker_3d').has(HAZARD_X)).toBe(enters);
    expect(columnsVisited(t.epoxy.bodies, 'walker_3d').has(HAZARD_X)).toBe(enters);
  });

  it('goes straight on to the end of a corridor and comes back, as in CC3D', () => {
    const t = timelineOf('walker', room('@#########', '##m.......'));
    // The draws at the ends differ in length between the engines: one is a state or two further on, the same path.
    expectSharedPrefix(t);
  });

  it('sets off a bomb and sinks the turtle it leaves, as in CC3D', () => {
    const bomb = timelineOf('walker', corridor('O'));
    expect(bomb.sameFinal).toBe(true);
    expect(bomb.epoxy.final).not.toContain('walker_3d');
    const turtle = timelineOf('walker', corridor('T'));
    expect(turtle.cc3d.terrain.some((frame) => frame.includes('water'))).toBe(true);
    expect(turtle.epoxy.terrain.some((frame) => frame.includes('water'))).toBe(true);
  });

  it('works a toggle control as in CC3D', () => {
    const t = timelineOf('walker', room('@##########', '##m..c..J..'));
    expect(t.sameSequence).toBe(true);
    expect(t.cc3d.terrain.length).toBeGreaterThan(1);
  });
});

describe('what stays approximate', () => {
  it('keeps the walker, the omni and both legs approximate, each reason citing this file', () => {
    for (const key of ['walker', 'omni', 'legs_green', 'legs_red']) {
      expect(EPOXY_COVERAGE[key].level, key).toBe('approx');
      expect(EPOXY_COVERAGE[key].reason, key).toContain('cc3dEvidenceMonsters.test.ts');
    }
  });

  it('plays the other CC3D monsters as CC3D does, each reason citing this file', () => {
    for (const key of ['bouncer', 'blinky', 'baby_blinky', 'limpy', 'limpa', 'screamer', 'baby_screamer', 'snappy', 'nibble']) {
      expect(EPOXY_COVERAGE[key].level, key).toBe('exact');
      expect(EPOXY_COVERAGE[key].reason, key).toContain('cc3dEvidenceMonsters.test.ts');
    }
  });

  it('defines every one of these monsters as an Epoxy-only monster of its own that steps in four ticks', () => {
    for (const kind of [...RULE_MONSTERS, 'omni'] as Cc3dMobKind[]) {
      const def = ConfigRegistry.getEntityDef(kind);
      expect(def?.kind, kind).toBe('monster');
      expect(def?.epoxyOnly, kind).toBe(true);
      const slow = kind === 'omni' || kind === 'snappy' || kind === 'nibble';
      // A step lasts interval + 1 ticks: four for the CC3D normal step, eight for the omni and for snappy and nibble.
      expect((def?.moveIntervalTicks ?? 0) + 1, kind).toBe(slow ? 8 : 4);
    }
  });
});
