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
 * CC2 wave 19, one wire phase per Lexy frame (game.js:872-889: every frame is decision, action, wire). On a gate-delay network the tick
 * end is the frame-2 wire phase only; the frame-0 and frame-1 phases run with the pre-pass frames of the next tic, before its decisions.
 * A clone machine a frame phase releases takes the press frame of its phase, and a monster clone the before-pass tick (game.js:2218-2242).
 * The lanes below are Lexy lanes rebuilt as units (w19_arrball, w19_arrfireball, w19_f4_*, w19_lswitch_*, w19_beh_*, w19_oror and
 * w19_oror3 block clones); tick() k plays the Lexy tic k - 1.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));
// The decision point of a tick has no hook in the engine: the real epoxyFrames, followed by the sampler of readAtDecisionAndAfter.
vi.mock('./epoxyFrames', async (importOriginal) => (await import('../../test/cc2DecisionProbe')).decisionSamplingFrames(await importOriginal<typeof import('./epoxyFrames')>()));

import { readAtDecisionAndAfter } from '../../test/cc2DecisionProbe';
import { ROOM_ROW, room, type RoomMode } from '../../test/cc2Room';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { GameEngine } from '../GameEngine';
import type { EntityPlacement, RuntimeEntity, SignalLink } from '../types';

beforeEach(() => {
  loadTestConfigs();
});

const OR_GATE = 'signal_gate_or_cc2';
const PLATE = 'signal_plate';
const PULSE_BUTTON = 'signal_button';
const LIGHT_SWITCH = 'toggle_switch_off';
const PURPLE_WALL = 'purple_wall';
const PURPLE_FLOOR = 'purple_floor';
const GREEN_WALL = 'toggle_wall_closed';
const FORCE_FLOOR = 'force_n';
const CLONE_MACHINE = 'clone_machine';
const BLOCK = 'dirt_block';
const SEED = 3;
const LANE_TICKS = 24;
const PLATE_X = 3;
const GATE_X = 4;
const SINK_X = 9;
const CLONE_X = SINK_X + 1;
/** The lanes that push a block: the player starts two cells west of the plate and pushes the block one cell west of it. */
const PUSHER_X = PLATE_X - 2;
const PUSHED_X = PLATE_X - 1;
/** The cell north of the pushed block: the sink of the behaviour lanes, fed from the plate. */
const BEHAVIOUR_SINK_X = PUSHED_X;
const BEHAVIOUR_SINK_Y = ROOM_ROW - 1;
/** The behaviour lanes: the player asks to step north at this tick (Lexy tic 4: the block lands in frame 0, he is at rest in frame 1). */
const BEHAVIOUR_INPUT_AFTER_TICKS = 4;
const LIGHT_SWITCH_X = 3;
const LIGHT_WALL_X = 8;

const link = (fromX: number, toX: number, fromY = ROOM_ROW, toY = ROOM_ROW): SignalLink => ({ fromX, fromY, toX, toY });
const at = (x: number, id: string, y = ROOM_ROW): [string, string] => [`${x},${y}`, id];

function load(mode: RoomMode, tiles: readonly [string, string][], links: SignalLink[], startX: number, entities: EntityPlacement[]): GameEngine {
  const level = room({ mode, startX, terrain: Object.fromEntries(tiles), entities });
  level.signalLinks = links;
  const engine = new GameEngine();
  engine.loadLevel(level, SEED);
  return engine;
}

const monsters = (engine: GameEngine): RuntimeEntity[] => engine.getEntities().filter((e) => e.kind === 'monster');
const monsterAt = (engine: GameEngine, x: number): RuntimeEntity | undefined => monsters(engine).find((e) => e.x === x);

/**
 * The first tick whose end shows a monster at `x` (-1 when never), and the cooldown of the monster at the clone cell at the decisions
 * of that tick (undefined when none is there).
 */
function firstMonsterAt(engine: GameEngine, x: number): { tick: number; cooldownAtDecision: number | undefined } {
  for (let i = 0; i < LANE_TICKS; i++) {
    const seen = readAtDecisionAndAfter(
      () => engine.tick(),
      () => ({ at: monsterAt(engine, x) !== undefined, cooldown: monsterAt(engine, CLONE_X)?.cooldownTicks })
    );
    if (seen.after.at) return { tick: engine.getTick(), cooldownAtDecision: seen.decision?.cooldown };
  }
  return { tick: -1, cooldownAtDecision: undefined };
}

/** The player pushes a block onto a plate wired straight to a cloner holding `template` (the block lands in frame 0 or 1 of the pre-pass). */
function pushedBlockLane(template: string): GameEngine {
  const engine = load(
    'cc2',
    [at(PLATE_X, PLATE), at(SINK_X, CLONE_MACHINE)],
    [link(PLATE_X, SINK_X)],
    PUSHER_X,
    [{ type: template, x: SINK_X, y: ROOM_ROW, dir: 'E' }, { type: BLOCK, x: PUSHED_X, y: ROOM_ROW, dir: 'E' }]
  );
  engine.attemptPlayerMove('E');
  return engine;
}

