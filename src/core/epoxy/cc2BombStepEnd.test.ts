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
 * On a CC2-engine level a bomb the player steps onto goes off when his step ends (Lexy's Labyrinth tiletypes.js bomb on_arrive),
 * not when it starts: a green bomb that a green button turned into a chip meanwhile is taken as a chip. The classic and native
 * rules explode at once.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { room, ROOM_ROW, type RoomMode } from '../../test/cc2Room';
import { playMove } from '../../test/cc2Play';
import { GameEngine } from '../GameEngine';
import type { EpoxyWorld } from './epoxyWorld';

beforeEach(() => {
  loadTestConfigs();
});

const ITEM_X = 3;
const SETTLE_TICKS = 40;

const world = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;

function load(mode: RoomMode, item: string): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(room({ mode, startX: ITEM_X - 1, items: { [`${ITEM_X},${ROOM_ROW}`]: item }, chipsRequired: 1 }));
  return engine;
}

/** Ticks until the step onto the item has ended. */
function endStep(engine: GameEngine): void {
  for (let t = 0; t < SETTLE_TICKS && engine.getPlayer().alive && engine.getPlayer().moveCooldown > 0; t++) engine.tick();
  engine.flushPendingStepEnd();
}

describe('a bomb stepped onto', () => {
  it('goes off when the step ends on a CC2-engine level', () => {
    const engine = load('cc2', 'bomb');
    expect(playMove(engine, 'E').accepted).toBe(true);
    expect(engine.getPlayer().alive).toBe(true);
    expect(world(engine).items[ROOM_ROW][ITEM_X]).toBe('bomb');
    endStep(engine);
    expect(engine.getPlayer().alive).toBe(false);
    expect(world(engine).items[ROOM_ROW][ITEM_X]).toBeNull();
  });

  it('does not go off when he is no longer on its cell by then', () => {
    const engine = load('cc2', 'bomb');
    playMove(engine, 'E');
    world(engine).player.x = ITEM_X + 1;
    endStep(engine);
    expect(engine.getPlayer().alive).toBe(true);
  });

  it('goes off at once on a classic-rules level and on a native level', () => {
    for (const mode of ['cc', 'native'] as const) {
      const engine = load(mode, 'bomb');
      engine.attemptPlayerMove('E');
      expect(engine.getPlayer().alive).toBe(false);
    }
  });

  it('is taken as a chip when it turned into one during the step', () => {
    const engine = load('cc2', 'green_bomb');
    expect(playMove(engine, 'E').accepted).toBe(true);
    expect(engine.getPlayer().alive).toBe(true);
    world(engine).items[ROOM_ROW][ITEM_X] = 'green_chip';
    expect(engine.getChipsRemaining()).toBe(1);
    endStep(engine);
    expect(engine.getPlayer().alive).toBe(true);
    expect(engine.getChipsRemaining()).toBe(0);
    expect(world(engine).items[ROOM_ROW][ITEM_X]).toBeNull();
  });
});
