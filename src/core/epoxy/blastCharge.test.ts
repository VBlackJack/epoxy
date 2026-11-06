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

import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { ConfigRegistry } from '../../config/ConfigRegistry';
import { findChargeConfigErrors } from '../../config/ConfigValidation';
import { PACK_JSON_MAX_VERSION, PACK_JSON_VERSION_V7 } from '../../config/constants';
import { tileAvailability } from '../../editor/paletteAvailability';
import { DatCodec, datRefusalReason } from '../../formats/DatCodec';
import { decodeActions, DROP_CHARGE_ACTION, encodeActions, PieceSolver } from '../../generator/PieceSolver';
import { storedSolutionWins, timedSolution } from '../../generator/SolutionReplay';
import en from '../../locales/en.json';
import fr from '../../locales/fr.json';
import { parsePackJson, serializePack } from '../../packs/packJson';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { collectDueMoves } from '../../ui/replaySchedule';
import { BlockPuzzleSolver } from '../BlockPuzzleSolver';
import { CHARGE_BLAST_RADIUS, CHARGE_ITEM_ID } from '../coreConstants';
import { engineSimulationHash } from '../engineSimHash';
import { GameEngine } from '../GameEngine';
import { LevelValidator } from '../LevelValidator';
import { featuresFor, hasChargeContent, hasEpoxyOnlyContent, isChargeTileId, isEpoxyOnlyItemId } from '../RulesetFeatures';
import { usesV7Ids } from '../signalLinks';
import type { CompiledLevel, Direction, EntityPlacement, LitCharge, TileDefinition } from '../types';
import type { EpoxyContext } from './epoxyWorld';

const CHARGE = CHARGE_ITEM_ID;
const LIT = 'charge_lit';
const SIZE = 13;
const TIME_LIMIT_SECONDS = 200;
const PLAYER_START = { x: 2, y: 5 };
const MAX_WAIT_TICKS = 40;
/** A cooldown that keeps a monster where it stands for the length of a test. */
const FROZEN_TICKS = 100000;
const SCRIPT_REPEATS = 2;
const SLOW_TIME_ID = 'slow_time';
const KEY_THIEF_ID = 'thief_keys';
const WALKER = 'walker';
/** A monster that keeps its heading until something stops it. */
const STRAIGHT_MONSTER = 'pink_ball';
/** Ticks a straight monster needs to cross a few cells. */
const MONSTER_WALK_TICKS = 25;
const BLOCK_ID = 'dirt_block';
const BEND_COLUMN = 5;
/** Waits (one player cooldown each) that outlast the fuse once the player has backed off. */
const WAITS_PAST_FUSE = 16;
/** Cell the tests move the player to, far from any blast. */
const FAR_CELL = { x: 10, y: 10 };

interface Setup {
  terrain?: Array<[number, number, string]>;
  items?: Array<[number, number, string]>;
  entities?: EntityPlacement[];
  player?: { x: number; y: number };
}

function room(setup: Setup = {}): CompiledLevel {
  const terrain: string[][] = Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x) => (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? 'wall' : 'floor'))
  );
  for (const [x, y, id] of setup.terrain ?? []) terrain[y][x] = id;
  const items: Array<Array<string | null>> = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null));
  for (const [x, y, id] of setup.items ?? []) items[y][x] = id;
  return {
    id: 'blast_charge_room',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: TIME_LIMIT_SECONDS,
    chipsRequired: 0,
    playerStart: { ...(setup.player ?? PLAYER_START), dir: 'E' },
    terrain,
    items,
    entities: setup.entities ?? [],
    trapLinks: [],
    cloneLinks: []
  };
}

/**
 * A corridor along row 5 that bends south at column 5, with a block at the bend that no push can move: the way to
 * the exit is shut until a blast clears the block. The charge lies one cell east of the start.
 */
