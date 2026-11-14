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
 * CC2 wave 8, mirror players: on the CC2 engine a mirror is an actor with its own walking cadence that reads the move the
 * player last decided (MC), in an order set by the actor list (MC2), holds the tools and keys it takes (MI) and is barred by
 * lit dynamite (LD). A native level keeps the copy of each input.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { ROOM_ROW, room } from '../../test/cc2Room';
import type { RoomMode } from '../../test/cc2Room';
import { GameEngine } from '../GameEngine';
import type { CompiledLevel, Direction, EntityPlacement, RuntimeEntity } from '../types';

beforeEach(() => {
  loadTestConfigs();
});

const MIRROR_CHIP = 'mirror_chip';
const MIRROR_MELINDA = 'mirror_melinda';
const BROWN_BUTTON = 'button_brown';
const TRAP = 'trap';

/** A mirror's walking step in ticks (the move tick and three of cooldown). */
const MIRROR_STEP_TICKS = 4;
/** The player's start cell in the test rooms. */
const START_X = 2;

const mirrorOf = (engine: GameEngine, type = MIRROR_CHIP): RuntimeEntity => {
  const found = engine.getEntities().find((e) => e.type === type);
  if (found === undefined) throw new Error('the room has the mirror');
  return found;
};

const cellOf = (engine: GameEngine, type = MIRROR_CHIP): string => {
  const e = mirrorOf(engine, type);
  return `${e.x},${e.y}`;
};

function load(level: CompiledLevel): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(level);
  return engine;
}

function mirrorRoom(mode: RoomMode, entities: EntityPlacement[], extra: { terrain?: Record<string, string>; items?: Record<string, string> } = {}): CompiledLevel {
  return room({ mode, startX: START_X, entities, ...extra });
}

/** Every tick the player tries `dir` against a wall, then the tick runs; returns the mirror's cell after each tick. */
function cellsWhileBlocked(mode: RoomMode, ticks: number, dir: Direction): string[] {
  const engine = load(mirrorRoom(mode, [{ type: MIRROR_CHIP, x: 7, y: 9, dir: 'N' }], { terrain: { [`${START_X},${ROOM_ROW - 1}`]: 'wall' } }));
  const cells: string[] = [];
  for (let t = 0; t < ticks; t++) {
    engine.attemptPlayerMove(dir);
    engine.tick();
    cells.push(cellOf(engine));
  }
  return cells;
}

describe('CC2 engine: a mirror walks at its own cadence (MC)', () => {
  it('moves once per four ticks while the player keeps trying a blocked move', () => {
    const cells = cellsWhileBlocked('cc2', MIRROR_STEP_TICKS * 3, 'N');
    const movedAt: number[] = [];
    let previous = '7,9';
    cells.forEach((cell, tick) => {
      if (cell !== previous) movedAt.push(tick);
      previous = cell;
    });
    expect(movedAt.length).toBe(3);
    expect(movedAt[1] - movedAt[0]).toBe(MIRROR_STEP_TICKS);
    expect(movedAt[2] - movedAt[1]).toBe(MIRROR_STEP_TICKS);
  });

  it('copies each input at once on a native level (no cadence of its own)', () => {
    const engine = load(mirrorRoom('native', [{ type: MIRROR_CHIP, x: 7, y: 9, dir: 'N' }]));
    engine.attemptPlayerMove('E');
    expect(cellOf(engine)).toBe('8,9');
    for (let i = 0; i < 6; i++) engine.tick();
    engine.attemptPlayerMove('E');
    expect(cellOf(engine)).toBe('9,9');
  });

  it('leaves a decision nobody makes alone: a mirror does not walk on after the player stops', () => {
    const engine = load(mirrorRoom('cc2', [{ type: MIRROR_CHIP, x: 7, y: 9, dir: 'N' }]));
    engine.attemptPlayerMove('E');
    for (let i = 0; i < MIRROR_STEP_TICKS * 3; i++) engine.tick();
    expect(cellOf(engine)).toBe('8,9');
  });

  it('ejects a mirror from a trap forward when it opens, whoever the player is', () => {
    const level = mirrorRoom('cc2', [{ type: MIRROR_CHIP, x: 9, y: 3, dir: 'S' }], {
      terrain: { [`${START_X + 1},${ROOM_ROW}`]: BROWN_BUTTON, '9,3': TRAP }
    });
    level.trapLinks = [{ buttonX: START_X + 1, buttonY: ROOM_ROW, trapX: 9, trapY: 3 }];
    // The player is Melinda, so the mirror of Chip copies nothing: only the opening trap moves it.
    level.character = 'melinda';
    const engine = load(level);
    for (let i = 0; i < MIRROR_STEP_TICKS; i++) engine.tick();
    expect(cellOf(engine)).toBe('9,3');
    engine.attemptPlayerMove('E');
    for (let i = 0; i < MIRROR_STEP_TICKS * 2; i++) engine.tick();
    expect(cellOf(engine)).toBe('9,4');
  });

  it('keeps a mirror whose character is not the player idle without a trap', () => {
    const engine = load(mirrorRoom('cc2', [{ type: MIRROR_MELINDA, x: 7, y: 9, dir: 'N' }]));
    engine.attemptPlayerMove('E');
    for (let i = 0; i < MIRROR_STEP_TICKS * 2; i++) engine.tick();
    expect(cellOf(engine, MIRROR_MELINDA)).toBe('7,9');
  });
});
