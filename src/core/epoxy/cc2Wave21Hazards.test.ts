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
 * CC2 wave 21, the hazards of the player's step, played on the Lexy lanes (src/core/epoxy/__fixtures__/cc2-lanes, `w21_` files, imported
 * through the CC2 importer as a player would).
 *
 * HZ: a step onto fire, water or slime is judged when the step ends, not when it starts (Lexy on_arrive from step_on_cell, tiletypes.js
 * 941-1010, 1121-1137; game.js 2310-2367). A monster that moves into him during the step kills him first, and the clock running out
 * during the step is a time-out. An unprotected player is not drawn swimming while the step runs (player_visual_state swims a waterproof
 * player only, tiletypes.js 202-208).
 * JLM: a flame jet lit under a player whose step still runs burns him when the step ends, if still lit (flame_jet_off.activate kills
 * nothing, tiletypes.js 2146-2152; flame_jet_on on_stand from step_on_cell, 2163-2168, game.js 2365-2366); a player standing still
 * burns at the lighting.
 *
 * tick() k plays the Lexy tic k - 1: "dead after tick N" is the end of Lexy tic N - 1. Every expected value is the value the Lexy run of
 * the lane named next to it gives (the death tic and reason of the oracle samples of the lane).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadCc2Lane } from '../../test/cc2LaneFixture';
import { ROOM_ROW, room } from '../../test/cc2Room';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { GameEngine } from '../GameEngine';
import type { CompiledLevel, Direction, SignalLink } from '../types';
import type { EpoxyWorld } from './epoxyWorld';

beforeEach(() => {
  loadTestConfigs();
});

const SEED = 3;
const LANE_PREFIX = 'w21_';
const LANE_TICKS = 30;
/** The tick the input of a lane is given in (Lexy tic 0 is tick 1). */
const FIRST_TICK = 1;
const DEATH_FIRE = 'hud.messages.death_fire';
const DEATH_WATER = 'hud.messages.death_water';
const DEATH_SLIME = 'hud.messages.death_slime';
const DEATH_MONSTER = 'hud.messages.death_monster';
const DEATH_TIME = 'hud.messages.death_time';
/** The last tick of the key held down in the lanes flippers and fireboots (the two hazard cells are crossed by then). */
const PROTECTED_HOLD_LAST_TICK = 17;
/** Lexy: a step of 12 frames ends in the fourth tic after the one that starts it. */
const STEP_TICKS = 4;
/** Ticks played after a step, well past the step end that judges it. */
const SETTLE_TICKS = 8;
const MOVE_WAIT_TICKS = 20;
const GLIDER = 'glider';
const JET_OFF = 'flame_jet_cc2_off';
const JET_ON = 'flame_jet_cc2_on';
const PLATE = 'signal_plate';
const ORANGE_BUTTON = 'button_orange';
/** The flame jets of native and CC1 classic levels (the CC2 import has its own). */
const CLASSIC_JET_OFF = 'flame_jet_off';
const CLASSIC_JET_ON = 'flame_jet_on';
const WATER = 'water';
const FLOOR_ROW_OFFSET = 2;

interface Seen {
  alive: boolean;
  reason: string | null;
  inWater: boolean;
  /** Whether the pending hazard cell of the controlled player is set. */
  hazardPending: boolean;
  x: number;
}

const world = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;
const seenOf = (engine: GameEngine): Seen => {
  const p = world(engine).player;
  return { alive: p.alive, reason: p.deathReasonKey, inWater: p.inWater === true, hazardPending: p.cc3dArrival?.hazard !== undefined, x: p.x };
};

/** Plays a level; `inputs` maps a tick to the direction held in it. Returns what each tick showed (index 0 is tick 1). */
function playLevel(level: CompiledLevel, inputs: Readonly<Record<number, Direction>>, setup?: (engine: GameEngine) => void): Seen[] {
  const engine = new GameEngine();
  engine.loadLevel(level, SEED);
  setup?.(engine);
  const out: Seen[] = [];
  for (let tick = FIRST_TICK; tick <= LANE_TICKS && engine.getPlayer().alive; tick++) {
    const dir = inputs[tick];
    if (dir !== undefined) engine.attemptPlayerMove(dir);
    engine.tick();
    out.push(seenOf(engine));
  }
  return out;
}