function corridor(solution?: string): CompiledLevel {
  const terrain: string[][] = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => 'wall'));
  for (let x = 1; x <= BEND_COLUMN; x++) terrain[5][x] = 'floor';
  terrain[6][BEND_COLUMN] = 'floor';
  terrain[7][BEND_COLUMN] = 'exit';
  const items: Array<Array<string | null>> = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null));
  items[5][3] = CHARGE;
  return {
    id: 'blast_charge_corridor',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: TIME_LIMIT_SECONDS,
    chipsRequired: 0,
    playerStart: { ...PLAYER_START, dir: 'E' },
    terrain,
    items,
    entities: [{ type: BLOCK_ID, x: BEND_COLUMN, y: 5, dir: 'S' }],
    trapLinks: [],
    cloneLinks: [],
    ...(solution === undefined ? {} : { solution })
  };
}

/** Walk east over the charge, drop it beside the block, back off two cells, wait out the fuse, then go through. */
const CORRIDOR_SOLUTION = `EEXWW${'.'.repeat(WAITS_PAST_FUSE)}EEESS`;

function load(level: CompiledLevel): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(level);
  return engine;
}

function contextOf(engine: GameEngine): EpoxyContext {
  return (engine as unknown as { ctx: EpoxyContext }).ctx;
}

function step(engine: GameEngine, dir: Direction): boolean {
  for (let waited = 0; waited <= MAX_WAIT_TICKS; waited++) {
    if (engine.getPlayer().moveCooldown === 0) return engine.attemptPlayerMove(dir);
    engine.tick();
  }
  throw new Error('the player never became able to move');
}

function holdCharges(engine: GameEngine, count: number): void {
  engine.getPlayer().keys[CHARGE] = count;
}

function freeze(engine: GameEngine): void {
  contextOf(engine).world.entities.forEach((e) => (e.cooldownTicks = FROZEN_TICKS));
}

function tickN(engine: GameEngine, count: number): void {
  for (let i = 0; i < count; i++) engine.tick();
}

function moveAway(engine: GameEngine): void {
  contextOf(engine).world.player.x = FAR_CELL.x;
  contextOf(engine).world.player.y = FAR_CELL.y;
}

function fuseTicks(): number {
  return ConfigRegistry.getGame().timing.chargeFuseTicks;
}

function litOf(engine: GameEngine): readonly LitCharge[] {
  return engine.getLitCharges() ?? [];
}

beforeEach(() => {
  loadTestConfigs();
});

describe('blast charge: configuration', () => {
  it('is a collectible that drops as a lit item, named in both languages, with a configured fuse', () => {
    const charge = ConfigRegistry.getTile(CHARGE);
    expect(charge.collectible).toBe('charge');
    expect(charge.layer).toBe('item');
    expect(charge.dropsAs).toBe(LIT);
    const lit = ConfigRegistry.getTile(LIT);
    expect(lit.litCharge).toBe(true);
    expect(lit.collectible).toBeUndefined();
    expect(fuseTicks()).toBe(60);
    expect(CHARGE_BLAST_RADIUS).toBe(1);
    for (const locale of [en, fr] as unknown as Array<{ tiles: Record<string, { name: string; desc: { label: string } }> }>) {
      for (const id of [CHARGE, LIT]) {
        expect(locale.tiles[id].name).toBeTruthy();
        expect(locale.tiles[id].desc.label).toBeTruthy();
      }
    }
    expect([en.tiles.charge.name, en.tiles.charge_lit.name]).toEqual(['Blast Charge', 'Lit Charge']);
    expect([fr.tiles.charge.name, fr.tiles.charge_lit.name]).toEqual(['Charge Explosive', 'Charge Allumée']);
  });

  it('has the death message and the touch button label in both languages', () => {
    for (const locale of [en, fr] as unknown as Array<{
      hud: { messages: Record<string, { label: string }>; touch_overlay: Record<string, { action?: string }> };
    }>) {
      expect(locale.hud.messages.death_blast.label).toBeTruthy();
      expect(locale.hud.touch_overlay.charge.action).toBeTruthy();
    }
  });

  it('reports a charge that names no lit form, a lit charge that can be collected, and a stray dropsAs', () => {
    const tiles = ConfigRegistry.getTiles().tiles as Record<string, TileDefinition>;
    expect(findChargeConfigErrors(tiles)).toEqual([]);
    expect(findChargeConfigErrors({ ...tiles, [CHARGE]: { ...tiles[CHARGE], dropsAs: 'chip' } })).toHaveLength(1);
    expect(findChargeConfigErrors({ ...tiles, [CHARGE]: { ...tiles[CHARGE], dropsAs: undefined } })).toHaveLength(1);
    expect(findChargeConfigErrors({ ...tiles, [LIT]: { ...tiles[LIT], collectible: 'key' } })).toHaveLength(1);
    expect(findChargeConfigErrors({ ...tiles, chip: { ...tiles.chip, dropsAs: LIT } })).toHaveLength(1);
  });

  it('puts a phone strip button between undo and menu, labelled by a key both languages define', () => {
    const page = readFileSync('index.html', 'utf8');
    const button = /<button id="touch-btn-charge"[^>]*>/.exec(page)?.[0] ?? '';
    expect(button).toContain('data-i18n-aria-label="hud.touch_overlay.charge.action"');
    expect(button).toContain('data-i18n-title="hud.touch_overlay.charge.action"');
    expect(page.indexOf('touch-btn-charge')).toBeGreaterThan(page.indexOf('touch-btn-undo'));
    expect(page.indexOf('touch-btn-charge')).toBeLessThan(page.indexOf('touch-btn-menu'));
  });
});

