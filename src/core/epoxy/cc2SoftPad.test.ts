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
 * The red and yellow pads of a CC2-engine level let the player decide the exit himself at his next decision (Lexy's Labyrinth
 * teleport-soft slide, game.js:1578-1620): a direction held then is a normal move from the destination pad (refused, he stays
 * and the forced exit is gone); with no direction the forced exit is taken then, one tick later than a plain pad, and its wait
 * is one tick shorter. The plain pads and the classic rules keep the forced exit.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { ConfigRegistry } from '../../config/ConfigRegistry';
import { playHeld, playMove } from '../../test/cc2Play';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { room, ROOM_ROW, type RoomMode } from '../../test/cc2Room';
import { GameEngine } from '../GameEngine';
import { playerWalkCooldown } from './epoxyPlayer';
import type { EpoxyWorld } from './epoxyWorld';

beforeEach(() => {
  loadTestConfigs();
});

const RED_PAD = 'teleport_red_cc2';
const YELLOW_PAD = 'teleport_forward';
const PLAIN_PAD = 'teleport';
const NEAR_PAD = 3;
const FAR_PAD = 8;
const EXIT_X = FAR_PAD + 1;
const SETTLE_TICKS = 20;

const world = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;

/** A player who stepped onto the near pad and was sent to the far one; the engine stands at the landing tick. */
function landed(mode: RoomMode, pad: string, extra: Record<string, string> = {}): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(
    room({ mode, startX: NEAR_PAD - 1, terrain: { [`${NEAR_PAD},${ROOM_ROW}`]: pad, [`${FAR_PAD},${ROOM_ROW}`]: pad, ...extra } })
  );
  expect(playMove(engine, 'E').moved).toBe(true);
  expect(engine.getPlayer().x).toBe(FAR_PAD);
  expect(engine.getPlayer().teleportExit).toBe('E');
  return engine;
}

/** Ticks until the wait after the landing is over and the player may decide: the tick the cooldown reaches 0. */
function waitOutLanding(engine: GameEngine): void {
  for (let t = 0; t < SETTLE_TICKS && engine.getPlayer().moveCooldown > 0; t++) engine.tick();
  expect(engine.getPlayer().moveCooldown).toBe(0);
}

/** The number of ticks from the landing until the forced exit step is taken. */
function ticksToExit(mode: RoomMode, pad: string): number {
  const engine = landed(mode, pad);
  // The landing tick (the one that played the step) is part of the count.
  for (let t = 1; t <= SETTLE_TICKS; t++) {
    engine.tick();
    if (engine.getPlayer().x === EXIT_X) return t + 1;
  }
  throw new Error('the player never left the pad');
}

describe('soft pads', () => {
  it('are the red and yellow pads of the CC2 engine, not the plain one', () => {
    expect(ConfigRegistry.getTile(RED_PAD).teleportSoftCc2).toBe(true);
    expect(ConfigRegistry.getTile(YELLOW_PAD).teleportSoftCc2).toBe(true);
    expect(ConfigRegistry.getTile(PLAIN_PAD).teleportSoftCc2).toBeUndefined();
  });
});

describe('the exit of a soft pad with no direction held', () => {
  it('is taken one tick later than the exit of a plain pad', () => {
    const plain = ticksToExit('cc2', PLAIN_PAD);
    expect(plain).toBe(playerWalkCooldown(world(landed('cc2', PLAIN_PAD))));
    expect(ticksToExit('cc2', RED_PAD)).toBe(plain + 1);
    expect(ticksToExit('cc2', YELLOW_PAD)).toBe(plain + 1);
  });

  it('opens the decision on the first tick after the wait and leaves on the next', () => {
    const engine = landed('cc2', RED_PAD);
    waitOutLanding(engine);
    expect(engine.getPlayer().x).toBe(FAR_PAD);
    expect(engine.getPlayer().softPadDue).toBe(true);
    engine.tick();
    expect(engine.getPlayer().x).toBe(EXIT_X);
    expect(engine.getPlayer().teleportExit).toBeUndefined();
    expect(engine.getPlayer().softPadDue).toBeUndefined();
  });

  it('makes the exit step one tick shorter, so the next decision comes as it did before', () => {
    const plain = landed('cc2', PLAIN_PAD);
    for (let t = 0; plain.getPlayer().x !== EXIT_X; t++) plain.tick();
    const soft = landed('cc2', RED_PAD);
    for (let t = 0; soft.getPlayer().x !== EXIT_X; t++) soft.tick();
    expect(soft.getPlayer().moveCooldown).toBe(plain.getPlayer().moveCooldown - 1);
  });

  it('is the forced exit of every pad on a classic-rules level', () => {
    expect(ticksToExit('cc', RED_PAD)).toBe(ticksToExit('cc', PLAIN_PAD));
  });
});

