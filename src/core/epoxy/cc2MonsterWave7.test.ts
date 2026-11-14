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
 * CC2 wave 7, monsters: a monster loaded on ice decides normally until it has left its load cell (IL). Every rule is off on
 * classic and native levels.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { ROOM_ROW, room } from '../../test/cc2Room';
import type { RoomMode, RoomOptions } from '../../test/cc2Room';
import { GameEngine } from '../GameEngine';
import type { Direction, RuntimeEntity } from '../types';

beforeEach(() => {
  loadTestConfigs();
});

const ICE = 'ice';
const FLOOR = 'floor';
const BUG = 'bug';
const START_X = 6;
const SETTLE_TICKS = 3;

function load(mode: RoomMode, options: Omit<RoomOptions, 'mode'>): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(room({ mode, startX: 1, ...options }));
  return engine;
}

const monsterOf = (engine: GameEngine, type: string): RuntimeEntity => {
  const found = engine.getEntities().find((e) => e.type === type);
  if (found === undefined) throw new Error(`the room has a ${type}`);
  return found;
};

describe('monster loaded on ice (IL)', () => {
  const placed = (dir: Direction) => ({
    terrain: { [`${START_X},${ROOM_ROW}`]: ICE },
    entities: [{ type: BUG, x: START_X, y: ROOM_ROW, dir }]
  });
  // Two bugs side by side on ice, facing east, the one behind listed first (so it moves after the one ahead).
  const jam = {
    terrain: { [`${START_X - 1},${ROOM_ROW}`]: ICE, [`${START_X},${ROOM_ROW}`]: ICE },
    entities: [
      { type: BUG, x: START_X - 1, y: ROOM_ROW, dir: 'E' as const },
      { type: BUG, x: START_X, y: ROOM_ROW, dir: 'E' as const }
    ]
  };
  const behindX = (engine: GameEngine): number =>
    Math.min(...engine.getEntities().filter((e) => e.type === BUG).map((e) => e.x));

  it('judges the slide way at its decision: the bug behind another one turns back instead of following it', () => {
    const engine = load('cc2', jam);
    engine.tick();
    expect(behindX(engine)).toBe(START_X - 2);
  });

  it('marks the monster at load and forgets the mark with its first step away', () => {
    const engine = load('cc2', placed('N'));
    expect(monsterOf(engine, BUG).atLoadCell).toBe(true);
    for (let i = 0; i < SETTLE_TICKS; i++) engine.tick();
    expect(monsterOf(engine, BUG).atLoadCell).toBeUndefined();
  });

  it('marks nothing when the monster is not loaded on ice', () => {
    const engine = load('cc2', { terrain: { [`${START_X},${ROOM_ROW}`]: FLOOR }, entities: [{ type: BUG, x: START_X, y: ROOM_ROW, dir: 'N' }] });
    expect(monsterOf(engine, BUG).atLoadCell).toBeUndefined();
  });

  it('leaves a classic level and a native level without the mark', () => {
    for (const mode of ['cc', 'native'] as const) {
      const engine = load(mode, placed('N'));
      expect(monsterOf(engine, BUG).atLoadCell, mode).toBeUndefined();
    }
  });
});