describe('blast charge: pickup and drop', () => {
  it('is picked up into the inventory as a count and shown among the held items', () => {
    const engine = load(
      room({
        items: [
          [3, 5, CHARGE],
          [4, 5, CHARGE]
        ]
      })
    );
    expect(engine.getHeldItems()).not.toContain(CHARGE);
    step(engine, 'E');
    expect(engine.getItems()[5][3]).toBeNull();
    expect(engine.getPlayer().keys[CHARGE]).toBe(1);
    expect(engine.holdsItem(CHARGE)).toBe(true);
    expect(engine.getHeldItems()).toContain(CHARGE);
    step(engine, 'E');
    expect(engine.getPlayer().keys[CHARGE]).toBe(2);
  });

  it('is left in the pocket by a key thief, which still empties the keys', () => {
    const engine = load(room({ terrain: [[3, 5, KEY_THIEF_ID]] }));
    holdCharges(engine, 2);
    engine.getPlayer().keys.key_red = 1;
    step(engine, 'E');
    expect(engine.getPlayer().keys).toEqual({ [CHARGE]: 2 });
    expect(engine.getStatusBannerKey()).toBe('hud.messages.thief_stole_keys');
  });

  it('does not trigger the thief message when only charges are held', () => {
    const engine = load(room({ terrain: [[3, 5, KEY_THIEF_ID]] }));
    holdCharges(engine, 1);
    step(engine, 'E');
    expect(engine.getPlayer().keys).toEqual({ [CHARGE]: 1 });
    expect(engine.getStatusBannerKey()).toBeNull();
  });

  it('drops one charge lit on the player cell, which holds a lit item until it blasts', () => {
    const engine = load(room());
    holdCharges(engine, 2);
    expect(engine.dropItem(CHARGE)).toBe(true);
    expect(engine.getPlayer().keys[CHARGE]).toBe(1);
    expect(engine.getItems()[5][2]).toBe(LIT);
    expect(engine.getLitCharges()).toEqual([{ x: 2, y: 5, detonateTick: engine.getTick() + fuseTicks() }]);
    expect(engine.getTimedMoveHistory().at(-1)).toMatchObject({ drop: CHARGE });
    // The last one: the entry leaves the inventory.
    step(engine, 'E');
    expect(engine.dropItem(CHARGE)).toBe(true);
    expect(engine.getPlayer().keys[CHARGE]).toBeUndefined();
    expect(engine.holdsItem(CHARGE)).toBe(false);
  });

  it('refuses a drop with nothing held, on a cell that holds an item, and on a lit charge', () => {
    const engine = load(room({ items: [[2, 5, 'chip']] }));
    expect(engine.dropItem(CHARGE)).toBe(false);
    expect(engine.getStatusBannerKey()).toBe('hud.messages.drop_nothing');
    holdCharges(engine, 1);
    expect(engine.dropItem(CHARGE)).toBe(false);
    expect(engine.getStatusBannerKey()).toBe('hud.messages.drop_cell_occupied');
    expect(engine.getLitCharges()).toBeUndefined();
    expect(engine.getPlayer().keys[CHARGE]).toBe(1);
    const other = load(room());
    holdCharges(other, 2);
    expect(other.dropItem(CHARGE)).toBe(true);
    expect(other.dropItem(CHARGE)).toBe(false);
    expect(litOf(other)).toHaveLength(1);
  });

  it('cannot drop a lit charge by its own id, and cannot pick one up', () => {
    const engine = load(room({ items: [[3, 5, LIT]] }));
    expect(engine.dropItem(LIT)).toBe(false);
    step(engine, 'E');
    expect(engine.getItems()[5][3]).toBe(LIT);
    expect(engine.getPlayer().keys).toEqual({});
    expect(engine.getHeldItems()).toEqual([]);
  });
});

