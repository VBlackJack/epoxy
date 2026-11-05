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
import type { Cc3dColor } from './model';

beforeAll(() => {
  loadTestConfigs();
});

const SETTLE_TICKS = 60;

function plate(color: Cc3dColor): GlyphMeaning {
  return stacked({ kind: 'floor' }, { kind: 'plate', color });
}

function holdDoor(color: Cc3dColor): GlyphMeaning {
  return stacked({ kind: 'floor' }, { kind: 'hold_door', color, open: false });
}

function colourBlock(color: Cc3dColor): GlyphMeaning {
  return { mob: { kind: 'block_color', color } };
}

const doorId = (color: Cc3dColor, open: boolean): string => `cc3d_hold_door_${color}_${open ? 'open' : 'closed'}`;

describe('hold plates and hold doors', () => {
  it.each(['green', 'red'] as const)('[P] a %s door is open only while the player stands on the plate', (color) => {
    const glyphs = { p: plate(color), H: holdDoor(color) };
    const rig = new Cc3dRig(cc3dLevel(['#@p.#', '#H###'], { glyphs }));
    expect(rig.terrainAt(1, 1)).toBe(doorId(color, false));
    rig.walk('E');
    expect(rig.terrainAt(1, 1)).toBe(doorId(color, true));
    rig.walk('E');
    expect(rig.terrainAt(1, 1)).toBe(doorId(color, false));
  });

  it('[P] a hold door opens only while every plate of its colour is pressed', () => {
    const glyphs = { p: plate('blue'), H: holdDoor('blue') };
    const alone = new Cc3dRig(cc3dLevel(['#p@.p#', '#H####'], { glyphs }));
    alone.walk('W');
    expect(alone.player.x).toBe(1);
    expect(alone.terrainAt(1, 1)).toBe(doorId('blue', false));

    const rig = new Cc3dRig(cc3dLevel(['#p@Kp#', '#H####'], { glyphs }));
    rig.walk('E');
    expect(rig.entityAt(4, 0)).toBeDefined();
    expect(rig.terrainAt(1, 1)).toBe(doorId('blue', false));
    rig.walk('W', 'W');
    expect(rig.player.x).toBe(1);
    expect(rig.terrainAt(1, 1)).toBe(doorId('blue', true));
    rig.walk('E');
    expect(rig.terrainAt(1, 1)).toBe(doorId('blue', false));
  });

  it('[P] a dirt block presses a plate', () => {
    const glyphs = { p: plate('green'), H: holdDoor('green') };
    const rig = new Cc3dRig(cc3dLevel(['#@Kp#', '#H###'], { glyphs }));
    rig.walk('E');
    expect(rig.player.x).toBe(2);
    expect(rig.terrainAt(1, 1)).toBe(doorId('green', true));
  });

  it('[P] a green colour block does not press the yellow plate', () => {
    const glyphs = { p: plate('yellow'), H: holdDoor('yellow'), C: colourBlock('green') };
    const rig = new Cc3dRig(cc3dLevel(['#@Cp#', '#H###'], { glyphs }));
    rig.walk('E');
    expect(rig.entityAt(3, 0)?.type).toBe('cc3d_block_green');
    expect(rig.terrainAt(1, 1)).toBe(doorId('yellow', false));
  });

  it('[U] a colour block presses the plate of its own colour', () => {
    const glyphs = { p: plate('green'), H: holdDoor('green'), C: colourBlock('green') };
    const rig = new Cc3dRig(cc3dLevel(['#@Cp#', '#H###'], { glyphs }));
    rig.walk('E');
    expect(rig.terrainAt(1, 1)).toBe(doorId('green', true));
  });

  it('[S] a door closing on the player shuts at once: he may leave, nobody may enter', () => {
    const glyphs = { '@': stacked({ kind: 'floor' }, { kind: 'hold_door', color: 'green', open: true }) };
    const rig = new Cc3dRig(cc3dLevel(['#@.#', '####'], { glyphs }));
    // No plate of the colour: the door is shut as soon as the world updates, with the player in it.
    rig.tick(1);
    expect(rig.terrainAt(1, 0)).toBe(doorId('green', false));
    rig.walk('E');
    expect(rig.player.x).toBe(2);
    rig.walk('W');
    expect(rig.player.x).toBe(2);
  });
});

