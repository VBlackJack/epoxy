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
import { beforeEach, describe, expect, it } from 'vitest';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { buildTestLevel } from '../../test/buildTestLevel';
import { GameEngine } from '../GameEngine';
import { cc2PlayerViewKey, copyCc2PlayerView, copyCc3dArrival } from './epoxyWorld';
import type { EpoxyWorld } from './epoxyWorld';
import { recordCc2PlayerView, resetCc2PlayerView } from './epoxyPlayer';
import type { Cc2LevelData, Cc2PlayerView, Cc3dPlayerArrival } from '../types';

beforeEach(() => {
  loadTestConfigs();
});

const CC2_RECORD = { v: 1, sha256: 'ab'.repeat(32), file: 'one.c2m', order: 1, gridHash: 'x' } as Cc2LevelData;

function cc2World(): EpoxyWorld {
  const built = buildTestLevel(['#####', '#...#', '#####']);
  const engine = new GameEngine();
  engine.loadLevel({ ...built, playerStart: { x: 2, y: 1, dir: 'E' }, cc2: CC2_RECORD });
  return (engine as unknown as { w: EpoxyWorld }).w;
}

describe('CC2 player view and step-end opening state', () => {
  it('copies the opening cell of a pending step end without sharing it', () => {
    const arrival: Cc3dPlayerArrival = { opening: { x: 3, y: 4 } };
    const copy = copyCc3dArrival(arrival);
    expect(copy).toEqual(arrival);
    expect(copy.opening).not.toBe(arrival.opening);
  });

  it('copies the player view with its source pad without sharing it', () => {
    const view: Cc2PlayerView = { x: 1, y: 2, dir: 'E', cooldown: 2, stepLength: 4, sourcePad: { x: 5, y: 6 } };
    const copy = copyCc2PlayerView(view);
    expect(copy).toEqual(view);
    expect(copy.sourcePad).not.toBe(view.sourcePad);
  });

  it('keeps the wait the player has left when control passes to him mid-step', () => {
    const w = cc2World();
    w.player.moveCooldown = 3;
    resetCc2PlayerView(w);
    expect(w.cc2PlayerView).toMatchObject({ cooldown: 3, stepLength: 3 });
    // The next record counts the wait down against the same step length, not a whole cell behind him.
    w.player.moveCooldown = 2;
    recordCc2PlayerView(w);
    expect(w.cc2PlayerView).toMatchObject({ cooldown: 2, stepLength: 3 });
  });

  it('shows a player at rest on his cell after a hand-off', () => {
    const w = cc2World();
    resetCc2PlayerView(w);
    expect(w.cc2PlayerView).toMatchObject({ cooldown: 0, stepLength: 1 });
  });

  it('leaves a player whose forced step was refused on his cell', () => {
    const w = cc2World();
    resetCc2PlayerView(w);
    w.player.isSliding = true;
    w.player.slideCooldown = 4;
    recordCc2PlayerView(w);
    expect(w.cc2PlayerView).toMatchObject({ cooldown: 0, stepLength: 1 });
  });

  it('stores the step length of a player at rest as 1, whatever his last step was', () => {
    const w = cc2World();
    w.cc2PlayerView = { x: 2, y: 1, dir: 'E', cooldown: 1, stepLength: 5 };
    w.player.moveCooldown = 0;
    recordCc2PlayerView(w);
    expect(w.cc2PlayerView).toMatchObject({ cooldown: 0, stepLength: 1 });
  });

  it('keys equivalent states at rest the same, whatever the stored step length', () => {
    const a = cc2World();
    const b = cc2World();
    a.cc2PlayerView = { x: 2, y: 1, dir: 'E', cooldown: 0, stepLength: 1 };
    b.cc2PlayerView = { x: 2, y: 1, dir: 'E', cooldown: 0, stepLength: 6 };
    expect(cc2PlayerViewKey(a)).toBe(cc2PlayerViewKey(b));
    b.cc2PlayerView = { x: 2, y: 1, dir: 'E', cooldown: 2, stepLength: 6 };
    expect(cc2PlayerViewKey(a)).not.toBe(cc2PlayerViewKey(b));
  });
});
