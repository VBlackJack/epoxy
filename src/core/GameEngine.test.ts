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

vi.mock('../audio/AudioManager', () => ({
  AudioManager: { playSfx: vi.fn() }
}));

import { GameEngine } from './GameEngine';
import { ConfigRegistry } from '../config/ConfigRegistry';
import { CompiledLevel, Direction, TimedMove } from './types';
import { loadTestConfigs } from '../test/loadTestConfigs';

/** Walled floor level of the given size (the default map size unless given) with the player at (2, 2). */
function openLevel(id: string, size?: { width: number; height: number }): CompiledLevel {
  const { mapWidth, mapHeight } = size
    ? { mapWidth: size.width, mapHeight: size.height }
    : ConfigRegistry.getGame().grid;
  return {
    id,
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    playerStart: { x: 2, y: 2, dir: 'S' },
    terrain: Array.from({ length: mapHeight }, (_, y) =>
      Array.from({ length: mapWidth }, (_, x) =>
        x === 0 || y === 0 || x === mapWidth - 1 || y === mapHeight - 1 ? 'wall' : 'floor'
      )
    ),
    items: Array.from({ length: mapHeight }, () => Array.from({ length: mapWidth }, () => null)),
    entities: [],
    trapLinks: [],
    cloneLinks: []
  };
}

/** Moves the player a number of cells in one direction, waiting out the move cooldown. */
function walk(engine: GameEngine, dir: Direction, steps: number): void {
  const maxWaitTicks = 20;
  for (let step = 0; step < steps; step++) {
    let waited = 0;
    while (!engine.attemptPlayerMove(dir)) {
      engine.tick();
      if (++waited > maxWaitTicks) throw new Error(`move ${dir} refused at step ${step}`);
    }
    engine.tick();
  }
}

/** Ticks past the move cooldown and reports whether a move in that direction is refused. */
function isBlocked(engine: GameEngine, dir: Direction): boolean {
  const cooldownTicks = 20;
  for (let i = 0; i < cooldownTicks; i++) engine.tick();
  return !engine.attemptPlayerMove(dir);
}

function tickUntil(engine: GameEngine, tick: number): void {
  while (engine.getTick() < tick && engine.getPlayer().alive && !engine.isLevelCompleted()) {
    engine.tick();
  }
}

function replay(level: CompiledLevel, moves: TimedMove[], finalTick: number): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(level);
  let i = 0;
  for (;;) {
    while (i < moves.length && moves[i].tick === engine.getTick()) {
      const move = moves[i];
      if (move.drop) {
        engine.dropItem(move.drop);
      } else {
        engine.attemptPlayerMove(move.dir);
      }
      i++;
    }
    if (engine.getTick() >= finalTick || !engine.getPlayer().alive) break;
    engine.tick();
  }
  return engine;
}

function snapshotState(engine: GameEngine): string {
  const p = engine.getPlayer();
  return JSON.stringify({
    tick: engine.getTick(),
    player: [p.x, p.y, p.dir, p.alive],
    entities: engine.getEntities().map((e) => [e.uid, e.type, e.x, e.y, e.dir, e.cooldownTicks]),
    terrain: engine.getTerrain(),
    items: engine.getItems()
  });
}

/** Level with random monsters penned in a closed room, plus a random force floor. */
function randomLevel(): CompiledLevel {
  const lvl = openLevel('random_room');
  for (let x = 14; x <= 24; x++) {
    lvl.terrain[14][x] = 'wall';
    lvl.terrain[24][x] = 'wall';
  }
  for (let y = 14; y <= 24; y++) {
    lvl.terrain[y][14] = 'wall';
    lvl.terrain[y][24] = 'wall';
  }
  lvl.terrain[2][6] = 'force_random';
  lvl.entities = [
    { x: 16, y: 16, type: 'blob', dir: 'N' },
    { x: 20, y: 20, type: 'walker', dir: 'E' },
    { x: 18, y: 22, type: 'blob', dir: 'S' }
  ];
  return lvl;
}