describe('blast charge: the fuse', () => {
  it('blasts on the tick the configured fuse ends, and not one tick before', () => {
    const engine = load(room({ entities: [{ type: WALKER, x: 3, y: 5, dir: 'E' }] }));
    freeze(engine);
    holdCharges(engine, 1);
    const droppedAt = engine.getTick();
    expect(engine.dropItem(CHARGE)).toBe(true);
    expect(litOf(engine)[0].detonateTick).toBe(droppedAt + fuseTicks());
    moveAway(engine);
    tickN(engine, fuseTicks() - 1);
    expect(engine.getEntities()).toHaveLength(1);
    expect(litOf(engine)).toHaveLength(1);
    engine.tick();
    expect(engine.getEntities()).toHaveLength(0);
    expect(engine.getLitCharges()).toBeUndefined();
    expect(engine.getItems()[5][2]).toBeNull();
  });

  it('is not stretched by the slow-time boots that stretch the monsters', () => {
    const engine = load(room());
    engine.getPlayer().boots.add(SLOW_TIME_ID);
    holdCharges(engine, 1);
    const droppedAt = engine.getTick();
    engine.dropItem(CHARGE);
    expect(litOf(engine)[0].detonateTick).toBe(droppedAt + fuseTicks());
    moveAway(engine);
    let ticks = 0;
    while (engine.getLitCharges() !== undefined && ticks < fuseTicks() * 3) {
      engine.tick();
      ticks++;
    }
    expect(ticks).toBe(fuseTicks());
  });

  it('is held by a pause and resumes where it stopped', () => {
    const engine = load(room());
    holdCharges(engine, 1);
    engine.dropItem(CHARGE);
    moveAway(engine);
    engine.setPaused(true);
    tickN(engine, fuseTicks() * 2);
    expect(litOf(engine)).toHaveLength(1);
    engine.setPaused(false);
    tickN(engine, fuseTicks());
    expect(engine.getLitCharges()).toBeUndefined();
  });
});

