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
import { findMonsterBehaviourConfigErrors, findSteeringConfigErrors } from '../../config/ConfigValidation';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { DEFAULT_MONSTER_MOVE_INTERVAL_TICKS, GRAY_BUTTON_RADIUS } from '../coreConstants';
import { GameEngine } from '../GameEngine';
import type { CompiledLevel, Direction, EntityDefinition, EntityPlacement } from '../types';

const SIZE = 13;
const CENTER = 6;
const TIME_LIMIT_SECONDS = 1000;
const ROVER = 'rover';
const GHOST = 'ghost';
const BLOB = 'blob';
/** The index of the pink ball in the rover's list: it walks straight on and turns back when blocked. */
const ROVER_BALL_EMULATEE = 3;
const MAX_WAIT_TICKS = 40;

type Cell = [number, number];

interface Setup {
  entities: EntityPlacement[];
  terrain?: Array<[number, number, string]>;
  items?: Array<[number, number, string]>;
  chipsRequired?: number;
  player?: { x: number; y: number };
}

const stepTicks = (type: string): number => (ConfigRegistry.getEntityDef(type)?.moveIntervalTicks ?? DEFAULT_MONSTER_MOVE_INTERVAL_TICKS) + 1;

/** Walled floor room; the player stands still in the far corner unless the setup says otherwise. */
function room(setup: Setup): CompiledLevel {
  const terrain: string[][] = Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x) => (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? 'wall' : 'floor'))
  );
  for (const [x, y, id] of setup.terrain ?? []) terrain[y][x] = id;
  const items: Array<Array<string | null>> = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null));
  for (const [x, y, id] of setup.items ?? []) items[y][x] = id;
  return {
    id: 'cc2_monster_rules_room',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: TIME_LIMIT_SECONDS,
    chipsRequired: setup.chipsRequired ?? 0,
    playerStart: { ...(setup.player ?? { x: SIZE - 2, y: SIZE - 2 }), dir: 'N' },
    terrain,
    items,
    entities: setup.entities,
    trapLinks: [],
    cloneLinks: []
  };
}

function load(level: CompiledLevel): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(level);
  return engine;
}

function run(engine: GameEngine, count: number): void {
  for (let i = 0; i < count; i++) engine.tick();
}

function find(engine: GameEngine, type: string) {
  return engine.getEntities().find((e) => e.type === type);
}

function cellOf(engine: GameEngine, type: string): string {
  const found = find(engine, type);
  return found ? `${found.x},${found.y}` : 'gone';
}

function placement(type: string, x: number, y: number, dir: Direction = 'E'): EntityPlacement {
  return { type, x, y, dir };
}

/** A rover set to the pink ball behaviour, one step of it later. */
function roverStep(setup: Omit<Setup, 'entities'>, extra: EntityPlacement[] = []): GameEngine {
  const engine = load(room({ ...setup, entities: [placement(ROVER, CENTER, CENTER), ...extra] }));
  const rover = find(engine, ROVER);
  if (rover === undefined) throw new Error('the rover is missing');
  rover.emulatee = ROVER_BALL_EMULATEE;
  rover.emulationMoves = 0;
  run(engine, stepTicks(ROVER));
  return engine;
}

function ghostStep(setup: Omit<Setup, 'entities'>): GameEngine {
  const engine = load(room({ ...setup, entities: [placement(GHOST, CENTER, CENTER)] }));
  run(engine, stepTicks(GHOST));
  return engine;
}

beforeEach(() => {
  loadTestConfigs();
});

