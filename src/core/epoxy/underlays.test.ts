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

vi.mock('../../audio/AudioManager', () => ({
  AudioManager: { playSfx: vi.fn(), playStep: vi.fn() }
}));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { ConfigRegistry } from '../../config/ConfigRegistry';
import { BlockPuzzleSolver } from '../BlockPuzzleSolver';
import { GameEngine } from '../GameEngine';
import { LevelValidator } from '../LevelValidator';
import { Pathfinder } from '../Pathfinder';
import { hiddenUnder, isRemovableTop, underlayMap } from '../Underlays';
import { CellUnderlay, CompiledLevel, Direction } from '../types';

const SIZE = 11;
const START_X = 2;
const START_Y = 5;
const DOOR_X = 3;
/** Ticks run before each move so the move cooldown has elapsed. */
const COOLDOWN_TICKS = 12;
/** Upper bound of ticks a slide needs to settle in these small rooms. */
const SETTLE_TICKS = 80;
const KEY_ID = 'key_red';

/** Walled floor room with the player at (2, 5), a red door at (3, 5) and the given underlays. */
function room(id: string, underlays?: CellUnderlay[], top = 'door_red'): CompiledLevel {
  const terrain: string[][] = Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x) => (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? 'wall' : 'floor'))
  );
  terrain[START_Y][DOOR_X] = top;
  return {
    id,
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    playerStart: { x: START_X, y: START_Y, dir: 'E' },
    terrain,
    items: Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null)),
    ...(underlays ? { underlays } : {}),
    entities: [],
    trapLinks: [],
    cloneLinks: []
  };
}

/** The room cut in two by a wall column, the door being the only way through. */
function corridor(level: CompiledLevel): CompiledLevel {
  for (let y = 1; y < SIZE - 1; y++) {
    if (y !== START_Y) level.terrain[y][DOOR_X] = 'wall';
  }
  return level;
}

/** Ice on the row of the door up to ICE_END_X, so that a slide from the door runs on to the first floor cell. */
const ICE_END_X = 6;
function icyRow(level: CompiledLevel): CompiledLevel {
  for (let x = DOOR_X + 1; x <= ICE_END_X; x++) level.terrain[START_Y][x] = 'ice';
  return level;
}

function under(terrain: string, x = DOOR_X, y = START_Y): CellUnderlay[] {
  return [{ x, y, terrain }];
}

function start(level: CompiledLevel, withKey = true): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(level);
  if (withKey) engine.getPlayer().keys[KEY_ID] = 1;
  return engine;
}

function ticks(engine: GameEngine, count: number): void {
  for (let i = 0; i < count; i++) engine.tick();
}

function step(engine: GameEngine, dir: Direction): boolean {
  ticks(engine, COOLDOWN_TICKS);
  return engine.attemptPlayerMove(dir);
}

beforeEach(() => {
  loadTestConfigs();
});

describe('underlay lookups', () => {
  it('is null without underlays and skips malformed entries', () => {
    expect(underlayMap(room('none'))).toBeNull();
    expect(underlayMap(room('empty', []))).toBeNull();
    const junk = [null, 4, { x: 99, y: 1, terrain: 'ice' }, { x: 1, y: 1 }, { x: 3, y: 5, terrain: 'ice' }, { x: 3, y: 5, terrain: 'water' }];
    const map = underlayMap(room('junk', junk as unknown as CellUnderlay[]));
    expect(map?.size).toBe(1);
    expect(map?.get(START_Y * SIZE + DOOR_X)).toBe('ice');
  });

  it('memoises on the list and reveals only a cell that still holds the level top', () => {
    const level = room('memo', under('ice'));
    expect(underlayMap(level)).toBe(underlayMap(level));
    expect(hiddenUnder(level, level.terrain, DOOR_X, START_Y)).toBe('ice');
    const changed = level.terrain.map((row) => [...row]);
    changed[START_Y][DOOR_X] = 'floor';
    expect(hiddenUnder(level, changed, DOOR_X, START_Y)).toBeUndefined();
  });

  it('names the removable tops', () => {
    for (const id of ['door_red', 'door_green', 'socket', 'blue_wall_fake', 'dirt']) {
      expect(isRemovableTop(ConfigRegistry.getTile(id))).toBe(true);
    }
    for (const id of ['floor', 'ice', 'wall', 'water', 'exit', 'button_green', 'teleport']) {
      expect(isRemovableTop(ConfigRegistry.getTile(id))).toBe(false);
    }
  });
});

