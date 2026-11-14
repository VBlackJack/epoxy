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
 * Review fixes of the CC2 tool belt: the bribe is a tool of the belt and is put down like the others (Lexy's Labyrinth
 * tiletypes.js bribe), the toll token never sits on the belt, reading the belt does not change it, and a yellow pad taken from
 * the floor obeys the cap of four tools.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { BRIBE_ITEM_ID, TOKEN_ITEM_ID } from '../coreConstants';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { room, ROOM_ROW, type RoomMode } from '../../test/cc2Room';
import { GameEngine } from '../GameEngine';
import type { EpoxyWorld } from './epoxyWorld';

beforeEach(() => {
  loadTestConfigs();
});

const FIRST_X = 3;
const BOOTS = ['boots_water', 'boots_fire', 'boots_ice', 'boots_force'];
const PAD = 'teleport_forward';
const PAD_ITEM = 'teleport_yellow_item';
const WALL = 'wall';
const MAX_WAIT_TICKS = 40;
const SETTLE_TICKS = 20;
const PAD_A = { x: 3, y: ROOM_ROW };
const PAD_B = { x: 9, y: 3 };
const B_EXIT = { x: PAD_B.x + 1, y: PAD_B.y };

const world = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;

function corridor(mode: RoomMode, items: string[]): GameEngine {
  const cells: Record<string, string> = {};
  items.forEach((id, i) => {
    cells[`${FIRST_X + i},${ROOM_ROW}`] = id;
  });
  const engine = new GameEngine();
  engine.loadLevel(room({ mode, startX: FIRST_X - 1, items: cells }));
  return engine;
}

function walkEast(engine: GameEngine, steps: number): void {
  for (let i = 0; i < steps; i++) {
    for (let t = 0; t < MAX_WAIT_TICKS && engine.getPlayer().moveCooldown > 0; t++) engine.tick();
    expect(engine.attemptPlayerMove('E')).toBe(true);
  }
}

describe('the bribe on the belt', () => {
  it('sits on the belt, and the drop key puts it down when it is the oldest tool', () => {
    const engine = corridor('cc2', [BRIBE_ITEM_ID, BOOTS[0], BOOTS[1]]);
    walkEast(engine, 3);
    expect(engine.getToolBelt()).toEqual([BRIBE_ITEM_ID, BOOTS[0], BOOTS[1]]);
    const head = (engine.getToolBelt() as readonly string[])[0];
    expect(engine.dropItem(head)).toBe(true);
    expect(world(engine).items[ROOM_ROW][engine.getPlayer().x]).toBe(BRIBE_ITEM_ID);
    expect(engine.getToolBelt()).toEqual([BOOTS[0], BOOTS[1]]);
    expect(engine.getPlayer().keys[BRIBE_ITEM_ID]).toBeUndefined();
  });

  it('is pushed out onto the cell by a fifth tool like any other tool', () => {
    const engine = corridor('cc2', [BRIBE_ITEM_ID, BOOTS[0], BOOTS[1], BOOTS[2], BOOTS[3]]);
    walkEast(engine, 5);
    expect(engine.getToolBelt()).toEqual(BOOTS);
    expect(world(engine).items[ROOM_ROW][engine.getPlayer().x]).toBe(BRIBE_ITEM_ID);
  });

  it('is still refused as a drop on a level without the belt (native rules unchanged)', () => {
    const engine = corridor('native', [BRIBE_ITEM_ID]);
    walkEast(engine, 1);
    expect(engine.dropItem(BRIBE_ITEM_ID)).toBe(false);
    expect(engine.getPlayer().keys[BRIBE_ITEM_ID]).toBe(1);
  });
});

describe('the toll token', () => {
  it('stays off the belt and cannot block the drop of the tools behind it', () => {
    const engine = corridor('cc2', [TOKEN_ITEM_ID, BOOTS[0], BOOTS[1]]);
    walkEast(engine, 3);
    expect(engine.getPlayer().keys[TOKEN_ITEM_ID]).toBe(1);
    expect(engine.getToolBelt()).toEqual([BOOTS[0], BOOTS[1]]);
    expect(engine.dropItem(BOOTS[0])).toBe(true);
    expect(engine.dropItem(TOKEN_ITEM_ID)).toBe(false);
  });
});

describe('reading the belt', () => {
  it('does not change the player: a tool that left is dropped from the belt at the next tick, not by the read', () => {
    const engine = corridor('cc2', [BOOTS[0], BOOTS[1], BOOTS[2]]);
    walkEast(engine, 3);
    const p = world(engine).player;
    p.boots.delete(BOOTS[1]);
    const before = [...(p.belt as string[])];
    expect(engine.getToolBelt()).toEqual([BOOTS[0], BOOTS[2]]);
    expect(p.belt).toEqual(before);
    const copy = engine.getToolBelt() as string[];
    copy.push('junk');
    expect(engine.getToolBelt()).toEqual([BOOTS[0], BOOTS[2]]);
    engine.tick();
    expect(p.belt).toEqual([BOOTS[0], BOOTS[2]]);
  });
});

describe('a yellow pad taken from the floor', () => {
  function padLevel(mode: RoomMode, held: string[]): GameEngine {
    const engine = new GameEngine();
    engine.loadLevel(room({ mode, terrain: { [`${PAD_A.x},${PAD_A.y}`]: PAD, [`${PAD_B.x},${PAD_B.y}`]: PAD, [`${B_EXIT.x},${B_EXIT.y}`]: WALL } }));
    const p = world(engine).player;
    for (const id of held) p.boots.add(id);
    return engine;
  }

  function enterPad(engine: GameEngine): void {
    for (let waited = 0; waited <= MAX_WAIT_TICKS && engine.getPlayer().moveCooldown !== 0; waited++) engine.tick();
    engine.attemptPlayerMove('E');
    for (let i = 0; i < SETTLE_TICKS; i++) engine.tick();
  }

  it('joins the belt and, with four tools held, puts the oldest down on the cell', () => {
    const engine = padLevel('cc2', BOOTS);
    world(engine).player.belt = [...BOOTS];
    enterPad(engine);
    const w = world(engine);
    expect(w.player.keys[PAD_ITEM]).toBe(1);
    expect(engine.getToolBelt()).toEqual([...BOOTS.slice(1), PAD_ITEM]);
    expect(w.player.boots.has(BOOTS[0])).toBe(false);
    expect(w.items[PAD_A.y][PAD_A.x]).toBe(BOOTS[0]);
    expect(w.terrain[PAD_A.y][PAD_A.x]).toBe('floor');
  });

  it('is refused when the oldest tool is a pad that cannot be set down on the pad cell', () => {
    const engine = padLevel('cc2', BOOTS.slice(0, 3));
    const p = world(engine).player;
    p.keys[PAD_ITEM] = 1;
    p.belt = [PAD_ITEM, ...BOOTS.slice(0, 3)];
    enterPad(engine);
    const w = world(engine);
    expect(w.terrain[PAD_A.y][PAD_A.x]).toBe(PAD);
    expect(w.player.keys[PAD_ITEM]).toBe(1);
    expect(engine.getToolBelt()).toEqual([PAD_ITEM, ...BOOTS.slice(0, 3)]);
  });

  it('lands on the belt with fewer than four tools held and no push-out', () => {
    const engine = padLevel('cc2', []);
    enterPad(engine);
    expect(world(engine).player.keys[PAD_ITEM]).toBe(1);
    expect(world(engine).player.belt).toEqual([PAD_ITEM]);
  });
});