describe('CC2 monster rules: configuration', () => {
  it('gives the rover and the ghost their CC2 rule data and passes the checks', () => {
    const monsters = ConfigRegistry.getMonsters().entities;
    expect(monsters[ROVER].pushesBlocks).toBe(true);
    expect(monsters[ROVER].picksUpItems).toBe(true);
    expect(monsters[ROVER].passesItems).toBe(true);
    expect(monsters[ROVER].entersBarredTiles).toEqual(expect.arrayContaining(['exit', 'socket', 'dirt', 'gravel']));
    expect(monsters[GHOST].picksUpItems).toBe(true);
    expect(monsters[BLOB].immuneToSlime).toBe(true);
    expect(monsters[BLOB].trailTile).toBe('slime');
    expect(findMonsterBehaviourConfigErrors(ConfigRegistry.getTiles().tiles, monsters)).toEqual([]);
    expect(findSteeringConfigErrors(ConfigRegistry.getTiles().tiles, monsters)).toEqual([]);
  });

  it('refuses a picksUpItems that is not a boolean or sits on a block', () => {
    const tiles = ConfigRegistry.getTiles().tiles;
    const patched = (id: string, patch: Partial<EntityDefinition>): Record<string, EntityDefinition> => ({
      ...ConfigRegistry.getMonsters().entities,
      [id]: { ...(ConfigRegistry.getMonsters().entities[id] as EntityDefinition), ...patch }
    });
    expect(findMonsterBehaviourConfigErrors(tiles, patched(GHOST, { picksUpItems: 'yes' as unknown as boolean }))).toContain(
      'ghost.picksUpItems: expected a boolean'
    );
    expect(findMonsterBehaviourConfigErrors(tiles, patched('dirt_block', { picksUpItems: true }))).toContain(
      'dirt_block.picksUpItems: only a monster has this field'
    );
    expect(findMonsterBehaviourConfigErrors(tiles, patched(ROVER, { entersBarredTiles: ['nowhere'] }))).toContain(
      'rover.entersBarredTiles: "nowhere" is not the id of an existing tile'
    );
    expect(findMonsterBehaviourConfigErrors(tiles, patched('dirt_block', { entersBarredTiles: ['exit'] }))).toContain(
      'dirt_block.entersBarredTiles: only a monster enters barred tiles'
    );
  });
});

describe('CC2 rover rules', () => {
  it('pushes the block in its way and takes the cell', () => {
    const engine = roverStep({}, [placement('dirt_block', CENTER + 1, CENTER)]);
    expect(cellOf(engine, ROVER)).toBe(`${CENTER + 1},${CENTER}`);
    const block = engine.getEntities().find((e) => e.type === 'dirt_block');
    expect(`${block?.x},${block?.y}`).toBe(`${CENTER + 2},${CENTER}`);
  });

  it('turns back when the block cannot move', () => {
    const engine = roverStep(
      { terrain: [[CENTER + 2, CENTER, 'wall']] },
      [placement('dirt_block', CENTER + 1, CENTER)]
    );
    const block = engine.getEntities().find((e) => e.type === 'dirt_block');
    expect(`${block?.x},${block?.y}`).toBe(`${CENTER + 1},${CENTER}`);
    expect(cellOf(engine, ROVER)).toBe(`${CENTER - 1},${CENTER}`);
  });

  it('walks onto an exit, a gravel cell and a chip, which bar the other monsters', () => {
    for (const tile of ['exit', 'gravel']) {
      const engine = roverStep({ terrain: [[CENTER + 1, CENTER, tile]] });
      expect(cellOf(engine, ROVER), tile).toBe(`${CENTER + 1},${CENTER}`);
    }
    const chip = roverStep({ items: [[CENTER + 1, CENTER, 'chip']], chipsRequired: 1 });
    expect(cellOf(chip, ROVER)).toBe(`${CENTER + 1},${CENTER}`);
    expect(chip.getItems()[CENTER][CENTER + 1]).toBe('chip');
  });

  it('packs dirt down as it steps on it', () => {
    const engine = roverStep({ terrain: [[CENTER + 1, CENTER, 'dirt']] });
    expect(cellOf(engine, ROVER)).toBe(`${CENTER + 1},${CENTER}`);
    expect(engine.getTerrain()[CENTER][CENTER + 1]).toBe('floor');
  });

  it('enters a socket only once no chip is missing, and opens it', () => {
    const closed = roverStep({ terrain: [[CENTER + 1, CENTER, 'socket']], chipsRequired: 1, items: [[2, 2, 'chip']] });
    expect(cellOf(closed, ROVER)).toBe(`${CENTER - 1},${CENTER}`);
    expect(closed.getTerrain()[CENTER][CENTER + 1]).toBe('socket');
    const open = roverStep({ terrain: [[CENTER + 1, CENTER, 'socket']] });
    expect(cellOf(open, ROVER)).toBe(`${CENTER + 1},${CENTER}`);
    expect(open.getTerrain()[CENTER][CENTER + 1]).toBe('floor');
  });

  it('picks up a tool or a normal key, but leaves a red key and a bonus', () => {
    const boots = roverStep({ items: [[CENTER + 1, CENTER, 'boots_fire']] });
    expect(cellOf(boots, ROVER)).toBe(`${CENTER + 1},${CENTER}`);
    expect(boots.getItems()[CENTER][CENTER + 1]).toBeNull();
    const red = roverStep({ items: [[CENTER + 1, CENTER, 'key_red']] });
    expect(red.getItems()[CENTER][CENTER + 1]).toBe('key_red');
    const bonus = roverStep({ items: [[CENTER + 1, CENTER, 'score_100']] });
    expect(bonus.getItems()[CENTER][CENTER + 1]).toBe('score_100');
  });
});

