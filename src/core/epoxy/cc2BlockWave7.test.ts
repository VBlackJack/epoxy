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
 * CC2 wave 7, blocks: a block at rest on a force floor is carried by it (FB, turning floors included), a melted ice block
 * leaves a splash that bars the real player (MS), a block boxed in on ice keeps bonking without a sound (IB), and the
 * block step reports a slide refused on a force floor (FB2). Every rule is off on classic and native levels.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { playSfx } = vi.hoisted(() => ({ playSfx: vi.fn() }));
vi.mock('../../audio/AudioManager', () => ({
  AudioManager: new Proxy({ playSfx, runSilently: <T>(task: () => T): T => task() } as Record<string, unknown>, {
    get: (target, name: string) => target[name] ?? (() => undefined)
  })
}));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { ROOM_ROW, room } from '../../test/cc2Room';
import type { RoomMode, RoomOptions } from '../../test/cc2Room';
import { GameEngine } from '../GameEngine';
import { stepSlidingBlock } from './epoxyBlocks';
import type { EpoxyContext, EpoxyWorld } from './epoxyWorld';

beforeEach(() => {
  loadTestConfigs();
  playSfx.mockClear();
});

const BLOCK = 'dirt_block';
const ICE_BLOCK = 'ice_block';
const FORCE_EAST = 'force_e';
const FORCE_CYCLE = 'force_cycle';
const FORCE_START_X = 5;
const WATCH_TICKS = 6;
const SPLASH_PASSES = 5;
const MELT_WAIT_PASSES = 8;
const FIRE_X = 4;
const ICE_X = 6;

const worldOf = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;
const ctxOf = (engine: GameEngine): EpoxyContext => (engine as unknown as { ctx: EpoxyContext }).ctx;

function forceRow(count: number): Record<string, string> {
  const row: Record<string, string> = {};
  for (let i = 0; i < count; i++) row[`${FORCE_START_X + i},${ROOM_ROW}`] = FORCE_EAST;
  return row;
}

function load(mode: RoomMode, options: Omit<RoomOptions, 'mode'>): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(room({ mode, ...options }));
  return engine;
}

const blocksOf = (engine: GameEngine): number[] =>
  engine
    .getEntities()
    .filter((e) => e.kind === 'block')
    .map((e) => e.x)
    .sort((a, b) => a - b);

describe('block at rest on a force floor (FB)', () => {
  const options = { startX: 1, terrain: forceRow(5), entities: [{ type: BLOCK, x: FORCE_START_X, y: ROOM_ROW, dir: 'E' as const }] };

  it('is carried along by the floor from the first tick on a CC2 level', () => {
    const engine = load('cc2', options);
    engine.tick();
    expect(blocksOf(engine)[0]).toBeGreaterThan(FORCE_START_X);
    for (let i = 0; i < WATCH_TICKS; i++) engine.tick();
    expect(blocksOf(engine)[0]).toBeGreaterThan(FORCE_START_X + 1);
  });

  it('leaves the block where it is on a classic or a native level', () => {
    for (const mode of ['cc', 'native'] as const) {
      const engine = load(mode, options);
      for (let i = 0; i < WATCH_TICKS; i++) engine.tick();
      expect(blocksOf(engine), mode).toEqual([FORCE_START_X]);
    }
  });

  it('carries a row of blocks, the one behind following the one ahead', () => {
    const engine = load('cc2', {
      startX: 1,
      terrain: forceRow(6),
      entities: [
        { type: BLOCK, x: FORCE_START_X, y: ROOM_ROW, dir: 'E' },
        { type: BLOCK, x: FORCE_START_X + 1, y: ROOM_ROW, dir: 'E' }
      ]
    });
    for (let i = 0; i < WATCH_TICKS * 2; i++) engine.tick();
    const xs = blocksOf(engine);
    expect(xs).toHaveLength(2);
    expect(xs[0]).toBeGreaterThan(FORCE_START_X);
    expect(xs[1]).toBeGreaterThan(FORCE_START_X + 1);
  });

  it('takes the shared turn of a turning force floor, as an arrival does', () => {
    const engine = load('cc2', {
      startX: 1,
      terrain: { [`${FORCE_START_X},${ROOM_ROW}`]: FORCE_CYCLE },
      entities: [{ type: BLOCK, x: FORCE_START_X, y: ROOM_ROW, dir: 'E' }]
    });
    const turnBefore = worldOf(engine).forceCycleTurn;
    engine.tick();
    expect(worldOf(engine).forceCycleTurn).toBeGreaterThan(turnBefore);
    const block = engine.getEntities().find((e) => e.kind === 'block');
    expect(block !== undefined && (block.x !== FORCE_START_X || block.y !== ROOM_ROW)).toBe(true);
  });
});

