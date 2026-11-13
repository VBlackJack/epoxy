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
 * The CC2 bowling ball as an actor: set down on the player's cell it becomes a `rolling_ball` entity that leaves at once,
 * rolls straight on and follows the floor, takes tools and keys, opens the door of a key it holds, and blows up (killing
 * an actor in its way, a helmet or not) when it is blocked. Lexy's Labyrinth tiletypes.js rolling_ball, game.js drop_item.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { room, ROOM_ROW, ROOM_SIZE } from '../../test/cc2Room';
import type { RoomOptions } from '../../test/cc2Room';
import { CC2_ROLLING_BALL_STEP_TICKS, ROLLING_BALL_ENTITY_ID, STONE_DEATH_REASON_KEY, STONE_ITEM_ID } from '../coreConstants';
import { GameEngine } from '../GameEngine';
import type { Direction } from '../types';
import { launchRollingBall } from './epoxyRollingBall';
import type { EpoxyContext, EpoxyWorld } from './epoxyWorld';

const START_X = 2;
const LAST_FLOOR_X = ROOM_SIZE - 2;
const MAX_ROLL_TICKS = 120;
const SLIDE_ACROSS_TICKS = 24;
/** A stone far from the lane, so a native level has shots to read from the start. */
const FAR_STONE = { [`${ROOM_SIZE - 2},${ROOM_SIZE - 2}`]: STONE_ITEM_ID };
const HELMET = 'helmet';
const ORANGE_BUTTON = 'button_orange_cc2';

beforeEach(() => {
  loadTestConfigs();
});

const world = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;
const context = (engine: GameEngine): EpoxyContext => (engine as unknown as { ctx: EpoxyContext }).ctx;

function load(opts: RoomOptions): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(room(opts));
  return engine;
}

/** A level on which the player holds a bowling ball. */
function bowler(opts: Partial<RoomOptions> = {}): GameEngine {
  const engine = load({ mode: 'cc2', ...opts });
  engine.getPlayer().keys[STONE_ITEM_ID] = 1;
  return engine;
}

function tick(engine: GameEngine, count: number): void {
  for (let i = 0; i < count; i++) engine.tick();
}

const ballOf = (engine: GameEngine) => engine.getEntities().find((e) => e.type === ROLLING_BALL_ENTITY_ID);

/** Ticks until the ball has gone (or the limit), returning the ticks it took. */
function tickUntilSpent(engine: GameEngine): number {
  for (let i = 1; i <= MAX_ROLL_TICKS; i++) {
    engine.tick();
    if (ballOf(engine) === undefined) return i;
  }
  throw new Error('the ball never blew up');
}