describe('toggle controls and toggle doors', () => {
  const control = stacked({ kind: 'floor' }, { kind: 'toggle_control', color: 'green' });

  it('[P] every entry flips the doors of its colour, leaving changes nothing', () => {
    const rig = new Cc3dRig(cc3dLevel(['#@c.#', '#Jj##'], { glyphs: { c: control } }));
    expect(rig.terrainAt(1, 1)).toBe('toggle_wall_closed');
    expect(rig.terrainAt(2, 1)).toBe('toggle_wall_open');
    rig.walk('E');
    expect(rig.terrainAt(1, 1)).toBe('toggle_wall_open');
    expect(rig.terrainAt(2, 1)).toBe('toggle_wall_closed');
    rig.walk('E');
    expect(rig.terrainAt(1, 1)).toBe('toggle_wall_open');
    rig.walk('W');
    expect(rig.terrainAt(1, 1)).toBe('toggle_wall_closed');
    expect(rig.terrainAt(2, 1)).toBe('toggle_wall_open');
  });

  it('[P] a dirt block pushed onto a control flips the doors too', () => {
    const rig = new Cc3dRig(cc3dLevel(['#@Kc.#', '#Jj###'], { glyphs: { c: control } }));
    rig.walk('E');
    expect(rig.terrainAt(1, 1)).toBe('toggle_wall_open');
  });

  it('only the doors of the control colour flip', () => {
    const blue = stacked({ kind: 'floor' }, { kind: 'toggle_door', color: 'blue', open: false });
    const rig = new Cc3dRig(cc3dLevel(['#@c.#', '#JB##'], { glyphs: { c: control, B: blue } }));
    rig.walk('E');
    expect(rig.terrainAt(2, 1)).toBe('cc3d_toggle_door_blue_closed');
  });

  it('[S] a toggle door closing on the player shuts at once: he may leave, nobody may enter', () => {
    const glyphs = {
      '@': stacked({ kind: 'floor' }, { kind: 'toggle_door', color: 'green', open: true }),
      B: { stack: [{ kind: 'force' as const, dir: 'E' as const }], mob: { kind: 'block_dirt' as const } },
      c: control
    };
    const rig = new Cc3dRig(cc3dLevel(['#@.B>c#'], { glyphs }));
    rig.afterTick(3);
    expect(rig.entityAt(5, 0)).toBeDefined();
    expect(rig.terrainAt(1, 0)).toBe('toggle_wall_closed');
    rig.walk('E');
    expect(rig.player.x).toBe(2);
    rig.walk('W');
    expect(rig.player.x).toBe(2);
  });
});

describe('entry devices under a key door', () => {
  const shooterEast: GlyphMeaning = { mob: { kind: 'laser_shooter', dir: 'E' } };
  const golem: GlyphMeaning = { mob: { kind: 'golem_yellow', dir: 'E' } };

  it('[S] a toggle control under a red door flips the red doors once, when the door is opened', () => {
    const covered = stacked({ kind: 'floor' }, { kind: 'toggle_control', color: 'red' }, { kind: 'door', color: 'red' });
    const closed = stacked({ kind: 'floor' }, { kind: 'toggle_door', color: 'red', open: false });
    const open = stacked({ kind: 'floor' }, { kind: 'toggle_door', color: 'red', open: true });
    const rig = new Cc3dRig(cc3dLevel(['#@rc.#', '#BA###'], { glyphs: { c: covered, B: closed, A: open } }));
    expect(rig.terrainAt(1, 1)).toBe('cc3d_toggle_door_red_closed');
    expect(rig.terrainAt(2, 1)).toBe('cc3d_toggle_door_red_open');
    rig.walk('E');
    expect(rig.terrainAt(1, 1)).toBe('cc3d_toggle_door_red_closed');
    rig.walk('E');
    expect(rig.player.x).toBe(3);
    expect(rig.terrainAt(3, 0)).toBe('cc3d_toggle_control_red');
    expect(rig.terrainAt(1, 1)).toBe('cc3d_toggle_door_red_open');
    expect(rig.terrainAt(2, 1)).toBe('cc3d_toggle_door_red_closed');
    rig.tick(SETTLE_TICKS);
    expect(rig.terrainAt(1, 1)).toBe('cc3d_toggle_door_red_open');
    expect(rig.terrainAt(2, 1)).toBe('cc3d_toggle_door_red_closed');
  });

  it('[S] a laser controller under a green door fires the shooter when the door is opened', () => {
    const covered = stacked({ kind: 'floor' }, { kind: 'laser_controller' }, { kind: 'door', color: 'green' });
    const rig = new Cc3dRig(cc3dLevel(['#@gcS.!#'], { glyphs: { c: covered, S: shooterEast, '!': golem } }));
    rig.walk('E');
    rig.tick(SETTLE_TICKS);
    expect(rig.entities.some((e) => e.type === 'cc3d_golem_yellow')).toBe(true);
    rig.walk('E');
    rig.tick(SETTLE_TICKS);
    expect(rig.player.x).toBe(3);
    expect(rig.entities.some((e) => e.type === 'cc3d_golem_yellow')).toBe(false);
  });
});

