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
 * CC2 wave 4: a fireball melts the ice block it bumps (Lexy ice_block.on_after_bumped), on floor or a no-sign alone, even
 * mid step, and the splash it leaves bars the player. Native and classic levels keep their rules.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { room, ROOM_ROW, type RoomMode } from '../../test/cc2Room';
import { GameEngine } from '../GameEngine';
import { splashBarsPlayer } from './epoxyBlocks';
import type { EpoxyWorld } from './epoxyWorld';
import type { CompiledLevel } from '../types';

beforeEach(() => {
  loadTestConfigs();
});

const world = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;

const FIREBALL_X = 6;
const ICE_X = 5;
const TICKS = 12;
const NO_SIGN = 'forbid_key_red';

function meltRoom(mode: RoomMode, terrainAtIce?: string): CompiledLevel {
  return room({
    mode,
    startX: 2,
    terrain: terrainAtIce === undefined ? {} : { [`${ICE_X},${ROOM_ROW}`]: terrainAtIce },
    entities: [
      { type: 'ice_block', x: ICE_X, y: ROOM_ROW, dir: 'E' },
      { type: 'fireball', x: FIREBALL_X, y: ROOM_ROW, dir: 'W' }
    ]
  });
}

const iceLeft = (engine: GameEngine): boolean => world(engine).entities.some((e) => e.type === 'ice_block');
const terrainAt = (engine: GameEngine): string => world(engine).terrain[ROOM_ROW][ICE_X];

function run(level: CompiledLevel, ticks: number, prepare?: (w: EpoxyWorld) => void): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(level);
  prepare?.(world(engine));
  for (let i = 0; i < ticks; i += 1) engine.tick();
  return engine;
}

/** Ticks until the ice block is gone, stopping on the tick it melts; the engine is returned as it stands then. */
function runUntilMelted(level: CompiledLevel): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(level);
  for (let i = 0; i < TICKS && iceLeft(engine); i += 1) engine.tick();
  return engine;
}

describe('CC2 engine: a fireball melts the ice block it bumps', () => {
  it('melts a block on floor into water and bars the player from the splash', () => {
    const engine = runUntilMelted(meltRoom('cc2'));
    expect(iceLeft(engine)).toBe(false);
    expect(terrainAt(engine)).toBe('water');
    expect(splashBarsPlayer(world(engine), ICE_X, ROOM_ROW)).toBe(true);
  });

  it('melts a block on a no-sign, which counts as floor', () => {
    const engine = run(meltRoom('cc2', NO_SIGN), TICKS);
    expect(iceLeft(engine)).toBe(false);
    expect(terrainAt(engine)).toBe('water');
  });

  it('leaves a block on any other terrain as it is', () => {
    const engine = run(meltRoom('cc2', 'ice'), TICKS);
    expect(iceLeft(engine)).toBe(true);
    expect(terrainAt(engine)).toBe('ice');
  });

  it('melts a block that is mid step', () => {
    const engine = run(meltRoom('cc2'), TICKS, (w) => {
      const block = w.entities.find((e) => e.type === 'ice_block');
      if (block !== undefined) block.isSliding = true;
    });
    expect(iceLeft(engine)).toBe(false);
    expect(terrainAt(engine)).toBe('water');
  });

  it('is not a rule of a native level nor of a classic one', () => {
    for (const mode of ['native', 'cc'] as const) {
      const engine = run(meltRoom(mode), TICKS);
      expect(iceLeft(engine)).toBe(true);
      expect(terrainAt(engine)).toBe('floor');
    }
  });
});
