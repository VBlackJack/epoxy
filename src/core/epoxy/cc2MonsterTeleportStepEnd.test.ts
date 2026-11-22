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
 * (wave 29: it goes through at the frame its step ends in); a block keeps the step-start jump on every pad.
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

  it('reads the tile flag: a monster waits for its step end on both pads, a block pushed onto either one jumps at once', () => {
    const flagged = ConfigRegistry.getTile(GREEN_PAD).teleportJumpsAtStepStartCc2 === true;
    const unflagged = ConfigRegistry.getTile(UNFLAGGED_PAD).teleportJumpsAtStepStartCc2 === true;
    expect([flagged, unflagged]).toEqual([true, false]);
    for (const pad of [GREEN_PAD, UNFLAGGED_PAD]) {
      const holds = load({}, pad);
      tick(holds, 1);
      expect(walker(holds)?.x).toBe(ENTRY_X);
    }
    // A block pushed onto either pad keeps the step-start jump: it has left the pad in the tick it is pushed.
    for (const pad of [GREEN_PAD, UNFLAGGED_PAD]) {
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
      expect(pushed.getEntities().find((e) => e.type === 'dirt_block')?.x).not.toBe(ENTRY_X);
    }
  });

  it('keeps the step-start jump on a classic level that is not CC2', () => {
    const engine = load({ mode: 'cc' });
    tick(engine, 1);
    expect(walker(engine)?.x).not.toBe(ENTRY_X);
  });
});