const playLane = async (name: string, inputs: Readonly<Record<number, Direction>>): Promise<Seen[]> => playLevel(await loadCc2Lane(name, LANE_PREFIX), inputs);

/** The first tick (1-based) after which the player is dead, or undefined. */
const deadAfter = (seen: Seen[]): number | undefined => {
  const index = seen.findIndex((s) => !s.alive);
  return index < 0 ? undefined : index + 1;
};

const at = (tick: number): Record<number, Direction> => ({ [tick]: 'E' });
const heldEast = (from: number, to: number): Record<number, Direction> => Object.fromEntries(Array.from({ length: to - from + 1 }, (_, i) => [from + i, 'E' as Direction]));

describe('HZ: a step onto fire, water or slime is judged when the step ends (CC2 engine)', () => {
  // Lanes hz_fire / hz_water / hz_slime: a step east at tic 0 onto the hazard. Lexy: dead at the end of t4 with the reason of the hazard.
  it.each([
    ['hz_fire', DEATH_FIRE],
    ['hz_water', DEATH_WATER],
    ['hz_slime', DEATH_SLIME]
  ])('lane %s: alive after tick 4, dead after tick 5 of %s', async (name, reason) => {
    const seen = await playLane(name, at(FIRST_TICK));
    expect(seen[3].alive).toBe(true);
    expect(deadAfter(seen)).toBe(5);
    expect(seen[4].reason).toBe(reason);
  });

  // Lanes ff_water, ice_fire, ice_water, tele_water: the slide step, or the exit step of a teleporter, that ends in the hazard. Lexy: t8.
  it.each([
    ['ff_water', DEATH_WATER],
    ['ice_fire', DEATH_FIRE],
    ['ice_water', DEATH_WATER],
    ['tele_water', DEATH_WATER]
  ])('lane %s: alive after tick 8, dead after tick 9 of %s', async (name, reason) => {
    const seen = await playLane(name, at(FIRST_TICK));
    expect(seen[7].alive).toBe(true);
    expect(deadAfter(seen)).toBe(9);
    expect(seen[8].reason).toBe(reason);
  });

  // Lane monster_mid1: the step into water starts at t1 (input at tick 2); a glider moves into his cell at t4, in the window. Lexy: t4,
  // the monster kills first (reason monster), not the water.
  it('lane monster_mid1: a monster that moves into him during the step kills him, not the water', async () => {
    const seen = await playLane('monster_mid1', at(2));
    expect(deadAfter(seen)).toBe(5);
    expect(seen[4].reason).toBe(DEATH_MONSTER);
  });

  // Lanes time_mid15 / time_mid16 (a one second limit, 60 tics, 15 ticks of a second here): the step into water starts at t15 / t16.
  // Lexy: the step that ends before the clock does drowns him (t19); the step that ends after it is a time-out.
  it('lane time_mid15: a step that ends before the clock runs out drowns him', async () => {
    const seen = await playLane('time_mid15', at(16));
    expect(deadAfter(seen)).toBe(20);
    expect(seen[19].reason).toBe(DEATH_WATER);
  });

  it('lane time_mid16: a step that ends after the clock runs out is a time-out', async () => {
    const seen = await playLane('time_mid16', at(17));
    expect(deadAfter(seen)).toBe(20);
    expect(seen[19].reason).toBe(DEATH_TIME);
  });

  // Lanes flippers / fireboots: the tool is picked up, then two hazard cells are crossed with the key held. Lexy: alive.
  it.each([['flippers'], ['fireboots']])('lane %s: the protected player crosses both hazard cells and lives', async (name) => {
    const seen = await playLane(name, heldEast(FIRST_TICK, PROTECTED_HOLD_LAST_TICK));
    expect(deadAfter(seen)).toBeUndefined();
    expect(seen).toHaveLength(LANE_TICKS);
  });

  // Lane hz_water (Lexy player_visual_state): an unprotected player is drawn in his normal pose while the step runs; the swim pose is for a
  // waterproof player. The judge sets inWater, so it is true at the death.
  it('lane hz_water: inWater is false while the step into the water runs, and true at the death', async () => {
    const seen = await playLane('hz_water', at(FIRST_TICK));
    expect(seen[3].alive).toBe(true);
    expect(seen[3].hazardPending).toBe(true);
    expect(seen[3].inWater).toBe(false);
    expect(seen[4].alive).toBe(false);
    expect(seen[4].inWater).toBe(true);
  });

  it('flippers keep the swim pose from the start of the step into the water', async () => {
    const level = room({ mode: 'cc2', startX: 2, terrain: { [`3,${ROOM_ROW}`]: WATER } });
    const seen = playLevel(level, at(FIRST_TICK), (engine) => engine.getPlayer().boots.add('boots_water'));
    expect(seen[0].inWater).toBe(true);
    expect(deadAfter(seen)).toBeUndefined();
  });

  it('native levels keep the death at the start of the step', () => {
    const level = room({ mode: 'native', startX: 2, terrain: { [`3,${ROOM_ROW}`]: WATER } });
    const seen = playLevel(level, at(FIRST_TICK));
    expect(deadAfter(seen)).toBe(1);
  });

  it('CC1 classic levels keep the death at the start of the step', () => {
    const level = room({ mode: 'cc', startX: 2, terrain: { [`3,${ROOM_ROW}`]: WATER } });
    const seen = playLevel(level, at(FIRST_TICK));
    expect(deadAfter(seen)).toBe(1);
  });

  // Lexy ff_start: the player starts on a force floor that carries him into water; he drowns at t6, in the step-end flush before the t6
  // decisions. The room is the one of the cc2GateDelay F5 test; the lane is the same construction.
  it('lane ff_start: the player carried from his start cell into water drowns at tick 7 of the flush', async () => {
    const seen = playLevel(await loadCc2Lane('ff_start', LANE_PREFIX), {});
    expect(deadAfter(seen)).toBe(7);
    expect(seen[6].reason).toBe(DEATH_WATER);
  });
});

