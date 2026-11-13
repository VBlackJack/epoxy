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
 * A blue button the player works when his step ends turns the tanks at their next decision. The turn delay calibrated for
 * a press at the start of a step (a few passes) would make them turn mid-step and ignore it.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { ROOM_ROW, room, type RoomMode } from '../../test/cc2Room';
import { GameEngine } from '../GameEngine';
import { OPPOSITE_DIRECTION } from '../coreConstants';
import type { CompiledLevel, Direction } from '../types';
import type { EpoxyWorld } from './epoxyWorld';

beforeEach(() => {
  loadTestConfigs();
});

const TARGET_X = 3;
const MAX_TICKS = 40;

function world(engine: GameEngine): EpoxyWorld {
  return (engine as unknown as { w: EpoxyWorld }).w;
}

function load(level: CompiledLevel): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(level);
  return engine;
}

describe('CC2 engine: a blue button pressed at step end', () => {
  const BLUE_BUTTON = 'button_blue';
  const TANK = 'tank';
  const tankRoom = (mode: RoomMode): CompiledLevel =>
    room({ mode, terrain: { [`${TARGET_X},${ROOM_ROW}`]: BLUE_BUTTON }, entities: [{ type: TANK, x: 9, y: 2, dir: 'W' }] });
  const markOf = (engine: GameEngine): number | undefined => world(engine).entities.find((e) => e.type === TANK)?.tankTurn;

  it('marks the tank only at the end of the step, due at the current pass', () => {
    const engine = load(tankRoom('cc2'));
    expect(engine.attemptPlayerMove('E')).toBe(true);
    expect(markOf(engine)).toBeUndefined();
    let guard = 0;
    while (engine.getPlayer().moveCooldown > 0 && guard++ < MAX_TICKS) engine.tick();
    // The press acts at the start of the next tick, before its entity pass: the mark is due at that very pass, which spends it.
    expect(markOf(engine)).toBeUndefined();
    const dirBefore = world(engine).entities.find((e) => e.type === TANK)?.dir as Direction;
    engine.tick();
    expect(markOf(engine)).toBeUndefined();
    expect(world(engine).entities.find((e) => e.type === TANK)?.dir).toBe(OPPOSITE_DIRECTION[dirBefore]);
  });

  it('keeps the calibrated delay for a press at the start of the step on a DAT-style level', () => {
    const engine = load(tankRoom('cc'));
    engine.tick();
    expect(engine.attemptPlayerMove('E')).toBe(true);
    expect(markOf(engine)).toBeGreaterThan(world(engine).ccMonsterClock);
  });
});
