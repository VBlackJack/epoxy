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
 * CC2 engine: the slap of the two-key rule does not move a block standing on a clone machine, which is its template held
 * by the machine (Lexy's Labyrinth cloner.traps). A free block next to the player is still slapped.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { ROOM_ROW, room } from '../../test/cc2Room';
import { GameEngine } from '../GameEngine';

beforeEach(() => {
  loadTestConfigs();
});

const PLAYER_X = 4;
const BLOCK_X = PLAYER_X + 1;
const BLOCK = 'dirt_block';

function load(onCloner: boolean): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(
    room({
      mode: 'cc2',
      startX: PLAYER_X,
      terrain: onCloner ? { [`${BLOCK_X},${ROOM_ROW}`]: 'clone_machine' } : {},
      entities: [{ type: BLOCK, x: BLOCK_X, y: ROOM_ROW, dir: 'E' }]
    })
  );
  return engine;
}

const blockX = (engine: GameEngine): number | undefined => engine.getEntities().find((e) => e.type === BLOCK)?.x;

describe('CC2 engine: the slap and a clone template', () => {
  it('does not move the template block on a clone machine', () => {
    const engine = load(true);
    // Two keys: east (at the block) and north (a free cell); the slap pushes toward both before the step.
    engine.attemptPlayerMoveHeld(['E', 'N']);
    expect(blockX(engine)).toBe(BLOCK_X);
  });

  it('still moves a free block', () => {
    const engine = load(false);
    engine.attemptPlayerMoveHeld(['E', 'N']);
    expect(blockX(engine)).toBeGreaterThan(BLOCK_X);
  });
});