describe('JLM: a jet lit under a player whose step runs burns him when the step ends (CC2 engine)', () => {
  // Lanes jet_lit_k1 / jet_lit_k3: the step onto the unlit jet starts at t1 / t3; the plate lights the jet at the t4 decisions, during the
  // step. Lexy: dead at t5 / t7 (the step end).
  it.each([
    ['jet_lit_k1', 2, 6],
    ['jet_lit_k3', 4, 8]
  ])('lane %s: input at tick %i, dead after tick %i', async (name, input, dead) => {
    const seen = await playLane(name, at(input));
    expect(seen[dead - 2].alive).toBe(true);
    expect(deadAfter(seen)).toBe(dead);
    expect(seen[dead - 1].reason).toBe(DEATH_FIRE);
  });

  // Lane jet_orange_mid: a glider on an orange button lights the jet for one tic during his step; it is out at the step end. Lexy: alive.
  it('lane jet_orange_mid: an orange button that lights the jet for one tic during the step spares him', async () => {
    const seen = await playLane('jet_orange_mid', at(3));
    expect(deadAfter(seen)).toBeUndefined();
  });

  // Controls: a jet lit under a player standing still (jet_lit_still), or lit at the very end of his step (jet_lit_k0), burns him in the same
  // tic. Lexy: t4.
  it.each([
    ['jet_lit_still', {}],
    ['jet_lit_k0', at(FIRST_TICK)]
  ])('lane %s: the jet burns him at the lighting (dead after tick 5)', async (name, inputs) => {
    const seen = await playLane(name, inputs);
    expect(deadAfter(seen)).toBe(5);
    expect(seen[4].reason).toBe(DEATH_FIRE);
  });

  // Native and CC1 classic levels keep the burn at the lighting of a jet, in the tick of the lighting even while his step runs: a glider
  // presses an orange button, the jet comes on under a player whose step is still under way.
  it.each([
    ['native', 5],
    ['cc', 3]
  ] as const)('%s levels keep the burn at the lighting of a jet (input at tick %i)', (mode, input) => {
    const row = ROOM_ROW + FLOOR_ROW_OFFSET;
    const level = room({
      mode,
      startX: 2,
      terrain: { [`3,${ROOM_ROW}`]: CLASSIC_JET_OFF, [`6,${row}`]: ORANGE_BUTTON },
      entities: [{ type: GLIDER, x: 7, y: row, dir: 'W' }]
    });
    const engine = new GameEngine();
    engine.loadLevel(level, SEED);
    let litTick: number | undefined;
    let deadTick: number | undefined;
    let stepRanAtLighting = false;
    for (let tick = FIRST_TICK; tick <= LANE_TICKS && deadTick === undefined; tick++) {
      if (tick === input) engine.attemptPlayerMove('E');
      engine.tick();
      if (litTick === undefined && world(engine).terrain[ROOM_ROW][3] === CLASSIC_JET_ON) {
        litTick = tick;
        stepRanAtLighting = world(engine).player.moveCooldown > 0;
      }
      if (!world(engine).player.alive) deadTick = tick;
    }
    expect(litTick).toBeDefined();
    expect(stepRanAtLighting).toBe(true);
    expect(deadTick).toBe(litTick);
  });
});

