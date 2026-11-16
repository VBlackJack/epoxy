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
 * CC2 engine, wave 15: the player on a turning (random) force floor. A forced step that is refused steps on the cell again, which
 * turns the floor, and tries the new way in the same attempt (Lexy _possibly_bonk, game.js:1127-1162); each try turns the floor once.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { room } from '../../test/cc2Room';
import { GameEngine } from '../GameEngine';
import type { CompiledLevel } from '../types';
import type { EpoxyWorld } from './epoxyWorld';

beforeEach(() => {
  loadTestConfigs();
});

const CYCLE = 'force_cycle';
const PAD = { x: 3, y: 5 };
const WALL_EAST = { x: 4, y: 5 };
/** The shared turn goes east, south, west, north: the first draw sends the player into the east wall, the second south. */
const FIRST_DRAW_BLOCKED_TERRAIN = { [`${PAD.x},${PAD.y}`]: CYCLE, [`${WALL_EAST.x},${WALL_EAST.y}`]: 'wall' };
const TICKS_TO_LEAVE = 6;
const TICKS_BOXED = 8;
/** A boxed player on a turning floor tries in frame 0, in frame 1 and at the decisions of frame 2 (the retry of PFS): one turn each. */
const TRIES_PER_TICK = 3;

const worldOf = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;

function load(level: CompiledLevel): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(level);
  return engine;
}

function boxedPad(): CompiledLevel {
  const terrain: Record<string, string> = { [`${PAD.x},${PAD.y}`]: CYCLE };
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) terrain[`${PAD.x + dx},${PAD.y + dy}`] = 'wall';
  return room({ mode: 'cc2', terrain, startX: PAD.x });
}

describe('PRF: a refused forced step on a turning force floor', () => {
  it('turns the floor and goes the new way in the same attempt (map054 t198 shape)', () => {
    const engine = load(room({ mode: 'cc2', terrain: FIRST_DRAW_BLOCKED_TERRAIN }));
    const w = worldOf(engine);
    engine.attemptPlayerMove('E');
    const trail: string[] = [];
    for (let i = 0; i < TICKS_TO_LEAVE; i++) {
      engine.tick();
      trail.push(`${w.player.x},${w.player.y}:${w.forceCycleTurn}`);
    }
    // Draw 0 (east) is refused by the wall at tick 2; the bonk draws 1 (south) and the step goes at once, one tick before the carry
    // of the next tick would have turned him.
    expect(trail.slice(0, 3)).toEqual(['3,5:1', '3,5:1', '3,6:2']);
    // He is on the cell below the pad, not stuck on it.
    expect({ x: w.player.x, y: w.player.y }).toEqual({ x: PAD.x, y: PAD.y + 1 });
    expect(w.forceCycleTurn).toBe(2);
  });

  it('a boxed player draws exactly one turn per try: one floor turn per try, three per tick (item 3)', () => {
    const engine = load(boxedPad());
    const w = worldOf(engine);
    // The first tick starts the carry (the level starts on the floor): it draws the arrival turn as well.
    engine.tick();
    const deltas: number[] = [];
    for (let i = 0; i < TICKS_BOXED; i++) {
      const before = w.forceCycleTurn;
      engine.tick();
      deltas.push(w.forceCycleTurn - before);
    }
    expect(deltas).toEqual(Array(TICKS_BOXED).fill(TRIES_PER_TICK));
    expect({ x: w.player.x, y: w.player.y }).toEqual(PAD);
  });

  it('stays unchanged on a classic and on a native level', () => {
    const track = (mode: 'cc' | 'native'): string[] => {
      const engine = load(room({ mode, terrain: FIRST_DRAW_BLOCKED_TERRAIN }));
      const w = worldOf(engine);
      engine.attemptPlayerMove('E');
      const out: string[] = [];
      for (let i = 0; i < TICKS_TO_LEAVE; i++) {
        engine.tick();
        out.push(`${w.player.x},${w.player.y}`);
      }
      return out;
    };
    expect({ cc: track('cc'), native: track('native') }).toEqual({ cc: ['3,5', '3,5', '3,6', '3,6', '3,6', '3,6'], native: Array(TICKS_TO_LEAVE).fill('3,5') });
  });
});
