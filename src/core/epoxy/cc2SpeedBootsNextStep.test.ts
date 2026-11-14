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

/** CC2 engine: the speed boots a step takes act from the next step (Lexy game.js:2170-2195): the step that takes them lasts a walk. */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { buildTestLevel } from '../../test/buildTestLevel';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { GameEngine } from '../GameEngine';
import type { Cc2LevelData, CompiledLevel } from '../types';
import { playerWalkCooldown } from './epoxyPlayer';
import { playerHaste, type EpoxyWorld } from './epoxyWorld';

beforeEach(() => {
  loadTestConfigs();
});

const CC2_RECORD = { v: 1, sha256: 'ab'.repeat(32), file: 'one.c2m', order: 1, gridHash: 'x' } as Cc2LevelData;
const ROWS = ['#######', '#@....#', '#######'];
const BOOTS_CELL = { x: 2, y: 1 };
const SPEED_BOOTS = 'boots_speed';

type Mode = 'cc2' | 'cc' | 'native';

function fixture(mode: Mode): { engine: GameEngine; w: EpoxyWorld } {
  const built = buildTestLevel(ROWS);
  const level: CompiledLevel = {
    ...built,
    ...(mode === 'cc2' ? { cc2: CC2_RECORD } : mode === 'cc' ? { rulesFlavor: 'cc' as const } : {})
  };
  const engine = new GameEngine();
  engine.loadLevel(level);
  const w = (engine as unknown as { w: EpoxyWorld }).w;
  w.items[BOOTS_CELL.y][BOOTS_CELL.x] = SPEED_BOOTS;
  return { engine, w };
}

describe('the speed boots a step takes act from the next step', () => {
  it('lasts a plain walk on the step that takes them (CC2 engine), then the quick one', () => {
    const { engine, w } = fixture('cc2');
    const plainWalk = playerWalkCooldown(w);
    expect(engine.attemptPlayerMove('E')).toBe(true);
    expect(playerHaste(w)).toBeGreaterThan(1);
    expect(playerWalkCooldown(w)).toBeLessThan(plainWalk);
    expect(w.player.moveCooldown).toBe(plainWalk);
    // The next step, taken once the first one has run out, is timed with the boots.
    while (w.player.moveCooldown > 0) engine.tick();
    expect(engine.attemptPlayerMove('E')).toBe(true);
    expect(w.player.moveCooldown).toBe(playerWalkCooldown(w));
    expect(w.player.moveCooldown).toBeLessThan(plainWalk);
  });

  it.each(['cc', 'native'] as const)('shortens the step that takes them on a %s level', (mode) => {
    const { engine, w } = fixture(mode);
    const plainWalk = playerWalkCooldown(w);
    expect(engine.attemptPlayerMove('E')).toBe(true);
    expect(w.player.moveCooldown).toBe(playerWalkCooldown(w));
    expect(w.player.moveCooldown).toBeLessThan(plainWalk);
  });
});