/** The player steps onto a plate wired through `gates` OR gates to a cloner holding `template` (Lexy lanes f4_*). */
function orChainLane(gates: number, template: string): GameEngine {
  const gateXs = Array.from({ length: gates }, (_, i) => GATE_X + i);
  const xs = [PLATE_X, ...gateXs, SINK_X];
  const engine = load(
    'cc2',
    [at(PLATE_X, PLATE), ...gateXs.map((x): [string, string] => at(x, OR_GATE)), at(SINK_X, CLONE_MACHINE)],
    xs.slice(1).map((x, i) => link(xs[i], x)),
    PLATE_X - 1,
    [{ type: template, x: SINK_X, y: ROOM_ROW, dir: 'E' }]
  );
  engine.attemptPlayerMove('E');
  return engine;
}

describe('a monster clone a frame wire phase releases takes the before-pass tick (WPFB)', () => {
  // Lexy lanes arrball, arrfireball: the block the player pushes lands on the plate in the pre-pass; the plate is wired straight to the
  // cloner. The clone is out at the end of t4 and steps first at t8; before wave 19 it stepped at t9 (the pre-pass arrival counted late).
  const ARRIVAL_CLONE_OUT_TICK = 5;
  const ARRIVAL_FIRST_STEP_TICK = 9;
  it.each(['rolling_ball', 'fireball'])('a %s cloned by a block that lands on its plate steps first in tick 9', (template) => {
    const out = firstMonsterAt(pushedBlockLane(template), CLONE_X);
    expect(out.tick).toBe(ARRIVAL_CLONE_OUT_TICK);
    const step = firstMonsterAt(pushedBlockLane(template), CLONE_X + 1);
    expect(step.tick).toBe(ARRIVAL_FIRST_STEP_TICK);
    expect(step.cooldownAtDecision).toBe(0);
  });

  // Lexy lanes f4_ororfire, f4_oror3fire, f4_ororglider, f4_oror3glider: through two and three ORs the clone is released by the f0 / f1
  // phase of t5 (out at the end of t5) and steps first at t9; a fireball and a glider alike (before wave 19: t8).
  const OR_CLONE_OUT_TICK = 6;
  const OR_FIRST_STEP_TICK = 10;
  it.each([
    ['fireball', 2],
    ['fireball', 3],
    ['glider', 2],
    ['glider', 3]
  ] as const)('a %s cloned through %i ORs is out in tick 6 and steps first in tick 10', (template, gates) => {
    expect(firstMonsterAt(orChainLane(gates, template), CLONE_X).tick).toBe(OR_CLONE_OUT_TICK);
    const step = firstMonsterAt(orChainLane(gates, template), CLONE_X + 1);
    expect(step.tick).toBe(OR_FIRST_STEP_TICK);
    expect(step.cooldownAtDecision).toBe(0);
  });
});

describe('a block clone a frame wire phase releases appears in the tic of its phase (GCR on the frame model)', () => {
  // Lexy lanes or1 / oror / oror3: the clone appears at the end of t4 (frame-2 phase), t5, t5 (frame-0 / frame-1 phase of the next tic): the
  // frame phases of the next tic's pre-pass raise it, not the tick end that precedes them (before wave 19: t4, t4, t4).
  const BLOCK_CLONE_OUT_TICKS: readonly number[] = [5, 6, 6];
  const GATE_COUNTS: readonly number[] = [1, 2, 3];
  it('puts the block clone of 1, 2 and 3 ORs on the floor at the end of tick 5, 6, 6', () => {
    const ticks = GATE_COUNTS.map((gates) => {
      const engine = orChainLane(gates, BLOCK);
      for (let i = 0; i < LANE_TICKS; i++) {
        engine.tick();
        if (engine.getEntities().some((e) => e.kind === 'block' && e.x === CLONE_X)) return engine.getTick();
      }
      return -1;
    });
    expect(ticks).toEqual(BLOCK_CLONE_OUT_TICKS);
  });
});

