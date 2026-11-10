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
import { GameEngine } from '../GameEngine';
import { cc3dLevel } from './cc3dTestMaps';
import { Cc3dRig } from './cc3dTestRig';
import { convertCc3dLevel } from './cc3dToEpoxy';
import { classifyLevel, EPOXY_COVERAGE, KEY_TIME_LIMIT } from './epoxyCoverage';

const ROOM = ['#####', '#@..#', '#####'];
const TIME_LIMIT_SECONDS = 3;
const SAFETY_TICKS = 1000;
const SEED = 1;

/** The number of tick calls an idle player survives, from a fresh level. */
function cc3dSurvivedTicks(limit: number): { ticks: number; remainingBefore: number } {
  const rig = new Cc3dRig(cc3dLevel(ROOM, { timeLimitSeconds: limit }), SEED);
  let ticks = 0;
  let remainingBefore = -1;
  while (rig.player.alive && ticks < SAFETY_TICKS) {
    remainingBefore = rig.engine.getTimeRemainingSeconds();
    rig.tick(1);
    ticks++;
  }
  return { ticks, remainingBefore };
}

function epoxySurvivedTicks(limit: number): { ticks: number; remainingBefore: number } {
  const source = cc3dLevel(ROOM, { timeLimitSeconds: limit });
  const engine = new GameEngine();
  engine.loadLevel(convertCc3dLevel(source).level, SEED);
  let ticks = 0;
  let remainingBefore = -1;
  while (engine.getPlayer().alive && ticks < SAFETY_TICKS) {
    remainingBefore = engine.getTimeRemainingSeconds();
    engine.tick();
    ticks++;
  }
  return { ticks, remainingBefore };
}

describe('the CC3D time limit carries over to the converted level', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('copies the limit in seconds', () => {
    expect(convertCc3dLevel(cc3dLevel(ROOM, { timeLimitSeconds: 45 })).level.timeLimitSeconds).toBe(45);
    expect(convertCc3dLevel(cc3dLevel(ROOM)).level.timeLimitSeconds).toBe(0);
  });

  it('runs out one tick apart: CC3D kills at the start of the tick after the limit, Epoxy on the limit tick', () => {
    const tps = ConfigRegistry.getGame().timing.ticksPerSecond;
    const cc3d = cc3dSurvivedTicks(TIME_LIMIT_SECONDS);
    const epoxy = epoxySurvivedTicks(TIME_LIMIT_SECONDS);
    expect(cc3d.ticks).toBe(TIME_LIMIT_SECONDS * tps + 1);
    expect(epoxy.ticks).toBe(TIME_LIMIT_SECONDS * tps);
  });

  it('shows the same seconds remaining at every tick before the end', () => {
    const tps = ConfigRegistry.getGame().timing.ticksPerSecond;
    const rig = new Cc3dRig(cc3dLevel(ROOM, { timeLimitSeconds: TIME_LIMIT_SECONDS }), SEED);
    const engine = new GameEngine();
    engine.loadLevel(convertCc3dLevel(cc3dLevel(ROOM, { timeLimitSeconds: TIME_LIMIT_SECONDS })).level, SEED);
    for (let i = 0; i < TIME_LIMIT_SECONDS * tps - 1; i++) {
      rig.tick(1);
      engine.tick();
      expect(engine.getTimeRemainingSeconds()).toBe(rig.engine.getTimeRemainingSeconds());
    }
  });

  it('names the one tick difference as approximate on a timed map only', () => {
    const timed = cc3dLevel(ROOM, { timeLimitSeconds: TIME_LIMIT_SECONDS });
    expect(EPOXY_COVERAGE[KEY_TIME_LIMIT].level).toBe('approx');
    expect(classifyLevel(timed.cc3d!, TIME_LIMIT_SECONDS).approx).toEqual([KEY_TIME_LIMIT]);
    expect(convertCc3dLevel(timed).report.approx.map((e) => e.key)).toEqual([KEY_TIME_LIMIT]);
    expect(classifyLevel(timed.cc3d!).verdict).toBe('exact');
    expect(convertCc3dLevel(cc3dLevel(ROOM)).report.approx).toEqual([]);
  });

  it('never ends an untimed level', () => {
    expect(cc3dSurvivedTicks(0).ticks).toBe(SAFETY_TICKS);
    expect(epoxySurvivedTicks(0).ticks).toBe(SAFETY_TICKS);
  });
});
