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

vi.mock('../audio/AudioManager', () => import('../test/silentAudio'));

import { CampaignRouteError, expandRoute, parseSegment } from './CampaignRoute';
import { decodeActions } from './PieceSolver';
import { buildTestLevel } from '../test/buildTestLevel';
import { replays } from '../test/levelChecks';
import { loadTestConfigs } from '../test/loadTestConfigs';

/** Small enough to exhaust quickly in the budget test. */
const TINY_STATE_BUDGET = 3;

function routeError(run: () => unknown): CampaignRouteError {
  try {
    run();
  } catch (error) {
    if (error instanceof CampaignRouteError) return error;
    throw error;
  }
  throw new Error('the route was expected to fail');
}

describe('parseSegment', () => {
  it('reads moves and waits', () => {
    expect(parseSegment('EE.S')).toEqual({ kind: 'literal', actions: ['E', 'E', 'WAIT', 'S'] });
  });

  it('reads a goto target', () => {
    expect(parseSegment('@12,7')).toEqual({ kind: 'goto', target: { x: 12, y: 7 } });
  });

  it('rejects anything else', () => {
    for (const text of ['', 'EX', '@1', '@a,b', '@1,2 ', 'e']) {
      expect(() => parseSegment(text), text).toThrow();
    }
  });
});

describe('expandRoute', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  it('plays literal segments as written', () => {
    const level = buildTestLevel(['@.E']);
    const result = expandRoute(level, ['E', 'E']);
    expect(result.solution).toBe('EE');
    expect(result.moves).toBe(2);
    expect(replays(level, decodeActions(result.solution))).toBe(true);
  });

  it('keeps waits in the solution', () => {
    const level = buildTestLevel(['@.E']);
    expect(expandRoute(level, ['E.E']).solution).toBe('E.E');
  });

  it('walks to a cell around a wall and may finish on the exit', () => {
    const level = buildTestLevel(['@.#E', '..#.', '....']);
    const result = expandRoute(level, ['@3,0']);
    expect(result.solution.length).toBe(7);
    expect(replays(level, decodeActions(result.solution))).toBe(true);
    expect(result.statesExplored).toBeGreaterThan(0);
  });

  it('chains a goto with literal moves', () => {
    const level = buildTestLevel(['@.rRE']);
    const result = expandRoute(level, ['@3,0', 'EE']);
    expect(result.solution).toBe('EEEEE');
    expect(replays(level, decodeActions(result.solution))).toBe(true);
  });

  it('opens a door on the way with the key it picked up', () => {
    const level = buildTestLevel(['@rRE']);
    expect(expandRoute(level, ['@3,0']).solution).toBe('EEE');
  });

  it('collects chips before the socket in a goto', () => {
    const level = buildTestLevel(['@C.SE'], { chipsRequired: 1 });
    const result = expandRoute(level, ['@4,0']);
    expect(replays(level, decodeActions(result.solution))).toBe(true);
  });

  it('names level, segment and player when a target is unreachable', () => {
    const level = buildTestLevel(['@.#E']);
    const error = routeError(() => expandRoute(level, ['E', '@3,0']));
    expect(error.levelId).toBe(level.id);
    expect(error.segmentIndex).toBe(1);
    expect(error.player).toEqual({ x: 1, y: 0 });
    expect(error.message).toContain('explored');
  });

  it('fails when the state budget runs out', () => {
    const level = buildTestLevel(['@.........#E', '............']);
    const error = routeError(() => expandRoute(level, ['@11,0'], { maxStates: TINY_STATE_BUDGET }));
    expect(error.segmentIndex).toBe(0);
    expect(error.reason).toContain('budget');
  });

  it('fails when a target lies outside the map', () => {
    const level = buildTestLevel(['@.E']);
    expect(routeError(() => expandRoute(level, ['@99,0'])).reason).toContain('outside');
  });

  it('fails when the level is not completed after the last segment', () => {
    const level = buildTestLevel(['@.E']);
    const error = routeError(() => expandRoute(level, ['E']));
    expect(error.segmentIndex).toBe(1);
    expect(error.reason).toContain('not completed');
  });

  it('fails on an unreadable segment', () => {
    const level = buildTestLevel(['@.E']);
    expect(routeError(() => expandRoute(level, ['EZ'])).segmentIndex).toBe(0);
  });
});