describe('traps and trap controls [U]', () => {
  const trap = stacked({ kind: 'floor' }, { kind: 'trap' });
  const control = stacked({ kind: 'floor' }, { kind: 'trap_control' });
  const pressed: GlyphMeaning = { stack: [{ kind: 'floor' }, { kind: 'trap_control' }], mob: { kind: 'block_dirt' } };

  it('holds what enters until the control is pressed', () => {
    const rig = new Cc3dRig(cc3dLevel(['#@x.q#'], { glyphs: { x: trap, q: control } }));
    rig.walk('E', 'E');
    expect(rig.player.x).toBe(2);
  });

  it('lets go once the control is pressed', () => {
    const rig = new Cc3dRig(cc3dLevel(['#@x.Y#'], { glyphs: { x: trap, Y: pressed } }));
    rig.walk('E', 'E', 'E');
    expect(rig.player.x).toBe(3);
  });

  it('a control works the next trap after it in reading order, wrapping to the first', () => {
    const rows = ['#@x#', '#.#.', '#x.#', '#Y.#'];
    const rig = new Cc3dRig(cc3dLevel(rows, { glyphs: { x: trap, Y: { ...pressed } } }));
    // The control (row 3) has no trap after it: it wraps to the first trap (row 0), which is open.
    rig.walk('E', 'W');
    expect(rig.player.x).toBe(1);
  });

  it('[P] in the observed layout the first control opens the second trap and not the first', () => {
    const holder = (dir: 'E' | 'W'): GlyphMeaning => ({ stack: [{ kind: 'floor' }, { kind: 'trap' }], mob: { kind: 'bouncer', dir } });
    const rows = [
      '##########',
      '#.....u..#',
      '#........#',
      '#........#',
      '#...@q.q.#',
      '#........#',
      '#.......v#',
      '##########'
    ];
    const rig = new Cc3dRig(cc3dLevel(rows, { glyphs: { u: holder('E'), v: holder('W'), q: control } }));
    rig.walk('E');
    rig.tick(8);
    expect(rig.entityAt(8, 6)).toBeUndefined();
    expect(rig.entities.some((e) => e.y === 6 && e.x < 8)).toBe(true);
    expect(rig.entityAt(6, 1)).toBeDefined();
    expect(rig.entityAt(7, 1)).toBeUndefined();
    // The second control alone opens the same trap.
    const second = new Cc3dRig(cc3dLevel(rows.map((r) => r.replace('...@q.q.', '....q@q.')), { glyphs: { u: holder('E'), v: holder('W'), q: control } }));
    second.walk('E');
    second.tick(8);
    expect(second.entities.some((e) => e.y === 6 && e.x < 8)).toBe(true);
    expect(second.entityAt(6, 1)).toBeDefined();
  });

  it('[U] a control after the last trap works the first one, and an unworked trap stays closed', () => {
    const held: GlyphMeaning = { stack: [{ kind: 'floor' }, { kind: 'trap' }], mob: { kind: 'bouncer', dir: 'E' } };
    const rig = new Cc3dRig(cc3dLevel(['#z.z.Y#', '#######', '#@#####'], { glyphs: { z: held, Y: pressed } }));
    rig.tick(1);
    expect(rig.entityAt(1, 0)).toBeUndefined();
    expect(rig.entityAt(2, 0)).toBeDefined();
    rig.tick(SETTLE_TICKS);
    expect(rig.entityAt(3, 0)).toBeDefined();
  });

  it('[U] several controls work one trap, which is open while any of them is pressed', () => {
    const held: GlyphMeaning = { stack: [{ kind: 'floor' }, { kind: 'trap' }], mob: { kind: 'bouncer', dir: 'E' } };
    const none = new Cc3dRig(cc3dLevel(['#q.q.z.##', '#########', '#@#######'], { glyphs: { z: held, q: control } }));
    none.tick(SETTLE_TICKS);
    expect(none.entityAt(5, 0)).toBeDefined();
    const one = new Cc3dRig(cc3dLevel(['#Y.q.z.##', '#########', '#@#######'], { glyphs: { z: held, q: control, Y: pressed } }));
    one.tick(1);
    expect(one.entityAt(5, 0)).toBeUndefined();
  });

  it('holds a monster that starts in a closed trap', () => {
    const held: GlyphMeaning = { stack: [{ kind: 'floor' }, { kind: 'trap' }], mob: { kind: 'bouncer', dir: 'E' } };
    const closed = new Cc3dRig(cc3dLevel(['#@z.q#'], { glyphs: { z: held, q: control } }));
    closed.tick(SETTLE_TICKS);
    expect(closed.entityAt(2, 0)).toBeDefined();
    const open = new Cc3dRig(cc3dLevel(['#@z.Y#'], { glyphs: { z: held, Y: pressed } }));
    open.tick(1);
    expect(open.entityAt(2, 0)).toBeUndefined();
  });
});