describe('GameEngine', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('plays a 10x10 level within its own borders', () => {
    const lvl = openLevel('small_room', { width: 10, height: 10 });
    lvl.terrain[8][8] = 'exit';
    lvl.terrain[2][5] = 'button_green';
    lvl.terrain[5][2] = 'toggle_wall_closed';
    const engine = new GameEngine();
    engine.loadLevel(lvl);
    expect(engine.getMapWidth()).toBe(10);
    expect(engine.getMapHeight()).toBe(10);

    // Walk east along row 2: the button toggles the wall, then the border wall stops the player at x = 8.
    walk(engine, 'E', 6);
    expect(engine.getPlayer().x).toBe(8);
    expect(isBlocked(engine, 'E')).toBe(true);
    expect(engine.getPlayer().x).toBe(8);
    expect(engine.getTerrain()[5][2]).toBe('toggle_wall_open');
    expect(engine.getTerrain()).toHaveLength(10);

    walk(engine, 'S', 6);
    expect(engine.getPlayer()).toMatchObject({ x: 8, y: 8 });
    expect(engine.isLevelCompleted()).toBe(true);
  });

  it('plays a 40x30 level out to its far corner', () => {
    const lvl = openLevel('wide_room', { width: 40, height: 30 });
    lvl.terrain[28][38] = 'exit';
    const engine = new GameEngine();
    engine.loadLevel(lvl);
    expect(engine.getMapWidth()).toBe(40);
    expect(engine.getMapHeight()).toBe(30);

    walk(engine, 'E', 36);
    expect(engine.getPlayer().x).toBe(38);
    expect(isBlocked(engine, 'E')).toBe(true);
    walk(engine, 'S', 26);
    expect(engine.getPlayer()).toMatchObject({ x: 38, y: 28 });
    expect(engine.isLevelCompleted()).toBe(true);
  });

  it('refuses undo after a win and rolls the score back on restart', () => {
    const lvl = openLevel('win_level');
    lvl.terrain[2][3] = 'exit';
    const engine = new GameEngine();
    engine.loadLevel(lvl);

    expect(engine.attemptPlayerMove('E')).toBe(true);
    expect(engine.isLevelCompleted()).toBe(true);
    const scoreAfterWin = engine.getTotalScore();
    expect(scoreAfterWin).toBeGreaterThan(0);

    expect(engine.canUndo()).toBe(false);
    expect(engine.undo()).toBe(false);
    expect(engine.isLevelCompleted()).toBe(true);
    expect(engine.getTotalScore()).toBe(scoreAfterWin);

    engine.loadLevel(lvl);
    expect(engine.getTotalScore()).toBe(0);
  });

  it('restores score, tick and history on undo', () => {
    const engine = new GameEngine();
    engine.loadLevel(openLevel('undo_level'));
    tickUntil(engine, 3);
    engine.attemptPlayerMove('E');
    tickUntil(engine, 10);
    engine.attemptPlayerMove('S');
    expect(engine.getTimedMoveHistory()).toEqual([
      { tick: 3, dir: 'E' },
      { tick: 10, dir: 'S' }
    ]);
    tickUntil(engine, 15);
    expect(engine.undo()).toBe(true);
    expect(engine.getTick()).toBe(10);
    expect(engine.getTimedMoveHistory()).toEqual([{ tick: 3, dir: 'E' }]);
    expect(engine.getMoveHistory()).toEqual(['E']);
  });

  it('resolves pickups on the teleport destination cell', () => {
    const lvl = openLevel('teleport_level');
    lvl.terrain[2][3] = 'teleport';
    lvl.terrain[10][10] = 'teleport';
    lvl.items[10][11] = 'chip';
    lvl.chipsRequired = 1;
    const engine = new GameEngine();
    const events: Array<[string, number, number]> = [];
    engine.setOnVisualEventCallback((kind, x, y) => events.push([kind, x, y]));
    engine.loadLevel(lvl);

    expect(engine.attemptPlayerMove('E')).toBe(true);
    expect([engine.getPlayer().x, engine.getPlayer().y]).toEqual([11, 10]);
    expect(engine.getChipsRemaining()).toBe(0);
    expect(engine.getItems()[10][11]).toBeNull();
    expect(events).toContainEqual(['chip', 11, 10]);
  });

  it('does not clone into a wall', () => {
    const build = (blocked: boolean): GameEngine => {
      const lvl = openLevel(`cloner_${blocked}`);
      lvl.terrain[2][3] = 'button_red';
      lvl.terrain[8][8] = 'clone_machine';
      if (blocked) lvl.terrain[8][9] = 'wall';
      lvl.entities = [{ x: 8, y: 8, type: 'bug', dir: 'E' }];
      lvl.cloneLinks = [
        { buttonX: 3, buttonY: 2, clonerX: 8, clonerY: 8, templateType: 'bug', templateDir: 'E' }
      ];
      const engine = new GameEngine();
      engine.loadLevel(lvl);
      engine.attemptPlayerMove('E');
      return engine;
    };

    expect(build(true).getEntities()).toHaveLength(1);
    const open = build(false).getEntities();
    expect(open).toHaveLength(2);
    expect(open[1]).toMatchObject({ x: 9, y: 8, type: 'bug' });
  });

  it('replays the same timed moves to the same state', () => {
    const lvl = randomLevel();
    const script: TimedMove[] = [
      { tick: 2, dir: 'E' },
      { tick: 9, dir: 'E' },
      { tick: 16, dir: 'E' },
      { tick: 30, dir: 'E' },
      { tick: 41, dir: 'S' }
    ];
    const first = replay(lvl, script, 120);
    const second = replay(lvl, script, 120);
    expect(snapshotState(first)).toBe(snapshotState(second));
    expect(first.getTimedMoveHistory()).toEqual(second.getTimedMoveHistory());
    const moved = first
      .getEntities()
      .filter((e, i) => e.x !== lvl.entities[i].x || e.y !== lvl.entities[i].y);
    expect(moved.length).toBeGreaterThan(0);
  });

  it('replays a history edited by undo to the live state', () => {
    const lvl = randomLevel();
    const live = new GameEngine();
    live.loadLevel(lvl);
    const play = (tick: number, dir: Direction): void => {
      tickUntil(live, tick);
      live.attemptPlayerMove(dir);
    };
    play(2, 'E');
    play(10, 'S');
    play(20, 'S');
    tickUntil(live, 33);
    expect(live.undo()).toBe(true);
    expect(live.getTick()).toBe(20);
    play(25, 'E');
    play(40, 'E');
    tickUntil(live, 90);

    const replayed = replay(lvl, live.getTimedMoveHistory(), live.getTick());
    expect(snapshotState(replayed)).toBe(snapshotState(live));
  });
});

