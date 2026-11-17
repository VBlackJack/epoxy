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
 * CC2 wave 20, batch A: the actor rules, played on the Lexy lanes (src/core/epoxy/__fixtures__/cc2-lanes, imported through the CC2
 * importer as a player would).
 *
 * RB: a clone that steps out of a clone machine onto a red button presses it when that step ends (Lexy step_on_cell on_arrive,
 * game.js:2316-2366), with the frame that step ends in, so the second machine releases in the frame the first clone's step ends.
 * JET: a lit flame jet burns the player when his step onto it ends (Lexy flame_jet_on on_stand, called from step_on_cell), and the cell
 * is judged again then (a jet put out during the step spares him).
 *
 * tick() k plays the Lexy tic k - 1: "at the decisions of tick N" is the frame-2 decision point inside tick N (Lexy tic N - 1, frame-2
 * decision phase), "after tick N" is the end of Lexy tic N - 1. Every expected value below is the value of the Lexy lane named next to
 * it (the decision rows of the Lexy run of that lane), which the lane fixture reproduces before the rule is switched on and off.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));
// The decision point of a tick has no hook in the engine: the real epoxyFrames, followed by the sampler of readAtDecisionAndAfter.
vi.mock('./epoxyFrames', async (importOriginal) => (await import('../../test/cc2DecisionProbe')).decisionSamplingFrames(await importOriginal<typeof import('./epoxyFrames')>()));

import { readAtDecisionAndAfter } from '../../test/cc2DecisionProbe';
import { loadCc2Lane } from '../../test/cc2LaneFixture';
import { idleTicks, playMove } from '../../test/cc2Play';
import { ROOM_ROW, room } from '../../test/cc2Room';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { GameEngine } from '../GameEngine';
import type { CompiledLevel, Direction, RuntimeEntity, SignalLink } from '../types';
import type { EpoxyWorld } from './epoxyWorld';

beforeEach(() => {
  loadTestConfigs();
});

const SEED = 3;
const BALL = 'pink_ball';
const GLIDER = 'glider';
/** The x of the cell a ball cloner lets its clone out on: one east of the machine. */
const RELEASE_OFFSET = 1;
/** The cloner of the second glider machine of nest3, and the ball cloner of the other nest lanes. */
const BALL_CLONER_X = 14;
const NEST3_BALL_CLONER_X = 18;
const LANE_TICKS = 20;
/** The tick the input of a lane is given in (Lexy tic 0 is tick 1). */
const FIRST_TICK = 1;
/** Lane jet_out_mid: the player's input is at Lexy tic 2, the third tick. */
const JET_OUT_INPUT_TICK = 3;
/** Lane beh_jet_k4: the second input (north) is at Lexy tic 4, the fifth tick. */
const BEH_SECOND_INPUT_TICK = 5;
/** Lexy ticks (as tick numbers) of lane nest3: the first glider out at the t8 decisions, the last ball out at the t12 decisions, its first step end in t15. */
const NEST3_GLIDER_OUT_TICK = 9;
const NEST3_BALL_OUT_TICK = 13;
const NEST3_BALL_STEP_TICK = 16;
/** Lexy: nest_walk lets its ball out at the t12 decisions, nest_block (a dirt block clone) at the t8 decisions. */
const NEST_WALK_BALL_OUT_TICK = 13;
const NEST_BLOCK_BALL_OUT_TICK = 9;
/** Lexy: hz_flame_jet_on kills at the end of t4 (dead after tick 5); beh_jet_k4 at t8 (dead after tick 9). */
const JET_ON_DEAD_TICK = 5;
const BEH_JET_DEAD_TICK = 9;
/** Lexy jet_out_mid: the player survives the step onto the jet put out, and rests on its cell. */
const JET_OUT_PLAYER_X = 3;
/** Lane jet_lit_mid: the tick whose decisions light the jet (Lexy t4) and the tick he dies in (Lexy: the step end, t6). */
const JET_LIT_MID_LIGHTING_TICK = 5;
const JET_LIT_MID_LEXY_DEAD_TICK = 7;
const DEATH_FIRE_KEY = 'hud.messages.death_fire';
/** Ticks played after the step onto a lit jet: well past the step end that judges it. */
const JET_BOOTS_IDLE_TICKS = 6;
/** The hand-built jet rooms: the glider walks west onto the plate two rows below the jet's row, so it never reaches the player (as in the lane). */
const PLATE_ROW = ROOM_ROW + 2;

