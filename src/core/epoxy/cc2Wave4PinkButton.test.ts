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
 * CC2 wave 4: the pink button reads any actor at rest, a glider included (Lexy button_pink is_emitting). Other levels keep
 * their plate rules.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { CC2_TEST_RECORD, type RoomMode } from '../../test/cc2Room';
import { buildTestLevel } from '../../test/buildTestLevel';
import { GameEngine } from '../GameEngine';
import type { CompiledLevel, Direction, SignalLink } from '../types';

beforeEach(() => {
  loadTestConfigs();
});

describe('CC2 engine: the pink button reads any actor at rest', () => {
  const ROW = 1;
  const PLATE_X = 1;
  const PLATE_ROW = 3;
  const CLONER_X = 5;
  const CLONE_X = CLONER_X + 1;
  const LINK: SignalLink = { fromX: PLATE_X, fromY: PLATE_ROW, toX: CLONER_X, toY: ROW };
  // The cell of the button is sealed by walls, so the mover on it stays put.
  const EMPTY_ROWS = ['#########', '#@......#', '#########', '#.#######', '#########'];
  const SETTLE_TICKS = 6;

  /** A pink button wired to a clone machine holding a block, with a mover sealed in on the button. */
  function lane(mode: RoomMode, mover: string): CompiledLevel {
    const entities = [
      { type: 'dirt_block', x: CLONER_X, y: ROW, dir: 'E' as Direction },
      { type: mover, x: PLATE_X, y: PLATE_ROW, dir: 'E' as Direction }
    ];
    const built = buildTestLevel(EMPTY_ROWS, { entities });
    built.terrain[PLATE_ROW][PLATE_X] = 'signal_plate';
    built.terrain[ROW][CLONER_X] = 'clone_machine';
    const wired: CompiledLevel = { ...built, signalLinks: [LINK] };
    if (mode === 'cc2') return { ...wired, cc2: CC2_TEST_RECORD };
    return mode === 'cc' ? { ...wired, rulesFlavor: 'cc' } : wired;
  }

  const clonesAt = (engine: GameEngine): number => engine.getEntities().filter((e) => e.x === CLONE_X && e.y === ROW).length;

  function cloned(mode: RoomMode, mover: string): boolean {
    const engine = new GameEngine();
    engine.loadLevel(lane(mode, mover));
    for (let i = 0; i < SETTLE_TICKS; i += 1) engine.tick();
    return clonesAt(engine) > 0;
  }

  it('fires the clone machine for a glider at rest', () => {
    expect(cloned('cc2', 'glider')).toBe(true);
  });

  it('leaves a glider unread outside the CC2 engine', () => {
    expect(cloned('native', 'glider')).toBe(false);
    expect(cloned('cc', 'glider')).toBe(false);
  });
});
