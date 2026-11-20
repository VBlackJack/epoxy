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
 * CC2 wave 23: the swap key acts only at a decision of the controlled player (SWG), read through one predicate shared with the replay
 * harness (DOP). Lexy runs swap_players from make_player_decision (game.js 1600-1608), a decision exists only at movement cooldown 0
 * (game.js 989-990), and a slide or a teleport exit gives one at every cell. Every expected value is the one the Lexy run of the lane named
 * next to it gives (src/core/epoxy/__fixtures__/cc2-lanes, `w23_` files): harness tick t is Lexy tic t, a swap that acts at tic t is
 * made by swapPlayer() called after t ticks.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { buildTestLevel } from '../../test/buildTestLevel';
import { loadCc2Lane } from '../../test/cc2LaneFixture';
import { room } from '../../test/cc2Room';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { decodeC2m } from '../../formats/C2mCodec';
import { checkCc2Replay } from '../../formats/cc2ReplayCheck';
import { cc2ReplaySections } from '../../formats/cc2Model';
import { decodeCc2Replay } from '../../formats/cc2Replay';
import type { Cc2Replay } from '../../formats/cc2Replay';
import { collectDueMoves, applyTimedMove } from '../../ui/replaySchedule';
import { CONVERTED_ID_SUFFIX } from '../cc3d/cc3dConstants';
import { stableStringify } from '../engineSimHash';
import { GameEngine } from '../GameEngine';
import type { CompiledLevel } from '../types';

