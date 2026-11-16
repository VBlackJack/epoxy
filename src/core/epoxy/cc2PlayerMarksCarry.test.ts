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
 * CC2 engine, wave 15: the player frame marks (cc2SlideFrame, cc2FrameRetry, cc2PrePassMoved) ride the undo snapshot of the
 * controlled and the parked players, the parked part of the search key, and a restart clears them.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { room, ROOM_ROW } from '../../test/cc2Room';
import { GameEngine } from '../GameEngine';
import type { CompiledLevel } from '../types';
import type { EpoxyWorld } from './epoxyWorld';

beforeEach(() => {
  loadTestConfigs();
});

const CONTROLLED_X = 6;
const PARKED_X = 4;

const worldOf = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;

function twoPlayerLevel(): CompiledLevel {
  return {
    ...room({ mode: 'cc2', startX: CONTROLLED_X }),
    extraPlayers: [{ x: PARKED_X, y: ROOM_ROW, dir: 'W' as const, character: 'chip' as const }]
  };
}

function twoPlayers(): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(twoPlayerLevel());
  return engine;
}

describe('player frame marks: undo snapshot', () => {
  it('a capture and restore round trip keeps the marks of both players', () => {
    const engine = twoPlayers();
    const w = worldOf(engine);
    w.player.cc2SlideFrame = 1;
    w.player.cc2FrameRetry = true;
    w.parked[0].cc2PrePassMoved = true;
    w.parked[0].cc2SlideFrame = 0;
    const snap = engine.captureState();
    for (const p of [w.player, ...w.parked]) {
      delete p.cc2SlideFrame;
      delete p.cc2FrameRetry;
      delete p.cc2PrePassMoved;
    }
    engine.restoreState(snap);
    const after = worldOf(engine);
    expect(after.player.cc2SlideFrame).toBe(1);
    expect(after.player.cc2FrameRetry).toBe(true);
    expect('cc2PrePassMoved' in after.player).toBe(false);
    expect(after.parked[0].cc2SlideFrame).toBe(0);
    expect(after.parked[0].cc2PrePassMoved).toBe(true);
    expect('cc2FrameRetry' in after.parked[0]).toBe(false);
  });

  it('an unmarked player snapshots without the fields', () => {
    const engine = twoPlayers();
    const snap = engine.captureState();
    for (const p of [snap.player, ...(snap.parked ?? [])]) {
      expect('cc2SlideFrame' in p).toBe(false);
      expect('cc2FrameRetry' in p).toBe(false);
      expect('cc2PrePassMoved' in p).toBe(false);
    }
  });

  it('the parked part of the search key carries the marks of a parked player', () => {
    const engine = twoPlayers();
    const key = (): string => (engine as unknown as { playersStateKey: () => string }).playersStateKey();
    const bare = key();
    const w = worldOf(engine);
    w.parked[0].cc2SlideFrame = 1;
    const slide = key();
    w.parked[0].cc2FrameRetry = true;
    const retry = key();
    w.parked[0].cc2PrePassMoved = true;
    const moved = key();
    expect(new Set([bare, slide, retry, moved]).size).toBe(4);
  });

  it('a restart clears the marks and the pre-pass player transient', () => {
    const engine = twoPlayers();
    const w = worldOf(engine);
    w.player.cc2FrameRetry = true;
    w.parked[0].cc2PrePassMoved = true;
    w.cc2PrePassPlayer = true;
    engine.loadLevel(twoPlayerLevel());
    const after = worldOf(engine);
    for (const p of [after.player, ...after.parked]) {
      expect('cc2SlideFrame' in p).toBe(false);
      expect('cc2FrameRetry' in p).toBe(false);
      expect('cc2PrePassMoved' in p).toBe(false);
    }
    expect(after.cc2PrePassPlayer).toBeUndefined();
  });

  it('the pre-pass player transient never crosses a restore', () => {
    const engine = twoPlayers();
    const snap = engine.captureState();
    worldOf(engine).cc2PrePassPlayer = true;
    engine.restoreState(snap);
    expect(worldOf(engine).cc2PrePassPlayer).toBeUndefined();
  });
});
