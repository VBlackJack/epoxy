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

import { ConfigRegistry } from '../../config/ConfigRegistry';
import { findSteeringConfigErrors } from '../../config/ConfigValidation';
import en from '../../locales/en.json';
import fr from '../../locales/fr.json';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { FLEE_PLAYER_PATTERN } from '../coreConstants';
import { GameEngine } from '../GameEngine';
import type { EpoxyWorld } from './epoxyWorld';
import type { CompiledLevel, Direction, EntityPlacement } from '../types';

const SIZE = 11;
const SKITTER = 'skitter';
const SKITTER_INTERVAL = 8;
/** A monster waits its interval, then moves on the next tick: a step lasts interval + 1 ticks. */
const STEP_TICKS = SKITTER_INTERVAL + 1;
const SLOWED_STEP_TICKS = STEP_TICKS * 2;
const CENTER = 5;
const TIME_LIMIT_SECONDS = 1000;
const MANY_STEPS = 12;
const SLOW_TIME_BOOTS = 'slow_time';

interface Setup {
  entities: EntityPlacement[];
  terrain?: Array<[number, number, string]>;
  items?: Array<[number, number, string]>;
  player: { x: number; y: number };
}

/** Walled floor room; the player stands still where the setup puts them. */
function room(setup: Setup): CompiledLevel {
  const terrain: string[][] = Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x) => (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? 'wall' : 'floor'))
  );
  for (const [x, y, id] of setup.terrain ?? []) terrain[y][x] = id;
  const items: Array<Array<string | null>> = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null));
  for (const [x, y, id] of setup.items ?? []) items[y][x] = id;
  return {
    id: 'flee_room',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: TIME_LIMIT_SECONDS,
    chipsRequired: 0,
    playerStart: { ...setup.player, dir: 'N' },
    terrain,
    items,
    entities: setup.entities,
    trapLinks: [],
    cloneLinks: []
  };
}

function monster(type: string, x: number, y: number, dir: Direction = 'N'): EntityPlacement {
  return { type, x, y, dir };
}

function load(level: CompiledLevel): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(level);
  return engine;
}

function world(engine: GameEngine): EpoxyWorld {
  return (engine as unknown as { w: EpoxyWorld }).w;
}

function run(engine: GameEngine, count: number): void {
  for (let i = 0; i < count; i++) engine.tick();
}

function cellOf(engine: GameEngine, type: string): string {
  const found = engine.getEntities().find((e) => e.type === type);
  return found ? `${found.x},${found.y}` : 'gone';
}

/** The skitter in a room with the player at an offset from it, after its first step. */
function afterFirstStep(player: { x: number; y: number }, terrain: Array<[number, number, string]> = []): string {
  const engine = load(room({ entities: [monster(SKITTER, CENTER, CENTER)], player, terrain }));
  run(engine, STEP_TICKS);
  return cellOf(engine, SKITTER);
}

beforeEach(() => {
  loadTestConfigs();
});

describe('flee: configuration', () => {
  it('defines the skitter as a monster that steps away from the player, on the teeth interval', () => {
    const def = ConfigRegistry.getEntityDef(SKITTER);
    expect(def?.kind).toBe('monster');
    expect(def?.movementPattern).toBe(FLEE_PLAYER_PATTERN);
    expect(def?.moveIntervalTicks).toBe(SKITTER_INTERVAL);
    expect(def?.moveIntervalTicks).toBe(ConfigRegistry.getEntityDef('teeth')?.moveIntervalTicks);
    expect(def?.steeredBy).toBeUndefined();
    expect(def?.passesTiles).toBeUndefined();
  });

  it('is accepted by the pattern whitelist', () => {
    expect(findSteeringConfigErrors(ConfigRegistry.getTiles().tiles, ConfigRegistry.getMonsters().entities)).toEqual([]);
  });

  it('is named in both languages', () => {
    expect(en.entities.skitter.name).toBe('Skitter');
    expect(fr.entities.skitter.name).toBe('Fuyard');
  });
});

