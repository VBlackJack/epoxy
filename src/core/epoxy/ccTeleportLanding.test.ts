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

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { GameEngine } from '../GameEngine';
import type { CompiledLevel } from '../types';
import { playerWalkCooldown } from './epoxyPlayer';
import type { EpoxyWorld } from './epoxyWorld';

beforeEach(() => {
  loadTestConfigs();
});

const SIZE = 13;
const ROW = 5;
const START_X = 2;
const NEAR_PAD = 3;
const FAR_PAD = 8;
const TIME_LIMIT_SECONDS = 200;
const IDLE_TICKS = 12;
const MAX_WAIT_TICKS = 40;

function room(opts: { cc: boolean }): CompiledLevel {
  const terrain: string[][] = Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x) => (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? 'wall' : 'floor'))
  );
  terrain[ROW][NEAR_PAD] = 'teleport';
  terrain[ROW][FAR_PAD] = 'teleport';
  return {
    id: 'cc_teleport_room',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: TIME_LIMIT_SECONDS,
    chipsRequired: 0,
    playerStart: { x: START_X, y: ROW, dir: 'E' },
    terrain,
    items: Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null)),
    entities: [],
    trapLinks: [],
    cloneLinks: [],
    ...(opts.cc ? { rulesFlavor: 'cc' as const } : {})
  };
}

function load(level: CompiledLevel): { engine: GameEngine; walk: number } {
  const engine = new GameEngine();
  engine.loadLevel(level);
  const world = (engine as unknown as { w: EpoxyWorld }).w;
  return { engine, walk: playerWalkCooldown(world) };
}

function world(engine: GameEngine): EpoxyWorld {
  return (engine as unknown as { w: EpoxyWorld }).w;
}

/** Ticks until the player's wait is over. */
function waitOut(engine: GameEngine): void {
  for (let i = 0; i < MAX_WAIT_TICKS && engine.getPlayer().moveCooldown > 0; i++) engine.tick();
}

describe('classic teleport landing', () => {
  it('lands the player on the destination pad and leaves by a forced step after the walking wait', () => {
    const { engine, walk } = load(room({ cc: true }));
    expect(engine.attemptPlayerMove('E')).toBe(true);
    let p = engine.getPlayer();
    expect(p.x).toBe(FAR_PAD);
    expect(p.y).toBe(ROW);
    expect(p.teleportExit).toBe('E');
    expect(p.moveCooldown).toBe(walk);
    // No move of his own while he waits on the pad.
    expect(engine.attemptPlayerMove('N')).toBe(false);
    for (let i = 0; i < walk - 1; i++) engine.tick();
    expect(engine.getPlayer().x).toBe(FAR_PAD);
    engine.tick();
    p = engine.getPlayer();
    expect(p.x).toBe(FAR_PAD + 1);
    expect(p.teleportExit).toBeUndefined();
    expect(p.moveCooldown).toBe(walk);
  });

  it('leaves a native level jumping straight to the exit cell', () => {
    const { engine, walk } = load(room({ cc: false }));
    expect(engine.attemptPlayerMove('E')).toBe(true);
    const p = engine.getPlayer();
    expect(p.x).toBe(FAR_PAD + 1);
    expect(p.teleportExit).toBeUndefined();
    expect(p.moveCooldown).toBe(walk);
  });

  it('stays on the pad when the forced exit is blocked, and takes input again', () => {
    const { engine } = load(room({ cc: true }));
    expect(engine.attemptPlayerMove('E')).toBe(true);
    world(engine).terrain[ROW][FAR_PAD + 1] = 'wall';
    waitOut(engine);
    const p = engine.getPlayer();
    expect(p.x).toBe(FAR_PAD);
    expect(p.teleportExit).toBeUndefined();
    expect(engine.attemptPlayerMove('N')).toBe(true);
  });

  it('tries only the entered direction when picking a pad', () => {
    const { engine } = load(room({ cc: true }));
    const w = world(engine);
    // Wall the far pad's east exit: the pad is refused (only the entered direction counts) and the entered pad is used.
    w.terrain[ROW][FAR_PAD + 1] = 'wall';
    expect(engine.attemptPlayerMove('E')).toBe(true);
    expect(engine.getPlayer().x).toBe(NEAR_PAD);
    expect(engine.getPlayer().teleportExit).toBe('E');
  });

  it('rolls the landing back with undo', () => {
    const { engine } = load(room({ cc: true }));
    expect(engine.attemptPlayerMove('E')).toBe(true);
    expect(engine.undo()).toBe(true);
    const p = engine.getPlayer();
    expect(p.x).toBe(START_X);
    expect(p.teleportExit).toBeUndefined();
    expect(p.moveCooldown).toBe(0);
  });

  it('restores a player waiting on a pad when undoing a later move', () => {
    const { engine } = load(room({ cc: true }));
    engine.attemptPlayerMove('E');
    waitOut(engine);
    waitOut(engine);
    expect(engine.attemptPlayerMove('S')).toBe(true);
    expect(engine.undo()).toBe(true);
    expect(engine.getPlayer().x).toBe(FAR_PAD + 1);
  });

  it('plays the same way twice', () => {
    const run = (): string[] => {
      const { engine } = load(room({ cc: true }));
      engine.attemptPlayerMove('E');
      const trace: string[] = [];
      for (let i = 0; i < IDLE_TICKS; i++) {
        engine.tick();
        const p = engine.getPlayer();
        trace.push(`${p.x},${p.y},${p.moveCooldown}`);
      }
      return trace;
    };
    expect(run()).toEqual(run());
  });
});
