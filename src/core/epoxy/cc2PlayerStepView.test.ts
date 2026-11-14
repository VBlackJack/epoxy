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
 * The teeth of a CC2-engine level aim at where the player appears to be as the tick starts (Lexy's Labyrinth
 * pursue_player on visual_position): his cell minus the part of the step still to run, with a teleport keeping him on
 * the source pad until the exit step. The engine records that view; no other level records it.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { ROOM_ROW, room } from '../../test/cc2Room';
import { playMove } from '../../test/cc2Play';
import { GameEngine } from '../GameEngine';
import type { Cc2PlayerView } from '../types';
import { playerWalkCooldown } from './epoxyPlayer';
import type { EpoxyWorld } from './epoxyWorld';

beforeEach(() => {
  loadTestConfigs();
});

const START_X = 2;
const NEAR_PAD = 3;
const FAR_PAD = 8;
const MAX_TICKS = 40;
const PADS = { [`${NEAR_PAD},${ROOM_ROW}`]: 'teleport', [`${FAR_PAD},${ROOM_ROW}`]: 'teleport' };

function world(engine: GameEngine): EpoxyWorld {
  return (engine as unknown as { w: EpoxyWorld }).w;
}

const viewOf = (engine: GameEngine): Cc2PlayerView | undefined => world(engine).cc2PlayerView;

function load(level: ReturnType<typeof room>): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(level);
  return engine;
}

function waitOut(engine: GameEngine): void {
  for (let i = 0; i < MAX_TICKS && engine.getPlayer().moveCooldown > 0; i++) engine.tick();
}

describe('CC2 engine: the apparent player position', () => {
  it('stays on the cell he left until the tick after his move, whatever the move did', () => {
    const engine = load(room({ mode: 'cc2' }));
    engine.tick();
    expect(engine.attemptPlayerMove('E')).toBe(true);
    // The teeth of the next tick read this: he has not moved yet as far as they are concerned.
    expect(viewOf(engine)).toMatchObject({ x: START_X, y: ROOM_ROW, cooldown: 0 });
  });

  it('puts him the remaining part of the step behind his cell, with the real step length', () => {
    const engine = load(room({ mode: 'cc2' }));
    const walk = playerWalkCooldown(world(engine));
    expect(engine.attemptPlayerMove('E')).toBe(true);
    engine.tick();
    expect(viewOf(engine)).toEqual({ x: START_X + 1, y: ROOM_ROW, dir: 'E', cooldown: walk - 1, stepLength: walk });
    engine.tick();
    expect(viewOf(engine)?.cooldown).toBe(Math.max(0, walk - 2));
    waitOut(engine);
    engine.tick();
    expect(viewOf(engine)).toMatchObject({ x: START_X + 1, y: ROOM_ROW, cooldown: 0 });
  });

  it('takes the step length from the cooldown of the step, ice included', () => {
    const engine = load(room({ mode: 'cc2', terrain: { [`${START_X + 1},${ROOM_ROW}`]: 'ice' } }));
    expect(engine.attemptPlayerMove('E')).toBe(true);
    engine.tick();
    const view = viewOf(engine);
    expect(view?.x).toBe(START_X + 1);
    expect(view?.stepLength).toBe((view?.cooldown ?? 0) + 1);
  });

  it('records nothing on a DAT-style or native level', () => {
    for (const mode of ['cc', 'native'] as const) {
      const engine = load(room({ mode }));
      engine.tick();
      engine.attemptPlayerMove('E');
      for (let i = 0; i < 6; i++) engine.tick();
      expect(viewOf(engine)).toBeUndefined();
    }
  });

  it('forgets the view of a CC2 level when a DAT-style level is loaded on the same engine', () => {
    const engine = load(room({ mode: 'cc2' }));
    engine.attemptPlayerMove('E');
    engine.tick();
    expect(viewOf(engine)).toBeDefined();
    engine.loadLevel(room({ mode: 'cc' }));
    expect(viewOf(engine)).toBeUndefined();
    engine.attemptPlayerMove('E');
    for (let i = 0; i < 4; i++) engine.tick();
    expect(viewOf(engine)).toBeUndefined();
  });

  it('puts the view back on undo, mid-step', () => {
    const engine = load(room({ mode: 'cc2' }));
    engine.tick();
    engine.attemptPlayerMove('E');
    engine.tick();
    const mid = { ...viewOf(engine)! };
    waitOut(engine);
    engine.tick();
    engine.attemptPlayerMove('E');
    engine.tick();
    expect(viewOf(engine)).not.toEqual(mid);
    expect(engine.undo()).toBe(true);
    expect(viewOf(engine)).toMatchObject({ x: START_X + 1, y: ROOM_ROW, cooldown: 0 });
    expect(engine.undo()).toBe(true);
    expect(viewOf(engine)).toMatchObject({ x: START_X, y: ROOM_ROW, cooldown: 0 });
  });
});

