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
import { findChargeConfigErrors } from '../../config/ConfigValidation';
import { PACK_JSON_VERSION_V13, PACK_JSON_VERSION_V13_IDS } from '../../config/constants';
import { ITEM_MAP } from '../../formats/cc2Mapping';
import en from '../../locales/en.json';
import fr from '../../locales/fr.json';
import { parsePackJson, serializePack } from '../../packs/packJson';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { classifyCc2Level } from '../cc2/cc2Coverage';
import { CHARGE_DEATH_REASON_KEY, DYNAMITE_ITEM_ID, DYNAMITE_LIT_ITEM_ID, FLOOR_TILE_ID } from '../coreConstants';
import { GameEngine } from '../GameEngine';
import { LevelValidator } from '../LevelValidator';
import { isChargeTileId, isEpoxyOnlyItemId } from '../RulesetFeatures';
import type { CompiledLevel, Direction, EntityPlacement, SignalLink } from '../types';
import { inDynamiteBlast } from './epoxyDynamite';
import type { EpoxyContext } from './epoxyWorld';

const DYNAMITE = DYNAMITE_ITEM_ID;
const LIT = DYNAMITE_LIT_ITEM_ID;
const SIZE = 15;
const TIME_LIMIT_SECONDS = 200;
const CENTRE = { x: 7, y: 7 };
/** Cell the tests move the player to once the dynamite is set down: far from any blast. */
const FAR_CELL = { x: 13, y: 13 };
const MAX_WAIT_TICKS = 40;
const FROZEN_TICKS = 100000;
const FUSE_TICKS = 85;
const WALL = 'wall';
const BLOCK = 'dirt_block';
const ICE_BLOCK = 'ice_block';
const WALKER = 'walker';
const CC2_CODE_DYNAMITE = 0x51;
/** Cells of the 7 by 7 square around the centre, to tell what the blast reached from what it spared. */
const SCAN_RADIUS = 3;

interface Setup {
  /** Terrain at every cell inside the border, when it is not floor. */
  fill?: string;
  terrain?: Array<[number, number, string]>;
  items?: Array<[number, number, string]>;
  entities?: EntityPlacement[];
  signalLinks?: SignalLink[];
}

function room(setup: Setup = {}): CompiledLevel {
  const terrain: string[][] = Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x) => (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? WALL : (setup.fill ?? FLOOR_TILE_ID)))
  );
  terrain[CENTRE.y][CENTRE.x] = FLOOR_TILE_ID;
  terrain[FAR_CELL.y][FAR_CELL.x] = FLOOR_TILE_ID;
  for (const [x, y, id] of setup.terrain ?? []) terrain[y][x] = id;
  const items: Array<Array<string | null>> = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null));
  for (const [x, y, id] of setup.items ?? []) items[y][x] = id;
  return {
    id: 'dynamite_room',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: TIME_LIMIT_SECONDS,
    chipsRequired: 0,
    playerStart: { ...CENTRE, dir: 'E' },
    terrain,
    items,
    entities: setup.entities ?? [],
    trapLinks: [],
    cloneLinks: [],
    ...(setup.signalLinks === undefined ? {} : { signalLinks: setup.signalLinks })
  };
}

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

function tickN(engine: GameEngine, count: number): void {
  for (let i = 0; i < count; i++) engine.tick();
}

function freeze(engine: GameEngine): void {
  contextOf(engine).world.entities.forEach((e) => (e.cooldownTicks = FROZEN_TICKS));
}

function moveAway(engine: GameEngine): void {
  contextOf(engine).world.player.x = FAR_CELL.x;
  contextOf(engine).world.player.y = FAR_CELL.y;
}

/** Holds one dynamite, sets it down on the start cell and walks the player off, so it is lit. */
function setDownAndLeave(engine: GameEngine): void {
  engine.getPlayer().keys[DYNAMITE] = 1;
  expect(engine.dropItem(DYNAMITE)).toBe(true);
  moveAway(engine);
  engine.tick();
}

