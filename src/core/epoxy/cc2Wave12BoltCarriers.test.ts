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
 * CC2 wave 12, CHA: any actor standing still and holding the lightning bolt powers the wire under it, a rolling ball or a
 * monster that picked the bolt up included, not only the player (Lexy do_wire_phase, game.js:2632-2643: every actor with
 * movement_cooldown 0 and the charged trait from its toolbelt; tiletypes.js:341 and 2173 give the trait to the bolt).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// The decision point of a tick has no hook in the engine: the real epoxyFrames, followed by the sampler of readAtDecisionAndAfter.
vi.mock('./epoxyFrames', async (importOriginal) => (await import('../../test/cc2DecisionProbe')).decisionSamplingFrames(await importOriginal<typeof import('./epoxyFrames')>()));

import { readAtDecisionAndAfter } from '../../test/cc2DecisionProbe';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { LIGHTNING_BOLT_ITEM_ID } from '../coreConstants';
import { GameEngine } from '../GameEngine';
import type { Cc2LevelData, CompiledLevel, Direction, RuntimeEntity, SignalLink } from '../types';

const SIZE = 9;
const ROW = 3;
const START_CELL = { x: 3, y: ROW };
const WIRE_CELL = { x: 4, y: ROW };
const SINK = { x: 7, y: ROW };
const PLAYER_START = { x: 1, y: 6 };
const WIRE_FLOOR = 'signal_wire_floor';
const WALL_CLOSED = 'purple_wall';
const WALL_OPEN = 'purple_floor';
const WALL = 'wall';
const MAX_TICKS = 80;
const CC2_STUB = { v: 1 } as unknown as Cc2LevelData;
const CARRIER_TYPES = ['rolling_ball', 'rover', 'ghost'];
/** A rover chases the player and never crosses the row on its own, so it is boxed in on the wire and held there instead. */
const BOXED_TYPE = 'rover';
const BUSY_COOLDOWN_TICKS = 200;
const BOXED_SETTLE_TICKS = 4;
/** The carriers that walk onto the wire: the sink is open at the decisions of the tick after the one that brings them to rest, never at a tick end. */
const MOVING_CARRIER_TYPES = ['rolling_ball', 'ghost'];
/** Ticks the walk of a moving carrier is watched for: onto the wire, at rest, off it and on. */
const WALK_TICKS = 14;
/** The tick whose decisions see the sink open (Lexy lanes carrier_ball, carrier_ghost: open at the frame-2 decisions of tic t4 only). */
const REST_DECISION_TICK = 5;

/** An open row with a wired floor and a purple wall as the sink; the carrier starts one cell west of the wire, heading east. */
function room(type: string, cc2: boolean): CompiledLevel {
  const terrain: string[][] = Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x) => (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? WALL : 'floor'))
  );
  terrain[WIRE_CELL.y][WIRE_CELL.x] = WIRE_FLOOR;
  terrain[SINK.y][SINK.x] = WALL_CLOSED;
  const boxed = type === BOXED_TYPE;
  if (boxed) {
    terrain[WIRE_CELL.y - 1][WIRE_CELL.x] = WALL;
    terrain[WIRE_CELL.y + 1][WIRE_CELL.x] = WALL;
    terrain[WIRE_CELL.y][WIRE_CELL.x - 1] = WALL;
    terrain[WIRE_CELL.y][WIRE_CELL.x + 1] = WALL;
  }
  const signalLinks: SignalLink[] = [{ fromX: WIRE_CELL.x, fromY: WIRE_CELL.y, toX: SINK.x, toY: SINK.y }];
  return {
    id: 'bolt_carrier_room',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 200,
    chipsRequired: 0,
    playerStart: { ...PLAYER_START, dir: 'E' },
    terrain,
    items: Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null)),
    entities: [{ type, x: boxed ? WIRE_CELL.x : START_CELL.x, y: START_CELL.y, dir: 'E' as Direction }],
    trapLinks: [],
    cloneLinks: [],
    signalLinks,
    ...(cc2 ? { cc2: CC2_STUB } : {})
  };
}

