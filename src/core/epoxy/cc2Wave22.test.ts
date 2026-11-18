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
 * CC2 wave 22, the player rules, played on the Lexy lanes (src/core/epoxy/__fixtures__/cc2-lanes, `w22_` files, imported through the CC2
 * importer as a player would). Each lane is an original construction from an empty grid; every expected value is the value the Lexy run
 * of the lane gives (the end of the Lexy tic named next to it). A lane is played like the Lexy harness plays it: the keys held per tic,
 * a fresh drop or swap at cooldown 0 only, one tick() per Lexy tic, so harness tick t is the Lexy tic t.
 *
 * PKS: a parked player's step end acts at the start of the tick after his wait ran out, as the controlled player's does (Lexy step_on_cell
 * at the end of the 12-frame step for every player actor, game.js 2310-2367), before the time-out check, and a parked player's step
 * onto a brown button works it when that step ends (button_brown, tiletypes.js 2269, on_arrive 2283-2290, from the same step_on_cell).
 * BMB: a bomb lying on water or fire goes off first (step_on_cell walks the layers top down, the item before the terrain, game.js 2315-2366).
 * FDS: real fire never burns a player at a lighting (fire has no on_stand, tiletypes.js 941-972; flame_jet_off.activate kills nothing, 2146-2152).
 * JSD: a jet lit under the still player before his turn is judged at the end of his turn (flame_jet_on on_stand from do_actor_idle, after
 * the decisions, game.js 1345-1356): a step started at that decision escapes.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadCc2Lane } from '../../test/cc2LaneFixture';
import { ROOM_ROW, room } from '../../test/cc2Room';
import type { RoomMode } from '../../test/cc2Room';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { decodeC2m } from '../../formats/C2mCodec';
import { cc2ReplaySections } from '../../formats/cc2Model';
import { CC2_FRAMES_PER_TICK, CC2_REPLAY_ACTION_BITS, CC2_REPLAY_KEY_BITS, decodeCc2Replay } from '../../formats/cc2Replay';
import { GameEngine } from '../GameEngine';
import { PULSE_WIRED_ACTION } from '../coreConstants';
import { triggerButton } from './epoxyDevices';
import type { EpoxyContext, EpoxyWorld } from './epoxyWorld';

beforeEach(() => {
  loadTestConfigs();
});

const LANE_PREFIX = 'w22_';
const LANE_DIR = new URL('./__fixtures__/cc2-lanes/', import.meta.url);
const LANE_TICKS = 40;
const SHORT_LANE_TICKS = 16;
const CHIP_LANE_TICKS = 12;
const DIRECTIONS = ['N', 'E', 'S', 'W'] as const;
const DEATH_FIRE = 'hud.messages.death_fire';
const DEATH_WATER = 'hud.messages.death_water';
const DEATH_BOMB = 'hud.messages.death_bomb';
const DEATH_TIME = 'hud.messages.death_time';
/** The water cell of the parked-slide lanes (the slide ends in it) and the cell of the chip on the run of park2_slide_chip. */
const WATER_CELL = '4,3';
const CHIP_CELL = { x: 3, y: 3 };
/** Lexy: the end of the tic a parked slide ends at (a step started at tic 0, two force floors), and the tick the old flush acted at. */
const PARKED_END_TIC = 8;
const PARKED_END_TIC_EARLY = PARKED_END_TIC - 1;
/** The tic a 12-frame step started at tic 0 ends at (the bomb lanes, the chip lane, the too-late jet lane). */
const STEP_END_TIC = 4;
/** The tic the clock runs out at in the two clock lanes. */
const TIME_LANE_END_TIC = 19;
/** The swap ticks of the two clock lanes. */
const TIME11_SWAP_TICK = 13;
const TIME12_SWAP_TICK = 14;
/** The swap ticks of the two water lanes and of the chip lane. */
const PARK_SWAP_TICK = 4;
const PARK2_SWAP_TICK = 2;
/** The x a clone (park_red) and a trapped ball (the brown lanes) are out at. */
const CLONE_OUT_X = 9;
const BALL_OUT_X = 9;
/** The parked slide onto the teleporter: the cell A leaves at. */
const TELE_EXIT = { x: 5, y: 6 };
/** The cell of the jet of the room tests, and the row of its orange button. */
const ROOM_JET_X = 2;
const ROOM_PLATE_X = 4;
const ROOM_GLIDER_X = 6;
const ROOM_TICKS = 20;
const ROOM_EXIT_X = 3;
const CHARGE_TICKS = 4;
const LEVEL_TICKS = 8;
/** The CC2 jet of the post-turn test, off, and the tile it is lit to. */
const CC2_JET_OFF = 'flame_jet_cc2_off';
const CC2_JET_ON = 'flame_jet_cc2_on';
/** The room tests: the orange button lies two rows under the jet's row, a lit charge one cell beside the jet, and fuses for one tick. */
const ROOM_PLATE_ROW_OFFSET = 2;
const ROOM_CHARGE_X_OFFSET = 1;
const CHARGE_FUSE_TICKS = 1;