/** Runs the fuse out: ticks until the lit charge is gone, at most a bit over the fuse. */
function blastNow(engine: GameEngine): void {
  tickN(engine, FUSE_TICKS + 2);
}

function terrainAt(engine: GameEngine, dx: number, dy: number): string {
  return engine.getTerrain()[CENTRE.y + dy][CENTRE.x + dx];
}

/** Every offset inside the scan square, with the centre first out of the way. */
function scanOffsets(): Array<[number, number]> {
  const offsets: Array<[number, number]> = [];
  for (let dy = -SCAN_RADIUS; dy <= SCAN_RADIUS; dy++) {
    for (let dx = -SCAN_RADIUS; dx <= SCAN_RADIUS; dx++) offsets.push([dx, dy]);
  }
  return offsets;
}

beforeEach(() => {
  loadTestConfigs();
});

describe('dynamite: configuration', () => {
  it('is a counted charge item that drops as a lit item, named in both languages', () => {
    const item = ConfigRegistry.getTile(DYNAMITE);
    expect(item.collectible).toBe('charge');
    expect(item.dropsAs).toBe(LIT);
    expect(item.cc2Dynamite).toBe(true);
    const lit = ConfigRegistry.getTile(LIT);
    expect(lit.litCharge).toBe(true);
    expect(lit.cc2Dynamite).toBe(true);
    expect(findChargeConfigErrors(ConfigRegistry.getTiles().tiles)).toEqual([]);
    expect(ConfigRegistry.getGame().timing.dynamiteFuseTicks).toBe(FUSE_TICKS);
    for (const locale of [en, fr] as unknown as Array<{ tiles: Record<string, { name: string; desc: { label: string } }> }>) {
      for (const id of [DYNAMITE, LIT]) {
        expect(locale.tiles[id].name, id).toBeTruthy();
        expect(locale.tiles[id].desc.label, id).toBeTruthy();
      }
    }
  });

  it('is an Epoxy-only charge, a pack format 13 id, and sits at the end of the tile table', () => {
    for (const id of [DYNAMITE, LIT]) {
      expect(isChargeTileId(id), id).toBe(true);
      expect(PACK_JSON_VERSION_V13_IDS.has(id), id).toBe(true);
    }
    expect(isEpoxyOnlyItemId(DYNAMITE)).toBe(true);
    const ids = Object.keys(ConfigRegistry.getTiles().tiles);
    // The CC3D tiles (fish gate and the two teleporters of the CC3D exit orders) were appended after them.
    expect(ids.slice(-6)).toEqual([DYNAMITE, LIT, 'no_sign_dynamite', 'fish_gate', 'teleport_forward', 'teleport_turning']);
  });

  it('spares exactly the blast-proof wall, the socket and the logic gates among the terrain', () => {
    const spared = Object.values(ConfigRegistry.getTiles().tiles)
      .filter((tile) => tile.layer === 'terrain' && (tile.blastProof === true || tile.survivesDynamite === true))
      .map((tile) => tile.id);
    expect(spared).toEqual(expect.arrayContaining(['steel_wall', 'socket', 'signal_gate_and', 'signal_gate_dlatch', 'signal_counter_0', 'signal_counter_9']));
    expect(spared).not.toContain('wall');
    expect(spared).not.toContain('exit');
  });

  it('writes a level holding dynamite as pack format 13 and reads it back', () => {
    const level = room({ items: [[3, 3, DYNAMITE]] });
    const text = serializePack('Dynamite', [level]);
    expect((JSON.parse(text) as { version: number }).version).toBe(PACK_JSON_VERSION_V13);
    const read = parsePackJson(text, ConfigRegistry.getLevelSizeBounds(), new Set<string>(), () => 0);
    expect(read.ok).toBe(true);
    expect((JSON.parse(serializePack('Plain', [room()])) as { version: number }).version).toBeLessThan(PACK_JSON_VERSION_V13);
  });
});

