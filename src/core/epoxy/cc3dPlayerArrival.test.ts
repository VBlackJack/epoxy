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

import { buildTestLevel } from '../../test/buildTestLevel';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { CONVERTED_ID_SUFFIX } from '../cc3d/cc3dConstants';
import { GameEngine } from '../GameEngine';
import type { CompiledLevel, EntityPlacement, PlayerState } from '../types';

/**
 * The player side of a CC3D level converted to Epoxy: CC3D acts on arrival, which is the end of the step. A player who
 * walks into a monster dies where he stands, a clone switch is pressed and a chip taken when the step ends, and a
 * teleporter jumps the player when the step ends and sends him out by a fast step of his own. Native levels are unchanged.
 */

beforeEach(() => {
  loadTestConfigs();
});

type Flavor = 'native' | 'converted';

const ROW = 2;
/** Ticks a plain walking step lasts (timing.playerMoveCooldownTicks). */
const WALK_TICKS = 4;
const PAD_A_X = 3;
const PAD_B_X = 9;

interface WorldView {
  player: PlayerState;
  parked: PlayerState[];
  ccArrivals: unknown[];
  entities: Array<{ x: number; y: number }>;
}

function load(level: CompiledLevel, flavor: Flavor): { engine: GameEngine; w: WorldView } {
  const engine = new GameEngine();
  engine.loadLevel(flavor === 'converted' ? { ...level, id: `lane${CONVERTED_ID_SUFFIX}` } : level);
  return { engine, w: (engine as unknown as { w: WorldView }).w };
}

function lane(rows: string[], flavor: Flavor, extra: Parameters<typeof buildTestLevel>[1] = {}): { engine: GameEngine; w: WorldView } {
  return load(buildTestLevel(rows, extra), flavor);
}

function tick(engine: GameEngine, n: number): void {
  for (let i = 0; i < n; i++) engine.tick();
}

describe('a player who walks into a monster', () => {
  const ROWS = ['##########', '#........#', '#.@......#', '#........#', '##########'];
  const MONSTER: EntityPlacement = { type: 'bouncer', x: 3, y: ROW, dir: 'W' };

  it('dies where he stands on a converted level', () => {
    const { engine, w } = lane(ROWS, 'converted', { entities: [MONSTER] });
    engine.attemptPlayerMove('E');
    expect(w.player.alive).toBe(false);
    expect(w.player.x).toBe(2);
    expect(w.player.y).toBe(ROW);
  });

  it('enters the monster cell on a native level', () => {
    const { engine, w } = lane(ROWS, 'native', { entities: [MONSTER] });
    engine.attemptPlayerMove('E');
    expect(w.player.alive).toBe(false);
    expect(w.player.x).toBe(3);
  });
});

