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

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { ROOM_ROW, room, type RoomMode } from '../../test/cc2Room';
import { GameEngine } from '../GameEngine';
import type { EpoxyContext } from './epoxyWorld';

beforeEach(() => {
  loadTestConfigs();
});

const CLONER_X = 5;
const SPAWN_X = CLONER_X + 1;
const BUTTON_X = 8;
const BUTTON_Y = 8;
const PLAYER_X = 2;
/** Ticks run after the trigger so the cloned block has taken any step it owes. */
const SETTLE_TICKS = 20;

function cloneBlock(mode: RoomMode, spawnTile?: string): GameEngine {
  const terrain: Record<string, string> = {
    [`${CLONER_X},${ROOM_ROW}`]: 'clone_machine',
    [`${BUTTON_X},${BUTTON_Y}`]: 'button_red'
  };
  if (spawnTile !== undefined) terrain[`${SPAWN_X},${ROOM_ROW}`] = spawnTile;
  const level = room({
    mode,
    startX: PLAYER_X,
    terrain,
    entities: [{ type: 'dirt_block', x: CLONER_X, y: ROOM_ROW, dir: 'E' }]
  });
  level.cloneLinks = [
    { buttonX: BUTTON_X, buttonY: BUTTON_Y, clonerX: CLONER_X, clonerY: ROOM_ROW, templateType: 'dirt_block', templateDir: 'E' }
  ];
  const engine = new GameEngine();
  engine.loadLevel(level);
  (engine as unknown as { ctx: EpoxyContext }).ctx.triggerButton(BUTTON_X, BUTTON_Y, 'trigger_cloner');
  return engine;
}

const clonedOf = (engine: GameEngine) => engine.getEntities().find((e) => e.kind === 'block' && e.x === SPAWN_X && e.y === ROOM_ROW);

describe('CC2 cloned block step', () => {
  it('takes a real step out of the cloner: its arrival is still pending when it appears', () => {
    const engine = cloneBlock('cc2');
    const cloned = clonedOf(engine);
    expect(cloned).toBeDefined();
    expect(cloned?.arrivalTicks).toBeGreaterThan(0);
    for (let i = 0; i < SETTLE_TICKS; i++) engine.tick();
    expect(clonedOf(engine)?.arrivalTicks).toBeUndefined();
  });

  it('settles at once when it comes out onto ice, which starts the slide', () => {
    const engine = cloneBlock('cc2', 'ice');
    expect(clonedOf(engine)?.arrivalTicks).toBeUndefined();
  });

  it('settles at once on a classic-rules and a native level', () => {
    for (const mode of ['cc', 'native'] as const) {
      const cloned = clonedOf(cloneBlock(mode));
      expect(cloned, mode).toBeDefined();
      expect(cloned?.arrivalTicks, mode).toBeUndefined();
    }
  });
});