describe('dynamite: Chip\'s Challenge 2 mapping', () => {
  it('maps the CC2 dynamite code to the dynamite item, approximated for the reasons coverage names', () => {
    const mapping = ITEM_MAP.get(CC2_CODE_DYNAMITE);
    expect(mapping?.id).toBe(DYNAMITE);
    expect(mapping?.key).toBe('dynamite');
    const coverage = classifyCc2Level(['dynamite']);
    expect(coverage.verdict).toBe('approx');
    expect(coverage.approx).toEqual(['dynamite']);
  });
});

describe('dynamite: setting down and lighting', () => {
  it('stays unlit under the player and does not burn while the player stays on the cell', () => {
    const engine = load(room());
    engine.getPlayer().keys[DYNAMITE] = 1;
    expect(engine.dropItem(DYNAMITE)).toBe(true);
    expect(engine.getItems()[CENTRE.y][CENTRE.x]).toBe(DYNAMITE);
    expect(engine.getPlayer().keys[DYNAMITE]).toBeUndefined();
    tickN(engine, FUSE_TICKS * 3);
    expect(engine.getItems()[CENTRE.y][CENTRE.x]).toBe(DYNAMITE);
    expect(engine.getLitCharges()).toEqual([expect.objectContaining({ x: CENTRE.x, y: CENTRE.y, dynamite: true, awaitingDeparture: true })]);
    expect(engine.getPlayer().alive).toBe(true);
  });

  it('lights when the player steps off, with a fuse of 85 ticks', () => {
    const engine = load(room());
    engine.getPlayer().keys[DYNAMITE] = 1;
    engine.dropItem(DYNAMITE);
    expect(step(engine, 'E')).toBe(true);
    const litAt = engine.getTick();
    expect(engine.getItems()[CENTRE.y][CENTRE.x]).toBe(LIT);
    const charge = engine.getLitCharges()?.[0];
    expect(charge?.awaitingDeparture).toBeUndefined();
    expect(charge?.detonateTick).toBe(litAt + FUSE_TICKS);
  });

  it('blasts on the tick the fuse runs out and not before', () => {
    const engine = load(room({ fill: WALL }));
    setDownAndLeave(engine);
    const litAt = (engine.getLitCharges() ?? [])[0].detonateTick - FUSE_TICKS;
    while (engine.getTick() < litAt + FUSE_TICKS - 1) engine.tick();
    expect(terrainAt(engine, 1, 0)).toBe(WALL);
    engine.tick();
    expect(engine.getTick()).toBe(litAt + FUSE_TICKS);
    expect(terrainAt(engine, 1, 0)).toBe(FLOOR_TILE_ID);
    expect(engine.getLitCharges()).toBeUndefined();
  });

  it('refuses to be set down on an occupied cell, like any charge', () => {
    const engine = load(room({ items: [[CENTRE.x, CENTRE.y, 'bomb']] }));
    engine.getPlayer().keys[DYNAMITE] = 1;
    expect(engine.dropItem(DYNAMITE)).toBe(false);
  });

  it('keeps the search state key apart while waiting for the player and once lit', () => {
    const engine = load(room());
    engine.getPlayer().keys[DYNAMITE] = 1;
    engine.dropItem(DYNAMITE);
    expect(engine.getRuntimeKeyExtra()).toContain(':w');
    step(engine, 'E');
    expect(engine.getRuntimeKeyExtra()).toContain(`:${FUSE_TICKS}`);
  });
});

