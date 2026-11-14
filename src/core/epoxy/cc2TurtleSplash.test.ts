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
 * CC2 engine: a turtle that sinks behind the player leaves a splash on the water, which bars him from the cell for a few
 * passes as the splash of a sunk block does (Lexy's Labyrinth turtle.on_depart). Other levels leave no splash.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { playMove } from '../../test/cc2Play';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { ROOM_ROW, room, type RoomMode } from '../../test/cc2Room';
import { GameEngine } from '../GameEngine';
import { CC2_SPLASH_BLOCK_PASSES, splashBarsPlayer } from './epoxyBlocks';
import type { EpoxyWorld } from './epoxyWorld';

beforeEach(() => {
  loadTestConfigs();
});

const TURTLE_CC2 = 'turtle_cc2';
const TURTLE_X = 2;
const WATER = 'water';
const MAX_TICKS = 40;

const world = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;

/** The player starts on a turtle and steps east off it. */
function leaveTurtle(mode: RoomMode): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(room({ mode, startX: TURTLE_X, terrain: { [`${TURTLE_X},${ROOM_ROW}`]: TURTLE_CC2 } }));
  expect(playMove(engine, 'E').moved).toBe(true);
  return engine;
}

describe('CC2 engine: the turtle that sinks leaves a splash', () => {
  it('sinks into water and bars the player from the cell for the splash passes only', () => {
    const engine = leaveTurtle('cc2');
    const w = world(engine);
    expect(engine.getTerrain()[ROOM_ROW][TURTLE_X]).toBe(WATER);
    expect(splashBarsPlayer(w, TURTLE_X, ROOM_ROW)).toBe(true);
    for (let i = 0; i < CC2_SPLASH_BLOCK_PASSES && i < MAX_TICKS; i++) engine.tick();
    expect(splashBarsPlayer(w, TURTLE_X, ROOM_ROW)).toBe(false);
  });

  it('leaves no blast, which only a destroyed block leaves', () => {
    const engine = leaveTurtle('cc2');
    expect(world(engine).blockExplosions.size).toBe(0);
  });

  it('is put back by undo together with the turtle', () => {
    const engine = leaveTurtle('cc2');
    expect(engine.undo()).toBe(true);
    expect(engine.getTerrain()[ROOM_ROW][TURTLE_X]).toBe(TURTLE_CC2);
    expect(splashBarsPlayer(world(engine), TURTLE_X, ROOM_ROW)).toBe(false);
  });
});

describe('a level not on the CC2 engine leaves no splash behind a sunk turtle', () => {
  it.each(['cc', 'native'] as const)('%s level', (mode) => {
    const engine = leaveTurtle(mode);
    expect(world(engine).blockSplashes.size).toBe(0);
    expect(splashBarsPlayer(world(engine), TURTLE_X, ROOM_ROW)).toBe(false);
  });
});
