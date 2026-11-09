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
 * The CC2 helmet (format 14): while it is held, contact with a monster and a block sliding into the player do not kill,
 * and the mover is simply stopped (Lexy's Labyrinth skips the death for the invulnerable trait and then collides as usual).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { GameEngine } from '../GameEngine';
import type { CompiledLevel, Direction, EntityPlacement } from '../types';
import { moveBlockTo } from './epoxyBlocks';
import { resolveMonsterArrival } from './epoxyMonsters';
import type { EpoxyContext } from './epoxyWorld';

const SIZE = 11;
const ROW = 5;
const PLAYER_X = 5;
const HELMET = 'helmet';
const WARD = 'ward';
const BOOT_THIEF = 'thief';
const MAX_WAIT_TICKS = 40;
const CHASE_TICKS = 80;

interface Setup {
  terrain?: Array<[number, number, string]>;
  items?: Array<[number, number, string]>;
  entities?: EntityPlacement[];
  player?: { x: number; y: number };
}

/** A walled room cut to a lane along the row, so a mover can only go forward or back. */
function lane(setup: Setup = {}): CompiledLevel {
  const terrain: string[][] = Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x) => (x === 0 || y !== ROW || x === SIZE - 1 ? 'wall' : 'floor'))
  );
  for (const [x, y, id] of setup.terrain ?? []) terrain[y][x] = id;
  const items: Array<Array<string | null>> = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null));
  for (const [x, y, id] of setup.items ?? []) items[y][x] = id;
  return {
    id: 'helmet_contact_lane',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    playerStart: { ...(setup.player ?? { x: PLAYER_X, y: ROW }), dir: 'E' },
    terrain,
    items,
    entities: setup.entities ?? [],
    trapLinks: [],
    cloneLinks: []
  };
}

function load(level: CompiledLevel, boots: string[] = []): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(level);
  for (const e of engine.getEntities()) if (e.kind === 'block') e.isSliding = true;
  for (const boot of boots) engine.getPlayer().boots.add(boot);
  return engine;
}

function contextOf(engine: GameEngine): EpoxyContext {
  return (engine as unknown as { ctx: EpoxyContext }).ctx;
}

function placed(type: string, x: number, y: number, dir: Direction = 'E'): EntityPlacement {
  return { type, x, y, dir };
}

function step(engine: GameEngine, dir: Direction): boolean {
  for (let waited = 0; waited <= MAX_WAIT_TICKS; waited++) {
    if (engine.getPlayer().moveCooldown === 0) return engine.attemptPlayerMove(dir);
    engine.tick();
  }
  throw new Error('the player never became able to move');
}

function run(engine: GameEngine, ticks: number): void {
  for (let i = 0; i < ticks; i++) engine.tick();
}

beforeEach(() => {
  loadTestConfigs();
});

describe('helmet: monsters', () => {
  it('kills no one when a monster walks into the player, and the monster stays out of the cell', () => {
    const engine = load(lane({ entities: [placed('walker', PLAYER_X - 2, ROW)] }), [HELMET]);
    run(engine, CHASE_TICKS);
    expect(engine.getPlayer().alive).toBe(true);
    const monster = engine.getEntities().find((e) => e.kind === 'monster');
    expect(monster).toBeDefined();
    expect(monster!.x).toBeLessThan(PLAYER_X);
  });

  it('still kills without the helmet (control)', () => {
    const engine = load(lane({ entities: [placed('walker', PLAYER_X - 2, ROW)] }));
    run(engine, CHASE_TICKS);
    expect(engine.getPlayer().alive).toBe(false);
  });

  it('blocks the player who walks into a monster: no death, no move, the monster stays', () => {
    const engine = load(lane({ entities: [placed('walker', PLAYER_X + 1, ROW)] }), [HELMET]);
    const monster = engine.getEntities().find((e) => e.kind === 'monster')!;
    monster.cooldownTicks = CHASE_TICKS * CHASE_TICKS;
    expect(step(engine, 'E')).toBe(false);
    expect(engine.getPlayer().alive).toBe(true);
    expect(engine.getPlayer().x).toBe(PLAYER_X);
    expect(engine.getEntities().some((e) => e.kind === 'monster' && e.x === PLAYER_X + 1)).toBe(true);
  });

  it('does not kill when a teleport or clone arrival lands on the player, and keeps the monster', () => {
    const engine = load(lane({ entities: [placed('walker', PLAYER_X, ROW)] }), [HELMET]);
    const monster = engine.getEntities().find((e) => e.kind === 'monster')!;
    expect(resolveMonsterArrival(contextOf(engine), monster, false)).toBe(true);
    expect(engine.getPlayer().alive).toBe(true);
    expect(engine.getEntities().some((e) => e.uid === monster.uid)).toBe(true);
  });

  it('wins over a ward: the ward is not spent', () => {
    const engine = load(lane({ entities: [placed('walker', PLAYER_X + 1, ROW)] }), [HELMET, WARD]);
    engine.getEntities().find((e) => e.kind === 'monster')!.cooldownTicks = CHASE_TICKS * CHASE_TICKS;
    step(engine, 'E');
    expect(engine.getPlayer().boots.has(WARD)).toBe(true);
    expect(engine.getPlayer().alive).toBe(true);
  });

  it('is taken by the boot thief like any boots', () => {
    const engine = load(lane({ terrain: [[PLAYER_X + 1, ROW, BOOT_THIEF]] }), [HELMET]);
    step(engine, 'E');
    expect(engine.getPlayer().boots.has(HELMET)).toBe(false);
  });

  it('is picked up from the floor as boots', () => {
    const engine = load(lane({ items: [[PLAYER_X + 1, ROW, HELMET]] }));
    step(engine, 'E');
    expect(engine.getPlayer().boots.has(HELMET)).toBe(true);
  });
});

/** A block sliding east on an ice run toward the player; the engine starts it sliding as a pushed block would be. */
function slidingLane(): CompiledLevel {
  const level = lane({
    terrain: [[PLAYER_X - 3, ROW, 'ice'], [PLAYER_X - 2, ROW, 'ice'], [PLAYER_X - 1, ROW, 'ice']],
    entities: [placed('dirt_block', PLAYER_X - 3, ROW)]
  });
  return level;
}

describe('helmet: blocks', () => {
  it('stops a block sliding on ice into the player, who lives', () => {
    const engine = load(slidingLane(), [HELMET]);
    run(engine, CHASE_TICKS);
    expect(engine.getPlayer().alive).toBe(true);
    expect(engine.getEntities().find((e) => e.kind === 'block')!.x).toBeLessThan(PLAYER_X);
  });

  it('crushes the player under the same sliding block without the helmet (control)', () => {
    const engine = load(slidingLane());
    run(engine, CHASE_TICKS);
    expect(engine.getPlayer().alive).toBe(false);
  });

  it('does not crush when a block arrives on the player by a teleport or clone', () => {
    const engine = load(lane({ entities: [placed('dirt_block', PLAYER_X - 1, ROW)] }), [HELMET]);
    const block = engine.getEntities().find((e) => e.kind === 'block')!;
    moveBlockTo(contextOf(engine), block, PLAYER_X, ROW, 'E', false);
    expect(engine.getPlayer().alive).toBe(true);
  });
});
