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

import { Direction } from '../types';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { lynxLevel, monster } from './lynxTestMaps';
import { LynxRig } from './lynxTestRig';

beforeAll(() => {
  loadTestConfigs();
});

describe('K. winning, losing and the contract', () => {
  it('K1 scores the exit and then stops the world', () => {
    const rig = new LynxRig(lynxLevel(['####', '#@X#', '####'], { number: 3, timeLimitSeconds: 100 }));
    rig.press('E');
    rig.afterTick(3);
    const { engine } = rig;
    expect(engine.isLevelCompleted()).toBe(true);
    expect(rig.player).toMatchObject({ x: 2, y: 1, alive: true });
    expect(engine.getTick()).toBe(4);
    expect(engine.getLastTimeBonus()).toBe(1000);
    expect(engine.getLastLevelScore()).toBe(2500);
    expect(engine.getTotalScore()).toBe(2500);
    expect(rig.wins).toEqual([{ levelId: 'lynx_test', time: 100, steps: 1, score: 2500, moves: ['E'] }]);
    expect(rig.visuals).toContainEqual({ kind: 'win', x: 2, y: 1, colorKey: undefined });
    expect(rig.sounds).toContain('win');
    rig.tick(10);
    expect(engine.getTick()).toBe(4);
    expect(rig.wins).toHaveLength(1);
    expect(engine.canUndo()).toBe(false);
    expect(engine.undo()).toBe(false);
  });

  it('K2 freezes the world after Chip dies', () => {
    const level = lynxLevel(['#####', '#..@#', '#####'], { entities: [monster('pink_ball', 1, 1, 'E')] });
    const rig = new LynxRig(level);
    rig.afterTick(4);
    const terrain = JSON.stringify(rig.engine.getTerrain());
    const tick = rig.engine.getTick();
    rig.tick(30);
    expect(rig.engine.getTick()).toBe(tick);
    expect(JSON.stringify(rig.engine.getTerrain())).toBe(terrain);
    expect(rig.entities).toEqual([]);
  });

  it('K3 undoes a fatal move', () => {
    const rig = new LynxRig(lynxLevel(['####', '#@W#', '####']));
    rig.press('E');
    rig.afterTick(3);
    expect(rig.player.alive).toBe(false);
    expect(rig.engine.canUndo()).toBe(true);
    expect(rig.engine.undo()).toBe(true);
    expect(rig.player).toMatchObject({ x: 1, y: 1, alive: true });
    expect(rig.engine.getTick()).toBe(0);
    expect(rig.engine.getStepsCount()).toBe(0);
    expect(rig.engine.getTerrain()[1][2]).toBe('water');
    expect(rig.steps).toEqual([null, null]); // the chosen step into the water, then the undo step
  });

  it('keeps at most maxUndoSnapshots snapshots', () => {
    const wall = '#'.repeat(402);
    const rig = new LynxRig(lynxLevel([wall, '#@' + '.'.repeat(399) + '#', wall]));
    rig.hold('E');
    rig.tick(4 * 310);
    let undone = 0;
    while (rig.engine.undo()) undone++;
    expect(undone).toBe(300);
  });

  it('undo restores positions, histories and the tick', () => {
    const rig = new LynxRig(lynxLevel(['########', '#@.....#', '########']));
    rig.press('E');
    rig.afterTick(3);
    rig.press('E');
    rig.afterTick(5);
    expect(rig.player.x).toBe(3);
    expect(rig.engine.getTimedMoveHistory()).toHaveLength(2);
    rig.engine.undo();
    expect(rig.player).toMatchObject({ x: 2, moveCooldown: 0 });
    expect(rig.engine.getTimedMoveHistory()).toEqual([{ tick: 0, dir: 'E' }]);
    expect(rig.engine.getTick()).toBe(4);
  });

  it('K6 records failed moves but keeps no snapshot for them', () => {
    const rig = new LynxRig(lynxLevel(['###', '#@#', '###']));
    rig.press('E');
    rig.tick();
    expect(rig.engine.getTimedMoveHistory()).toEqual([{ tick: 0, dir: 'E' }]);
    expect(rig.engine.canUndo()).toBe(false);
  });

  it('K7 leaves an item under a monster', () => {
    const level = lynxLevel(['######', '#.r..#', '######', '#@#'], { entities: [monster('pink_ball', 2, 1, 'E')] });
    const rig = new LynxRig(level);
    rig.afterTick(0);
    expect(rig.engine.getItems()[1][2]).toBe('key_red');
  });

  it('K8 cannot be reached by monsters while Chip stands on an item', () => {
    const level = lynxLevel(['#####', '#..@#', '#####'], {
      glyphs: { '@': { terrain: 'floor', item: 'chip' } },
      entities: [monster('pink_ball', 1, 1, 'E')]
    });
    const rig = new LynxRig(level);
    rig.afterTick(0);
    expect(rig.entities[0].x).toBe(2);
    rig.tick(40);
    expect(rig.player.alive).toBe(true);
    expect(rig.engine.getItems()[1][3]).toBe('chip');
  });

  it('K10 pauses and resumes', () => {
    const rig = new LynxRig(lynxLevel(['#####', '#@..#', '#####']));
    rig.engine.setPaused(true);
    expect(rig.press('E')).toBe(false);
    rig.tick(3);
    expect(rig.engine.getTick()).toBe(0);
    expect(rig.engine.togglePause()).toBe(false);
    rig.press('E');
    rig.tick();
    expect(rig.engine.getTick()).toBe(1);
  });

  it('K11 lists neither Chip nor remains as entities', () => {
    const level = lynxLevel(['#####', '#@..#', '#####'], { entities: [monster('pink_ball', 3, 1, 'W')] });
    const rig = new LynxRig(level);
    expect(rig.entities).toHaveLength(1);
    rig.press('E');
    rig.afterTick(0);
    expect(rig.entities).toEqual([]);
  });

  it('replays a timed history to the same result', () => {
    const level = lynxLevel(['#######', '#@..m.#', '#.#.#.#', '#..X..#', '#######'], {
      entities: [monster('bug', 5, 2, 'N')]
    });
    const script: Array<[number, Direction]> = [
      [0, 'S'],
      [4, 'S'],
      [8, 'E'],
      [12, 'E']
    ];
    const first = new LynxRig(level, { seed: 7 });
    for (let k = 0; k < 30; k++) {
      for (const [at, dir] of script) if (at === k) first.press(dir);
      first.tick();
    }
    const second = new LynxRig(level, { seed: 7 });
    for (let k = 0; k < 30; k++) {
      for (const move of first.engine.getTimedMoveHistory()) if (move.tick === k) second.press(move.dir);
      second.tick();
    }
    expect(second.engine.getTick()).toBe(first.engine.getTick());
    expect(second.player).toEqual(first.player);
    expect(second.entities).toEqual(first.entities);
  });

  it('carries the total score and restarts from it', () => {
    const level = lynxLevel(['####', '#@X#', '####'], { number: 1 });
    const rig = new LynxRig(level);
    rig.engine.carryTotalScore(100);
    rig.engine.loadLevel(level);
    rig.press('E');
    rig.afterTick(3);
    expect(rig.engine.getTotalScore()).toBe(600);
    rig.engine.loadLevel(level);
    expect(rig.engine.getTotalScore()).toBe(100);
    expect(rig.engine.getLastLevelScore()).toBe(0);
  });

  it('answers holdsItem and refuses drops', () => {
    const rig = new LynxRig(lynxLevel(['#####', '#@rq#', '#####']));
    rig.hold('E');
    rig.tick(8);
    expect(rig.engine.holdsItem('key_red')).toBe(true);
    expect(rig.engine.holdsItem('boots_water')).toBe(true);
    expect(rig.engine.holdsItem('key_blue')).toBe(false);
    expect(rig.engine.dropItem('key_red')).toBe(false);
    expect(rig.engine.getTargetsProgress()).toEqual({ covered: 0, total: 0 });
    expect(rig.engine.getStatusBannerKey()).toBeNull();
  });
});
