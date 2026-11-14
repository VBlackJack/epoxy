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

/** CC2 wave 8 review fixes: relative search keys, the ghost bar edit test, dynamite under a canopy and over a barred cell. */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { ROOM_ROW, room as flatRoom } from '../../test/cc2Room';
import type { RoomMode } from '../../test/cc2Room';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { CELL_EDGE_CANOPY_BIT, DYNAMITE_ITEM_ID, FLOOR_TILE_ID } from '../coreConstants';
import { GameEngine } from '../GameEngine';
import type { Cc2LevelData, CellEdge, CompiledLevel } from '../types';
import { cc2HiddenStateKey, ghostBarEdited, type EpoxyContext, type EpoxyWorld } from './epoxyWorld';

const SIZE = 15;
const CENTRE = { x: 7, y: 7 };
const FAR_CELL = { x: 13, y: 13 };
const FUSE_TICKS = 85;
const BLAST_MARGIN_TICKS = 3;
const CC2_STUB = { v: 1 } as unknown as Cc2LevelData;
const CANOPY_CELL = { x: 6, y: 7 };
const BARRED_CELL = { x: 8, y: 7 };
const SAFE_CELL = { x: 7, y: 6 };
const MONSTER_CELL = { x: 3, y: 3 };
const LATER_CLOCK_SHIFT = 7;
const ARRIVAL_DELAY = 2;
const OUT_OF_BOUNDS_CELL = SIZE * SIZE + 4;
const HELD_ITEM = 'chip';
const RECORDED_CELL = 5;

function room(extra: Partial<CompiledLevel> = {}): CompiledLevel {
  const terrain: string[][] = Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x) => (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? 'wall' : FLOOR_TILE_ID))
  );
  const cellEdges: CellEdge[] = [{ x: CANOPY_CELL.x, y: CANOPY_CELL.y, sides: ['E'], canopy: true }];
  return {
    id: 'wave8_review_room',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 200,
    chipsRequired: 0,
    playerStart: { ...CENTRE, dir: 'E' },
    terrain,
    items: Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null)),
    entities: [{ type: 'fireball', x: MONSTER_CELL.x, y: MONSTER_CELL.y, dir: 'E' }],
    trapLinks: [],
    cloneLinks: [],
    cellEdges,
    cc2: CC2_STUB,
    ...extra
  };
}

const ctxOf = (engine: GameEngine): EpoxyContext => (engine as unknown as { ctx: EpoxyContext }).ctx;
const worldOf = (engine: GameEngine): EpoxyWorld => ctxOf(engine).world;

function load(level: CompiledLevel): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(level);
  return engine;
}

function setDownAndLeave(engine: GameEngine): void {
  engine.getPlayer().keys[DYNAMITE_ITEM_ID] = 1;
  expect(engine.dropItem(DYNAMITE_ITEM_ID)).toBe(true);
  worldOf(engine).player.x = FAR_CELL.x;
  worldOf(engine).player.y = FAR_CELL.y;
  engine.tick();
}

function blast(engine: GameEngine): void {
  for (let i = 0; i < FUSE_TICKS + BLAST_MARGIN_TICKS; i++) engine.tick();
}

beforeEach(() => {
  loadTestConfigs();
});

