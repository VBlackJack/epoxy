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
 * CC2 engine: a monster that steps onto a teleporter goes through in its own turn of the pass where its step ends, lands on the
 * destination pad and leaves by the forced exit as its next decision, with no draw. The green pad keeps its step-start jump.
 * Lexy's Labyrinth game.js attempt_teleport.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { room, ROOM_ROW } from '../../test/cc2Room';
import type { RoomOptions } from '../../test/cc2Room';
import { CC_MONSTER_STEP_TICKS } from '../coreConstants';
import { GameEngine } from '../GameEngine';
import type { EpoxyWorld } from './epoxyWorld';

const PAD = 'teleport_forward';
const GREEN_PAD = 'teleport_random';
const ENTRY_X = 3;
const EXIT_PAD_X = 9;
const FAR_X = 11;
const MONSTER_START_X = 2;

beforeEach(() => {
  loadTestConfigs();
});

const world = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;

function load(opts: Partial<RoomOptions> = {}, pad = PAD): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(
    room({
      mode: 'cc2',
      startX: FAR_X,
      terrain: { [`${ENTRY_X},${ROOM_ROW}`]: pad, [`${EXIT_PAD_X},${ROOM_ROW}`]: pad, ...(opts.terrain ?? {}) },
      entities: [{ type: 'walker', x: MONSTER_START_X, y: ROOM_ROW, dir: 'E' }],
      ...opts
    })
  );
  return engine;
}

function tick(engine: GameEngine, count: number): void {
  for (let i = 0; i < count; i++) engine.tick();
}

const walker = (engine: GameEngine) => engine.getEntities().find((e) => e.type === 'walker');
const generators = (engine: GameEngine): string => JSON.stringify(world(engine).ccGenerators);

describe('CC2 monster teleport at the end of its step', () => {
  it('stays on the entry pad while its step lasts, lands on the destination pad when it ends, and leaves by the exit', () => {
    const engine = load();
    tick(engine, 1);
    expect(walker(engine)).toMatchObject({ x: ENTRY_X });
    tick(engine, CC_MONSTER_STEP_TICKS - 2);
    expect(walker(engine)).toMatchObject({ x: ENTRY_X });
    tick(engine, 1);
    expect(walker(engine)).toMatchObject({ x: EXIT_PAD_X, y: ROOM_ROW });
    tick(engine, 1);
    expect(walker(engine)).toMatchObject({ x: EXIT_PAD_X + 1, y: ROOM_ROW });
  });

  it('makes no draw for its forced exit, and a blocked exit waits one decision before it decides normally', () => {
    const engine = load();
    tick(engine, CC_MONSTER_STEP_TICKS);
    expect(walker(engine)).toMatchObject({ x: EXIT_PAD_X });
    // The way out closes after the monster landed.
    world(engine).terrain[ROOM_ROW][EXIT_PAD_X + 1] = 'wall';
    const before = generators(engine);
    tick(engine, 1);
    expect(walker(engine)).toMatchObject({ x: EXIT_PAD_X });
    expect(generators(engine)).toBe(before);
    tick(engine, 1);
    expect(generators(engine)).not.toBe(before);
  });

  it('keeps the step-start jump of the green pad', () => {
    const engine = load({}, GREEN_PAD);
    tick(engine, 1);
    expect(walker(engine)?.x).not.toBe(ENTRY_X);
  });

  it('keeps the step-start jump on a classic level that is not CC2', () => {
    const engine = load({ mode: 'cc' });
    tick(engine, 1);
    expect(walker(engine)?.x).not.toBe(ENTRY_X);
  });
});
