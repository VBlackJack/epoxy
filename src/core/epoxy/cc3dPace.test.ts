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

import { CONVERTED_ID_SUFFIX } from '../cc3d/cc3dConstants';
import { buildTestLevel } from '../../test/buildTestLevel';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { CC3D_PUSHED_BLOCK_ENTRY_COOLDOWN_TICKS, CC3D_SLIDE_END_WAIT_TICKS } from '../coreConstants';
import { GameEngine } from '../GameEngine';
import type { CompiledLevel, Direction } from '../types';

/**
 * A CC3D level converted to Epoxy keeps the CC3D pace on ice and force floors: a slide goes one cell every two ticks, the
 * player is busy one more tick after it, a block pushed onto ice or a force floor waits two ticks before its first slide
 * step, and a refused forced step on a force floor keeps the drift and bars the input along its axis. Native levels and
 * levels of the classic rules keep their own pace.
 */

beforeEach(() => {
  loadTestConfigs();
});

type Flavor = 'native' | 'converted' | 'cc' | 'cc2';

interface TestWorld {
  cc3dPace: boolean;
  terrain: string[][];
  player: { x: number; y: number; isSliding: boolean; slideDir: Direction | null; moveCooldown: number; dir: Direction };
}

const ICE_LANE = ['###############', '#.............#', '#.@IIIIIIII...#', '#.............#', '###############'];
const BLOCK_ON_ICE_LANE = ['###############', '#.............#', '#.@.IIIIIIII..#', '#.............#', '###############'];
const BLOCK_ON_FORCE_LANE = ['###############', '#.............#', '#.@.>>>>>>>>..#', '#.............#', '###############'];
const RANDOM_CELL = ['###############', '#.............#', '#.@.?.........#', '#.............#', '###############'];
/** Ticks per cell of a slide over ice on a native level (slideCooldownTicks 2 plus the step). */
const NATIVE_ICE_GAP = 3;
const CONVERTED_ICE_GAP = 2;
const SLIDE_TICKS = 24;
const RANDOM_SEEDS = 40;

function level(rows: string[], flavor: Flavor, entities: Parameters<typeof buildTestLevel>[1] = {}): CompiledLevel {
  const built = buildTestLevel(rows, entities);
  switch (flavor) {
    case 'converted':
      return { ...built, id: `lane${CONVERTED_ID_SUFFIX}` };
    case 'cc':
      return { ...built, id: `lane${CONVERTED_ID_SUFFIX}`, rulesFlavor: 'cc' };
    case 'cc2':
      return { ...built, id: `lane${CONVERTED_ID_SUFFIX}`, cc2: {} } as unknown as CompiledLevel;
    default:
      return built;
  }
}

function start(rows: string[], flavor: Flavor, entities: Parameters<typeof buildTestLevel>[1] = {}, seed?: number): { engine: GameEngine; w: TestWorld } {
  const engine = new GameEngine();
  engine.loadLevel(level(rows, flavor, entities), seed);
  return { engine, w: (engine as unknown as { w: TestWorld }).w };
}

/** The ticks, counted from the call, at which the player changes cell while the run goes on. */
function cellChangeTicks(engine: GameEngine, w: TestWorld, ticks: number): number[] {
  const changes: number[] = [];
  let lastX = w.player.x;
  let lastY = w.player.y;
  for (let t = 1; t <= ticks; t++) {
    engine.tick();
    if (w.player.x !== lastX || w.player.y !== lastY) changes.push(t);
    lastX = w.player.x;
    lastY = w.player.y;
  }
  return changes;
}

function gaps(ticks: number[]): number[] {
  return ticks.slice(1).map((t, i) => t - ticks[i]);
}

describe('the cc3dPace flag', () => {
  it('is set only on a converted CC3D level that plays on the Epoxy rules', () => {
    expect(start(ICE_LANE, 'native').w.cc3dPace).toBe(false);
    expect(start(ICE_LANE, 'converted').w.cc3dPace).toBe(true);
  });

  it('is set by the CC3D source of a level whose id lost the suffix', () => {
    const engine = new GameEngine();
    engine.loadLevel({ ...buildTestLevel(ICE_LANE), cc3dSource: {} } as unknown as CompiledLevel);
    expect((engine as unknown as { w: TestWorld }).w.cc3dPace).toBe(true);
  });

  it('is never set on a level of the classic rules, a converted id or not', () => {
    expect(start(ICE_LANE, 'cc').w.cc3dPace).toBe(false);
    expect(start(ICE_LANE, 'cc2').w.cc3dPace).toBe(false);
  });
});

