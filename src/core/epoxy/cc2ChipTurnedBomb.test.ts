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
 * On a CC2-engine level a chip the player stepped onto that has become a green bomb by the time his step ends goes off (the
 * green toggle acts during the step; Lexy's Labyrinth tiletypes.js bomb on_arrive). A chip that stayed a chip is taken at the end
 * of the step as before.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { room, ROOM_ROW, type RoomMode } from '../../test/cc2Room';
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

describe('a chip stepped onto that turned into a green bomb during the step', () => {
  it('goes off on a CC2-engine level', () => {
    const engine = load('cc2', 'green_chip');
    expect(engine.attemptPlayerMove('E')).toBe(true);
    expect(engine.getPlayer().alive).toBe(true);
    world(engine).items[ROOM_ROW][ITEM_X] = 'green_bomb';
    endStep(engine);
    expect(engine.getPlayer().alive).toBe(false);
  });

  it('is taken at the end of the step when it stayed a chip', () => {
    const engine = load('cc2', 'green_chip');
    engine.attemptPlayerMove('E');
    expect(engine.getChipsRemaining()).toBe(1);
    endStep(engine);
    expect(engine.getChipsRemaining()).toBe(0);
  });
});
