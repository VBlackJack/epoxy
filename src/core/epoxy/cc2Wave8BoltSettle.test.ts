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

import { beforeEach, describe, expect, it, vi } from 'vitest';

// The decision point of a tick has no hook in the engine: the real epoxyFrames, followed by the sampler of readAtDecisionAndAfter.
vi.mock('./epoxyFrames', async (importOriginal) => (await import('../../test/cc2DecisionProbe')).decisionSamplingFrames(await importOriginal<typeof import('./epoxyFrames')>()));

import { readAtDecisionAndAfter } from '../../test/cc2DecisionProbe';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { LIGHTNING_BOLT_ITEM_ID } from '../coreConstants';
import { GameEngine } from '../GameEngine';
import type { Cc2LevelData, CompiledLevel, Direction, SignalLink } from '../types';

const SIZE = 13;
const MAX_WAIT_TICKS = 40;
const SETTLE_TICKS = 4;
const START = { x: 2, y: 5 };
const SOURCE = { x: 3, y: 5 };
const SINK = { x: 8, y: 3 };
const WIRE_FLOOR = 'signal_wire_floor';
const WALL_A = 'purple_wall';
const WALL_B = 'purple_floor';
const CC2_STUB = { v: 1 } as unknown as Cc2LevelData;

function room(cc2: boolean): CompiledLevel {
  const terrain: string[][] = Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x) => (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? 'wall' : 'floor'))
  );
  terrain[SOURCE.y][SOURCE.x] = WIRE_FLOOR;
  terrain[SINK.y][SINK.x] = WALL_A;
  const signalLinks: SignalLink[] = [{ fromX: SOURCE.x, fromY: SOURCE.y, toX: SINK.x, toY: SINK.y }];
  return {
    id: 'bolt_settle_room',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 200,
    chipsRequired: 0,
    playerStart: { ...START, dir: 'E' },
    terrain,
    items: Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null)),
    entities: [],
    trapLinks: [],
    cloneLinks: [],
    signalLinks,
    ...(cc2 ? { cc2: CC2_STUB } : {})
  };
}

function step(engine: GameEngine, dir: Direction): void {
  for (let waited = 0; waited <= MAX_WAIT_TICKS; waited++) {
    if (engine.getPlayer().moveCooldown === 0) {
      engine.attemptPlayerMove(dir);
      return;
    }
    engine.tick();
  }
  throw new Error('the player never became able to move');
}

/** Runs the step the last input started (the cooldown only shows once the tick has run), then the settle ticks. */
function settle(engine: GameEngine): void {
  engine.tick();
  for (let i = 0; i < MAX_WAIT_TICKS && engine.getPlayer().moveCooldown !== 0; i++) engine.tick();
  for (let i = 0; i < SETTLE_TICKS; i++) engine.tick();
}

const sinkTile = (engine: GameEngine): string => engine.getTerrain()[SINK.y][SINK.x];

function powered(cc2: boolean): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(room(cc2));
  engine.getPlayer().boots.add(LIGHTNING_BOLT_ITEM_ID);
  step(engine, 'E');
  settle(engine);
  return engine;
}

beforeEach(() => {
  loadTestConfigs();
});

/** What the sink shows at the end of one tick and at the decisions inside it, and the cooldown of the player at the end of it. */
interface TickView {
  after: string;
  decision: string | undefined;
  cooldown: number;
}

function viewTick(engine: GameEngine): TickView {
  const seen = readAtDecisionAndAfter(() => engine.tick(), () => sinkTile(engine));
  return { after: seen.after, decision: seen.decision, cooldown: engine.getPlayer().moveCooldown };
}

describe('CC2 lightning bolt holder keeps its level through the move settle', () => {
  // Lexy lane bolt_purple_wall: the holder comes to rest at the end of tic t3 and the wire is read in the wire phase after it: the sink
  // shows the new level one tick later, at the end of tic t4 and at its frame-2 decisions (the end of tick 4 plays t3, tick 5 plays t4).
  it('rising edge: the source stays unpowered right after the step onto the wire, powered one tick after he is at rest', () => {
    const engine = new GameEngine();
    engine.loadLevel(room(true));
    engine.getPlayer().boots.add(LIGHTNING_BOLT_ITEM_ID);
    step(engine, 'E');
    expect(sinkTile(engine)).toBe(WALL_A);
    let view = viewTick(engine);
    for (let waited = 0; view.cooldown !== 0 && waited <= MAX_WAIT_TICKS; waited++) {
      expect(view).toEqual({ after: WALL_A, decision: WALL_A, cooldown: view.cooldown });
      view = viewTick(engine);
    }
    // The tick his step ends in: still unpowered at its end and at its decisions.
    expect(view).toEqual({ after: WALL_A, decision: WALL_A, cooldown: 0 });
    const next = viewTick(engine);
    expect(next.decision).toBe(WALL_B);
    expect(next.after).toBe(WALL_B);
    settle(engine);
    expect(sinkTile(engine)).toBe(WALL_B);
  });

  // Lexy lane bolt_purple_wall: the holder leaves at tic t11; the wire phase of that tic drops the level (the sink is shut at its end),
  // while the frame-2 decisions of the tic still see it open and those of the next tic see it shut.
  it('falling edge: the source stays powered at the decisions of the step off the wire, drops at the end of that tick', () => {
    const engine = powered(true);
    expect(sinkTile(engine)).toBe(WALL_B);
    step(engine, 'E');
    expect(sinkTile(engine)).toBe(WALL_B);
    const leaving = viewTick(engine);
    expect(leaving.decision).toBe(WALL_B);
    expect(leaving.after).toBe(WALL_A);
    const next = viewTick(engine);
    expect(next.decision).toBe(WALL_A);
    settle(engine);
    expect(sinkTile(engine)).toBe(WALL_A);
  });

  it('falling edge on a native level: the power drops right after the move, as before', () => {
    const engine = powered(false);
    expect(sinkTile(engine)).toBe(WALL_B);
    step(engine, 'E');
    expect(sinkTile(engine)).toBe(WALL_A);
  });
});
