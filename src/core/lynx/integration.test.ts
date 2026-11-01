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
  AudioManager: { playSfx: vi.fn() }
}));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { Direction } from '../types';
import { ENTITY } from './lynxConstants';
import { lynxLevel, LynxLevelOptions, monster } from './lynxTestMaps';
import { LynxRig } from './lynxTestRig';

/*
 * End-to-end scenarios with the real rule modules registered together (no
 * stubs). Scenario ids are those of the acceptance-test catalogue.
 */

beforeAll(() => {
  loadTestConfigs();
});

const BLOCK_FACING: Direction = 'N';

/** A glyph meaning: the given terrain with a block standing on it. */
const blockOn = (terrain: string) => ({ terrain, entity: { type: ENTITY.block, dir: BLOCK_FACING } });

describe('blue button and tanks', () => {
  const room = ['########', '#@K#####', '########', '#......#', '########'];
  const options: LynxLevelOptions = { glyphs: { K: 'button_blue' }, entities: [monster('tank', 1, 3, 'E')] };

  it('G2 turns a tank that arrives with Chip, at the start of the next tick', () => {
    const rig = new LynxRig(lynxLevel(room, options));
    rig.press('E');
    rig.afterTick(3);
    expect(rig.entityAt(2, 3)).toMatchObject({ type: 'tank', dir: 'E' });
    rig.afterTick(4);
    expect(rig.entityAt(1, 3)).toMatchObject({ type: 'tank', dir: 'W' });
  });

  it('G3 ignores a tank that is mid-step at the start of the next tick', () => {
    const rig = new LynxRig(lynxLevel(room, options));
    rig.afterTick(1);
    rig.press('E');
    rig.afterTick(8);
    expect(rig.entityAt(4, 3)).toMatchObject({ type: 'tank', dir: 'E' });
  });

  it('G4 turns a tank held in an unlinked trap', () => {
    const map = [...room];
    map[3] = '#...t..#';
    const rig = new LynxRig(
      lynxLevel(map, { glyphs: { K: 'button_blue', t: 'trap' }, entities: [monster('tank', 4, 3, 'E')] })
    );
    rig.press('E');
    rig.afterTick(4);
    expect(rig.entityAt(4, 3)?.dir).toBe('W');
  });

  it('cancels the turn when two blue buttons are pressed in the same tick', () => {
    const map = ['########', '#@K#####', '########', '#......#', '########', '#.K....#', '########'];
    const rig = new LynxRig(
      lynxLevel(map, {
        glyphs: { K: 'button_blue' },
        entities: [monster('tank', 1, 3, 'E'), monster('pink_ball', 1, 5, 'E')]
      })
    );
    rig.press('E');
    rig.afterTick(4);
    expect(rig.player.x).toBe(2);
    expect(rig.entityAt(3, 3)).toMatchObject({ type: 'tank', dir: 'E' });
  });
});

