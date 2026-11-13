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
 * CC2 engine: a blue-button mark on a tank in the middle of a step is kept until its next decision, and the tank turns
 * then (Lexy keeps pending_reverse); a classic-rules level spends the mark at once and the tank ignores the press.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { ROOM_ROW, room, type RoomMode } from '../../test/cc2Room';
import { GameEngine } from '../GameEngine';
import { turnMarkedTanks } from './epoxyDevices';
import type { EpoxyWorld } from './epoxyWorld';

beforeEach(() => {
  loadTestConfigs();
});

const TANK = 'tank';
const TANK_X = 6;
const MID_STEP_WAIT = 3;

const world = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;

function markedTank(mode: RoomMode) {
  const engine = new GameEngine();
  engine.loadLevel(room({ mode, entities: [{ type: TANK, x: TANK_X, y: ROOM_ROW, dir: 'W' }] }));
  const tank = world(engine).entities.find((e) => e.type === TANK)!;
  tank.tankTurn = world(engine).ccMonsterClock;
  return { engine, tank };
}

describe('CC2 engine: a tank in the middle of a step keeps the blue-button mark', () => {
  it('keeps the mark and the facing while the step lasts, then turns at its decision', () => {
    const { engine, tank } = markedTank('cc2');
    tank.cooldownTicks = MID_STEP_WAIT;
    turnMarkedTanks(world(engine));
    expect(tank.tankTurn).toBeDefined();
    expect(tank.dir).toBe('W');
    tank.cooldownTicks = 0;
    turnMarkedTanks(world(engine));
    expect(tank.tankTurn).toBeUndefined();
    expect(tank.dir).toBe('E');
  });

  it('turns a tank at rest at once', () => {
    const { engine, tank } = markedTank('cc2');
    tank.cooldownTicks = 0;
    turnMarkedTanks(world(engine));
    expect(tank.dir).toBe('E');
  });
});

describe('a classic-rules level spends the mark of a tank in the middle of a step', () => {
  it('cc level', () => {
    const { engine, tank } = markedTank('cc');
    tank.cooldownTicks = MID_STEP_WAIT;
    turnMarkedTanks(world(engine));
    expect(tank.tankTurn).toBeUndefined();
    expect(tank.dir).toBe('W');
  });
});
