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

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { ConfigRegistry } from '../../config/ConfigRegistry';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { GameEngine } from '../GameEngine';
import { engineSimulationHash } from '../engineSimHash';
import type { CompiledLevel, Direction, EntityPlacement, SignalNodeDef, SignalSpec } from '../types';

const SIZE = 11;
const TIME_LIMIT_SECONDS = 100;
const MAX_WAIT_TICKS = 40;
const MONSTER_WAIT_TICKS = 60;
const OPEN_DOOR = 'hold_door_red_open';
const CLOSED_DOOR = 'hold_door_red_closed';
const DOOR = { x: 8, y: 5 };
const PLATE_A = { x: 2, y: 5 };
const PLATE_B = { x: 7, y: 5 };
const PLAYER_START = { x: 6, y: 5 };
const GATE_CELL = { x: 5, y: 2 };
const EMITTER = { x: 1, y: 2 };
const RECEIVER = { x: 4, y: 2 };
const BEAM_BLOCKER = { x: 2, y: 2 };
const SECOND_GATE_CELL = { x: 5, y: 3 };

const cell = (p: { x: number; y: number }): number => p.y * SIZE + p.x;

interface Setup {
  terrain?: Array<[number, number, string]>;
  entities?: EntityPlacement[];
  signalSpec?: SignalSpec;
  player?: { x: number; y: number };
}

function room(setup: Setup): CompiledLevel {
  const terrain: string[][] = Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x) => (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? 'wall' : 'floor'))
  );
  for (const [x, y, id] of setup.terrain ?? []) terrain[y][x] = id;
  const level: CompiledLevel = {
    id: 'signal_room',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: TIME_LIMIT_SECONDS,
    chipsRequired: 0,
    playerStart: { ...(setup.player ?? PLAYER_START), dir: 'E' },
    terrain,
    items: Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null)),
    entities: setup.entities ?? [],
    trapLinks: [],
    cloneLinks: []
  };
  if (setup.signalSpec !== undefined) level.signalSpec = setup.signalSpec;
  return level;
}

const held = (p: { x: number; y: number }): SignalNodeDef => ({ cell: cell(p), kind: 'source', sample: 'held' });
const receiverSource = (p: { x: number; y: number }): SignalNodeDef => ({ cell: cell(p), kind: 'source', sample: 'receiver' });
const doorSink = (): SignalNodeDef => ({ cell: cell(DOOR), kind: 'sink', color: 'red' });
const link = (from: { x: number; y: number }, to: { x: number; y: number }) => ({ from: cell(from), to: cell(to) });

/** plate A and plate B -> AND -> red hold door. A holds a block when `blockOnA`. */
function andLevel(blockOnA: boolean): CompiledLevel {
  return room({
    terrain: [[DOOR.x, DOOR.y, CLOSED_DOOR]],
    entities: blockOnA ? [{ type: 'dirt_block', x: PLATE_A.x, y: PLATE_A.y, dir: 'N' }] : [],
    signalSpec: {
      nodes: [held(PLATE_A), held(PLATE_B), { cell: cell(GATE_CELL), kind: 'and' }, doorSink()],
      links: [link(PLATE_A, GATE_CELL), link(PLATE_B, GATE_CELL), link(GATE_CELL, DOOR)]
    }
  });
}

/** An emitter beams east at a receiver; a block at BEAM_BLOCKER cuts it when `beamBlocked`. receiver -> NOT -> door. */
function notReceiverLevel(beamBlocked: boolean, doorStartsAs: string): CompiledLevel {
  return room({
    terrain: [
      [DOOR.x, DOOR.y, doorStartsAs],
      [EMITTER.x, EMITTER.y, 'laser_emitter_e'],
      [RECEIVER.x, RECEIVER.y, 'laser_receiver_red']
    ],
    entities: beamBlocked ? [{ type: 'dirt_block', x: BEAM_BLOCKER.x, y: BEAM_BLOCKER.y, dir: 'N' }] : [],
    player: { x: DOOR.x - 1, y: DOOR.y },
    signalSpec: {
      nodes: [receiverSource(RECEIVER), { cell: cell(GATE_CELL), kind: 'not' }, doorSink()],
      links: [link(RECEIVER, GATE_CELL), link(GATE_CELL, DOOR)]
    }
  });
}

function load(level: CompiledLevel): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(level);
  return engine;
}

/** Ticks until the player may move, then moves. */
function step(engine: GameEngine, dir: Direction): boolean {
  for (let waited = 0; waited <= MAX_WAIT_TICKS; waited++) {
    if (engine.getPlayer().moveCooldown === 0) return engine.attemptPlayerMove(dir);
    engine.tick();
  }
  throw new Error('the player never became able to move');
}