describe('green button and toggle walls', () => {
  const glyphs = { k: 'button_green', o: 'toggle_wall_open', c: 'toggle_wall_closed' };
  const terrainAt = (rig: LynxRig, x: number, y: number): string => rig.engine.getTerrain()[y][x];

  it('E11 flips the walls in the arrival tick when Chip presses, and the closed wall then stops him', () => {
    const rig = new LynxRig(lynxLevel(['#######', '#@k.oc#', '#######'], { glyphs }));
    rig.press('E');
    rig.afterTick(2);
    expect(terrainAt(rig, 4, 1)).toBe('toggle_wall_open');
    rig.afterTick(3);
    expect(terrainAt(rig, 4, 1)).toBe('toggle_wall_closed');
    expect(terrainAt(rig, 5, 1)).toBe('toggle_wall_open');
    rig.hold('E');
    rig.afterTick(12);
    expect(rig.player).toMatchObject({ x: 3, dir: 'E' });
  });

  it('flips the walls when a block arrives on the button', () => {
    const rig = new LynxRig(lynxLevel(['########', '#@Bk.oc#', '########'], { glyphs }));
    rig.press('E');
    rig.afterTick(2);
    expect(terrainAt(rig, 5, 1)).toBe('toggle_wall_open');
    rig.afterTick(3);
    expect(terrainAt(rig, 5, 1)).toBe('toggle_wall_closed');
    expect(terrainAt(rig, 6, 1)).toBe('toggle_wall_open');
  });

  it('G1 flips the walls when a monster arrives, then the monster turns back at the closed wall', () => {
    const rig = new LynxRig(
      lynxLevel(['#######', '#.k.oc#', '#######', '#@#'], { glyphs, entities: [monster('pink_ball', 1, 1, 'E')] })
    );
    rig.afterTick(2);
    expect(terrainAt(rig, 4, 1)).toBe('toggle_wall_open');
    rig.afterTick(3);
    expect(terrainAt(rig, 4, 1)).toBe('toggle_wall_closed');
    rig.afterTick(8);
    expect(rig.entityAt(2, 1)).toMatchObject({ type: 'pink_ball', dir: 'W' });
  });

  it('flips twice when two creatures arrive on two green buttons in one tick', () => {
    const rig = new LynxRig(
      lynxLevel(['#######', '#@k.oc#', '#######', '#.k...#', '#######'], {
        glyphs,
        entities: [monster('pink_ball', 1, 3, 'E')]
      })
    );
    rig.press('E');
    rig.afterTick(3);
    expect(terrainAt(rig, 4, 1)).toBe('toggle_wall_open');
    expect(terrainAt(rig, 5, 1)).toBe('toggle_wall_closed');
    expect(rig.soundCount('button')).toBe(2);
  });
});

describe('brown button and traps', () => {
  const FACINGS_COMPARED = 5;
  const TICKS_AFTER_PRESS = 60;
  const LONG_WAIT_TICKS = 40;

  const walkerFacings = (waitTicks: number): Direction[] => {
    const level = lynxLevel(['#######', '#@b#t.#', '#######'], {
      glyphs: { b: 'button_brown', t: 'trap' },
      entities: [monster('walker', 4, 1, 'E')],
      trapLinks: [{ buttonX: 2, buttonY: 1, trapX: 4, trapY: 1 }]
    });
    const rig = new LynxRig(level);
    const seen: Direction[] = [];
    for (let i = 0; i < waitTicks; i++) {
      rig.tick();
      expect(rig.entities[0]).toMatchObject({ x: 4, y: 1, dir: 'E' });
    }
    rig.press('E');
    for (let i = 0; i < TICKS_AFTER_PRESS; i++) {
      rig.tick();
      const dir = rig.entities[0].dir;
      if (seen[seen.length - 1] !== dir) seen.push(dir);
    }
    return seen.slice(0, FACINGS_COMPARED);
  };

  it('releases a trapped walker that drew no random number while it waited', () => {
    const immediate = walkerFacings(0);
    expect(immediate).toEqual(['E', 'S', 'E', 'N', 'W']);
    expect(walkerFacings(LONG_WAIT_TICKS)).toEqual(immediate);
  });

  it('B7 hurries a ball through a trap held open by a block on the button', () => {
    const level = lynxLevel(['#######', '#..t..#', '#######', '#b#', '###', '#@#'], {
      glyphs: { b: blockOn('button_brown'), t: 'trap' },
      entities: [monster('pink_ball', 1, 1, 'E')],
      trapLinks: [{ buttonX: 1, buttonY: 3, trapX: 3, trapY: 1 }]
    });
    const rig = new LynxRig(level);
    const ballAfter = (k: number) => {
      rig.afterTick(k);
      expect(rig.engine.isCellClosedTrap(3, 1)).toBe(false);
      return rig.entities.find((e) => e.type === 'pink_ball');
    };
    expect(ballAfter(0)).toMatchObject({ x: 2, y: 1 });
    expect(ballAfter(4)).toMatchObject({ x: 3, y: 1, cooldownTicks: 2 });
    expect(ballAfter(5)).toMatchObject({ x: 3, y: 1, cooldownTicks: 0 });
    expect(ballAfter(6)).toMatchObject({ x: 4, y: 1, cooldownTicks: 3 });
    expect(ballAfter(9)).toMatchObject({ x: 4, y: 1, cooldownTicks: 0 });
  });

  it('D3 never lets Chip push a block out of a trap, and a held trap releases it', () => {
    const level = lynxLevel(['#####', '#@t.#', '#b###', '#####'], {
      glyphs: { t: blockOn('trap'), b: 'button_brown' },
      trapLinks: [{ buttonX: 1, buttonY: 2, trapX: 2, trapY: 1 }]
    });
    const rig = new LynxRig(level);
    rig.press('E');
    rig.afterTick(0);
    expect(rig.player).toMatchObject({ x: 1, y: 1 });
    expect(rig.entityAt(2, 1)).toMatchObject({ type: ENTITY.block, dir: 'E' });
    rig.press('S');
    rig.afterTick(4);
    expect(rig.entityAt(3, 1)).toMatchObject({ type: ENTITY.block, cooldownTicks: 3 });
  });
});