describe('dynamite: blast shape', () => {
  it('reaches the 5 by 5 square around it without the four far corners', () => {
    const engine = load(room({ fill: WALL }));
    setDownAndLeave(engine);
    blastNow(engine);
    for (const [dx, dy] of scanOffsets()) {
      if (dx === 0 && dy === 0) continue;
      const expected = inDynamiteBlast(dx, dy) ? FLOOR_TILE_ID : WALL;
      expect(terrainAt(engine, dx, dy), `${dx},${dy}`).toBe(expected);
    }
    const blasted = scanOffsets().filter(([dx, dy]) => inDynamiteBlast(dx, dy));
    expect(blasted).toHaveLength(21);
    expect(inDynamiteBlast(2, 2)).toBe(false);
    expect(inDynamiteBlast(-2, 2)).toBe(false);
    expect(inDynamiteBlast(2, 1)).toBe(true);
    expect(inDynamiteBlast(3, 0)).toBe(false);
  });

  it('leaves fire on its own cell, where the dynamite stood', () => {
    const engine = load(room());
    setDownAndLeave(engine);
    blastNow(engine);
    expect(terrainAt(engine, 0, 0)).toBe('fire');
    expect(engine.getItems()[CENTRE.y][CENTRE.x]).toBeNull();
  });

  it('does not reach past the edge of the map', () => {
    const engine = load(room());
    const world = contextOf(engine).world;
    world.items[1][1] = LIT;
    world.litCharges.push({ x: 1, y: 1, detonateTick: engine.getTick() + 1, dynamite: true });
    expect(() => tickN(engine, 3)).not.toThrow();
    // The border is terrain like any other, so the part of the blast inside the map takes it down.
    expect(engine.getTerrain()[0][1]).toBe(FLOOR_TILE_ID);
  });
});

describe('dynamite: what each terrain becomes', () => {
  const OFFSETS: Array<[number, number, string]> = [
    [1, 0, WALL],
    [-1, 0, 'door_red'],
    [0, 1, 'water'],
    [0, -1, 'ice'],
    [2, 0, 'dirt'],
    [-2, 0, 'gravel'],
    [0, 2, 'exit'],
    [0, -2, 'force_n'],
    [1, 1, 'button_green'],
    [-1, 1, 'teleport'],
    [1, -1, 'laser_emitter_e']
  ];

  it('turns walls, doors, water, ice, force floors, buttons and other terrain into floor', () => {
    const engine = load(room({ terrain: OFFSETS.map(([dx, dy, id]) => [CENTRE.x + dx, CENTRE.y + dy, id]) }));
    setDownAndLeave(engine);
    blastNow(engine);
    for (const [dx, dy, id] of OFFSETS) expect(terrainAt(engine, dx, dy), id).toBe(FLOOR_TILE_ID);
  });

  it('turns fire into floor too', () => {
    const engine = load(room({ terrain: [[CENTRE.x + 1, CENTRE.y, 'fire']] }));
    setDownAndLeave(engine);
    blastNow(engine);
    expect(terrainAt(engine, 1, 0)).toBe(FLOOR_TILE_ID);
  });

  it('spares the steel wall, the socket and the logic gates', () => {
    const spared: Array<[number, number, string]> = [
      [1, 0, 'steel_wall'],
      [-1, 0, 'socket'],
      [0, 1, 'signal_gate_and'],
      [0, -1, 'signal_gate_nand'],
      [2, 0, 'signal_counter_3']
    ];
    const engine = load(room({ terrain: spared.map(([dx, dy, id]) => [CENTRE.x + dx, CENTRE.y + dy, id]) }));
    setDownAndLeave(engine);
    blastNow(engine);
    for (const [dx, dy, id] of spared) expect(terrainAt(engine, dx, dy), id).toBe(id);
  });

  it('forgets the device it destroyed: a laser emitter leaves the lists', () => {
    const engine = load(room({ terrain: [[CENTRE.x + 1, CENTRE.y, 'laser_emitter_e']] }));
    const world = contextOf(engine).world;
    expect(world.laserEmitters).toHaveLength(1);
    setDownAndLeave(engine);
    blastNow(engine);
    expect(world.laserEmitters).toHaveLength(0);
  });

  it('destroys every item in reach, bombs and keys included, and none outside it', () => {
    const inside: Array<[number, number, string]> = [
      [1, 0, 'bomb'],
      [-1, 0, 'key_red'],
      [0, 1, 'chip'],
      [2, 1, 'boots_water'],
      [0, -2, 'charge']
    ];
    const outside: Array<[number, number, string]> = [
      [3, 0, 'bomb'],
      [2, 2, 'key_red']
    ];
    const items = [...inside, ...outside].map(([dx, dy, id]): [number, number, string] => [CENTRE.x + dx, CENTRE.y + dy, id]);
    const engine = load(room({ items }));
    setDownAndLeave(engine);
    blastNow(engine);
    for (const [dx, dy] of inside) expect(engine.getItems()[CENTRE.y + dy][CENTRE.x + dx]).toBeNull();
    for (const [dx, dy, id] of outside) expect(engine.getItems()[CENTRE.y + dy][CENTRE.x + dx]).toBe(id);
  });

  it('blasts an item cell with no terrain change when the terrain already is floor', () => {
    const engine = load(room({ items: [[CENTRE.x + 1, CENTRE.y, 'chip']] }));
    setDownAndLeave(engine);
    blastNow(engine);
    expect(terrainAt(engine, 1, 0)).toBe(FLOOR_TILE_ID);
  });
});