describe('F1: the search key holds relative passes', () => {
  function keyAt(clockShift: number): string {
    const engine = load(room());
    const w = worldOf(engine);
    w.ccMonsterClock += clockShift;
    const pass = w.ccPassOpen ? w.ccMonsterClock : w.ccMonsterClock + 1;
    const uid = w.entities[0].uid;
    w.entities[0].stepEndedPass = pass - 1;
    w.entities[0].stepEndedCell = RECORDED_CELL;
    w.ccArrivals.push({ uid, x: 1, y: 1, due: pass + ARRIVAL_DELAY, pulse: true } as EpoxyWorld['ccArrivals'][number]);
    w.ccArrivals.push({ uid, x: 1, y: 1, due: pass + ARRIVAL_DELAY, teleport: true } as EpoxyWorld['ccArrivals'][number]);
    return cc2HiddenStateKey(w);
  }

  it('gives the same key for the same position reached at two different times', () => {
    expect(keyAt(0)).toBe(keyAt(LATER_CLOCK_SHIFT));
    expect(keyAt(0)).toContain('e');
  });

  it('leaves out a step end older than the previous pass', () => {
    const engine = load(room());
    const w = worldOf(engine);
    const fresh = cc2HiddenStateKey(w);
    w.ccMonsterClock += LATER_CLOCK_SHIFT;
    w.entities[0].stepEndedPass = 0;
    w.entities[0].stepEndedCell = RECORDED_CELL;
    expect(cc2HiddenStateKey(w)).toBe(fresh);
  });
});

describe('F2: the ghost bar edit test ignores cells outside the map', () => {
  it('is not edited at load although a listed cell lies outside the map', () => {
    const cell = BARRED_CELL.y * SIZE + BARRED_CELL.x;
    const engine = load(room({ cc2: { ...CC2_STUB, ghostBarCells: [cell, OUT_OF_BOUNDS_CELL] } as Cc2LevelData }));
    const w = worldOf(engine);
    expect((w.ghostBar as Set<number>).size).toBe(1);
    expect(ghostBarEdited(w)).toBe(false);
    (w.ghostBar as Set<number>).delete(cell);
    expect(ghostBarEdited(w)).toBe(true);
  });
});

describe('F3: dynamite under a canopy and over a barred cell', () => {
  it('removes only the canopy: the item and the thin walls of that cell survive', () => {
    const level = room({ entities: [] });
    level.items[CANOPY_CELL.y][CANOPY_CELL.x] = HELD_ITEM;
    const engine = load(level);
    const sides = (worldOf(engine).edgeMask as Uint8Array)[CANOPY_CELL.y * SIZE + CANOPY_CELL.x] & ~CELL_EDGE_CANOPY_BIT;
    expect(sides).not.toBe(0);
    setDownAndLeave(engine);
    blast(engine);
    const w = worldOf(engine);
    expect((w.edgeMask as Uint8Array)[CANOPY_CELL.y * SIZE + CANOPY_CELL.x]).toBe(sides);
    expect(w.items[CANOPY_CELL.y][CANOPY_CELL.x]).toBe(HELD_ITEM);
    expect(w.items[SAFE_CELL.y][SAFE_CELL.x]).toBeNull();
  });

  it('spares the actor under a canopy', () => {
    const engine = load(room({ entities: [{ type: 'dirt_block', x: CANOPY_CELL.x, y: CANOPY_CELL.y, dir: 'N' }] }));
    setDownAndLeave(engine);
    blast(engine);
    expect(worldOf(engine).entities.some((e) => e.x === CANOPY_CELL.x && e.y === CANOPY_CELL.y)).toBe(true);
  });

  it('does not turn a barred floor to fire under an actor and keeps it barred', () => {
    const cell = BARRED_CELL.y * SIZE + BARRED_CELL.x;
    const engine = load(room({
      entities: [{ type: 'dirt_block', x: BARRED_CELL.x, y: BARRED_CELL.y, dir: 'N' }],
      cc2: { ...CC2_STUB, ghostBarCells: [cell] } as Cc2LevelData
    }));
    setDownAndLeave(engine);
    blast(engine);
    expect(engine.getTerrain()[BARRED_CELL.y][BARRED_CELL.x]).toBe(FLOOR_TILE_ID);
    expect((worldOf(engine).ghostBar as Set<number>).has(cell)).toBe(true);
  });
});

