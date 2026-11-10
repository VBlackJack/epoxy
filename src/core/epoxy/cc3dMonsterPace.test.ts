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

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { GameEngine } from '../GameEngine';
import type { CompiledLevel, Direction, EntityPlacement } from '../types';
import { pressesPlate } from './epoxyWorld';
import type { EpoxyWorld } from './epoxyWorld';

/**
 * The monsters of a CC3D level converted to Epoxy keep the CC3D cadence: they decide at tick 0, a step lasts four ticks
 * (two when the floor carries the monster or it enters ice or a force floor), a blocked monster tries again at once, a
 * monster works a plate only once its step has ended, its button press takes effect when the step ends, and a block that
 * rests on a force floor at the start is carried as play starts. Native levels and levels of the classic rules are unchanged.
 */

beforeEach(() => {
  loadTestConfigs();
});

type Flavor = 'native' | 'converted' | 'cc';

const ROW_Y = 1;
const PLAYER_X = 1;
const FLOOR = 'floor';
const WALL = 'wall';
const RUN_TICKS = 40;
const PLAIN_STEP_TICKS = 4;
const FLOOR_STEP_TICKS = 2;
const REST_STEP_TICKS = 8;
const BLOCKED_REST_TICKS = 3;
/** Ticks between the arrival on a button and its press when the step lasts four ticks. */
const PRESS_DELAY_TICKS = 3;

function corridor(cells: string[], entities: EntityPlacement[], flavor: Flavor, playerX = PLAYER_X): CompiledLevel {
  const row = [WALL, ...cells, WALL];
  const wall = row.map(() => WALL);
  const terrain = [wall, row, wall];
  const level: CompiledLevel = {
    id: 'monster_pace',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    playerStart: { x: playerX, y: ROW_Y, dir: 'E' },
    terrain,
    items: terrain.map((r) => r.map(() => null)),
    entities,
    trapLinks: [],
    cloneLinks: []
  };
  if (flavor === 'converted') return { ...level, cc3dSource: {} } as unknown as CompiledLevel;
  if (flavor === 'cc') return { ...level, rulesFlavor: 'cc' };
  return level;
}

function start(cells: string[], entities: EntityPlacement[], flavor: Flavor, playerX = PLAYER_X): { engine: GameEngine; w: EpoxyWorld } {
  const engine = new GameEngine();
  engine.loadLevel(corridor(cells, entities, flavor, playerX));
  return { engine, w: (engine as unknown as { w: EpoxyWorld }).w };
}

function monsterOf(w: EpoxyWorld): EpoxyWorld['entities'][number] {
  const monster = w.entities.find((e) => e.kind === 'monster');
  if (monster === undefined) throw new Error('no monster');
  return monster;
}

/** The ticks, counted from the call, at which the first monster changes cell. */
function stepTicks(engine: GameEngine, w: EpoxyWorld, ticks = RUN_TICKS): number[] {
  const out: number[] = [];
  let last = monsterOf(w).x;
  for (let t = 1; t <= ticks; t++) {
    engine.tick();
    const now = monsterOf(w).x;
    if (now !== last) out.push(t);
    last = now;
  }
  return out;
}

function gaps(ticks: number[]): number[] {
  return ticks.slice(1).map((t, i) => t - ticks[i]);
}

const OPEN_FLOOR = Array.from({ length: 24 }, () => FLOOR);
const ICE_LANE = [FLOOR, ...Array.from({ length: 24 }, () => 'ice')];
const FORCE_LANE = [FLOOR, ...Array.from({ length: 24 }, () => 'force_e')];
const BOUNCER_AT = (x: number, dir: Direction = 'E'): EntityPlacement[] => [{ type: 'bouncer', x, y: ROW_Y, dir }];

describe('the first step', () => {
  it('is taken at tick 0 on a converted level, after the first interval on a native one', () => {
    const converted = start(OPEN_FLOOR, BOUNCER_AT(4), 'converted');
    expect(monsterOf(converted.w).cooldownTicks).toBe(0);
    expect(stepTicks(converted.engine, converted.w)[0]).toBe(1);

    const native = start(OPEN_FLOOR, BOUNCER_AT(4), 'native');
    expect(monsterOf(native.w).cooldownTicks).toBeGreaterThan(0);
    expect(stepTicks(native.engine, native.w)[0]).toBeGreaterThan(1);
  });

  it('keeps the native wait on a level of the classic rules', () => {
    const cc = start(OPEN_FLOOR, BOUNCER_AT(4), 'cc');
    expect(cc.w.cc3dPace).toBe(false);
    expect(monsterOf(cc.w).cooldownTicks).toBeGreaterThan(0);
  });
});