describe('dynamite: creatures', () => {
  const creatures = (placements: Array<[number, number, string]>): EntityPlacement[] =>
    placements.map(([dx, dy, type]) => ({ type, x: CENTRE.x + dx, y: CENTRE.y + dy, dir: 'S' }));

  it('kills the monsters and the blocks in the blast and spares those outside it', () => {
    const engine = load(
      room({
        entities: creatures([
          [1, 0, WALKER],
          [0, 2, BLOCK],
          [-2, -1, WALKER],
          [3, 0, WALKER],
          [2, 2, BLOCK]
        ])
      })
    );
    freeze(engine);
    setDownAndLeave(engine);
    blastNow(engine);
    const left = engine.getEntities().map((e) => `${e.x - CENTRE.x},${e.y - CENTRE.y}`).sort();
    expect(left).toEqual(['2,2', '3,0']);
  });

  it('keeps the terrain under a creature, but plain floor catches fire', () => {
    const engine = load(
      room({
        terrain: [[CENTRE.x + 1, CENTRE.y, 'ice'], [CENTRE.x - 1, CENTRE.y, WALL]],
        entities: creatures([
          [1, 0, BLOCK],
          [0, 1, WALKER]
        ])
      })
    );
    freeze(engine);
    setDownAndLeave(engine);
    blastNow(engine);
    expect(terrainAt(engine, 1, 0)).toBe('ice');
    expect(terrainAt(engine, 0, 1)).toBe('fire');
    expect(terrainAt(engine, -1, 0)).toBe(FLOOR_TILE_ID);
  });

  it('turns the floor under an ice block into water', () => {
    const engine = load(room({ entities: creatures([[1, 1, ICE_BLOCK]]) }));
    freeze(engine);
    setDownAndLeave(engine);
    blastNow(engine);
    expect(engine.getEntities()).toHaveLength(0);
    expect(terrainAt(engine, 1, 1)).toBe('water');
  });

  it('kills the player who stays in the blast, and spares the one outside', () => {
    const near = load(room());
    near.getPlayer().keys[DYNAMITE] = 1;
    near.dropItem(DYNAMITE);
    step(near, 'E');
    tickN(near, FUSE_TICKS + 2);
    expect(near.getPlayer().alive).toBe(false);
    expect(near.getPlayer().deathReasonKey).toBe(CHARGE_DEATH_REASON_KEY);

    const far = load(room());
    setDownAndLeave(far);
    blastNow(far);
    expect(far.getPlayer().alive).toBe(true);
  });
});