interface Seen {
  /** What the decisions of the tick saw (undefined when the pass never reached them, a dead player). */
  decision: Snapshot | undefined;
  /** What the end of the tick shows. */
  after: Snapshot;
}

interface Snapshot {
  alive: boolean;
  deathReasonKey: string | null;
  inWater: boolean;
  px: number;
  py: number;
  entities: { type: string; x: number; y: number }[];
}

const world = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;
const snapshotOf = (engine: GameEngine): Snapshot => {
  const w = world(engine);
  return {
    alive: w.player.alive,
    deathReasonKey: w.player.deathReasonKey,
    inWater: w.player.inWater === true,
    px: w.player.x,
    py: w.player.y,
    entities: w.entities.map((e: RuntimeEntity) => ({ type: e.type, x: e.x, y: e.y }))
  };
};

/** Plays `ticks` ticks of `level`, the inputs given as {tick: direction}, and returns what each tick showed (index 0 is tick 1). */
function play(level: CompiledLevel, inputs: Readonly<Record<number, Direction>>, ticks: number): Seen[] {
  const engine = new GameEngine();
  engine.loadLevel(level, SEED);
  const seen: Seen[] = [];
  for (let tick = FIRST_TICK; tick <= ticks; tick++) {
    const dir = inputs[tick];
    if (dir !== undefined) engine.attemptPlayerMove(dir);
    seen.push(readAtDecisionAndAfter(() => engine.tick(), () => snapshotOf(engine)));
  }
  return seen;
}

const hasBallAt = (snap: Snapshot | undefined, x: number): boolean => snap !== undefined && snap.entities.some((e) => e.type === BALL && e.x === x);

/** The first tick (1-based) whose decisions see a ball on x, or undefined. */
const ballOutAtDecisions = (seen: Seen[], x: number): number | undefined => {
  const index = seen.findIndex((s) => hasBallAt(s.decision, x));
  return index < 0 ? undefined : index + 1;
};

/** The first tick (1-based) whose end shows a ball on x (its first step is the tick before). */
const ballOnAfter = (seen: Seen[], x: number): number | undefined => {
  const index = seen.findIndex((s) => hasBallAt(s.after, x));
  return index < 0 ? undefined : index + 1;
};

/** The first tick (1-based) after which the player is dead, or undefined. */
const deadAfter = (seen: Seen[]): number | undefined => {
  const index = seen.findIndex((s) => !s.after.alive);
  return index < 0 ? undefined : index + 1;
};

const lane = async (name: string): Promise<CompiledLevel> => loadCc2Lane(name);

