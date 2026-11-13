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
 * CC2 wave 3, wired sinks (Lexy game.js recalculate_circuitry, tiletypes.js flame jets): every wired sink starts off at load,
 * except a sink fed by a button link; a wired flame jet flips on the rising edge only, except one an orange button works.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { buildTestLevel } from '../../test/buildTestLevel';
import { GameEngine } from '../GameEngine';
import type { Cc2LevelData, CompiledLevel, Direction, SignalLink } from '../types';

beforeEach(() => {
  loadTestConfigs();
});

const CC2_RECORD = { v: 1, sha256: 'ab'.repeat(32), file: 'one.c2m', order: 1, gridHash: 'x' } as Cc2LevelData;
const ROW = 1;
const SOURCE_X = 2;
const JET_X = 5;
const PLATE = 'signal_plate';
const ORANGE = 'button_orange_cc2';
const JET_OFF = 'flame_jet_cc2_off';
const JET_ON = 'flame_jet_cc2_on';
const BLOCK = 'dirt_block';
const EMPTY_ROWS = ['#########', '#@......#', '#########'];
/** Ticks run after the load; the first one is tick 0. */
const SETTLE_TICKS = 3;

type Mode = 'cc2' | 'native';

/** A lane with a source tile wired to a flame jet; a block rests on the source when `held`. */
function lane(mode: Mode, source: string, held: boolean): CompiledLevel {
  const entities = held ? [{ type: BLOCK, x: SOURCE_X, y: ROW, dir: 'E' as Direction }] : [];
  const built = buildTestLevel(EMPTY_ROWS, { entities });
  built.terrain[ROW][SOURCE_X] = source;
  built.terrain[ROW][JET_X] = JET_OFF;
  const link: SignalLink = { fromX: SOURCE_X, fromY: ROW, toX: JET_X, toY: ROW };
  const wired: CompiledLevel = { ...built, signalLinks: [link] };
  return mode === 'cc2' ? { ...wired, cc2: CC2_RECORD } : wired;
}

function load(level: CompiledLevel): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(level);
  return engine;
}

const jetAt = (engine: GameEngine): string => engine.getTerrain()[ROW][JET_X];
const MAX_WAIT_TICKS = 40;
/** Walks one step east, waiting out the cooldown of the step before. */
function stepEast(engine: GameEngine): void {
  for (let waited = 0; waited <= MAX_WAIT_TICKS; waited++) {
    if (engine.getPlayer().moveCooldown === 0) {
      engine.attemptPlayerMove('E');
      return;
    }
    engine.tick();
  }
  throw new Error('the player never became able to move');
}
const run = (engine: GameEngine, ticks: number): void => {
  for (let i = 0; i < ticks; i++) engine.tick();
};

describe('CC2 engine: a wired sink starts off at load', () => {
  it('lights a wired flame jet whose wire is held at load, on tick 0', () => {
    const engine = load(lane('cc2', PLATE, true));
    expect(jetAt(engine)).toBe(JET_OFF);
    run(engine, SETTLE_TICKS);
    expect(jetAt(engine)).toBe(JET_ON);
  });

  it('keeps a jet fed by an orange button as it was primed', () => {
    const engine = load(lane('cc2', ORANGE, true));
    run(engine, SETTLE_TICKS);
    expect(jetAt(engine)).toBe(JET_OFF);
  });

  it('keeps the primed start on a level that is not CC2', () => {
    const engine = load(lane('native', PLATE, true));
    run(engine, SETTLE_TICKS);
    expect(jetAt(engine)).toBe(JET_OFF);
  });

  it('changes nothing when the wire is not held at load', () => {
    const engine = load(lane('cc2', PLATE, false));
    run(engine, SETTLE_TICKS);
    expect(jetAt(engine)).toBe(JET_OFF);
  });
});

describe('a wired flame jet flips on the rising edge only on a CC2 level', () => {
  /** The player steps onto the source (jet on), off it, and the lane settles. */
  function overAndOff(mode: Mode, source: string): GameEngine {
    const engine = load(lane(mode, source, false));
    stepEast(engine);
    run(engine, MAX_WAIT_TICKS);
    expect(jetAt(engine)).toBe(JET_ON);
    stepEast(engine);
    stepEast(engine);
    run(engine, MAX_WAIT_TICKS);
    expect(engine.getPlayer().x).toBeGreaterThan(SOURCE_X);
    return engine;
  }

  it('keeps the jet lit when the wire falls', () => {
    expect(jetAt(overAndOff('cc2', PLATE))).toBe(JET_ON);
  });

  it('puts the jet out when the wire falls on a level that is not CC2', () => {
    expect(jetAt(overAndOff('native', PLATE))).toBe(JET_OFF);
  });

  it('toggles a jet worked by an orange button on release too', () => {
    expect(jetAt(overAndOff('cc2', ORANGE))).toBe(JET_OFF);
  });
});

describe('the CC2 pink button reads only an actor at rest', () => {
  it('lights the jet once the player has settled on the button, not at the end of his step', () => {
    const engine = load(lane('cc2', PLATE, false));
    stepEast(engine);
    expect(engine.getPlayer().x).toBe(SOURCE_X);
    expect(jetAt(engine)).toBe(JET_OFF);
    expect(engine.getPlayer().moveCooldown).toBeGreaterThan(0);
    run(engine, MAX_WAIT_TICKS);
    expect(engine.getPlayer().moveCooldown).toBe(0);
    expect(jetAt(engine)).toBe(JET_ON);
  });

  it('lights the jet at the end of the step on a level that is not CC2', () => {
    const engine = load(lane('native', PLATE, false));
    stepEast(engine);
    expect(jetAt(engine)).toBe(JET_ON);
  });

  it('still reads the player on an orange button the moment he arrives', () => {
    const engine = load(lane('cc2', ORANGE, false));
    stepEast(engine);
    expect(jetAt(engine)).toBe(JET_ON);
  });
});