describe('CC2 rolling ball as an actor', () => {
  it('becomes an entity at the end of the list that has left the player cell at once', () => {
    const engine = bowler({ entities: [{ type: 'lurker_dormant', x: 9, y: 9, dir: 'N' }] });
    expect(engine.dropItem(STONE_ITEM_ID)).toBe(true);
    const entities = engine.getEntities();
    expect(entities[entities.length - 1].type).toBe(ROLLING_BALL_ENTITY_ID);
    expect(ballOf(engine)).toMatchObject({ x: START_X + 1, y: ROOM_ROW, dir: 'E', kind: 'monster' });
    expect(engine.getPlayer().keys[STONE_ITEM_ID] ?? 0).toBe(0);
    expect(engine.getShots() ?? []).toEqual([]);
  });

  it('spends a whole step on the first cell after the drop, then crosses one cell per step', () => {
    const engine = bowler();
    expect(engine.dropItem(STONE_ITEM_ID)).toBe(true);
    const ballX = (): number => ballOf(engine)?.x as number;
    expect(ballX()).toBe(START_X + 1);
    tick(engine, CC2_ROLLING_BALL_STEP_TICKS);
    expect(ballX()).toBe(START_X + 1);
    tick(engine, 1);
    expect(ballX()).toBe(START_X + 2);
    tick(engine, CC2_ROLLING_BALL_STEP_TICKS - 1);
    expect(ballX()).toBe(START_X + 2);
    tick(engine, 1);
    expect(ballX()).toBe(START_X + 3);
  });

  it('follows the turn of a force floor', () => {
    const engine = bowler({ terrain: { '6,5': 'force_s' } });
    expect(engine.dropItem(STONE_ITEM_ID)).toBe(true);
    for (let i = 0; i < MAX_ROLL_TICKS; i++) {
      engine.tick();
      const ball = ballOf(engine);
      if (ball === undefined) break;
      if (ball.y > ROOM_ROW) {
        expect(ball.x).toBe(6);
        return;
      }
    }
    throw new Error('the ball never turned south');
  });

  it('is refused on a cell that holds an item, and the ball is kept', () => {
    const engine = bowler();
    world(engine).items[ROOM_ROW][START_X] = 'chip';
    expect(engine.dropItem(STONE_ITEM_ID)).toBe(false);
    expect(engine.getPlayer().keys[STONE_ITEM_ID]).toBe(1);
    expect(ballOf(engine)).toBeUndefined();
  });

  it('is not refused by what is ahead: facing a wall it is spent at once', () => {
    const engine = bowler({ startX: LAST_FLOOR_X });
    expect(engine.dropItem(STONE_ITEM_ID)).toBe(true);
    expect(ballOf(engine)).toBeUndefined();
    expect(engine.getPlayer().keys[STONE_ITEM_ID] ?? 0).toBe(0);
    expect(engine.getPlayer().alive).toBe(true);
  });

  it('is refused while the player is in the cooldown of a step', () => {
    const engine = bowler();
    expect(engine.attemptPlayerMove('S')).toBe(true);
    expect(engine.getPlayer().moveCooldown).toBeGreaterThan(0);
    expect(engine.dropItem(STONE_ITEM_ID)).toBe(false);
    expect(engine.getPlayer().keys[STONE_ITEM_ID]).toBe(1);
  });
});

describe('CC2 rolling ball: what it runs into', () => {
  it('blows up on a wall', () => {
    const engine = bowler();
    expect(engine.dropItem(STONE_ITEM_ID)).toBe(true);
    tickUntilSpent(engine);
    expect(engine.getPlayer().alive).toBe(true);
  });

  it('kills a block in its way as it blows up', () => {
    const engine = bowler({ entities: [{ type: 'dirt_block', x: 7, y: ROOM_ROW, dir: 'E' }] });
    expect(engine.dropItem(STONE_ITEM_ID)).toBe(true);
    tickUntilSpent(engine);
    expect(engine.getEntities()).toEqual([]);
  });

  it('kills a monster in its way as it blows up, also while it slides', () => {
    const terrain: Record<string, string> = {};
    for (let x = 3; x <= 7; x++) terrain[`${x},${ROOM_ROW}`] = 'ice';
    const engine = bowler({ terrain, entities: [{ type: 'lurker_dormant', x: 8, y: ROOM_ROW, dir: 'E' }] });
    expect(engine.dropItem(STONE_ITEM_ID)).toBe(true);
    tickUntilSpent(engine);
    expect(engine.getEntities()).toEqual([]);
  });

  it('does not blow up on a wall while it slides', () => {
    const terrain: Record<string, string> = {};
    for (let x = 3; x <= LAST_FLOOR_X; x++) terrain[`${x},${ROOM_ROW}`] = 'ice';
    const engine = bowler({ terrain });
    expect(engine.dropItem(STONE_ITEM_ID)).toBe(true);
    // It slides on along the row without blowing up (at the wall it would bounce back to the player).
    tick(engine, SLIDE_ACROSS_TICKS);
    expect(ballOf(engine)).toBeDefined();
    expect(ballOf(engine)?.x).toBeGreaterThan(START_X + 2);
  });

  it('kills a player in a helmet', () => {
    const engine = bowler({ startX: 8 });
    engine.getPlayer().boots.add(HELMET);
    expect(launchRollingBall(context(engine), 4, ROOM_ROW, 'E' as Direction)).toBe(true);
    tickUntilSpent(engine);
    expect(engine.getPlayer().alive).toBe(false);
    expect(engine.getPlayer().deathReasonKey).toBe(STONE_DEATH_REASON_KEY);
  });

  it('is blown up with the player who walks into it, helmet or not', () => {
    const engine = bowler();
    engine.getPlayer().boots.add(HELMET);
    expect(engine.dropItem(STONE_ITEM_ID)).toBe(true);
    // The ball is on the cell next to the player; he steps into it.
    tick(engine, 1);
    while (engine.getPlayer().moveCooldown > 0) engine.tick();
    engine.attemptPlayerMove('E');
    expect(engine.getPlayer().alive).toBe(false);
    expect(engine.getPlayer().deathReasonKey).toBe(STONE_DEATH_REASON_KEY);
    expect(ballOf(engine)).toBeUndefined();
  });
});

