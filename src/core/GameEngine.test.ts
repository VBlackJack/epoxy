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
      engine.attemptPlayerMove(moves[i].dir);
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
