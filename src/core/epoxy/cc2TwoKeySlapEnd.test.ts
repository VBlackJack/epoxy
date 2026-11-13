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

/** A slap that kills the player or ends the level stops the two-key move there: no step follows it. */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

const slapEffect = vi.hoisted(() => ({ run: (_world: unknown): void => undefined }));

vi.mock('./epoxyPlayer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./epoxyPlayer')>();
  return {
    ...actual,
    slapBlockAhead: (ctx: { world: unknown }) => {
      slapEffect.run(ctx.world);
      return true;
    }
  };
});

import { ROOM_ROW, room } from '../../test/cc2Room';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { GameEngine } from '../GameEngine';
import type { EpoxyWorld } from './epoxyWorld';

beforeEach(() => {
  loadTestConfigs();
  slapEffect.run = () => undefined;
});

const START_X = 5;

function load(): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(room({ mode: 'cc2', startX: START_X }));
  return engine;
}

describe('a slap that ends the play', () => {
  it('stops after a slap that killed the player: no step, one record, one undo step', () => {
    const engine = load();
    slapEffect.run = (world) => {
      (world as EpoxyWorld).player.alive = false;
    };
    expect(engine.attemptPlayerMoveHeld!(['E', 'S'])).toBe(false);
    expect(engine.getPlayer()).toMatchObject({ x: START_X, y: ROOM_ROW });
    expect(engine.getTimedMoveHistory()).toEqual([{ tick: 0, dir: 'E', alt: 'S' }]);
    expect(engine.canUndo()).toBe(true);
  });

  it('stops after a slap that completed the level', () => {
    const engine = load();
    slapEffect.run = (world) => {
      (world as EpoxyWorld).levelCompleted = true;
    };
    expect(engine.attemptPlayerMoveHeld!(['E', 'S'])).toBe(false);
    expect(engine.getPlayer()).toMatchObject({ x: START_X, y: ROOM_ROW });
    expect(engine.getTimedMoveHistory()).toEqual([{ tick: 0, dir: 'E', alt: 'S' }]);
  });
});
