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

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { GameEngine } from '../GameEngine';
import type {
  CloneLink,
  CompiledLevel,
  EntityPlacement,
  LauncherLink,
  SignalLink
} from '../types';
import { SignalWiringError, createSignalRuntime, fireSignalSinks, settleWorldSignals } from './epoxySignals';
import type { EpoxyContext, EpoxyWorld } from './epoxyWorld';

const SIZE = 11;
const TIME_LIMIT_SECONDS = 100;
const PULSE = 'signal_button';
const LATCH = 'signal_latch_off';
const DOOR_CLOSED = 'hold_door_red_closed';
const DOOR_OPEN = 'hold_door_red_open';
const LAUNCHER = 'shot_launcher_e';
const FIRE_BUTTON = 'shot_trigger';
const CLONER = 'clone_machine';
const BLOCK = 'dirt_block';

type Cell = { x: number; y: number };
const START: Cell = { x: 3, y: 5 };
const PULSE_A: Cell = { x: 4, y: 5 };
const LATCH_CELL: Cell = { x: 4, y: 3 };
const DOOR_CELL: Cell = { x: 8, y: 5 };
const LAUNCHER_CELL: Cell = { x: 1, y: 8 };
const FIRE_BUTTON_CELL: Cell = { x: 6, y: 8 };
const CLONER_CELL: Cell = { x: 8, y: 2 };
const PULSE_B: Cell = { x: 9, y: 2 };
const SECOND_LAUNCHER_CELL: Cell = { x: 1, y: 9 };

const cellIndex = (c: Cell): number => c.y * SIZE + c.x;
const link = (from: Cell, to: Cell): SignalLink => ({ fromX: from.x, fromY: from.y, toX: to.x, toY: to.y });

interface Setup {
  terrain?: Array<[Cell, string]>;
  entities?: EntityPlacement[];
  signalLinks?: SignalLink[];
  launcherLinks?: LauncherLink[];
  cloneLinks?: CloneLink[];
}

function room(setup: Setup): CompiledLevel {
  const terrain: string[][] = Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x) => (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? 'wall' : 'floor'))
  );
  for (const [cell, id] of setup.terrain ?? []) terrain[cell.y][cell.x] = id;
  return {
    id: 'pulse_room',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: TIME_LIMIT_SECONDS,
    chipsRequired: 0,
    playerStart: { ...START, dir: 'E' },
    terrain,
    items: Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null)),
    entities: setup.entities ?? [],
    trapLinks: [],
    cloneLinks: setup.cloneLinks ?? [],
    ...(setup.launcherLinks ? { launcherLinks: setup.launcherLinks } : {}),
    ...(setup.signalLinks ? { signalLinks: setup.signalLinks } : {})
  };
}

function load(level: CompiledLevel): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(level);
  return engine;
}

function world(engine: GameEngine): EpoxyWorld {
  return (engine as unknown as { w: EpoxyWorld }).w;
}

function context(engine: GameEngine): EpoxyContext {
  return (engine as unknown as { ctx: EpoxyContext }).ctx;
}

/** Moves the player now, whatever the walking cooldown. */
function move(engine: GameEngine, dir: 'E' | 'W'): boolean {
  world(engine).player.moveCooldown = 0;
  return engine.attemptPlayerMove(dir);
}

const isPowered = (engine: GameEngine, cell: Cell): boolean => engine.getPoweredSignalCells()?.has(cellIndex(cell)) === true;
const shotCount = (engine: GameEngine): number => engine.getShots()?.length ?? 0;

/** A pulse button wired to a launcher, with the launcher also wired to a fire button. */
function launcherLevel(): CompiledLevel {
  return room({
    terrain: [
      [PULSE_A, PULSE],
      [LAUNCHER_CELL, LAUNCHER],
      [FIRE_BUTTON_CELL, FIRE_BUTTON]
    ],
    launcherLinks: [{ buttonX: FIRE_BUTTON_CELL.x, buttonY: FIRE_BUTTON_CELL.y, launcherX: LAUNCHER_CELL.x, launcherY: LAUNCHER_CELL.y }],
    signalLinks: [link(PULSE_A, LAUNCHER_CELL)]
  });
}

/** Pulse A fires the clone machine, whose clone lands on pulse B, which fires a launcher. */
function cloneChainLevel(): CompiledLevel {
  return room({
    terrain: [
      [PULSE_A, PULSE],
      [PULSE_B, PULSE],
      [CLONER_CELL, CLONER],
      [SECOND_LAUNCHER_CELL, LAUNCHER]
    ],
    entities: [{ type: BLOCK, x: CLONER_CELL.x, y: CLONER_CELL.y, dir: 'E' }],
    signalLinks: [link(PULSE_A, CLONER_CELL), link(PULSE_B, SECOND_LAUNCHER_CELL)]
  });
}

