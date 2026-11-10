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
import type { EpoxyContext } from './epoxyWorld';
import { triggerButton } from './epoxyDevices';

beforeEach(() => {
  loadTestConfigs();
});

interface TestWorld {
  entities: { uid: number; type: string; x: number; y: number; dir: Direction; cooldownTicks: number; tankTurns?: number[] }[];
  terrain: string[][];
  ccMonsterClock: number;
}

const CORRIDOR = ['######################', '#....................#', '#.@..................#', '######################'];
const TANK_CELL = { x: 8, y: 1 };

function tankLevel(flavor: boolean): CompiledLevel {
  const level = buildTestLevel(CORRIDOR, { entities: [{ type: 'tank', ...TANK_CELL, dir: 'E' }] });
  return flavor ? { ...level, rulesFlavor: 'cc' } : level;
}

function setup(flavor: boolean, floor?: string) {
  const engine = new GameEngine();
  engine.loadLevel(tankLevel(flavor));
  const w = (engine as unknown as { w: TestWorld }).w;
  const ctx = (engine as unknown as { ctx: EpoxyContext }).ctx;
  if (floor !== undefined) w.terrain[TANK_CELL.y][TANK_CELL.x] = floor;
  const press = (): void => {
    triggerButton(ctx, 0, 0, 'reverse_tanks');
  };
  return { engine, w, press, tank: () => w.entities.find((e) => e.type === 'tank')! };
}

/** The directions of the tank after each of `ticks` ticks, with a press before each tick listed in `presses` (1-based). */
function trace(presses: number[], ticks: number, floor?: string, flavor = true): Direction[] {
  const { engine, press, tank } = setup(flavor, floor);
  const out: Direction[] = [];
  for (let t = 1; t <= ticks; t++) {
    for (const at of presses) if (at === t) press();
    engine.tick();
    out.push(tank().dir);
  }
  return out;
}

describe('classic tank reversal', () => {
  it('marks the tank at the press and turns it on a later tick', () => {
    const { w, press, tank } = setup(true);
    press();
    expect(tank().dir).toBe('E');
    expect(tank().tankTurns).toEqual([w.ccMonsterClock + 4]);
    const dirs = trace([1], 12);
    const turned = dirs.indexOf('W');
    expect(turned).toBeGreaterThan(0);
    expect(dirs.slice(0, turned).every((d) => d === 'E')).toBe(true);
  });

  it('does not turn a tank that is in the middle of a step', () => {
    const { engine, w, press, tank } = setup(true);
    engine.tick();
    expect(tank().cooldownTicks).toBeGreaterThan(0);
    press();
    // Make the mark fall due on the next pass while the step still runs.
    tank().tankTurns = [w.ccMonsterClock];
    tank().cooldownTicks = 2;
    engine.tick();
    expect(tank().dir).toBe('E');
    expect(tank().tankTurns).toBeUndefined();
  });

  it('cancels with a second press made for the same pass', () => {
    const { w, press, tank } = setup(true);
    press();
    press();
    expect(tank().tankTurns).toBeUndefined();
    expect(w.ccMonsterClock).toBe(0);
    expect(trace([1, 1], 16).every((d) => d === 'E')).toBe(true);
  });

  it('holds one mark per press made for different passes', () => {
    const { engine, press, tank } = setup(true);
    press();
    engine.tick();
    press();
    expect(tank().tankTurns).toHaveLength(2);
  });

  it('skips a tank on a clone machine', () => {
    const { press, tank } = setup(true, 'clone_machine');
    press();
    expect(tank().tankTurns).toBeUndefined();
    expect(tank().dir).toBe('E');
  });

  it('skips a tank on ice', () => {
    const { press, tank } = setup(true, 'ice');
    press();
    expect(tank().tankTurns).toBeUndefined();
    expect(tank().dir).toBe('E');
  });

  it('reverses at once on a level without the classic rules', () => {
    const { press, tank } = setup(false);
    press();
    expect(tank().dir).toBe('W');
    expect(tank().tankTurns).toBeUndefined();
  });

  it('puts the mark back with undo and replays the same', () => {
    const { engine, press, tank } = setup(true);
    engine.saveUndoSnapshot();
    press();
    const marked = [...(tank().tankTurns ?? [])];
    expect(marked).toHaveLength(1);
    engine.saveUndoSnapshot();
    press();
    expect(tank().tankTurns).toBeUndefined();
    expect(engine.undo()).toBe(true);
    expect(tank().tankTurns).toEqual(marked);
    expect(engine.undo()).toBe(true);
    expect(tank().tankTurns).toBeUndefined();
    expect(trace([2], 14)).toEqual(trace([2], 14));
  });
});