describe('a toggle switch enters the wires in the frame after its flip (F15)', () => {
  // Lexy light switch: the new level is emitted from the second wire phase after the arrival, so a pushed block that lands in frame 0
  // reaches the wires in the frame-1 phase (the wall is open at the t4 decisions, lane lswitch_blk), and a player who arrives in frame 1
  // in the frame-2 phase (open at the end of t4 but shut at its decisions, lane lswitch_ply).
  function lightSwitchLane(how: 'block' | 'player'): GameEngine {
    const tiles: [string, string][] = [at(LIGHT_SWITCH_X, LIGHT_SWITCH), at(LIGHT_WALL_X, PURPLE_WALL)];
    const links = [link(LIGHT_SWITCH_X, LIGHT_WALL_X)];
    const engine =
      how === 'block'
        ? load('cc2', tiles, links, PUSHER_X, [{ type: BLOCK, x: PUSHED_X, y: ROOM_ROW, dir: 'E' }])
        : load('cc2', tiles, links, LIGHT_SWITCH_X - 1, []);
    engine.attemptPlayerMove('E');
    return engine;
  }
  const wall = (engine: GameEngine): string => engine.getTerrain()[ROOM_ROW][LIGHT_WALL_X];
  /** The first tick whose end shows the wall open, and the first whose decisions see it open. */
  function wallOpening(how: 'block' | 'player'): { post: number; decision: number } {
    const engine = lightSwitchLane(how);
    let post = -1;
    let decision = -1;
    for (let i = 0; i < LANE_TICKS; i++) {
      const seen = readAtDecisionAndAfter(() => engine.tick(), () => wall(engine));
      if (decision < 0 && seen.decision === PURPLE_FLOOR) decision = engine.getTick();
      if (post < 0 && seen.after === PURPLE_FLOOR) post = engine.getTick();
    }
    return { post, decision };
  }

  it('opens the wall of a switch a pushed block lands on at the decisions of the tick the block lands in (lswitch_blk)', () => {
    expect(wallOpening('block')).toEqual({ post: 5, decision: 5 });
  });

  it('opens the wall of a switch the player steps onto at the end of that tick and at the decisions of the next (lswitch_ply)', () => {
    expect(wallOpening('player')).toEqual({ post: 5, decision: 6 });
  });
});

describe('what a step decided at the frame-2 decisions finds (behaviour lanes)', () => {
  // Lexy lanes beh_*_k4: the player pushes a block onto the plate (it lands in frame 0 of t4) and asks to step north into the sink wired
  // from the plate at tic 4. The sink the plate flipped is passable at those decisions in Lexy and in Epoxy alike: observation points,
  // pinned so that the phase model keeps them.
  function behaviourLane(sink: string): GameEngine {
    const engine = load(
      'cc2',
      [at(PLATE_X, PLATE), at(BEHAVIOUR_SINK_X, sink, BEHAVIOUR_SINK_Y)],
      [link(PLATE_X, BEHAVIOUR_SINK_X, ROOM_ROW, BEHAVIOUR_SINK_Y)],
      PUSHER_X,
      [{ type: BLOCK, x: PUSHED_X, y: ROOM_ROW, dir: 'E' }]
    );
    engine.attemptPlayerMove('E');
    for (let i = 0; i < BEHAVIOUR_INPUT_AFTER_TICKS; i++) engine.tick();
    return engine;
  }
  /** Whether the player has entered the sink cell after the tick whose input asks him to step north. */
  function entersSink(sink: string): boolean {
    const engine = behaviourLane(sink);
    engine.attemptPlayerMove('N');
    engine.tick();
    return engine.getPlayer().y === BEHAVIOUR_SINK_Y;
  }

  it('enters a green wall the plate opened', () => {
    expect(entersSink(GREEN_WALL)).toBe(true);
  });

  it('enters a purple wall the plate opened', () => {
    expect(entersSink(PURPLE_WALL)).toBe(true);
  });

  // The force floor the plate reversed carries him back south (Lexy beh_force_k4: he enters, carried back at t6): he is on the sink cell
  // after the tick of the step.
  it('enters a force floor the plate reversed', () => {
    expect(entersSink(FORCE_FLOOR)).toBe(true);
  });
});

describe('a pulse press with nothing else moving still reaches the wires (frame-0 phase without a sample)', () => {
  // The player steps onto a push button wired straight to a green wall (a flip on the rising edge only: a purple wall flips on both
  // edges of the one-phase pulse and ends where it began); no block, no clone, nothing else moves, so the pre-pass has nothing to move
  // and the frame phases are finished without a frame-start sample. The press must not be lost (Lexy button: a press pulses the wire in
  // the wire phase that follows the step end).
  it('flips the wall within the lane ticks', () => {
    const engine = load('cc2', [at(PLATE_X, PULSE_BUTTON), at(SINK_X, GREEN_WALL)], [link(PLATE_X, SINK_X)], PLATE_X - 1, []);
    engine.attemptPlayerMove('E');
    let flipped = false;
    for (let i = 0; i < LANE_TICKS && !flipped; i++) {
      engine.tick();
      flipped = engine.getTerrain()[ROOM_ROW][SINK_X] !== GREEN_WALL;
    }
    expect(flipped).toBe(true);
  });
});