beforeEach(() => loadTestConfigs());

describe('pulse button: one settle, one-bit carry', () => {
  it('is on for exactly one settle after an arrival, and reports one rising and one falling edge', () => {
    const engine = load(launcherLevel());
    const w = world(engine);
    expect(isPowered(engine, PULSE_A)).toBe(false);
    w.signals?.pending.add(cellIndex(PULSE_A));
    const rise = settleWorldSignals(w);
    expect(isPowered(engine, PULSE_A)).toBe(true);
    expect(rise).toEqual([{ cell: cellIndex(LAUNCHER_CELL), rising: true }]);
    expect(w.signals?.pending.size).toBe(0);
    const fall = settleWorldSignals(w);
    expect(isPowered(engine, PULSE_A)).toBe(false);
    expect(fall).toEqual([{ cell: cellIndex(LAUNCHER_CELL), rising: false }]);
    expect(settleWorldSignals(w)).toEqual([]);
  });

  it('keeps a second press of consecutive passes as a one-bit carry and shows it one settle later', () => {
    const engine = load(launcherLevel());
    const w = world(engine);
    const cell = cellIndex(PULSE_A);
    w.signals?.pending.add(cell);
    settleWorldSignals(w);
    expect(isPowered(engine, PULSE_A)).toBe(true);
    // Pressed again while on: off now, press kept.
    w.signals?.pending.add(cell);
    settleWorldSignals(w);
    expect(isPowered(engine, PULSE_A)).toBe(false);
    expect([...(w.signals?.carry ?? [])]).toEqual([cell]);
    // The carry makes it on at the next settle and is spent.
    settleWorldSignals(w);
    expect(isPowered(engine, PULSE_A)).toBe(true);
    expect(w.signals?.carry.size).toBe(0);
    settleWorldSignals(w);
    expect(isPowered(engine, PULSE_A)).toBe(false);
    expect(engine.getSignalEdgeCounts()).toEqual({ rising: 2, falling: 2 });
  });

  it('never counts: a constant stream of arrivals gives half the rate', () => {
    const engine = load(launcherLevel());
    const w = world(engine);
    const cell = cellIndex(PULSE_A);
    const passes = 10;
    for (let i = 0; i < passes; i++) {
      w.signals?.pending.add(cell);
      settleWorldSignals(w);
    }
    expect(engine.getSignalEdgeCounts()?.rising).toBe(passes / 2);
    expect((w.signals?.carry.size ?? 0) <= 1).toBe(true);
  });

  it('reads several arrivals of one pass as one', () => {
    const engine = load(launcherLevel());
    const w = world(engine);
    w.signals?.pending.add(cellIndex(PULSE_A));
    w.signals?.pending.add(cellIndex(PULSE_A));
    settleWorldSignals(w);
    settleWorldSignals(w);
    expect(engine.getSignalEdgeCounts()).toEqual({ rising: 1, falling: 1 });
    expect(w.signals?.carry.size).toBe(0);
  });

  it('records nothing at the load settle, and ignores a pulse arrival on a plain cell', () => {
    const engine = load(launcherLevel());
    expect(engine.getSignalPulses()).toBeUndefined();
    move(engine, 'E');
    move(engine, 'E');
    // Stepping on a plain floor cell is no arrival for any pulse.
    expect(world(engine).signals?.pending.size).toBe(0);
  });
});