type Run = { deathT: number | undefined; reason: string; deadAt: string; swaps: Swap[]; e: GameEngine; w: EpoxyWorld };
type Swap = { t: number; ok: boolean; before: string; after: string };
type Observe = (o: { t: number; e: GameEngine; w: EpoxyWorld }) => void;

const worldOf = (e: GameEngine): EpoxyWorld => (e as unknown as { w: EpoxyWorld }).w;
const whoIs = (w: EpoxyWorld): string => `${w.player.character ?? 'chip'}@${w.player.x},${w.player.y}`;

/** Plays a w22 lane like the Lexy harness (held keys, a fresh drop or swap at cooldown 0) and calls `see` after every tick t. */
async function playLane(lane: string, ticks: number, see?: Observe): Promise<Run> {
  const level = await loadCc2Lane(lane, LANE_PREFIX);
  const bytes = new Uint8Array(readFileSync(fileURLToPath(new URL(`${LANE_PREFIX}${lane}.c2m`, LANE_DIR))));
  const replay = decodeCc2Replay(cc2ReplaySections(decodeC2m(bytes))[0]);
  const e = new GameEngine();
  e.loadLevel(level, replay.blobSeed);
  const w = worldOf(e);
  const keys: number[] = [];
  let at = 0;
  let held = 0;
  for (let t = 0; t < ticks; t++) {
    while (at < replay.inputs.length && replay.inputs[at].frame < (t + 1) * CC2_FRAMES_PER_TICK) held = replay.inputs[at++].keys;
    keys.push(held);
  }
  const actions = CC2_REPLAY_ACTION_BITS.drop | CC2_REPLAY_ACTION_BITS.switchPlayer;
  let released = actions;
  const swaps: Swap[] = [];
  for (let t = 0; t < ticks; t++) {
    const k = keys[t];
    released |= ~k & actions;
    const fresh = k & released;
    let swapped = false;
    const player = e.getPlayer();
    if (fresh !== 0 && player.moveCooldown === 0) {
      if ((fresh & CC2_REPLAY_ACTION_BITS.drop) && !player.isSliding) {
        released &= ~CC2_REPLAY_ACTION_BITS.drop;
        const oldest = player.boots.values().next();
        if (!oldest.done) e.dropItem(oldest.value);
      }
      if (fresh & CC2_REPLAY_ACTION_BITS.switchPlayer) {
        released &= ~CC2_REPLAY_ACTION_BITS.switchPlayer;
        const before = whoIs(w);
        swapped = e.swapPlayer();
        swaps.push({ t, ok: swapped, before, after: whoIs(w) });
      }
    }
    const dirs = DIRECTIONS.filter((d) => (k & CC2_REPLAY_KEY_BITS[d]) !== 0);
    if (!swapped && dirs.length > 0) e.attemptPlayerMoveHeld(dirs);
    e.tick();
    see?.({ t, e, w });
    const p = e.getPlayer();
    if (!p.alive) return { deathT: t, reason: p.deathReasonKey ?? '', deadAt: `${p.x},${p.y}`, swaps, e, w };
  }
  return { deathT: undefined, reason: '', deadAt: '', swaps, e, w };
}

/** The swap went through at the planned tick and control passed from A (chip, running) to B (melinda, at x 1). */
function expectSwap(r: Run, t: number): void {
  expect(r.swaps).toHaveLength(1);
  expect(r.swaps[0].t).toBe(t);
  expect(r.swaps[0].ok).toBe(true);
  expect(r.swaps[0].before.startsWith('chip@')).toBe(true);
  expect(r.swaps[0].after.startsWith('melinda@1,')).toBe(true);
}

