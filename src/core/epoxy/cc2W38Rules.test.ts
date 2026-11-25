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
 * CC2 wave 38, rule WEX: the last player's step onto the exit wins when that step ends.
 * Lexy's exit.on_arrive fires at the arrival of the step (tiletypes.js 3521-3535) and the level is won in that tic's action phase
 * (game.js 1040-1043); its cleanup still counts the tic (1503-1514) and its time-out comes after (1508-1511), a failure after a win is
 * refused (3009-3011), and a step is timed by its goal cell (2176-2195). Three parts, each named by the case that fails without it:
 *   - WEX win timing: the level is won in the tick that follows the step end, after its clock advance and before the time-out check.
 *   - WEX slide ending: the step onto the exit ends any slide, so the last step off ice or a force floor runs at walking speed.
 *   - WEX input refusal: once the exit is reached no input is accepted (a held key would step him off the exit into a monster).
 * Played on the Lexy lanes of src/core/epoxy/__fixtures__/cc2-lanes (prefixes w38_ and w38r2_). The values are the end-of-tic values of
 * the Lexy lane named next to each case (actor oracle), read from the lane run, not from the engine; the rule-off values (the end at
 * the start of the step, 4 ticks early) are in the comments.
 *
 * "Win tic" is the tick count after the tic in which the level is won (Lexy tic_counter, Epoxy getTick()). A held key is given before
 * every tick() call from the lane's start tic o on.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { playMove } from '../../test/cc2Play';
import { room, ROOM_ROW } from '../../test/cc2Room';
import { loadCc2Lane } from '../../test/cc2LaneFixture';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { GameEngine } from '../GameEngine';
import type { Direction } from '../types';
import type { EpoxyWorld } from './epoxyWorld';

beforeEach(() => {
  loadTestConfigs();
});

const SEED = 0;
const START: Direction = 'N';
const HELD: Direction = 'E';
const PREFIX = 'w38_';
const PREFIX_ROUND2 = 'w38r2_';
const MAX_CALLS = 40;
const DEATH_TIME = 'hud.messages.death_time';
const DEATH_MONSTER = 'hud.messages.death_monster';
const TICKS_PER_STEP_ON_EXIT = 4;
const TIME_LIMIT_SECONDS = 100;
const BUG_STEPS_TO: [number, number] = [4, 3];

/** How a lane ended: the win tick count, the result and the seconds left. */
interface Outcome {
  readonly tic: number;
  readonly completed: boolean;
  readonly alive: boolean;
  readonly reason: string | null;
  readonly time: number;
}

const world = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;

async function load(lane: string, prefix: string): Promise<GameEngine> {
  const engine = new GameEngine();
  engine.loadLevel(await loadCc2Lane(lane, prefix), SEED);
  engine.setReplayForceStart(START);
  return engine;
}

function outcomeOf(engine: GameEngine): Outcome {
  const p = world(engine).player;
  return { tic: engine.getTick(), completed: engine.isLevelCompleted(), alive: p.alive, reason: p.deathReasonKey ?? null, time: engine.getTimeRemainingSeconds() };
}

/** One tick() call, the held key given before it from the lane's start tic `start` on (Lexy tic = call - 1). */
function playCall(engine: GameEngine, call: number, start: number | null): void {
  if (start !== null && call > start) engine.attemptPlayerMoveHeld([HELD]);
  engine.tick();
}

/** Plays up to `calls` tick() calls. */
function playTo(engine: GameEngine, start: number | null, calls: number, from = 0): void {
  for (let call = from + 1; call <= calls; call++) playCall(engine, call, start);
}

/** Plays until the level is completed or the player dies, then reads the outcome. */
async function run(lane: string, prefix: string, start: number | null): Promise<{ engine: GameEngine; outcome: Outcome }> {
  const engine = await load(lane, prefix);
  for (let call = 1; call <= MAX_CALLS; call++) {
    playCall(engine, call, start);
    if (engine.isLevelCompleted() || !world(engine).player.alive) break;
  }
  return { engine, outcome: outcomeOf(engine) };
}

const botEntity = (engine: GameEngine, type: string): [number, number][] =>
  engine
    .getEntities()
    .filter((e) => e.type === type)
    .map((e) => [e.x, e.y]);

