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
import { searchStateKey } from '../../test/pilotSearch';
import { FLAME_TOGGLE_PARITY_BIT } from '../coreConstants';
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

/** Cell of the toggle button next to the player's start (north of it). */
const BUTTON_Y = START_Y - 1;
const SOCKET_TOP = 'socket';

describe('removable tops revealed under a door', () => {
  it('opens a socket that was under a door in the same step when no chip is left', () => {
    const engine = start(room('socket_door', under(SOCKET_TOP)));
    expect(step(engine, 'E')).toBe(true);
    expect(engine.getTerrain()[START_Y][DOOR_X]).toBe('floor');
    expect(engine.getPlayer()).toMatchObject({ x: DOOR_X, alive: true });
    expect(engine.getPlayer().keys[KEY_ID]).toBe(0);
  });

  it('spends the key and keeps the socket shut while chips are missing, then opens it with no second reveal', () => {
    const level = room('socket_door_chips', under(SOCKET_TOP));
    level.chipsRequired = 1;
    level.items[START_Y][START_X - 1] = 'chip';
    const engine = start(level);
    expect(step(engine, 'E')).toBe(false);
    expect(engine.getTerrain()[START_Y][DOOR_X]).toBe(SOCKET_TOP);
    expect(engine.getPlayer()).toMatchObject({ x: START_X, alive: true });
    expect(engine.getPlayer().keys[KEY_ID]).toBe(0);
    expect(engine.getStatusBannerKey()).toBe('hud.messages.socket_locked');
    expect(step(engine, 'W')).toBe(true);
    expect(engine.getChipsRemaining()).toBe(0);
    expect(step(engine, 'E')).toBe(true);
    expect(step(engine, 'E')).toBe(true);
    expect(engine.getTerrain()[START_Y][DOOR_X]).toBe('floor');
    expect(engine.getPlayer().x).toBe(DOOR_X);
  });

  it('clears dirt that was under a door, and a blue fake wall, when the player steps in', () => {
    for (const hidden of ['dirt', 'blue_wall_fake']) {
      const engine = start(room(`${hidden}_door`, under(hidden)));
      expect(step(engine, 'E')).toBe(true);
      expect(engine.getPlayer()).toMatchObject({ x: DOOR_X, alive: true });
      expect(engine.getTerrain()[START_Y][DOOR_X]).toBe('floor');
    }
  });

  it('lets the player onto a recessed wall that was under a door, which rises behind them', () => {
    const engine = start(room('recessed_door', under('recessed_wall')));
    expect(step(engine, 'E')).toBe(true);
    expect(engine.getPlayer().x).toBe(DOOR_X);
    expect(step(engine, 'E')).toBe(true);
    expect(engine.getTerrain()[START_Y][DOOR_X]).toBe('wall');
  });

  it('spends the key on an appearing wall under a door, which stays until touched and then turns into a wall', () => {
    const engine = start(room('appearing_door', under('appearing_wall')));
    expect(step(engine, 'E')).toBe(false);
    expect(engine.getTerrain()[START_Y][DOOR_X]).toBe('appearing_wall');
    expect(engine.getPlayer().keys[KEY_ID]).toBe(0);
    expect(step(engine, 'E')).toBe(false);
    expect(engine.getTerrain()[START_Y][DOOR_X]).toBe('wall');
  });

  it('fires a shot trigger that was under a door once the door is open', () => {
    const level = room('trigger_door', under('shot_trigger'));
    level.terrain[2][6] = 'shot_launcher_e';
    level.launcherLinks = [{ buttonX: DOOR_X, buttonY: START_Y, launcherX: 6, launcherY: 2 }];
    const engine = start(level);
    expect(engine.getShots()).toEqual([]);
    expect(step(engine, 'E')).toBe(true);
    expect(engine.getShots()?.length).toBe(1);
  });
});

