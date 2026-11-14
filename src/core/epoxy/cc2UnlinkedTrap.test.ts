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
 * CC2 engine: a brown button works only the trap it is connected to (Lexy's Labyrinth button_brown.connection): a trap
 * with no link stays shut whoever holds a brown button. Other levels keep the rule that any held brown button opens it.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { playMove } from '../../test/cc2Play';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { ROOM_ROW, room, type RoomMode } from '../../test/cc2Room';
import { GameEngine } from '../GameEngine';

beforeEach(() => {
  loadTestConfigs();
});

const BUTTON_X = 3;
const TRAP_X = 9;
const TRAP_Y = 9;
const MAX_TICKS = 40;

function load(mode: RoomMode, linked: boolean): GameEngine {
  const level = room({ mode, terrain: { [`${BUTTON_X},${ROOM_ROW}`]: 'button_brown', [`${TRAP_X},${TRAP_Y}`]: 'trap' } });
  if (linked) level.trapLinks = [{ buttonX: BUTTON_X, buttonY: ROOM_ROW, trapX: TRAP_X, trapY: TRAP_Y }];
  const engine = new GameEngine();
  engine.loadLevel(level);
  return engine;
}

/** Steps onto the button, waits the step out and lets the step-end effects act. */
function standOnButton(engine: GameEngine): void {
  expect(playMove(engine, 'E').moved).toBe(true);
  let guard = 0;
  while (engine.getPlayer().moveCooldown > 0 && guard++ < MAX_TICKS) engine.tick();
  engine.tick();
}

describe('CC2 engine: an unlinked trap is never opened by a brown button', () => {
  it('stays shut with a brown button held', () => {
    const engine = load('cc2', false);
    standOnButton(engine);
    expect(engine.isCellClosedTrap(TRAP_X, TRAP_Y)).toBe(true);
  });

  it('is still opened by the button it is linked to', () => {
    const engine = load('cc2', true);
    standOnButton(engine);
    expect(engine.isCellClosedTrap(TRAP_X, TRAP_Y)).toBe(false);
  });
});

describe('a level not on the CC2 engine lets any held brown button open an unlinked trap', () => {
  it.each(['cc', 'native'] as const)('%s level', (mode) => {
    const engine = load(mode, false);
    standOnButton(engine);
    expect(engine.isCellClosedTrap(TRAP_X, TRAP_Y)).toBe(false);
  });
});