/** The first tick a predicate holds at, or undefined. */
async function firstTickWhere(lane: string, ticks: number, holds: (o: Parameters<Observe>[0]) => boolean): Promise<number | undefined> {
  let first: number | undefined;
  await playLane(lane, ticks, (o) => {
    if (first === undefined && holds(o)) first = o.t;
  });
  return first;
}

describe('CC2 wave 22: the parked step end (PKS)', () => {
  it('a parked slide into water drowns him at the end of tic 8, not 7 (park_slide_water swap at t4, park2_slide_water at t2); mutant: PKS off', async () => {
    for (const [lane, swapTick] of [['park_slide_water', PARK_SWAP_TICK], ['park2_slide_water', PARK2_SWAP_TICK]] as const) {
      const r = await playLane(lane, LANE_TICKS);
      expectSwap(r, swapTick);
      expect(r.reason).toBe(DEATH_WATER);
      expect(r.deadAt).toBe(WATER_CELL);
      // Lexy: water at tic 8; the old tick-end flush drowned him at tic 7.
      expect(r.deathT).toBe(PARKED_END_TIC);
      expect(r.deathT).not.toBe(PARKED_END_TIC_EARLY);
    }
  });

  it('a parked slide over a chip takes it at tic 4, not 3 (park2_slide_chip, swap at t2); mutant: PKS off', async () => {
    let taken: number | undefined;
    const r = await playLane('park2_slide_chip', CHIP_LANE_TICKS, ({ t, w }) => {
      if (taken === undefined && w.items[CHIP_CELL.y][CHIP_CELL.x] === null) taken = t;
    });
    expectSwap(r, PARK2_SWAP_TICK);
    // Lexy: the chip is gone at the end of tic 4 (still there at tic 3).
    expect(taken).toBe(STEP_END_TIC);
  });

  it('the clock runs out at tic 19: the water step started at t11 drowns him then (park_time11), the one that would end after it is a time-out (park_time12); mutants: flush after the time-out check, PKS off', async () => {
    const r11 = await playLane('park_time11', LANE_TICKS);
    expectSwap(r11, TIME11_SWAP_TICK);
    expect([r11.deathT, r11.reason]).toEqual([TIME_LANE_END_TIC, DEATH_WATER]);
    const r12 = await playLane('park_time12', LANE_TICKS);
    expectSwap(r12, TIME12_SWAP_TICK);
    expect([r12.deathT, r12.reason]).toEqual([TIME_LANE_END_TIC, DEATH_TIME]);
  });

  it('a parked slide onto a red button clones the glider at the end of tic 8, not 7 (park_red); mutant: PKS off', async () => {
    const out = await firstTickWhere('park_red', SHORT_LANE_TICKS, ({ e }) => e.getEntities().some((m) => m.type === 'glider' && m.x === CLONE_OUT_X));
    expect(out).toBe(PARKED_END_TIC);
  });

  it('a parked slide onto a teleporter jumps at the end of tic 8, not 7: A is at (5,6) then (park_tele); mutant: PKS off', async () => {
    const out = await firstTickWhere('park_tele', SHORT_LANE_TICKS, ({ w }) => {
      const a = [w.player, ...w.parked].find((p) => (p.character ?? 'chip') === 'chip');
      return a !== undefined && a.x === TELE_EXIT.x && a.y === TELE_EXIT.y;
    });
    expect(out).toBe(PARKED_END_TIC);
  });

  it('a parked and a controlled slide onto a brown button both let the ball out at the end of tic 8, not at the step start (park_brown, ctl_brown); mutant: the parked brown check removed', async () => {
    const ballOut = (lane: string): Promise<number | undefined> =>
      firstTickWhere(lane, SHORT_LANE_TICKS, ({ e }) => e.getEntities().some((m) => m.type === 'pink_ball' && m.x === BALL_OUT_X));
    expect(await ballOut('park_brown')).toBe(PARKED_END_TIC);
    expect(await ballOut('ctl_brown')).toBe(PARKED_END_TIC);
  });

  it('the controls (no swap, swap at the death tic) drown at tic 8 (ctl_slide_water, park8_slide_water)', async () => {
    expect((await playLane('ctl_slide_water', LANE_TICKS)).deathT).toBe(PARKED_END_TIC);
    expect((await playLane('park8_slide_water', LANE_TICKS)).deathT).toBe(PARKED_END_TIC);
  });
});