function doorTile(engine: GameEngine): string {
  return engine.getTerrain()[DOOR.y][DOOR.x];
}

beforeEach(() => {
  loadTestConfigs();
});

describe('signals in the engine: plate and plate into AND into a hold door', () => {
  it('starts with the door shut and no edge counted', () => {
    const engine = load(andLevel(true));
    expect(doorTile(engine)).toBe(CLOSED_DOOR);
    expect(engine.getSignalEdgeCounts()).toEqual({ rising: 0, falling: 0 });
  });

  it('opens the door only when both plate cells are occupied', () => {
    const engine = load(andLevel(true));
    expect(step(engine, 'E')).toBe(true);
    expect(engine.getPlayer().x).toBe(PLATE_B.x);
    expect(doorTile(engine)).toBe(OPEN_DOOR);

    const alone = load(andLevel(false));
    expect(step(alone, 'E')).toBe(true);
    expect(alone.getPlayer().x).toBe(PLATE_B.x);
    expect(doorTile(alone)).toBe(CLOSED_DOOR);
  });

  it('shuts the door again when a plate cell is freed, and refuses the player', () => {
    const engine = load(andLevel(true));
    step(engine, 'E');
    expect(doorTile(engine)).toBe(OPEN_DOOR);
    expect(step(engine, 'W')).toBe(true);
    expect(doorTile(engine)).toBe(CLOSED_DOOR);
    expect(step(engine, 'E')).toBe(true);
    expect(doorTile(engine)).toBe(OPEN_DOOR);
    expect(engine.getSignalEdgeCounts()).toEqual({ rising: 2, falling: 1 });
  });

  it('never shuts the door on an occupant when the door asks for it, and shuts it once free', () => {
    ConfigRegistry.getTile(OPEN_DOOR).holdDoorClosesOnOccupant = false;
    const engine = load(andLevel(true));
    step(engine, 'E');
    expect(step(engine, 'E')).toBe(true);
    expect(engine.getPlayer().x).toBe(DOOR.x);
    // Plate B is free now, so the signals call the door shut, yet the player stands in it.
    expect(engine.getSignalState()?.lastOutputs.at(-1)).toBe(false);
    expect(doorTile(engine)).toBe(OPEN_DOOR);
    expect(step(engine, 'E')).toBe(true);
    expect(doorTile(engine)).toBe(CLOSED_DOOR);
  });

  it('shuts the door on an occupant by default, as a plate door does', () => {
    const engine = load(andLevel(true));
    step(engine, 'E');
    step(engine, 'E');
    expect(doorTile(engine)).toBe(CLOSED_DOOR);
  });

  it('adds to a pressure plate of the same colour: both must call the door open', () => {
    const level = andLevel(true);
    level.terrain[7][5] = 'pressure_plate_red';
    const engine = load(level);
    step(engine, 'E');
    // The AND is on but the red plate is not pressed.
    expect(doorTile(engine)).toBe(CLOSED_DOOR);
  });
});

describe('signals in the engine: laser receiver into NOT into a hold door', () => {
  it('has the door open at load when the receiver is dark, with no shut-then-open flicker', () => {
    const engine = load(notReceiverLevel(true, CLOSED_DOOR));
    expect(doorTile(engine)).toBe(OPEN_DOOR);
    expect(engine.getSignalEdgeCounts()).toEqual({ rising: 0, falling: 0 });
    expect(step(engine, 'E')).toBe(true);
    for (let i = 0; i < MAX_WAIT_TICKS; i++) {
      engine.tick();
      expect(doorTile(engine)).toBe(OPEN_DOOR);
    }
    // The load settle only primed the network: no edge at all.
    expect(engine.getSignalEdgeCounts()).toEqual({ rising: 0, falling: 0 });
  });

  it('has the door shut at load when the receiver is lit, so the player cannot slip through', () => {
    const engine = load(notReceiverLevel(false, OPEN_DOOR));
    expect(engine.getLitReceivers()).toHaveLength(1);
    expect(doorTile(engine)).toBe(CLOSED_DOOR);
    expect(engine.attemptPlayerMove('E')).toBe(false);
    expect(engine.getPlayer().x).toBe(DOOR.x - 1);
  });

  it('settles a receiver from the beams of the same pass when a block comes onto the beam', () => {
    const engine = load(notReceiverLevel(false, CLOSED_DOOR));
    expect(doorTile(engine)).toBe(CLOSED_DOOR);
    // Putting a block on the beam is a fixture change: do it through the world the engine hands out.
    engine.getEntities().push({ uid: 900, type: 'dirt_block', kind: 'block', x: BEAM_BLOCKER.x, y: BEAM_BLOCKER.y, dir: 'N' } as never);
    engine.tick();
    expect(doorTile(engine)).toBe(OPEN_DOOR);
  });
});