/** Picks up the item one cell west of the start and comes back to (2, 2). */
function pickUpWest(engine: GameEngine): void {
  walk(engine, 'W', 1);
  walk(engine, 'E', 1);
}

describe('GameEngine inventory drop', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('drops a key on the player cell without picking it up again', () => {
    const lvl = openLevel('drop_level');
    lvl.items[2][1] = 'key_red';
    const engine = new GameEngine();
    engine.loadLevel(lvl);
    pickUpWest(engine);
    expect(engine.getPlayer().keys.key_red).toBe(1);
    expect(engine.getHeldItems()).toEqual(['key_red']);

    expect(engine.dropItem('key_red')).toBe(true);
    expect(engine.getItems()[2][2]).toBe('key_red');
    expect(engine.getPlayer().keys.key_red).toBeUndefined();
    expect(engine.getHeldItems()).toEqual([]);
    for (let i = 0; i < 10; i++) engine.tick();
    expect(engine.getItems()[2][2]).toBe('key_red');
    expect(engine.holdsItem('key_red')).toBe(false);

    // Leaving and re-entering the cell picks the key up again.
    walk(engine, 'E', 1);
    walk(engine, 'W', 1);
    expect(engine.getItems()[2][2]).toBeNull();
    expect(engine.getPlayer().keys.key_red).toBe(1);
  });

  it('drops boots, refuses a drop on an occupied cell and undoes a drop', () => {
    const lvl = openLevel('drop_boots_level');
    lvl.items[2][1] = 'boots_fire';
    lvl.items[2][3] = 'chip';
    const engine = new GameEngine();
    engine.loadLevel(lvl);
    pickUpWest(engine);
    expect(engine.getPlayer().boots.has('boots_fire')).toBe(true);

    expect(engine.dropItem(null)).toBe(false);
    expect(engine.dropItem('key_blue')).toBe(false);
    expect(engine.getStatusBannerKey()).toBe('hud.messages.drop_nothing');

    expect(engine.dropItem('boots_fire')).toBe(true);
    expect(engine.getItems()[2][2]).toBe('boots_fire');
    expect(engine.getPlayer().boots.size).toBe(0);
    expect(engine.undo()).toBe(true);
    expect(engine.getItems()[2][2]).toBeNull();
    expect(engine.getPlayer().boots.has('boots_fire')).toBe(true);

    // A cell already holding an item takes nothing.
    walk(engine, 'E', 1);
    expect(engine.getChipsRemaining()).toBe(0);
    lvl.items[2][3] = null;
    engine.getItems()[2][3] = 'bomb';
    expect(engine.dropItem('boots_fire')).toBe(false);
    expect(engine.getStatusBannerKey()).toBe('hud.messages.drop_cell_occupied');
    expect(engine.getPlayer().boots.has('boots_fire')).toBe(true);
  });

  it('replays a drop from the timed history', () => {
    const lvl = openLevel('drop_replay_level');
    lvl.items[2][1] = 'key_yellow';
    const live = new GameEngine();
    live.loadLevel(lvl);
    pickUpWest(live);
    tickUntil(live, 30);
    expect(live.dropItem('key_yellow')).toBe(true);
    walk(live, 'E', 2);
    tickUntil(live, 60);
    expect(live.getTimedMoveHistory().some((m) => m.drop === 'key_yellow')).toBe(true);

    const replayed = replay(lvl, live.getTimedMoveHistory(), live.getTick());
    expect(snapshotState(replayed)).toBe(snapshotState(live));
    expect(replayed.getItems()[2][2]).toBe('key_yellow');
  });
});