beforeEach(() => {
  loadTestConfigs();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const LANE_PREFIX = 'w23_';
const LANE_DIR = new URL('./__fixtures__/cc2-lanes/', import.meta.url);
/** Lexy: A steps east at tic 0 (a 12-frame step, decisions at tics 0, 4, 8), the swap acts at the tic 4 decision. */
const REST_DECISION_TIC = 4;
/** Lexy sl_*_tap2: a slide gives a decision at every cell, so the swap acts at tic 2 and not at tic 1. */
const SLIDE_DECISION_TIC = 2;
/** Lexy tp_*_tap*: the exit of a teleporter gives decisions at tics 4, 6 and 8 (nothing before, nothing at the odd tics between). */
const TELEPORT_DECISION_TICS = [4, 6, 8];
const SETTLE_TICKS = 24;

const ctl = (e: GameEngine): string => (e.getPlayerCharacter() === 'melinda' ? 'player2' : 'player');

async function laneEngine(name: string): Promise<GameEngine> {
  const e = new GameEngine();
  e.loadLevel(await loadCc2Lane(name, LANE_PREFIX));
  return e;
}

async function laneReplay(name: string): Promise<{ level: CompiledLevel; replay: Cc2Replay }> {
  const level = await loadCc2Lane(name, LANE_PREFIX);
  const bytes = new Uint8Array(readFileSync(fileURLToPath(new URL(`${LANE_PREFIX}${name}.c2m`, LANE_DIR))));
  return { level, replay: decodeCc2Replay(cc2ReplaySections(decodeC2m(bytes))[0]) };
}

interface SwapCall {
  tick: number;
  acted: boolean;
}

/** Plays a lane replay through the real replay check and reports every swapPlayer() call the harness made. */
async function harnessSwaps(name: string): Promise<SwapCall[]> {
  const { level, replay } = await laneReplay(name);
  const calls: SwapCall[] = [];
  const real = GameEngine.prototype.swapPlayer;
  vi.spyOn(GameEngine.prototype, 'swapPlayer').mockImplementation(function (this: GameEngine) {
    const tick = this.getTick();
    const acted = real.call(this);
    calls.push({ tick, acted });
    return acted;
  });
  checkCc2Replay(level, replay, 'held', 'epoxy');
  return calls;
}

describe('CC2 wave 23: the swap key acts at a decision only (SWG)', () => {
  // Lexy sw_rest_tap1..3: a tap during the step does nothing; sw_rest_tap4: control passes at tic 4. Fails without SWG (true at tick 1).
  it('refuses during the step, leaves history and undo stack alone, swaps at tic 4 (sw_rest_tap4)', async () => {
    const e = await laneEngine('sw_rest_tap4');
    expect(e.attemptPlayerMove('E')).toBe(true);
    e.tick();
    for (let t = 1; t < REST_DECISION_TIC; t++) {
      expect(e.isDecisionOpen()).toBe(false);
      const history = e.getTimedMoveHistory().length;
      const state = stableStringify(e.captureState());
      const canUndo = e.canUndo();
      expect(e.swapPlayer()).toBe(false);
      expect(e.swapWaitsForDecision()).toBe(true);
      expect(ctl(e)).toBe('player');
      expect(e.getTimedMoveHistory().length).toBe(history);
      expect(e.canUndo()).toBe(canUndo);
      expect(stableStringify(e.captureState())).toBe(state);
      e.tick();
    }
    expect(e.isDecisionOpen()).toBe(true);
    expect(e.swapWaitsForDecision()).toBe(false);
    expect(e.swapPlayer()).toBe(true);
    expect(ctl(e)).toBe('player2');
    expect(e.getTimedMoveHistory().filter((m) => m.swap === true).map((m) => m.tick)).toEqual([REST_DECISION_TIC]);
  });

  // Lexy sl_ice_tap1 / tap2, sl_ff_tap1 / tap2: no swap at tic 1, a swap at tic 2 while sliding. Fails without SWG (true at tick 1).
  it.each(['sl_ice_tap2', 'sl_ff_tap2'])('swaps at the next cell of a slide, not before (%s)', async (lane) => {
    const e = await laneEngine(lane);
    expect(e.attemptPlayerMove('E')).toBe(true);
    e.tick();
    expect(e.isDecisionOpen()).toBe(false);
    expect(e.swapPlayer()).toBe(false);
    expect(e.swapWaitsForDecision()).toBe(true);
    e.tick();
    expect(e.getTick()).toBe(SLIDE_DECISION_TIC);
    expect(e.getPlayer().isSliding).toBe(true);
    expect(e.isDecisionOpen()).toBe(true);
    expect(e.swapPlayer()).toBe(true);
    expect(ctl(e)).toBe('player2');
  });

  // Lexy w23_tp_*: a player who left a teleporter onto a force floor or ice is carried: a swap at tics 1-3 does nothing, one at tic 4 acts.
  it.each(['tp_ff_tap4', 'tp_ice_tap4'])('a teleport exit onto a slide gives no decision before tic 4 (%s)', async (lane) => {
    const e = await laneEngine(lane);
    expect(e.attemptPlayerMove('E')).toBe(true);
    e.tick();
    for (let t = 1; t < REST_DECISION_TIC; t++) {
      expect(e.swapPlayer()).toBe(false);
      expect(ctl(e)).toBe('player');
      e.tick();
    }
    expect(e.swapPlayer()).toBe(true);
    expect(ctl(e)).toBe('player2');
  });

  it('a pause, a dead player and a level with nobody else are not a wait', async () => {
    const e = await laneEngine('sw_rest_tap4');
    expect(e.attemptPlayerMove('E')).toBe(true);
    e.tick();
    expect(e.swapWaitsForDecision()).toBe(true);
    e.setPaused(true);
    expect(e.swapWaitsForDecision()).toBe(false);
    expect(e.swapPlayer()).toBe(false);
    e.setPaused(false);
    expect(e.swapWaitsForDecision()).toBe(true);
    const alone = new GameEngine();
    alone.loadLevel(room({ mode: 'cc2' }));
    expect(alone.attemptPlayerMove('E')).toBe(true);
    expect(alone.swapWaitsForDecision()).toBe(false);
  });

  it('leaves a native level alone: a mid-step swap still acts', () => {
    const level = buildTestLevel(['##########', '#........#', '#.@......#', '#........#', '##########']);
    const e = new GameEngine();
    e.loadLevel({ ...level, extraPlayers: [{ x: 7, y: 3, dir: 'E', character: 'melinda' }] });
    expect(e.attemptPlayerMove('E')).toBe(true);
    expect(e.getPlayer().moveCooldown).toBeGreaterThan(0);
    expect(e.swapWaitsForDecision()).toBe(false);
    expect(e.swapPlayer()).toBe(true);
  });

  it('leaves a converted CC3D level alone: a mid-step swap still acts', () => {
    const level = buildTestLevel(['##########', '#........#', '#.@......#', '#........#', '##########']);
    const e = new GameEngine();
    e.loadLevel({ ...level, id: `lane${CONVERTED_ID_SUFFIX}`, extraPlayers: [{ x: 7, y: 3, dir: 'E', character: 'melinda' }] });
    expect(e.attemptPlayerMove('E')).toBe(true);
    expect(e.swapWaitsForDecision()).toBe(false);
    expect(e.swapPlayer()).toBe(true);
  });

  it('leaves a classic (CC1 flavoured) level alone: a mid-step swap still acts', () => {
    const level = buildTestLevel(['##########', '#........#', '#.@......#', '#........#', '##########']);
    const e = new GameEngine();
    e.loadLevel({ ...level, rulesFlavor: 'cc', extraPlayers: [{ x: 7, y: 3, dir: 'E', character: 'melinda' }] });
    expect(e.attemptPlayerMove('E')).toBe(true);
    expect(e.swapWaitsForDecision()).toBe(false);
    expect(e.swapPlayer()).toBe(true);
  });
});

describe('CC2 wave 23: the replay harness consumes the switch bit at a decision (DOP)', () => {
  // Lexy sw_rest_hold3_5: the key held through the tic 4 decision swaps there. Lexy sw_rest_hold2_3: released before it, the press is lost.
  it('a swap held through the decision acts at tic 4 (sw_rest_hold3_5)', async () => {
    expect(await harnessSwaps('sw_rest_hold3_5')).toEqual([{ tick: REST_DECISION_TIC, acted: true }]);
  });

  it('a swap released before the decision is lost, no call is made (sw_rest_hold2_3)', async () => {
    expect(await harnessSwaps('sw_rest_hold2_3')).toEqual([]);
  });

  it('a tap at the decision acts there (sw_rest_tap4)', async () => {
    expect(await harnessSwaps('sw_rest_tap4')).toEqual([{ tick: REST_DECISION_TIC, acted: true }]);
  });

  it('a slide gives a decision at every cell: the tap of tic 2 acts, the one of tic 1 is lost (sl_ff_tap2, sl_ff_tap1)', async () => {
    expect(await harnessSwaps('sl_ff_tap2')).toEqual([{ tick: SLIDE_DECISION_TIC, acted: true }]);
    expect(await harnessSwaps('sl_ff_tap1')).toEqual([]);
  });

  // Lexy tp_ff_tap1..6: nothing at 1-3, a swap at 4, nothing at 5, a swap at 6.
  it.each([
    ['tp_ff_tap1', []],
    ['tp_ff_tap2', []],
    ['tp_ff_tap3', []],
    ['tp_ff_tap4', [TELEPORT_DECISION_TICS[0]]],
    ['tp_ff_tap5', []],
    ['tp_ff_tap6', [TELEPORT_DECISION_TICS[1]]],
    ['tp_ice_tap1', []],
    ['tp_ice_tap4', [TELEPORT_DECISION_TICS[0]]],
    ['tp_ice_tap5', []],
    ['tp_ice_tap6', [TELEPORT_DECISION_TICS[1]]]
  ] as Array<[string, number[]]>)('a teleport exit onto a slide (%s)', async (lane, actedAt) => {
    const calls = await harnessSwaps(lane);
    expect(calls.map((c) => c.tick)).toEqual(actedAt);
    expect(calls.every((c) => c.acted)).toBe(true);
  });
});

describe('CC2 wave 23: a swap retried every tick replays to the same state (F8)', () => {
  it('a swap refused until the decision, then a fresh engine replaying the recorded history, end in the same state (sw_rest_tap4)', async () => {
    const played = await laneEngine('sw_rest_tap4');
    expect(played.attemptPlayerMove('E')).toBe(true);
    let swapped = false;
    for (let t = 0; t < SETTLE_TICKS; t++) {
      played.tick();
      if (!swapped) swapped = played.swapPlayer();
    }
    expect(swapped).toBe(true);
    const history = played.getTimedMoveHistory();
    expect(history.filter((m) => m.swap === true).map((m) => m.tick)).toEqual([REST_DECISION_TIC]);

    const replayed = await laneEngine('sw_rest_tap4');
    let next = 0;
    for (let t = 0; t <= SETTLE_TICKS; t++) {
      const { due, nextIndex } = collectDueMoves(history, next, replayed.getTick());
      next = nextIndex;
      for (const move of due) applyTimedMove(replayed, move);
      if (t < SETTLE_TICKS) replayed.tick();
    }
    expect(replayed.getTick()).toBe(played.getTick());
    expect(stableStringify(replayed.captureState())).toBe(stableStringify(played.captureState()));
    expect(ctl(replayed)).toBe(ctl(played));
  });
});