describe('CC2 wave 38 (WEX win timing): the last player wins when his step onto the exit ends', () => {
  it('is not won at the start of the step, but 4 ticks later (Lexy lane w38_wk1_sp_c_n_o0: win tic 5, rule off 1)', async () => {
    const engine = await load('wk1_sp_c_n_o0', PREFIX);
    playTo(engine, 0, 1);
    expect(engine.isLevelCompleted()).toBe(false);
    playTo(engine, 0, TICKS_PER_STEP_ON_EXIT, 1);
    expect(engine.isLevelCompleted()).toBe(false);
    playTo(engine, 0, TICKS_PER_STEP_ON_EXIT + 1, TICKS_PER_STEP_ON_EXIT);
    expect(engine.isLevelCompleted()).toBe(true);
    expect(engine.getTick()).toBe(TICKS_PER_STEP_ON_EXIT + 1);
  });

  it('wins at the arrival of a longer walk (Lexy lane w38_wk2_sp_c_n_o0 would be 9; w38_wk3_sp_c_n_o6: win tic 19, 100 s, rule off 15)', async () => {
    const { outcome } = await run('wk3_sp_c_n_o6', PREFIX, 6);
    expect(outcome).toMatchObject({ tic: 19, completed: true, alive: true, time: TIME_LIMIT_SECONDS });
  });

  it('gives the seconds left at the arrival, one second less than at the start of the step (Lexy lane w38_wk3_sp_c_n_o8: win tic 21, 99 s; rule off 17, 100 s)', async () => {
    const { outcome } = await run('wk3_sp_c_n_o8', PREFIX, 8);
    expect(outcome).toMatchObject({ tic: 21, completed: true, alive: true, time: 99 });
    const early = await run('wk3_sp_c_n_o7', PREFIX, 7);
    expect(early.outcome).toMatchObject({ tic: 20, completed: true, time: 99 });
  });

  it('wins after a teleport right before the exit (Lexy lane w38_tp_sp_c_n_o0: win tic 9, rule off 5)', async () => {
    const { outcome } = await run('tp_sp_c_n_o0', PREFIX, 0);
    expect(outcome).toMatchObject({ tic: 9, completed: true, alive: true });
  });

  it('wins in the tick right after the clock advance: the last tick of a 1 s limit wins (Lexy lane w38r2_time_c_o7: success at 20, rule off 16)', async () => {
    const { outcome } = await run('time_c_o7', PREFIX_ROUND2, 7);
    expect(outcome).toMatchObject({ tic: 20, completed: true, alive: true });
    for (const [lane, tic, start] of [['time_c_o5', 18, 5], ['time_c_o6', 19, 6]] as const) {
      expect((await run(lane, PREFIX_ROUND2, start)).outcome).toMatchObject({ tic, completed: true, alive: true });
    }
  });

  it('loses an arrival one tick after the limit: death_time at 20, where the rule off wins at 17 (Lexy lane w38r2_time_c_o8: failure (time) at 20)', async () => {
    for (const [lane, start] of [['time_c_o8', 8], ['time_c_o9', 9]] as const) {
      const { outcome } = await run(lane, PREFIX_ROUND2, start);
      expect(outcome).toMatchObject({ tic: 20, completed: false, alive: false, reason: DEATH_TIME });
    }
  });

  it('keeps every other actor stepping until the arrival: the bug of a force floor steps at tick 1 and the win is at 5 (Lexy lane w38r2_pfs_b; rule off: won at 1, bug never moves)', async () => {
    for (const lane of ['pfs_b', 'pfs_a']) {
      const engine = await load(lane, PREFIX_ROUND2);
      playTo(engine, null, 1);
      expect(engine.isLevelCompleted()).toBe(false);
      if (lane === 'pfs_b') {
        expect(botEntity(engine, 'bug')).toEqual([BUG_STEPS_TO]);
      }
      playTo(engine, null, TICKS_PER_STEP_ON_EXIT + 1, 1);
      expect(engine.isLevelCompleted()).toBe(true);
      expect(engine.getTick()).toBe(TICKS_PER_STEP_ON_EXIT + 1);
    }
  });

  it('is won with the second player parked before and listed before: the last exit follows the step end (Lexy lane w38_wk2_mp_c_b_o0: win tic 13, rule off 8)', async () => {
    const { outcome } = await run('wk2_mp_c_b_o0', PREFIX, 0);
    expect(outcome).toMatchObject({ tic: 13, completed: true, alive: true });
  });
});

describe('CC2 wave 38 (WEX slide ending): the step onto the exit ends any slide', () => {
  it('runs the last step off ice at walking speed (Lexy lane w38_ice2_sp_c_n_o6: win tic 15, rule off 11)', async () => {
    const { engine, outcome } = await run('ice2_sp_c_n_o6', PREFIX, 6);
    expect(outcome).toMatchObject({ tic: 15, completed: true, alive: true, time: TIME_LIMIT_SECONDS });
    expect(world(engine).player.isSliding).toBe(false);
  });

  it('runs the last step off a force floor at walking speed (Lexy lane w38_ff2_sp_c_n_o6: win tic 15, rule off 11)', async () => {
    const { engine, outcome } = await run('ff2_sp_c_n_o6', PREFIX, 6);
    expect(outcome).toMatchObject({ tic: 15, completed: true, alive: true });
    expect(world(engine).player.isSliding).toBe(false);
  });
});