describe('dynamite: clone machines and signal sources', () => {
  it('kills the template a clone machine holds and keeps the machine', () => {
    const engine = load(
      room({
        terrain: [[CENTRE.x + 1, CENTRE.y, 'clone_machine']],
        entities: [{ type: WALKER, x: CENTRE.x + 1, y: CENTRE.y, dir: 'S' }]
      })
    );
    freeze(engine);
    setDownAndLeave(engine);
    blastNow(engine);
    expect(engine.getEntities()).toHaveLength(0);
    expect(terrainAt(engine, 1, 0)).toBe('clone_machine');
  });

  it('stops a blasted black button from feeding its network', () => {
    const sink = { x: 2, y: 2 };
    const source = { x: CENTRE.x + 1, y: CENTRE.y };
    const level = room({
      terrain: [[source.x, source.y, 'black_button'], [sink.x, sink.y, 'purple_wall']],
      items: [[3, 3, DYNAMITE]],
      signalLinks: [{ fromX: source.x, fromY: source.y, toX: sink.x, toY: sink.y }]
    });
    const engine = load(level);
    tickN(engine, 3);
    expect(engine.getTerrain()[sink.y][sink.x]).toBe('purple_wall');
    setDownAndLeave(engine);
    blastNow(engine);
    expect(terrainAt(engine, 1, 0)).toBe(FLOOR_TILE_ID);
    expect(engine.getTerrain()[sink.y][sink.x]).toBe('purple_floor');
  });

  it('leaves the same network alone on a level without dynamite', () => {
    const sink = { x: 2, y: 2 };
    const source = { x: CENTRE.x + 1, y: CENTRE.y };
    const engine = load(
      room({
        terrain: [[source.x, source.y, 'black_button'], [sink.x, sink.y, 'purple_wall']],
        signalLinks: [{ fromX: source.x, fromY: source.y, toX: sink.x, toY: sink.y }]
      })
    );
    contextOf(engine).world.terrain[source.y][source.x] = FLOOR_TILE_ID;
    tickN(engine, 5);
    expect(engine.getTerrain()[sink.y][sink.x]).toBe('purple_wall');
  });
});

describe('dynamite: lit dynamite caught in a blast', () => {
  const lightOther = (engine: GameEngine, dx: number, dy: number, ticksLeft: number): void => {
    const world = contextOf(engine).world;
    world.items[CENTRE.y + dy][CENTRE.x + dx] = LIT;
    world.litCharges.push({ x: CENTRE.x + dx, y: CENTRE.y + dy, detonateTick: engine.getTick() + ticksLeft, dynamite: true });
  };

  it('is destroyed with its fuse and never blasts', () => {
    const engine = load(room({ fill: WALL }));
    setDownAndLeave(engine);
    // Two cells east of the first: inside its blast, and its own blast would reach column +4.
    lightOther(engine, 2, 0, FUSE_TICKS + 20);
    blastNow(engine);
    tickN(engine, 40);
    expect(terrainAt(engine, 4, 0)).toBe(WALL);
    expect(engine.getLitCharges()).toBeUndefined();
    expect(engine.getItems()[CENTRE.y][CENTRE.x + 2]).toBeNull();
  });

  it('is destroyed even when it was due on the same tick', () => {
    const engine = load(room({ fill: WALL }));
    setDownAndLeave(engine);
    const due = (engine.getLitCharges() ?? [])[0].detonateTick;
    lightOther(engine, 2, 0, due - engine.getTick());
    blastNow(engine);
    expect(terrainAt(engine, 4, 0)).toBe(WALL);
    // The destroyed dynamite counts as a creature on its cell: the wall under it is protected.
    expect(terrainAt(engine, 2, 0)).toBe(WALL);
    expect(terrainAt(engine, 1, 0)).toBe(FLOOR_TILE_ID);
  });

  it('lights the floor under a lit dynamite it destroys, as under any creature', () => {
    const engine = load(room());
    setDownAndLeave(engine);
    lightOther(engine, 1, 1, FUSE_TICKS + 20);
    blastNow(engine);
    expect(terrainAt(engine, 1, 1)).toBe('fire');
  });

  it('does not set off a dynamite outside its reach', () => {
    const engine = load(room({ fill: WALL }));
    setDownAndLeave(engine);
    lightOther(engine, 3, 0, FUSE_TICKS + 10);
    blastNow(engine);
    expect(engine.getLitCharges()).toHaveLength(1);
    tickN(engine, 12);
    expect(terrainAt(engine, 5, 0)).toBe(FLOOR_TILE_ID);
  });

  it('destroys a dynamite set down and still waiting for its player', () => {
    const engine = load(room({ fill: WALL }));
    setDownAndLeave(engine);
    const world = contextOf(engine).world;
    world.items[CENTRE.y][CENTRE.x + 1] = DYNAMITE;
    world.litCharges.push({ x: CENTRE.x + 1, y: CENTRE.y, detonateTick: Number.MAX_SAFE_INTEGER, dynamite: true, awaitingDeparture: true });
    blastNow(engine);
    expect(engine.getItems()[CENTRE.y][CENTRE.x + 1]).toBeNull();
    expect(engine.getLitCharges()).toBeUndefined();
  });
});