describe('toggle walls hidden under doors', () => {
  const GREEN_BUTTON = 'button_green';

  /** The room with a green button north of the start and a toggle wall (in the given form) under the door. */
  function toggleRoom(form: string): CompiledLevel {
    const level = room(`toggle_${form}`, under(form));
    level.terrain[BUTTON_Y][START_X] = GREEN_BUTTON;
    return level;
  }

  /** Presses the button the given number of times (a step onto it, a step back), then opens the door. */
  function pressThenOpen(engine: GameEngine, presses: number): boolean {
    for (let i = 0; i < presses; i++) {
      step(engine, 'N');
      step(engine, 'S');
    }
    return step(engine, 'E');
  }

  it('shows the stored form after no press, flipped after one, and back after two', () => {
    expect(pressThenOpen(start(toggleRoom('toggle_wall_closed')), 0)).toBe(false);
    expect(pressThenOpen(start(toggleRoom('toggle_wall_closed')), 1)).toBe(true);
    expect(pressThenOpen(start(toggleRoom('toggle_wall_closed')), 2)).toBe(false);
    expect(pressThenOpen(start(toggleRoom('toggle_wall_open')), 0)).toBe(true);
    expect(pressThenOpen(start(toggleRoom('toggle_wall_open')), 1)).toBe(false);
  });

  it('counts the presses in a parity that undo takes back, and reports none without a covered wall', () => {
    const engine = start(toggleRoom('toggle_wall_closed'));
    expect(engine.getToggleParity()).toBe(0);
    step(engine, 'N');
    expect(engine.getToggleParity()).toBe(1);
    step(engine, 'S');
    step(engine, 'N');
    expect(engine.getToggleParity()).toBe(0);
    expect(engine.undo()).toBe(true);
    expect(engine.getToggleParity()).toBe(1);
    expect(engine.undo()).toBe(true);
    expect(engine.undo()).toBe(true);
    expect(engine.getToggleParity()).toBe(0);
    expect(start(room('no_toggle', under('ice'))).getToggleParity()).toBeUndefined();
    expect(start(room('plain')).getToggleParity()).toBeUndefined();
    engine.loadLevel(room('reloaded'));
    expect(engine.getToggleParity()).toBeUndefined();
  });

  it('keeps one parity per colour channel and lets two walls of a channel start in different forms', () => {
    const level = room('channels', [
      { x: DOOR_X, y: START_Y, terrain: 'toggle_wall_red_closed' },
      { x: START_X, y: START_Y + 1, terrain: 'toggle_wall_red_open' }
    ]);
    level.terrain[START_Y + 1][START_X] = 'door_red';
    level.terrain[BUTTON_Y][START_X] = 'toggle_button_red';
    const engine = start(level);
    engine.getPlayer().keys[KEY_ID] = 2;
    step(engine, 'N');
    step(engine, 'S');
    expect(engine.getToggleParity()).toBe(2);
    // One press: the wall stored closed is open, the one stored open is closed.
    expect(step(engine, 'S')).toBe(false);
    expect(engine.getTerrain()[START_Y + 1][START_X]).toBe('toggle_wall_red_closed');
    expect(step(engine, 'E')).toBe(true);
    expect(engine.getTerrain()[START_Y][DOOR_X]).toBe('toggle_wall_red_open');
  });

  it('is not moved by a button of another family', () => {
    const level = room('other_family', under('toggle_wall_red_closed'));
    level.terrain[BUTTON_Y][START_X] = GREEN_BUTTON;
    const engine = start(level);
    step(engine, 'N');
    expect(engine.getToggleParity()).toBe(0);
  });

  it('tells search states apart by parity', () => {
    const engine = start(toggleRoom('toggle_wall_closed'));
    const before = engine.getRuntimeKeyExtra();
    const stateBefore = searchStateKey(engine);
    step(engine, 'N');
    step(engine, 'S');
    expect(engine.getRuntimeKeyExtra()).not.toBe(before);
    expect(searchStateKey(engine)).not.toBe(stateBefore);
    expect(start(room('no_extra')).getRuntimeKeyExtra()).toBe('');
  });
});

