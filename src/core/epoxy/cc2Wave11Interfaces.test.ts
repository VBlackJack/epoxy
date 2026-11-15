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
 * CC2 wave 11 state: RuntimeEntity.cc2Frame (the Lexy frame at which a clone released by a wire ends its move, game.js:2218-2242
 * and 872-888) survives an undo round trip, is part of the hidden state key, and leaves a world without it unchanged.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { ROOM_ROW, room } from '../../test/cc2Room';
import { GameEngine } from '../GameEngine';
import { stableStringify } from '../engineSimHash';
import type { RuntimeEntity } from '../types';
import { cc2HiddenStateKey, type EpoxyWorld } from './epoxyWorld';

beforeEach(() => {
  loadTestConfigs();
});

const BLOCK_X = 6;
const FRAMES: readonly (0 | 2)[] = [0, 2];

const world = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;

function engineWithBlock(): { engine: GameEngine; block: RuntimeEntity } {
  const engine = new GameEngine();
  engine.loadLevel(room({ mode: 'cc2', entities: [{ x: BLOCK_X, y: ROOM_ROW, type: 'dirt_block', dir: 'E' }] }));
  const block = world(engine).entities.find((e) => e.kind === 'block');
  if (block === undefined) throw new Error('the room has no block');
  return { engine, block };
}

describe('RuntimeEntity.cc2Frame', () => {
  it('leaves the hidden key and the entity JSON of a world without it unchanged', () => {
    const { engine } = engineWithBlock();
    expect(cc2HiddenStateKey(world(engine))).not.toMatch(/F\d/);
    expect(stableStringify(engine.getEntities())).not.toContain('cc2Frame');
  });

  it.each(FRAMES)('is told apart by the hidden key at frame %i', (frame) => {
    const { engine, block } = engineWithBlock();
    const without = cc2HiddenStateKey(world(engine));
    block.cc2Frame = frame;
    expect(cc2HiddenStateKey(world(engine))).not.toBe(without);
    delete block.cc2Frame;
    expect(cc2HiddenStateKey(world(engine))).toBe(without);
  });

  it('tells frame 0 from frame 2', () => {
    const { engine, block } = engineWithBlock();
    block.cc2Frame = 0;
    const zero = cc2HiddenStateKey(world(engine));
    block.cc2Frame = 2;
    expect(cc2HiddenStateKey(world(engine))).not.toBe(zero);
  });

  it.each(FRAMES)('survives a snapshot and restore at frame %i', (frame) => {
    const { engine, block } = engineWithBlock();
    block.cc2Frame = frame;
    const snap = engine.captureState();
    delete block.cc2Frame;
    engine.restoreState(snap);
    const restored = world(engine).entities.find((e) => e.kind === 'block');
    expect(restored?.cc2Frame).toBe(frame);
    expect(cc2HiddenStateKey(world(engine))).toContain(`F${restored?.uid}${frame}`);
  });
});
