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
 * CC2 wave 11, signals: fireSinksBeforePass fires the edges of the clone machines wired straight to a button before the entity
 * pass, each with the frame of its press (Lexy game.js:872-876 for tic 0, game.js:2218-2242 for the frames), and leaves the edges of
 * a sink fed by a gate deferred; an orange button reads an actor at rest (tiletypes.js:2332-2341, game.js:2350-2357).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

const fired = vi.hoisted(() => ({ calls: [] as { x: number; y: number; frame: number | undefined; beforePass: boolean | undefined }[] }));

vi.mock('./epoxyDevices', async (importOriginal) => {
  const original = await importOriginal<typeof import('./epoxyDevices')>();
  return {
    ...original,
    fireClonerAt: (ctx: import('./epoxyWorld').EpoxyContext, x: number, y: number, ...rest: [boolean?]): boolean => {
      fired.calls.push({ x, y, frame: ctx.world.cc2ReleaseFrame, beforePass: ctx.world.cc2BeforePass });
      return original.fireClonerAt(ctx, x, y, ...rest);
    }
  };
});

import { playMove } from '../../test/cc2Play';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { buildTestLevel } from '../../test/buildTestLevel';
import { GameEngine } from '../GameEngine';
import type { Cc2LevelData, CompiledLevel, Direction, SignalLink } from '../types';
import { fireSinksBeforePass } from './epoxySignals';
import type { EpoxyContext, EpoxyWorld } from './epoxyWorld';

beforeEach(() => {
  loadTestConfigs();
  fired.calls.length = 0;
});

const CC2_RECORD = { v: 1, sha256: 'ab'.repeat(32), file: 'one.c2m', order: 1, gridHash: 'x' } as Cc2LevelData;
const ROW = 1;
const SOURCE_X = 2;
const GATE_X = 3;
const CLONER_X = 5;
const JET_X = 5;
const PLATE = 'signal_plate';
const ORANGE = 'button_orange_cc2';
const GATE = 'signal_gate_and_cc2';
const CLONE_MACHINE = 'clone_machine';
const JET_OFF = 'flame_jet_cc2_off';
const JET_ON = 'flame_jet_cc2_on';
const BLOCK = 'dirt_block';
const EMPTY_ROWS = ['#########', '#@......#', '#########'];
const STEP_TICKS = 30;

type Mode = 'cc2' | 'native';

const ctxOf = (engine: GameEngine): EpoxyContext => (engine as unknown as { ctx: EpoxyContext }).ctx;
const worldOf = (engine: GameEngine): EpoxyWorld => ctxOf(engine).world;

/** A plate held by a block, wired to a clone machine, directly or through a gate. */
function cloneLane(gated: boolean, cc2: boolean = true): CompiledLevel {
  const template = { type: BLOCK, x: CLONER_X, y: ROW, dir: 'E' as Direction };
  const built = buildTestLevel(EMPTY_ROWS, { entities: [template, { type: BLOCK, x: SOURCE_X, y: ROW, dir: 'E' as Direction }] });
  built.terrain[ROW][SOURCE_X] = PLATE;
  built.terrain[ROW][CLONER_X] = CLONE_MACHINE;
  const links: SignalLink[] = gated
    ? [
        { fromX: SOURCE_X, fromY: ROW, toX: GATE_X, toY: ROW, port: 'in0' },
        { fromX: GATE_X, fromY: ROW, toX: CLONER_X, toY: ROW }
      ]
    : [{ fromX: SOURCE_X, fromY: ROW, toX: CLONER_X, toY: ROW }];
  if (gated) built.terrain[ROW][GATE_X] = GATE;
  const wired: CompiledLevel = { ...built, signalLinks: links };
  return cc2 ? { ...wired, cc2: CC2_RECORD } : wired;
}

/** The engine with one rising edge of the clone machine waiting, as the settle that ended the last tick left it. */
function withDeferredEdge(gated: boolean, cc2: boolean = true): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(cloneLane(gated, cc2), 1);
  const w = worldOf(engine);
  w.cc2DeferredSinkEdges = [{ cell: ROW * w.terrain[0].length + CLONER_X, rising: true }];
  return engine;
}

