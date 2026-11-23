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
 * CC2 engine: a monster that steps onto a teleporter goes through in its own turn of the pass where its step ends, lands on the
 * destination pad and leaves by the forced exit as its next decision, with no draw. The green pad holds a monster the same way
 * (wave 29: it goes through at the frame its step ends in); a block does the same on every pad (wave 30).
 * Lexy's Labyrinth game.js attempt_teleport.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadCc2Lane } from '../../test/cc2LaneFixture';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { room, ROOM_ROW } from '../../test/cc2Room';
import type { RoomOptions } from '../../test/cc2Room';
import { ConfigRegistry } from '../../config/ConfigRegistry';
import { CC_MONSTER_STEP_TICKS } from '../coreConstants';
import { GameEngine } from '../GameEngine';
import type { EpoxyWorld } from './epoxyWorld';

const PAD = 'teleport_forward';
const GREEN_PAD = 'teleport_random';
const UNFLAGGED_PAD = 'teleport_green';
const ENTRY_X = 3;
const EXIT_PAD_X = 9;
const FAR_X = 11;
const MONSTER_START_X = 2;
/** The prefix of the wave 29 Lexy lanes. */
const LANE_PREFIX = 'w29_';
/** The prefix of the wave 30 Lexy lanes. */
const WAVE_30_LANE_PREFIX = 'w30_';
const BLOCK_STEP_WATCH_TICKS = 20;
/** Ticks after the first one until a pushed block has gone through: its step end, measured on this room. */
const BLOCK_STEP_TICKS_AFTER_PUSH_TICK = 4;

beforeEach(() => {
  loadTestConfigs();
});

const world = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;

function load(opts: Partial<RoomOptions> = {}, pad = PAD): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(
    room({
      mode: 'cc2',
      startX: FAR_X,
      terrain: { [`${ENTRY_X},${ROOM_ROW}`]: pad, [`${EXIT_PAD_X},${ROOM_ROW}`]: pad, ...(opts.terrain ?? {}) },
      entities: [{ type: 'walker', x: MONSTER_START_X, y: ROOM_ROW, dir: 'E' }],
      ...opts
    })
  );
  return engine;
}

function tick(engine: GameEngine, count: number): void {
  for (let i = 0; i < count; i++) engine.tick();
}

const walker = (engine: GameEngine) => engine.getEntities().find((e) => e.type === 'walker');
const generators = (engine: GameEngine): string => JSON.stringify(world(engine).ccGenerators);