describe('a chip under the step', () => {
  const ROWS = ['##########', '#........#', '#.@C.....#', '#........#', '##########'];

  it('is taken when the step ends on a converted level', () => {
    const { engine, w } = lane(ROWS, 'converted', { chipsRequired: 1 });
    expect(engine.attemptPlayerMove('E')).toBe(true);
    expect(engine.getChipsRemaining()).toBe(1);
    expect(engine.getItems()[ROW][PAD_A_X]).toBe('chip');
    expect(w.player.cc3dArrival?.chip).toEqual({ x: PAD_A_X, y: ROW });
    tick(engine, WALK_TICKS - 1);
    expect(engine.getChipsRemaining()).toBe(1);
    engine.tick();
    expect(engine.getChipsRemaining()).toBe(0);
    expect(engine.getItems()[ROW][PAD_A_X]).toBeNull();
    expect(w.player.cc3dArrival).toBeUndefined();
  });

  it('is taken at once on a native level', () => {
    const { engine, w } = lane(ROWS, 'native', { chipsRequired: 1 });
    engine.attemptPlayerMove('E');
    expect(engine.getChipsRemaining()).toBe(0);
    expect(w.player.cc3dArrival).toBeUndefined();
  });

  it('stays on the floor when the step killed the player', () => {
    const level = buildTestLevel(ROWS, { chipsRequired: 1 });
    const terrain = level.terrain.map((r) => [...r]);
    terrain[ROW][PAD_A_X] = 'fire';
    const { engine, w } = load({ ...level, terrain }, 'converted');
    engine.attemptPlayerMove('E');
    expect(w.player.alive).toBe(false);
    tick(engine, WALK_TICKS + 1);
    expect(engine.getChipsRemaining()).toBe(1);
    expect(engine.getItems()[ROW][PAD_A_X]).toBe('chip');
  });

  it('is given back by an undo made while the step is under way', () => {
    const { engine, w } = lane(ROWS, 'converted', { chipsRequired: 1 });
    engine.attemptPlayerMove('E');
    tick(engine, 2);
    expect(engine.undo()).toBe(true);
    expect(w.player.cc3dArrival).toBeUndefined();
    expect(w.player.x).toBe(2);
    tick(engine, WALK_TICKS + 2);
    expect(engine.getChipsRemaining()).toBe(1);
    expect(engine.getItems()[ROW][PAD_A_X]).toBe('chip');
  });

  it('is still taken on time from a state captured while the step is under way', () => {
    const { engine, w } = lane(ROWS, 'converted', { chipsRequired: 1 });
    engine.attemptPlayerMove('E');
    tick(engine, 2);
    const snapshot = engine.captureState();
    tick(engine, WALK_TICKS);
    expect(engine.getChipsRemaining()).toBe(0);
    engine.restoreState(snapshot);
    expect(engine.getChipsRemaining()).toBe(1);
    expect(w.player.cc3dArrival?.chip).toEqual({ x: PAD_A_X, y: ROW });
    tick(engine, 1);
    expect(engine.getChipsRemaining()).toBe(1);
    tick(engine, 1);
    expect(engine.getChipsRemaining()).toBe(0);
  });
});

describe('a step whose effect is still waiting', () => {
  const ROWS = ['############', '#..........#', '#.@>>>>....#', '#..........#', '############'];

  function onForce(): { engine: GameEngine; w: WorldView } {
    const level = buildTestLevel(ROWS, { chipsRequired: 2 });
    const items = level.items.map((r) => [...r]);
    items[ROW][3] = 'chip';
    items[ROW][4] = 'chip';
    return load({ ...level, items }, 'converted');
  }

  it('bars the input until the chip is taken, and takes it at the end of the step', () => {
    const { engine, w } = onForce();
    expect(engine.attemptPlayerMove('E')).toBe(true);
    let barred = 0;
    for (let t = 0; t < 12 && w.player.cc3dArrival !== undefined; t++) {
      engine.tick();
      if (w.player.cc3dArrival !== undefined) {
        expect(engine.attemptPlayerMove('N')).toBe(false);
        barred++;
      }
    }
    expect(w.player.cc3dArrival).toBeUndefined();
    expect(barred).toBeGreaterThan(0);
  });

  it('takes the chip of the recorded cell, not the one of the cell the player has been carried to', () => {
    const { engine, w } = onForce();
    engine.attemptPlayerMove('E');
    for (let t = 0; t < 12 && w.player.cc3dArrival !== undefined; t++) engine.tick();
    expect(engine.getItems()[ROW][3]).toBeNull();
    expect(engine.getChipsRemaining()).toBe(1);
    expect(engine.getItems()[ROW][4]).toBe('chip');
  });

  it('never leaves a step waiting for good: the player can move again soon after', () => {
    const { engine, w } = onForce();
    engine.attemptPlayerMove('E');
    tick(engine, 40);
    expect(w.player.cc3dArrival).toBeUndefined();
  });
});

describe('a step into a monster', () => {
  it('is not counted as a step', () => {
    const rows = ['##########', '#........#', '#.@......#', '#........#', '##########'];
    const { engine } = lane(rows, 'converted', { entities: [{ type: 'bouncer', x: 3, y: ROW, dir: 'W' }] });
    engine.attemptPlayerMove('E');
    expect(engine.getStepsCount()).toBe(0);
  });
});