describe('GameEngine forbidden-item barriers', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('blocks the holder of the item and lets them through once it is dropped', () => {
    const lvl = openLevel('forbid_level');
    lvl.items[2][1] = 'key_red';
    lvl.terrain[2][3] = 'forbid_key_red';
    const engine = new GameEngine();
    engine.loadLevel(lvl);
    // Without the key the barrier is plain floor.
    walk(engine, 'E', 1);
    expect(engine.getPlayer().x).toBe(3);
    walk(engine, 'W', 1);

    pickUpWest(engine);
    expect(isBlocked(engine, 'E')).toBe(true);
    expect(engine.getPlayer().x).toBe(2);
    expect(engine.getStatusBannerKey()).toBe('hud.messages.forbidden_item');

    expect(engine.dropItem('key_red')).toBe(true);
    walk(engine, 'E', 1);
    expect(engine.getPlayer().x).toBe(3);
    expect(engine.getItems()[2][2]).toBe('key_red');
  });

  it('blocks boots as well as keys', () => {
    const lvl = openLevel('forbid_boots_level');
    lvl.items[2][1] = 'boots_ice';
    lvl.terrain[2][3] = 'forbid_boots_ice';
    const engine = new GameEngine();
    engine.loadLevel(lvl);
    pickUpWest(engine);
    expect(isBlocked(engine, 'E')).toBe(true);
    expect(engine.dropItem('boots_ice')).toBe(true);
    expect(isBlocked(engine, 'E')).toBe(false);
  });
});

describe('GameEngine key thief', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('empties the keys and leaves the boots', () => {
    const lvl = openLevel('thief_keys_level');
    lvl.items[2][3] = 'key_red';
    lvl.items[2][4] = 'key_blue';
    lvl.items[2][5] = 'boots_water';
    lvl.terrain[2][6] = 'thief_keys';
    const engine = new GameEngine();
    engine.loadLevel(lvl);
    walk(engine, 'E', 3);
    expect(engine.getPlayer().keys).toEqual({ key_red: 1, key_blue: 1 });
    walk(engine, 'E', 1);
    expect(engine.getPlayer().keys).toEqual({});
    expect(engine.getPlayer().boots.has('boots_water')).toBe(true);
    expect(engine.getStatusBannerKey()).toBe('hud.messages.thief_stole_keys');
  });
});