describe('RB: a clone that steps onto a red button presses it when its step ends (CC2 engine)', () => {
  // Lanes nest_or1 / nest_oror / nest_direct / nest_player: a plate or a red button works cloner A (a glider, east), whose clone steps
  // onto a red button wired to cloner B (a ball). Lexy: ball out at the decisions of t8 / t9 / t8 / t8 (ticks 9 / 10 / 9 / 9), first step
  // end of t12 (tick 13).
  const NEST_BALL_OUT: readonly [string, number][] = [
    ['nest_or1', 9],
    ['nest_oror', 10],
    ['nest_direct', 9],
    ['nest_player', 9]
  ];
  const NEST_FIRST_STEP_TICK = 13;

  it.each(NEST_BALL_OUT)('lane %s lets the ball out at the decisions of tick %i', async (name, outTick) => {
    const seen = play(await lane(name), { [FIRST_TICK]: 'E' }, LANE_TICKS);
    expect(ballOutAtDecisions(seen, BALL_CLONER_X + RELEASE_OFFSET)).toBe(outTick);
    // The clone leaves its machine on that tick and is first seen one cell on at the end of the tick that plays its first step (t12).
    expect(ballOnAfter(seen, BALL_CLONER_X + RELEASE_OFFSET + 1)).toBe(NEST_FIRST_STEP_TICK);
  });

  it('lane nest3 chains three stages: the last ball is out at the decisions of tick 13, its first step ends in tick 16', async () => {
    // Lexy nest3: B out at the t8 decisions (tick 9), C released end of t11, at the t12 decisions (tick 13), first step end of t15 (tick 16).
    const seen = play(await lane('nest3'), { [FIRST_TICK]: 'E' }, LANE_TICKS);
    const glidersOutAt = (x: number): number | undefined => {
      const index = seen.findIndex((s) => s.decision?.entities.some((e) => e.type === GLIDER && e.x === x) === true);
      return index < 0 ? undefined : index + 1;
    };
    expect(glidersOutAt(BALL_CLONER_X + RELEASE_OFFSET)).toBe(NEST3_GLIDER_OUT_TICK);
    expect(ballOutAtDecisions(seen, NEST3_BALL_CLONER_X + RELEASE_OFFSET)).toBe(NEST3_BALL_OUT_TICK);
    expect(ballOnAfter(seen, NEST3_BALL_CLONER_X + RELEASE_OFFSET + 1)).toBe(NEST3_BALL_STEP_TICK);
  });

  it('controls: a glider that walks onto the button (nest_walk) and a block clone (nest_block) keep their own timing', async () => {
    // Lexy nest_walk: ball out at the t12 decisions (tick 13); nest_block (a dirt block clone): t8 (tick 9). Neither is a clone that
    // steps out of a machine onto the button with a monster, so RB does not touch them.
    const walk = play(await lane('nest_walk'), {}, LANE_TICKS);
    expect(ballOutAtDecisions(walk, BALL_CLONER_X + RELEASE_OFFSET)).toBe(NEST_WALK_BALL_OUT_TICK);
    const block = play(await lane('nest_block'), { [FIRST_TICK]: 'E' }, LANE_TICKS);
    expect(ballOutAtDecisions(block, BALL_CLONER_X + RELEASE_OFFSET)).toBe(NEST_BLOCK_BALL_OUT_TICK);
  });
});