describe('CC2 wave 22: a bomb on water or fire (BMB)', () => {
  it('the bomb goes off at tic 4, not the water or the fire (bomb_water, bomb_fire); mutant: BMB off', async () => {
    for (const lane of ['bomb_water', 'bomb_fire']) {
      const r = await playLane(lane, LANE_TICKS);
      expect(r.deathT).toBe(STEP_END_TIC);
      expect(r.reason).toBe(DEATH_BOMB);
      expect(r.w.items[r.e.getPlayer().y][r.e.getPlayer().x]).toBeNull();
    }
  });
});

describe('CC2 wave 22: real fire at a lighting (FDS)', () => {
  it('a bootless player on real fire lives through the lighting by a wired jet or an orange button (fire_drop_jet, fire_drop_orange), and the control stays alive (fire_drop_none); mutant: FDS off', async () => {
    for (const lane of ['fire_drop_jet', 'fire_drop_orange', 'fire_drop_none']) {
      const r = await playLane(lane, LANE_TICKS);
      expect(r.deathT).toBeUndefined();
      expect(r.e.getPlayer().alive).toBe(true);
    }
  });

  it.each<[RoomMode]>([['cc2'], ['cc'], ['native']])('a jet of the room (orange button pressed by a glider) burns the still player at its lighting, mode %s; mutant: FDS sparing every non-CC2 jet', (mode) => {
    const e = new GameEngine();
    const plateRow = ROOM_ROW + ROOM_PLATE_ROW_OFFSET;
    e.loadLevel({
      ...room({ mode, terrain: { [`${ROOM_JET_X},${ROOM_ROW}`]: 'flame_jet_off', [`${ROOM_PLATE_X},${plateRow}`]: 'button_orange' } }),
      entities: [{ type: 'glider', x: ROOM_GLIDER_X, y: plateRow, dir: 'W' }]
    }, 0);
    let lit: number | undefined;
    let dead: number | undefined;
    for (let t = 0; t < ROOM_TICKS && dead === undefined; t++) {
      e.tick();
      if (lit === undefined && worldOf(e).terrain[ROOM_ROW][ROOM_JET_X] !== 'flame_jet_off') lit = t;
      if (!e.getPlayer().alive) dead = t;
    }
    expect(lit).toBeDefined();
    expect(dead).toBe(lit);
    expect(e.getPlayer().deathReasonKey).toBe(DEATH_FIRE);
  });
});

