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

import { beforeEach, describe, expect, it } from 'vitest';

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

describe('CC2 wave 12: an actor at rest holding the bolt powers the wire under it', () => {
  it.each(CARRIER_TYPES)('%s at rest opens the sink (game.js:2632-2643)', (type) => {
    expect(sinkTile(stepOntoWire(type, true, true))).toBe(WALL_OPEN);
  });

  it.each(CARRIER_TYPES)('%s mid step powers nothing (movement_cooldown not 0, game.js:2632-2643)', (type) => {
    expect(sinkTile(stepOntoWire(type, true, false))).toBe(WALL_CLOSED);
  });

  it.each(CARRIER_TYPES)('%s off the CC2 engine powers nothing, as before', (type) => {
    expect(sinkTile(stepOntoWire(type, false, true))).toBe(WALL_CLOSED);
  });
});
