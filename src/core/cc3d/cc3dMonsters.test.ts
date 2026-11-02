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

vi.mock('../../audio/AudioManager', () => ({
  AudioManager: { playSfx: vi.fn(), playStep: vi.fn() }
}));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { cc3dLevel, stacked } from './cc3dTestMaps';
import type { GlyphMeaning } from './cc3dTestMaps';
import { Cc3dRig } from './cc3dTestRig';
import type { Cc3dMobKind } from './model';

beforeAll(() => {
  loadTestConfigs();
});

const SETTLE_TICKS = 60;

/** A level with the player walled in far away, so only the monster moves. */
function arena(rows: string[], kind: Cc3dMobKind, extra: Record<string, GlyphMeaning> = {}): Cc3dRig {
  const width = Math.max(...rows.map((r) => r.length));
  const all = [...rows, '#'.repeat(width), '#@#'].map((r) => r.padEnd(width, '#'));
  return new Cc3dRig(cc3dLevel(all, { glyphs: { M: { mob: { kind, dir: 'E' } }, ...extra } }));
}

const ROOM = ['#####', '#...#', '#.M##', '#...#', '#####'];

describe('preference lists [U]', () => {
  it.each<[Cc3dMobKind, number, number]>([
    ['blinky', 2, 1],
    ['baby_blinky', 2, 1],
    ['limpa', 2, 1],
    ['limpy', 2, 3],
    ['screamer', 2, 3],
    ['baby_screamer', 2, 3],
    ['bouncer', 1, 2]
  ])('%s with the way ahead shut goes to (%i, %i)', (kind, x, y) => {
    const rig = arena(ROOM, kind);
    rig.tick(1);
    expect(rig.entities[0]).toMatchObject({ x, y });
  });

  it('goes straight on when the way is open (blinky, bouncer, screamer, walker, golem)', () => {
    for (const kind of ['blinky', 'bouncer', 'screamer', 'walker', 'golem_blue'] as const) {
      const rig = arena(['#M..#'], kind);
      rig.tick(1);
      expect(rig.entities[0].x).toBe(2);
    }
  });

  it('limpa takes the left before straight on, limpy the right', () => {
    const open = ['#####', '#...#', '#.M.#', '#...#', '#####'];
    const limpa = arena(open, 'limpa');
    limpa.tick(1);
    expect(limpa.entities[0]).toMatchObject({ x: 2, y: 1 });
    const limpy = arena(open, 'limpy');
    limpy.tick(1);
    expect(limpy.entities[0]).toMatchObject({ x: 2, y: 3 });
  });

  it('a walker goes straight on, then draws a direction when blocked', () => {
    const rig = arena(['#M..#'], 'walker');
    rig.afterTick(4);
    expect(rig.entities[0].x).toBe(3);
    rig.tick(SETTLE_TICKS);
    expect(rig.entities[0].x).toBeGreaterThanOrEqual(1);
    expect(rig.entities[0].x).toBeLessThanOrEqual(3);
  });

  it('walks one cell per four ticks', () => {
    const rig = arena(['#M....#'], 'bouncer');
    rig.afterTick(0);
    expect(rig.entities[0].x).toBe(2);
    expect(rig.entities[0].cooldownTicks).toBe(3);
    rig.afterTick(4);
    expect(rig.entities[0].x).toBe(3);
  });
});

describe('terrain per monster [U genre default]', () => {
  it.each(['G', 'A', 'D', 'L', 'X', 'N', 'n', 'i', 'e', 'r', 'a', 's'])('no monster enters terrain or items %s [S]', (glyph) => {
    for (const kind of ['bouncer', 'blinky', 'screamer'] as const) {
      const rig = arena([`#M${glyph}.#`], kind);
      rig.tick(SETTLE_TICKS);
      expect(rig.entities[0].x).toBeLessThan(2);
    }
  });

  it('only blinkies enter water, and they survive it', () => {
    const bouncer = arena(['#MW.#'], 'bouncer');
    bouncer.tick(8);
    expect(bouncer.entities[0].x).toBe(1);
    for (const kind of ['blinky', 'baby_blinky'] as const) {
      const rig = arena(['#MW.#'], kind);
      rig.tick(1);
      expect(rig.entities[0].x).toBe(2);
      expect(rig.terrainAt(2, 0)).toBe('water');
    }
  });

  it('only screamers enter fire', () => {
    const blinky = arena(['#MF.#'], 'blinky');
    blinky.tick(8);
    expect(blinky.entities[0].x).toBe(1);
    for (const kind of ['screamer', 'baby_screamer'] as const) {
      const rig = arena(['#MF.#'], kind);
      rig.tick(1);
      expect(rig.entities[0].x).toBe(2);
    }
  });

  it('a blinky is not carried by ice, a bouncer slides', () => {
    const blinky = arena(['#M.II..#'], 'blinky');
    blinky.afterTick(12);
    expect(blinky.entities[0].x).toBe(5);
    const bouncer = arena(['#M.II..#'], 'bouncer');
    bouncer.afterTick(12);
    expect(bouncer.entities[0].x).toBe(6);
  });

  it('a screamer melts an ice block it touches', () => {
    const rig = arena(['#MZ.#'], 'screamer');
    rig.tick(1);
    expect(rig.entities.filter((e) => e.type === 'ice_block')).toHaveLength(0);
  });

  it('a block cannot be pushed into a monster', () => {
    const rig = new Cc3dRig(cc3dLevel(['#@KM#'], { glyphs: { M: { mob: { kind: 'bouncer', dir: 'E' } } } }));
    rig.walk('E');
    expect(rig.player.x).toBe(1);
  });
});

describe('plates and monsters [U]', () => {
  const stuck = (kind: Cc3dMobKind): GlyphMeaning => ({
    stack: [{ kind: 'floor' }, { kind: 'plate', color: 'blue' }],
    mob: { kind, dir: 'E' }
  });
  const door = stacked({ kind: 'floor' }, { kind: 'hold_door', color: 'blue', open: false });

  it('a monster at rest on a plate presses it, a blinky does not', () => {
    const pressing = new Cc3dRig(cc3dLevel(['###', '#z#', '#H#', '#@#'], { glyphs: { z: stuck('bouncer'), H: door } }));
    pressing.tick(2);
    expect(pressing.terrainAt(1, 2)).toBe('cc3d_hold_door_blue_open');
    const blinky = new Cc3dRig(cc3dLevel(['###', '#z#', '#H#', '#@#'], { glyphs: { z: stuck('blinky'), H: door } }));
    blinky.tick(2);
    expect(blinky.terrainAt(1, 2)).toBe('cc3d_hold_door_blue_closed');
  });
});

describe('contact', () => {
  it('a monster walking into the player kills him', () => {
    const rig = new Cc3dRig(cc3dLevel(['#M..@#'], { glyphs: { M: { mob: { kind: 'bouncer', dir: 'E' } } } }));
    rig.tick(20);
    expect(rig.player.alive).toBe(false);
    expect(rig.player.deathReasonKey).toBe('hud.messages.death_monster');
  });

  it('the player and a monster walking into each other both meet', () => {
    const rig = new Cc3dRig(cc3dLevel(['#M...@#'], { glyphs: { M: { mob: { kind: 'bouncer', dir: 'E' } } } }));
    rig.hold('W');
    rig.tick(30);
    expect(rig.player.alive).toBe(false);
  });
});