describe('block step result on a force floor (FB2)', () => {
  function stepOnce(wallAhead: boolean): { refused: boolean | undefined; slid: boolean } {
    const engine = load('cc2', {
      startX: 1,
      terrain: { ...forceRow(2), ...(wallAhead ? { [`${FORCE_START_X + 1},${ROOM_ROW}`]: 'wall' } : {}) },
      entities: [{ type: BLOCK, x: FORCE_START_X, y: ROOM_ROW, dir: 'E' }]
    });
    const block = worldOf(engine).entities.find((e) => e.kind === 'block');
    if (block === undefined) throw new Error('the room has a block');
    block.isSliding = true;
    block.dir = 'E';
    block.cooldownTicks = 0;
    const result = stepSlidingBlock(ctxOf(engine), block);
    return { refused: result.refusedOnForce, slid: block.x !== FORCE_START_X };
  }

  it('reports a slide refused on a force floor', () => {
    expect(stepOnce(true)).toEqual({ refused: true, slid: false });
  });

  it('reports nothing for a slide that moved', () => {
    expect(stepOnce(false)).toEqual({ refused: undefined, slid: true });
  });
});

describe('block jammed on a turning force floor draws once per tick (FB2)', () => {
  const JAM_TICKS = 4;
  const walls: Record<string, string> = {
    [`${FORCE_START_X},${ROOM_ROW}`]: FORCE_CYCLE,
    [`${FORCE_START_X - 1},${ROOM_ROW}`]: 'wall',
    [`${FORCE_START_X + 1},${ROOM_ROW}`]: 'wall',
    [`${FORCE_START_X},${ROOM_ROW - 1}`]: 'wall',
    [`${FORCE_START_X},${ROOM_ROW + 1}`]: 'wall'
  };

  it('advances the shared sequence once per tick when terrain refuses the block', () => {
    const engine = load('cc2', { startX: 1, terrain: walls, entities: [{ type: BLOCK, x: FORCE_START_X, y: ROOM_ROW, dir: 'E' }] });
    const before = worldOf(engine).forceCycleTurn;
    for (let i = 0; i < JAM_TICKS; i++) engine.tick();
    expect(worldOf(engine).forceCycleTurn - before).toBe(JAM_TICKS);
  });

  it('does not report a retry for a wall, and reports the way for a block in the road', () => {
    const run = (ahead: boolean) => {
      const engine = load('cc2', {
        startX: 1,
        terrain: { ...forceRow(3), ...(ahead ? {} : { [`${FORCE_START_X + 1},${ROOM_ROW}`]: 'wall' }) },
        entities: [
          ...(ahead ? [{ type: BLOCK, x: FORCE_START_X + 1, y: ROOM_ROW, dir: 'E' as const }] : []),
          { type: BLOCK, x: FORCE_START_X, y: ROOM_ROW, dir: 'E' }
        ]
      });
      const block = worldOf(engine).entities.find((e) => e.kind === 'block' && e.x === FORCE_START_X);
      if (block === undefined) throw new Error('the room has a block');
      block.isSliding = true;
      block.dir = 'E';
      block.cooldownTicks = 0;
      const target = worldOf(engine).entities.find((e) => e.kind === 'block' && e.x === FORCE_START_X + 1);
      if (target !== undefined) {
        // A block that stays put (it is not sliding and not on a drifting cell this tick).
        target.isSliding = false;
      }
      return stepSlidingBlock(ctxOf(engine), block);
    };
    expect(run(false).retryDir).toBeUndefined();
    expect(run(true).retryDir).toBe('E');
  });
});

