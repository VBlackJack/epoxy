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

/**
 * CC2 wave 12, WDP and W0M: a level with parked players has no actor order, yet its wire phase before the decisions is the one of
 * the other levels (Lexy game.js:869-888): a press made at a step end fires its directly wired clone machine before the pass
 * (WDP), and tic 0 settles the wires and fires what rose with the press frame forced to 0 (W0M, game.js:872-876).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

const fired = vi.hoisted(() => ({ calls: [] as { x: number; y: number; frame: number | undefined; beforePass: boolean | undefined; tick: number }[], tick: 0 }));

vi.mock('./epoxyDevices', async (importOriginal) => {
  const original = await importOriginal<typeof import('./epoxyDevices')>();
  return {
    ...original,
    fireClonerAt: (ctx: import('./epoxyWorld').EpoxyContext, x: number, y: number): boolean => {
      fired.calls.push({ x, y, frame: ctx.world.cc2ReleaseFrame, beforePass: ctx.world.cc2BeforePass, tick: fired.tick });
      return original.fireClonerAt(ctx, x, y);
    }
  };
});

import { buildTestLevel } from '../../test/buildTestLevel';
import { playMove } from '../../test/cc2Play';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { GameEngine } from '../GameEngine';
import type { Cc2LevelData, CompiledLevel, Direction } from '../types';
import type { EpoxyWorld } from './epoxyWorld';

beforeEach(() => {
  loadTestConfigs();
  fired.calls.length = 0;
  fired.tick = 0;
});

const CC2_RECORD = { v: 1, sha256: 'ab'.repeat(32), file: 'one.c2m', order: 1, gridHash: 'x' } as Cc2LevelData;
const ROW = 1;
const PLATE_X = 2;
const CLONER_X = 5;
const OTHER_X = 7;
const PLATE = 'signal_plate';
const CLONE_MACHINE = 'clone_machine';
const BLOCK = 'dirt_block';
const EMPTY_ROWS = ['#########', '#@......#', '#########'];
const MAX_TICKS = 60;
/** The press frame forced at tic 0 (game.js:872-876). */
const LOAD_PRESS_FRAME = 0;

type Mode = 'cc2' | 'native';

const worldOf = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;

/** A plate wired straight to a clone machine, with a second player parked at the far end of the row. */
function twoPlayerLane(mode: Mode, holdPlate: boolean = false): CompiledLevel {
  const entities = [{ type: BLOCK, x: CLONER_X, y: ROW, dir: 'E' as Direction }];
  if (holdPlate) entities.push({ type: BLOCK, x: PLATE_X, y: ROW, dir: 'E' as Direction });
  const built = buildTestLevel(EMPTY_ROWS, { entities });
  built.terrain[ROW][PLATE_X] = PLATE;
  built.terrain[ROW][CLONER_X] = CLONE_MACHINE;
  const wired: CompiledLevel = {
    ...built,
    signalLinks: [{ fromX: PLATE_X, fromY: ROW, toX: CLONER_X, toY: ROW }],
    extraPlayers: [{ x: OTHER_X, y: ROW, dir: 'W' as Direction, character: 'chip' }]
  };
  return mode === 'cc2' ? { ...wired, cc2: CC2_RECORD } : wired;
}

function load(mode: Mode, holdPlate: boolean = false): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(twoPlayerLane(mode, holdPlate), 1);
  return engine;
}

const deferCloner = (engine: GameEngine): void => {
  const w = worldOf(engine);
  w.cc2DeferredSinkEdges = [{ cell: ROW * w.terrain[0].length + CLONER_X, rising: true }];
};

describe('WDP: a multi-player CC2 level fires the press of a step end before the pass', () => {
  it('has no actor order, so the branch that used to fire it is not taken', () => {
    expect(load('cc2').playsInActorOrder()).toBe(false);
  });

  it('fires a deferred clone machine edge before the decisions of the first tick after tic 0', () => {
    const engine = load('cc2');
    engine.tick();
    fired.calls.length = 0;
    deferCloner(engine);
    engine.tick();
    expect(fired.calls).toHaveLength(1);
    expect(fired.calls[0]).toMatchObject({ x: CLONER_X, y: ROW, beforePass: true });
    expect(worldOf(engine).cc2DeferredSinkEdges).toEqual([]);
  });

  it('fires the clone let out by the step of the controlled player before a pass', () => {
    const engine = load('cc2');
    expect(playMove(engine, 'E').accepted).toBe(true);
    let guard = 0;
    while (fired.calls.length === 0 && guard++ < MAX_TICKS) engine.tick();
    expect(fired.calls.some((call) => call.x === CLONER_X && call.beforePass === true)).toBe(true);
  });

  it('fires the clone machine of a player press in the tick after the step end, not at the end of that tick', () => {
    const engine = load('cc2');
    const w = worldOf(engine);
    let stepEnded: number | undefined;
    engine.attemptPlayerMove('E');
    for (let guard = 0; guard < MAX_TICKS && fired.calls.length === 0; guard++) {
      fired.tick++;
      engine.tick();
      const onPlate = w.player.x === PLATE_X && w.player.y === ROW && w.player.moveCooldown === 0;
      if (stepEnded === undefined && onPlate) stepEnded = fired.tick;
      if (!onPlate && stepEnded === undefined) engine.attemptPlayerMove('E');
    }
    expect(stepEnded).toBeDefined();
    expect(fired.calls).toHaveLength(1);
    // Lexy fires the wired machine at the start of the next tic (game.js:869-888); the base code fired it at the end of the step-end tick.
    expect(fired.calls[0].beforePass).toBe(true);
    expect(fired.calls[0].tick).toBe((stepEnded as number) + 1);
    expect(fired.calls[0].tick).not.toBe(stepEnded);
  });

  it('keeps the end-of-tick firing on a level that is not CC2', () => {
    const engine = load('native');
    engine.tick();
    fired.calls.length = 0;
    deferCloner(engine);
    engine.tick();
    expect(fired.calls.every((call) => call.beforePass !== true)).toBe(true);
  });
});

describe('W0M: tic 0 of a multi-player CC2 level has the wire phase of the other levels', () => {
  it('fires the clone machine of a plate held at the load with the press frame forced to 0, before the pass', () => {
    const engine = load('cc2', true);
    engine.tick();
    expect(fired.calls[0]).toMatchObject({ x: CLONER_X, y: ROW, frame: LOAD_PRESS_FRAME, beforePass: true });
  });

  it('does not run on a level that is not CC2', () => {
    const engine = load('native', true);
    engine.tick();
    expect(fired.calls.every((call) => call.beforePass !== true)).toBe(true);
  });
});
