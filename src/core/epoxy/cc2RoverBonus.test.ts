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

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { GameEngine } from '../GameEngine';
import type { CompiledLevel } from '../types';

const SIZE = 13;
const CENTER = 6;
const TIME_LIMIT_SECONDS = 1000;
const ROVER = 'rover';
const BONUS = 'score_10';
/** A bonus that CC2 leaves for the player (no normal pickup flag): a chip. */
const CHIP = 'chip';
const FIREBALL_EMULATEE = 5;
/** Two steps of the slowest rover (native: interval + 1 ticks, CC2: 8 ticks) plus slack. */
const RUN_TICKS = 40;

function room(cc2: boolean, item: string): CompiledLevel {
  const terrain: string[][] = Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x) => (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? 'wall' : 'floor'))
  );
  terrain[1][3] = 'steel_wall';
  terrain[2][2] = 'steel_wall';
  terrain[2][1] = 'steel_wall';
  const items: Array<Array<string | null>> = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null));
  // The rover heads east: the item lies on its way, two cells ahead.
  items[CENTER][CENTER + 1] = item;
  return {
    id: 'cc2_rover_bonus',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: TIME_LIMIT_SECONDS,
    chipsRequired: 0,
    playerStart: { x: 1, y: 1, dir: 'N' },
    terrain,
    items,
    entities: [{ type: ROVER, x: CENTER, y: CENTER, dir: 'E' }],
    trapLinks: [],
    cloneLinks: [],
    ...(cc2 ? { rulesFlavor: 'cc' as const, cc2: {} as never } : {})
  };
}

/** Plays a rover (a fireball at heart, so it goes straight ahead) over the item; returns what lies there at the end. */
function lyingAfterRun(cc2: boolean, item: string): { item: string | null; roverReached: boolean } {
  const engine = new GameEngine();
  engine.loadLevel(room(cc2, item));
  const rover = engine.getEntities().find((e) => e.type === ROVER);
  if (rover === undefined) throw new Error('the rover is missing');
  rover.emulatee = FIREBALL_EMULATEE;
  rover.emulationMoves = 0;
  let reached = false;
  for (let tick = 0; tick < RUN_TICKS; tick++) {
    engine.tick();
    const now = engine.getEntities().find((e) => e.type === ROVER);
    if (now?.x === CENTER + 1 && now.y === CENTER) reached = true;
  }
  return { item: engine.getItems()[CENTER][CENTER + 1], roverReached: reached };
}

beforeEach(() => {
  loadTestConfigs();
});

describe('a rover takes the score bonuses (CC2 engine)', () => {
  it('takes a score bonus it walks over on a CC2 level', () => {
    const result = lyingAfterRun(true, BONUS);
    expect(result.roverReached).toBe(true);
    expect(result.item).toBeNull();
  });

  it('leaves the bonus lying on a native level', () => {
    const result = lyingAfterRun(false, BONUS);
    expect(result.roverReached).toBe(true);
    expect(result.item).toBe(BONUS);
  });

  it('leaves what is not flagged for it (a chip) on a CC2 level', () => {
    const result = lyingAfterRun(true, CHIP);
    expect(result.roverReached).toBe(true);
    expect(result.item).toBe(CHIP);
  });
});