describe('GameEngine transform on leave', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('turns a turtle into water once the player has left it', () => {
    const lvl = openLevel('turtle_level');
    lvl.terrain[2][3] = 'turtle';
    const engine = new GameEngine();
    engine.loadLevel(lvl);
    walk(engine, 'E', 1);
    expect(engine.getPlayer().alive).toBe(true);
    expect(engine.getTerrain()[2][3]).toBe('turtle');
    walk(engine, 'E', 1);
    expect(engine.getTerrain()[2][3]).toBe('water');
    expect(engine.getPlayer().alive).toBe(true);
    // Coming back without flippers now drowns the player.
    walk(engine, 'W', 1);
    expect(engine.getPlayer().alive).toBe(false);
  });

  it('turns a turtle into water once a block has been pushed off it', () => {
    const lvl = openLevel('turtle_block_level');
    lvl.items[2][1] = 'boots_water';
    lvl.terrain[2][3] = 'turtle';
    lvl.entities = [{ x: 3, y: 2, type: 'dirt_block', dir: 'E' }];
    const engine = new GameEngine();
    engine.loadLevel(lvl);
    pickUpWest(engine);
    walk(engine, 'E', 1);
    expect(engine.getEntities()[0]).toMatchObject({ x: 4, y: 2 });
    expect(engine.getTerrain()[2][3]).toBe('water');
    expect(engine.getPlayer()).toMatchObject({ x: 3, y: 2, alive: true });
  });
});

describe('GameEngine thin wall combinations', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('blocks every edge of a four-sided panel and the two of a north-south one', () => {
    const lvl = openLevel('thin_walls_level');
    lvl.terrain[2][3] = 'thin_wall_nesw';
    lvl.terrain[5][2] = 'thin_wall_ns';
    const engine = new GameEngine();
    engine.loadLevel(lvl);
    expect(isBlocked(engine, 'E')).toBe(true);
    walk(engine, 'S', 1);
    walk(engine, 'E', 1);
    expect(isBlocked(engine, 'N')).toBe(true);
    walk(engine, 'W', 1);

    // The north-south panel at (2, 5) is entered from the west and blocks north and south.
    walk(engine, 'S', 1);
    expect(isBlocked(engine, 'S')).toBe(true);
    walk(engine, 'W', 1);
    walk(engine, 'S', 1);
    walk(engine, 'E', 1);
    expect(engine.getPlayer()).toMatchObject({ x: 2, y: 5 });
    expect(isBlocked(engine, 'N')).toBe(true);
    expect(isBlocked(engine, 'S')).toBe(true);
    expect(isBlocked(engine, 'E')).toBe(false);
  });
});

describe('GameEngine colour teleporters', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('chains only between teleporters of the same group', () => {
    const lvl = openLevel('teleport_groups_level');
    lvl.terrain[2][3] = 'teleport_red';
    lvl.terrain[6][6] = 'teleport_blue';
    lvl.terrain[10][10] = 'teleport_red';
    const engine = new GameEngine();
    engine.loadLevel(lvl);
    walk(engine, 'E', 1);
    expect([engine.getPlayer().x, engine.getPlayer().y]).toEqual([11, 10]);
  });

  it('leaves a lone grouped teleporter inert even next to other colours', () => {
    const lvl = openLevel('teleport_lone_level');
    lvl.terrain[2][3] = 'teleport_green';
    lvl.terrain[6][6] = 'teleport_blue';
    lvl.terrain[8][8] = 'teleport';
    const engine = new GameEngine();
    engine.loadLevel(lvl);
    walk(engine, 'E', 1);
    expect([engine.getPlayer().x, engine.getPlayer().y]).toEqual([3, 2]);
  });
});