describe('a direction held at the decision on a soft pad', () => {
  it('is a normal move from the destination pad and the forced exit is gone', () => {
    const engine = landed('cc2', RED_PAD);
    waitOutLanding(engine);
    expect(engine.getPlayer().softPadDue).toBe(true);
    expect(playMove(engine, 'N').moved).toBe(true);
    expect(engine.getPlayer().x).toBe(FAR_PAD);
    expect(engine.getPlayer().y).toBe(ROOM_ROW - 1);
    expect(engine.getPlayer().teleportExit).toBeUndefined();
    expect(engine.getPlayer().softPadDue).toBeUndefined();
  });

  it('leaves him on the pad with the forced exit gone when the move is refused', () => {
    const engine = landed('cc2', RED_PAD, { [`${FAR_PAD},${ROOM_ROW - 1}`]: 'wall' });
    waitOutLanding(engine);
    expect(playMove(engine, 'N').moved).toBe(false);
    expect(engine.getPlayer().x).toBe(FAR_PAD);
    expect(engine.getPlayer().y).toBe(ROOM_ROW);
    expect(engine.getPlayer().teleportExit).toBeUndefined();
    for (let t = 0; t < SETTLE_TICKS; t++) engine.tick();
    expect(engine.getPlayer().x).toBe(FAR_PAD);
  });

  it('is refused before the decision opens, as a forced exit always was', () => {
    const engine = landed('cc2', RED_PAD);
    // Still waiting out the landing.
    expect(engine.attemptPlayerMove('N')).toBe(false);
    expect(engine.getPlayer().teleportExit).toBe('E');
  });

  it('is not offered on a plain pad nor on a classic-rules level: the forced exit is taken as the wait ends', () => {
    for (const [mode, pad] of [['cc2', PLAIN_PAD], ['cc', RED_PAD]] as const) {
      const engine = landed(mode, pad);
      expect(engine.attemptPlayerMove('N')).toBe(false);
      waitOutLanding(engine);
      expect(engine.getPlayer().softPadDue).toBeUndefined();
      expect(engine.getPlayer().teleportExit).toBeUndefined();
      expect(engine.getPlayer().x).toBe(EXIT_X);
    }
  });

  it('is undone with the forced exit it took away', () => {
    const engine = landed('cc2', YELLOW_PAD);
    waitOutLanding(engine);
    expect(engine.getPlayer().softPadDue).toBe(true);
    expect(playMove(engine, 'N').moved).toBe(true);
    expect(engine.undo()).toBe(true);
    expect(engine.getPlayer().x).toBe(FAR_PAD);
    expect(engine.getPlayer().y).toBe(ROOM_ROW);
    expect(engine.getPlayer().teleportExit).toBe('E');
    expect(engine.getPlayer().softPadDue).toBe(true);
  });
});

describe('two keys held at the decision on a soft pad', () => {
  it('are resolved as a normal two-key move from the destination pad', () => {
    const engine = landed('cc2', RED_PAD);
    waitOutLanding(engine);
    expect(engine.getPlayer().softPadDue).toBe(true);
    // North and west: the horizontal key leads, so he steps west off the pad.
    expect(playHeld(engine, ['N', 'W']).moved).toBe(true);
    expect(engine.getPlayer().x).toBe(FAR_PAD - 1);
    expect(engine.getPlayer().y).toBe(ROOM_ROW);
    expect(engine.getPlayer().teleportExit).toBeUndefined();
    expect(engine.getPlayer().softPadDue).toBeUndefined();
  });

  it('fall back on the other key when the first is blocked', () => {
    const engine = landed('cc2', RED_PAD, { [`${FAR_PAD - 1},${ROOM_ROW}`]: 'wall' });
    waitOutLanding(engine);
    expect(playHeld(engine, ['N', 'W']).moved).toBe(true);
    expect(engine.getPlayer().x).toBe(FAR_PAD);
    expect(engine.getPlayer().y).toBe(ROOM_ROW - 1);
    expect(engine.getPlayer().teleportExit).toBeUndefined();
  });

  it('leave him on the pad with the forced exit gone when both are blocked', () => {
    const engine = landed('cc2', RED_PAD, { [`${FAR_PAD - 1},${ROOM_ROW}`]: 'wall', [`${FAR_PAD},${ROOM_ROW - 1}`]: 'wall' });
    waitOutLanding(engine);
    playHeld(engine, ['N', 'W']);
    expect(engine.getPlayer().x).toBe(FAR_PAD);
    expect(engine.getPlayer().y).toBe(ROOM_ROW);
    expect(engine.getPlayer().teleportExit).toBeUndefined();
    for (let t = 0; t < SETTLE_TICKS; t++) engine.tick();
    expect(engine.getPlayer().x).toBe(FAR_PAD);
  });
});
