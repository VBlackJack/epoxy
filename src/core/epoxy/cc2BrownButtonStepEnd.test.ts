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
 * CC2 engine: the brown button feels the player when his step onto it ends, and holds the trap it is linked to for that
 * tick even if he leaves at once (Lexy's Labyrinth button_brown on_arrive / on_depart). Any other level presses the button
 * at the start of the step.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { ROOM_ROW, room, type RoomMode } from '../../test/cc2Room';
import { GameEngine } from '../GameEngine';
import { cc2HiddenStateKey, mapWidth, type EpoxyWorld } from './epoxyWorld';

beforeEach(() => {
  loadTestConfigs();
});

const BROWN_BUTTON = 'button_brown';
const TRAP = 'trap';
const BUTTON_X = 3;
const TRAP_X = 9;
const TRAP_Y = 9;
const MAX_TICKS = 40;

const world = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;
const trapClosed = (engine: GameEngine): boolean => engine.isCellClosedTrap(TRAP_X, TRAP_Y);

function load(mode: RoomMode): GameEngine {
  const level = room({ mode, terrain: { [`${BUTTON_X},${ROOM_ROW}`]: BROWN_BUTTON, [`${TRAP_X},${TRAP_Y}`]: TRAP } });
  level.trapLinks = [{ buttonX: BUTTON_X, buttonY: ROOM_ROW, trapX: TRAP_X, trapY: TRAP_Y }];
  const engine = new GameEngine();
  engine.loadLevel(level);
  return engine;
}

function waitOut(engine: GameEngine): void {
  let guard = 0;
  while (engine.getPlayer().moveCooldown > 0 && guard++ < MAX_TICKS) engine.tick();
}

describe('CC2 engine: a brown button works when the step onto it ends', () => {
  it('keeps the trap shut during the step and opens it when the step has ended', () => {
    const engine = load('cc2');
    expect(trapClosed(engine)).toBe(true);
    expect(engine.attemptPlayerMove('E')).toBe(true);
    expect(trapClosed(engine)).toBe(true);
    waitOut(engine);
    expect(trapClosed(engine)).toBe(true);
    engine.tick();
    expect(world(engine).cc2BrownHeld).toBeUndefined();
    // At rest on the button, the position holds it.
    expect(trapClosed(engine)).toBe(false);
  });

  it('holds the trap for the tick of the step end even when he leaves at once, and lets go after it', () => {
    const engine = load('cc2');
    engine.attemptPlayerMove('E');
    waitOut(engine);
    // The next input: the step-end press acts first, then he steps off the button.
    expect(engine.attemptPlayerMove('N')).toBe(true);
    expect(engine.getPlayer().y).toBe(ROOM_ROW - 1);
    expect(world(engine).cc2BrownHeld).toEqual([ROOM_ROW * mapWidth(world(engine)) + BUTTON_X]);
    expect(trapClosed(engine)).toBe(false);
    engine.tick();
    expect(world(engine).cc2BrownHeld).toBeUndefined();
    expect(trapClosed(engine)).toBe(true);
  });

  it('undo in the middle of the step and the step taken again reach the state of a straight run', () => {
    const straight = load('cc2');
    straight.attemptPlayerMove('E');
    waitOut(straight);
    straight.attemptPlayerMove('N');

    const redone = load('cc2');
    redone.attemptPlayerMove('E');
    redone.tick();
    expect(redone.undo()).toBe(true);
    expect(redone.getPlayer().cc3dArrival).toBeUndefined();
    redone.attemptPlayerMove('E');
    waitOut(redone);
    redone.attemptPlayerMove('N');
    expect(cc2HiddenStateKey(world(redone))).toBe(cc2HiddenStateKey(world(straight)));
    expect(JSON.stringify(redone.getPlayer())).toBe(JSON.stringify(straight.getPlayer()));
    expect(trapClosed(redone)).toBe(trapClosed(straight));
  });

  it('undo of the leaving step restores the held button of the step that ended', () => {
    const engine = load('cc2');
    engine.attemptPlayerMove('E');
    waitOut(engine);
    engine.attemptPlayerMove('N');
    const held = world(engine).cc2BrownHeld;
    expect(held).toBeDefined();
    expect(engine.undo()).toBe(true);
    expect(engine.getPlayer().x).toBe(BUTTON_X);
    expect(engine.getPlayer().y).toBe(ROOM_ROW);
    expect(trapClosed(engine)).toBe(false);
  });
});

describe('a level not on the CC2 engine presses the brown button at the start of the step', () => {
  it.each(['cc', 'native'] as const)('%s level', (mode) => {
    const engine = load(mode);
    expect(trapClosed(engine)).toBe(true);
    expect(engine.attemptPlayerMove('E')).toBe(true);
    expect(trapClosed(engine)).toBe(false);
    expect(engine.getPlayer().cc3dArrival?.brown).toBeUndefined();
    expect(world(engine).cc2BrownHeld).toBeUndefined();
  });
});

describe('CC2 engine: two players ending steps on two brown buttons in the same tick', () => {
  const OTHER_ROW = 7;
  const OTHER_BUTTON_X = 3;
  const OTHER_TRAP_X = 10;
  const OTHER_TRAP_Y = 9;

  function loadTwo(): GameEngine {
    const level = room({
      mode: 'cc2',
      terrain: {
        [`${BUTTON_X},${ROOM_ROW}`]: BROWN_BUTTON,
        [`${TRAP_X},${TRAP_Y}`]: TRAP,
        [`${OTHER_BUTTON_X},${OTHER_ROW}`]: BROWN_BUTTON,
        [`${OTHER_TRAP_X},${OTHER_TRAP_Y}`]: TRAP
      }
    });
    level.trapLinks = [
      { buttonX: BUTTON_X, buttonY: ROOM_ROW, trapX: TRAP_X, trapY: TRAP_Y },
      { buttonX: OTHER_BUTTON_X, buttonY: OTHER_ROW, trapX: OTHER_TRAP_X, trapY: OTHER_TRAP_Y }
    ];
    level.extraPlayers = [{ x: 2, y: OTHER_ROW, dir: 'E', character: 'chip' }];
    const engine = new GameEngine();
    engine.loadLevel(level);
    return engine;
  }

  /** Puts the controlled player on a brown button with its step-end pending, as a finished step leaves him. */
  function endStepOn(engine: GameEngine, x: number, y: number): void {
    const p = engine.getPlayer();
    p.x = x;
    p.y = y;
    p.moveCooldown = 0;
    p.cc3dArrival = { brown: { x, y } };
    engine.flushPendingStepEnd();
  }

  it.each([
    ['first player first', false],
    ['second player first', true]
  ])('holds both buttons, in ascending cell order, until the tick ends (%s)', (_label, secondFirst) => {
    const engine = loadTwo();
    const width = mapWidth(world(engine));
    const first = ROOM_ROW * width + BUTTON_X;
    const second = OTHER_ROW * width + OTHER_BUTTON_X;
    if (secondFirst) expect(engine.swapPlayer()).toBe(true);
    endStepOn(engine, secondFirst ? OTHER_BUTTON_X : BUTTON_X, secondFirst ? OTHER_ROW : ROOM_ROW);
    expect(world(engine).cc2BrownHeld).toEqual([secondFirst ? second : first]);
    expect(engine.swapPlayer()).toBe(true);
    endStepOn(engine, secondFirst ? BUTTON_X : OTHER_BUTTON_X, secondFirst ? ROOM_ROW : OTHER_ROW);
    expect(world(engine).cc2BrownHeld).toEqual([first, second]);
    expect(cc2HiddenStateKey(world(engine))).toContain(`b${first},${second}`);
    expect(engine.captureState().cc2BrownHeld).toEqual([first, second]);
    engine.tick();
    expect(world(engine).cc2BrownHeld).toBeUndefined();
  });
});
