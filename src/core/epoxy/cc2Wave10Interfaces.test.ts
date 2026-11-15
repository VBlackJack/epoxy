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
 * The state the CC2 wave 10 rules stand on: the slide arrival and the pending push of a block. None of them changes a
 * play by itself; absent, every key and hash is what it was.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { room } from '../../test/cc2Room';
import { GameEngine } from '../GameEngine';
import { cc2HiddenStateKey, type EpoxyWorld } from './epoxyWorld';

beforeEach(() => {
  loadTestConfigs();
});

const world = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;

function load(): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(room({ mode: 'cc2', entities: [{ x: 6, y: 5, type: 'dirt_block', dir: 'E' }] }));
  return engine;
}

describe('wave 10 block state', () => {
  it('starts absent and leaves the key and the entity JSON as they were', () => {
    const engine = load();
    const block = world(engine).entities.find((e) => e.kind === 'block');
    expect(block).toBeDefined();
    expect(block?.cc2SlideArrived).toBeUndefined();
    expect(block?.cc2PendingPush).toBeUndefined();
    const baseline = cc2HiddenStateKey(world(engine));
    expect(baseline).not.toMatch(/(^|;)[aq][0-9]/);
    expect(JSON.stringify(engine.getEntities())).not.toContain('cc2');
  });

  it('enters the search key only when set, and clearing it restores the key', () => {
    const engine = load();
    const block = world(engine).entities.find((e) => e.kind === 'block')!;
    const bare = cc2HiddenStateKey(world(engine));
    block.cc2SlideArrived = true;
    const slid = cc2HiddenStateKey(world(engine));
    expect(slid).toBe(`${bare};a${block.uid}`);
    block.cc2PendingPush = 'N';
    const both = cc2HiddenStateKey(world(engine));
    expect(both).toContain(`q${block.uid}N`);
    expect(new Set([bare, slid, both]).size).toBe(3);
    block.cc2PendingPush = 'S';
    expect(cc2HiddenStateKey(world(engine))).not.toBe(both);
    delete block.cc2SlideArrived;
    delete block.cc2PendingPush;
    expect(cc2HiddenStateKey(world(engine))).toBe(bare);
  });

  it('survives a snapshot and a restore', () => {
    const engine = load();
    const block = world(engine).entities.find((e) => e.kind === 'block')!;
    block.cc2SlideArrived = true;
    block.cc2PendingPush = 'W';
    const snap = engine.captureState();
    delete block.cc2SlideArrived;
    delete block.cc2PendingPush;
    engine.restoreState(snap);
    const back = world(engine).entities.find((e) => e.uid === block.uid)!;
    expect(back.cc2SlideArrived).toBe(true);
    expect(back.cc2PendingPush).toBe('W');
  });
});

describe('teleport arrival state', () => {
  it('is already part of the search key: ccArrivals teleport entries ("j") and cc3dArrivalKey for players', () => {
    const engine = load();
    const w = world(engine);
    const bare = cc2HiddenStateKey(w);
    w.ccArrivals.push({ uid: 7, due: 1, teleport: true } as unknown as (typeof w.ccArrivals)[number]);
    expect(cc2HiddenStateKey(w)).not.toBe(bare);
  });
});