describe('red button and clone machines', () => {
  it.each([0, 1, 2, 3])('G5 clones a glider in its facing after %i idle ticks', (idle) => {
    const level = lynxLevel(['######', '#@c#C#', '####.#', '####.#', '######'], {
      glyphs: { c: 'button_red', C: 'clone_machine' },
      entities: [monster('glider', 4, 1, 'S')],
      cloneLinks: [{ buttonX: 2, buttonY: 1, clonerX: 4, clonerY: 1, templateType: 'glider', templateDir: 'S' }]
    });
    const rig = new LynxRig(level);
    const original = rig.entityAt(4, 1);
    rig.tick(idle);
    expect(rig.entityAt(4, 1)).toMatchObject({ uid: original?.uid, dir: 'S' });
    rig.press('E');
    rig.afterTick(idle + 3);
    expect(rig.entities).toHaveLength(2);
    expect(rig.entityAt(4, 2)).toMatchObject({ uid: original?.uid, type: 'glider', dir: 'S' });
    const copy = rig.entityAt(4, 1);
    expect(copy).toMatchObject({ type: 'glider', dir: 'S' });
    expect(copy?.uid).not.toBe(original?.uid);
    expect(rig.soundCount('button')).toBe(1);
  });
});

describe('teleports with ice and force floors', () => {
  it('lands on a teleport whose exit is a force floor and is carried on after the forced exit', () => {
    const level = lynxLevel(['#######', '#.vT.T@#', '##.#####', '#######'], {
      glyphs: { T: 'teleport', v: 'force_s' }
    });
    const rig = new LynxRig(level);
    rig.press('W');
    rig.afterTick(3);
    expect(rig.player).toMatchObject({ x: 3, y: 1, dir: 'W' });
    expect(rig.visualsOf('teleport')).toEqual([{ kind: 'teleport', x: 3, y: 1, colorKey: undefined }]);
    expect(rig.soundCount('teleport')).toBe(1);
    rig.press('S');
    rig.afterTick(4);
    expect(rig.player).toMatchObject({ x: 2, y: 1, dir: 'W', isSliding: false });
    rig.afterTick(5);
    expect(rig.player).toMatchObject({ x: 2, y: 1, moveCooldown: 0 });
    rig.afterTick(6);
    expect(rig.player).toMatchObject({ x: 2, y: 2, dir: 'S', isSliding: true });
  });

  it('carries Chip from ice into a teleport, then sends him out of the landing teleport', () => {
    const level = lynxLevel(['#########', '#@IIT.T.#', '#########'], { glyphs: { T: 'teleport', I: 'ice' } });
    const rig = new LynxRig(level);
    rig.press('E');
    rig.afterTick(3);
    expect(rig.player).toMatchObject({ x: 3, y: 1 });
    rig.afterTick(7);
    expect(rig.player).toMatchObject({ x: 6, y: 1, dir: 'E', moveCooldown: 0 });
    expect(rig.visualsOf('teleport').at(-1)).toMatchObject({ x: 6, y: 1 });
    rig.afterTick(8);
    expect(rig.player).toMatchObject({ x: 7, y: 1, dir: 'E' });
  });

  it('B6 lets Chip follow a ball into a cell it left when his move is a teleport exit', () => {
    const forced = new LynxRig(
      lynxLevel(['########', '##.#####', '##.T#T@#', '##.#####', '########'], {
        glyphs: { T: 'teleport' },
        entities: [monster('pink_ball', 2, 3, 'N')]
      })
    );
    forced.press('W');
    forced.afterTick(3);
    expect(forced.player).toMatchObject({ x: 3, y: 2, dir: 'W' });
    expect(forced.visualsOf('teleport')).toHaveLength(1);
    expect(forced.soundCount('teleport')).toBe(1);
    forced.afterTick(4);
    expect(forced.player).toMatchObject({ x: 2, y: 2, alive: true });
    expect(forced.entityAt(2, 1)).toMatchObject({ type: 'pink_ball' });

    const chosen = new LynxRig(
      lynxLevel(['########', '##.#####', '##.@#..#', '##.#####', '########'], {
        entities: [monster('pink_ball', 2, 3, 'N')]
      })
    );
    chosen.afterTick(3);
    chosen.press('W');
    chosen.afterTick(4);
    expect(chosen.player).toMatchObject({ x: 3, y: 2, alive: false });
    expect(chosen.entities).toHaveLength(0);
  });
});