describe('flee: the direction of a step', () => {
  it('steps away from the player on the axis of the greater distance', () => {
    expect(afterFirstStep({ x: 8, y: 5 })).toBe('4,5');
    expect(afterFirstStep({ x: 2, y: 5 })).toBe('6,5');
    expect(afterFirstStep({ x: 5, y: 8 })).toBe('5,4');
    expect(afterFirstStep({ x: 5, y: 2 })).toBe('5,6');
    // Off the lines: the greater distance decides.
    expect(afterFirstStep({ x: 8, y: 6 })).toBe('4,5');
    expect(afterFirstStep({ x: 6, y: 8 })).toBe('5,4');
  });

  it('prefers the horizontal axis when both distances are equal', () => {
    expect(afterFirstStep({ x: 7, y: 7 })).toBe('4,5');
    expect(afterFirstStep({ x: 3, y: 3 })).toBe('6,5');
  });

  it('tries the other axis when the first is blocked and the player is off the line', () => {
    // The player is to the west and a little north: east is the first choice, south the second.
    expect(afterFirstStep({ x: 3, y: 4 }, [[6, 5, 'wall']])).toBe('5,6');
  });

  it('waits when the player is in line and the way is blocked', () => {
    const engine = load(room({ entities: [monster(SKITTER, CENTER, CENTER)], player: { x: 3, y: 5 }, terrain: [[6, 5, 'wall']] }));
    run(engine, STEP_TICKS * MANY_STEPS);
    expect(cellOf(engine, SKITTER)).toBe('5,5');
  });

  it('waits in a corner it cannot leave away from the player', () => {
    const engine = load(room({ entities: [monster(SKITTER, 1, 1)], player: { x: 4, y: 4 } }));
    run(engine, STEP_TICKS * MANY_STEPS);
    expect(cellOf(engine, SKITTER)).toBe('1,1');
  });

  it('does not move when it shares the cell of the player', () => {
    const engine = load(room({ entities: [monster(SKITTER, CENTER, CENTER)], player: { x: 2, y: 2 } }));
    const w = world(engine);
    w.player.x = CENTER;
    w.player.y = CENTER;
    run(engine, STEP_TICKS * 3);
    expect(cellOf(engine, SKITTER)).toBe('5,5');
    expect(w.player.alive).toBe(true);
  });

  it('is a chase with the choices reversed: opposite to teeth from the same place', () => {
    const offsets: Array<[number, number]> = [[8, 5], [2, 6], [5, 8], [4, 2], [7, 7], [3, 4]];
    for (const [px, py] of offsets) {
      const flee = afterFirstStep({ x: px, y: py });
      const chase = load(room({ entities: [monster('teeth', CENTER, CENTER)], player: { x: px, y: py } }));
      run(chase, STEP_TICKS);
      const [cx, cy] = cellOf(chase, 'teeth').split(',').map(Number);
      expect(flee, `${px},${py}`).toBe(`${2 * CENTER - cx},${2 * CENTER - cy}`);
    }
  });

  it('keeps running to the wall while the player stays', () => {
    const engine = load(room({ entities: [monster(SKITTER, CENTER, CENTER)], player: { x: 2, y: 5 } }));
    run(engine, STEP_TICKS * MANY_STEPS);
    expect(cellOf(engine, SKITTER)).toBe('9,5');
  });

  it('refuses a cell with an item other than a bomb, and waits', () => {
    const engine = load(room({ entities: [monster(SKITTER, CENTER, CENTER)], player: { x: 3, y: 5 }, items: [[6, 5, 'chip']] }));
    run(engine, STEP_TICKS * 3);
    expect(cellOf(engine, SKITTER)).toBe('5,5');
  });

  it('dies on a bomb and in water, as any monster does', () => {
    const bomb = load(room({ entities: [monster(SKITTER, CENTER, CENTER)], player: { x: 3, y: 5 }, items: [[6, 5, 'bomb']] }));
    run(bomb, STEP_TICKS);
    expect(cellOf(bomb, SKITTER)).toBe('gone');
    const water = load(room({ entities: [monster(SKITTER, CENTER, CENTER)], player: { x: 3, y: 5 }, terrain: [[6, 5, 'water']] }));
    run(water, STEP_TICKS);
    expect(cellOf(water, SKITTER)).toBe('gone');
  });
});

describe('flee: the pace of a step', () => {
  it('waits its interval, steps on the next tick, then steps every interval plus one', () => {
    const engine = load(room({ entities: [monster(SKITTER, CENTER, CENTER)], player: { x: 1, y: 5 } }));
    run(engine, SKITTER_INTERVAL);
    expect(cellOf(engine, SKITTER)).toBe('5,5');
    run(engine, 1);
    expect(cellOf(engine, SKITTER)).toBe('6,5');
    run(engine, STEP_TICKS - 1);
    expect(cellOf(engine, SKITTER)).toBe('6,5');
    run(engine, 1);
    expect(cellOf(engine, SKITTER)).toBe('7,5');
  });

  it('takes twice as long under slow-time boots', () => {
    const engine = load(room({ entities: [monster(SKITTER, CENTER, CENTER)], player: { x: 1, y: 5 } }));
    world(engine).player.boots.add(SLOW_TIME_BOOTS);
    run(engine, STEP_TICKS);
    expect(cellOf(engine, SKITTER)).toBe('6,5');
    run(engine, SLOWED_STEP_TICKS - 1);
    expect(cellOf(engine, SKITTER)).toBe('6,5');
    run(engine, 1);
    expect(cellOf(engine, SKITTER)).toBe('7,5');
  });

  it('waits the full interval after a forced step too', () => {
    // A force floor carries the skitter toward the player; the step still costs a whole interval.
    const engine = load(
      room({ entities: [monster(SKITTER, CENTER, CENTER)], player: { x: 5, y: 9 }, terrain: [[CENTER, CENTER, 'force_s']] })
    );
    run(engine, STEP_TICKS);
    expect(cellOf(engine, SKITTER)).toBe('5,6');
    run(engine, STEP_TICKS - 1);
    expect(cellOf(engine, SKITTER)).toBe('5,6');
    run(engine, 1);
    // Back on plain floor, it runs away from the player again.
    expect(cellOf(engine, SKITTER)).toBe('5,5');
  });
});