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
import { lynxLevel, monster } from './lynxTestMaps';
import { LynxRig } from './lynxTestRig';

beforeAll(() => {
  loadTestConfigs();
});

describe('A. time, speed and input', () => {
  it('A1 walks at one cell per four ticks and latches the blocked sound', () => {
    const rig = new LynxRig(lynxLevel(['#######', '#@....#', '#######']));
    rig.hold('E');
    rig.afterTick(0);
    expect(rig.player.x).toBe(2);
    expect(rig.player.moveCooldown).toBe(3);
    rig.afterTick(1);
    expect(rig.player.moveCooldown).toBe(2);
    rig.afterTick(2);
    expect(rig.player.moveCooldown).toBe(1);
    rig.afterTick(3);
    expect(rig.player.moveCooldown).toBe(0);
    rig.afterTick(4);
    expect(rig.player.x).toBe(3);
    rig.afterTick(8);
    expect(rig.player.x).toBe(4);
    rig.afterTick(12);
    expect(rig.player.x).toBe(5);
    expect(rig.soundCount('blocked')).toBe(0);
    rig.afterTick(25);
    expect(rig.player.x).toBe(5);
    expect(rig.player.dir).toBe('E');
    expect(rig.soundCount('blocked')).toBe(1);
    expect(rig.engine.getStepsCount()).toBe(4);
  });

  it('A2 always starts facing south', () => {
    const rig = new LynxRig(lynxLevel(['###', '#@#', '###'], { playerDir: 'N' }));
    expect(rig.player.dir).toBe('S');
  });

  it('A3 buffers one direction until Chip can take it', () => {
    const rows = ['#######', '#@....#', '##.####', '#######'];
    const rig = new LynxRig(lynxLevel(rows));
    expect(rig.press('E')).toBe(true);
    rig.afterTick(0);
    expect(rig.press('S')).toBe(false);
    rig.afterTick(3);
    expect(rig.player).toMatchObject({ x: 2, y: 1 });
    rig.afterTick(4);
    expect(rig.player).toMatchObject({ x: 2, y: 2, dir: 'S' });
  });

  it('A3 variant: a later press replaces the buffered one', () => {
    const rig = new LynxRig(lynxLevel(['#######', '#@....#', '##.####', '#######']));
    rig.press('E');
    rig.afterTick(0);
    rig.press('S');
    rig.afterTick(1);
    rig.press('W');
    rig.afterTick(4);
    expect(rig.player).toMatchObject({ x: 1, y: 1, dir: 'W' });
    expect(rig.engine.getTimedMoveHistory()).toEqual([
      { tick: 0, dir: 'E' },
      { tick: 4, dir: 'W' }
    ]);
  });

  it('A10 moves Chip exactly one cell for a key tap of two ticks', () => {
    const rig = new LynxRig(lynxLevel(['#######', '#@....#', '#######']));
    rig.press('E');
    rig.hold('E');
    rig.tick(2);
    rig.release();
    rig.tick(12);
    expect(rig.player).toMatchObject({ x: 2, y: 1, moveCooldown: 0 });
    expect(rig.engine.getStepsCount()).toBe(1);
    expect(rig.engine.getTimedMoveHistory()).toEqual([{ tick: 0, dir: 'E' }]);
  });

  it('A10 keeps a new press made while Chip is busy, even after the key is released', () => {
    const rig = new LynxRig(lynxLevel(['#######', '#@....#', '##.####', '#######']));
    rig.press('E');
    rig.tick(2);
    rig.press('S');
    rig.hold('S');
    rig.tick(1);
    rig.release();
    rig.tick(8);
    expect(rig.player).toMatchObject({ x: 2, y: 2, dir: 'S' });
  });

  it('A10 takes a key that is still held at the moment Chip can decide', () => {
    const rig = new LynxRig(lynxLevel(['#######', '#@....#', '#######']));
    rig.press('E');
    rig.hold('E');
    rig.afterTick(4);
    expect(rig.player.x).toBe(3);
    rig.afterTick(8);
    expect(rig.player.x).toBe(4);
  });

  it('A4 monsters walk at one cell per four ticks and bounce back', () => {
    const level = lynxLevel(['#######', '#.....#', '#######', '#@#'], {
      entities: [monster('pink_ball', 1, 1, 'E')]
    });
    const rig = new LynxRig(level);
    const ballX = () => rig.entities[0].x;
    rig.afterTick(0);
    expect(ballX()).toBe(2);
    rig.afterTick(4);
    expect(ballX()).toBe(3);
    rig.afterTick(8);
    expect(ballX()).toBe(4);
    rig.afterTick(12);
    expect(ballX()).toBe(5);
    rig.afterTick(16);
    expect(rig.entities[0]).toMatchObject({ x: 4, dir: 'W' });
  });

  it('A7 kills Chip silently when the time limit runs out', () => {
    const rig = new LynxRig(lynxLevel(['###', '#@#', '###'], { timeLimitSeconds: 1 }));
    rig.tick(19);
    expect(rig.engine.getTimeRemainingSeconds()).toBe(1);
    rig.tick(1);
    expect(rig.engine.getTimeRemainingSeconds()).toBe(0);
    expect(rig.player.alive).toBe(true);
    rig.tick(1);
    expect(rig.player.alive).toBe(false);
    expect(rig.player.deathReasonKey).toBe('hud.messages.death_time');
    expect(rig.visuals).toContainEqual({ kind: 'explosion', x: 1, y: 1, colorKey: 'red' });
    expect(rig.sounds).not.toContain('death');
    expect(rig.sounds).toEqual([]);
    expect(rig.engine.getTick()).toBe(21);
    rig.tick(5);
    expect(rig.engine.getTick()).toBe(21);
  });

  it('A8 never times out without a limit', () => {
    const rig = new LynxRig(lynxLevel(['###', '#@#', '###']));
    rig.tick(2000);
    expect(rig.player.alive).toBe(true);
    expect(rig.engine.getTimeRemainingSeconds()).toBe(0);
  });
});