describe('hold doors and plates hidden under doors', () => {
  const BLOCK_X = 8;
  const BLOCK_Y = 8;
  const DOOR_RED_CLOSED = 'hold_door_red_closed';

  function holdRoom(withVisibleDoor: boolean, pressed: boolean): CompiledLevel {
    const level = room('hold', under(DOOR_RED_CLOSED));
    if (pressed) {
      level.terrain[BLOCK_Y][BLOCK_X] = 'pressure_plate_red';
      level.entities = [{ x: BLOCK_X, y: BLOCK_Y, type: 'dirt_block', dir: 'E' }];
    }
    if (withVisibleDoor) level.terrain[2][8] = DOOR_RED_CLOSED;
    return level;
  }

  it('shows a covered hold door open when its colour is pressed, matching a visible door of the colour', () => {
    const engine = start(holdRoom(true, true));
    expect(engine.getTerrain()[2][8]).toBe('hold_door_red_open');
    expect(step(engine, 'E')).toBe(true);
    expect(engine.getTerrain()[START_Y][DOOR_X]).toBe('hold_door_red_open');
  });

  it('falls back to what the plates call for when no door of the colour is in sight', () => {
    const pressed = start(holdRoom(false, true));
    expect(step(pressed, 'E')).toBe(true);
    expect(pressed.getTerrain()[START_Y][DOOR_X]).toBe('hold_door_red_open');
    const unpressed = start(holdRoom(false, false));
    expect(step(unpressed, 'E')).toBe(false);
    expect(unpressed.getTerrain()[START_Y][DOOR_X]).toBe(DOOR_RED_CLOSED);
  });

  it('keeps a colour shut while a plate of it is still hidden, and opens it once the player stands on that plate', () => {
    const level = room('covered_plate', under('pressure_plate_red'));
    level.terrain[BLOCK_Y][BLOCK_X] = 'pressure_plate_red';
    level.entities = [{ x: BLOCK_X, y: BLOCK_Y, type: 'dirt_block', dir: 'E' }];
    level.terrain[2][8] = 'hold_door_red_closed';
    const engine = start(level);
    // The visible plate is pressed by the block, but the hidden one is not: the colour stays shut.
    ticks(engine, SETTLE_TICKS);
    expect(engine.getTerrain()[2][8]).toBe('hold_door_red_closed');
    expect(step(engine, 'E')).toBe(true);
    expect(engine.getTerrain()[2][8]).toBe('hold_door_red_open');
  });
});

describe('level tools with devices hidden under doors', () => {
  function beyondDoor(hidden: string): CompiledLevel {
    const level = corridor(room(`tool_${hidden}`, under(hidden)));
    level.terrain[START_Y][DOOR_X + 2] = 'exit';
    level.items[START_Y - 1][START_X] = KEY_ID;
    return level;
  }

  it('reaches an exit beyond a socket hidden under a door, and beyond a toggle wall that a button opens', () => {
    expect(LevelValidator.validate(beyondDoor(SOCKET_TOP)).stats.reachableExit).toBe(true);
    const toggled = beyondDoor('toggle_wall_closed');
    toggled.terrain[START_Y + 1][START_X] = 'button_green';
    expect(LevelValidator.validate(toggled).stats.reachableExit).toBe(true);
  });

  it('routes through a socket revealed under a door only once every chip is taken', () => {
    const open = corridor(room('path_socket', under(SOCKET_TOP)));
    expect(Pathfinder.findPath(start(open), DOOR_X + 1, START_Y).moves).toEqual(['E', 'E']);
    const locked = corridor(room('path_socket_chips', under(SOCKET_TOP)));
    locked.chipsRequired = 1;
    expect(Pathfinder.findPath(start(locked), DOOR_X + 1, START_Y).moves).toEqual([]);
  });

  it('plans through a covered toggle wall in the form the presses have left it', () => {
    const closed = corridor(room('path_toggle', under('toggle_wall_closed')));
    expect(Pathfinder.findPath(start(closed), DOOR_X + 1, START_Y).moves).toEqual([]);
    const open = corridor(room('path_toggle_open', under('toggle_wall_open')));
    expect(Pathfinder.findPath(start(open), DOOR_X + 1, START_Y).moves).toEqual(['E', 'E']);
  });
});