describe('underlays revealed by a key door', () => {
  it('plays a door without underlay as before', () => {
    const engine = start(room('plain'));
    expect(step(engine, 'E')).toBe(true);
    expect(engine.getTerrain()[START_Y][DOOR_X]).toBe('floor');
    expect(engine.getPlayer().keys[KEY_ID]).toBe(0);
    expect(engine.getUnderlays()).toBeUndefined();
  });

  it('slides the player on ice that was under the door', () => {
    const engine = start(icyRow(room('ice', under('ice'))));
    expect(engine.getUnderlays()?.get(START_Y * SIZE + DOOR_X)).toBe('ice');
    expect(engine.getTerrain()[START_Y][DOOR_X]).toBe('door_red');
    expect(step(engine, 'E')).toBe(true);
    expect(engine.getTerrain()[START_Y][DOOR_X]).toBe('ice');
    ticks(engine, SETTLE_TICKS);
    expect(engine.getPlayer()).toMatchObject({ x: ICE_END_X + 1, y: START_Y, isSliding: false, alive: true });
  });

  it('spends the key and stays blocked when a wall was under the door', () => {
    const engine = start(room('wall', under('wall')));
    expect(step(engine, 'E')).toBe(false);
    expect(engine.getTerrain()[START_Y][DOOR_X]).toBe('wall');
    expect(engine.getPlayer()).toMatchObject({ x: START_X, alive: true });
    expect(engine.getPlayer().keys[KEY_ID]).toBe(0);
  });

  it('wins when the exit was under the door', () => {
    const engine = start(room('exit', under('exit')));
    expect(step(engine, 'E')).toBe(true);
    expect(engine.isLevelCompleted()).toBe(true);
  });

  it('drowns the player when water was under the door', () => {
    const engine = start(room('water', under('water')));
    step(engine, 'E');
    expect(engine.getPlayer().alive).toBe(false);
  });

  it('keeps a toggle control under a door inert until the door is open, then it works', () => {
    const level = room('toggle', under('button_green'));
    level.terrain[START_Y - 1][DOOR_X + 2] = 'toggle_wall_closed';
    const engine = start(level);
    ticks(engine, SETTLE_TICKS);
    expect(engine.getTerrain()[START_Y - 1][DOOR_X + 2]).toBe('toggle_wall_closed');
    expect(step(engine, 'E')).toBe(true);
    expect(engine.getTerrain()[START_Y - 1][DOOR_X + 2]).toBe('toggle_wall_open');
  });

  it('lets a teleporter under a door work after the reveal', () => {
    const level = room('teleport', under('teleport'));
    level.terrain[8][8] = 'teleport';
    const engine = start(level);
    expect(step(engine, 'E')).toBe(true);
    const player = engine.getPlayer();
    expect(Math.abs(player.x - 8) + Math.abs(player.y - 8)).toBe(1);
  });

  it('does not use a covered teleporter as an exit before the door is open', () => {
    const level = room('teleport_covered', under('teleport'));
    level.terrain[6][6] = 'teleport';
    level.terrain[8][8] = 'teleport';
    level.playerStart = { x: 5, y: 6, dir: 'E' };
    const engine = start(level, false);
    // The jump from (6, 6) goes back through the list: the pad at (3, 5) comes first but is still a door.
    expect(step(engine, 'E')).toBe(true);
    expect(Math.abs(engine.getPlayer().x - 8) + Math.abs(engine.getPlayer().y - 8)).toBe(1);
  });

  it('restores the door on undo after the reveal', () => {
    const engine = start(room('undo', under('ice')));
    expect(step(engine, 'E')).toBe(true);
    expect(engine.undo()).toBe(true);
    expect(engine.getTerrain()[START_Y][DOOR_X]).toBe('door_red');
    expect(engine.getPlayer().keys[KEY_ID]).toBe(1);
    expect(engine.getPlayer().x).toBe(START_X);
    expect(step(engine, 'E')).toBe(true);
    expect(engine.getTerrain()[START_Y][DOOR_X]).toBe('ice');
  });

  it('reveals nothing for a monster next to the door', () => {
    const level = room('monster', under('ice'));
    level.playerStart = { x: 9, y: 9, dir: 'N' };
    level.entities = [{ x: START_X, y: START_Y, type: 'walker', dir: 'E' }];
    const engine = start(level, false);
    ticks(engine, SETTLE_TICKS);
    expect(engine.getTerrain()[START_Y][DOOR_X]).toBe('door_red');
  });

  it('forgets the underlays of the previous level on load', () => {
    const engine = new GameEngine();
    engine.loadLevel(room('with', under('ice')));
    expect(engine.getUnderlays()).toBeDefined();
    engine.loadLevel(room('without'));
    expect(engine.getUnderlays()).toBeUndefined();
  });
});

