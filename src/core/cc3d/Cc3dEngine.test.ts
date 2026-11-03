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
import { Cc3dEngine } from './Cc3dEngine';
import { cc3dLevel, panelled, stacked } from './cc3dTestMaps';
import { Cc3dRig } from './cc3dTestRig';

beforeAll(() => {
  loadTestConfigs();
});

describe('time, speed and input', () => {
  it('walks at one cell per four ticks and claims the destination at once', () => {
    const rig = new Cc3dRig(cc3dLevel(['#@....#']));
    rig.hold('E');
    rig.afterTick(0);
    expect(rig.player.x).toBe(2);
    expect(rig.player.moveCooldown).toBe(3);
    rig.afterTick(3);
    expect(rig.player.moveCooldown).toBe(0);
    expect(rig.player.x).toBe(2);
    rig.afterTick(4);
    expect(rig.player.x).toBe(3);
    rig.afterTick(8);
    expect(rig.player.x).toBe(4);
  });

  it('tells whether a press can be taken now', () => {
    const rig = new Cc3dRig(cc3dLevel(['#@....#']));
    expect(rig.press('E')).toBe(true);
    rig.tick();
    expect(rig.press('E')).toBe(false);
  });

  it('keeps one press made mid-step and takes it at the next rest', () => {
    const rig = new Cc3dRig(cc3dLevel(['#@....#']));
    rig.press('E');
    rig.tick(2);
    rig.press('E');
    rig.tick(3);
    expect(rig.player.x).toBe(3);
  });

  it('stops while paused', () => {
    const rig = new Cc3dRig(cc3dLevel(['#@....#']));
    rig.engine.setPaused(true);
    rig.hold('E');
    rig.tick(10);
    expect(rig.player.x).toBe(1);
    expect(rig.engine.togglePause()).toBe(false);
    rig.tick();
    expect(rig.player.x).toBe(2);
  });

  it('dies when the time limit runs out', () => {
    const rig = new Cc3dRig(cc3dLevel(['#@....#'], { timeLimitSeconds: 1 }));
    rig.tick(25);
    expect(rig.player.alive).toBe(false);
    expect(rig.player.deathReasonKey).toBe('hud.messages.death_time');
  });

  it('scores a win like the other engines', () => {
    const rig = new Cc3dRig(cc3dLevel(['#@X#'], { number: 3 }));
    rig.walk('E');
    expect(rig.engine.getLastLevelScore()).toBe(1500);
    expect(rig.engine.getTotalScore()).toBe(1500);
    expect(rig.wins[0].score).toBe(1500);
    expect(rig.engine.getTimedMoveHistory()).toEqual([{ tick: 0, dir: 'E' }]);
    expect(rig.engine.getStepsCount()).toBe(1);
  });
});

describe('undo', () => {
  it('restores the player, the items, the counts and the display', () => {
    const rig = new Cc3dRig(cc3dLevel(['#@i.#']));
    expect(rig.engine.canUndo()).toBe(false);
    rig.walk('E');
    expect(rig.engine.getChipsRemaining()).toBe(0);
    expect(rig.engine.getItems()[0][2]).toBeNull();
    expect(rig.engine.canUndo()).toBe(true);
    expect(rig.engine.undo()).toBe(true);
    expect(rig.player.x).toBe(1);
    expect(rig.engine.getChipsRemaining()).toBe(1);
    expect(rig.engine.getItems()[0][2]).toBe('chip');
    expect(rig.engine.getTimedMoveHistory()).toHaveLength(0);
  });

  it('restores a pushed block and a changed cell', () => {
    const rig = new Cc3dRig(cc3dLevel(['#@KW.#']));
    rig.walk('E');
    expect(rig.terrainAt(3, 0)).toBe('dirt');
    rig.engine.undo();
    expect(rig.terrainAt(3, 0)).toBe('water');
    expect(rig.entityAt(2, 0)?.type).toBe('dirt_block');
    expect(rig.player.x).toBe(1);
  });
});

describe('contract', () => {
  it('refuses a level without cc3d data', () => {
    const engine = new Cc3dEngine({ effect: () => undefined, step: () => undefined });
    const level = cc3dLevel(['#@.#']);
    delete level.cc3d;
    expect(() => engine.loadLevel(level)).toThrow(/cc3d/);
  });

  it('shows the grid through the display ids', () => {
    const rig = new Cc3dRig(cc3dLevel(['#@W#']));
    expect(rig.engine.getMapWidth()).toBe(4);
    expect(rig.engine.getMapHeight()).toBe(1);
    expect(rig.engine.getTerrain()[0]).toEqual(['wall', 'floor', 'water', 'wall']);
  });
});