/** plate B -> latch -> door, with the latch starting on or off. */
function latchLevel(id: string, startBit: boolean): CompiledLevel {
  const level = room({
    terrain: [[DOOR.x, DOOR.y, CLOSED_DOOR]],
    signalSpec: {
      nodes: [held(PLATE_B), { cell: cell(GATE_CELL), kind: 'latch', startBit }, doorSink()],
      links: [link(PLATE_B, GATE_CELL), link(GATE_CELL, DOOR)]
    }
  });
  level.id = id;
  return level;
}

describe('signals in the engine: loading again on the same engine', () => {
  it('reads the beams of the new load, not the previous run, on a restart', () => {
    const engine = new GameEngine();
    engine.loadLevel(notReceiverLevel(false, OPEN_DOOR));
    expect(doorTile(engine)).toBe(CLOSED_DOOR);
    // Same level id: a restart. The receiver is lit again, so the door is shut again.
    engine.loadLevel(notReceiverLevel(false, OPEN_DOOR));
    expect(doorTile(engine)).toBe(CLOSED_DOOR);
    expect(engine.getSignalEdgeCounts()).toEqual({ rising: 0, falling: 0 });
  });

  it('reads the beams of the new level when another level loads over a lit receiver', () => {
    const engine = new GameEngine();
    engine.loadLevel(notReceiverLevel(false, CLOSED_DOOR));
    expect(engine.getLitReceivers()).toHaveLength(1);
    const dark = notReceiverLevel(true, CLOSED_DOOR);
    dark.id = 'signal_room_dark';
    engine.loadLevel(dark);
    // A stale lit receiver would leave the door shut.
    expect(doorTile(engine)).toBe(OPEN_DOOR);
  });

  it('starts a latch from its authored bit again on every load', () => {
    const engine = new GameEngine();
    engine.loadLevel(latchLevel('latch_a', false));
    expect(doorTile(engine)).toBe(CLOSED_DOOR);
    step(engine, 'E');
    expect(doorTile(engine)).toBe(OPEN_DOOR);
    engine.loadLevel(latchLevel('latch_a', false));
    expect(doorTile(engine)).toBe(CLOSED_DOOR);
    engine.loadLevel(latchLevel('latch_b', true));
    expect(doorTile(engine)).toBe(OPEN_DOOR);
    expect(engine.getSignalEdgeCounts()).toEqual({ rising: 0, falling: 0 });
  });

  it('does not flip a latch whose input is already on at load', () => {
    const level = latchLevel('latch_on', false);
    level.playerStart = { x: PLATE_B.x, y: PLATE_B.y, dir: 'E' };
    const engine = load(level);
    expect(doorTile(engine)).toBe(CLOSED_DOOR);
    engine.tick();
    expect(doorTile(engine)).toBe(CLOSED_DOOR);
    // Leaving and coming back is a rising edge: it flips.
    step(engine, 'W');
    step(engine, 'E');
    expect(doorTile(engine)).toBe(OPEN_DOOR);
  });
});

describe('signals in the engine: undo', () => {
  it('puts the network state and the door back', () => {
    const engine = load(andLevel(true));
    const before = engine.getSignalState();
    expect(before).toBeDefined();
    step(engine, 'E');
    expect(doorTile(engine)).toBe(OPEN_DOOR);
    expect(engine.getSignalState()).not.toEqual(before);
    expect(engine.undo()).toBe(true);
    expect(doorTile(engine)).toBe(CLOSED_DOOR);
    expect(engine.getSignalState()).toEqual(before);
    expect(engine.getPlayer().x).toBe(PLAYER_START.x);
  });

  it('is replayable: the same moves after an undo give the same state', () => {
    const engine = load(andLevel(true));
    step(engine, 'E');
    const after = engine.getSignalState();
    engine.undo();
    step(engine, 'E');
    expect(engine.getSignalState()).toEqual(after);
  });

  it('keeps the snapshot free of signals on a level without a network', () => {
    const engine = load(room({}));
    expect('signals' in engine.captureState()).toBe(false);
    expect(engine.getSignalState()).toBeUndefined();
    expect(engine.getSignalEdgeCounts()).toBeUndefined();
  });

  it('carries the network state in a snapshot of a level that has one', () => {
    const engine = load(andLevel(true));
    expect(engine.captureState().signals).toEqual(engine.getSignalState());
  });
});