describe('replay and undo', () => {
  const CORRIDOR = '#@.........#';
  const SEED = 777;
  const TICKS = 200;
  const INPUT_GAP = 7;
  const INPUT_HOLD_TICKS = 5;
  const script: Direction[] = ['E', 'E', 'W', 'E', 'W', 'W'];
  const inputOf = (k: number): Direction | null =>
    k % INPUT_GAP === 0 ? null : script[Math.floor(k / INPUT_HOLD_TICKS) % script.length];

  const level = lynxLevel(
    [
      CORRIDOR,
      '#'.repeat(CORRIDOR.length),
      '#.........#',
      '#...?.....#',
      '#.........#',
      '#'.repeat(CORRIDOR.length)
    ],
    {
      number: 2,
      glyphs: { '?': 'force_random' },
      entities: [monster('walker', 2, 2, 'E'), monster('blob', 8, 4, 'N')]
    }
  );

  it('K5 replays a blob and a walker from the timed history to the same state', () => {
    const first = new LynxRig(level, { seed: SEED });
    const start = first.entities.map((e) => ({ x: e.x, y: e.y, dir: e.dir }));
    for (let k = 0; k < TICKS; k++) {
      const dir = inputOf(k);
      if (dir) first.press(dir);
      first.tick();
    }
    expect(first.entities.map((e) => ({ x: e.x, y: e.y, dir: e.dir }))).not.toEqual(start);
    const history = first.engine.getTimedMoveHistory();
    expect(history.length).toBeGreaterThan(0);

    const second = new LynxRig(level, { seed: SEED });
    for (let k = 0; k < TICKS; k++) {
      for (const move of history.filter((m) => m.tick === k)) second.press(move.dir);
      second.tick();
    }
    expect(second.entities).toEqual(first.entities);
    expect(second.player).toEqual(first.player);
    expect(second.engine.getTick()).toBe(first.engine.getTick());
    expect(second.engine.getTimedMoveHistory()).toEqual(history);
    expect(second.engine.getTerrain()).toEqual(first.engine.getTerrain());
  });

  it('K4 undo during an ice slide restores exactly the view of the tick before', () => {
    const rig = new LynxRig(lynxLevel(['#######', '#@BII.#', '##.####', '#######'], { glyphs: { I: 'ice' } }));
    rig.press('E');
    rig.afterTick(4);
    const before = { entities: structuredClone(rig.entities), player: structuredClone(rig.player) };
    rig.press('S');
    rig.afterTick(6);
    expect(rig.engine.undo()).toBe(true);
    expect(rig.engine.getTick()).toBe(5);
    expect(rig.entities).toEqual(before.entities);
    expect(rig.player).toEqual(before.player);
    expect(rig.entities[0]).toMatchObject({ x: 5, y: 1, isSliding: true, cooldownTicks: 3 });
    rig.tick();
    expect(rig.entities[0].isSliding).toBe(true);
    rig.afterTick(7);
    expect(rig.entities[0]).toMatchObject({ isSliding: true, cooldownTicks: 0 });
    rig.afterTick(8);
    expect(rig.entities[0].isSliding).toBe(false);
  });
});