const MIRROR_CHIP = 'mirror_chip';
const MIRROR_Y = 9;
const MIRROR_START_X = 6;
const DOOR_X = 8;
const DOOR_KEY = 'key_yellow';
const DOOR_TILE = 'door_yellow';
const WRONG_CHARACTER_FLOOR = 'sign_melinda_only';
const DECISION_GAP_TICKS = 6;
const CLONER = { x: 8, y: 3 };
const CLONE_BUTTON = { x: 3, y: ROOM_ROW };

function mirrorDoorRoom(mode: RoomMode, hidden: string | null): GameEngine {
  const level = flatRoom({
    mode,
    startX: 2,
    entities: [{ type: MIRROR_CHIP, x: MIRROR_START_X, y: MIRROR_Y, dir: 'E' }],
    terrain: { [`${DOOR_X},${MIRROR_Y}`]: DOOR_TILE },
    items: { [`${MIRROR_START_X + 1},${MIRROR_Y}`]: DOOR_KEY }
  });
  if (hidden !== null) level.underlays = [{ x: DOOR_X, y: MIRROR_Y, terrain: hidden }];
  return load(level);
}

function walkEast(engine: GameEngine, steps: number): void {
  for (let i = 0; i < steps; i++) {
    engine.attemptPlayerMove('E');
    for (let t = 0; t < DECISION_GAP_TICKS; t++) engine.tick();
  }
}

describe('F4a: a mirror does not spend a key on a door that opens onto a floor of another character', () => {
  it('keeps the key and the shut door on a CC2 level', () => {
    const engine = mirrorDoorRoom('cc2', WRONG_CHARACTER_FLOOR);
    walkEast(engine, 4);
    const mirror = engine.getEntities().find((e) => e.type === MIRROR_CHIP) as NonNullable<ReturnType<GameEngine['getEntities']>[number]>;
    expect(mirror.heldKeys).toEqual([DOOR_KEY]);
    expect(engine.getTerrain()[MIRROR_Y][DOOR_X]).toBe(DOOR_TILE);
    expect(mirror.x).toBe(DOOR_X - 1);
  });

  it('still opens a door that hides nothing for it', () => {
    const engine = mirrorDoorRoom('cc2', null);
    walkEast(engine, 4);
    const mirror = engine.getEntities().find((e) => e.type === MIRROR_CHIP) as NonNullable<ReturnType<GameEngine['getEntities']>[number]>;
    expect(mirror.x).toBeGreaterThan(DOOR_X);
    expect(mirror.heldKeys).toBeUndefined();
  });
});

describe('F4c: the mirror a cloner lets out keeps the template list ordinal', () => {
  it('hands the ordinal to the clone and leaves the template without one', () => {
    const level = flatRoom({
      mode: 'cc2',
      startX: 2,
      terrain: { [`${CLONE_BUTTON.x},${CLONE_BUTTON.y}`]: 'button_red', [`${CLONER.x},${CLONER.y}`]: 'clone_machine' },
      entities: [{ type: MIRROR_CHIP, x: CLONER.x, y: CLONER.y, dir: 'E' }]
    });
    level.cloneLinks = [{ buttonX: CLONE_BUTTON.x, buttonY: CLONE_BUTTON.y, clonerX: CLONER.x, clonerY: CLONER.y, templateType: MIRROR_CHIP, templateDir: 'E' }];
    const engine = load(level);
    const template = engine.getEntities()[0];
    const ordinal = template.listOrdinal;
    expect(ordinal).toBeDefined();
    for (let i = 0; i < 12 && engine.getEntities().length < 2; i++) {
      engine.attemptPlayerMove('E');
      engine.tick();
    }
    const entities = engine.getEntities();
    expect(entities).toHaveLength(2);
    const out = entities.find((e) => e.x !== CLONER.x || e.y !== CLONER.y) as NonNullable<(typeof entities)[number]>;
    expect(out.listOrdinal).toBe(ordinal);
    expect(entities.find((e) => e !== out)?.listOrdinal).toBeUndefined();
  });
});