describe('the player slide', () => {
  it('goes one cell every two ticks on a converted level, three on a native one', () => {
    const native = start(ICE_LANE, 'native');
    expect(native.engine.attemptPlayerMove('E')).toBe(true);
    const nativeGaps = gaps(cellChangeTicks(native.engine, native.w, SLIDE_TICKS));
    expect(nativeGaps.length).toBeGreaterThan(3);
    expect(new Set(nativeGaps)).toEqual(new Set([NATIVE_ICE_GAP]));

    const converted = start(ICE_LANE, 'converted');
    expect(converted.engine.attemptPlayerMove('E')).toBe(true);
    const convertedGaps = gaps(cellChangeTicks(converted.engine, converted.w, SLIDE_TICKS));
    expect(convertedGaps.length).toBeGreaterThan(3);
    expect(new Set(convertedGaps)).toEqual(new Set([CONVERTED_ICE_GAP]));
  });

  it('keeps the classic pace on a level of the classic rules', () => {
    const cc = start(ICE_LANE, 'cc');
    expect(cc.engine.attemptPlayerMove('E')).toBe(true);
    const ccGaps = gaps(cellChangeTicks(cc.engine, cc.w, SLIDE_TICKS));
    expect(new Set(ccGaps)).toEqual(new Set([CONVERTED_ICE_GAP]));
    expect(cc.w.cc3dPace).toBe(false);
  });

  it('leaves the player busy one more tick after the step that ends the slide, on a converted level only', () => {
    for (const flavor of ['native', 'converted'] as const) {
      const { engine, w } = start(ICE_LANE, flavor);
      engine.attemptPlayerMove('E');
      let guard = 0;
      while (w.terrain[w.player.y][w.player.x] !== 'floor' || w.player.x < 4) {
        engine.tick();
        if (++guard > SLIDE_TICKS * 2) throw new Error('the slide never ended');
      }
      expect(w.player.isSliding).toBe(false);
      if (flavor === 'converted') {
        expect(w.player.moveCooldown).toBeGreaterThanOrEqual(CC3D_SLIDE_END_WAIT_TICKS);
        expect(engine.attemptPlayerMove('N')).toBe(false);
        engine.tick();
        expect(engine.attemptPlayerMove('N')).toBe(true);
      } else {
        expect(w.player.moveCooldown).toBe(0);
        expect(engine.attemptPlayerMove('N')).toBe(true);
      }
    }
  });
});

describe('a block pushed onto ice or a force floor', () => {
  const BLOCK = [{ type: 'dirt_block_3d', x: 3, y: 2, dir: 'E' as Direction }];

  for (const [name, rows] of [
    ['ice', BLOCK_ON_ICE_LANE],
    ['a force floor', BLOCK_ON_FORCE_LANE]
  ] as const) {
    it(`waits two ticks before its first slide step on ${name}, one tick between the next ones (converted level)`, () => {
      const { engine } = start(rows, 'converted', { entities: BLOCK });
      expect(engine.attemptPlayerMove('E')).toBe(true);
      const block = engine.getEntities().find((e) => e.kind === 'block');
      if (!block) throw new Error('no block');
      expect(block.isSliding).toBe(true);
      expect(block.cooldownTicks).toBe(CC3D_PUSHED_BLOCK_ENTRY_COOLDOWN_TICKS);
      const startX = block.x;
      engine.tick();
      engine.tick();
      expect(block.x).toBe(startX);
      engine.tick();
      expect(block.x).toBe(startX + 1);
      expect(block.cooldownTicks).toBe(1);
    });

    it(`keeps the fast pace of a classic-rules block on ${name} outside a converted level`, () => {
      const { engine } = start(rows, 'native', { entities: BLOCK });
      expect(engine.attemptPlayerMove('E')).toBe(true);
      const block = engine.getEntities().find((e) => e.kind === 'block');
      if (!block) throw new Error('no block');
      expect(block.cooldownTicks).toBe(1);
    });
  }
});

describe('a refused forced step on a force floor', () => {
  function onRandomFloor(flavor: Flavor): { engine: GameEngine; w: TestWorld } {
    const run = start(RANDOM_CELL, flavor);
    run.w.player.x = 4;
    run.w.player.y = 2;
    run.w.player.slideDir = 'E';
    run.w.player.isSliding = false;
    return run;
  }

  it('bars the input along the drifted axis, both ways, on a converted level', () => {
    const { engine } = onRandomFloor('converted');
    expect(engine.attemptPlayerMove('E')).toBe(false);
    expect(engine.attemptPlayerMove('W')).toBe(false);
    expect(engine.attemptPlayerMove('N')).toBe(true);
  });

  it('bars only the opposite direction on a native level', () => {
    const { engine } = onRandomFloor('native');
    expect(engine.attemptPlayerMove('W')).toBe(false);
    expect(engine.attemptPlayerMove('E')).toBe(true);
  });

  it('keeps the drawn direction after a blocked step on a converted level, and forgets it on a native one', () => {
    // A random floor shut on three sides: whichever direction is drawn but west keeps the player on the cell.
    const closed = ['###############', '###############', '#.@.?#########', '###############', '###############'];
    let converted = 0;
    let native = 0;
    for (let seed = 1; seed <= RANDOM_SEEDS; seed++) {
      for (const flavor of ['converted', 'native'] as const) {
        const { engine, w } = start(closed, flavor, {}, seed);
        engine.attemptPlayerMove('E');
        for (let t = 0; t < 8; t++) engine.tick();
        engine.attemptPlayerMove('E');
        for (let t = 0; t < 8; t++) engine.tick();
        if (w.player.x !== 4) continue;
        if (flavor === 'converted') {
          expect(w.player.slideDir).not.toBeNull();
          converted++;
        } else {
          expect(w.player.slideDir).toBeNull();
          native++;
        }
      }
    }
    expect(converted).toBeGreaterThan(0);
    expect(native).toBeGreaterThan(0);
  });
});