describe('a clone switch under the step', () => {
  const ROWS = ['##########', '#........#', '#.@+.M...#', '#........#', '##########'];
  const TEMPLATE: EntityPlacement = { type: 'bouncer', x: 5, y: ROW, dir: 'E' };
  const LINKS: NonNullable<CompiledLevel['cloneLinks']> = [{ buttonX: 3, buttonY: ROW, clonerX: 5, clonerY: ROW, templateType: 'bouncer', templateDir: 'E' }];

  function press(flavor: Flavor): { engine: GameEngine; w: WorldView } {
    const level = { ...buildTestLevel(ROWS, { entities: [TEMPLATE] }), cloneLinks: LINKS };
    return load(level, flavor);
  }

  it('is pressed when the step ends on a converted level', () => {
    const { engine, w } = press('converted');
    const before = w.entities.length;
    expect(engine.attemptPlayerMove('E')).toBe(true);
    expect(w.entities.length).toBe(before);
    expect(w.player.cc3dArrival?.press).toEqual({ x: 3, y: ROW });
    tick(engine, WALK_TICKS - 1);
    expect(w.entities.length).toBe(before);
    engine.tick();
    expect(w.entities.length).toBe(before + 1);
    expect(w.player.cc3dArrival).toBeUndefined();
  });

  it('is pressed at once on a native level', () => {
    const { engine, w } = press('native');
    const before = w.entities.length;
    engine.attemptPlayerMove('E');
    expect(w.entities.length).toBe(before + 1);
  });

  it('is not pressed when an undo takes the step back', () => {
    const { engine, w } = press('converted');
    const before = w.entities.length;
    engine.attemptPlayerMove('E');
    tick(engine, 1);
    expect(engine.undo()).toBe(true);
    tick(engine, WALK_TICKS + 2);
    expect(w.entities.length).toBe(before);
  });
});

describe('a teleporter under the step', () => {
  const ROWS = ['###############', '#.............#', '#.@...........#', '#.............#', '###############'];

  function pads(flavor: Flavor, exitBlocked = false): { engine: GameEngine; w: WorldView } {
    const level = buildTestLevel(ROWS);
    const terrain = level.terrain.map((r) => [...r]);
    terrain[ROW][PAD_A_X] = flavor === 'converted' ? 'teleport_forward' : 'teleport';
    terrain[ROW][PAD_B_X] = flavor === 'converted' ? 'teleport_forward' : 'teleport';
    if (exitBlocked) terrain[ROW][PAD_B_X + 1] = 'wall';
    return load({ ...level, terrain }, flavor);
  }

  it('jumps the player when the step ends, then sends him out by a fast step of his own', () => {
    const { engine, w } = pads('converted');
    expect(engine.attemptPlayerMove('E')).toBe(true);
    expect(w.player.x).toBe(PAD_A_X);
    tick(engine, WALK_TICKS - 1);
    expect(w.player.x).toBe(PAD_A_X);
    engine.tick();
    // The jump: he stands on the pad he landed on and leaves by his own step on the next tick.
    expect(w.player.x).toBe(PAD_B_X);
    expect(w.player.teleportExit).toBe('E');
    engine.tick();
    expect(w.player.x).toBe(PAD_B_X + 1);
    expect(w.player.teleportExit).toBeUndefined();
    // The exit step lasts two ticks from its start: the player is free again for the input of the tick after.
    expect(engine.attemptPlayerMove('E')).toBe(false);
    engine.tick();
    expect(engine.attemptPlayerMove('E')).toBe(true);
  });

  it('jumps the player at once on a native level', () => {
    const { engine, w } = pads('native');
    engine.attemptPlayerMove('E');
    expect(w.player.x).not.toBe(PAD_A_X);
    expect(w.player.cc3dArrival).toBeUndefined();
  });

  it('leaves the player on the pad when the exit of the other pad is blocked', () => {
    const { engine, w } = pads('converted', true);
    engine.attemptPlayerMove('E');
    tick(engine, WALK_TICKS + 3);
    expect(w.player.x).toBe(PAD_A_X);
    expect(w.player.teleportExit).toBeUndefined();
    expect(engine.attemptPlayerMove('E')).toBe(true);
  });

  it('takes the chip of the pad he lands on', () => {
    const level = buildTestLevel(ROWS, { chipsRequired: 1 });
    const terrain = level.terrain.map((r) => [...r]);
    terrain[ROW][PAD_A_X] = 'teleport_forward';
    terrain[ROW][PAD_B_X] = 'teleport_forward';
    const items = level.items.map((r) => [...r]);
    items[ROW][PAD_B_X] = 'chip';
    const { engine } = load({ ...level, terrain, items }, 'converted');
    engine.attemptPlayerMove('E');
    tick(engine, WALK_TICKS - 1);
    expect(engine.getChipsRemaining()).toBe(1);
    engine.tick();
    expect(engine.getChipsRemaining()).toBe(0);
    expect(engine.getItems()[ROW][PAD_B_X]).toBeNull();
  });

  it('is not carried out by an undo made while the step is under way', () => {
    const { engine, w } = pads('converted');
    engine.attemptPlayerMove('E');
    tick(engine, 2);
    expect(engine.undo()).toBe(true);
    tick(engine, WALK_TICKS + 3);
    expect(w.player.x).toBe(2);
    expect(w.player.cc3dArrival).toBeUndefined();
  });

  it('keeps the jump through a captured state', () => {
    const { engine, w } = pads('converted');
    engine.attemptPlayerMove('E');
    tick(engine, 2);
    const snapshot = engine.captureState();
    tick(engine, WALK_TICKS);
    engine.restoreState(snapshot);
    expect(w.player.cc3dArrival?.teleport).toEqual({ x: PAD_A_X, y: ROW, dir: 'E' });
    tick(engine, 2);
    expect(w.player.x).toBe(PAD_B_X);
  });
});

