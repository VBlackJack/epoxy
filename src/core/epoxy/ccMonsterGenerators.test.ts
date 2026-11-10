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
import { drawBlobDirection, drawWalkerTurn, newCcGenerators, type CcGenerators } from './ccGenerators';

beforeEach(() => {
  loadTestConfigs();
});

interface TestWorld {
  entities: { type: string; kind: string; x: number; y: number; dir: Direction }[];
  ccGenerators: CcGenerators | null;
}

const SEED = 123456;
const BOXED_BUG = ['#######', '#M#...#', '#######', '#.....@#', '#######'];
const BOXED_TEETH = ['#######', '#M#...#', '###..@#', '#######'];
const ROOM = ['#######', '#.....#', '#.M...#', '#.....#', '#....@#', '#######'];
const CORRIDOR = ['####################', '#M................@#', '####################'];

type Origin = 'dat' | 'cc2' | 'native';

function levelWith(rows: string[], type: string, dir: Direction, origin: Origin): CompiledLevel {
  const row = rows.findIndex((r) => r.includes('M'));
  const col = rows[row].indexOf('M');
  const drawn = rows.map((r) => r.replace('M', '.'));
  const level = buildTestLevel(drawn, { entities: [{ type, x: col, y: row, dir }] });
  if (origin === 'native') return level;
  return origin === 'cc2' ? { ...level, rulesFlavor: 'cc', cc2: {} as never } : { ...level, rulesFlavor: 'cc' };
}

function start(level: CompiledLevel, seed = SEED) {
  const engine = new GameEngine();
  engine.loadLevel(level, seed);
  const w = (engine as unknown as { w: TestWorld }).w;
  return { engine, w, monster: () => w.entities.find((e) => e.kind === 'monster')! };
}

describe('classic monsters boxed in', () => {
  it('turns a boxed-in bug to face its last candidate', () => {
    const { engine, monster } = start(levelWith(BOXED_BUG, 'bug', 'E', 'dat'));
    engine.tick();
    expect(monster().dir).toBe('W');
    expect({ x: monster().x, y: monster().y }).toEqual({ x: 1, y: 1 });
  });

  it('turns boxed-in teeth to face their first choice', () => {
    const { engine, monster } = start(levelWith(BOXED_TEETH, 'teeth', 'N', 'dat'));
    engine.tick();
    expect(monster().dir).toBe('E');
  });

  it('keeps the facing of a boxed-in monster on a level without the classic rules', () => {
    const bug = start(levelWith(BOXED_BUG, 'bug', 'E', 'native'));
    const teeth = start(levelWith(BOXED_TEETH, 'teeth', 'N', 'native'));
    for (let i = 0; i < 12; i++) {
      bug.engine.tick();
      teeth.engine.tick();
    }
    expect(bug.monster().dir).toBe('E');
    expect(teeth.monster().dir).toBe('N');
  });
});

describe('classic generators', () => {
  it('draws for a walker only when its way ahead is blocked', () => {
    const { engine, w, monster } = start(levelWith(CORRIDOR, 'walker', 'E', 'dat'));
    const fresh = newCcGenerators(SEED);
    for (let i = 0; i < 6; i++) engine.tick();
    expect(monster().x).toBeGreaterThan(1);
    expect(w.ccGenerators).toEqual(fresh);
  });

  it('draws the walker turn from the walker generator once blocked', () => {
    const { engine, w, monster } = start(levelWith(ROOM, 'walker', 'N', 'dat'));
    const reference = newCcGenerators(SEED);
    const facings = new Set<Direction>();
    for (let i = 0; i < 60; i++) {
      engine.tick();
      facings.add(monster().dir);
    }
    // The main generator is untouched; the walker generator moved on by whole draws of the reference sequence.
    expect(w.ccGenerators!.main).toBe(reference.main);
    expect(w.ccGenerators).not.toEqual(reference);
    const replay = newCcGenerators(SEED);
    let draws = 0;
    while (replay.walkerHigh !== w.ccGenerators!.walkerHigh || replay.walkerLow !== w.ccGenerators!.walkerLow) {
      drawWalkerTurn(replay, 'N');
      draws += 1;
      expect(draws).toBeLessThan(1000);
    }
    expect(draws).toBeGreaterThan(0);
    expect(facings.size).toBeGreaterThan(1);
  });

  it('gives the blob one main-generator draw per decision, and faces it', () => {
    const { engine, w, monster } = start(levelWith(ROOM, 'blob', 'S', 'dat'));
    const reference = newCcGenerators(SEED);
    const first = drawBlobDirection(reference);
    engine.tick();
    expect(w.ccGenerators).toEqual(reference);
    expect(monster().dir).toBe(first);
    // The next decision is eight ticks later.
    for (let i = 0; i < 7; i++) engine.tick();
    expect(w.ccGenerators).toEqual(reference);
    const second = drawBlobDirection(reference);
    engine.tick();
    expect(w.ccGenerators).toEqual(reference);
    expect(monster().dir).toBe(second);
  });

  it('puts the generators back on undo and replays the same draws', () => {
    const { engine, w } = start(levelWith(ROOM, 'blob', 'S', 'dat'));
    for (let i = 0; i < 3; i++) engine.tick();
    const saved = engine.captureState();
    const at = { ...w.ccGenerators! };
    const ahead: CcGenerators[] = [];
    for (let i = 0; i < 40; i++) {
      engine.tick();
      ahead.push({ ...w.ccGenerators! });
    }
    expect(ahead[ahead.length - 1]).not.toEqual(at);
    engine.restoreState(saved);
    expect(w.ccGenerators).toEqual(at);
    for (let i = 0; i < 40; i++) {
      engine.tick();
      expect(w.ccGenerators).toEqual(ahead[i]);
    }
  });

  it('gives a CC2 import the classic generators and leaves a native level on the seeded one', () => {
    const cc2 = start(levelWith(ROOM, 'blob', 'S', 'cc2'));
    const native = start(levelWith(ROOM, 'blob', 'S', 'native'));
    for (let i = 0; i < 20; i++) {
      cc2.engine.tick();
      native.engine.tick();
    }
    expect(cc2.w.ccGenerators).not.toBeNull();
    expect(native.w.ccGenerators).toBeNull();
    expect(cc2.engine.captureState().ccGenerators).toBeDefined();
    expect(native.engine.captureState().ccGenerators).toBeUndefined();
  });

  it('reproduces the same walk for the same seed and another for a different one', () => {
    const walk = (seed: number): string => {
      const { engine, monster } = start(levelWith(ROOM, 'blob', 'S', 'dat'), seed);
      const cells: string[] = [];
      for (let i = 0; i < 80; i++) {
        engine.tick();
        cells.push(`${monster().x},${monster().y}`);
      }
      return cells.join(' ');
    };
    expect(walk(SEED)).toBe(walk(SEED));
    expect(walk(SEED)).not.toBe(walk(SEED + 1));
  });
});
