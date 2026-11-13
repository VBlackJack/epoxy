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
 * The yellow teleporter of a CC2 level that had more than one at load is an item (Lexy's Labyrinth tiletypes.js
 * teleport_yellow, game.js allow_taking_yellow_teleporters): a player who finds no free pad picks the pad up, the pad list is
 * read live from the grid, and a pad set down later is a destination. Native and classic levels keep the pad a pad. Only the
 * player (and, later, the rolling ball) takes the pad; a monster that finds no free pad leaves forward as before.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { room, ROOM_ROW, type RoomMode } from '../../test/cc2Room';
import { GameEngine } from '../GameEngine';
import type { EpoxyWorld } from './epoxyWorld';

const PAD = 'teleport_forward';
const ITEM = 'teleport_yellow_item';
const WALL = 'wall';
const FLOOR = 'floor';
const SETTLE_TICKS = 20;
const MAX_WAIT_TICKS = 40;
/** The pad the player enters, and the pad he is sent to; the cell east of B is the exit the tests close. */
const PAD_A = { x: 3, y: ROOM_ROW };
const PAD_B = { x: 9, y: 3 };
const PAD_C = { x: 6, y: 9 };
const B_EXIT = { x: PAD_B.x + 1, y: PAD_B.y };

type Cell = { x: number; y: number };
const key = (cell: Cell): string => `${cell.x},${cell.y}`;
const world = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;

function load(mode: RoomMode, pads: Cell[], extra: Record<string, string> = {}): GameEngine {
  const terrain: Record<string, string> = { ...extra };
  for (const pad of pads) terrain[key(pad)] = PAD;
  const engine = new GameEngine();
  engine.loadLevel(room({ mode, terrain }));
  return engine;
}

function settle(engine: GameEngine): void {
  for (let i = 0; i < SETTLE_TICKS; i++) engine.tick();
}

/** Steps east onto the pad ahead and lets the jump and the exit step settle. */
function enter(engine: GameEngine): void {
  for (let waited = 0; waited <= MAX_WAIT_TICKS && engine.getPlayer().moveCooldown !== 0; waited++) engine.tick();
  engine.attemptPlayerMove('E');
  settle(engine);
}

/** Puts the player on the cell west of `cell`, facing east and ready to step. */
function standWestOf(engine: GameEngine, cell: Cell): void {
  const p = world(engine).player;
  p.x = cell.x - 1;
  p.y = cell.y;
  p.dir = 'E';
  p.moveCooldown = 0;
}

const at = (engine: GameEngine): Cell => ({ x: engine.getPlayer().x, y: engine.getPlayer().y });
const held = (engine: GameEngine, id: string): number => world(engine).player.keys[id] ?? 0;
const terrainAt = (engine: GameEngine, cell: Cell): string => world(engine).terrain[cell.y][cell.x];

beforeEach(() => {
  loadTestConfigs();
});

describe('yellow pad picked up on the CC2 engine', () => {
  it('jumps to the free pad while one is free (control)', () => {
    const engine = load('cc2', [PAD_A, PAD_B]);
    enter(engine);
    expect(at(engine)).toEqual(B_EXIT);
    expect(held(engine, ITEM)).toBe(0);
    expect(terrainAt(engine, PAD_A)).toBe(PAD);
  });

  it('picks the pad up when no pad is free: the cell turns to floor and the player holds the item', () => {
    const engine = load('cc2', [PAD_A, PAD_B], { [key(B_EXIT)]: WALL });
    enter(engine);
    expect(at(engine)).toEqual(PAD_A);
    expect(terrainAt(engine, PAD_A)).toBe(FLOOR);
    expect(held(engine, ITEM)).toBe(1);
    expect(terrainAt(engine, PAD_B)).toBe(PAD);
  });

  it('picks the pad up when the other pad holds a block', () => {
    const engine = new GameEngine();
    engine.loadLevel({
      ...room({ mode: 'cc2', terrain: { [key(PAD_A)]: PAD, [key(PAD_B)]: PAD } }),
      entities: [{ type: 'dirt_block', x: PAD_B.x, y: PAD_B.y, dir: 'S' }]
    });
    enter(engine);
    expect(terrainAt(engine, PAD_A)).toBe(FLOOR);
    expect(held(engine, ITEM)).toBe(1);
  });

  it('does not count a pad that was picked up: the last pad is picked up in its turn', () => {
    const engine = load('cc2', [PAD_A, PAD_B], { [key(B_EXIT)]: WALL });
    enter(engine);
    expect(terrainAt(engine, PAD_A)).toBe(FLOOR);
    standWestOf(engine, PAD_B);
    engine.attemptPlayerMove('E');
    settle(engine);
    expect(terrainAt(engine, PAD_B)).toBe(FLOOR);
    expect(held(engine, ITEM)).toBe(2);
  });

  it('lays the pad back on plain floor when the item is dropped, and the dropped pad is a destination', () => {
    const engine = load('cc2', [PAD_A, PAD_B], { [key(B_EXIT)]: WALL });
    enter(engine);
    expect(held(engine, ITEM)).toBe(1);
    const p = world(engine).player;
    p.x = PAD_C.x;
    p.y = PAD_C.y;
    p.moveCooldown = 0;
    expect(engine.dropItem(ITEM)).toBe(true);
    expect(terrainAt(engine, PAD_C)).toBe(PAD);
    expect(held(engine, ITEM)).toBe(0);
    // Entering B (its own exit closed): the pad C he set down is read from the grid, and he leaves it forward.
    standWestOf(engine, PAD_B);
    engine.attemptPlayerMove('E');
    settle(engine);
    expect(terrainAt(engine, PAD_B)).toBe(PAD);
    expect(at(engine)).toEqual({ x: PAD_C.x + 1, y: PAD_C.y });
  });

  it('reads a pad that appears after the load, which the lookups built at load never held', () => {
    const engine = load('cc2', [PAD_A, PAD_B], { [key(B_EXIT)]: WALL });
    world(engine).terrain[PAD_C.y][PAD_C.x] = PAD;
    enter(engine);
    expect(at(engine)).toEqual({ x: PAD_C.x + 1, y: PAD_C.y });
    expect(held(engine, ITEM)).toBe(0);
  });

  it('keeps a single yellow pad a pad: no item, the player stays on it', () => {
    const engine = load('cc2', [PAD_A]);
    expect(world(engine).cc2YellowPadsAreItems).toBe(false);
    enter(engine);
    expect(terrainAt(engine, PAD_A)).toBe(PAD);
    expect(held(engine, ITEM)).toBe(0);
  });

  it.each<RoomMode>(['cc', 'native'])('leaves a %s level unchanged: the pad stays a pad', (mode) => {
    const engine = load(mode, [PAD_A, PAD_B], { [key(B_EXIT)]: WALL });
    enter(engine);
    expect(world(engine).cc2YellowPadsAreItems).toBe(false);
    expect(terrainAt(engine, PAD_A)).toBe(PAD);
    expect(held(engine, ITEM)).toBe(0);
  });

  it('survives an undo: the pad is back and the item is gone', () => {
    const engine = load('cc2', [PAD_A, PAD_B], { [key(B_EXIT)]: WALL });
    for (let waited = 0; waited <= MAX_WAIT_TICKS && engine.getPlayer().moveCooldown !== 0; waited++) engine.tick();
    expect(engine.attemptPlayerMove('E')).toBe(true);
    expect(held(engine, ITEM)).toBe(1);
    expect(engine.undo()).toBe(true);
    expect(terrainAt(engine, PAD_A)).toBe(PAD);
    expect(held(engine, ITEM)).toBe(0);
  });
});
