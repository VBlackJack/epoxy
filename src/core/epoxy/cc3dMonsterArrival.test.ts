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

import { buildTestLevel } from '../../test/buildTestLevel';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { CONVERTED_ID_SUFFIX } from '../cc3d/cc3dConstants';
import { CC3D_MONSTER_FLOOR_STEP_TICKS } from '../coreConstants';
import { GameEngine } from '../GameEngine';
import type { CcArrival, Direction } from '../types';

/**
 * The arrival rules of a monster on a converted CC3D level: the blue golem control (reverse_tanks) it presses acts when
 * its step starts, and a teleporter moves it when its step ends, onto a fast exit step of its own. Native levels are
 * unchanged.
 */

beforeEach(() => {
  loadTestConfigs();
});

const ROWS = ['###############', '#.............#', '#.............#', '#@############.#', '###############'];
const ROW = 1;
const PAD_IN_X = 3;
const PAD_OUT_X = 9;
const EXIT_X = PAD_OUT_X + 1;
/** Ticks a plain monster step lasts (CC3D_MONSTER_STEP_TICKS). */
const STEP_TICKS = 4;

interface MonsterView {
  uid: number;
  kind: string;
  type: string;
  x: number;
  y: number;
  dir: Direction;
  cooldownTicks: number;
}

interface WorldView {
  entities: MonsterView[];
  ccArrivals: CcArrival[];
  player: { boots: string[] };
}

function build(
  converted: boolean,
  terrainAt: Array<[number, string]>,
  entities: Array<{ type: string; x: number; dir: Direction }>
): { engine: GameEngine; w: WorldView } {
  const level = buildTestLevel(ROWS, { entities: entities.map((e) => ({ ...e, y: ROW })) });
  const terrain = level.terrain.map((r) => [...r]);
  for (const [x, id] of terrainAt) terrain[ROW][x] = id;
  const engine = new GameEngine();
  engine.loadLevel({ ...level, terrain, id: converted ? `lane${CONVERTED_ID_SUFFIX}` : 'lane' });
  return { engine, w: (engine as unknown as { w: WorldView }).w };
}

const monsterOf = (w: WorldView, type?: string): MonsterView =>
  w.entities.find((e) => e.kind === 'monster' && (type === undefined || e.type === type)) as MonsterView;

describe('a blue golem control pressed by a monster', () => {
  const BUTTON_X = 4;
  const TANK_X = 11;

  /** The tick the monster stands on the button and the tick the tank first faces east. */
  function trace(converted: boolean): { arrived: number; flipped: number } {
    const { engine, w } = build(converted, [[BUTTON_X, 'button_blue']], [
      { type: 'bouncer', x: 2, dir: 'E' },
      { type: 'tank', x: TANK_X, dir: 'W' }
    ]);
    let arrived = -1;
    let flipped = -1;
    for (let t = 1; t <= 40 && flipped < 0; t++) {
      engine.tick();
      if (arrived < 0 && monsterOf(w, 'bouncer').x === BUTTON_X) arrived = t;
      if (monsterOf(w, 'tank').dir === 'E') flipped = t;
    }
    return { arrived, flipped };
  }

  it('turns the tanks when the press step starts, not when it ends', () => {
    const { arrived, flipped } = trace(true);
    expect(arrived).toBeGreaterThan(0);
    expect(flipped).toBe(arrived);
  });

  it('queues no press for it', () => {
    const { engine, w } = build(true, [[BUTTON_X, 'button_blue']], [{ type: 'bouncer', x: 3, dir: 'E' }]);
    for (let t = 0; t < 10; t++) {
      engine.tick();
      expect(w.ccArrivals.some((a) => a.action === 'reverse_tanks')).toBe(false);
    }
    expect(monsterOf(w).x).toBeGreaterThanOrEqual(BUTTON_X);
  });
});

describe('a monster stepping onto a teleporter', () => {
  const PADS: Array<[number, string]> = [[PAD_IN_X, 'teleport_forward'], [PAD_OUT_X, 'teleport_forward']];
  const WALKER = [{ type: 'bouncer', x: 2, dir: 'E' as Direction }];

  /** The x of the monster after each of `ticks` ticks. */
  function xs(converted: boolean, ticks: number): number[] {
    const { engine, w } = build(converted, PADS, WALKER);
    const out: number[] = [];
    for (let t = 0; t < ticks; t++) {
      engine.tick();
      out.push(monsterOf(w).x);
    }
    return out;
  }

  it('is moved when its step ends, then walks the fast exit step', () => {
    const run = xs(true, 12);
    const onPad = run.indexOf(PAD_IN_X);
    expect(onPad).toBeGreaterThanOrEqual(0);
    // It stands on the entry pad for the rest of the step, then is moved out in the tick the step ends.
    const jumped = run.indexOf(EXIT_X);
    expect(jumped - onPad).toBe(STEP_TICKS - 1);
    // The exit step lasts CC3D_MONSTER_FLOOR_STEP_TICKS ticks counted from the tick after the jump.
    const next = run.indexOf(EXIT_X + 1);
    expect(next - jumped).toBe(CC3D_MONSTER_FLOOR_STEP_TICKS + 1);
  });

  it('jumps at once on a native level', () => {
    const run = xs(false, 6);
    expect(run).not.toContain(PAD_IN_X);
    expect(run).toContain(EXIT_X);
  });

  it('sets the exit cooldown the way a floor step is written, scaled by slow time', () => {
    for (const slowdown of [1, 2]) {
      const { engine, w } = build(true, PADS, WALKER);
      if (slowdown === 2) w.player.boots = ['slow_time'];
      let ticks = 0;
      while (monsterOf(w).x !== EXIT_X && ticks++ < 40) engine.tick();
      expect(monsterOf(w).x).toBe(EXIT_X);
      // `ticks * slowdown - 1` for a step that begins in the move pass, plus the tick before the exit step starts and
      // the countdown tick the same pass spends: `ticks * slowdown + 1`, one of which is already spent in this pass.
      expect(monsterOf(w).cooldownTicks).toBe(CC3D_MONSTER_FLOOR_STEP_TICKS * slowdown);
    }
  });

  it('keeps a pending jump through an undo and a restore', () => {
    const { engine, w } = build(true, PADS, WALKER);
    while (monsterOf(w).x !== PAD_IN_X) engine.tick();
    expect(w.ccArrivals.some((a) => a.teleport === true)).toBe(true);
    const snapshot = engine.captureState();
    const run = (): number[] => {
      const out: number[] = [];
      for (let t = 0; t < 10; t++) {
        engine.tick();
        out.push(monsterOf(w).x);
      }
      return out;
    };
    const expected = run();
    engine.restoreState(snapshot);
    expect(w.ccArrivals.some((a) => a.teleport === true)).toBe(true);
    expect(run()).toEqual(expected);
    expect(expected).toContain(EXIT_X);
  });
});
