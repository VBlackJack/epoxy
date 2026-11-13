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

/**
 * The yellow tank of a CC2-engine level: an actor arriving on the yellow button sets a pending decision, the tank takes
 * it at its next decision, and a way blocked at that moment only turns the tank. Other levels keep the instant puppet step.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { ROOM_ROW, room } from '../../test/cc2Room';
import type { RoomMode } from '../../test/cc2Room';
import { ConfigRegistry } from '../../config/ConfigRegistry';
import { GameEngine } from '../GameEngine';
import type { Direction, RuntimeEntity } from '../types';
import type { EpoxyWorld } from './epoxyWorld';
import { markYellowButtonArrival } from './epoxySteering';

beforeEach(() => {
  loadTestConfigs();
});

const TANK = 'golem_yellow';
const BUTTON = 'puppet_control';
const BUG = 'bug';
const BUTTON_X = 3;
const TANK_CELL = { x: 6, y: 2 };
const SETTLE_TICKS = 40;
const FOREIGN_DUE = 99;
const CORRIDOR_BUTTON_X = 6;
const CORRIDOR_BUG_X = 7;

const world = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;
const tankOf = (engine: GameEngine): RuntimeEntity => {
  const tank = engine.getEntities().find((e) => e.type === TANK);
  if (tank === undefined) throw new Error('the room has a yellow tank');
  return tank;
};

function start(mode: RoomMode, extraTerrain: Record<string, string> = {}): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(
    room({
      mode,
      terrain: { [`${BUTTON_X},${ROOM_ROW}`]: BUTTON, ...extraTerrain },
      entities: [{ type: TANK, x: TANK_CELL.x, y: TANK_CELL.y, dir: 'N' }]
    })
  );
  return engine;
}

describe('yellow tank on a CC2-engine level', () => {
  it('starts ready to decide', () => {
    expect(tankOf(start('cc2')).cooldownTicks).toBe(0);
    expect(tankOf(start('native')).cooldownTicks).toBeGreaterThan(0);
  });

  it('takes the way of the player who stepped on the button at its next decision, not at once', () => {
    const engine = start('cc2');
    expect(engine.attemptPlayerMove('E')).toBe(true);
    const tank = tankOf(engine);
    expect(tank.x).toBe(TANK_CELL.x);
    expect(tank.y).toBe(TANK_CELL.y);
    for (let i = 0; i < SETTLE_TICKS; i++) engine.tick();
    const after = tankOf(engine);
    expect(after.pendingSteer).toBeUndefined();
    expect(after.x).toBeGreaterThan(TANK_CELL.x);
    expect(after.y).toBe(TANK_CELL.y);
  });

  it('only turns when the way is blocked at the decision', () => {
    const engine = start('cc2', { [`${TANK_CELL.x + 1},${TANK_CELL.y}`]: 'wall' });
    expect(engine.attemptPlayerMove('E')).toBe(true);
    for (let i = 0; i < SETTLE_TICKS; i++) engine.tick();
    const tank = tankOf(engine);
    expect(tank.pendingSteer).toBeUndefined();
    expect(tank.dir).toBe('E');
    expect(tank.x).toBe(TANK_CELL.x);
    expect(tank.y).toBe(TANK_CELL.y);
  });

  it('keeps the instant puppet step on a level that is not on the CC2 engine', () => {
    const engine = start('native');
    expect(engine.attemptPlayerMove('E')).toBe(true);
    const tank = tankOf(engine);
    expect(tank.pendingSteer).toBeUndefined();
    expect(tank.x).toBe(TANK_CELL.x + 1);
  });

  it('is set by a monster that arrives on the button', () => {
    const corridor: Record<string, string> = { [`${CORRIDOR_BUTTON_X},${ROOM_ROW}`]: BUTTON };
    for (let x = CORRIDOR_BUTTON_X - 1; x <= CORRIDOR_BUG_X + 1; x++) {
      corridor[`${x},${ROOM_ROW - 1}`] = 'wall';
      corridor[`${x},${ROOM_ROW + 1}`] = 'wall';
    }
    const engine = new GameEngine();
    engine.loadLevel(
      room({
        mode: 'cc2',
        startX: 1,
        terrain: corridor,
        entities: [
          { type: TANK, x: TANK_CELL.x, y: TANK_CELL.y, dir: 'N' },
          { type: BUG, x: CORRIDOR_BUG_X, y: ROOM_ROW, dir: 'W' }
        ]
      })
    );
    let sawPending: Direction | undefined;
    for (let i = 0; i < SETTLE_TICKS && sawPending === undefined; i++) {
      engine.tick();
      sawPending = tankOf(engine).pendingSteer;
    }
    expect(sawPending).toBe('W');
    expect(tankOf(engine).pendingSteerDue).toBeGreaterThan(0);
  });
});

describe('markYellowButtonArrival', () => {
  it('sets every yellow tank, with a due pass or none, and ignores other monsters and other engines', () => {
    const engine = new GameEngine();
    engine.loadLevel(
      room({
        mode: 'cc2',
        entities: [
          { type: TANK, x: TANK_CELL.x, y: TANK_CELL.y, dir: 'N' },
          { type: BUG, x: TANK_CELL.x + 2, y: TANK_CELL.y, dir: 'N' }
        ]
      })
    );
    markYellowButtonArrival(world(engine), 'S', FOREIGN_DUE);
    expect(tankOf(engine)).toMatchObject({ pendingSteer: 'S', pendingSteerDue: FOREIGN_DUE });
    markYellowButtonArrival(world(engine), 'W');
    expect(tankOf(engine).pendingSteer).toBe('W');
    expect(tankOf(engine).pendingSteerDue).toBeUndefined();
    expect(engine.getEntities().find((e) => e.type === BUG)?.pendingSteer).toBeUndefined();

    const native = start('native');
    markYellowButtonArrival(world(native), 'S');
    expect(tankOf(native).pendingSteer).toBeUndefined();
  });
});

describe('yellow tank decisions that wait', () => {
  const STEER: Direction = 'E';
  const FEW_TICKS = 6;

  function steered(floor: string): GameEngine {
    const engine = start('cc2', { [`${TANK_CELL.x},${TANK_CELL.y}`]: floor });
    const tank = tankOf(engine);
    tank.pendingSteer = STEER;
    tank.cooldownTicks = 0;
    return engine;
  }

  it('keeps the steer and its facing while the tank is a template on a clone machine', () => {
    const engine = steered('clone_machine');
    for (let i = 0; i < FEW_TICKS; i++) engine.tick();
    const tank = tankOf(engine);
    expect(tank.pendingSteer).toBe(STEER);
    expect(tank.dir).toBe('N');
    expect(tank.x).toBe(TANK_CELL.x);
    expect(tank.y).toBe(TANK_CELL.y);
  });

  it('keeps the steer while the tank sits in a closed trap', () => {
    const engine = steered('trap');
    for (let i = 0; i < FEW_TICKS; i++) engine.tick();
    const tank = tankOf(engine);
    expect(tank.pendingSteer).toBe(STEER);
    expect(tank.dir).toBe('N');
    expect(tank.x).toBe(TANK_CELL.x);
  });

  it('keeps the steer while the tank slides (a tank the floor carries)', () => {
    const def = ConfigRegistry.getEntityDef(TANK);
    if (def === undefined) throw new Error('the yellow tank has a definition');
    const carried = def.ignoresSlidingFloors;
    def.ignoresSlidingFloors = false;
    try {
      const engine = steered('ice');
      const first = tankOf(engine);
      world(engine).ccPlans.clear();
      engine.tick();
      expect(first.pendingSteer).toBe(STEER);
    } finally {
      def.ignoresSlidingFloors = carried;
    }
  });

  it('applies the steer on solid floor', () => {
    const engine = steered('floor');
    for (let i = 0; i < FEW_TICKS; i++) engine.tick();
    const tank = tankOf(engine);
    expect(tank.pendingSteer).toBeUndefined();
    expect(tank.dir).toBe(STEER);
  });
});