describe('CC2 rover rules: pushes and thieves', () => {
  it('stays out of a cell that its own push has just closed', () => {
    // The pushed block lands on a green button, which closes the toggle wall the block stood on.
    const engine = roverStep(
      {
        terrain: [
          [CENTER + 1, CENTER, 'toggle_wall_open'],
          [CENTER + 2, CENTER, 'button_green']
        ]
      },
      [placement('dirt_block', CENTER + 1, CENTER)]
    );
    expect(engine.getTerrain()[CENTER][CENTER + 1]).toBe('toggle_wall_closed');
    const block = engine.getEntities().find((e) => e.type === 'dirt_block');
    expect(`${block?.x},${block?.y}`).toBe(`${CENTER + 2},${CENTER}`);
    expect(cellOf(engine, ROVER)).toBe(`${CENTER},${CENTER}`);
  });

  it('leaves the keys of the player alone when it enters a key thief', () => {
    const engine = load(
      room({ terrain: [[CENTER + 1, CENTER, 'thief_keys']], entities: [placement(ROVER, CENTER, CENTER)] })
    );
    engine.getPlayer().keys.key_red = 2;
    const rover = find(engine, ROVER);
    if (rover === undefined) throw new Error('the rover is missing');
    rover.emulatee = ROVER_BALL_EMULATEE;
    rover.emulationMoves = 0;
    run(engine, stepTicks(ROVER));
    expect(cellOf(engine, ROVER)).toBe(`${CENTER + 1},${CENTER}`);
    expect(engine.getPlayer().keys.key_red).toBe(2);
  });
});

describe('CC2 ghost rules', () => {
  it('picks up keys and tools it walks over', () => {
    for (const item of ['key_yellow', 'key_green', 'key_blue', 'boots_water', 'boots_fire']) {
      const engine = ghostStep({ items: [[CENTER + 1, CENTER, item]] });
      expect(cellOf(engine, GHOST), item).toBe(`${CENTER + 1},${CENTER}`);
      expect(engine.getItems()[CENTER][CENTER + 1], item).toBeNull();
    }
  });

  it('leaves a red key, a chip and a bonus where they lie', () => {
    for (const item of ['key_red', 'chip', 'score_1000', 'stopwatch_bonus']) {
      const engine = ghostStep({ items: [[CENTER + 1, CENTER, item]], chipsRequired: 1 });
      expect(cellOf(engine, GHOST), item).toBe(`${CENTER + 1},${CENTER}`);
      expect(engine.getItems()[CENTER][CENTER + 1], item).toBe(item);
    }
  });
});

describe('CC2 blob rules', () => {
  /** A one-cell-wide corridor of three cells with the slime in the middle: the blob has one way to go. */
  function corridor(): GameEngine {
    const walls: Array<[number, number, string]> = [];
    for (let y = 1; y < SIZE - 1; y++) {
      for (let x = 1; x < SIZE - 1; x++) {
        if (y !== CENTER || x < CENTER || x > CENTER + 2) walls.push([x, y, 'wall']);
      }
    }
    const level = room({
      terrain: [...walls, [CENTER + 1, CENTER, 'slime']],
      entities: [placement(BLOB, CENTER, CENTER)],
      player: { x: SIZE - 2, y: SIZE - 2 }
    });
    return load(level);
  }

  it('is not hurt by slime and leaves slime on the floor it leaves afterwards', () => {
    const engine = corridor();
    run(engine, stepTicks(BLOB) * 3);
    expect(find(engine, BLOB)).toBeDefined();
    const row = engine.getTerrain()[CENTER];
    expect([row[CENTER], row[CENTER + 2]]).toContain('slime');
  });

  it('keeps its plain floor without slime', () => {
    const engine = load(room({ entities: [placement(BLOB, CENTER, CENTER)] }));
    run(engine, stepTicks(BLOB) * 4);
    expect(engine.getTerrain().flat().filter((tile) => tile === 'slime')).toEqual([]);
  });
});

