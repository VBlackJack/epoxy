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
 * CC2 actors that pick things up (the ghost, the rover) keep the tools they take and flippers carry them over water (Lexy game.js:3245-3256).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { ROOM_ROW, room } from '../../test/cc2Room';
import type { RoomMode } from '../../test/cc2Room';
import { GameEngine } from '../GameEngine';
import { CC2_ENTITY_TOOL_CAPACITY } from '../coreConstants';
import type { RuntimeEntity } from '../types';
import { canMonsterEnter, resolveMonsterArrival } from './epoxyMonsters';
import type { EpoxyContext, EpoxyWorld } from './epoxyWorld';

const CELL_X = 6;
const SEED = 77;
const MAX_TICKS = 200;
const FLIPPERS = 'boots_water';
const FIRE_BOOTS = 'boots_fire';
const KEY = 'key_blue';
const TOOLS = ['boots_water', 'boots_fire', 'boots_ice', 'boots_force', 'boots_speed'];

const worldOf = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;
const contextOf = (engine: GameEngine): EpoxyContext => (engine as unknown as { ctx: EpoxyContext }).ctx;

beforeEach(() => {
  loadTestConfigs();
});

interface Actor {
  engine: GameEngine;
  entity: RuntimeEntity;
}

/** An engine on a room with one actor of the type, at `x` on the room row, and the terrain and item given at CELL_X. */
function setup(mode: RoomMode, type: string, opts: { terrain?: string; item?: string; x?: number } = {}): Actor {
  const level = room({
    mode,
    startX: 11,
    entities: [{ type, x: opts.x ?? CELL_X, y: ROOM_ROW, dir: 'E' }],
    terrain: opts.terrain === undefined ? undefined : { [`${CELL_X},${ROOM_ROW}`]: opts.terrain },
    items: opts.item === undefined ? undefined : { [`${CELL_X},${ROOM_ROW}`]: opts.item }
  });
  const engine = new GameEngine();
  engine.loadLevel(level, SEED);
  return { engine, entity: engine.getEntities()[0] };
}

const arrive = (a: Actor): boolean => resolveMonsterArrival(contextOf(a.engine), a.entity, false);
const stillThere = (a: Actor): boolean => a.engine.getEntities().some((e) => e.uid === a.entity.uid);
const cellItem = (a: Actor): string | null => worldOf(a.engine).items[ROOM_ROW][CELL_X];

describe('held tools: picking up', () => {
  it.each(['ghost', 'rover'])('lets a CC2 %s keep a tool it takes and removes it from the cell', (type) => {
    const a = setup('cc2', type, { item: FLIPPERS });
    arrive(a);
    expect(a.entity.heldTools).toEqual([FLIPPERS]);
    expect(cellItem(a)).toBeNull();
  });

  it('takes a key off the cell without holding it', () => {
    const a = setup('cc2', 'ghost', { item: KEY });
    arrive(a);
    expect(cellItem(a)).toBeNull();
    expect('heldTools' in a.entity).toBe(false);
  });

  it('leaves heldTools unset on an actor that takes nothing', () => {
    const a = setup('cc2', 'ghost');
    arrive(a);
    expect('heldTools' in a.entity).toBe(false);
  });

  it('drops the oldest tool on the cell when a fifth is taken', () => {
    const a = setup('cc2', 'ghost', { item: TOOLS[CC2_ENTITY_TOOL_CAPACITY] });
    a.entity.heldTools = TOOLS.slice(0, CC2_ENTITY_TOOL_CAPACITY);
    arrive(a);
    expect(a.entity.heldTools).toEqual(TOOLS.slice(1));
    expect(cellItem(a)).toBe(TOOLS[0]);
  });

  it('restores an empty actor when the state is restored after a pickup', () => {
    const a = setup('cc2', 'ghost', { item: FLIPPERS });
    const before = a.engine.captureState();
    arrive(a);
    expect(a.engine.getEntities()[0].heldTools).toEqual([FLIPPERS]);
    a.engine.restoreState(before);
    expect('heldTools' in a.engine.getEntities()[0]).toBe(false);
    expect(cellItem(a)).toBe(FLIPPERS);
  });

  it('starts an actor placed at load empty, as a clone machine releases one', () => {
    const a = setup('cc2', 'ghost');
    expect('heldTools' in a.entity).toBe(false);
  });

  it.each<RoomMode>(['cc', 'native'])('holds nothing on a %s level, where the item is still taken', (mode) => {
    const a = setup(mode, 'ghost', { item: FLIPPERS });
    arrive(a);
    expect('heldTools' in a.entity).toBe(false);
    expect(cellItem(a)).toBeNull();
  });
});

describe('held tools: flippers and water', () => {
  /** The ghost stands west of the water and looks east; the question is whether it may step in. */
  function ghostBeside(mode: RoomMode, held?: string[], terrain = 'water'): Actor {
    const a = setup(mode, 'ghost', { terrain, x: CELL_X - 1 });
    if (held !== undefined) a.entity.heldTools = held;
    return a;
  }
  const mayEnter = (a: Actor): boolean => canMonsterEnter(worldOf(a.engine), a.entity, 'E');

  it('bars a CC2 ghost from water without flippers and lets it in with them', () => {
    expect(mayEnter(ghostBeside('cc2'))).toBe(false);
    expect(mayEnter(ghostBeside('cc2', [FLIPPERS]))).toBe(true);
    expect(mayEnter(ghostBeside('cc2', [FIRE_BOOTS]))).toBe(false);
  });

  it('keeps the turtle shut to a ghost that holds flippers', () => {
    expect(mayEnter(ghostBeside('cc2', [FLIPPERS], 'turtle_cc2'))).toBe(false);
  });

  it('keeps a ghost with flippers alive on the water', () => {
    const a = setup('cc2', 'ghost', { terrain: 'water' });
    a.entity.heldTools = [FLIPPERS];
    arrive(a);
    expect(stillThere(a)).toBe(true);
  });

  it('lets a rover survive water with flippers and removes it without them', () => {
    const bare = setup('cc2', 'rover', { terrain: 'water' });
    arrive(bare);
    expect(stillThere(bare)).toBe(false);
    const shod = setup('cc2', 'rover', { terrain: 'water' });
    shod.entity.heldTools = [FLIPPERS];
    arrive(shod);
    expect(stillThere(shod)).toBe(true);
  });

  it('lets a rover that holds fire boots survive fire', () => {
    const bare = setup('cc2', 'rover', { terrain: 'fire' });
    arrive(bare);
    expect(stillThere(bare)).toBe(false);
    const shod = setup('cc2', 'rover', { terrain: 'fire' });
    shod.entity.heldTools = [FIRE_BOOTS];
    arrive(shod);
    expect(stillThere(shod)).toBe(true);
  });

  it('ignores held tools off the CC2 engine', () => {
    expect(mayEnter(ghostBeside('cc', [FLIPPERS]))).toBe(false);
    const native = setup('native', 'rover', { terrain: 'water' });
    native.entity.heldTools = [FLIPPERS];
    arrive(native);
    expect(stillThere(native)).toBe(false);
  });

  it('walks a ghost with flippers across water over many ticks', () => {
    const a = ghostBeside('cc2', [FLIPPERS]);
    for (let i = 0; i < MAX_TICKS && stillThere(a) && a.entity.x <= CELL_X; i++) a.engine.tick();
    expect(stillThere(a)).toBe(true);
    expect(a.entity.x).toBeGreaterThan(CELL_X);
  });
});
