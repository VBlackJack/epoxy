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
import type { CompiledLevel, Direction } from '../types';

beforeEach(() => {
  loadTestConfigs();
});

const CORRIDOR = ['####################', '#M................@#', '####################'];
const ROOM = ['#######', '#.....#', '#.....#', '#..M..#', '#.....#', '#....@#', '#######'];

interface TestWorld {
  entities: { uid: number; type: string; kind: string; x: number; y: number }[];
  nextEntityUid: number;
}

function levelWith(rows: string[], type: string, dir: Direction, flavor: boolean): CompiledLevel {
  const row = rows.findIndex((r) => r.includes('M'));
  const col = rows[row].indexOf('M');
  const drawn = rows.map((r) => r.replace('M', '.'));
  const level = buildTestLevel(drawn, { entities: [{ type, x: col, y: row, dir }] });
  return flavor ? { ...level, rulesFlavor: 'cc' } : level;
}

/** The monster's cell after each of `ticks` ticks, the player standing still. */
function track(level: CompiledLevel, ticks: number, before?: (w: TestWorld, tick: number) => void): string[] {
  const engine = new GameEngine();
  engine.loadLevel(level);
  const w = (engine as unknown as { w: TestWorld }).w;
  const out: string[] = [];
  for (let t = 1; t <= ticks; t++) {
    before?.(w, t);
    engine.tick();
    const monster = w.entities.find((e) => e.kind === 'monster');
    out.push(`${monster?.x},${monster?.y}`);
  }
  return out;
}

const xs = (cells: string[]): number[] => cells.map((c) => Number(c.split(',')[0]));

describe('classic monster cadence', () => {
  it('steps every 4 ticks and decides at tick 0 on a classic-rules level', () => {
    const cells = xs(track(levelWith(CORRIDOR, 'bug', 'E', true), 9));
    expect(cells).toEqual([2, 2, 2, 2, 3, 3, 3, 3, 4]);
  });

  it('keeps the move interval on a level without the flag', () => {
    const cells = xs(track(levelWith(CORRIDOR, 'bug', 'E', false), 13));
    expect(cells).toEqual([1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 3, 3]);
  });

  it('steps a blob every 8 ticks', () => {
    const cells = track(levelWith(ROOM, 'blob', 'S', true), 10);
    expect(cells[0]).not.toBe('3,3');
    for (let i = 1; i < 8; i++) expect(cells[i]).toBe(cells[0]);
  });

  it('keeps the blob interval without the flag', () => {
    const cells = track(levelWith(ROOM, 'blob', 'S', false), 10);
    expect(new Set(cells).size).toBe(1);
  });

  it('moves teeth only in the first half of each 8-tick cycle', () => {
    const cells = xs(track(levelWith(CORRIDOR, 'teeth', 'E', true), 17));
    expect(cells).toEqual([2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 4]);
  });

  it('retries a blocked monster on the next tick', () => {
    let blockerUid = -1;
    const cells = xs(
      track(levelWith(CORRIDOR, 'tank', 'E', true), 9, (w, t) => {
        if (t === 1) {
          blockerUid = w.nextEntityUid++;
          w.entities.push({ uid: blockerUid, type: 'dirt_block', kind: 'block', x: 2, y: 1, dir: 'E', cooldownTicks: 0, isSliding: false } as never);
        }
        if (t === 6) w.entities.splice(w.entities.findIndex((e) => e.uid === blockerUid), 1);
      })
    );
    // Blocked through tick 5; the block is gone before tick 6 and the tank steps on that very tick.
    expect(cells.slice(0, 5)).toEqual([1, 1, 1, 1, 1]);
    expect(cells[5]).toBe(2);
  });

  it('keeps the teeth phase across an undo', () => {
    const level = levelWith(CORRIDOR, 'teeth', 'E', true);
    const run = (withUndo: boolean): string[] => {
      const engine = new GameEngine();
      engine.loadLevel(level);
      const w = (engine as unknown as { w: TestWorld }).w;
      const teethX = (): string => String(w.entities.find((e) => e.kind === 'monster')?.x);
      const out: string[] = [];
      for (let i = 0; i < 3; i++) engine.tick();
      if (withUndo) {
        engine.attemptPlayerMove('W');
        for (let i = 0; i < 4; i++) engine.tick();
        expect(engine.undo()).toBe(true);
      }
      engine.attemptPlayerMove('W');
      for (let i = 0; i < 16; i++) {
        engine.tick();
        out.push(teethX());
      }
      return out;
    };
    expect(run(true)).toEqual(run(false));
  });
});