describe('dynamite: undo', () => {
  it('puts back the terrain, the item and the dynamite held', () => {
    const engine = load(room({ fill: WALL }));
    const before = engine.getTerrain().map((row) => [...row]);
    setDownAndLeave(engine);
    blastNow(engine);
    expect(terrainAt(engine, 1, 0)).toBe(FLOOR_TILE_ID);
    expect(engine.undo()).toBe(true);
    expect(engine.getTerrain()).toEqual(before);
    expect(engine.getItems()[CENTRE.y][CENTRE.x]).toBeNull();
    expect(engine.getLitCharges()).toBeUndefined();
    expect(engine.getPlayer().keys[DYNAMITE]).toBe(1);
  });

  it('puts back a set-down dynamite that was waiting, with its waiting mark', () => {
    const engine = load(room());
    engine.getPlayer().keys[DYNAMITE] = 1;
    engine.dropItem(DYNAMITE);
    step(engine, 'E');
    expect(engine.getItems()[CENTRE.y][CENTRE.x]).toBe(LIT);
    expect(engine.undo()).toBe(true);
    expect(engine.getItems()[CENTRE.y][CENTRE.x]).toBe(DYNAMITE);
    expect(engine.getLitCharges()).toEqual([expect.objectContaining({ awaitingDeparture: true })]);
  });

  it('lists the devices again after the undone blast', () => {
    // The level places a dynamite of its own, which is what tells the engine its terrain can change.
    const engine = load(room({ terrain: [[CENTRE.x + 1, CENTRE.y, 'laser_emitter_e']], items: [[2, 2, DYNAMITE]] }));
    setDownAndLeave(engine);
    blastNow(engine);
    const world = contextOf(engine).world;
    expect(world.laserEmitters).toHaveLength(0);
    engine.undo();
    expect(world.laserEmitters).toHaveLength(1);
  });
});

describe('dynamite: validator', () => {
  const shut = (withDynamite: boolean, barrier = WALL): CompiledLevel => {
    const level = room({ items: withDynamite ? [[2, 2, DYNAMITE]] : [] });
    level.terrain = level.terrain.map((row) => row.map(() => 'steel_wall'));
    for (let x = 1; x <= 4; x++) level.terrain[2][x] = FLOOR_TILE_ID;
    level.terrain[2][6] = 'exit';
    level.terrain[2][5] = barrier;
    level.playerStart = { x: 1, y: 2, dir: 'E' };
    return level;
  };

  it('does not call a level unwinnable because of a wall the dynamite could destroy', () => {
    expect(LevelValidator.validate(shut(false)).stats.reachableExit).toBe(false);
    expect(LevelValidator.validate(shut(true)).stats.reachableExit).toBe(true);
  });

  it('reads bombs, ice and force floors on the way as removable too', () => {
    const level = shut(true);
    level.terrain[2][3] = 'ice';
    level.terrain[2][4] = 'force_n';
    level.items[2][3] = 'bomb';
    expect(LevelValidator.validate(level).stats.reachableExit).toBe(true);
    level.terrain[2][5] = 'steel_wall';
    expect(LevelValidator.validate(level).stats.reachableExit).toBe(false);
  });

  it('still counts a steel wall as shut', () => {
    expect(LevelValidator.validate(shut(true, 'steel_wall')).stats.reachableExit).toBe(false);
  });
});