describe('CC2 wave 22: a jet lit before his move (JSD)', () => {
  it('a step started at the decision of the lighting escapes (go4), too late burns at tic 4 (go5), before the lighting is safe (go3); mutant: JSD off', async () => {
    const go4 = await playLane('jet_still_go4', LANE_TICKS);
    expect(go4.deathT).toBeUndefined();
    const go5 = await playLane('jet_still_go5', LANE_TICKS);
    expect(go5.deathT).toBe(STEP_END_TIC);
    expect(go5.reason).toBe(DEATH_FIRE);
    expect((await playLane('jet_still_go3', LANE_TICKS)).deathT).toBeUndefined();
  });

  it('the JSD markers are gone after every tick of a lane', async () => {
    await playLane('jet_still_go4', LANE_TICKS, ({ w }) => {
      expect(w.cc2TurnAhead).toBeUndefined();
      expect(w.cc2JetAtTurn).toBeUndefined();
    });
  });

  it('cc2TurnAhead is gone after a charge-death tick and a stale cc2JetAtTurn is dropped when the tick opens; mutant: clearActorTick / openActorTick not deleting them', () => {
    const e = new GameEngine();
    e.loadLevel(room({ mode: 'cc2' }), 0);
    e.tick();
    const w = worldOf(e);
    w.litCharges.push({ x: ROOM_JET_X + ROOM_CHARGE_X_OFFSET, y: ROOM_ROW, detonateTick: e.getTick() + CHARGE_FUSE_TICKS, dynamite: true });
    w.cc2JetAtTurn = { x: ROOM_JET_X, y: ROOM_ROW };
    for (let t = 0; t < CHARGE_TICKS && e.getPlayer().alive; t++) e.tick();
    expect(e.getPlayer().alive).toBe(false);
    expect(w.cc2TurnAhead).toBeUndefined();
    expect(w.cc2JetAtTurn).toBeUndefined();
  });

  it('a jet lit under the still player after his turn of the same pass burns him in that tick; mutant: playActorTurn keeping cc2TurnAhead', () => {
    // A press that lands in the pass after his turn (the hook plays his turn, then lights the jets as a monster listed before him would):
    // the jet is no longer ahead of his turn, so it burns him at once (Lexy flame_jet_on on_stand, game.js 1345-1356, runs in his idle turn).
    const e = new GameEngine();
    e.loadLevel(room({ mode: 'cc2', terrain: { [`${ROOM_JET_X},${ROOM_ROW}`]: CC2_JET_OFF } }), 0);
    const ctx = (e as unknown as { ctx: EpoxyContext }).ctx;
    const playTurn = ctx.cc2PlayerActs;
    expect(playTurn).toBeTypeOf('function');
    let lit = false;
    ctx.cc2PlayerActs = () => {
      playTurn?.();
      if (!lit) {
        lit = true;
        triggerButton(ctx, ROOM_PLATE_X, ROOM_ROW, PULSE_WIRED_ACTION);
      }
    };
    e.tick();
    expect(lit).toBe(true);
    expect(worldOf(e).terrain[ROOM_ROW][ROOM_JET_X]).toBe(CC2_JET_ON);
    expect(e.getPlayer().alive).toBe(false);
    expect(e.getPlayer().deathReasonKey).toBe(DEATH_FIRE);
  });

  it('the markers are gone after a level-complete tick', () => {
    const e = new GameEngine();
    e.loadLevel(room({ mode: 'cc2', terrain: { [`${ROOM_EXIT_X},${ROOM_ROW}`]: 'exit' } }), 0);
    e.attemptPlayerMove('E');
    for (let t = 0; t < LEVEL_TICKS && !e.isLevelCompleted(); t++) e.tick();
    expect(e.isLevelCompleted()).toBe(true);
    expect(worldOf(e).cc2TurnAhead).toBeUndefined();
    expect(worldOf(e).cc2JetAtTurn).toBeUndefined();
  });
});

const PARKED_START_X = 2;
const CHIP_X = 3;
const CONTROLLED_START_X = 8;
const SOCKET_X = 9;
const WAIT_GUARD_TICKS = 40;

/** Two players: the first steps onto the last chip then is swapped out, the second stands before a socket. */
function parkedChipRoom(mode: RoomMode): { e: GameEngine; w: EpoxyWorld } {
  const e = new GameEngine();
  const base = room({ mode, startX: PARKED_START_X, chipsRequired: 1, terrain: { [`${SOCKET_X},${ROOM_ROW}`]: 'socket' }, items: { [`${CHIP_X},${ROOM_ROW}`]: 'chip' } });
  e.loadLevel({ ...base, extraPlayers: [{ x: CONTROLLED_START_X, y: ROOM_ROW, dir: 'E', character: 'chip' }] }, 0);
  return { e, w: worldOf(e) };
}

describe('CC2 wave 22: the parked step end acts before the next decision (PKS, multi-player)', () => {
  it.each<RoomMode>(['cc2', 'cc', 'native'])('a parked player taking the last chip lets the controlled one into the socket at the next decision, mode %s; mutant: no parked flush at the input', (mode) => {
    const { e, w } = parkedChipRoom(mode);
    expect(e.attemptPlayerMove('E')).toBe(true);
    e.tick();
    expect(e.swapPlayer()).toBe(true);
    expect(w.player.x).toBe(CONTROLLED_START_X);
    // Lexy: every step end of tic t (the parked player's chip, step_on_cell, game.js 1256-1264) runs before the decisions of tic t+1.
    const parked = w.parked[0];
    let guard = 0;
    while (parked.moveCooldown > 0 && guard++ < WAIT_GUARD_TICKS) e.tick();
    expect(parked.moveCooldown).toBe(0);
    expect(e.attemptPlayerMove('E')).toBe(true);
    expect(w.chipsRemaining).toBe(0);
  });
});