describe('CC2 gray area button', () => {
  const BUTTON: Cell = [3, 5];
  const START = { x: 2, y: 5 };
  const IN_REACH = (dx: number, dy: number): Cell => [BUTTON[0] + dx, BUTTON[1] + dy];

  function pulse(tiles: Array<[Cell, string]>, entities: EntityPlacement[] = []): GameEngine {
    const terrain: string[][] = Array.from({ length: SIZE }, (_, y) =>
      Array.from({ length: SIZE }, (_, x) => (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? 'wall' : 'floor'))
    );
    terrain[BUTTON[1]][BUTTON[0]] = 'button_gray_area';
    for (const [[x, y], id] of tiles) terrain[y][x] = id;
    const items: Array<Array<string | null>> = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null));
    const engine = load({
      id: 'gray_area_room',
      number: 1,
      password: 'TEST',
      timeLimitSeconds: TIME_LIMIT_SECONDS,
      chipsRequired: 0,
      playerStart: { ...START, dir: 'E' },
      terrain,
      items,
      entities,
      trapLinks: [],
      cloneLinks: []
    });
    for (let waited = 0; waited <= MAX_WAIT_TICKS && engine.getPlayer().moveCooldown !== 0; waited++) engine.tick();
    engine.attemptPlayerMove('E');
    return engine;
  }

  it('flips the toggle walls, force floors, swivel doors and flame jets of the 5 by 5 square', () => {
    const near = IN_REACH(GRAY_BUTTON_RADIUS, -GRAY_BUTTON_RADIUS);
    const engine = pulse([
      [near, 'toggle_wall_closed'],
      [IN_REACH(1, 1), 'force_n'],
      [IN_REACH(-1, 1), 'force_e'],
      [IN_REACH(0, 2), 'swivel_door_ne'],
      [IN_REACH(0, -2), 'flame_jet_off'],
      [IN_REACH(2, 2), 'flame_jet_on']
    ]);
    const at = ([x, y]: Cell): string => engine.getTerrain()[y][x];
    expect(at(near)).toBe('toggle_wall_open');
    expect(at(IN_REACH(1, 1))).toBe('force_s');
    expect(at(IN_REACH(-1, 1))).toBe('force_w');
    expect(at(IN_REACH(0, 2))).toBe('swivel_door_se');
    expect(at(IN_REACH(0, -2))).toBe('flame_jet_on');
    expect(at(IN_REACH(2, 2))).toBe('flame_jet_off');
  });

  it('turns a swivel door round the block standing in it without moving the block', () => {
    // Engine behaviour, pinned: the door turns under its occupant, which keeps its cell (nothing is pushed out or
    // overlapped); the occupant leaves later as it would from any swivel door.
    const door = IN_REACH(0, 2);
    const engine = pulse([[door, 'swivel_door_ne']], [placement('dirt_block', door[0], door[1])]);
    expect(engine.getTerrain()[door[1]][door[0]]).toBe('swivel_door_se');
    const block = engine.getEntities().find((e) => e.type === 'dirt_block');
    expect(`${block?.x},${block?.y}`).toBe(`${door[0]},${door[1]}`);
    expect(engine.getEntities().filter((e) => e.x === door[0] && e.y === door[1])).toHaveLength(1);
  });

  it('leaves the same devices alone outside the square', () => {
    const far = GRAY_BUTTON_RADIUS + 1;
    const engine = pulse([
      [IN_REACH(far, 0), 'toggle_wall_closed'],
      [IN_REACH(0, far), 'force_n'],
      [IN_REACH(0, -far), 'flame_jet_off']
    ]);
    const at = ([x, y]: Cell): string => engine.getTerrain()[y][x];
    expect(at(IN_REACH(far, 0))).toBe('toggle_wall_closed');
    expect(at(IN_REACH(0, far))).toBe('force_n');
    expect(at(IN_REACH(0, -far))).toBe('flame_jet_off');
  });

  it('leaves the other force floors and the plain floor alone', () => {
    const engine = pulse([
      [IN_REACH(1, 0), 'force_random'],
      [IN_REACH(1, 1), 'force_cycle']
    ]);
    expect(engine.getTerrain()[BUTTON[1]][BUTTON[0] + 1]).toBe('force_random');
    expect(engine.getTerrain()[BUTTON[1] + 1][BUTTON[0] + 1]).toBe('force_cycle');
  });
});
