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
 * CC2 engine, wave 10 (PJ, PJS), the whole path: the player's decision queues the push of a block jammed on a force floor, the
 * block takes it at its own move of the pass (Lexy must_pending_push and pending_push, game.js:1980-1996 and 1703-1710), whether
 * the block is listed before the player or after him (the patbuff and Dabomb shapes), and the field is spent.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { ROOM_ROW, room } from '../../test/cc2Room';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { playMove } from '../../test/cc2Play';
import type { Direction } from '../types';
import { GameEngine } from '../GameEngine';
import type { EpoxyWorld } from './epoxyWorld';

beforeEach(() => {
  loadTestConfigs();
});

const BLOCK_X = 5;
const BLOCK_ROW = ROOM_ROW;
const BLOCK = 'dirt_block';
const JAM_FLOOR = 'force_n';
const SETTLE_TICKS = 12;

const world = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;

/** A dirt block on a north force floor, jammed against the wall above it, with the player on the given side of it. */
function setup(side: Direction): { engine: GameEngine; uid: number } {
  const engine = new GameEngine();
  const west = side === 'E';
  engine.loadLevel(
    room({
      mode: 'cc2',
      startX: west ? BLOCK_X - 1 : BLOCK_X + 1,
      dir: side,
      terrain: { [`${BLOCK_X},${BLOCK_ROW}`]: JAM_FLOOR, [`${BLOCK_X},${BLOCK_ROW - 1}`]: 'wall' },
      entities: [{ type: BLOCK, x: BLOCK_X, y: BLOCK_ROW, dir: 'N' }]
    })
  );
  const block = world(engine).entities.find((e) => e.type === BLOCK)!;
  block.cc2SlideArrived = true;
  return { engine, uid: block.uid };
}

describe('the pending push of a jammed block, through the pass', () => {
  it.each<Direction>(['E', 'W'])('queues the push at his decision, then the block moves one cell the way he pushes, whichever side of it he stands on (%s)', (dir) => {
    const { engine, uid } = setup(dir);
    const startX = engine.getPlayer().x;
    expect(playMove(engine, dir).accepted).toBe(true);
    // At the decision tick the push is queued, not made: the block has not moved and the step did not push it. He stays on his side
    // whether the block is listed after him (E: he decides before its move) or before him (W: its move of the tick is already past).
    const queued = world(engine).entities.find((e) => e.uid === uid)!;
    expect(queued.cc2PendingPush).toBe(dir);
    expect(queued.x).toBe(BLOCK_X);
    expect(queued.y).toBe(BLOCK_ROW);
    expect(engine.getPlayer().x).toBe(startX);
    for (let t = 0; t < SETTLE_TICKS; t++) engine.tick();
    const block = world(engine).entities.find((e) => e.uid === uid)!;
    const step = dir === 'E' ? 1 : -1;
    expect(block.x).toBe(BLOCK_X + step);
    expect(block.y).toBe(BLOCK_ROW);
    expect(block.cc2PendingPush).toBeUndefined();
  });

  it('leaves no push behind when the block is not jammed', () => {
    const { engine, uid } = setup('E');
    delete world(engine).entities.find((e) => e.uid === uid)!.cc2SlideArrived;
    playMove(engine, 'E');
    for (let t = 0; t < SETTLE_TICKS; t++) engine.tick();
    expect(world(engine).entities.find((e) => e.uid === uid)!.cc2PendingPush).toBeUndefined();
  });
});
