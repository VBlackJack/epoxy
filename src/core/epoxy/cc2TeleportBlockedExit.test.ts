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

beforeEach(() => {
  loadTestConfigs();
});

const START_X = 2;
const NEAR_PAD = 3;
const FAR_PAD = 8;
const EXIT_X = FAR_PAD + 1;
const BEYOND_X = FAR_PAD + 2;
/** Ticks run after the jump so the forced exit step and the push step both end. */
const SETTLE_TICKS = 40;

function jump(mode: RoomMode, opts: { blockType?: string; wallBehind?: boolean } = {}): GameEngine {
  const terrain: Record<string, string> = { [`${NEAR_PAD},${ROOM_ROW}`]: 'teleport', [`${FAR_PAD},${ROOM_ROW}`]: 'teleport' };
  if (opts.wallBehind) terrain[`${BEYOND_X},${ROOM_ROW}`] = 'wall';
  const engine = new GameEngine();
  engine.loadLevel(
    room({
      mode,
      startX: START_X,
      terrain,
      entities: [{ type: opts.blockType ?? 'dirt_block', x: EXIT_X, y: ROOM_ROW, dir: 'E' }]
    })
  );
  engine.attemptPlayerMove('E');
  return engine;
}

const blockOf = (engine: GameEngine) => engine.getEntities().find((e) => e.kind === 'block');

describe('CC2 teleport exit held by a pushable block', () => {
  it('counts as open: the player lands and the exit step pushes the block', () => {
    const engine = jump('cc2');
    expect(engine.getPlayer().x).toBe(FAR_PAD);
    expect(engine.getPlayer().teleportExit).toBe('E');
    for (let i = 0; i < SETTLE_TICKS; i++) engine.tick();
    expect(engine.getPlayer().x).toBe(EXIT_X);
    expect(blockOf(engine)?.x).toBe(BEYOND_X);
  });

  it('stays closed when the block cannot be pushed', () => {
    const engine = jump('cc2', { wallBehind: true });
    // The far pad stays closed; the jump falls back on the pad he stepped on, as before.
    expect(engine.getPlayer().x).toBe(NEAR_PAD);
  });

  it('stays closed on a classic-rules level', () => {
    const engine = jump('cc');
    expect(engine.getPlayer().x).not.toBe(FAR_PAD);
  });
});
