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
import { CC_TELEPORT_DELAY_TICKS } from './epoxyTeleports';
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

function room(opts: { cc: boolean; blockExit?: boolean }): CompiledLevel {
  const terrain: string[][] = Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x) => (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? 'wall' : 'floor'))
  );
  terrain[ROW][NEAR_PAD] = 'teleport';
  terrain[ROW][FAR_PAD] = 'teleport';
  if (opts.blockExit === true) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) terrain[ROW + dy][FAR_PAD + dx] = 'wall';
  }
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

describe('classic teleport timing', () => {
  it('charges the pad time on top of the step on a classic level', () => {
    const { engine, walk } = load(room({ cc: true }));
    expect(engine.attemptPlayerMove('E')).toBe(true);
    const p = engine.getPlayer();
    expect(p.x).toBe(FAR_PAD + 1);
    expect(p.y).toBe(ROW);
    expect(p.moveCooldown).toBe(walk + CC_TELEPORT_DELAY_TICKS);
  });

  it('leaves a native level at the plain walking cadence', () => {
    const { engine, walk } = load(room({ cc: false }));
    expect(engine.attemptPlayerMove('E')).toBe(true);
    expect(engine.getPlayer().x).toBe(FAR_PAD + 1);
    expect(engine.getPlayer().moveCooldown).toBe(walk);
  });

  it('charges nothing for a plain step on a classic level', () => {
    const { engine, walk } = load(room({ cc: true }));
    expect(engine.attemptPlayerMove('W')).toBe(true);
    expect(engine.getPlayer().moveCooldown).toBe(walk);
  });

  it('charges no delay when the only usable exit is the entered pad', () => {
    const { engine, walk } = load(room({ cc: true, blockExit: true }));
    expect(engine.attemptPlayerMove('E')).toBe(true);
    const p = engine.getPlayer();
    expect(p.x).toBe(NEAR_PAD + 1);
    expect(p.moveCooldown).toBe(walk);
  });

  it('rolls the delay back with undo', () => {
    const { engine } = load(room({ cc: true }));
    expect(engine.attemptPlayerMove('E')).toBe(true);
    expect(engine.undo()).toBe(true);
    const p = engine.getPlayer();
    expect(p.x).toBe(START_X);
    expect(p.moveCooldown).toBe(0);
  });

  it('plays the same way twice', () => {
    const run = (): number[] => {
      const { engine } = load(room({ cc: true }));
      engine.attemptPlayerMove('E');
      const trace: number[] = [];
      for (let i = 0; i < IDLE_TICKS; i++) {
        engine.tick();
        trace.push(engine.getPlayer().moveCooldown);
      }
      return trace;
    };
    expect(run()).toEqual(run());
  });
});