describe('CC2 rolling ball: what it takes', () => {
  it('takes a blue key, opens a door of that colour and rolls on', () => {
    const engine = bowler({ items: { '4,5': 'key_blue' }, terrain: { '6,5': 'door_blue' } });
    expect(engine.dropItem(STONE_ITEM_ID)).toBe(true);
    tick(engine, CC2_ROLLING_BALL_STEP_TICKS * 3);
    expect(engine.getItems()[ROOM_ROW][4]).toBeNull();
    expect(ballOf(engine)?.heldKeys).toEqual(['key_blue']);
    tick(engine, CC2_ROLLING_BALL_STEP_TICKS * 2);
    expect(engine.getTerrain()[ROOM_ROW][6]).toBe('floor');
    expect(ballOf(engine)?.x).toBeGreaterThanOrEqual(6);
    expect(ballOf(engine)?.heldKeys).toBeUndefined();
  });

  it('is stopped by a door whose key it does not hold', () => {
    const engine = bowler({ terrain: { '6,5': 'door_blue' } });
    expect(engine.dropItem(STONE_ITEM_ID)).toBe(true);
    tickUntilSpent(engine);
    expect(engine.getTerrain()[ROOM_ROW][6]).toBe('door_blue');
  });

  it('leaves the red key and a chip, takes a score bonus', () => {
    const engine = bowler({ items: { '4,5': 'key_red', '5,5': 'chip', '6,5': 'score_100' } });
    expect(engine.dropItem(STONE_ITEM_ID)).toBe(true);
    tick(engine, CC2_ROLLING_BALL_STEP_TICKS * 4);
    expect(engine.getItems()[ROOM_ROW][4]).toBe('key_red');
    expect(engine.getItems()[ROOM_ROW][5]).toBe('chip');
    expect(engine.getItems()[ROOM_ROW][6]).toBeNull();
  });
});

describe('CC2 rolling ball: a button it blows up on', () => {
  it('stays held when the ball is spent in place on an orange button', () => {
    const engine = bowler({ terrain: { '3,5': ORANGE_BUTTON, '4,5': 'wall' } });
    expect(engine.dropItem(STONE_ITEM_ID)).toBe(true);
    tickUntilSpent(engine);
    expect(engine.getCc2WaveState()?.toggledButtons).toEqual([ROOM_ROW * ROOM_SIZE + 3]);
  });

  it('is left alone on a button the ball merely rolls over', () => {
    const engine = bowler({ terrain: { '3,5': ORANGE_BUTTON } });
    expect(engine.dropItem(STONE_ITEM_ID)).toBe(true);
    tick(engine, CC2_ROLLING_BALL_STEP_TICKS * 3);
    expect(engine.getCc2WaveState()?.toggledButtons).toBeUndefined();
  });
});

describe('CC2 rolling ball: other rulesets', () => {
  it('keeps the thrown stone as a shot on a native level', () => {
    const engine = bowler({ mode: 'native', items: FAR_STONE });
    expect(engine.dropItem(STONE_ITEM_ID)).toBe(true);
    expect(engine.getShots()?.length).toBe(1);
    expect(ballOf(engine)).toBeUndefined();
  });

  it('keeps the thrown stone as a shot on a classic level that is not CC2', () => {
    const engine = bowler({ mode: 'cc', items: FAR_STONE });
    expect(engine.dropItem(STONE_ITEM_ID)).toBe(true);
    expect(engine.getShots()?.length).toBe(1);
    expect(ballOf(engine)).toBeUndefined();
  });
});