describe('the length of a step', () => {
  it('is four ticks on plain floor', () => {
    const { engine, w } = start(OPEN_FLOOR, BOUNCER_AT(2), 'converted');
    const ticks = stepTicks(engine, w);
    expect(ticks.length).toBeGreaterThan(3);
    expect(new Set(gaps(ticks))).toEqual(new Set([PLAIN_STEP_TICKS]));
  });

  it('is two ticks when the monster enters and leaves ice', () => {
    const { engine, w } = start(ICE_LANE, BOUNCER_AT(3), 'converted');
    const ticks = stepTicks(engine, w);
    expect(ticks.length).toBeGreaterThan(5);
    expect(new Set(gaps(ticks))).toEqual(new Set([FLOOR_STEP_TICKS]));
  });

  it('is two ticks on a force floor', () => {
    const { engine, w } = start(FORCE_LANE, BOUNCER_AT(3), 'converted');
    const ticks = stepTicks(engine, w);
    expect(ticks.length).toBeGreaterThan(5);
    expect(new Set(gaps(ticks))).toEqual(new Set([FLOOR_STEP_TICKS]));
  });

  it('stays four ticks on ice for a monster the floor does not carry', () => {
    const { engine, w } = start(ICE_LANE, [{ type: 'blinky', x: 3, y: ROW_Y, dir: 'E' }], 'converted');
    const ticks = stepTicks(engine, w);
    expect(ticks.length).toBeGreaterThan(3);
    expect(new Set(gaps(ticks))).toEqual(new Set([PLAIN_STEP_TICKS]));
  });

  it('is eight ticks for an omni on plain floor, two on ice', () => {
    const plain = start(OPEN_FLOOR, [{ type: 'omni', x: 8, y: ROW_Y, dir: 'E' }], 'converted');
    const plainTicks = stepTicks(plain.engine, plain.w, 120);
    expect(plainTicks.length).toBeGreaterThan(1);
    expect(Math.min(...gaps(plainTicks))).toBeGreaterThanOrEqual(REST_STEP_TICKS);

    const ice = start(ICE_LANE, [{ type: 'omni', x: 8, y: ROW_Y, dir: 'E' }], 'converted');
    const iceTicks = stepTicks(ice.engine, ice.w, 120);
    expect(iceTicks.length).toBeGreaterThan(2);
    expect(Math.min(...gaps(iceTicks))).toBe(FLOOR_STEP_TICKS);
  });

  it('keeps the native pace on a native level', () => {
    const { engine, w } = start(ICE_LANE, BOUNCER_AT(3), 'native');
    const ticks = stepTicks(engine, w);
    expect(Math.min(...gaps(ticks))).toBeGreaterThan(FLOOR_STEP_TICKS);
  });
});

describe('a blocked monster', () => {
  const BOXED = [FLOOR, FLOOR, WALL, FLOOR, WALL, FLOOR, FLOOR];

  it('is ready again at once on a converted level', () => {
    const { engine, w } = start(BOXED, BOUNCER_AT(4), 'converted', 6);
    engine.tick();
    expect(monsterOf(w).x).toBe(4);
    expect(monsterOf(w).cooldownTicks).toBe(0);
  });

  it('keeps its full rest on a native level', () => {
    const { engine, w } = start(BOXED, BOUNCER_AT(4), 'native', 6);
    for (let i = 0; i < 12; i++) engine.tick();
    expect(monsterOf(w).x).toBe(4);
    expect(monsterOf(w).cooldownTicks).toBeGreaterThan(0);
  });

  it('is three ticks from ready for a snappy', () => {
    // The snappy chases the player in the sealed cell on its left, behind a wall.
    const cells = [FLOOR, WALL, FLOOR, FLOOR, FLOOR];
    const { engine, w } = start(cells, [{ type: 'snappy', x: 3, y: ROW_Y, dir: 'W' }], 'converted', 1);
    engine.tick();
    expect(monsterOf(w).x).toBe(3);
    expect(monsterOf(w).cooldownTicks).toBe(BLOCKED_REST_TICKS);
  });
});

describe('a monster on a plate', () => {
  const PLATE_X = 3;
  const PLATE_ROW = [FLOOR, FLOOR, 'pressure_plate_red', 'hold_door_red_closed', FLOOR];

  it('presses it only once its step has ended', () => {
    const { w } = start(PLATE_ROW, [{ type: 'walker_3d', x: PLATE_X, y: ROW_Y, dir: 'N' }], 'converted');
    const monster = monsterOf(w);
    monster.cooldownTicks = 2;
    expect(pressesPlate(w, PLATE_X, ROW_Y, 'red')).toBe(false);
    monster.cooldownTicks = 0;
    expect(pressesPlate(w, PLATE_X, ROW_Y, 'red')).toBe(true);
  });

  it('presses it at any time on a native level', () => {
    const { w } = start(PLATE_ROW, [{ type: 'walker', x: PLATE_X, y: ROW_Y, dir: 'N' }], 'native');
    monsterOf(w).cooldownTicks = 2;
    expect(pressesPlate(w, PLATE_X, ROW_Y, 'red')).toBe(true);
  });
});