describe('signals in the engine: one edge per change', () => {
  it('settling at the move and again in the tick of the same moment gives one edge', () => {
    const engine = load(andLevel(true));
    step(engine, 'E');
    expect(engine.getSignalEdgeCounts()).toEqual({ rising: 1, falling: 0 });
    engine.tick();
    expect(engine.getSignalEdgeCounts()).toEqual({ rising: 1, falling: 0 });
    engine.tick();
    expect(engine.getSignalEdgeCounts()).toEqual({ rising: 1, falling: 0 });
  });

  it('gives one change when several monsters enter source cells in the same tick', () => {
    const rowA = { x: 4, y: 3 };
    const rowB = { x: 4, y: 7 };
    const level = room({
      terrain: [[DOOR.x, DOOR.y, CLOSED_DOOR]],
      entities: [
        { type: 'tank', x: rowA.x - 1, y: rowA.y, dir: 'E' },
        { type: 'tank', x: rowB.x - 1, y: rowB.y, dir: 'E' }
      ],
      signalSpec: {
        nodes: [held(rowA), held(rowB), { cell: cell(GATE_CELL), kind: 'or' }, doorSink()],
        links: [link(rowA, GATE_CELL), link(rowB, GATE_CELL), link(GATE_CELL, DOOR)]
      }
    });
    const engine = load(level);
    let entered = -1;
    for (let i = 0; i < MONSTER_WAIT_TICKS && entered < 0; i++) {
      engine.tick();
      if ((engine.getSignalEdgeCounts()?.rising ?? 0) > 0) entered = engine.getTick();
    }
    expect(entered).toBeGreaterThan(0);
    // Both tanks stepped in that very tick, and the sink saw one rising edge for the pair.
    // Two sources, the OR and the sink are all on.
    expect(engine.getSignalState()?.lastOutputs.filter(Boolean)).toHaveLength(4);
    expect(engine.getSignalEdgeCounts()).toEqual({ rising: 1, falling: 0 });
    expect(doorTile(engine)).toBe(OPEN_DOOR);
  });

  it('reads two actors on one source cell as a single level', () => {
    const engine = load(andLevel(true));
    engine.getEntities().push({ uid: 901, type: 'dirt_block', kind: 'block', x: PLATE_A.x, y: PLATE_A.y, dir: 'N' } as never);
    step(engine, 'E');
    expect(engine.getSignalEdgeCounts()).toEqual({ rising: 1, falling: 0 });
  });
});

describe('signals in the engine: levels without signals', () => {
  it('hashes a level without signals, which has no signal state', () => {
    const plain = room({ terrain: [[DOOR.x, DOOR.y, CLOSED_DOOR]] });
    expect(engineSimulationHash(plain, 'scripted')).toBe(engineSimulationHash(plain, 'scripted'));
    const engine = load(plain);
    expect(engine.getSignalState()).toBeUndefined();
  });

  it('changes the hash of a level when its network differs', () => {
    expect(engineSimulationHash(andLevel(true), 'scripted')).not.toBe(engineSimulationHash(andLevel(false), 'scripted'));
  });

  it('plays a level with signals the same way twice', () => {
    expect(engineSimulationHash(andLevel(true), 'scripted')).toBe(engineSimulationHash(andLevel(true), 'scripted'));
  });

  it('chains two gates into one door', () => {
    const level = room({
      terrain: [[DOOR.x, DOOR.y, CLOSED_DOOR]],
      entities: [{ type: 'dirt_block', x: PLATE_A.x, y: PLATE_A.y, dir: 'N' }],
      signalSpec: {
        nodes: [
          held(PLATE_A),
          held(PLATE_B),
          { cell: cell(GATE_CELL), kind: 'xor' },
          { cell: cell(SECOND_GATE_CELL), kind: 'not' },
          doorSink()
        ],
        links: [link(PLATE_A, GATE_CELL), link(PLATE_B, GATE_CELL), link(GATE_CELL, SECOND_GATE_CELL), link(SECOND_GATE_CELL, DOOR)]
      }
    });
    const engine = load(level);
    // A on, B off: XOR on, NOT off, door shut. Then B on too: XOR off, NOT on, door open.
    expect(doorTile(engine)).toBe(CLOSED_DOOR);
    step(engine, 'E');
    expect(doorTile(engine)).toBe(OPEN_DOOR);
  });
});