describe('clone machines and switches [U]', () => {
  const machine = (dir: 'E' | 'S'): GlyphMeaning => ({
    stack: [{ kind: 'floor' }, { kind: 'clone_machine', dir }],
    mob: { kind: 'block_ice', dir }
  });
  const sw = stacked({ kind: 'floor' }, { kind: 'clone_switch' });

  it('releases the template and leaves a copy on the machine', () => {
    const rig = new Cc3dRig(cc3dLevel(['#@bm..#'], { glyphs: { b: sw, m: machine('E') } }));
    rig.walk('E');
    rig.tick(SETTLE_TICKS);
    expect(rig.entityAt(4, 0)?.type).toBe('ice_block');
    expect(rig.entityAt(3, 0)).toBeDefined();
    expect(rig.entities).toHaveLength(2);
  });

  it('works a machine on the very first cell of the map (index 0)', () => {
    const rig = new Cc3dRig(cc3dLevel(['m.b@..', '......'], { glyphs: { b: sw, m: machine('S') } }));
    rig.walk('W');
    rig.tick(SETTLE_TICKS);
    expect(rig.entityAt(0, 1)?.type).toBe('ice_block');
    expect(rig.entities).toHaveLength(2);
  });

  it('the copy waiting on the machine cannot be pushed away', () => {
    const rig = new Cc3dRig(cc3dLevel(['#@bm..#'], { glyphs: { b: sw, m: machine('E') } }));
    rig.walk('E');
    rig.tick(SETTLE_TICKS);
    rig.walk('E');
    expect(rig.player.x).toBe(2);
  });

  it('fails silently when the way out is blocked', () => {
    const rig = new Cc3dRig(cc3dLevel(['#@bmZ#'], { glyphs: { b: sw, m: machine('E') } }));
    rig.walk('E');
    rig.tick(SETTLE_TICKS);
    expect(rig.entities).toHaveLength(2);
    expect(rig.player.alive).toBe(true);
  });

  it('works the machine nearest to the switch', () => {
    const rows = ['#######', '#m.@bm#', '#.###.#'];
    const rig = new Cc3dRig(cc3dLevel(rows, { glyphs: { b: sw, m: machine('S') } }));
    rig.walk('E');
    rig.tick(SETTLE_TICKS);
    expect(rig.entityAt(5, 2)).toBeDefined();
    expect(rig.entityAt(1, 2)).toBeUndefined();
  });
});

describe('blue golem and its control', () => {
  const golem: GlyphMeaning = { mob: { kind: 'golem_blue', dir: 'E' } };
  const control = stacked({ kind: 'floor' }, { kind: 'golem_control_blue' });

  it('walks straight on and stops at the wall', () => {
    const rig = new Cc3dRig(cc3dLevel(['#G...#', '#@.b.#'], { glyphs: { G: golem, b: control } }));
    rig.tick(SETTLE_TICKS);
    expect(rig.entities[0].x).toBe(4);
  });

  it('reverses when the control is entered', () => {
    const rig = new Cc3dRig(cc3dLevel(['#G...#', '#@.b.#'], { glyphs: { G: golem, b: control } }));
    rig.walk('E', 'E');
    rig.tick(SETTLE_TICKS);
    expect(rig.entities[0].x).toBe(1);
  });
});

describe('sockets with no FISH on the map', () => {
  it('[P] are open from the start', () => {
    const blue = new Cc3dRig(cc3dLevel(['#@S.#']));
    blue.walk('E');
    expect(blue.player.x).toBe(2);
    const red = new Cc3dRig(cc3dLevel(['#@S.#'], { glyphs: { S: stacked({ kind: 'floor' }, { kind: 'socket_red' }) } }));
    red.walk('E');
    expect(red.player.x).toBe(2);
  });
});
