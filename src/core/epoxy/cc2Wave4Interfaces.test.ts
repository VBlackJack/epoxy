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
 * The state the CC2 wave 4 rules stand on: the brown-button hold and the pulse and brown step-end effects. None of them
 * changes a play by itself; absent, every key and hash is what it was.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { room } from '../../test/cc2Room';
import { GameEngine } from '../GameEngine';
import { cc2HiddenStateKey, cc3dArrivalKey, copyCc3dArrival, type EpoxyWorld } from './epoxyWorld';
import { leaveSplash, splashBarsPlayer } from './epoxyBlocks';

beforeEach(() => {
  loadTestConfigs();
});

const BROWN_CELL = 19;
const CHIP_POINT = { x: 1, y: 2 };
const PULSE_POINT = { x: 3, y: 4 };
const BROWN_POINT = { x: 5, y: 6 };

const world = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;

function load(): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(room({ mode: 'cc2' }));
  return engine;
}

describe('brown button hold', () => {
  it('starts absent and reads as no CC2 wave state', () => {
    const engine = load();
    expect(world(engine).cc2BrownHeld).toBeUndefined();
    expect(engine.getCc2WaveState()?.brownHeld).toBeUndefined();
  });

  it('enters the search key and the wave state only when set', () => {
    const engine = load();
    const unset = cc2HiddenStateKey(world(engine));
    world(engine).cc2BrownHeld = [BROWN_CELL];
    expect(cc2HiddenStateKey(world(engine))).not.toBe(unset);
    expect(engine.getCc2WaveState()?.brownHeld).toEqual([BROWN_CELL]);
    world(engine).cc2BrownHeld = undefined;
    expect(cc2HiddenStateKey(world(engine))).toBe(unset);
  });

  it('is reset when another level loads in the same world', () => {
    const engine = load();
    world(engine).cc2BrownHeld = [BROWN_CELL];
    engine.loadLevel(room({ mode: 'cc2' }));
    expect(world(engine).cc2BrownHeld).toBeUndefined();
  });

  it('is saved with the undo snapshot and dropped by an undo to a snapshot without it', () => {
    const engine = load();
    world(engine).cc2BrownHeld = [BROWN_CELL];
    expect(engine.attemptPlayerMove('E')).toBe(true);
    world(engine).cc2BrownHeld = undefined;
    expect(engine.undo()).toBe(true);
    expect(world(engine).cc2BrownHeld).toEqual([BROWN_CELL]);

    const plain = load();
    expect(plain.attemptPlayerMove('E')).toBe(true);
    world(plain).cc2BrownHeld = [BROWN_CELL];
    expect(plain.undo()).toBe(true);
    expect(world(plain).cc2BrownHeld).toBeUndefined();
  });
});

describe('player arrival pulse and brown', () => {
  it('are copied, and the copy shares nothing with the original', () => {
    const arrival = { pulse: { ...PULSE_POINT }, brown: { ...BROWN_POINT } };
    const copy = copyCc3dArrival(arrival);
    expect(copy).toEqual(arrival);
    copy.pulse!.x += 1;
    expect(arrival.pulse.x).toBe(PULSE_POINT.x);
  });

  it('leave the key unchanged while absent and change it when set', () => {
    const w = world(load());
    w.player.cc3dArrival = { chip: { ...CHIP_POINT } };
    const absent = cc3dArrivalKey(w);
    w.player.cc3dArrival = { chip: { ...CHIP_POINT }, pulse: { ...PULSE_POINT } };
    const withPulse = cc3dArrivalKey(w);
    w.player.cc3dArrival = { chip: { ...CHIP_POINT }, brown: { ...BROWN_POINT } };
    const withBrown = cc3dArrivalKey(w);
    expect(new Set([absent, withPulse, withBrown]).size).toBe(3);
    expect(absent).toBe('0:-:1.2:-');
  });

  it('survive an undo snapshot of the step under way', () => {
    const engine = load();
    const w = world(engine);
    w.player.cc3dArrival = { pulse: { ...PULSE_POINT }, brown: { ...BROWN_POINT } };
    // The pending effects of a step that is over act at the start of any input, so the snapshot is taken directly.
    engine.saveUndoSnapshot();
    w.player.cc3dArrival = undefined;
    expect(engine.undo()).toBe(true);
    expect(world(engine).player.cc3dArrival?.pulse).toEqual(PULSE_POINT);
    expect(world(engine).player.cc3dArrival?.brown).toEqual(BROWN_POINT);
  });
});

describe('leaveSplash', () => {
  it('bars the player from the cell and leaves no blast', () => {
    const w = world(load());
    leaveSplash(w, PULSE_POINT.x, PULSE_POINT.y);
    expect(splashBarsPlayer(w, PULSE_POINT.x, PULSE_POINT.y)).toBe(true);
    expect(w.blockExplosions.size).toBe(0);
  });
});