describe('flame jets hidden under removable tops', () => {
  const ORANGE_BUTTON = 'button_orange';
  const JET_ON = 'flame_jet_on';
  const JET_OFF = 'flame_jet_off';

  function jetRoom(stored: string, top = 'door_red'): CompiledLevel {
    const level = room(`jet_${stored}_${top}`, under(stored), top);
    level.terrain[BUTTON_Y][START_X] = ORANGE_BUTTON;
    return level;
  }

  /** Presses the orange button the given number of times, then steps onto the top; true when the player lives. */
  function pressThenEnter(engine: GameEngine, presses: number): boolean {
    for (let i = 0; i < presses; i++) {
      step(engine, 'N');
      step(engine, 'S');
    }
    step(engine, 'E');
    return engine.getPlayer().alive;
  }

  it('shows a jet in the form the orange presses left it in, under a door', () => {
    expect(pressThenEnter(start(jetRoom(JET_OFF)), 0)).toBe(true);
    expect(pressThenEnter(start(jetRoom(JET_OFF)), 1)).toBe(false);
    expect(pressThenEnter(start(jetRoom(JET_OFF)), 2)).toBe(true);
    expect(pressThenEnter(start(jetRoom(JET_ON)), 0)).toBe(false);
    expect(pressThenEnter(start(jetRoom(JET_ON)), 1)).toBe(true);
    expect(pressThenEnter(start(jetRoom(JET_ON)), 2)).toBe(false);
  });

  it('follows the presses under dirt in the same way', () => {
    expect(pressThenEnter(start(jetRoom(JET_OFF, 'dirt'), false), 0)).toBe(true);
    expect(pressThenEnter(start(jetRoom(JET_OFF, 'dirt'), false), 1)).toBe(false);
    expect(pressThenEnter(start(jetRoom(JET_ON, 'dirt'), false), 1)).toBe(true);
    expect(pressThenEnter(start(jetRoom(JET_ON, 'dirt'), false), 2)).toBe(false);
  });

  it('burns nothing while the jet is covered, and counts the press in the flame parity', () => {
    const engine = start(jetRoom(JET_ON));
    step(engine, 'N');
    expect(engine.getPlayer().alive).toBe(true);
    expect(engine.getTerrain()[START_Y][DOOR_X]).toBe('door_red');
    expect(engine.getToggleParity()).toBe(FLAME_TOGGLE_PARITY_BIT);
    step(engine, 'S');
    step(engine, 'N');
    expect(engine.getToggleParity()).toBe(0);
    expect(engine.getPlayer().alive).toBe(true);
  });

  it('kills the player who steps onto a revealed lit jet, and spares one with fire boots', () => {
    const engine = start(jetRoom(JET_ON));
    step(engine, 'E');
    expect(engine.getTerrain()[START_Y][DOOR_X]).toBe(JET_ON);
    expect(engine.getPlayer().alive).toBe(false);
    const shod = start(jetRoom(JET_ON));
    shod.getPlayer().boots.add('boots_fire');
    step(shod, 'E');
    expect(shod.getPlayer().alive).toBe(true);
  });

  it('is not moved by a button of another family', () => {
    const level = jetRoom(JET_ON);
    level.terrain[BUTTON_Y][START_X] = 'button_green';
    const engine = start(level);
    step(engine, 'N');
    expect(engine.getToggleParity()).toBe(0);
  });
});

describe('laser gates hidden under removable tops', () => {
  const EMITTER = { x: 4, y: 2 };
  const RECEIVER = { x: 8, y: 2 };
  const SIBLING = { x: 8, y: 8 };
  const GATE_OPEN = 'laser_gate_red_open';
  const GATE_CLOSED = 'laser_gate_red_closed';

  function gateRoom(stored: string, lit: boolean): CompiledLevel {
    const level = room(`gate_${stored}_${lit}`, under(stored));
    level.terrain[RECEIVER.y][RECEIVER.x] = 'laser_receiver_red';
    if (lit) level.terrain[EMITTER.y][EMITTER.x] = 'laser_emitter_e';
    return level;
  }

  it('comes out open when its group is lit, whatever form is stored', () => {
    for (const stored of [GATE_OPEN, GATE_CLOSED]) {
      const engine = start(gateRoom(stored, true));
      ticks(engine, COOLDOWN_TICKS);
      expect(step(engine, 'E')).toBe(true);
      expect(engine.getTerrain()[START_Y][DOOR_X]).toBe(GATE_OPEN);
    }
  });

  it('comes out closed when its group is not lit, whatever form is stored', () => {
    for (const stored of [GATE_OPEN, GATE_CLOSED]) {
      const engine = start(gateRoom(stored, false));
      ticks(engine, COOLDOWN_TICKS);
      expect(step(engine, 'E')).toBe(false);
      expect(engine.getTerrain()[START_Y][DOOR_X]).toBe(GATE_CLOSED);
      expect(engine.getPlayer().keys[KEY_ID]).toBe(0);
    }
  });

  it('follows the computed rule, not a visible sibling held open by an occupant', () => {
    const level = gateRoom(GATE_CLOSED, false);
    level.terrain[SIBLING.y][SIBLING.x] = GATE_OPEN;
    level.entities = [{ x: SIBLING.x, y: SIBLING.y, type: 'dirt_block', dir: 'E' }];
    const engine = start(level);
    ticks(engine, COOLDOWN_TICKS);
    expect(engine.getTerrain()[SIBLING.y][SIBLING.x]).toBe(GATE_OPEN);
    expect(step(engine, 'E')).toBe(false);
    expect(engine.getTerrain()[START_Y][DOOR_X]).toBe(GATE_CLOSED);
  });
});

