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
 * The state the CC2 wave 9 rules stand on: the actor order flag, the stored input, the trap that was shut at the player's last
 * turn and the two turn hooks. None of it changes a play by itself; absent, every key, snapshot and hash is what it was.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { room } from '../../test/cc2Room';
import { GameEngine } from '../GameEngine';
import type { Cc2PendingDecision } from '../types';
import { slidePushesAhead } from './epoxyBlocks';
import { decisionPush } from './epoxyPlayer';
import { cc2HiddenStateKey, type EpoxyContext, type EpoxyWorld } from './epoxyWorld';
import { hasCc2MirrorCadence } from './epoxyMirrors';

beforeEach(() => {
  loadTestConfigs();
});

const world = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;
const contextOf = (engine: GameEngine): EpoxyContext => (engine as unknown as { ctx: EpoxyContext }).ctx;

function load(mode: 'cc2' | 'cc' | 'native', entities: { type: string; x: number; y: number; dir: 'N' }[] = []): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(room({ mode, entities }));
  return engine;
}

describe('actor order flag', () => {
  it('is set once at load on a CC2-engine level, mirror or not, and on no other', () => {
    expect(world(load('cc2')).cc2ActorOrder).toBe(true);
    expect(world(load('cc2', [{ type: 'mirror_chip', x: 3, y: 3, dir: 'N' }])).cc2ActorOrder).toBe(true);
    expect(world(load('cc')).cc2ActorOrder).toBeUndefined();
    expect(world(load('native')).cc2ActorOrder).toBeUndefined();
  });

  it('keeps the mirror cadence to the levels with a mirror, whatever the ordinals', () => {
    const plain = load('cc2');
    expect(world(plain).player.listOrdinal).toBeDefined();
    expect(hasCc2MirrorCadence(world(plain))).toBe(false);
    expect(hasCc2MirrorCadence(world(load('cc2', [{ type: 'mirror_chip', x: 3, y: 3, dir: 'N' }])))).toBe(true);
  });
});

describe('stored input', () => {
  const pending: Cc2PendingDecision = { dirs: ['E', 'N'], held: true, tick: 3, actions: [{ kind: 'drop', itemId: null }, { kind: 'cycle' }] };

  it('starts absent, enters the key and the snapshot only when set, and comes back from a restore', () => {
    const engine = load('cc2');
    const unset = cc2HiddenStateKey(world(engine));
    expect(world(engine).cc2PendingDecision).toBeUndefined();
    expect(engine.captureState().cc2PendingDecision).toBeUndefined();
    world(engine).cc2PendingDecision = pending;
    expect(cc2HiddenStateKey(world(engine))).not.toBe(unset);
    const snap = engine.captureState();
    expect(snap.cc2PendingDecision).toEqual(pending);
    expect(snap.cc2PendingDecision).not.toBe(pending);
    world(engine).cc2PendingDecision = undefined;
    engine.restoreState(snap);
    expect(world(engine).cc2PendingDecision).toEqual(pending);
    engine.restoreState({ ...snap, cc2PendingDecision: undefined });
    expect(world(engine).cc2PendingDecision).toBeUndefined();
  });

  it('is dropped when another level loads', () => {
    const engine = load('cc2');
    world(engine).cc2PendingDecision = pending;
    engine.loadLevel(room({ mode: 'cc2' }));
    expect(world(engine).cc2PendingDecision).toBeUndefined();
  });
});

describe('trap shut at the last turn', () => {
  it('enters the key and the snapshot only while true', () => {
    const engine = load('cc2');
    const unset = cc2HiddenStateKey(world(engine));
    expect(engine.captureState().player.trapShutAtTurn).toBeUndefined();
    world(engine).player.trapShutAtTurn = true;
    expect(cc2HiddenStateKey(world(engine))).not.toBe(unset);
    const snap = engine.captureState();
    expect(snap.player.trapShutAtTurn).toBe(true);
    delete world(engine).player.trapShutAtTurn;
    engine.restoreState(snap);
    expect(world(engine).player.trapShutAtTurn).toBe(true);
  });
});

describe('turn hooks and stubs', () => {
  it('leaves the player turn hooks and the last turn silent', () => {
    const engine = load('cc2');
    expect(contextOf(engine).cc2PlayerDecides).toBeTypeOf('function');
    expect(contextOf(engine).cc2PlayerActs).toBeTypeOf('function');
    expect(engine.getLastPlayerTurn()).toBeUndefined();
    engine.tick();
    expect(engine.getLastPlayerTurn()).toBeUndefined();
  });

  it('exports the push helper and a decision push that does nothing yet', () => {
    expect(slidePushesAhead).toBeTypeOf('function');
    const engine = load('cc2');
    const before = JSON.stringify(engine.captureState());
    const moving = new Set<number>();
    decisionPush(contextOf(engine), ['E'], moving);
    expect(JSON.stringify(engine.captureState())).toBe(before);
    expect(moving.size).toBe(0);
  });
});
