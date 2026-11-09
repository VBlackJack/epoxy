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

import { beforeEach, describe, expect, it } from 'vitest';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { buildTestLevel } from '../../test/buildTestLevel';
import { GameEngine } from '../GameEngine';
import type { CompiledLevel } from '../types';

beforeEach(() => {
  loadTestConfigs();
});

/** A force floor lane going east with open floor on both sides, the player on the floor west of it. */
const FORCE_LANE = ['###############', '#.............#', '#.@>>>>>>>>>..#', '#.............#', '###############'];
const BLOCK_LANE = ['###############', '#.............#', '#.@.IIIIIIII..#', '#.............#', '###############'];
const ICE_LANE = ['###############', '#.............#', '#.@IIIIIIII...#', '#.............#', '###############'];

function level(rows: string[], flavor: boolean, extra: Parameters<typeof buildTestLevel>[1] = {}): CompiledLevel {
  const built = buildTestLevel(rows, extra);
  return flavor ? { ...built, rulesFlavor: 'cc' } : built;
}

interface TestWorld {
  player: { x: number; y: number; forcePermission?: boolean };
  entities: { kind: string; x: number; y: number }[];
}

function start(rows: string[], flavor: boolean, extra: Parameters<typeof buildTestLevel>[1] = {}): { engine: GameEngine; w: TestWorld } {
  const engine = new GameEngine();
  engine.loadLevel(level(rows, flavor, extra));
  return { engine, w: (engine as unknown as { w: TestWorld }).w };
}

/** Ticks until the cooldown after a step has run out, so the next move is not refused for it. */
function settleCooldown(engine: GameEngine): void {
  for (let i = 0; i < 8 && engine.getPlayer().moveCooldown > 0; i++) engine.tick();
}

describe('classic force floor permission', () => {
  it('refuses a direction choice right after a voluntary step onto a force floor', () => {
    const { engine, w } = start(FORCE_LANE, true);
    expect(engine.attemptPlayerMove('E')).toBe(true);
    expect(w.player.x).toBe(3);
    settleCooldown(engine);
    expect(engine.attemptPlayerMove('S')).toBe(false);
    expect(w.player.y).toBe(2);
  });

  it('allows the choice after a step the floor carried the player', () => {
    const { engine, w } = start(FORCE_LANE, true);
    engine.attemptPlayerMove('E');
    for (let i = 0; i < 12 && w.player.x < 5; i++) engine.tick();
    expect(w.player.x).toBeGreaterThanOrEqual(5);
    settleCooldown(engine);
    expect(engine.attemptPlayerMove('S')).toBe(true);
    expect(w.player.y).toBe(3);
  });

  it('takes the permission away again with the player own step', () => {
    const { engine, w } = start(FORCE_LANE, true);
    engine.attemptPlayerMove('E');
    for (let i = 0; i < 12 && w.player.x < 5; i++) engine.tick();
    expect(w.player.forcePermission).toBe(true);
    settleCooldown(engine);
    engine.attemptPlayerMove('S');
    expect(w.player.forcePermission).toBe(false);
  });

  it('keeps the permission through a move, undo and move', () => {
    const { engine, w } = start(FORCE_LANE, true);
    engine.attemptPlayerMove('E');
    for (let i = 0; i < 12 && w.player.x < 5; i++) engine.tick();
    settleCooldown(engine);
    const x = w.player.x;
    expect(engine.attemptPlayerMove('S')).toBe(true);
    expect(engine.undo()).toBe(true);
    expect(w.player.x).toBe(x);
    expect(w.player.y).toBe(2);
    expect(w.player.forcePermission).toBe(true);
    expect(engine.attemptPlayerMove('S')).toBe(true);
  });

  it('leaves a level without the classic rules unchanged', () => {
    const { engine, w } = start(FORCE_LANE, false);
    engine.attemptPlayerMove('E');
    settleCooldown(engine);
    expect(engine.attemptPlayerMove('S')).toBe(true);
    expect(w.player.forcePermission).toBeUndefined();
  });
});

/** Ticks between the successive cells of a slide, from the first cell change on. */
function cellGaps(engine: GameEngine, w: TestWorld, ticks: number): number[] {
  const gaps: number[] = [];
  let lastX = w.player.x;
  let since = 0;
  for (let t = 0; t < ticks; t++) {
    engine.tick();
    since++;
    if (w.player.x !== lastX) {
      gaps.push(since);
      since = 0;
      lastX = w.player.x;
    }
  }
  return gaps;
}

describe('classic slide speed', () => {
  it('carries the player over a force floor one cell every two ticks', () => {
    const { engine, w } = start(FORCE_LANE, true);
    engine.attemptPlayerMove('E');
    const gaps = cellGaps(engine, w, 24).slice(1, 5);
    expect(gaps.length).toBeGreaterThanOrEqual(3);
    expect(gaps.every((g) => g === 2)).toBe(true);
  });

  it('keeps the native force floor pace on a level without the classic rules', () => {
    const { engine, w } = start(FORCE_LANE, false);
    engine.attemptPlayerMove('E');
    const gaps = cellGaps(engine, w, 40).slice(1, 5);
    expect(gaps.length).toBeGreaterThanOrEqual(3);
    expect(gaps.every((g) => g === 4)).toBe(true);
  });

  it('leaves the ice pace of the player as it is', () => {
    const classic = start(ICE_LANE, true);
    const native = start(ICE_LANE, false);
    classic.engine.attemptPlayerMove('E');
    native.engine.attemptPlayerMove('E');
    expect(cellGaps(classic.engine, classic.w, 30)).toEqual(cellGaps(native.engine, native.w, 30));
  });

  it('slides a block over ice one cell every two ticks, and at the native pace without the classic rules', () => {
    const slide = (flavor: boolean): number[] => {
      const { engine, w } = start(BLOCK_LANE, flavor, { entities: [{ type: 'dirt_block', x: 3, y: 2, dir: 'S' }] });
      engine.attemptPlayerMove('E');
      const gaps: number[] = [];
      let lastX = -1;
      let since = 0;
      for (let t = 0; t < 40; t++) {
        engine.tick();
        since++;
        const block = w.entities.find((e) => e.kind === 'block');
        if (block && block.x !== lastX) {
          if (lastX >= 0) gaps.push(since);
          since = 0;
          lastX = block.x;
        }
      }
      return gaps.slice(1, 5);
    };
    const classic = slide(true);
    const native = slide(false);
    expect(classic.length).toBeGreaterThanOrEqual(3);
    expect(classic.every((g) => g === 2)).toBe(true);
    expect(native.every((g) => g === 3)).toBe(true);
  });
});