describe('fireSinksBeforePass', () => {
  it('fires a button-fed clone machine edge with the frame of its press, before the pass', () => {
    const engine = withDeferredEdge(false);
    fireSinksBeforePass(ctxOf(engine));
    expect(fired.calls).toEqual([{ x: CLONER_X, y: ROW, frame: 1, beforePass: true }]);
    expect(worldOf(engine).cc2DeferredSinkEdges).toEqual([]);
    expect(worldOf(engine).cc2ReleaseFrame).toBeUndefined();
    expect(worldOf(engine).cc2BeforePass).toBeUndefined();
  });

  // Fails without the byWire argument of epoxySignals (fireClonerAt(ctx, x, y, true)): the release then tries the template way only, east, walled.
  it('a wire edge on a cloner whose template way is walled releases clockwise (tiletypes.js:1716-1742)', () => {
    const engine = withDeferredEdge(false);
    const w = worldOf(engine);
    w.terrain[ROW][CLONER_X + 1] = 'wall';
    fireSinksBeforePass(ctxOf(engine));
    expect(w.entities.some((e) => e.type === BLOCK && e.x === CLONER_X - 1 && e.y === ROW)).toBe(true);
    expect(w.entities.some((e) => e.type === BLOCK && e.x === CLONER_X && e.y === ROW)).toBe(true);
  });

  it('takes the frame of the clone that holds the button down', () => {
    const engine = withDeferredEdge(false);
    const holder = worldOf(engine).entities.find((e) => e.x === SOURCE_X && e.y === ROW);
    expect(holder).toBeDefined();
    (holder as { cc2Frame?: 0 | 2 }).cc2Frame = 2;
    fireSinksBeforePass(ctxOf(engine));
    expect(fired.calls.map((call) => call.frame)).toEqual([2]);
  });

  it('uses the forced frame when one is given (tic 0)', () => {
    const engine = withDeferredEdge(false);
    fireSinksBeforePass(ctxOf(engine), 0);
    expect(fired.calls.map((call) => call.frame)).toEqual([0]);
  });

  it('leaves the edge of a gate-fed clone machine deferred', () => {
    const engine = withDeferredEdge(true);
    const before = worldOf(engine).cc2DeferredSinkEdges.map((edge) => ({ ...edge }));
    fireSinksBeforePass(ctxOf(engine));
    expect(fired.calls).toEqual([]);
    expect(worldOf(engine).cc2DeferredSinkEdges).toEqual(before);
  });

  it('does nothing off the CC2 engine', () => {
    const engine = withDeferredEdge(false, false);
    fireSinksBeforePass(ctxOf(engine));
    expect(fired.calls).toEqual([]);
    expect(worldOf(engine).cc2DeferredSinkEdges).toHaveLength(1);
  });
});

/** A lane with an orange button wired to a flame jet. */
function orangeLane(mode: Mode): CompiledLevel {
  const built = buildTestLevel(EMPTY_ROWS, {});
  built.terrain[ROW][SOURCE_X] = ORANGE;
  built.terrain[ROW][JET_X] = JET_OFF;
  const wired: CompiledLevel = { ...built, signalLinks: [{ fromX: SOURCE_X, fromY: ROW, toX: JET_X, toY: ROW }] };
  return mode === 'cc2' ? { ...wired, cc2: CC2_RECORD } : wired;
}

describe('the orange button reads an actor at rest', () => {
  const jet = (engine: GameEngine): string => engine.getTerrain()[ROW][JET_X];

  /** Walks east until the player stands on the button (the input and the tick that plays it). */
  function stepOntoButton(engine: GameEngine): void {
    for (let waited = 0; waited <= STEP_TICKS; waited++) {
      if (engine.getPlayer().moveCooldown === 0) {
        playMove(engine, 'E');
        if (engine.getPlayer().x === SOURCE_X) return;
      } else engine.tick();
    }
    throw new Error('the player never reached the button');
  }

  it('is still off while the player is mid-step on it and on once the step has ended (CC2)', () => {
    const engine = new GameEngine();
    engine.loadLevel(orangeLane('cc2'), 1);
    stepOntoButton(engine);
    expect(engine.getPlayer().moveCooldown).toBeGreaterThan(0);
    expect(jet(engine)).toBe(JET_OFF);
    for (let i = 0; i < STEP_TICKS && engine.getPlayer().moveCooldown > 0; i++) engine.tick();
    engine.tick();
    expect(jet(engine)).toBe(JET_ON);
  });

  it('lights the jet at the end of the step on a level that is not CC2', () => {
    const engine = new GameEngine();
    engine.loadLevel(orangeLane('native'), 1);
    stepOntoButton(engine);
    expect(jet(engine)).toBe(JET_ON);
  });
});