describe('JET: a lit flame jet burns the player when his step onto it ends (CC2 engine)', () => {
  it('lane hz_flame_jet_on: stepping onto a lit jet kills at the step end (Lexy t4), not at its start', async () => {
    const seen = play(await lane('hz_flame_jet_on'), { [FIRST_TICK]: 'E' }, LANE_TICKS);
    expect(seen[JET_ON_DEAD_TICK - 2].after.alive).toBe(true);
    expect(deadAfter(seen)).toBe(JET_ON_DEAD_TICK);
  });

  it('lane beh_jet_k4: a jet the plate lit at t4 and entered at the t4 decision kills at t8 (the tick 9)', async () => {
    const seen = play(await lane('beh_jet_k4'), { [FIRST_TICK]: 'E', [BEH_SECOND_INPUT_TICK]: 'N' }, LANE_TICKS);
    expect(seen[BEH_JET_DEAD_TICK - 2].after.alive).toBe(true);
    expect(deadAfter(seen)).toBe(BEH_JET_DEAD_TICK);
  });

  it('lane jet_out_mid: a jet put out during the step spares him (Lexy: survives)', async () => {
    const seen = play(await lane('jet_out_mid'), { [JET_OUT_INPUT_TICK]: 'E' }, LANE_TICKS);
    expect(deadAfter(seen)).toBeUndefined();
    expect(seen[LANE_TICKS - 1].after.px).toBe(JET_OUT_PLAYER_X);
  });

  // Lane jet_lit_mid (Lexy): the player steps onto an unlit jet at tic 2 (input at tick 3), a glider's plate lights it at the t4 decisions
  // (tick 5), during his step, and he dies at the step end, t6: alive after tick 6, dead after tick 7. The jet lit under a step that still
  // runs burns him when the step ends (JLM), not at the lighting.
  it('lane jet_lit_mid: a jet lit during the step burns him when the step ends', async () => {
    const seen = play(await lane('jet_lit_mid'), { [JET_OUT_INPUT_TICK]: 'E' }, LANE_TICKS);
    // Alive at the decisions of the lighting tick (Lexy: alive at them, the jet is lit there) and after tick 6; dead after tick 7.
    expect(seen[JET_LIT_MID_LIGHTING_TICK - 1].decision?.alive).toBe(true);
    expect(seen[JET_LIT_MID_LEXY_DEAD_TICK - 2].after.alive).toBe(true);
    expect(deadAfter(seen)).toBe(JET_LIT_MID_LEXY_DEAD_TICK);
    expect(seen[JET_LIT_MID_LEXY_DEAD_TICK - 1].after.deathReasonKey).toBe(DEATH_FIRE_KEY);
  });

  it('the same room with a jet put out by the plate (the jet starts lit) spares him, as lane jet_out_mid', () => {
    const jetX = 3;
    const plateX = 6;
    const link: SignalLink = { fromX: plateX, fromY: PLATE_ROW, toX: jetX, toY: ROOM_ROW };
    const level: CompiledLevel = {
      ...room({
        mode: 'cc2',
        startX: 2,
        terrain: { [`${jetX},${ROOM_ROW}`]: 'flame_jet_cc2_on', [`${plateX},${PLATE_ROW}`]: 'signal_plate' },
        entities: [{ type: GLIDER, x: plateX + 1, y: PLATE_ROW, dir: 'W' }]
      }),
      signalLinks: [link]
    };
    const seen = play(level, { [JET_OUT_INPUT_TICK]: 'E' }, LANE_TICKS);
    expect(deadAfter(seen)).toBeUndefined();
  });

  it('fire boots spare him at the step end of a lit jet (the twin of lane hz_flame_jet_on, with boots_fire)', () => {
    const jetX = 3;
    const level = room({ mode: 'cc2', startX: 2, terrain: { [`${jetX},${ROOM_ROW}`]: 'flame_jet_cc2_on' } });
    const engine = new GameEngine();
    engine.loadLevel(level, SEED);
    engine.getPlayer().boots.add('boots_fire');
    expect(playMove(engine, 'E').moved).toBe(true);
    idleTicks(engine, JET_BOOTS_IDLE_TICKS);
    expect(world(engine).player.x).toBe(jetX);
    expect(world(engine).player.alive).toBe(true);
  });

  it('native levels keep the burn at the start of the step', () => {
    const jetX = 3;
    const level = room({ mode: 'native', startX: 2, terrain: { [`${jetX},${ROOM_ROW}`]: 'flame_jet_cc2_on' } });
    const engine = new GameEngine();
    engine.loadLevel(level, SEED);
    playMove(engine, 'E');
    expect(world(engine).player.alive).toBe(false);
  });

  it('a step onto water still sets inWater at once, and a step from the water onto a lit jet clears it', () => {
    // Water boots keep him alive in the water. The jet block returns early to wait for the step end: inWater is assigned before it,
    // so the step onto the jet no longer leaves the value of the water behind (F6a). Water deaths are judged at the step end since wave 21; with flippers he lives either way.
    const waterX = 3;
    const jetX = 4;
    const level = room({ mode: 'cc2', startX: 2, terrain: { [`${waterX},${ROOM_ROW}`]: 'water', [`${jetX},${ROOM_ROW}`]: 'flame_jet_cc2_on' } });
    const engine = new GameEngine();
    engine.loadLevel(level, SEED);
    engine.getPlayer().boots.add('boots_water');
    engine.getPlayer().boots.add('boots_fire');
    expect(playMove(engine, 'E').moved).toBe(true);
    expect(world(engine).player.inWater).toBe(true);
    idleTicks(engine, 6);
    expect(playMove(engine, 'E').moved).toBe(true);
    expect(world(engine).player.x).toBe(jetX);
    expect(world(engine).player.inWater).toBe(false);
  });
});