describe('underlays revealed by other removable tops', () => {
  it('opens a socket onto ice', () => {
    const engine = start(icyRow(room('socket', under('ice'), 'socket')), false);
    expect(step(engine, 'E')).toBe(true);
    expect(engine.getTerrain()[START_Y][DOOR_X]).toBe('ice');
    ticks(engine, SETTLE_TICKS);
    expect(engine.getPlayer().x).toBe(ICE_END_X + 1);
  });

  it('keeps a socket shut while chips are missing', () => {
    const level = room('socket_chips', under('ice'), 'socket');
    level.chipsRequired = 1;
    level.items[2][2] = 'chip';
    const engine = start(level, false);
    expect(step(engine, 'E')).toBe(false);
    expect(engine.getTerrain()[START_Y][DOOR_X]).toBe('socket');
  });

  it('shows the water under a blue fake wall before the step, so the player drowns there', () => {
    const engine = start(room('fake_water', under('water'), 'blue_wall_fake'), false);
    step(engine, 'E');
    expect(engine.getTerrain()[START_Y][DOOR_X]).toBe('water');
    expect(engine.getPlayer().alive).toBe(false);
  });

  it('shows a wall under a blue fake wall as a wall', () => {
    const engine = start(room('fake_wall', under('wall'), 'blue_wall_fake'), false);
    expect(step(engine, 'E')).toBe(false);
    expect(engine.getTerrain()[START_Y][DOOR_X]).toBe('wall');
    expect(engine.getPlayer()).toMatchObject({ x: START_X, alive: true });
  });

  it('clears dirt onto the terrain under it', () => {
    const engine = start(icyRow(room('dirt', under('ice'), 'dirt')), false);
    expect(step(engine, 'E')).toBe(true);
    ticks(engine, SETTLE_TICKS);
    expect(engine.getPlayer()).toMatchObject({ x: ICE_END_X + 1, alive: true });
  });
});

describe('devices that appear with a reveal', () => {
  it('counts a target under a door only once the door is open', () => {
    const level = room('target', under('block_target'));
    level.winRule = 'targets';
    level.terrain[3][3] = 'block_target';
    const engine = start(level);
    expect(engine.getTargetsProgress()).toEqual({ covered: 0, total: 1 });
    expect(step(engine, 'E')).toBe(true);
    expect(engine.getTargetsProgress().total).toBe(2);
  });

  it('releases a trap from a hold trap button that was under a door once the player stands on it', () => {
    const level = room('trap', under('button_brown'));
    level.terrain[2][8] = 'trap';
    const engine = start(level);
    expect(engine.isCellClosedTrap(8, 2)).toBe(true);
    expect(step(engine, 'E')).toBe(true);
    expect(engine.isCellClosedTrap(8, 2)).toBe(false);
  });

  it('opens a hold door from a plate that was under a door once the player stands on it', () => {
    const level = room('plate', under('pressure_plate_red'));
    level.terrain[2][8] = 'hold_door_red_closed';
    const engine = start(level);
    expect(engine.getTerrain()[2][8]).toBe('hold_door_red_closed');
    expect(step(engine, 'E')).toBe(true);
    expect(engine.getTerrain()[2][8]).toBe('hold_door_red_open');
  });
});

describe('level tools with underlays', () => {
  it('finds an exit hidden under a door and reaches it through the door', () => {
    const level = corridor(room('validator_exit', under('exit')));
    level.items[START_Y - 1][START_X] = KEY_ID;
    const report = LevelValidator.validate(level);
    expect(report.stats.exitCount).toBe(1);
    expect(report.stats.reachableExit).toBe(true);
    expect(report.valid).toBe(true);
  });

  it('does not reach the exit beyond a door that hides a wall', () => {
    const level = corridor(room('validator_wall', under('wall')));
    level.terrain[START_Y][DOOR_X + 2] = 'exit';
    level.items[START_Y - 1][START_X] = KEY_ID;
    const report = LevelValidator.validate(level);
    expect(report.stats.reachableExit).toBe(false);
    expect(report.valid).toBe(false);
  });

  it('reaches the exit beyond a door that hides plain ground', () => {
    const level = corridor(room('validator_floor', under('floor')));
    level.terrain[START_Y][DOOR_X + 2] = 'exit';
    level.items[START_Y - 1][START_X] = KEY_ID;
    expect(LevelValidator.validate(level).stats.reachableExit).toBe(true);
  });

  it('sees the exit through a dirt cell that hides a wall as shut', () => {
    const level = corridor(room('validator_dirt', under('wall'), 'dirt'));
    level.terrain[START_Y][DOOR_X + 2] = 'exit';
    expect(LevelValidator.validate(level).stats.reachableExit).toBe(false);
  });

  it('plans through a door onto the cell beyond, and refuses a door that hides a wall or water', () => {
    const plain = start(corridor(room('path_floor', under('floor'))));
    expect(Pathfinder.findPath(plain, DOOR_X + 1, START_Y).moves).toEqual(['E', 'E']);
    const walled = start(corridor(room('path_wall', under('wall'))));
    expect(Pathfinder.findPath(walled, DOOR_X + 1, START_Y).moves).toEqual([]);
    const wet = start(corridor(room('path_water', under('water'))));
    expect(Pathfinder.findPath(wet, DOOR_X + 1, START_Y).moves).toEqual([]);
  });

  it('gives no block puzzle verdict on a level with underlays', () => {
    const level = room('solver', under('ice'));
    level.winRule = 'targets';
    level.terrain[3][3] = 'block_target';
    level.entities = [{ x: 5, y: 5, type: 'dirt_block', dir: 'E' }];
    const engine = start(level);
    expect(BlockPuzzleSolver.verdict(engine)).toEqual({ kind: 'none' });
    expect(BlockPuzzleSolver.isStuck(engine)).toBe(false);
    expect(BlockPuzzleSolver.hint(engine)).toBeNull();
  });
});