describe('two players: the step end of a player who is not controlled', () => {
  const PARKED_X = 9;
  const PARKED_ROW = 8;
  const twoPlayerRoom = (terrain: Record<string, string>, extra: Partial<CompiledLevel> = {}): CompiledLevel => ({
    ...room({ mode: 'cc2', startX: 2, terrain }),
    extraPlayers: [{ x: PARKED_X, y: PARKED_ROW, dir: 'E', character: 'chip' }],
    ...extra
  });

  it('a player swapped out in his step into water drowns when that step ends, not before and not never', () => {
    const engine = new GameEngine();
    engine.loadLevel(twoPlayerRoom({ [`3,${ROOM_ROW}`]: WATER }), SEED);
    expect(engine.attemptPlayerMove('E')).toBe(true);
    engine.tick();
    expect(engine.swapPlayer()).toBe(true);
    const players = (): { alive: boolean; x: number }[] => [world(engine).player, ...world(engine).parked].map((p) => ({ alive: p.alive, x: p.x }));
    // Both live while his step runs, and he has not drowned in the tick of the swap.
    expect(players().every((p) => p.alive)).toBe(true);
    let died: number | undefined;
    for (let tick = 1; tick <= SETTLE_TICKS && died === undefined; tick++) {
      engine.tick();
      if (players().some((p) => !p.alive)) died = tick;
    }
    expect(died).toBeDefined();
    expect(died).toBeLessThanOrEqual(STEP_TICKS);
    expect(died).toBeGreaterThan(0);
  });

  // The several-players branch of the lighting: each player is judged on his own step. A jet lit under the player who still steps burns
  // him at his step end; the one who stands still on a lit jet burns at once.
  function jetRoom(): CompiledLevel {
    const plateRow = ROOM_ROW + FLOOR_ROW_OFFSET;
    const link: SignalLink = { fromX: 6, fromY: plateRow, toX: 3, toY: ROOM_ROW };
    return twoPlayerRoom({ [`3,${ROOM_ROW}`]: JET_OFF, [`6,${plateRow}`]: PLATE }, { entities: [{ type: GLIDER, x: 7, y: plateRow, dir: 'W' }], signalLinks: [link] });
  }

  it('a jet lit under the controlled player in his step burns him at the step end, with another player on the map', () => {
    const engine = new GameEngine();
    engine.loadLevel(jetRoom(), SEED);
    let litTick: number | undefined;
    let deadTick: number | undefined;
    let litWhileAlive = false;
    for (let tick = 1; tick <= LANE_TICKS && deadTick === undefined; tick++) {
      if (tick === 3) engine.attemptPlayerMove('E');
      engine.tick();
      const lit = world(engine).terrain[ROOM_ROW][3] === JET_ON;
      if (lit && litTick === undefined) {
        litTick = tick;
        litWhileAlive = world(engine).player.alive && world(engine).player.cc3dArrival?.hazard !== undefined;
      }
      if (!world(engine).player.alive) deadTick = tick;
    }
    expect(litTick).toBeDefined();
    expect(litWhileAlive).toBe(true);
    expect(deadTick).toBeGreaterThan(litTick as number);
  });
});