describe('with two players', () => {
  const ROWS = ['##########', '#........#', '#.@C.....#', '#........#', '##########'];

  function twoPlayers(): { engine: GameEngine; w: WorldView } {
    const level = buildTestLevel(ROWS, { chipsRequired: 1 });
    return load({ ...level, extraPlayers: [{ x: 7, y: 3, dir: 'E', character: 'melinda' }] }, 'converted');
  }

  it('lets the player who stepped on the chip take it when his own step ends, even once control has passed', () => {
    const { engine, w } = twoPlayers();
    const first = w.player;
    expect(engine.attemptPlayerMove('E')).toBe(true);
    expect(engine.swapPlayer()).toBe(true);
    expect(w.player).not.toBe(first);
    expect(first.cc3dArrival?.chip).toEqual({ x: PAD_A_X, y: ROW });
    expect(w.player.cc3dArrival).toBeUndefined();
    tick(engine, WALK_TICKS - 1);
    expect(engine.getChipsRemaining()).toBe(1);
    engine.tick();
    expect(engine.getChipsRemaining()).toBe(0);
    expect(first.cc3dArrival).toBeUndefined();
  });

  it('tells the states apart in the search key while a step is under way', () => {
    const { engine } = twoPlayers();
    const idle = engine.getRuntimeKeyExtra();
    engine.attemptPlayerMove('E');
    expect(engine.getRuntimeKeyExtra()).not.toBe(idle);
  });

  it('puts a pending chip back with a captured state of a level with two players', () => {
    const { engine, w } = twoPlayers();
    engine.attemptPlayerMove('E');
    engine.swapPlayer();
    const snapshot = engine.captureState();
    tick(engine, WALK_TICKS);
    expect(engine.getChipsRemaining()).toBe(0);
    engine.restoreState(snapshot);
    expect(engine.getChipsRemaining()).toBe(1);
    expect(w.parked[0].cc3dArrival?.chip).toEqual({ x: PAD_A_X, y: ROW });
    tick(engine, WALK_TICKS);
    expect(engine.getChipsRemaining()).toBe(0);
  });
});