describe('undo is exact and cheap', () => {
  it('restores cells changed by devices, pickups and doors across several undos', () => {
    const glyphs = {
      p: stacked({ kind: 'floor' }, { kind: 'plate', color: 'green' }),
      H: stacked({ kind: 'floor' }, { kind: 'hold_door', color: 'green', open: false })
    };
    const rig = new Cc3dRig(cc3dLevel(['#@ir1p.#', '#H#####'], { glyphs }));
    const before = JSON.stringify([rig.engine.getTerrain(), rig.engine.getItems()]);
    rig.walk('E');
    const afterFish = JSON.stringify([rig.engine.getTerrain(), rig.engine.getItems()]);
    rig.walk('E', 'E');
    expect(rig.engine.holdsItem('key_red')).toBe(false);
    rig.walk('E');
    expect(rig.terrainAt(1, 1)).toBe('cc3d_hold_door_green_open');
    expect(rig.engine.undo()).toBe(true);
    expect(rig.terrainAt(1, 1)).toBe('cc3d_hold_door_green_closed');
    expect(rig.engine.undo()).toBe(true);
    expect(rig.engine.undo()).toBe(true);
    expect(JSON.stringify([rig.engine.getTerrain(), rig.engine.getItems()])).toBe(afterFish);
    expect(rig.engine.undo()).toBe(true);
    expect(JSON.stringify([rig.engine.getTerrain(), rig.engine.getItems()])).toBe(before);
    expect(rig.engine.canUndo()).toBe(false);
    expect(rig.engine.getChipsRemaining()).toBe(1);
    expect(rig.player.x).toBe(1);
  });

  it('keeps no snapshot for ticks that start no step, and only one per step', () => {
    const rig = new Cc3dRig(cc3dLevel(['###', '#@#', '###']));
    rig.hold('E');
    rig.tick(50);
    expect(rig.engine.canUndo()).toBe(false);
    const open = new Cc3dRig(cc3dLevel(['#@....#']));
    open.hold('E');
    open.tick(12);
    let undone = 0;
    while (open.engine.undo()) undone += 1;
    expect(undone).toBe(3);
    expect(open.player.x).toBe(1);
  });

  it('restores mobs, the clone list and a changed cell together', () => {
    const glyphs = {
      b: stacked({ kind: 'floor' }, { kind: 'clone_switch' }),
      m: { stack: [{ kind: 'floor' as const }, { kind: 'clone_machine' as const, dir: 'E' as const }], mob: { kind: 'block_ice' as const, dir: 'E' as const } }
    };
    const rig = new Cc3dRig(cc3dLevel(['#@bm..#'], { glyphs }));
    rig.walk('E');
    rig.tick(30);
    expect(rig.entities).toHaveLength(2);
    rig.engine.undo();
    expect(rig.entities).toHaveLength(1);
    expect(rig.entityAt(3, 0)).toBeDefined();
    expect(rig.player.x).toBe(1);
  });
});

describe('input and trap queries', () => {
  it('drops a press refused during a forced move instead of firing it later', () => {
    const rig = new Cc3dRig(cc3dLevel(['#@IIII..#']));
    rig.press('E');
    rig.tick(4);
    rig.press('N');
    rig.tick(40);
    expect(rig.player.y).toBe(0);
    expect(rig.player.x).toBe(6);
  });

  it('answers whether a trap cell is closed and shows the change', () => {
    const glyphs = {
      x: stacked({ kind: 'floor' }, { kind: 'trap' }),
      q: stacked({ kind: 'floor' }, { kind: 'trap_control' })
    };
    const rig = new Cc3dRig(cc3dLevel(['#@Kqx#'], { glyphs }));
    expect(rig.engine.isCellClosedTrap(4, 0)).toBe(true);
    expect(rig.engine.isCellClosedTrap(1, 0)).toBe(false);
    rig.walk('E');
    expect(rig.engine.isCellClosedTrap(4, 0)).toBe(false);
  });

  it('starts facing the direction of the level, west by default', () => {
    const level = cc3dLevel(['#@.#']);
    expect(new Cc3dRig(level).player.dir).toBe('W');
    level.cc3d!.player.dir = 'N';
    expect(new Cc3dRig(level).player.dir).toBe('N');
  });
});

describe('panel and hidden layer views', () => {
  const index = (x: number, y: number, width: number): number => y * width + x;

  it('lists the panels on terrain whose display id does not show them', () => {
    const glyphs = {
      p: { stack: [{ kind: 'water' as const }], panels: ['N' as const, 'E' as const] },
      q: { stack: [{ kind: 'ice' as const }], panels: ['W' as const] },
      r: panelled('S')
    };
    const rig = new Cc3dRig(cc3dLevel(['#@pqr.#'], { glyphs }));
    const panels = rig.engine.getPanels();
    const width = rig.engine.getMapWidth();
    expect([...panels.keys()].sort((a, b) => a - b)).toEqual([index(2, 0, width), index(3, 0, width)]);
    expect(panels.get(index(2, 0, width))).toEqual(['N', 'E']);
    expect(panels.get(index(3, 0, width))).toEqual(['W']);
    // A floor with panels shows them through its thin wall id: no second drawing.
    expect(panels.has(index(4, 0, width))).toBe(false);
    expect(rig.engine.getTerrain()[0][4]).toMatch(/^thin_wall_/);
  });

  it('flags the cells whose stack holds more than the shown layer', () => {
    const rig = new Cc3dRig(cc3dLevel(['#@O..#']));
    const width = rig.engine.getMapWidth();
    expect([...rig.engine.getHiddenLayerCells()]).toEqual([index(2, 0, width)]);
  });
});
