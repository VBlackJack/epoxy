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
import { LevelValidator } from '../LevelValidator';
import { FLIP_SINK_TILE_IDS } from '../coreConstants';
import { compileSignalSpec, normalizeSignalLinks, signalSinkOf, usesFlipSinkFormat } from '../signalLinks';
import type { CompiledLevel, Direction, EntityPlacement, SignalLink, SignalSpec } from '../types';
import { SignalWiringError, createSignalRuntime, registryTileLookup } from './epoxySignals';

const SIZE = 11;
const TIME_LIMIT_SECONDS = 100;
const MAX_WAIT_TICKS = 40;
const PLATE = 'signal_plate';
const WALL_CLOSED = 'toggle_wall_closed';
const WALL_OPEN = 'toggle_wall_open';
const RAIL_A = 'rail_switch_a';
const RAIL_B = 'rail_switch_b';
const GREEN_BUTTON = 'button_green';
const PLAYER_START = { x: 1, y: 5 };
const PLATE_CELL = { x: 2, y: 5 };
const FAR_PLATE_CELL = { x: 5, y: 2 };
const WIRED_CELL = { x: 8, y: 3 };
const LOOSE_CELL = { x: 8, y: 7 };
/** A top that a key removes, to hide a device under. */
const REMOVABLE_TOP = 'door_red';
const HOLD_DOOR = 'hold_door_red_closed';
const CORRIDOR_WALL_X = 5;
const CORRIDOR_SECOND_PLATE_X = 4;
const CORRIDOR_EXIT_X = 9;

type Cell = { x: number; y: number };

interface Setup {
  terrain?: Array<[Cell, string]>;
  entities?: EntityPlacement[];
  signalLinks?: SignalLink[];
  underlays?: CompiledLevel['underlays'];
}

const link = (from: Cell, to: Cell): SignalLink => ({ fromX: from.x, fromY: from.y, toX: to.x, toY: to.y });

function room(setup: Setup): CompiledLevel {
  const terrain: string[][] = Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x) => (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? 'wall' : 'floor'))
  );
  for (const [cell, id] of setup.terrain ?? []) terrain[cell.y][cell.x] = id;
  return {
    id: 'wired_flip_room',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: TIME_LIMIT_SECONDS,
    chipsRequired: 0,
    playerStart: { ...PLAYER_START, dir: 'E' },
    terrain,
    items: Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null)),
    entities: setup.entities ?? [],
    trapLinks: [],
    cloneLinks: [],
    ...(setup.signalLinks === undefined ? {} : { signalLinks: setup.signalLinks }),
    ...(setup.underlays === undefined ? {} : { underlays: setup.underlays })
  };
}

