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

import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../audio/AudioManager', () => import('./silentAudio'));

import { CompiledLevel, Direction, EntityPlacement } from '../core/types';
import { loadTestConfigs } from './loadTestConfigs';
import { assertNoWinWithCreatureAlive, creatureProof, searchWinWithCreatureAlive } from './pilotCreatureProof';
import { searchCanWin } from './pilotSearch';
import { GameEngine } from '../core/GameEngine';

const PROOF_TIMEOUT_MS = 60000;
const STATE_CAP = 50000;

const TERRAIN_CODES: Record<string, string> = {
  '#': 'wall',
  '.': 'floor',
  P: 'floor',
  b: 'floor',
  $: 'floor',
  W: 'water',
  E: 'exit'
};

/** Rows: # wall, . floor, P player, b bug (facing `bugDir`), $ dirt block, W water, E exit. */
function room(rows: string[], bugDir: Direction): CompiledLevel {
  let start = { x: 0, y: 0 };
  const entities: EntityPlacement[] = [];
  const terrain = rows.map((row, y) =>
    [...row].map((ch, x) => {
      if (ch === 'P') start = { x, y };
      if (ch === 'b') entities.push({ type: 'bug', x, y, dir: bugDir });
      if (ch === '$') entities.push({ type: 'dirt_block', x, y, dir: 'S' });
      return TERRAIN_CODES[ch];
    })
  );
  return {
    id: 'creature_room',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    playerStart: { ...start, dir: 'E' },
    terrain,
    items: rows.map((row) => [...row].map(() => null)),
    entities,
    trapLinks: [],
    cloneLinks: []
  };
}

/** The exit is two steps away and the bug is far down the room: the player simply gets there first. */
const DODGEABLE = ['###########', '#PE.......#', '#.........#', '#.......b.#', '###########'];
/**
 * A one-cell corridor: the bug walks west toward the player and over a pool, and a dirt block is
 * the only way to bridge that pool. The bug always gets to the player first or drowns first.
 */
const WATER_CORRIDOR = ['#############', '#P$W..b...E.#', '#############'];

describe('pilot creature proof', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  it(
    'finds a win with the bug alive when the bug can be dodged',
    () => {
      const level = room(DODGEABLE, 'W');
      const win = searchWinWithCreatureAlive(level, { stateCap: STATE_CAP });
      expect(win).not.toBeNull();
      const proof = creatureProof(level, { stateCap: STATE_CAP });
      expect(proof.withDrops).not.toBeNull();
      expect(proof.withoutDrops).not.toBeNull();
      expect(() => assertNoWinWithCreatureAlive(level, { stateCap: STATE_CAP })).toThrow(/keeps the bug alive/);
    },
    PROOF_TIMEOUT_MS
  );

  it(
    'finds no win with the bug alive when the way out goes through the pool the bug must drown in',
    () => {
      const level = room(WATER_CORRIDOR, 'W');
      const engine = new GameEngine();
      engine.loadLevel(level);
      // The level is winnable at all, only not with the bug alive.
      expect(searchCanWin(engine, { stateCap: STATE_CAP })).toBe(true);
      expect(searchWinWithCreatureAlive(level, { stateCap: STATE_CAP, allowDrops: true })).toBeNull();
      expect(searchWinWithCreatureAlive(level, { stateCap: STATE_CAP, allowDrops: false })).toBeNull();
      expect(() => assertNoWinWithCreatureAlive(level, { stateCap: STATE_CAP })).not.toThrow();
    },
    PROOF_TIMEOUT_MS
  );

  it(
    'refuses to call a level proven when it cannot be won at all',
    () => {
      // The exit is walled off: no win exists, with the bug alive or not.
      const level = room(['#########', '#P#E....#', '#######b#', '#########'], 'W');
      expect(searchWinWithCreatureAlive(level, { stateCap: STATE_CAP })).toBeNull();
      expect(() => assertNoWinWithCreatureAlive(level, { stateCap: STATE_CAP })).toThrow(/cannot be won/);
    },
    PROOF_TIMEOUT_MS
  );

  it(
    'requires every starting bug to survive, not just one of them',
    () => {
      // Two bugs walk down the corridor: the first must drown in the pool before the way opens, so no win keeps both.
      const level = room(['#############', '#P$W..b.b.E.#', '#############'], 'W');
      const engine = new GameEngine();
      engine.loadLevel(level);
      expect(searchCanWin(engine, { stateCap: STATE_CAP, allowDrops: true })).toBe(true);
      expect(searchWinWithCreatureAlive(level, { stateCap: STATE_CAP })).toBeNull();
      expect(() => assertNoWinWithCreatureAlive(level, { stateCap: STATE_CAP })).not.toThrow();
    },
    PROOF_TIMEOUT_MS
  );
});
