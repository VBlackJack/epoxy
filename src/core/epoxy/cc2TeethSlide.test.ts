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
 * CC2 engine, wave 11 (TSL): teeth on ice or a force floor slide whatever their phase window: a pending slide is decided before
 * decide_movement, whose pursue_player holds the teeth window (Lexy game.js:1714-1719, tiletypes.js:245-249). Teeth that hold the
 * tool of the floor, and teeth still on their load cell on ice (no pending slide at load), keep their phase.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { ROOM_ROW, room } from '../../test/cc2Room';
import type { RoomMode } from '../../test/cc2Room';
import { teethMayDecide } from '../coreConstants';
import { GameEngine } from '../GameEngine';
import type { RuntimeEntity } from '../types';

beforeEach(() => {
  loadTestConfigs();
});

const TEETH = 'teeth';
const CLEATS = 'boots_ice';
const FORCE_BOOTS = 'boots_force';
const ICE = 'ice';
const FORCE_EAST = 'force_e';
const START_X = 4;
const PLAYER_X = 11;
const OUT_OF_PHASE_TICKS = 3;

interface Options {
  tool?: string;
  onLoadCell?: boolean;
  mode?: RoomMode;
}

function teethOf(engine: GameEngine): RuntimeEntity {
  const found = engine.getEntities().find((e) => e.type === TEETH);
  if (found === undefined) throw new Error('the room has teeth');
  return found;
}

/** Teeth on a floor cell facing east, the player far east; the column of the teeth after each of the first ticks. */
function columns(floor: string, ticks: number, options: Options = {}): number[] {
  const engine = new GameEngine();
  engine.loadLevel(
    room({
      mode: options.mode ?? 'cc2',
      startX: PLAYER_X,
      terrain: { [`${START_X},${ROOM_ROW}`]: floor },
      entities: [{ type: TEETH, x: START_X, y: ROOM_ROW, dir: 'E' }]
    })
  );
  if (options.onLoadCell !== true) for (const loaded of engine.getEntities()) delete loaded.atLoadCell;
  if (options.tool !== undefined) teethOf(engine).heldTools = [options.tool];
  const out: number[] = [];
  for (let t = 0; t < ticks; t++) {
    engine.tick();
    out.push(teethOf(engine).x);
  }
  return out;
}

describe('the first ticks of a CC2 level are out of the teeth window', () => {
  it('has no window on the first ticks', () => {
    for (let clock = 0; clock < OUT_OF_PHASE_TICKS; clock++) expect(teethMayDecide(clock, true)).toBe(false);
  });
});

describe('teeth on a sliding floor out of their phase window (TSL)', () => {
  it.each([
    ['ice', ICE],
    ['a force floor', FORCE_EAST]
  ])('slide on %s without waiting for the window', (_name, floor) => {
    expect(columns(floor, OUT_OF_PHASE_TICKS)[0]).toBe(START_X + 1);
  });

  it('keep their phase on ice when they hold cleats', () => {
    expect(columns(ICE, OUT_OF_PHASE_TICKS, { tool: CLEATS })).toEqual([START_X, START_X, START_X]);
  });

  it('keep their phase on a force floor when they hold force boots', () => {
    expect(columns(FORCE_EAST, OUT_OF_PHASE_TICKS, { tool: FORCE_BOOTS })).toEqual([START_X, START_X, START_X]);
  });

  it('still slide on ice when they hold force boots (the wrong tool)', () => {
    expect(columns(ICE, OUT_OF_PHASE_TICKS, { tool: FORCE_BOOTS })[0]).toBe(START_X + 1);
  });

  it('keep their phase on their load cell on ice', () => {
    expect(columns(ICE, OUT_OF_PHASE_TICKS, { onLoadCell: true })).toEqual([START_X, START_X, START_X]);
  });

  it('keep their phase on plain floor', () => {
    expect(columns('floor', OUT_OF_PHASE_TICKS)).toEqual([START_X, START_X, START_X]);
  });

  it.each(['cc', 'native'] as RoomMode[])('are not carried out of phase on a %s level', (mode) => {
    // A classic level keeps the window at the cell; tick 0 is inside it on cc, and a native level has no window on ice either way.
    const base = columns(ICE, OUT_OF_PHASE_TICKS, { mode });
    expect(base).toEqual(columns(ICE, OUT_OF_PHASE_TICKS, { mode, tool: CLEATS }));
  });
});