/** A plate next to the start wired to a wall at WIRED_CELL, and a second, unwired wall at LOOSE_CELL. */
function wallLevel(extra: Setup = {}): CompiledLevel {
  return room({
    terrain: [
      [PLATE_CELL, PLATE],
      [WIRED_CELL, WALL_CLOSED],
      [LOOSE_CELL, WALL_CLOSED],
      ...(extra.terrain ?? [])
    ],
    signalLinks: [link(PLATE_CELL, WIRED_CELL)],
    ...(extra.entities === undefined ? {} : { entities: extra.entities })
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

const tileAt = (engine: GameEngine, cell: Cell): string => engine.getTerrain()[cell.y][cell.x];

beforeEach(() => {
  loadTestConfigs();
});

describe('wired flip: the engine', () => {
  it('flips only its own cell on each rising edge, and not on release', () => {
    const engine = load(wallLevel());
    expect(step(engine, 'E')).toBe(true);
    expect(engine.getPlayer().x).toBe(PLATE_CELL.x);
    expect(tileAt(engine, WIRED_CELL)).toBe(WALL_OPEN);
    expect(tileAt(engine, LOOSE_CELL)).toBe(WALL_CLOSED);
    // Leaving the plate is a falling edge: nothing flips.
    expect(step(engine, 'W')).toBe(true);
    expect(tileAt(engine, WIRED_CELL)).toBe(WALL_OPEN);
    // Stepping back on is a new rising edge: it flips again.
    expect(step(engine, 'E')).toBe(true);
    expect(tileAt(engine, WIRED_CELL)).toBe(WALL_CLOSED);
    expect(tileAt(engine, LOOSE_CELL)).toBe(WALL_CLOSED);
  });

  it('flips once per edge, not once per tick while the plate stays held', () => {
    const engine = load(wallLevel());
    step(engine, 'E');
    for (let i = 0; i < MAX_WAIT_TICKS; i++) engine.tick();
    expect(tileAt(engine, WIRED_CELL)).toBe(WALL_OPEN);
  });

  it('is still flipped by the green button, with every unwired wall', () => {
    const level = room({
      terrain: [
        [PLATE_CELL, GREEN_BUTTON],
        [FAR_PLATE_CELL, PLATE],
        [WIRED_CELL, WALL_CLOSED],
        [LOOSE_CELL, WALL_CLOSED]
      ],
      signalLinks: [link(FAR_PLATE_CELL, WIRED_CELL)]
    });
    const engine = load(level);
    expect(step(engine, 'E')).toBe(true);
    expect(tileAt(engine, WIRED_CELL)).toBe(WALL_OPEN);
    expect(tileAt(engine, LOOSE_CELL)).toBe(WALL_OPEN);
  });

  it('flips a rail switch, which changes its exits', () => {
    const level = room({
      terrain: [
        [PLATE_CELL, PLATE],
        [WIRED_CELL, RAIL_A]
      ],
      signalLinks: [link(PLATE_CELL, WIRED_CELL)]
    });
    const engine = load(level);
    const sidesOf = (id: string): readonly string[] | undefined => ConfigRegistry.getTile(id).railSides;
    expect(sidesOf(tileAt(engine, WIRED_CELL))).toEqual(['S', 'E']);
    step(engine, 'E');
    expect(tileAt(engine, WIRED_CELL)).toBe(RAIL_B);
    expect(sidesOf(tileAt(engine, WIRED_CELL))).toEqual(['S', 'W']);
  });

  it('flips a cell a block stands on', () => {
    const level = wallLevel({
      terrain: [[WIRED_CELL, WALL_OPEN]],
      entities: [{ type: 'dirt_block', x: WIRED_CELL.x, y: WIRED_CELL.y, dir: 'N' }]
    });
    const engine = load(level);
    step(engine, 'E');
    expect(tileAt(engine, WIRED_CELL)).toBe(WALL_CLOSED);
    expect(engine.getEntities().some((e) => e.x === WIRED_CELL.x && e.y === WIRED_CELL.y)).toBe(true);
  });

  it('puts the wall back on undo, and a replay gives the same state', () => {
    const engine = load(wallLevel());
    const before = engine.getSignalState();
    step(engine, 'E');
    const after = engine.getSignalState();
    expect(tileAt(engine, WIRED_CELL)).toBe(WALL_OPEN);
    expect(engine.undo()).toBe(true);
    expect(tileAt(engine, WIRED_CELL)).toBe(WALL_CLOSED);
    expect(engine.getSignalState()).toEqual(before);
    step(engine, 'E');
    expect(tileAt(engine, WIRED_CELL)).toBe(WALL_OPEN);
    expect(engine.getSignalState()).toEqual(after);
  });
});

describe('wired flip: which cells are nodes', () => {
  it('is no node when the flip tile hides under a removable top, while a hidden hold door still is', () => {
    const hiddenWall = room({
      terrain: [
        [PLATE_CELL, PLATE],
        [WIRED_CELL, REMOVABLE_TOP]
      ],
      underlays: [{ x: WIRED_CELL.x, y: WIRED_CELL.y, terrain: WALL_CLOSED }],
      signalLinks: [link(PLATE_CELL, WIRED_CELL)]
    });
    expect(normalizeSignalLinks(hiddenWall.signalLinks, hiddenWall.terrain, 'epoxy', hiddenWall.underlays, registryTileLookup)).toBeNull();
    expect(compileSignalSpec(hiddenWall, registryTileLookup)).toBeUndefined();

    const hiddenDoor = room({
      terrain: [
        [PLATE_CELL, PLATE],
        [WIRED_CELL, REMOVABLE_TOP]
      ],
      underlays: [{ x: WIRED_CELL.x, y: WIRED_CELL.y, terrain: HOLD_DOOR }],
      signalLinks: [link(PLATE_CELL, WIRED_CELL)]
    });
    const spec = compileSignalSpec(hiddenDoor, registryTileLookup);
    expect(spec?.nodes.find((n) => n.kind === 'sink')).toMatchObject({ color: 'red' });
  });

  it('reads the sink kind of a tile in one place', () => {
    const tile = (id: string): ReturnType<typeof ConfigRegistry.getTile> => ConfigRegistry.getTile(id);
    expect(signalSinkOf(tile(WALL_CLOSED))).toEqual({ fires: 'flip' });
    expect(signalSinkOf(tile(RAIL_B))).toEqual({ fires: 'flip' });
    expect(signalSinkOf(tile(WALL_CLOSED), { hidden: true })).toBeNull();
    expect(signalSinkOf(tile(HOLD_DOOR), { hidden: true })).toEqual({ color: 'red' });
    expect(signalSinkOf(tile('clone_machine'))).toEqual({ fires: 'cloner' });
    expect(signalSinkOf(tile('shot_launcher_e'))).toEqual({ fires: 'launcher' });
    expect(signalSinkOf(tile('wall'))).toBeNull();
    // A colour wall answers to its own button only, never to a wire.
    expect(signalSinkOf(tile('toggle_wall_yellow_open'))).toBeNull();
  });

  it('names every shipped flip tile by id', () => {
    const withToggle = Object.values(ConfigRegistry.getTiles().tiles).filter((tile) => tile.togglesTo !== undefined).map((tile) => tile.id);
    expect([...FLIP_SINK_TILE_IDS].sort()).toEqual(withToggle.sort());
  });

  it('refuses a sink that has not exactly one kind', () => {
    const spec = (sink: Record<string, unknown>): SignalSpec => ({
      nodes: [
        { cell: 0, kind: 'source', sample: 'held' },
        { cell: 1, kind: 'sink', ...sink }
      ],
      links: [{ from: 0, to: 1 }]
    });
    expect(() => createSignalRuntime(spec({ color: 'red', fires: 'flip' }))).toThrow(SignalWiringError);
    expect(() => createSignalRuntime(spec({}))).toThrow(SignalWiringError);
    expect(() => createSignalRuntime(spec({ fires: 'flip' }))).not.toThrow();
    expect(() => createSignalRuntime(spec({ color: 'red' }))).not.toThrow();
  });
});

describe('wired flip: the validator', () => {
  /** A corridor: start, plate, a closed wall, the exit. Nothing else opens the wall. */
  function corridor(wired: boolean): CompiledLevel {
    const level = room({});
    level.terrain = level.terrain.map((row, y) =>
      row.map((id, x) => (y === PLAYER_START.y && x >= 1 && x <= CORRIDOR_EXIT_X ? 'floor' : id === 'floor' ? 'wall' : id))
    );
    const row = level.terrain[PLAYER_START.y];
    row[PLATE_CELL.x] = PLATE;
    row[CORRIDOR_WALL_X] = WALL_CLOSED;
    row[CORRIDOR_EXIT_X] = 'exit';
    if (wired) level.signalLinks = [link(PLATE_CELL, { x: CORRIDOR_WALL_X, y: PLAYER_START.y })];
    return level;
  }

  it('opens a wired closed wall, so the exit is not reported unreachable', () => {
    const report = LevelValidator.validate(corridor(true));
    expect(report.stats.reachableExit).toBe(true);
    expect(report.issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('keeps the exit unreachable behind the same wall when nothing is wired', () => {
    expect(LevelValidator.validate(corridor(false)).stats.reachableExit).toBe(false);
  });

  it('does not ask for a green button for a rail switch a wire ends on', () => {
    const level = room({
      terrain: [
        [PLATE_CELL, PLATE],
        [WIRED_CELL, RAIL_A],
        [LOOSE_CELL, RAIL_A]
      ],
      signalLinks: [link(PLATE_CELL, WIRED_CELL)]
    });
    const issue = LevelValidator.validate(level).issues.find((i) => i.i18nKey === 'validator.issues.rail_switch_no_button.label');
    expect(issue?.params).toMatchObject({ x: LOOSE_CELL.x, y: LOOSE_CELL.y, count: 1 });
    level.signalLinks = [link(PLATE_CELL, WIRED_CELL), link(PLATE_CELL, LOOSE_CELL)];
    expect(LevelValidator.validate(level).issues.map((i) => i.i18nKey)).not.toContain('validator.issues.rail_switch_no_button.label');
  });

  it('refuses a second signal into a flip sink', () => {
    const level = corridor(true);
    level.terrain[PLAYER_START.y][CORRIDOR_SECOND_PLATE_X] = PLATE;
    const wall = { x: CORRIDOR_WALL_X, y: PLAYER_START.y };
    level.signalLinks = [link(PLATE_CELL, wall), link({ x: CORRIDOR_SECOND_PLATE_X, y: PLAYER_START.y }, wall)];
    const keys = LevelValidator.validate(level).issues.map((i) => i.i18nKey);
    expect(keys).toContain('validator.issues.signal_sink_inputs.label');
  });
});

describe('wired flip: the pack format', () => {
  it('asks for the flip format exactly when a link ends on a visible flip tile', () => {
    expect(usesFlipSinkFormat(wallLevel())).toBe(true);
    expect(usesFlipSinkFormat(room({ terrain: [[WIRED_CELL, RAIL_A], [PLATE_CELL, PLATE]], signalLinks: [link(PLATE_CELL, WIRED_CELL)] }))).toBe(true);
    expect(usesFlipSinkFormat({ ...wallLevel(), signalLinks: undefined })).toBe(false);
    // A link to a hold door is an older format; a link that starts on the wall does not end on it.
    expect(usesFlipSinkFormat(room({ terrain: [[WIRED_CELL, HOLD_DOOR], [PLATE_CELL, PLATE]], signalLinks: [link(PLATE_CELL, WIRED_CELL)] }))).toBe(false);
    expect(usesFlipSinkFormat(room({ terrain: [[WIRED_CELL, WALL_CLOSED], [PLATE_CELL, PLATE]], signalLinks: [link(WIRED_CELL, PLATE_CELL)] }))).toBe(false);
    // Hidden under a removable top the link is dropped at load, so it needs no format.
    const hidden = room({
      terrain: [
        [WIRED_CELL, REMOVABLE_TOP],
        [PLATE_CELL, PLATE]
      ],
      underlays: [{ x: WIRED_CELL.x, y: WIRED_CELL.y, terrain: WALL_CLOSED }],
      signalLinks: [link(PLATE_CELL, WIRED_CELL)]
    });
    expect(usesFlipSinkFormat(hidden)).toBe(false);
  });

  it('reads the shipped ids by name, before any config is loaded', () => {
    expect(usesFlipSinkFormat(wallLevel(), null)).toBe(true);
    expect(usesFlipSinkFormat(room({ terrain: [[WIRED_CELL, HOLD_DOOR]], signalLinks: [link(PLATE_CELL, WIRED_CELL)] }), null)).toBe(false);
  });
});
