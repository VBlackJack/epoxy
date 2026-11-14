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
 * CC2 engine, wave 9: the player's decision-time push (Lexy make_player_decision, game.js:1630-1660) and the step guard that
 * leaves a block in motion at the decision alone (AOD3). Levels outside the CC2 engine are unchanged.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { ROOM_ROW, room, type RoomMode } from '../../test/cc2Room';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { playMove } from '../../test/cc2Play';
import { GameEngine } from '../GameEngine';
import type { EpoxyContext, EpoxyWorld } from './epoxyWorld';
import { decisionPush } from './epoxyPlayer';

const PLAYER_X = 2;
const BLOCK_X = 3;
const PUSHED_X = 4;
const BLOCK = 'ice_block';
const ICE = 'ice';
const CLOSED_TOGGLE_WALL = 'toggle_wall_closed';
const ARRIVAL_TICKS = 3;
const SLIDE_COOLDOWN_TICKS = 2;
const MAX_WAIT_TICKS = 40;

beforeEach(() => {
  loadTestConfigs();
});

const world = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;
const contextOf = (engine: GameEngine): EpoxyContext => (engine as unknown as { ctx: EpoxyContext }).ctx;

function load(mode: RoomMode, terrainUnderBlock: string | null): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(
    room({
      mode,
      terrain: terrainUnderBlock === null ? {} : { [`${BLOCK_X},${ROOM_ROW}`]: terrainUnderBlock },
      entities: [{ type: BLOCK, x: BLOCK_X, y: ROOM_ROW, dir: 'E' }]
    })
  );
  for (let waited = 0; engine.getPlayer().moveCooldown !== 0; waited++) {
    if (waited > MAX_WAIT_TICKS) throw new Error('the player never became able to move');
    engine.tick();
  }
  return engine;
}

const blockOf = (engine: GameEngine) => world(engine).entities.find((e) => e.type === BLOCK)!;

describe('decision push', () => {
  it('pushes a block at rest ahead of the player without moving him', () => {
    const engine = load('cc2', null);
    const moving = new Set<number>();
    decisionPush(contextOf(engine), ['E'], moving);
    expect(blockOf(engine).x).toBe(PUSHED_X);
    expect(world(engine).player.x).toBe(PLAYER_X);
    expect(moving.size).toBe(0);
  });

  it('pushes a block at rest on ice (a sliding floor alone does not refuse)', () => {
    const engine = load('cc2', ICE);
    decisionPush(contextOf(engine), ['E'], new Set<number>());
    expect(blockOf(engine).x).not.toBe(BLOCK_X);
  });

  it('records the blocks in motion at the decision, arriving or sliding with a cooldown', () => {
    const engine = load('cc2', null);
    const block = blockOf(engine);
    block.arrivalTicks = ARRIVAL_TICKS;
    const moving = new Set<number>();
    decisionPush(contextOf(engine), ['E'], moving);
    expect(moving.has(block.uid)).toBe(true);
    block.arrivalTicks = undefined;
    block.isSliding = true;
    block.cooldownTicks = SLIDE_COOLDOWN_TICKS;
    const sliding = new Set<number>();
    decisionPush(contextOf(engine), ['N'], sliding);
    expect(sliding.has(block.uid)).toBe(true);
  });

  it('does not push a block that slides on ice, and leaves no pending push (memories t82 shape)', () => {
    const engine = load('cc2', ICE);
    const block = blockOf(engine);
    block.isSliding = true;
    block.cooldownTicks = SLIDE_COOLDOWN_TICKS;
    const before = JSON.stringify(block);
    decisionPush(contextOf(engine), ['E'], new Set<number>());
    expect(block.x).toBe(BLOCK_X);
    // Known gap: Lexy (game.js no_directly_pushing_sliding_blocks, steam rulesets) writes a pending push here that turns the
    // block's next slide. Porting it lost chaoslnd and map116 and broke memories, so the decision neither pushes nor queues.
    expect(JSON.stringify(block)).toBe(before);
  });

  it('does not push a block still arriving on ice', () => {
    const engine = load('cc2', ICE);
    const block = blockOf(engine);
    block.arrivalTicks = ARRIVAL_TICKS;
    decisionPush(contextOf(engine), ['E'], new Set<number>());
    expect(block.x).toBe(BLOCK_X);
  });

  it('does not push a block on a closed toggle wall, the terrain bars the player first (brethe2 t459 shape)', () => {
    const engine = load('cc2', CLOSED_TOGGLE_WALL);
    decisionPush(contextOf(engine), ['E'], new Set<number>());
    expect(blockOf(engine).x).toBe(BLOCK_X);
  });

  it.each(['cc', 'native'] as RoomMode[])('does nothing outside the CC2 engine (%s)', (mode) => {
    const engine = load(mode, null);
    const moving = new Set<number>();
    decisionPush(contextOf(engine), ['E'], moving);
    expect(blockOf(engine).x).toBe(BLOCK_X);
    expect(moving.size).toBe(0);
  });
});

describe('step guard for a block in motion at the decision', () => {
  it('leaves a block in the set unpushed and the player in place (map033 t54 shape)', () => {
    const engine = load('cc2', null);
    const block = blockOf(engine);
    // The tick builds the set of the blocks in motion at the decision itself: the block is made to be arriving.
    block.arrivalTicks = ARRIVAL_TICKS;
    playMove(engine, 'E');
    expect(block.x).toBe(BLOCK_X);
    expect(world(engine).player.x).toBe(PLAYER_X);
  });

  it('pushes a block at rest whose uid is not in the set (S_motel t1800 shape)', () => {
    const engine = load('cc2', null);
    world(engine).cc2MovingAtDecision = new Set<number>();
    playMove(engine, 'E');
    expect(blockOf(engine).x).toBe(PUSHED_X);
  });

  it('pushes the block when no set is written, as before', () => {
    const engine = load('cc2', null);
    playMove(engine, 'E');
    expect(blockOf(engine).x).toBe(PUSHED_X);
  });

  it.each(['cc', 'native'] as RoomMode[])('ignores the set outside the CC2 engine (%s)', (mode) => {
    const engine = load(mode, null);
    world(engine).cc2MovingAtDecision = new Set<number>([blockOf(engine).uid]);
    playMove(engine, 'E');
    expect(blockOf(engine).x).toBe(PUSHED_X);
  });
});
