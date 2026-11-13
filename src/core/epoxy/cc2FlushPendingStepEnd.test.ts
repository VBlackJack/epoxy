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
 * GameEngine.flushPendingStepEnd: letting the pending step-end effects act right after a tick is the same as letting
 * the next tick or input do it, so the live game can show the state after them without changing a replay.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { ROOM_ROW, room, type RoomMode } from '../../test/cc2Room';
import { GameEngine } from '../GameEngine';
import { stableStringify } from '../engineSimHash';
import type { Direction } from '../types';
import { cc2HiddenStateKey, type EpoxyWorld } from './epoxyWorld';

beforeEach(() => {
  loadTestConfigs();
});

const BUTTON_X = 3;
const CHIP_X = 4;
const TRAP_X = 9;
const TRAP_Y = 9;
const WAIT_TICKS = 30;
const SCRIPT: Direction[] = ['E', 'E', 'N', 'S', 'W'];

const world = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;

function load(mode: RoomMode): GameEngine {
  const level = room({
    mode,
    terrain: { [`${BUTTON_X},${ROOM_ROW}`]: 'button_brown', [`${TRAP_X},${TRAP_Y}`]: 'trap' },
    items: { [`${CHIP_X},${ROOM_ROW}`]: 'chip' },
    chipsRequired: 1
  });
  level.trapLinks = [{ buttonX: BUTTON_X, buttonY: ROOM_ROW, trapX: TRAP_X, trapY: TRAP_Y }];
  const engine = new GameEngine();
  engine.loadLevel(level);
  return engine;
}

/** Everything the simulation hash reads, plus the hidden key, as one string. */
function fingerprint(engine: GameEngine): string {
  return `${stableStringify(engine.captureState())}|${cc2HiddenStateKey(world(engine))}`;
}

function waitOut(engine: GameEngine, flush: boolean): void {
  for (let i = 0; i < WAIT_TICKS && engine.getPlayer().moveCooldown > 0; i++) {
    engine.tick();
    if (flush) engine.flushPendingStepEnd();
  }
}

/** The state after each scripted move once the next input has run; `flush` interposes a flush after every tick. */
function run(mode: RoomMode, flush: boolean): string[] {
  const engine = load(mode);
  const trace: string[] = [];
  for (const dir of SCRIPT) {
    engine.attemptPlayerMove(dir);
    trace.push(fingerprint(engine));
    waitOut(engine, flush);
    if (flush) engine.flushPendingStepEnd();
    engine.tick();
    trace.push(fingerprint(engine));
  }
  return trace;
}

describe('flushPendingStepEnd', () => {
  it('flushing after the ticks then ticking equals ticking alone (identical state at every input and tick)', () => {
    expect(run('cc2', true)).toEqual(run('cc2', false));
  });

  it('is idempotent', () => {
    const engine = load('cc2');
    engine.attemptPlayerMove('E');
    waitOut(engine, false);
    engine.flushPendingStepEnd();
    const once = fingerprint(engine);
    engine.flushPendingStepEnd();
    expect(fingerprint(engine)).toBe(once);
  });

  it('takes the chip of the cell the step ended on without waiting for the next tick', () => {
    const engine = load('cc2');
    engine.attemptPlayerMove('E');
    waitOut(engine, false);
    engine.attemptPlayerMove('E');
    waitOut(engine, false);
    expect(engine.getChipsRemaining()).toBe(1);
    engine.flushPendingStepEnd();
    expect(engine.getChipsRemaining()).toBe(0);
  });

  it.each(['cc', 'native'] as const)('is a no-op on a %s level', (mode) => {
    const engine = load(mode);
    engine.attemptPlayerMove('E');
    engine.tick();
    const before = fingerprint(engine);
    engine.flushPendingStepEnd();
    expect(fingerprint(engine)).toBe(before);
  });
});