const carrierOf = (engine: GameEngine): RuntimeEntity | undefined => engine.getEntities().find((e) => e.y === ROW);
const onWire = (e: RuntimeEntity | undefined): boolean => e !== undefined && e.x === WIRE_CELL.x;

/** Loads the room, hands the bolt to the carrier and ticks to the first moment it stands on the wire; `rest` picks at rest or mid step. */
function stepOntoWire(type: string, cc2: boolean, rest: boolean): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(room(type, cc2));
  const first = carrierOf(engine);
  if (first === undefined) throw new Error('the carrier is missing');
  first.heldTools = [LIGHTNING_BOLT_ITEM_ID];
  if (type === BOXED_TYPE) {
    first.cooldownTicks = rest ? 0 : BUSY_COOLDOWN_TICKS;
    for (let i = 0; i < BOXED_SETTLE_TICKS; i++) engine.tick();
    return engine;
  }
  for (let i = 0; i < MAX_TICKS; i++) {
    engine.tick();
    const e = carrierOf(engine);
    if (onWire(e) && (e as RuntimeEntity).cooldownTicks === 0 === rest) return engine;
  }
  throw new Error(`the ${type} never reached the wire`);
}

const sinkTile = (engine: GameEngine): string => engine.getTerrain()[SINK.y][SINK.x];

beforeEach(() => {
  loadTestConfigs();
});

/** The sink after each tick of a moving carrier's walk, and at the decisions inside it. */
function walk(type: string): { after: string[]; decision: (string | undefined)[] } {
  const engine = new GameEngine();
  engine.loadLevel(room(type, true));
  const first = carrierOf(engine);
  if (first === undefined) throw new Error('the carrier is missing');
  first.heldTools = [LIGHTNING_BOLT_ITEM_ID];
  const after: string[] = [];
  const decision: (string | undefined)[] = [];
  for (let i = 0; i < WALK_TICKS; i++) {
    const seen = readAtDecisionAndAfter(() => engine.tick(), () => sinkTile(engine));
    after.push(seen.after);
    decision.push(seen.decision);
  }
  return { after, decision };
}

describe('CC2 wave 12: an actor at rest holding the bolt powers the wire under it', () => {
  // Lexy lanes carrier_ball, carrier_ghost: the carrier comes to rest on the wire at the end of tic t3, the sink is open at the frame-2
  // decisions of t4 only (tick 5) and shut at the end of every tic.
  it.each(MOVING_CARRIER_TYPES)('%s at rest opens the sink at the decisions of the next tick only (game.js:2632-2643)', (type) => {
    const rest = stepOntoWire(type, true, true);
    expect(sinkTile(rest)).toBe(WALL_CLOSED);
    const { after, decision } = walk(type);
    expect(after.every((tile) => tile === WALL_CLOSED)).toBe(true);
    expect(decision.map((tile, i) => (tile === WALL_OPEN ? i + 1 : 0)).filter((tick) => tick > 0)).toEqual([REST_DECISION_TICK]);
  });

  // A carrier at rest from the start of a tick (held on the wire) powers it at the end of that tick too.
  it(`${BOXED_TYPE} at rest opens the sink (game.js:2632-2643)`, () => {
    expect(sinkTile(stepOntoWire(BOXED_TYPE, true, true))).toBe(WALL_OPEN);
  });

  it.each(CARRIER_TYPES)('%s mid step powers nothing (movement_cooldown not 0, game.js:2632-2643)', (type) => {
    expect(sinkTile(stepOntoWire(type, true, false))).toBe(WALL_CLOSED);
  });

  it.each(CARRIER_TYPES)('%s off the CC2 engine powers nothing, as before', (type) => {
    expect(sinkTile(stepOntoWire(type, false, true))).toBe(WALL_CLOSED);
  });
});