describe('F3: the boots that guard the cell of a step that still runs are not put down mid-step', () => {
  const FIRE = 'fire';
  const FIRE_BOOTS = 'boots_fire';
  const fireRoom = (mode: 'cc2' | 'native' = 'cc2'): CompiledLevel => room({ mode, startX: 2, terrain: { [`3,${ROOM_ROW}`]: FIRE } });

  it('refuses the drop while the step onto the fire runs, keeps the boots, and he lives', () => {
    const engine = new GameEngine();
    engine.loadLevel(fireRoom(), SEED);
    engine.getPlayer().boots.add(FIRE_BOOTS);
    expect(engine.attemptPlayerMove('E')).toBe(true);
    engine.tick();
    expect(engine.getPlayer().cc3dArrival?.hazard).toEqual({ x: 3, y: ROOM_ROW });
    engine.dropItem(FIRE_BOOTS);
    engine.tick();
    expect(engine.getStatusBannerKey()).toBe('hud.messages.drop_protected');
    expect(engine.holdsItem(FIRE_BOOTS)).toBe(true);
    for (let i = 0; i < MOVE_WAIT_TICKS; i++) engine.tick();
    expect(engine.getPlayer().alive).toBe(true);
    expect(engine.holdsItem(FIRE_BOOTS)).toBe(true);
  });

  it('accepts the drop once the step has ended, and he lives', () => {
    const engine = new GameEngine();
    engine.loadLevel(fireRoom(), SEED);
    engine.getPlayer().boots.add(FIRE_BOOTS);
    engine.attemptPlayerMove('E');
    for (let i = 0; i < MOVE_WAIT_TICKS; i++) engine.tick();
    expect(engine.getPlayer().cc3dArrival).toBeUndefined();
    expect(engine.dropItem(FIRE_BOOTS)).toBe(true);
    for (let i = 0; i < MOVE_WAIT_TICKS; i++) engine.tick();
    expect(engine.getPlayer().alive).toBe(true);
    expect(engine.holdsItem(FIRE_BOOTS)).toBe(false);
  });

  it('does not refuse an extra worn pair on a belt level: the pair worn stays on his feet', () => {
    const engine = new GameEngine();
    engine.loadLevel(fireRoom(), SEED);
    engine.getPlayer().boots.add(FIRE_BOOTS);
    engine.getPlayer().keys[FIRE_BOOTS] = 1;
    expect(engine.attemptPlayerMove('E')).toBe(true);
    engine.tick();
    expect(engine.getPlayer().cc3dArrival?.hazard).toEqual({ x: 3, y: ROOM_ROW });
    engine.dropItem(FIRE_BOOTS);
    engine.tick();
    expect(engine.getStatusBannerKey()).not.toBe('hud.messages.drop_protected');
    expect(engine.getPlayer().boots.has(FIRE_BOOTS)).toBe(true);
    for (let i = 0; i < MOVE_WAIT_TICKS; i++) engine.tick();
    expect(engine.getPlayer().alive).toBe(true);
  });

  it('refuses a drop on a native level as before (the banner is the same, nothing changes)', () => {
    const engine = new GameEngine();
    engine.loadLevel(fireRoom('native'), SEED);
    engine.getPlayer().boots.add(FIRE_BOOTS);
    engine.attemptPlayerMove('E');
    for (let i = 0; i < MOVE_WAIT_TICKS; i++) engine.tick();
    expect(engine.dropItem(FIRE_BOOTS)).toBe(false);
    expect(engine.getStatusBannerKey()).toBe('hud.messages.drop_protected');
  });
});