describe('a button pressed by a monster', () => {
  const BUTTON_X = 5;
  const WALL_X = 8;
  const CELLS = [FLOOR, FLOOR, FLOOR, FLOOR, 'button_green', FLOOR, FLOOR, 'toggle_wall_closed', FLOOR];

  function ticksOfPress(flavor: Flavor): { arrival: number; flip: number } {
    const { engine, w } = start(CELLS, [{ type: 'bouncer', x: 3, y: ROW_Y, dir: 'E' }], flavor);
    let arrival = -1;
    let flip = -1;
    for (let t = 1; t <= RUN_TICKS && flip < 0; t++) {
      engine.tick();
      if (arrival < 0 && monsterOf(w).x === BUTTON_X) arrival = t;
      if (engine.getTerrain()[ROW_Y][WALL_X] !== 'toggle_wall_closed') flip = t;
    }
    return { arrival, flip };
  }

  it('takes effect when the step ends on a converted level', () => {
    const { arrival, flip } = ticksOfPress('converted');
    expect(arrival).toBeGreaterThan(0);
    expect(flip - arrival).toBe(PRESS_DELAY_TICKS);
  });

  it('takes effect at once on a native level', () => {
    const { arrival, flip } = ticksOfPress('native');
    expect(arrival).toBeGreaterThan(0);
    expect(flip).toBe(arrival);
  });
});

describe('a block resting on a force floor at the start', () => {
  const CELLS = [FLOOR, FLOOR, 'force_e', 'force_e', 'force_e', FLOOR, FLOOR, FLOOR];

  it('is carried as play starts on a converted level', () => {
    const { engine, w } = start(CELLS, [{ type: 'ice_block_3d', x: 3, y: ROW_Y, dir: 'N' }], 'converted');
    const block = w.entities.find((e) => e.kind === 'block');
    expect(block?.isSliding).toBe(true);
    for (let i = 0; i < 6; i++) engine.tick();
    expect(block?.x).toBeGreaterThan(3);
  });

  it('stays put on a native level', () => {
    const { engine, w } = start(CELLS, [{ type: 'ice_block_3d', x: 3, y: ROW_Y, dir: 'N' }], 'native');
    for (let i = 0; i < 6; i++) engine.tick();
    expect(w.entities.find((e) => e.kind === 'block')?.x).toBe(3);
  });
});

describe('determinism', () => {
  const CELLS = [FLOOR, FLOOR, FLOOR, 'button_green', 'ice', 'ice', FLOOR, 'toggle_wall_closed', FLOOR, FLOOR, FLOOR, FLOOR];
  const ENTITIES: EntityPlacement[] = [
    { type: 'bouncer', x: 3, y: ROW_Y, dir: 'E' },
    { type: 'snappy', x: 10, y: ROW_Y, dir: 'W' }
  ];

  function trace(engine: GameEngine, w: EpoxyWorld, ticks: number): string[] {
    const out: string[] = [];
    for (let i = 0; i < ticks; i++) {
      engine.tick();
      out.push(w.entities.map((e) => `${e.type}@${e.x}:${e.cooldownTicks}`).join(',') + `|${w.ccMonsterClock}|${w.ccArrivals.length}|${engine.getTerrain()[ROW_Y].join('')}`);
    }
    return out;
  }

  it('plays the same twice', () => {
    const a = start(CELLS, ENTITIES, 'converted', 12);
    const b = start(CELLS, ENTITIES, 'converted', 12);
    expect(trace(a.engine, a.w, RUN_TICKS)).toEqual(trace(b.engine, b.w, RUN_TICKS));
  });

  it('plays the same after an undo, with a press waiting', () => {
    const run = (withUndo: boolean): string[] => {
      const { engine, w } = start(CELLS, ENTITIES, 'converted', 12);
      trace(engine, w, 3);
      if (withUndo) {
        engine.attemptPlayerMove('W');
        trace(engine, w, 6);
        expect(engine.undo()).toBe(true);
      }
      engine.attemptPlayerMove('W');
      return trace(engine, w, RUN_TICKS);
    };
    expect(run(true)).toEqual(run(false));
  });
});