describe('blast charge: what a blast destroys', () => {
  const centre = { x: 6, y: 6 };
  const around: Array<[number, number]> = [
    [-1, -1],
    [0, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [0, 1],
    [1, 1]
  ];

  it('destroys the monsters and the blocks within one cell, and only those', () => {
    const inside: EntityPlacement[] = around.map(([dx, dy], i) => ({
      type: i % 2 === 0 ? WALKER : BLOCK_ID,
      x: centre.x + dx,
      y: centre.y + dy,
      dir: 'E'
    }));
    const outside: EntityPlacement[] = [
      { type: WALKER, x: centre.x + 2, y: centre.y, dir: 'E' },
      { type: BLOCK_ID, x: centre.x, y: centre.y - 2, dir: 'E' },
      { type: BLOCK_ID, x: centre.x - 2, y: centre.y - 2, dir: 'E' }
    ];
    const engine = load(room({ player: centre, entities: [...inside, ...outside] }));
    freeze(engine);
    holdCharges(engine, 1);
    engine.dropItem(CHARGE);
    moveAway(engine);
    tickN(engine, fuseTicks());
    expect(engine.getEntities().map((e) => `${e.x},${e.y}`).sort()).toEqual(outside.map((e) => `${e.x},${e.y}`).sort());
    expect(engine.getPlayer().alive).toBe(true);
  });

  it('leaves the terrain, the items, the bombs and the other lit charges alone', () => {
    const { x, y } = centre;
    const engine = load(
      room({
        player: centre,
        terrain: [
          [x + 1, y, 'wall'],
          [x, y + 1, 'water'],
          [x - 1, y, 'dirt']
        ],
        items: [
          [x - 1, y - 1, 'chip'],
          [x + 1, y - 1, 'bomb'],
          [x + 1, y + 1, 'key_red']
        ]
      })
    );
    holdCharges(engine, 1);
    const terrainBefore = engine.getTerrain().map((row) => [...row]);
    engine.dropItem(CHARGE);
    // A second charge lit inside the blast, with a later fuse.
    const world = contextOf(engine).world;
    world.items[y - 1][x] = LIT;
    world.litCharges.push({ x, y: y - 1, detonateTick: engine.getTick() + fuseTicks() * 2 });
    moveAway(engine);
    tickN(engine, fuseTicks());
    expect(engine.getTerrain()).toEqual(terrainBefore);
    expect(engine.getItems()[y - 1][x - 1]).toBe('chip');
    expect(engine.getItems()[y - 1][x + 1]).toBe('bomb');
    expect(engine.getItems()[y + 1][x + 1]).toBe('key_red');
    expect(engine.getItems()[y][x]).toBeNull();
    expect(engine.getItems()[y - 1][x]).toBe(LIT);
    expect(litOf(engine)).toHaveLength(1);
    expect(litOf(engine)[0]).toMatchObject({ x, y: y - 1 });
  });

  it('spares the template mob sitting on a clone machine', () => {
    const engine = load(
      room({
        player: centre,
        terrain: [[centre.x + 1, centre.y, 'clone_machine']],
        entities: [{ type: WALKER, x: centre.x + 1, y: centre.y, dir: 'E' }]
      })
    );
    freeze(engine);
    holdCharges(engine, 1);
    engine.dropItem(CHARGE);
    moveAway(engine);
    tickN(engine, fuseTicks());
    expect(engine.getEntities()).toHaveLength(1);
  });

  it('kills the player within one cell, with the blast message, diagonals included', () => {
    for (const [dx, dy] of [
      [0, 0],
      [1, 0],
      [-1, 1],
      [1, 1]
    ]) {
      const engine = load(room({ player: centre }));
      holdCharges(engine, 1);
      engine.dropItem(CHARGE);
      contextOf(engine).world.player.x = centre.x + dx;
      contextOf(engine).world.player.y = centre.y + dy;
      tickN(engine, fuseTicks());
      expect(engine.getPlayer().alive, `${dx},${dy}`).toBe(false);
      expect(engine.getPlayer().deathReasonKey).toBe('hud.messages.death_blast');
    }
  });

  it('does not blast on the tick the player reaches the exit, so a won level never holds a dead player', () => {
    const engine = load(room({ player: { x: 6, y: 6 }, terrain: [[7, 6, 'exit']] }));
    holdCharges(engine, 1);
    engine.dropItem(CHARGE);
    tickN(engine, fuseTicks() - 1);
    expect(step(engine, 'E')).toBe(true);
    expect(engine.isLevelCompleted()).toBe(true);
    tickN(engine, 5);
    expect(engine.getPlayer().alive).toBe(true);
    expect(engine.isLevelCompleted()).toBe(true);
  });

  it('spares the player two cells away', () => {
    const engine = load(room({ player: centre }));
    holdCharges(engine, 1);
    engine.dropItem(CHARGE);
    contextOf(engine).world.player.x = centre.x + 2;
    tickN(engine, fuseTicks() + 5);
    expect(engine.getPlayer().alive).toBe(true);
  });

  it('does not protect a player who wears a ward', () => {
    const engine = load(room({ player: centre }));
    engine.getPlayer().boots.add('ward');
    holdCharges(engine, 1);
    engine.dropItem(CHARGE);
    tickN(engine, fuseTicks());
    expect(engine.getPlayer().alive).toBe(false);
  });
});

describe('blast charge: a lit charge blocks nothing', () => {
  it('lets the player walk over it without picking it up or setting it off early', () => {
    const engine = load(room({ player: { x: 6, y: 6 } }));
    holdCharges(engine, 1);
    step(engine, 'E');
    engine.dropItem(CHARGE);
    step(engine, 'E');
    step(engine, 'W');
    expect(engine.getPlayer()).toMatchObject({ x: 7, y: 6 });
    expect(engine.getItems()[6][7]).toBe(LIT);
    expect(litOf(engine)).toHaveLength(1);
    expect(engine.getPlayer().keys[CHARGE]).toBeUndefined();
  });

  it('lets a monster walk onto its cell', () => {
    const engine = load(room({ player: FAR_CELL, entities: [{ type: STRAIGHT_MONSTER, x: 9, y: 6, dir: 'W' }] }));
    const world = contextOf(engine).world;
    world.items[6][7] = LIT;
    world.litCharges.push({ x: 7, y: 6, detonateTick: fuseTicks() * 10 });
    const seen = new Set<number>();
    for (let tick = 0; tick < MONSTER_WALK_TICKS; tick++) {
      engine.tick();
      engine.getEntities().forEach((e) => seen.add(e.x));
    }
    expect(seen.has(7)).toBe(true);
    expect(engine.getEntities()).toHaveLength(1);
  });
});

describe('blast charge: undo and replay', () => {
  it('puts the charge back in the pocket when the drop is undone', () => {
    const engine = load(room());
    holdCharges(engine, 1);
    engine.dropItem(CHARGE);
    expect(engine.undo()).toBe(true);
    expect(engine.getItems()[5][2]).toBeNull();
    expect(engine.getLitCharges()).toBeUndefined();
    expect(engine.getPlayer().keys[CHARGE]).toBe(1);
    expect(engine.getTimedMoveHistory()).toEqual([]);
  });

  it('keeps the fuse across an undo made mid-fuse, and blasts at the same absolute tick', () => {
    const engine = load(room({ entities: [{ type: WALKER, x: 3, y: 5, dir: 'E' }] }));
    freeze(engine);
    holdCharges(engine, 1);
    engine.dropItem(CHARGE);
    const blastTick = litOf(engine)[0].detonateTick;
    tickN(engine, 30);
    step(engine, 'N');
    tickN(engine, 10);
    expect(engine.undo()).toBe(true);
    expect(engine.getTick()).toBe(30);
    expect(engine.getLitCharges()).toEqual([{ x: 2, y: 5, detonateTick: blastTick }]);
    expect(engine.getItems()[5][2]).toBe(LIT);
    // The player is back beside the charge: stand clear, then wait for the original tick.
    moveAway(engine);
    tickN(engine, blastTick - engine.getTick() - 1);
    expect(engine.getEntities()).toHaveLength(1);
    engine.tick();
    expect(engine.getEntities()).toHaveLength(0);
  });

  it('brings a blasted charge back when an undo reaches back past the blast', () => {
    const engine = load(room({ player: { x: 8, y: 8 } }));
    holdCharges(engine, 1);
    engine.dropItem(CHARGE);
    const blastTick = litOf(engine)[0].detonateTick;
    step(engine, 'E');
    step(engine, 'E');
    tickN(engine, fuseTicks());
    expect(engine.getLitCharges()).toBeUndefined();
    expect(engine.getItems()[8][8]).toBeNull();
    // The last move is undone: the board is back before the blast, the charge lit with its original fuse.
    expect(engine.undo()).toBe(true);
    expect(engine.getLitCharges()).toEqual([{ x: 8, y: 8, detonateTick: blastTick }]);
    expect(engine.getItems()[8][8]).toBe(LIT);
    expect(engine.getPlayer().alive).toBe(true);
  });

  it('replays to the same simulation hash, and a level without a charge keeps no trace of one', () => {
    const level = room({ items: [[3, 5, CHARGE]], entities: [{ type: WALKER, x: 9, y: 5, dir: 'W' }] });
    const hashes = Array.from({ length: SCRIPT_REPEATS }, () => engineSimulationHash(level, 'scripted'));
    expect(new Set(hashes).size).toBe(1);
    const plain = load(room());
    expect(plain.getLitCharges()).toBeUndefined();
    expect(plain.getRuntimeKeyExtra()).toBe('');
  });

  it('tells search states apart by the fuse left', () => {
    const engine = load(room());
    holdCharges(engine, 1);
    engine.dropItem(CHARGE);
    moveAway(engine);
    const early = engine.getRuntimeKeyExtra();
    tickN(engine, 5);
    expect(early).not.toBe('');
    expect(engine.getRuntimeKeyExtra()).not.toBe(early);
  });
});

describe('blast charge: solutions with the X action', () => {
  it('reads and writes X as dropping a charge', () => {
    expect(decodeActions('EX.W')).toEqual(['E', DROP_CHARGE_ACTION, 'WAIT', 'W']);
    expect(encodeActions(['E', DROP_CHARGE_ACTION, 'WAIT', 'W'])).toBe('EX.W');
    expect(encodeActions(decodeActions(CORRIDOR_SOLUTION))).toBe(CORRIDOR_SOLUTION);
  });

  it('cannot be won without the charge: the block shuts the corridor', () => {
    const engine = load(corridor());
    for (const dir of ['E', 'E', 'E', 'E', 'S', 'S'] as Direction[]) PieceSolver.play(engine, dir);
    expect(engine.isLevelCompleted()).toBe(false);
  });

  it('replays a stored solution that uses X to a win, in the solver, the timed replay and the game loop', () => {
    const level = corridor(CORRIDOR_SOLUTION);
    const engine = load(level);
    for (const action of decodeActions(CORRIDOR_SOLUTION)) expect(PieceSolver.play(engine, action)).toBe(true);
    expect(engine.isLevelCompleted()).toBe(true);
    expect(storedSolutionWins(level)).toBe(true);

    const moves = timedSolution(level) ?? [];
    expect(moves.length).toBeGreaterThan(0);
    const drops = moves.filter((m) => m.drop !== undefined);
    expect(drops).toHaveLength(1);
    expect(drops[0].drop).toBe(CHARGE);

    // The same list, applied the way the replay loop of the page applies it.
    const replay = load(level);
    let index = 0;
    for (let i = 0; i < 5000 && !replay.isLevelCompleted(); i++) {
      const { due, nextIndex } = collectDueMoves(moves, index, replay.getTick());
      for (const move of due) {
        if (move.drop !== undefined) replay.dropItem(move.drop);
        else replay.attemptPlayerMove(move.dir);
      }
      index = nextIndex;
      replay.tick();
      expect(replay.getPlayer().alive).toBe(true);
    }
    expect(replay.isLevelCompleted()).toBe(true);
  });

  it('gives the same simulation hash twice for a level whose solution drops a charge', () => {
    const level = corridor(CORRIDOR_SOLUTION);
    const hashes = Array.from({ length: SCRIPT_REPEATS }, () => engineSimulationHash(level, 'solution'));
    expect(new Set(hashes).size).toBe(1);
  });

  it('rejects a stored solution whose drop cannot happen, so a stale list is never shown', () => {
    expect(timedSolution(corridor('XEE'))).toBeNull();
    expect(storedSolutionWins(corridor('EEEXEEESS'))).toBe(false);
  });

  it('is judged without a false verdict: the validator still sees the exit as reachable', () => {
    const report = LevelValidator.validate(corridor(CORRIDOR_SOLUTION));
    const keys = report.issues.map((issue) => issue.i18nKey);
    expect(keys.some((key) => key.startsWith('validator.issues.unreachable_exit'))).toBe(false);
    expect(report.stats.reachableExit).toBe(true);
  });
});

describe('blast charge: play aids and block searches', () => {
  it('turns off the push hint and the dead-end watch on a level with a charge, and keeps the other aids', () => {
    const plain = featuresFor(room());
    expect(plain.blockHint).toBe(true);
    expect(plain.deadEndWatch).toBe(true);
    for (const level of [room({ items: [[3, 3, CHARGE]] }), room({ items: [[3, 3, LIT]] })]) {
      const features = featuresFor(level);
      expect(features.blockHint).toBe(false);
      expect(features.deadEndWatch).toBe(false);
      expect(features.itemDrop).toBe(true);
      expect(features.solutionReplay).toBe(true);
      expect(features.objectiveMarker).toBe(true);
    }
  });

  it('gives no verdict on a targets level that holds a charge', () => {
    const level = room({ terrain: [[4, 4, 'block_target']], entities: [{ type: BLOCK_ID, x: 6, y: 6, dir: 'S' }] });
    level.winRule = 'targets';
    const withCharge = { ...level, items: level.items.map((row) => [...row]) };
    withCharge.items[2][2] = CHARGE;
    expect(BlockPuzzleSolver.verdict(load(withCharge)).kind).toBe('not_checked');
  });
});

describe('blast charge: rulesets and formats', () => {
  it('is Epoxy-only content, refused in the Lynx palette and by the .DAT export', () => {
    expect(isChargeTileId(CHARGE)).toBe(true);
    expect(isChargeTileId(LIT)).toBe(true);
    expect(isChargeTileId('chip')).toBe(false);
    expect(isEpoxyOnlyItemId(CHARGE)).toBe(true);
    expect(hasChargeContent(room())).toBe(false);
    expect(hasChargeContent(room({ items: [[3, 3, CHARGE]] }))).toBe(true);
    expect(hasEpoxyOnlyContent(room({ items: [[3, 3, CHARGE]] }))).toBe(true);
    for (const id of [CHARGE, LIT]) {
      expect(tileAvailability('lynx', id).available).toBe(false);
      expect(tileAvailability('epoxy', id).available).toBe(true);
    }
    const placed = room({ items: [[3, 3, CHARGE]] });
    expect(datRefusalReason(placed)).toBe('epoxy_only_items');
    const encoded = DatCodec.encodeLevelsWithReport([placed, room()]);
    expect(encoded.refused.map((r) => r.reason)).toEqual(['epoxy_only_items']);
    expect(encoded.levelCount).toBe(1);
  });

  it('round-trips through a pack file written as format 7', () => {
    expect(PACK_JSON_MAX_VERSION).toBe(PACK_JSON_VERSION_V7);
    const level = corridor(CORRIDOR_SOLUTION);
    expect(usesV7Ids(level)).toBe(true);
    const text = serializePack('Blast', [level]);
    expect(JSON.parse(text).version).toBe(PACK_JSON_VERSION_V7);
    const result = parsePackJson(text, ConfigRegistry.getLevelSizeBounds(), new Set<string>(), () => 7000);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.levels[0].items[5][3]).toBe(CHARGE);
    expect(result.levels[0].solution).toBe(CORRIDOR_SOLUTION);
    expect(storedSolutionWins(result.levels[0])).toBe(true);
  });
});