describe('GameEngine flame jets', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('toggles every flame jet on the orange button and burns the unprotected player', () => {
    const lvl = openLevel('flames_level');
    lvl.terrain[2][3] = 'button_orange';
    lvl.terrain[2][5] = 'flame_jet_off';
    lvl.terrain[8][8] = 'flame_jet_on';
    const engine = new GameEngine();
    engine.loadLevel(lvl);
    walk(engine, 'E', 1);
    expect(engine.getTerrain()[2][5]).toBe('flame_jet_on');
    expect(engine.getTerrain()[8][8]).toBe('flame_jet_off');
    walk(engine, 'W', 1);
    walk(engine, 'E', 1);
    expect(engine.getTerrain()[2][5]).toBe('flame_jet_off');
    expect(engine.getTerrain()[8][8]).toBe('flame_jet_on');

    walk(engine, 'E', 2);
    expect(engine.getPlayer()).toMatchObject({ x: 5, y: 2, alive: true });
    walk(engine, 'E', 3);
    walk(engine, 'S', 6);
    expect(engine.getPlayer().alive).toBe(false);
    expect(engine.getPlayer().deathReasonKey).toBe('hud.messages.death_fire');
  });

  it('lets fire boots cross a lit jet', () => {
    const lvl = openLevel('flames_boots_level');
    lvl.items[2][1] = 'boots_fire';
    lvl.terrain[2][3] = 'flame_jet_on';
    const engine = new GameEngine();
    engine.loadLevel(lvl);
    pickUpWest(engine);
    walk(engine, 'E', 1);
    expect(engine.getPlayer().alive).toBe(true);
  });
});

describe('GameEngine bonus items', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('adds points, moves the time left and multiplies the level score at the exit', () => {
    const lvl = openLevel('bonus_level');
    lvl.timeLimitSeconds = 100;
    lvl.items[2][3] = 'score_100';
    lvl.items[2][4] = 'stopwatch_bonus';
    lvl.items[2][5] = 'stopwatch_penalty';
    lvl.items[2][6] = 'score_2x';
    lvl.terrain[2][7] = 'exit';
    const engine = new GameEngine();
    engine.loadLevel(lvl);

    walk(engine, 'E', 1);
    expect(engine.getTotalScore()).toBe(100);
    expect(engine.getStatusBannerKey()).toBe('hud.messages.score_bonus_picked');
    walk(engine, 'E', 1);
    expect(engine.getExtraTimeSeconds()).toBe(10);
    expect(engine.getTimeRemainingSeconds()).toBe(110);
    walk(engine, 'E', 1);
    expect(engine.getExtraTimeSeconds()).toBe(0);
    expect(engine.getTimeRemainingSeconds()).toBe(100);
    expect(engine.getStatusBannerKey()).toBe('hud.messages.time_penalty_picked');
    walk(engine, 'E', 1);
    expect(engine.getLevelScoreMultiplier()).toBe(2);

    walk(engine, 'E', 1);
    expect(engine.isLevelCompleted()).toBe(true);
    const timing = ConfigRegistry.getGame().timing;
    const expectedLevelScore = (timing.levelBasePoints * lvl.number + engine.getLastTimeBonus()) * 2;
    expect(engine.getLastLevelScore()).toBe(expectedLevelScore);
    expect(engine.getTotalScore()).toBe(100 + expectedLevelScore);
  });

  it('keeps an untimed level untimed and rolls a bonus back on undo', () => {
    const lvl = openLevel('bonus_untimed_level');
    lvl.items[2][3] = 'stopwatch_bonus';
    lvl.items[2][4] = 'score_1000';
    const engine = new GameEngine();
    engine.loadLevel(lvl);
    walk(engine, 'E', 1);
    expect(engine.getExtraTimeSeconds()).toBe(0);
    walk(engine, 'E', 1);
    expect(engine.getTotalScore()).toBe(1000);
    expect(engine.undo()).toBe(true);
    expect(engine.getTotalScore()).toBe(0);
    expect(engine.getItems()[2][4]).toBe('score_1000');
  });
});