describe('CC2 wave 38 (WEX input refusal): no input once the exit is reached', () => {
  it('keeps him on the exit with a bug on the next cell and the key held: won at 9, alive (Lexy lane w38r2_held2_c_o0; rule off: won at 4; refusal removed: death_monster at 8)', async () => {
    const { outcome } = await run('held2_c_o0', PREFIX_ROUND2, 0);
    expect(outcome).toMatchObject({ tic: 9, completed: true, alive: true });
  });

  it('holds on the three offsets and with Melinda leading (Lexy lanes w38r2_held2_c_o1 / _o2 / _m_o0: 10 / 11 / 9)', async () => {
    for (const [lane, start, tic] of [['held2_c_o1', 1, 10], ['held2_c_o2', 2, 11], ['held2_m_o0', 0, 9]] as const) {
      const { outcome } = await run(lane, PREFIX_ROUND2, start);
      expect(outcome).toMatchObject({ tic, completed: true, alive: true });
      expect(outcome.reason).not.toBe(DEATH_MONSTER);
    }
  });

  it('refuses a move, a held key, a swap and a turn between the step end and the winning tick', async () => {
    const engine = await load('wk1_sp_c_n_o0', PREFIX);
    playTo(engine, 0, TICKS_PER_STEP_ON_EXIT);
    engine.flushPendingStepEnd();
    expect(world(engine).player.cc3dArrival?.exit?.reached).toBe(true);
    expect(engine.attemptPlayerMove('E')).toBe(false);
    expect(engine.attemptPlayerMoveHeld(['E', 'N'])).toBe(false);
    expect(engine.swapPlayer()).toBe(false);
    expect(engine.dropItem(null)).toBe(false);
    expect(engine.cycleInventory()).toBe(false);
    engine.tick();
    expect(engine.isLevelCompleted()).toBe(true);
    expect(engine.getTick()).toBe(TICKS_PER_STEP_ON_EXIT + 1);
  });
});

describe('CC2 wave 38: an actor reaching the exit cell during the final step', () => {
  it('a rover entering the cell is harmless: won at 9 + o (Lexy lanes w38r2_rover_c_o0 / _o5: 9 / 14; rule off 5 / 10)', async () => {
    for (const [start, tic] of [[0, 9], [5, 14]] as const) {
      const { outcome } = await run(`rover_c_o${start}`, PREFIX_ROUND2, start);
      expect(outcome).toMatchObject({ tic, completed: true, alive: true });
    }
  });

  it('a ghost reaching the cell at the arrival kills him: failure at 9 (Lexy lane w38r2_ghost_c_o1; rule off: success at 6); at o0 he wins at 9 (Lexy lane w38r2_ghost_c_o0)', async () => {
    const ghost = await run('ghost_c_o1', PREFIX_ROUND2, 1);
    expect(ghost.outcome).toMatchObject({ tic: 9, completed: false, alive: false });
    const clear = await run('ghost_c_o0', PREFIX_ROUND2, 0);
    expect(clear.outcome).toMatchObject({ tic: 9, completed: true, alive: true });
  });
});

describe('CC2 wave 38: the reached exit is state', () => {
  it('a snapshot taken between the step end and the winning tick keeps the win, at the same tic as the straight run (w38_wk1_sp_c_n_o0)', async () => {
    const engine = await load('wk1_sp_c_n_o0', PREFIX);
    playTo(engine, 0, TICKS_PER_STEP_ON_EXIT);
    engine.flushPendingStepEnd();
    const keyBefore = JSON.stringify(engine.captureState()) + '|' + engine.getRuntimeKeyExtra();
    const snapshot = engine.captureState();
    expect(snapshot.player.cc3dArrival?.exit?.reached).toBe(true);
    const restored = await load('wk1_sp_c_n_o0', PREFIX);
    restored.restoreState(snapshot);
    expect(JSON.stringify(restored.captureState()) + '|' + restored.getRuntimeKeyExtra()).toBe(keyBefore);
    expect(restored.isLevelCompleted()).toBe(false);
    restored.tick();
    expect(restored.isLevelCompleted()).toBe(true);
    expect(restored.getTick()).toBe(TICKS_PER_STEP_ON_EXIT + 1);
  });

  it('the pending exit is part of the snapshot of the step in progress and differs from the reached one', async () => {
    const running = await load('wk1_sp_c_n_o0', PREFIX);
    playTo(running, 0, 2);
    expect(running.captureState().player.cc3dArrival?.exit).toEqual({ x: expect.any(Number), y: expect.any(Number) });
    expect(running.captureState().player.cc3dArrival?.exit?.reached).toBeUndefined();
  });
});

describe('CC2 wave 38: gating', () => {
  it('a classic-rules and a native level win at the start of the step as before', () => {
    for (const mode of ['cc', 'native'] as const) {
      const engine = new GameEngine();
      engine.loadLevel(room({ mode, startX: 3, terrain: { [`4,${ROOM_ROW}`]: 'exit' } }));
      playMove(engine, 'E');
      expect(engine.isLevelCompleted()).toBe(true);
    }
  });
});