describe('CC2 monster teleport at the end of its step', () => {
  it('stays on the entry pad while its step lasts, lands on the destination pad when it ends, and leaves by the exit', () => {
    const engine = load();
    tick(engine, 1);
    expect(walker(engine)).toMatchObject({ x: ENTRY_X });
    tick(engine, CC_MONSTER_STEP_TICKS - 2);
    expect(walker(engine)).toMatchObject({ x: ENTRY_X });
    tick(engine, 1);
    expect(walker(engine)).toMatchObject({ x: EXIT_PAD_X, y: ROOM_ROW });
    tick(engine, 1);
    expect(walker(engine)).toMatchObject({ x: EXIT_PAD_X + 1, y: ROOM_ROW });
  });

  it('makes no draw for its forced exit, and a blocked exit waits one decision before it decides normally', () => {
    const engine = load();
    tick(engine, CC_MONSTER_STEP_TICKS);
    expect(walker(engine)).toMatchObject({ x: EXIT_PAD_X });
    // The way out closes after the monster landed.
    world(engine).terrain[ROOM_ROW][EXIT_PAD_X + 1] = 'wall';
    const before = generators(engine);
    tick(engine, 1);
    expect(walker(engine)).toMatchObject({ x: EXIT_PAD_X });
    expect(generators(engine)).toBe(before);
    tick(engine, 1);
    expect(generators(engine)).not.toBe(before);
  });

  it('the green pad holds a monster until its step ends', async () => {
    const engine = load({}, GREEN_PAD);
    tick(engine, 1);
    expect(walker(engine)?.x).toBe(ENTRY_X);
    // Lexy lane w29_grt_walk_p2_k2: the walker stands on the entry pad (4,2) through tick 8 and is on its exit cell (9,6) at tick 9.
    const lane = new GameEngine();
    lane.loadLevel(await loadCc2Lane('grt_walk_p2_k2', LANE_PREFIX), 0);
    const ball = () => lane.getEntities().find((e) => e.type === 'pink_ball');
    tick(lane, 5);
    expect([ball()?.x, ball()?.y]).toEqual([4, 2]);
    tick(lane, 3);
    expect([ball()?.x, ball()?.y]).toEqual([4, 2]);
    tick(lane, 1);
    expect([ball()?.x, ball()?.y, ball()?.dir]).toEqual([9, 6, 'W']);
    tick(lane, 3);
    expect([ball()?.x, ball()?.y]).toEqual([9, 6]);
  });

  it('reads the tile flag: the flagged pad queues a green jump for a monster, the unflagged one only once it carries the flag', () => {
    const flagged = ConfigRegistry.getTile(GREEN_PAD).teleportJumpsAtStepStartCc2 === true;
    const unflagged = ConfigRegistry.getTile(UNFLAGGED_PAD).teleportJumpsAtStepStartCc2 === true;
    expect([flagged, unflagged]).toEqual([true, false]);
    const queued = (engine: GameEngine) => world(engine).ccArrivals.find((a) => a.teleport === true);
    const holds = load({}, GREEN_PAD);
    tick(holds, 1);
    expect(queued(holds)).toMatchObject({ greenPad: true, cc2EndFrame: 1 });
    const plain = load({}, UNFLAGGED_PAD);
    tick(plain, 1);
    expect(queued(plain)).toBeDefined();
    expect(queued(plain)?.greenPad).toBeUndefined();
    // Giving the unflagged pad the flag is enough to make it queue the green jump.
    ConfigRegistry.getTile(UNFLAGGED_PAD).teleportJumpsAtStepStartCc2 = true;
    const nowFlagged = load({}, UNFLAGGED_PAD);
    tick(nowFlagged, 1);
    expect(queued(nowFlagged)).toMatchObject({ greenPad: true, cc2EndFrame: 1 });
  });

  it('a block pushed onto a pad stays on it until its step ends', () => {
    // A block pushed onto either pad stays on it through its step and goes through when the step ends (wave 30; Lexy on_arrive).
    // exitX: the cell the block stands on once through (each pad leaves by its own exit direction).
    for (const [pad, exitX] of [[GREEN_PAD, EXIT_PAD_X - 1], [UNFLAGGED_PAD, EXIT_PAD_X + 1]] as const) {
      const pushed = new GameEngine();
      pushed.loadLevel(
        room({
          mode: 'cc2',
          startX: MONSTER_START_X - 1,
          terrain: { [`${ENTRY_X},${ROOM_ROW}`]: pad, [`${EXIT_PAD_X},${ROOM_ROW}`]: pad },
          entities: [{ type: 'dirt_block', x: MONSTER_START_X, y: ROOM_ROW, dir: 'E' }]
        })
      );
      expect(pushed.attemptPlayerMove('E')).toBe(true);
      tick(pushed, 1);
      const block = (): number | undefined => pushed.getEntities().find((e) => e.type === 'dirt_block')?.x;
      expect(block()).toBe(ENTRY_X);
      let leftAt = 0;
      while (block() === ENTRY_X && leftAt < BLOCK_STEP_WATCH_TICKS) {
        tick(pushed, 1);
        leftAt++;
      }
      expect([leftAt, block()]).toEqual([BLOCK_STEP_TICKS_AFTER_PUSH_TICK, exitX]);
    }
  });

  // Lexy lanes w30_btp_{green,blue,red}_floor_d0 / w30_btp_red_fire_d0: the pushed ice block stands on the pad through its step and is
  // on the exit cell after it (the exit fire melts it).
  it('takes the exit step after the teleport (Lexy lane w30_btp_red_fire_d0)', async () => {
    const lane = new GameEngine();
    lane.loadLevel(await loadCc2Lane('btp_red_fire_d0', WAVE_30_LANE_PREFIX), 0);
    const block = () => lane.getEntities().find((e) => e.type === 'ice_block');
    lane.attemptPlayerMoveHeld(['E']);
    tick(lane, 1);
    expect([block()?.x, block()?.y]).toEqual([4, 4]);
    tick(lane, 3);
    expect([block()?.x, block()?.y]).toEqual([4, 4]);
    tick(lane, 1);
    expect([block()?.x, block()?.y]).toEqual([11, 7]);
    tick(lane, 1);
    expect([block()?.x, block()?.y]).toEqual([11, 7]);
  });

  it('keeps the step-start jump on a classic level that is not CC2', () => {
    const engine = load({ mode: 'cc' });
    tick(engine, 1);
    expect(walker(engine)?.x).not.toBe(ENTRY_X);
  });
});