describe('CC2 engine: the apparent position across a teleport', () => {
  it('stays on the source pad for the pad step, then is the destination pad on the first exit tick', () => {
    const engine = load(room({ mode: 'cc2', terrain: PADS }));
    engine.tick();
    // The tick that plays the move puts the player on the destination pad; the view the teeth of that tick read was recorded before it.
    expect(playMove(engine, 'E').accepted).toBe(true);
    expect(engine.getPlayer().x).toBe(FAR_PAD);
    expect(viewOf(engine)).toMatchObject({ x: NEAR_PAD, y: ROOM_ROW, dir: 'E', sourcePad: { x: NEAR_PAD, y: ROOM_ROW } });
    const walk = playerWalkCooldown(world(engine));
    expect(viewOf(engine)?.stepLength).toBe(walk);
    // Still on the pad until the exit step runs.
    let guard = 0;
    while (engine.getPlayer().teleportExit !== undefined && guard++ < MAX_TICKS) {
      expect(viewOf(engine)).toMatchObject({ x: NEAR_PAD, sourcePad: { x: NEAR_PAD, y: ROOM_ROW } });
      engine.tick();
      if (engine.getPlayer().teleportExit === undefined) break;
    }
    // The tick that ran the exit step: the teeth aimed at the destination pad, at rest.
    expect(engine.getPlayer().x).toBe(FAR_PAD + 1);
    expect(viewOf(engine)).toMatchObject({ x: FAR_PAD + 1, y: ROOM_ROW });
    expect(viewOf(engine)?.sourcePad).toBeUndefined();
  });

  it('is the destination pad (at rest) while the exit tick runs the teeth', () => {
    const engine = load(room({ mode: 'cc2', terrain: PADS }));
    playMove(engine, 'E');
    let sawDestination = false;
    for (let i = 0; i < MAX_TICKS && engine.getPlayer().x === FAR_PAD; i++) {
      engine.tick();
      const view = viewOf(engine);
      if (engine.getPlayer().x === FAR_PAD + 1) sawDestination = view?.x === FAR_PAD + 1 || view?.x === FAR_PAD;
    }
    expect(sawDestination).toBe(true);
  });

  it('restarting after a teleport mid-step starts with no view and no marker', () => {
    const level = room({ mode: 'cc2', terrain: PADS });
    const engine = load(level);
    engine.attemptPlayerMove('E');
    engine.tick();
    expect(viewOf(engine)?.sourcePad).toBeDefined();
    engine.loadLevel(level);
    expect(viewOf(engine)).toBeUndefined();
    engine.tick();
    expect(viewOf(engine)?.sourcePad).toBeUndefined();
    expect(viewOf(engine)).toMatchObject({ x: START_X, y: ROOM_ROW });
  });

  it('undo of the teleporting step drops the marker', () => {
    const engine = load(room({ mode: 'cc2', terrain: PADS }));
    engine.tick();
    engine.attemptPlayerMove('E');
    engine.tick();
    expect(viewOf(engine)?.sourcePad).toBeDefined();
    expect(engine.undo()).toBe(true);
    expect(viewOf(engine)?.sourcePad).toBeUndefined();
    expect(engine.getPlayer().x).toBe(START_X);
  });
});

describe('CC2 engine: the apparent position on a hand-off', () => {
  it('moves to the cell of the player who takes control, at rest', () => {
    const engine = load({ ...room({ mode: 'cc2' }), extraPlayers: [{ x: 9, y: ROOM_ROW, dir: 'W', character: 'chip' }] });
    engine.tick();
    engine.attemptPlayerMove('E');
    engine.tick();
    expect(viewOf(engine)).toMatchObject({ x: START_X + 1, cooldown: expect.any(Number) });
    expect(engine.swapPlayer()).toBe(true);
    expect(viewOf(engine)).toEqual({ x: 9, y: ROOM_ROW, dir: 'W', cooldown: 0, stepLength: 1 });
  });
});
