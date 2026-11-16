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
 * CC2 wave 14, review fixes: a block whose plain step ends in frame 0 and settles in the frame pre-pass onto a pink plate wired to a
 * clone machine presses it in frame 0, so the clone it releases is a press of frame 0 (a 12-frame step out of turn from frame 0 ends
 * 11 frames later: three tics and frame 2, game.js:869-888 and 2218-2242), not a press of frame 1. A block cloned onto a clone
 * machine is settled the same way whatever the frame (a held arrival is never kept on a clone machine).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { ROOM_ROW, room, type RoomMode } from '../../test/cc2Room';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { GameEngine } from '../GameEngine';
import type { RuntimeEntity, SignalLink } from '../types';
import { holdFrameArrival } from './epoxyFrames';
import type { EpoxyWorld } from './epoxyWorld';

beforeEach(() => {
  loadTestConfigs();
});

const PLATE_X = 5;
const CLONER_X = 8;
const CLONE_X = CLONER_X + 1;
const PLAYER_START_X = 11;
const BLOCK = 'dirt_block';
const PLATE = 'signal_plate';
const CLONE_MACHINE = 'clone_machine';
/** A press of frame 0: the 12-frame step out of turn ends 11 frames later, in frame 2 of the third tic after. */
const FRAME_0_CLONE_WAIT = 3;
const FRAME_0_CLONE_FRAME = 2;
/** A press of frame 1: the step ends 12 frames later, in frame 0 of the fourth tic after. */
const FRAME_1_CLONE_WAIT = 4;
const FRAME_1_CLONE_FRAME = 0;

function loadPlateLane(mode: RoomMode, arrivalFrame: 0 | 1): GameEngine {
  const level = room({
    mode,
    startX: PLAYER_START_X,
    terrain: { [`${PLATE_X},${ROOM_ROW}`]: PLATE, [`${CLONER_X},${ROOM_ROW}`]: CLONE_MACHINE },
    entities: [
      { type: BLOCK, x: CLONER_X, y: ROOM_ROW, dir: 'E' },
      { type: BLOCK, x: PLATE_X, y: ROOM_ROW, dir: 'E' }
    ]
  });
  const links: SignalLink[] = [{ fromX: PLATE_X, fromY: ROOM_ROW, toX: CLONER_X, toY: ROOM_ROW }];
  level.signalLinks = links;
  const engine = new GameEngine();
  engine.loadLevel(level);
  const pushed = engine.getEntities().find((e) => e.x === PLATE_X && e.y === ROOM_ROW) as RuntimeEntity;
  // The block reaches the plate: its plain step ends in the frame of the coming pre-pass.
  pushed.arrivalTicks = 1;
  pushed.cc2ArrivalWait = 1;
  pushed.cc2ArrivalFrame = arrivalFrame;
  return engine;
}

const cloneOf = (engine: GameEngine): RuntimeEntity | undefined => engine.getEntities().find((e) => e.type === BLOCK && e.x === CLONE_X && e.y === ROOM_ROW);

describe('a block that settles in the frame pre-pass presses in the frame it arrived in', () => {
  // Lexy game.js:869-888: each frame is decision, action, wire; the press reaches the wire phase of the frame the step ended in.
  it('a frame 0 arrival on a pink plate releases its clone as a press of frame 0', () => {
    const engine = loadPlateLane('cc2', 0);
    engine.tick();
    const clone = cloneOf(engine);
    expect(clone?.cc2ArrivalWait).toBe(FRAME_0_CLONE_WAIT);
    expect(clone?.cc2ArrivalFrame).toBe(FRAME_0_CLONE_FRAME);
  });

  it('a frame 1 arrival releases its clone as a press of frame 1', () => {
    const engine = loadPlateLane('cc2', 1);
    engine.tick();
    const clone = cloneOf(engine);
    expect(clone?.cc2ArrivalWait).toBe(FRAME_1_CLONE_WAIT);
    expect(clone?.cc2ArrivalFrame).toBe(FRAME_1_CLONE_FRAME);
  });

  it('holds nothing on a level that is not CC2', () => {
    const engine = loadPlateLane('native', 0);
    engine.tick();
    expect(cloneOf(engine)?.cc2ArrivalWait).toBeUndefined();
  });
});

const MACHINE_X = 4;
const PUSHER_X = 2;
const FRAMES_PER_TICK = 3;
/** Totals of frames that end a held step in frame 0, 1 and 2 of a later tic. */
const HELD_TOTALS = [12, 13, 14] as const;

function loadMachineRow(onMachine: boolean): { engine: GameEngine; block: RuntimeEntity } {
  const level = room({
    mode: 'cc2',
    startX: PUSHER_X,
    terrain: onMachine ? { [`${MACHINE_X},${ROOM_ROW}`]: CLONE_MACHINE } : {},
    entities: [{ type: 'ice_block', x: MACHINE_X - 1, y: ROOM_ROW, dir: 'E' }]
  });
  const engine = new GameEngine();
  engine.loadLevel(level);
  const block = engine.getEntities().find((e) => e.type === 'ice_block') as RuntimeEntity;
  return { engine, block };
}

describe('a block that arrives on an empty clone machine is never held for a frame', () => {
  // Lexy: a block on a clone machine does not step on its own, so its arrival only counts down whatever the frame it ends in.
  it.each(HELD_TOTALS)('holds nothing for a step that ends %i frames on, and still does on a plain cell', (total) => {
    const onMachine = loadMachineRow(true);
    onMachine.block.x = MACHINE_X;
    onMachine.block.arrivalTicks = 1;
    holdFrameArrival((onMachine.engine as unknown as { w: EpoxyWorld }).w, onMachine.block, total);
    expect(onMachine.block.cc2ArrivalWait).toBeUndefined();
    expect(onMachine.block.cc2ArrivalFrame).toBeUndefined();

    const onFloor = loadMachineRow(false);
    onFloor.block.arrivalTicks = 1;
    holdFrameArrival((onFloor.engine as unknown as { w: EpoxyWorld }).w, onFloor.block, total);
    expect(onFloor.block.cc2ArrivalWait).toBeGreaterThanOrEqual(Math.floor(total / FRAMES_PER_TICK));
    expect(onFloor.block.cc2ArrivalFrame).toBe(total % FRAMES_PER_TICK);
  });

  it('a block the player pushes onto the machine counts its arrival down at the pass and is not held', () => {
    const { engine, block } = loadMachineRow(true);
    engine.attemptPlayerMove('E');
    engine.tick();
    expect(block.x).toBe(MACHINE_X);
    expect(block.cc2ArrivalWait).toBeUndefined();
    for (let i = 0; i < 40 && block.arrivalTicks !== undefined; i++) engine.tick();
    expect(block.arrivalTicks).toBeUndefined();
  });
});
