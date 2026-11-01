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

vi.mock('../../../audio/AudioManager', () => ({
  AudioManager: { playSfx: vi.fn() }
}));

import { loadTestConfigs } from '../../../test/loadTestConfigs';
import { lynxLevel, monster } from '../lynxTestMaps';
import { LynxRig } from '../lynxTestRig';

beforeAll(() => {
  loadTestConfigs();
});

const BLUE_MAP = ['########', '#@K#####', '########', '#......#', '########'];
const BLUE_GLYPHS = { K: 'button_blue' };

describe('G. buttons, traps, clone machines', () => {
  it('E11 and G1 flip the toggle walls, for Chip and for a monster', () => {
    const glyphs = { k: 'button_green', o: 'toggle_wall_open', c: 'toggle_wall_closed' };
    const chip = new LynxRig(lynxLevel(['#######', '#@k.oc#', '#######'], { glyphs }));
    chip.press('E');
    chip.afterTick(3);
    expect(chip.engine.getTerrain()[1][4]).toBe('toggle_wall_closed');
    expect(chip.engine.getTerrain()[1][5]).toBe('toggle_wall_open');
    expect(chip.sounds).toContain('button');

    const ball = new LynxRig(
      lynxLevel(['#######', '#.k.oc#', '#######', '#@#'], { glyphs, entities: [monster('pink_ball', 1, 1, 'E')] })
    );
    ball.afterTick(2);
    expect(ball.engine.getTerrain()[1][4]).toBe('toggle_wall_open');
    ball.afterTick(3);
    expect(ball.engine.getTerrain()[1][4]).toBe('toggle_wall_closed');
    expect(ball.engine.getTerrain()[1][5]).toBe('toggle_wall_open');
  });

  it('G2 turns a synchronised tank around at the start of the next tick', () => {
    const rig = new LynxRig(lynxLevel(BLUE_MAP, { glyphs: BLUE_GLYPHS, entities: [monster('tank', 1, 3, 'E')] }));
    rig.press('E');
    rig.afterTick(3);
    expect(rig.player.x).toBe(2);
    expect(rig.entityAt(2, 3)).toBeDefined();
    rig.afterTick(4);
    expect(rig.entityAt(1, 3)).toMatchObject({ type: 'tank', dir: 'W' });
  });

  it('G3 ignores a tank that is mid-step when the turn comes', () => {
    const rig = new LynxRig(lynxLevel(BLUE_MAP, { glyphs: BLUE_GLYPHS, entities: [monster('tank', 1, 3, 'E')] }));
    rig.afterTick(1);
    rig.press('E');
    rig.afterTick(8);
    expect(rig.entityAt(4, 3)).toMatchObject({ type: 'tank', dir: 'E' });
  });

  it('G4 turns a tank held in a trap', () => {
    const glyphs = { ...BLUE_GLYPHS, t: 'trap' };
    const map = [...BLUE_MAP];
    map[3] = '#...t..#';
    const rig = new LynxRig(lynxLevel(map, { glyphs, entities: [monster('tank', 4, 3, 'E')] }));
    expect(rig.entityAt(4, 3)?.dir).toBe('E');
    rig.press('E');
    rig.afterTick(3);
    expect(rig.entityAt(4, 3)?.dir).toBe('E');
    rig.afterTick(4);
    expect(rig.entityAt(4, 3)?.dir).toBe('W');
  });

  it('keeps a tank inside a clone machine out of the blue button', () => {
    const glyphs = { ...BLUE_GLYPHS, C: 'clone_machine' };
    const map = [...BLUE_MAP];
    map[3] = '#...C..#';
    const rig = new LynxRig(lynxLevel(map, { glyphs, entities: [monster('tank', 4, 3, 'E')] }));
    rig.press('E');
    rig.afterTick(4);
    expect(rig.entityAt(4, 3)?.dir).toBe('E');
  });

  it('G5 clones the creature of a machine when a red button is pressed', () => {
    const glyphs = { c: 'button_red', C: 'clone_machine' };
    const level = lynxLevel(['######', '#@c#C#', '####.#', '####.#', '######'], {
      glyphs,
      entities: [monster('pink_ball', 4, 1, 'S')],
      cloneLinks: [{ buttonX: 2, buttonY: 1, clonerX: 4, clonerY: 1, templateType: 'pink_ball', templateDir: 'S' }]
    });
    const rig = new LynxRig(level);
    const original = rig.entityAt(4, 1);
    rig.press('E');
    rig.afterTick(3);
    expect(rig.entities).toHaveLength(2);
    expect(rig.entityAt(4, 2)?.uid).toBe(original?.uid);
    const copy = rig.entityAt(4, 1);
    expect(copy).toMatchObject({ type: 'pink_ball', dir: 'S' });
    expect(copy?.uid).not.toBe(original?.uid);
    expect(rig.soundCount('button')).toBe(1);
  });

  it('G6 makes no copy when the machine exit is blocked', () => {
    const glyphs = { c: 'button_red', C: 'clone_machine' };
    const level = lynxLevel(['######', '#@c#C#', '######', '####.#', '######'], {
      glyphs,
      entities: [monster('pink_ball', 4, 1, 'S')],
      cloneLinks: [{ buttonX: 2, buttonY: 1, clonerX: 4, clonerY: 1, templateType: 'pink_ball', templateDir: 'S' }]
    });
    const rig = new LynxRig(level);
    rig.press('E');
    rig.afterTick(3);
    expect(rig.entities).toHaveLength(1);
    expect(rig.entityAt(4, 1)).toBeDefined();
    expect(rig.soundCount('button')).toBe(0);
  });

  it('G7 does nothing for unlinked buttons, and uses the first valid link only', () => {
    const red = new LynxRig(lynxLevel(['#####', '#@c.#', '#####'], { glyphs: { c: 'button_red' } }));
    red.press('E');
    red.afterTick(3);
    expect(red.player.x).toBe(2);
    expect(red.sounds).not.toContain('button');

    const brown = new LynxRig(lynxLevel(['#####', '#@b.#', '#####'], { glyphs: { b: 'button_brown' } }));
    brown.press('E');
    brown.afterTick(3);
    expect(brown.soundCount('button')).toBe(1);

    const glyphs = { b: 'button_brown', t: 'trap' };
    const level = lynxLevel(['#######', '#@b#t.#', '#######'], {
      glyphs,
      entities: [monster('pink_ball', 4, 1, 'E')],
      trapLinks: [
        { buttonX: 2, buttonY: 1, trapX: 5, trapY: 1 },
        { buttonX: 2, buttonY: 1, trapX: 4, trapY: 1 }
      ]
    });
    const linked = new LynxRig(level);
    linked.press('E');
    linked.afterTick(3);
    expect(linked.entityAt(5, 1)).toBeDefined();
  });

  it('G8 releases a trapped ball while Chip stands on the button, and holds it again after', () => {
    const glyphs = { b: 'button_brown', t: 'trap' };
    const level = lynxLevel(['#######', '#@b#t.#', '#######'], {
      glyphs,
      entities: [monster('pink_ball', 4, 1, 'E')],
      trapLinks: [{ buttonX: 2, buttonY: 1, trapX: 4, trapY: 1 }]
    });
    const rig = new LynxRig(level);
    expect(rig.engine.isCellClosedTrap(4, 1)).toBe(true);
    rig.press('E');
    rig.afterTick(3);
    expect(rig.entityAt(5, 1)).toBeDefined();
    expect(rig.engine.isCellClosedTrap(4, 1)).toBe(false);
    rig.press('W');
    rig.afterTick(4);
    expect(rig.engine.isCellClosedTrap(4, 1)).toBe(true);
    rig.afterTick(20);
    expect(rig.entityAt(4, 1)).toMatchObject({ type: 'pink_ball', dir: 'W' });
  });

  it('G9 releases Chip from a trap the way he faces, hurrying him along', () => {
    const glyphs = { t: 'trap', b: 'button_brown' };
    const level = lynxLevel(['#######', '##.####', '#@t####', '#######', '##b..##', '#######'], {
      glyphs,
      entities: [monster('pink_ball', 4, 4, 'W')],
      trapLinks: [{ buttonX: 2, buttonY: 4, trapX: 2, trapY: 2 }]
    });
    const rig = new LynxRig(level);
    rig.press('E');
    rig.afterTick(3);
    expect(rig.player).toMatchObject({ x: 2, y: 2 });
    rig.afterTick(3);
    rig.press('N');
    rig.afterTick(4);
    expect(rig.player).toMatchObject({ x: 2, y: 2, dir: 'N' });
    rig.afterTick(7);
    expect(rig.player).toMatchObject({ x: 2, y: 1, moveCooldown: 2 });
    rig.afterTick(9);
    expect(rig.player.moveCooldown).toBe(0);
    expect(rig.engine.getStepsCount()).toBe(2);
  });

  it('G10 keeps a trap shown open while remains lie on its button', () => {
    const glyphs = { '@': 'button_brown', t: 'trap' };
    const level = lynxLevel(['######', '#..@.#', '######', '#t#', '###'], {
      glyphs,
      entities: [monster('pink_ball', 1, 1, 'E')],
      trapLinks: [{ buttonX: 3, buttonY: 1, trapX: 1, trapY: 3 }]
    });
    const rig = new LynxRig(level);
    expect(rig.engine.isCellClosedTrap(1, 3)).toBe(false);
    rig.afterTick(4);
    expect(rig.player.alive).toBe(false);
    expect(rig.engine.isCellClosedTrap(1, 3)).toBe(false);
  });

  it('G10 lets the remains of a monster pulled back in a collision hold the button as remains at rest', () => {
    const level = lynxLevel(['########', '#@b..t.#'], {
      glyphs: { b: 'button_brown', t: 'trap' },
      entities: [monster('pink_ball', 2, 1, 'E'), monster('pink_ball', 5, 1, 'E')],
      trapLinks: [{ buttonX: 2, buttonY: 1, trapX: 5, trapY: 1 }]
    });
    const rig = new LynxRig(level);
    rig.press('E');
    rig.afterTick(0);
    expect(rig.player.alive).toBe(false);
    expect(rig.entityAt(2, 1)).toBeUndefined();
    expect(rig.entityAt(5, 1)).toBeDefined();
    expect(rig.engine.isCellClosedTrap(5, 1)).toBe(false);
  });

  it('E12 and E13 keep a machine closed and an unlinked trap shut', () => {
    const machine = new LynxRig(lynxLevel(['####', '#@C#', '####'], { glyphs: { C: 'clone_machine' } }));
    machine.press('E');
    machine.afterTick(0);
    expect(machine.player.x).toBe(1);

    const trap = new LynxRig(lynxLevel(['#####', '#@t.#', '#####'], { glyphs: { t: 'trap' } }));
    trap.hold('E');
    trap.afterTick(40);
    expect(trap.player).toMatchObject({ x: 2, dir: 'E' });
  });
});
