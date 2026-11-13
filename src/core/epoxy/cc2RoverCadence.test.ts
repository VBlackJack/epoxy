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
import { teethMayDecide } from '../coreConstants';
import { GameEngine } from '../GameEngine';
import type { CompiledLevel, EntityPlacement } from '../types';

const SIZE = 13;
const CENTER = 6;
const TIME_LIMIT_SECONDS = 1000;
const ROVER = 'rover';
/** The rover's list: teeth first, then the glider, the bug, the pink ball. */
const TEETH_EMULATEE = 0;
const BUG_EMULATEE = 2;
const SWITCH_ATTEMPTS = 32;
/** A CC2 rover steps in this many ticks (Lexy movement_speed 8). */
const ROVER_CC2_STEP_TICKS = 8;
const STEPS_OBSERVED = 5;
const MIN_STEPS_SEEN = 4;
/** The native rover waits its own interval, then moves on the next tick. */
const nativeStepTicks = (): number => (ConfigRegistry.getEntityDef(ROVER)?.moveIntervalTicks ?? 0) + 1;
/** The player is shut in a pocket, so the rover never reaches them. */
const POCKET: Array<[number, number, string]> = [
  [3, 1, 'steel_wall'],
  [2, 2, 'steel_wall'],
  [1, 2, 'steel_wall']
];

type Flavor = 'native' | 'classic' | 'cc2';

function room(flavor: Flavor, player: { x: number; y: number } = { x: 1, y: 1 }): CompiledLevel {
  const terrain: string[][] = Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x) => (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? 'wall' : 'floor'))
  );
  for (const [x, y, id] of POCKET) terrain[y][x] = id;
  const entities: EntityPlacement[] = [{ type: ROVER, x: CENTER, y: CENTER, dir: 'E' }];
  return {
    id: 'cc2_rover_cadence',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: TIME_LIMIT_SECONDS,
    chipsRequired: 0,
    playerStart: { ...player, dir: 'N' },
    terrain,
    items: Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null)),
    entities,
    trapLinks: [],
    cloneLinks: [],
    ...(flavor === 'classic' ? { rulesFlavor: 'cc' as const } : {}),
    ...(flavor === 'cc2' ? { rulesFlavor: 'cc' as const, cc2: {} as never } : {})
  };
}

function find(engine: GameEngine) {
  return engine.getEntities().find((e) => e.type === ROVER);
}

function load(flavor: Flavor, emulatee: number, player?: { x: number; y: number }): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(room(flavor, player));
  const rover = find(engine);
  if (rover === undefined) throw new Error('the rover is missing');
  rover.emulatee = emulatee;
  rover.emulationMoves = 0;
  return engine;
}

/** The 1-based ticks at which the rover changed cell, over `count` ticks. */
function moveTicks(engine: GameEngine, count: number): number[] {
  const ticks: number[] = [];
  let last = `${find(engine)?.x},${find(engine)?.y}`;
  for (let tick = 1; tick <= count; tick++) {
    engine.tick();
    const now = `${find(engine)?.x},${find(engine)?.y}`;
    if (now !== last) ticks.push(tick);
    last = now;
  }
  return ticks;
}

function gaps(ticks: number[]): number[] {
  return ticks.slice(1).map((tick, i) => tick - ticks[i]);
}

beforeEach(() => {
  loadTestConfigs();
});

describe('rover on the classic cadence (CC2 engine)', () => {
  it('is configured on the CC2 engine only, with an 8-tick step', () => {
    const rover = ConfigRegistry.getEntityDef(ROVER);
    expect(rover?.cc2Cadence).toBe(true);
    expect(rover?.ccCadence).toBeUndefined();
    expect(rover?.ccStepTicks).toBe(ROVER_CC2_STEP_TICKS);
  });

  it('steps every 8 ticks on a CC2 level', () => {
    const ticks = moveTicks(load('cc2', BUG_EMULATEE), ROVER_CC2_STEP_TICKS * STEPS_OBSERVED);
    expect(ticks.length).toBeGreaterThanOrEqual(MIN_STEPS_SEEN);
    for (const gap of gaps(ticks)) expect(gap).toBe(ROVER_CC2_STEP_TICKS);
  });

  it('keeps its own step on a native level and on a classic level that is not CC2', () => {
    for (const flavor of ['native', 'classic'] as const) {
      const ticks = moveTicks(load(flavor, BUG_EMULATEE), nativeStepTicks() * STEPS_OBSERVED);
      expect(ticks.length, flavor).toBeGreaterThanOrEqual(MIN_STEPS_SEEN);
      for (const gap of gaps(ticks)) expect(gap, flavor).toBe(nativeStepTicks());
    }
  });

  it('counts each decision once: 32 decisions switch the imitated monster exactly once', () => {
    const engine = load('cc2', BUG_EMULATEE);
    const counts: number[] = [];
    let switches = 0;
    let previous = BUG_EMULATEE;
    for (let tick = 0; tick < ROVER_CC2_STEP_TICKS * SWITCH_ATTEMPTS; tick++) {
      engine.tick();
      const rover = find(engine);
      if (rover?.emulatee !== previous) {
        switches++;
        previous = rover?.emulatee ?? previous;
      }
      if (counts[counts.length - 1] !== rover?.emulationMoves) counts.push(rover?.emulationMoves ?? 0);
    }
    expect(switches).toBe(1);
    expect(find(engine)?.emulatee).toBe(BUG_EMULATEE + 1);
    // The count climbed one decision at a time, from 1 to 31, then restarted at the 32nd decision.
    expect(counts.slice(0, SWITCH_ATTEMPTS - 1)).toEqual([...Array(SWITCH_ATTEMPTS - 1).keys()].map((i) => i + 1));
  });

  it('chases only in the teeth window and decides nothing outside it', () => {
    const engine = load('cc2', TEETH_EMULATEE, { x: CENTER + 4, y: CENTER });
    let firstWindowClock = 0;
    while (!teethMayDecide(firstWindowClock, true)) firstWindowClock++;
    const ticks = moveTicks(engine, firstWindowClock + 2);
    // Every tick before the window is one counted decision that moves nothing; the first step comes in the window.
    expect(ticks).toEqual([firstWindowClock + 1]);
    expect(find(engine)?.emulationMoves).toBe(firstWindowClock + 1);
  });

  it('a rover that imitates the bug does not wait for the window', () => {
    expect(moveTicks(load('cc2', BUG_EMULATEE), 2)).toEqual([1]);
  });
});
