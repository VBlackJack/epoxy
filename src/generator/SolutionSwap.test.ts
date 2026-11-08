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
 * Stored solutions of a level with several players: the swap key has its own letter, a written list round-trips it,
 * and the replay applies the swap in the real engine and stamps it for the player.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../audio/AudioManager', () => import('../test/silentAudio'));

import type { CompiledLevel } from '../core/types';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { decodeActions, encodeActions, SWAP_ACTION, SWAP_LETTER } from './PieceSolver';
import { storedSolutionWins, timedSolution } from './SolutionReplay';

const ROOM_WIDTH = 5;
const ROOM_HEIGHT = 5;
const ROW = 2;
const EXIT_X = 2;

/** A walled room with one exit in the middle of the middle row; Chip stands left of it and Melinda right of it. */
function room(withMelinda: boolean): CompiledLevel {
  const terrain: string[][] = Array.from({ length: ROOM_HEIGHT }, (_, y) =>
    Array.from({ length: ROOM_WIDTH }, (_, x) => (x === 0 || y === 0 || x === ROOM_WIDTH - 1 || y === ROOM_HEIGHT - 1 ? 'wall' : 'floor'))
  );
  terrain[ROW][EXIT_X] = 'exit';
  return {
    id: 'swap_solution_room',
    number: 1,
    password: 'SWAP',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    playerStart: { x: 1, y: ROW, dir: 'E' },
    ...(withMelinda ? { extraPlayers: [{ x: 3, y: ROW, dir: 'W' as const, character: 'melinda' as const }] } : {}),
    terrain,
    items: terrain.map((row) => row.map(() => null)),
    entities: [],
    trapLinks: [],
    cloneLinks: []
  };
}

describe('stored solutions with the swap key', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('writes the swap key as its own letter and reads it back', () => {
    expect(SWAP_LETTER).toBe('P');
    expect(decodeActions('EPW.')).toEqual(['E', SWAP_ACTION, 'W', 'WAIT']);
    expect(encodeActions(decodeActions('NPESPW'))).toBe('NPESPW');
  });

  it('replays a solution that swaps and stamps the swap for the player', () => {
    const level = { ...room(true), solution: 'PWE' };
    const moves = timedSolution(level);
    expect(moves).not.toBeNull();
    expect(moves?.map((m) => (m.swap ? 'swap' : m.dir))).toEqual(['swap', 'W', 'E']);
    expect(storedSolutionWins(level)).toBe(true);
  });

  it('still wins without a swap, since an exited player hands control on', () => {
    expect(storedSolutionWins({ ...room(true), solution: 'EW' })).toBe(true);
  });

  it('refuses a solution that swaps on a level with one player', () => {
    expect(storedSolutionWins({ ...room(false), solution: 'PE' })).toBe(false);
  });

  it('refuses a solution that leaves a player behind', () => {
    expect(storedSolutionWins({ ...room(true), solution: 'E' })).toBe(false);
  });
});
