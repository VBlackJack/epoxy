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

import { GameEngine } from '../core/GameEngine';
import { CompiledLevel, EntityPlacement } from '../core/types';
import { DEATH_BLOCK_REASON, HazardScan, hasNoCrushHazard, scanHazards } from './pilotHazardScan';
import { loadTestConfigs } from './loadTestConfigs';

const SCAN_TIMEOUT_MS = 60000;
const STATE_CAP = 20000;
const DEATH_WATER_REASON = 'hud.messages.death_water';
const DEATH_FIRE_REASON = 'hud.messages.death_fire';

const TERRAIN_CODES: Record<string, string> = {
  '#': 'wall',
  '.': 'floor',
  P: 'floor',
  $: 'floor',
  W: 'water',
  F: 'fire',
  I: 'ice',
  '4': 'ice_se',
  E: 'exit'
};

/** Rows: # wall, . floor, P player, $ dirt block, W water, F fire, I ice, E exit. */
function room(rows: string[]): CompiledLevel {
  let start = { x: 0, y: 0 };
  const entities: EntityPlacement[] = [];
  const terrain = rows.map((row, y) =>
    [...row].map((ch, x) => {
      if (ch === 'P') start = { x, y };
      if (ch === '$') entities.push({ type: 'dirt_block', x, y, dir: 'S' });
      return TERRAIN_CODES[ch];
    })
  );
  return {
    id: 'hazard_room',
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

describe('pilot hazard scan', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  it(
    'detects the bounce and the crush of a block pushed into an ice lane that ends on a wall',
    () => {
      const scan = scanHazards(room(['#######', '#P$III#', '#######']), { maxStates: STATE_CAP });
      expect(scan.truncated).toBe(false);
      expect(scan.blockBounces).toBeGreaterThan(0);
      expect(scan.deaths.map((d) => d.reason)).toContain(DEATH_BLOCK_REASON);
      expect(hasNoCrushHazard(scan)).toBe(false);
      // The shortest way to it is a single push east.
      expect(scan.bounces[0].path).toEqual(['E']);
    },
    SCAN_TIMEOUT_MS
  );

  it(
    'finds no bounce and no crush when the same lane ends on water',
    () => {
      const scan = scanHazards(room(['#######', '#P$IIW#', '#######']), { maxStates: STATE_CAP });
      expect(scan.truncated).toBe(false);
      expect(scan.blockBounces).toBe(0);
      expect(scan.deaths.some((d) => d.reason === DEATH_BLOCK_REASON)).toBe(false);
      expect(hasNoCrushHazard(scan)).toBe(true);
    },
    SCAN_TIMEOUT_MS
  );

  it(
    'reports a water death without boots with its reason key',
    () => {
      const scan = scanHazards(room(['#####', '#P.W#', '#####']), { maxStates: STATE_CAP });
      const death = scan.deaths.find((d) => d.reason === DEATH_WATER_REASON);
      expect(death).toBeDefined();
      expect(death?.path).toEqual(['E', 'E']);
      expect(scan.blockBounces).toBe(0);
    },
    SCAN_TIMEOUT_MS
  );

  it(
    'reports a fire death without boots with its reason key',
    () => {
      const scan = scanHazards(room(['#####', '#P.F#', '#####']), { maxStates: STATE_CAP });
      expect(scan.deaths.map((d) => d.reason)).toContain(DEATH_FIRE_REASON);
    },
    SCAN_TIMEOUT_MS
  );

  it(
    'reports no death on a safe room',
    () => {
      const scan = scanHazards(room(['#####', '#P..#', '#...#', '#####']), { maxStates: STATE_CAP });
      expect(scan.deaths).toEqual([]);
      expect(scan.truncated).toBe(false);
      expect(scan.states).toBeGreaterThan(1);
    },
    SCAN_TIMEOUT_MS
  );

  it(
    'sets the truncated flag when the state limit is hit',
    () => {
      const scan = scanHazards(room(['#####', '#P..#', '#...#', '#####']), { maxStates: 2 });
      expect(scan.truncated).toBe(true);
      expect(scan.states).toBe(2);
    },
    SCAN_TIMEOUT_MS
  );

  it(
    'detects the bounce of a block that is deflected by an ice corner and hits a wall',
    () => {
      // Entering the ice_se corner heading east turns the block north into the wall; it bounces west, back to the pusher.
      const scan = scanHazards(room(['#####', '#P$4#', '#####']), { maxStates: STATE_CAP });
      expect(scan.bounces.some((b) => b.x === 3 && b.y === 1 && b.dir === 'N')).toBe(true);
      expect(scan.deaths.map((d) => d.reason)).toContain(DEATH_BLOCK_REASON);
    },
    SCAN_TIMEOUT_MS
  );

  it(
    'detects a bounce whose block vanishes in water on the way back',
    () => {
      const engine = new GameEngine();
      engine.loadLevel(room(['######', '#PWI##', '######']));
      // Put a block already sliding east on the ice, with a wall ahead and the pool behind it.
      const state = engine.captureState();
      state.entities.push({ uid: 900, type: 'dirt_block', kind: 'block', x: 3, y: 1, dir: 'E', cooldownTicks: 0, isSliding: true });
      engine.restoreState(state);
      const scan = scanHazards(engine, { maxStates: STATE_CAP });
      expect(scan.bounces.some((b) => b.x === 3 && b.y === 1 && b.dir === 'E')).toBe(true);
      expect(scan.blockBounces).toBeGreaterThan(0);
    },
    SCAN_TIMEOUT_MS
  );

  it('never passes the crush check on an incomplete scan', () => {
    const complete: HazardScan = { states: 1, deaths: [], blockBounces: 0, bounces: [], unsettled: 0, truncated: false };
    expect(hasNoCrushHazard(complete)).toBe(true);
    expect(hasNoCrushHazard({ ...complete, truncated: true })).toBe(false);
    expect(hasNoCrushHazard({ ...complete, unsettled: 1 })).toBe(false);
    const scan = scanHazards(room(['#####', '#P..#', '#...#', '#####']), { maxStates: 2 });
    expect(hasNoCrushHazard(scan)).toBe(false);
  });
});