describe('melted ice block splash (MS)', () => {
  function melt(mode: RoomMode): GameEngine {
    const engine = load(mode, {
      startX: FIRE_X - 2,
      terrain: { [`${FIRE_X},${ROOM_ROW}`]: 'fire' },
      entities: [{ type: ICE_BLOCK, x: FIRE_X - 1, y: ROOM_ROW, dir: 'E' }]
    });
    expect(engine.attemptPlayerMove('E')).toBe(true);
    for (let pass = 0; pass < MELT_WAIT_PASSES && engine.getTerrain()[ROOM_ROW][FIRE_X] === 'fire'; pass++) engine.tick();
    expect(engine.getTerrain()[ROOM_ROW][FIRE_X]).toBe('water');
    return engine;
  }
  const canStepEast = (engine: GameEngine): boolean => {
    engine.getPlayer().moveCooldown = 0;
    return engine.attemptPlayerMove('E');
  };

  it('leaves a splash on the new water that bars the player for a few passes', () => {
    const engine = melt('cc2');
    expect(worldOf(engine).blockSplashes.size).toBe(1);
    for (let pass = 0; pass < SPLASH_PASSES; pass++) {
      expect(canStepEast(engine), `pass ${pass}`).toBe(false);
      engine.tick();
    }
    expect(worldOf(engine).blockSplashes.size).toBe(0);
  });

  it('leaves none on a classic or a native level', () => {
    for (const mode of ['cc', 'native'] as const) {
      expect(worldOf(melt(mode)).blockSplashes.size, mode).toBe(0);
    }
  });
});

describe('block boxed in on ice (IB)', () => {
  function boxed(mode: RoomMode, openSide: boolean): GameEngine {
    const engine = load(mode, {
      startX: 1,
      terrain: {
        [`${ICE_X},${ROOM_ROW}`]: 'ice',
        [`${ICE_X + 1},${ROOM_ROW}`]: 'wall',
        [`${ICE_X - 1},${ROOM_ROW}`]: openSide ? 'floor' : 'wall',
        [`${ICE_X},${ROOM_ROW - 1}`]: 'wall',
        [`${ICE_X},${ROOM_ROW + 1}`]: 'wall'
      },
      entities: [{ type: ICE_BLOCK, x: ICE_X, y: ROOM_ROW, dir: 'E' }]
    });
    const block = worldOf(engine).entities.find((e) => e.kind === 'block');
    if (block === undefined) throw new Error('the room has a block');
    block.isSliding = true;
    block.cooldownTicks = 0;
    return engine;
  }
  const blockOf = (engine: GameEngine) => worldOf(engine).entities.find((e) => e.kind === 'block');

  it('keeps sliding and turns round each tick on a CC2 level, without a sound', () => {
    const engine = boxed('cc2', false);
    const dirs: string[] = [];
    for (let i = 0; i < WATCH_TICKS; i++) {
      engine.tick();
      expect(blockOf(engine)?.isSliding).toBe(true);
      dirs.push(blockOf(engine)?.dir ?? '');
    }
    expect(new Set(dirs).size).toBeGreaterThan(1);
    expect(playSfx).not.toHaveBeenCalled();
  });

  it('leaves as soon as the way back opens', () => {
    const engine = boxed('cc2', true);
    for (let i = 0; i < WATCH_TICKS; i++) engine.tick();
    expect(blockOf(engine)?.x).toBeLessThan(ICE_X);
  });

  it('stops on a classic or a native level', () => {
    for (const mode of ['cc', 'native'] as const) {
      const engine = boxed(mode, false);
      for (let i = 0; i < WATCH_TICKS; i++) engine.tick();
      expect(blockOf(engine)?.isSliding, mode).toBe(false);
    }
  });
});