describe('pulse button in the engine', () => {
  it('toggles a latch and so a hold door, by stepping on the button', () => {
    const engine = load(
      room({
        terrain: [
          [PULSE_A, PULSE],
          [LATCH_CELL, LATCH],
          [DOOR_CELL, DOOR_CLOSED]
        ],
        signalLinks: [link(PULSE_A, LATCH_CELL), link(LATCH_CELL, DOOR_CELL)]
      })
    );
    const door = (): string => engine.getTerrain()[DOOR_CELL.y][DOOR_CELL.x];
    expect(door()).toBe(DOOR_CLOSED);
    move(engine, 'E');
    expect(door()).toBe(DOOR_OPEN);
    // The pulse is over at the next settle, the latch keeps the door open.
    engine.tick();
    expect(isPowered(engine, PULSE_A)).toBe(false);
    expect(door()).toBe(DOOR_OPEN);
    move(engine, 'E');
    expect(door()).toBe(DOOR_OPEN);
    move(engine, 'W');
    expect(door()).toBe(DOOR_CLOSED);
  });

  it('fires a linked launcher once per rising edge, not on every tick', () => {
    const engine = load(launcherLevel());
    const w = world(engine);
    expect(shotCount(engine)).toBe(0);
    move(engine, 'E');
    expect(shotCount(engine)).toBe(1);
    expect(w.firedLaunchers.size).toBe(1);
    for (let i = 0; i < 3; i++) engine.tick();
    expect(shotCount(engine)).toBe(1);
    expect(engine.getSignalEdgeCounts()?.rising).toBe(1);
    // Off the button and on again: a second rising edge, a second shot.
    move(engine, 'E');
    move(engine, 'W');
    expect(shotCount(engine)).toBe(2);
    expect(engine.getSignalEdgeCounts()?.rising).toBe(2);
  });

  it('shares the per-tick launcher cap with a fire button (a move never clears it)', () => {
    const engine = load(launcherLevel());
    const w = world(engine);
    move(engine, 'E');
    expect(shotCount(engine)).toBe(1);
    // The launcher fired by the signal in the move blocks the fire button until the next tick.
    expect(context(engine).triggerButton(FIRE_BUTTON_CELL.x, FIRE_BUTTON_CELL.y, 'fire_launchers')).toBe(true);
    expect(shotCount(engine)).toBe(1);
    engine.tick();
    expect(w.firedLaunchers.size).toBe(0);
    expect(context(engine).triggerButton(FIRE_BUTTON_CELL.x, FIRE_BUTTON_CELL.y, 'fire_launchers')).toBe(true);
    expect(shotCount(engine)).toBe(2);
  });

  it('lets a fire button block a signal fire of the same tick, then fires again on the next edge', () => {
    const engine = load(launcherLevel());
    const w = world(engine);
    const cell = cellIndex(PULSE_A);
    expect(context(engine).triggerButton(FIRE_BUTTON_CELL.x, FIRE_BUTTON_CELL.y, 'fire_launchers')).toBe(true);
    expect(shotCount(engine)).toBe(1);
    w.signals?.pending.add(cell);
    engine.tick();
    // The edge came in the same tick as the button: the launcher fires once.
    expect(engine.getSignalEdgeCounts()?.rising).toBe(1);
    expect(shotCount(engine)).toBe(1);
    expect(w.firedLaunchers.size).toBe(0);
    engine.tick();
    w.signals?.pending.add(cell);
    engine.tick();
    expect(shotCount(engine)).toBe(2);
  });

  it('fires once per press for two presses of consecutive passes', () => {
    const engine = load(launcherLevel());
    const w = world(engine);
    const cell = cellIndex(PULSE_A);
    w.signals?.pending.add(cell);
    engine.tick();
    w.signals?.pending.add(cell);
    engine.tick();
    engine.tick();
    expect(engine.getSignalEdgeCounts()?.rising).toBe(2);
    expect(shotCount(engine)).toBe(2);
  });

  it('spawns a clone from a linked clone machine, using the entity on it as the template', () => {
    const engine = load(cloneChainLevel());
    expect(engine.getEntities()).toHaveLength(1);
    move(engine, 'E');
    const spawned = engine.getEntities().filter((e) => e.x === PULSE_B.x && e.y === PULSE_B.y);
    expect(spawned).toHaveLength(1);
    expect(spawned[0].type).toBe(BLOCK);
  });

  it('spawns from the template of the clone link of the machine when it has one', () => {
    const level = cloneChainLevel();
    level.entities = [];
    level.cloneLinks = [
      {
        buttonX: 6,
        buttonY: 6,
        clonerX: CLONER_CELL.x,
        clonerY: CLONER_CELL.y,
        templateType: BLOCK,
        templateDir: 'E'
      }
    ];
    const engine = load(level);
    move(engine, 'E');
    expect(engine.getEntities().some((e) => e.x === PULSE_B.x && e.y === PULSE_B.y && e.type === BLOCK)).toBe(true);
  });

  it('loses no pulse when a clone spawned by a sink lands on a pulse button, and counts none twice', () => {
    const engine = load(cloneChainLevel());
    const w = world(engine);
    move(engine, 'E');
    // The clone arrived after the settle read the arrivals: its press waits for the next settle.
    expect(engine.getSignalPulses()).toEqual({ pending: [cellIndex(PULSE_B)], carry: [] });
    expect(shotCount(engine)).toBe(0);
    engine.tick();
    expect(engine.getSignalPulses()).toBeUndefined();
    expect(shotCount(engine)).toBe(1);
    expect(w.firedLaunchers.size).toBe(0);
    expect(engine.getSignalEdgeCounts()?.rising).toBe(2);
    for (let i = 0; i < 4; i++) engine.tick();
    expect(engine.getSignalEdgeCounts()?.rising).toBe(2);
    expect(shotCount(engine)).toBe(1);
  });

  it('stops firing sinks once the player is dead', () => {
    const engine = load(launcherLevel());
    const w = world(engine);
    w.player.alive = false;
    fireSignalSinks(context(engine), [{ cell: cellIndex(LAUNCHER_CELL), rising: true }]);
    expect(shotCount(engine)).toBe(0);
    w.player.alive = true;
    w.levelCompleted = true;
    fireSignalSinks(context(engine), [{ cell: cellIndex(LAUNCHER_CELL), rising: true }]);
    expect(shotCount(engine)).toBe(0);
    w.levelCompleted = false;
    fireSignalSinks(context(engine), [{ cell: cellIndex(LAUNCHER_CELL), rising: false }]);
    expect(shotCount(engine)).toBe(0);
    fireSignalSinks(context(engine), [{ cell: cellIndex(LAUNCHER_CELL), rising: true }]);
    expect(shotCount(engine)).toBe(1);
  });

  it('does not fire a launcher cell that holds no launcher any more', () => {
    const engine = load(launcherLevel());
    const w = world(engine);
    w.terrain[LAUNCHER_CELL.y][LAUNCHER_CELL.x] = 'floor';
    move(engine, 'E');
    expect(shotCount(engine)).toBe(0);
  });
});

