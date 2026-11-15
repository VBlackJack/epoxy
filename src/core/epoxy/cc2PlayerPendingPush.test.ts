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
 * CC2 engine, wave 10 (PJ, PJF), decision side: the push of a block jammed on a force floor becomes a pending push the block takes
 * at its own move (Lexy must_pending_push, game.js:1980-1996), and the player's step does not push it. A player carried by a force
 * floor who may override it decides too (Lexy may_move, game.js:1576-1579). The block side lives in epoxyBlocks.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { ROOM_ROW, room, type RoomMode } from '../../test/cc2Room';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { GameEngine } from '../GameEngine';
import type { EpoxyContext, EpoxyWorld } from './epoxyWorld';
import { decisionPush } from './epoxyPlayer';

const PLAYER_X = 2;
const BLOCK_X = 3;
const BLOCK = 'ice_block';
const FORCE_FLOOR = 'force_n';
const MAX_WAIT_TICKS = 40;

beforeEach(() => {
  loadTestConfigs();
});

const world = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;
const contextOf = (engine: GameEngine): EpoxyContext => (engine as unknown as { ctx: EpoxyContext }).ctx;

function load(mode: RoomMode, terrain: Record<string, string>): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(room({ mode, terrain, entities: [{ type: BLOCK, x: BLOCK_X, y: ROOM_ROW, dir: 'E' }] }));
  for (let waited = 0; engine.getPlayer().moveCooldown !== 0; waited++) {
    if (waited > MAX_WAIT_TICKS) throw new Error('the player never became able to move');
    engine.tick();
  }
  return engine;
}

const blockOf = (engine: GameEngine) => world(engine).entities.find((e) => e.type === BLOCK)!;
const forceUnderBlock = { [`${BLOCK_X},${ROOM_ROW}`]: FORCE_FLOOR };

describe('decision side of the pending push of a jammed block', () => {
  it('queues the push of a block jammed at rest on a force floor and leaves it for its own move', () => {
    const engine = load('cc2', forceUnderBlock);
    const block = blockOf(engine);
    block.cc2SlideArrived = true;
    const moving = new Set<number>();
    decisionPush(contextOf(engine), ['E'], moving);
    expect(block.cc2PendingPush).toBe('E');
    expect(block.x).toBe(BLOCK_X);
    // Listed as moving at the decision: the step does not push it (he walks in only when it already left).
    expect(moving.has(block.uid)).toBe(true);
    expect(world(engine).player.x).toBe(PLAYER_X);
  });

  it('pushes a block at rest on a force floor that did not land there by a move (no pending push)', () => {
    const engine = load('cc2', forceUnderBlock);
    const block = blockOf(engine);
    decisionPush(contextOf(engine), ['E'], new Set<number>());
    expect(block.cc2PendingPush).toBeUndefined();
    expect(block.x).not.toBe(BLOCK_X);
  });

  it('does not queue a jammed block outside the CC2 engine', () => {
    const engine = load('cc', forceUnderBlock);
    const block = blockOf(engine);
    block.cc2SlideArrived = true;
    const moving = new Set<number>();
    decisionPush(contextOf(engine), ['E'], moving);
    expect(block.cc2PendingPush).toBeUndefined();
    expect(moving.size).toBe(0);
  });

  it('lets a player carried by a force floor who may override it queue the push of a jammed block', () => {
    const engine = load('cc2', { ...forceUnderBlock, [`${PLAYER_X},${ROOM_ROW}`]: FORCE_FLOOR });
    const player = world(engine).player;
    player.isSliding = true;
    player.forcePermission = true;
    const block = blockOf(engine);
    block.cc2SlideArrived = true;
    const moving = new Set<number>();
    decisionPush(contextOf(engine), ['E'], moving);
    expect(block.cc2PendingPush).toBe('E');
    expect(moving.has(block.uid)).toBe(true);
  });

  it('keeps a carried player without the permission from deciding', () => {
    const engine = load('cc2', { ...forceUnderBlock, [`${PLAYER_X},${ROOM_ROW}`]: FORCE_FLOOR });
    const player = world(engine).player;
    player.isSliding = true;
    player.forcePermission = false;
    const block = blockOf(engine);
    block.cc2SlideArrived = true;
    decisionPush(contextOf(engine), ['E'], new Set<number>());
    expect(block.cc2PendingPush).toBeUndefined();
    expect(block.x).toBe(BLOCK_X);
  });

  it('does not slap a plain block for a carried player (the slap gap, PJF): only the pending push is decided', () => {
    const engine = load('cc2', { [`${PLAYER_X},${ROOM_ROW}`]: FORCE_FLOOR });
    const player = world(engine).player;
    player.isSliding = true;
    player.forcePermission = true;
    decisionPush(contextOf(engine), ['E'], new Set<number>());
    expect(blockOf(engine).x).toBe(BLOCK_X);
  });
});