describe('a cell reveals its hidden terrain once', () => {
  const FIRE_BOOTS = 'boots_fire';
  const CELL_INDEX = START_Y * SIZE + DOOR_X;

  /** Dirt over fire with an ice block north of the cell and a dirt block south of it. */
  function sinkRoom(): CompiledLevel {
    const level = room('sink', under('fire'), 'dirt');
    level.entities = [
      { x: DOOR_X, y: START_Y - 1, type: 'ice_block', dir: 'S' },
      { x: DOOR_X, y: START_Y + 1, type: 'dirt_block', dir: 'N' }
    ];
    return level;
  }

  /** Reveals the fire, melts the ice block into it, then sinks the dirt block in the water it left. */
  function playSink(): GameEngine {
    const engine = start(sinkRoom(), false);
    engine.getPlayer().boots.add(FIRE_BOOTS);
    expect(step(engine, 'E')).toBe(true);
    expect(engine.getTerrain()[START_Y][DOOR_X]).toBe('fire');
    for (const dir of ['W', 'N', 'N', 'E', 'S'] as Direction[]) step(engine, dir);
    expect(engine.getTerrain()[START_Y][DOOR_X]).toBe('water');
    for (const dir of ['W', 'S', 'S', 'S', 'E', 'N'] as Direction[]) step(engine, dir);
    return engine;
  }

  it('does not reveal a second time when a block sunk in the revealed water makes dirt again', () => {
    const engine = playSink();
    expect(engine.getTerrain()[START_Y][DOOR_X]).toBe('dirt');
    expect(engine.getRevealedTerrain(DOOR_X, START_Y)).toBeUndefined();
    expect(engine.getSpentRevealCells()).toEqual([CELL_INDEX]);
    expect(step(engine, 'N')).toBe(true);
    expect(engine.getTerrain()[START_Y][DOOR_X]).toBe('floor');
    expect(engine.getPlayer().alive).toBe(true);
  });

  it('makes the cell revealable again when undo takes the reveal back', () => {
    const engine = start(room('undo_reveal', under('ice')));
    expect(engine.getRevealedTerrain(DOOR_X, START_Y)).toBe('ice');
    expect(step(engine, 'E')).toBe(true);
    expect(engine.getRevealedTerrain(DOOR_X, START_Y)).toBeUndefined();
    expect(engine.undo()).toBe(true);
    expect(engine.getTerrain()[START_Y][DOOR_X]).toBe('door_red');
    expect(engine.getRevealedTerrain(DOOR_X, START_Y)).toBe('ice');
    expect(step(engine, 'E')).toBe(true);
    expect(engine.getTerrain()[START_Y][DOOR_X]).toBe('ice');
  });

  it('keeps the revealed cells in the snapshot only once a cell was revealed', () => {
    const engine = start(room('snapshot', under('ice')));
    expect(engine.captureState().revealedCells).toBeUndefined();
    step(engine, 'E');
    expect(engine.captureState().revealedCells).toEqual([CELL_INDEX]);
  });

  it('changes the runtime key with a spent cell, and keeps it empty before', () => {
    const fresh = start(sinkRoom(), false);
    expect(fresh.getRuntimeKeyExtra()).toBe('');
    expect(fresh.getSpentRevealCells()).toBeUndefined();
    const keyBefore = searchStateKey(fresh);
    const spent = playSink();
    expect(spent.getRuntimeKeyExtra()).toBe(`rv${CELL_INDEX}`);
    expect(searchStateKey(spent)).not.toBe(keyBefore);
  });

  it('does not route the pathfinder through a spent cell that would reveal water', () => {
    const level = corridor(room('path_spent', under('water'), 'dirt'));
    const engine = start(level, false);
    expect(Pathfinder.findPath(engine, DOOR_X + 1, START_Y).moves).toEqual([]);
    const snapshot = engine.captureState();
    snapshot.revealedCells = [CELL_INDEX];
    engine.restoreState(snapshot);
    expect(Pathfinder.findPath(engine, DOOR_X + 1, START_Y).moves).toEqual(['E', 'E']);
  });
});