describe('pulse memory: undo and hash', () => {
  it('puts the unread arrivals back with the snapshot, and nothing for a snapshot without any', () => {
    const engine = load(cloneChainLevel());
    move(engine, 'E');
    expect(engine.getSignalPulses()).toEqual({ pending: [cellIndex(PULSE_B)], carry: [] });
    // The next move starts with the arrival still unread.
    move(engine, 'E');
    expect(engine.getSignalPulses()).toBeUndefined();
    expect(engine.undo()).toBe(true);
    expect(engine.getSignalPulses()).toEqual({ pending: [cellIndex(PULSE_B)], carry: [] });
    expect(engine.undo()).toBe(true);
    expect(engine.getSignalPulses()).toBeUndefined();
  });

  it('puts the carry back', () => {
    const engine = load(launcherLevel());
    const w = world(engine);
    w.signals?.carry.add(cellIndex(PULSE_A));
    expect(engine.captureState().signalPulses).toEqual({ pending: [], carry: [cellIndex(PULSE_A)] });
    // A move away from the button settles the carried press: on now, and the carry is spent.
    move(engine, 'W');
    expect(isPowered(engine, PULSE_A)).toBe(true);
    expect(engine.getSignalPulses()).toBeUndefined();
    engine.undo();
    expect(isPowered(engine, PULSE_A)).toBe(false);
    expect(engine.getSignalPulses()).toEqual({ pending: [], carry: [cellIndex(PULSE_A)] });
  });

  it('writes no pulse field for a level without pulse activity or without signals', () => {
    const idle = load(launcherLevel());
    expect(idle.getSignalPulses()).toBeUndefined();
    expect('signalPulses' in idle.captureState()).toBe(false);
    move(idle, 'E');
    idle.tick();
    expect(idle.getSignalPulses()).toBeUndefined();
    expect('signalPulses' in idle.captureState()).toBe(false);
    const plain = load(room({}));
    expect(plain.getSignalPulses()).toBeUndefined();
    expect('signalPulses' in plain.captureState()).toBe(false);
    expect(plain.getSignalState()).toBeUndefined();
  });
});

describe('signal runtime wiring of sinks', () => {
  const spec = (fires: 'launcher' | 'cloner' | undefined, color?: 'red'): Parameters<typeof createSignalRuntime>[0] => ({
    nodes: [
      { cell: 12, kind: 'source', sample: 'pulse' },
      { cell: 14, kind: 'sink', ...(fires ? { fires } : {}), ...(color ? { color } : {}) }
    ],
    links: [{ from: 12, to: 14 }]
  });

  it('accepts a sink that fires a device and has no colour', () => {
    expect(() => createSignalRuntime(spec('launcher'))).not.toThrow();
    const runtime = createSignalRuntime(spec('cloner'));
    expect([...runtime.pulseCells]).toEqual([12]);
    expect(runtime.pending.size + runtime.carry.size).toBe(0);
  });

  it('refuses a sink with neither a colour nor a device, or with both', () => {
    expect(() => createSignalRuntime(spec(undefined))).toThrow(SignalWiringError);
    expect(() => createSignalRuntime(spec('launcher', 'red'))).toThrow(SignalWiringError);
    expect(() => createSignalRuntime(spec(undefined, 'red'))).not.toThrow();
  });
});
