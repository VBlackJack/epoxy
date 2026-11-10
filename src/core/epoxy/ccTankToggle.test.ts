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
  entities: { uid: number; type: string; x: number; y: number; dir: Direction; cooldownTicks: number; tankTurn?: number }[];
  terrain: string[][];
  ccMonsterClock: number;
  ccPassOpen: boolean;
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
    const { press, tank } = setup(true);
    press();
    expect(tank().dir).toBe('E');
    expect(tank().tankTurn).toBe(4);
  });

  it('turns a tank at rest on the fifth tick after a press made before the first tick', () => {
    const dirs = trace([1], 8);
    expect(dirs.indexOf('W') + 1).toBe(5);
    expect(dirs.slice(0, 4).every((d) => d === 'E')).toBe(true);
  });

  it('does not turn a tank that is in the middle of a step', () => {
    const { engine, w, press, tank } = setup(true);
    engine.tick();
    expect(tank().cooldownTicks).toBeGreaterThan(0);
    press();
    // Make the mark fall due on the next pass while the step still runs.
    tank().tankTurn = w.ccMonsterClock;
    tank().cooldownTicks = 2;
    engine.tick();
    expect(tank().dir).toBe('E');
    expect(tank().tankTurn).toBeUndefined();
  });

  it('cancels with a second press before the tank acts', () => {
    const { engine, press, tank } = setup(true);
    press();
    engine.tick();
    press();
    expect(tank().tankTurn).toBeUndefined();
    for (let i = 0; i < 12; i++) engine.tick();
    expect(tank().dir).toBe('E');
    expect(trace([1, 1], 16).every((d) => d === 'E')).toBe(true);
  });

  it('cancels when a slide and a monster press in the same tick', () => {
    const { w, press, tank } = setup(true);
    // First source: before the entity pass of the tick (the clock does not count the pass yet).
    press();
    const marked = tank().tankTurn;
    expect(marked).toBeDefined();
    // Second source: inside the entity pass of the same tick (the clock already counts it).
    w.ccMonsterClock += 1;
    w.ccPassOpen = true;
    press();
    expect(tank().tankTurn).toBeUndefined();
    // And a lone press from inside the pass gives the same due pass as one made before it.
    const lone = setup(true);
    lone.w.ccMonsterClock += 1;
    lone.w.ccPassOpen = true;
    lone.press();
    expect(lone.tank().tankTurn).toBe(marked);
  });

  it('skips a tank on a clone machine', () => {
    const { press, tank } = setup(true, 'clone_machine');
    press();
    expect(tank().tankTurn).toBeUndefined();
    expect(tank().dir).toBe('E');
  });

  it('skips a tank on ice', () => {
    const { press, tank } = setup(true, 'ice');
    press();
    expect(tank().tankTurn).toBeUndefined();
    expect(tank().dir).toBe('E');
  });

  it('reverses at once on a level without the classic rules', () => {
    const { press, tank } = setup(false);
    press();
    expect(tank().dir).toBe('W');
    expect(tank().tankTurn).toBeUndefined();
  });

  it('undo puts the pending mark back and the replay turns the tank on the same tick', () => {
    const expected = trace([1], 8);

    const { engine, press, tank } = setup(true);
    press();
    engine.tick();
    engine.saveUndoSnapshot();
    engine.tick();
    engine.tick();
    expect(tank().tankTurn).toBe(4);
    expect(engine.undo()).toBe(true);
    expect(tank().tankTurn).toBe(4);
    const dirs: Direction[] = [expected[0]];
    for (let t = 2; t <= 8; t++) {
      engine.tick();
      dirs.push(tank().dir);
    }
    expect(dirs).toEqual(expected);
    expect(dirs.indexOf('W') + 1).toBe(5);
  });

  it('marks a tank again when a press comes inside the pass where its mark was spent', () => {
    const { engine, w, press, tank } = setup(true);
    press();
    tank().tankTurn = w.ccMonsterClock;
    // Pass 0 turns the tank (due now); a press made inside that pass marks it again for a later pass.
    engine.tick();
    expect(tank().dir).toBe('W');
    expect(tank().tankTurn).toBeUndefined();
    // A press after the pass marks the tank again for a later pass.
    press();
    expect(tank().tankTurn).toBeDefined();
  });

  it('keeps no mark on a creature that is not a tank any more', () => {
    const { engine, w, press, tank } = setup(true);
    press();
    const creature = tank();
    creature.type = 'bug';
    w.ccMonsterClock = creature.tankTurn!;
    const dir = creature.dir;
    engine.tick();
    expect(creature.tankTurn).toBeUndefined();
    expect(creature.dir).toBe(dir);
  });

  it('presses from a real monster step inside the pass, and the flag is closed after the pass', () => {
    const rows = ['######################', '#@.......-...........#', '######################'];
    const level = {
      ...buildTestLevel(rows, {
        entities: [
          { type: 'tank', x: 3, y: 1, dir: 'E' },
          { type: 'bug', x: 10, y: 1, dir: 'W' }
        ]
      }),
      rulesFlavor: 'cc'
    } as CompiledLevel;
    const engine = new GameEngine();
    engine.loadLevel(level);
    const w = (engine as unknown as { w: TestWorld }).w;
    const tankOf = () => w.entities.find((e) => e.type === 'tank')!;
    engine.tick();
    expect(w.entities.find((e) => e.type === 'bug')!.x).toBe(9);
    expect(tankOf().tankTurn).toBe(4);
    expect(w.ccPassOpen).toBe(false);
  });

  it('closes the pass flag when the player dies in the middle of the pass', () => {
    const level = {
      ...buildTestLevel(['######################', '#@...................#', '######################'], {
        entities: [{ type: 'bug', x: 2, y: 1, dir: 'W' }]
      }),
      rulesFlavor: 'cc'
    } as CompiledLevel;
    const engine = new GameEngine();
    engine.loadLevel(level);
    const w = (engine as unknown as { w: TestWorld & { player: { alive: boolean } } }).w;
    for (let t = 0; t < 3 && w.player.alive; t++) engine.tick();
    expect(w.player.alive).toBe(false);
    expect(w.ccPassOpen).toBe(false);
  });
});
