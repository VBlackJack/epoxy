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
 * The tool belt of a CC2-engine level holds four tools (Lexy's Labyrinth game.js:3237-3275): a fifth pickup pushes the oldest
 * tool out onto the cell, by the rules of a drop (dynamite is set down unlit, a bowling ball rolls off, a yellow pad becomes the
 * pad), and a pickup is refused when the oldest tool is a yellow pad and the cell is not plain floor. The belt array,
 * duplicates allowed, is the order of the tools. A level that asks for the CC1 boot rules (OPTN byte 23) and every other
 * ruleset keep what they had.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { CC2_TOOL_BELT_CAPACITY, STONE_ITEM_ID } from '../coreConstants';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { CC2_TEST_RECORD, room, ROOM_ROW, type RoomMode } from '../../test/cc2Room';
import { GameEngine } from '../GameEngine';
import type { CompiledLevel } from '../types';
import type { EpoxyWorld } from './epoxyWorld';

beforeEach(() => {
  loadTestConfigs();
});

const FIRST_X = 3;
const BOOTS = ['boots_water', 'boots_fire', 'boots_ice', 'boots_force'];
const FIFTH = 'boots_speed';
const DYNAMITE = 'dynamite';
const YELLOW_PAD_ITEM = 'teleport_yellow_item';
const MAX_WAIT_TICKS = 40;
const SETTLE_TICKS = 60;

const world = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;

/** A corridor of items starting at FIRST_X on the player's row; the player stands just west of it. */
function corridor(mode: RoomMode, items: string[], opts: { cc1Boots?: boolean; terrain?: Record<string, string> } = {}): CompiledLevel {
  const cells: Record<string, string> = {};
  items.forEach((id, i) => {
    cells[`${FIRST_X + i},${ROOM_ROW}`] = id;
  });
  const base = room({ mode, startX: FIRST_X - 1, items: cells, terrain: opts.terrain });
  return opts.cc1Boots && base.cc2 !== undefined ? { ...base, cc2: { ...CC2_TEST_RECORD, useCc1Boots: true } } : base;
}

function walkEast(engine: GameEngine, steps: number): void {
  for (let i = 0; i < steps; i++) {
    for (let t = 0; t < MAX_WAIT_TICKS && engine.getPlayer().moveCooldown > 0; t++) engine.tick();
    expect(engine.attemptPlayerMove('E')).toBe(true);
  }
}

function settle(engine: GameEngine): void {
  for (let t = 0; t < SETTLE_TICKS; t++) engine.tick();
}

describe('the four-tool belt of a CC2-engine level', () => {
  it('holds four tools in pickup order', () => {
    const engine = new GameEngine();
    engine.loadLevel(corridor('cc2', BOOTS));
    walkEast(engine, BOOTS.length);
    expect(CC2_TOOL_BELT_CAPACITY).toBe(BOOTS.length);
    expect(engine.getPlayer().belt).toEqual(BOOTS);
    expect(engine.getToolBelt()).toEqual(BOOTS);
    expect([...engine.getPlayer().boots]).toEqual(BOOTS);
  });

  it('pushes the oldest tool out onto the cell on a fifth pickup', () => {
    const engine = new GameEngine();
    engine.loadLevel(corridor('cc2', [...BOOTS, FIFTH]));
    walkEast(engine, BOOTS.length + 1);
    const p = engine.getPlayer();
    expect(p.x).toBe(FIRST_X + BOOTS.length);
    expect(p.belt).toEqual([...BOOTS.slice(1), FIFTH]);
    expect(p.boots.has(BOOTS[0])).toBe(false);
    expect(p.boots.has(FIFTH)).toBe(true);
    expect(world(engine).items[ROOM_ROW][p.x]).toBe(BOOTS[0]);
  });

  it('counts a tool held twice (dynamite) as two tools of the belt', () => {
    const engine = new GameEngine();
    engine.loadLevel(corridor('cc2', [DYNAMITE, DYNAMITE, BOOTS[0], BOOTS[1], BOOTS[2]]));
    walkEast(engine, 5);
    const p = engine.getPlayer();
    expect(p.belt).toEqual([DYNAMITE, BOOTS[0], BOOTS[1], BOOTS[2]]);
    expect(p.keys[DYNAMITE]).toBe(1);
    expect(world(engine).items[ROOM_ROW][p.x]).toBe(DYNAMITE);
  });

  it('sets dynamite down unlit, and it lights once he has left the cell', () => {
    const engine = new GameEngine();
    engine.loadLevel(corridor('cc2', [DYNAMITE, BOOTS[0], BOOTS[1], BOOTS[2], FIFTH]));
    walkEast(engine, 5);
    const w = world(engine);
    expect(w.items[ROOM_ROW][w.player.x]).toBe(DYNAMITE);
    expect(w.litCharges.some((c) => c.x === w.player.x && c.awaitingDeparture === true)).toBe(true);
    walkEast(engine, 1);
    expect(w.litCharges.some((c) => c.awaitingDeparture === true)).toBe(false);
    expect(w.litCharges.length).toBe(1);
  });

  it('rolls a bowling ball off when it is pushed out', () => {
    const engine = new GameEngine();
    engine.loadLevel(corridor('cc2', [STONE_ITEM_ID, BOOTS[0], BOOTS[1], BOOTS[2], FIFTH]));
    walkEast(engine, 5);
    expect(engine.getPlayer().keys[STONE_ITEM_ID]).toBeUndefined();
    expect(engine.getEntities().some((e) => e.type === 'rolling_ball')).toBe(true);
    expect(world(engine).items[ROOM_ROW][engine.getPlayer().x]).toBeNull();
  });

  it('sets a yellow pad down as the pad when the cell is plain floor', () => {
    const engine = new GameEngine();
    engine.loadLevel(corridor('cc2', [BOOTS[3]]));
    const p = world(engine).player;
    p.keys[YELLOW_PAD_ITEM] = 1;
    p.belt = [YELLOW_PAD_ITEM, ...BOOTS.slice(0, 3)];
    p.boots = new Set(BOOTS.slice(0, 3));
    // The belt already holds four tools, the oldest the pad: the first pickup pushes it out onto its own cell.
    walkEast(engine, 1);
    expect(world(engine).terrain[ROOM_ROW][FIRST_X]).toBe('teleport_forward');
    expect(engine.getPlayer().keys[YELLOW_PAD_ITEM]).toBeUndefined();
  });

  it('refuses the pickup when the oldest tool is a yellow pad and the cell is not plain floor', () => {
    const engine = new GameEngine();
    engine.loadLevel(corridor('cc2', [BOOTS[3]], { terrain: { [`${FIRST_X},${ROOM_ROW}`]: 'gravel' } }));
    const p = world(engine).player;
    p.keys[YELLOW_PAD_ITEM] = 1;
    p.belt = [YELLOW_PAD_ITEM, ...BOOTS.slice(0, 3)];
    p.boots = new Set(BOOTS.slice(0, 3));
    walkEast(engine, 1);
    expect(engine.getPlayer().x).toBe(FIRST_X);
    expect(world(engine).items[ROOM_ROW][FIRST_X]).toBe(BOOTS[3]);
    expect(engine.getPlayer().boots.has(BOOTS[3])).toBe(false);
    expect(engine.getPlayer().keys[YELLOW_PAD_ITEM]).toBe(1);
    expect(engine.getPlayer().belt).toEqual([YELLOW_PAD_ITEM, ...BOOTS.slice(0, 3)]);
  });

  it('follows what the player lost: a tool put down leaves the belt', () => {
    const engine = new GameEngine();
    engine.loadLevel(corridor('cc2', BOOTS.slice(0, 3)));
    walkEast(engine, 3);
    expect(engine.dropItem(BOOTS[0])).toBe(true);
    expect(engine.getPlayer().belt).toEqual(BOOTS.slice(1, 3));
    expect(engine.getToolBelt()).toEqual(BOOTS.slice(1, 3));
  });

  it('puts down the oldest tool of a kind and keeps the order of the others', () => {
    const engine = new GameEngine();
    engine.loadLevel(corridor('cc2', [DYNAMITE, BOOTS[0], DYNAMITE]));
    walkEast(engine, 3);
    expect(engine.getPlayer().belt).toEqual([DYNAMITE, BOOTS[0], DYNAMITE]);
    expect(engine.dropItem(DYNAMITE)).toBe(true);
    expect(engine.getPlayer().keys[DYNAMITE]).toBe(1);
    expect(engine.getPlayer().belt).toEqual([BOOTS[0], DYNAMITE]);
  });

  it('cycles: the oldest tool goes to the end, and the drop key puts the next one down', () => {
    const engine = new GameEngine();
    engine.loadLevel(corridor('cc2', [BOOTS[0], DYNAMITE, BOOTS[1]]));
    walkEast(engine, 3);
    expect(engine.getToolBelt()).toEqual([BOOTS[0], DYNAMITE, BOOTS[1]]);
    expect(engine.cycleInventory()).toBe(true);
    expect(engine.getToolBelt()).toEqual([DYNAMITE, BOOTS[1], BOOTS[0]]);
    expect(engine.getPlayer().belt).toEqual([DYNAMITE, BOOTS[1], BOOTS[0]]);
    // The cycle needs two tools.
    const lone = new GameEngine();
    lone.loadLevel(corridor('cc2', [BOOTS[0]]));
    walkEast(lone, 1);
    expect(lone.cycleInventory()).toBe(false);
  });

  it('is undone with the pickup', () => {
    const engine = new GameEngine();
    engine.loadLevel(corridor('cc2', [...BOOTS, FIFTH]));
    walkEast(engine, BOOTS.length + 1);
    expect(engine.undo()).toBe(true);
    expect(engine.getPlayer().belt).toEqual(BOOTS);
    expect(engine.getPlayer().boots.has(BOOTS[0])).toBe(true);
  });
});

describe('a level without the four-tool belt', () => {
  it('keeps every tool on a CC2-engine level that asks for the CC1 boot rules', () => {
    const engine = new GameEngine();
    engine.loadLevel(corridor('cc2', [...BOOTS, FIFTH], { cc1Boots: true }));
    walkEast(engine, BOOTS.length + 1);
    expect(engine.getPlayer().belt).toBeUndefined();
    expect(engine.getToolBelt()).toBeUndefined();
    expect(engine.getPlayer().boots.size).toBe(BOOTS.length + 1);
    settle(engine);
  });

  it('keeps every tool on a classic-rules and a native level', () => {
    for (const mode of ['cc', 'native'] as const) {
      const engine = new GameEngine();
      engine.loadLevel(corridor(mode, [...BOOTS, FIFTH]));
      walkEast(engine, BOOTS.length + 1);
      expect(engine.getPlayer().belt).toBeUndefined();
      expect(engine.getPlayer().boots.size).toBe(BOOTS.length + 1);
    }
  });
});
