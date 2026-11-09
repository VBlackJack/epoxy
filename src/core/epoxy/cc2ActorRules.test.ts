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
 * Format 14 actor rules of Chip's Challenge 2, checked against Lexy's Labyrinth (tiletypes.js): the slime that only
 * dirt and ice blocks clear, the turtle every monster but a fireball may cross and that sinks unless an actor remains
 * or a glider leaves, and the transmogrifier that changes only the actor that arrives on it.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { ConfigRegistry } from '../../config/ConfigRegistry';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { GameEngine } from '../GameEngine';
import type { CompiledLevel, Direction, EntityPlacement } from '../types';
import { resolveMonsterArrival } from './epoxyMonsters';
import { leaveCell } from './epoxyWorld';
import type { EpoxyContext } from './epoxyWorld';

const SIZE = 11;
const ROW = 5;
const PLAYER_X = 2;
const BLOCK_X = 3;
const TILE_X = 4;
const BEYOND_X = 5;
const FAR_CORNER = { x: 9, y: 9 };
const MAX_TICKS = 120;
const MAX_WAIT_TICKS = 40;
const SLIME = 'slime';
const SLIME_CC2 = 'slime_cc2';
const TURTLE = 'turtle';
const TURTLE_CC2 = 'turtle_cc2';
const TRANSMOG = 'transmogrifier';
const TRANSMOG_CC2 = 'transmogrifier_cc2';
const CAUGHT_SEED = 7;
const SEED_SWEEP = 40;
const RNG_PROBE_MAX = 1000000;

interface Setup {
  terrain?: Array<[number, number, string]>;
  items?: Array<[number, number, string]>;
  entities?: EntityPlacement[];
  player?: { x: number; y: number };
}

/** A walled open room; the player waits in the far corner unless the setup says otherwise. */
function room(setup: Setup = {}): CompiledLevel {
  const terrain: string[][] = Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x) => (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? 'wall' : 'floor'))
  );
  for (const [x, y, id] of setup.terrain ?? []) terrain[y][x] = id;
  const items: Array<Array<string | null>> = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null));
  for (const [x, y, id] of setup.items ?? []) items[y][x] = id;
  return {
    id: 'cc2_actor_rules_room',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    playerStart: { ...(setup.player ?? FAR_CORNER), dir: 'E' },
    terrain,
    items,
    entities: setup.entities ?? [],
    trapLinks: [],
    cloneLinks: []
  };
}

/** A one-cell-wide lane along the row, so a monster can only go forward or back. */
function lane(setup: Setup = {}): CompiledLevel {
  const level = room(setup);
  for (let y = 1; y < SIZE - 1; y++) {
    if (y === ROW) continue;
    for (let x = 1; x < SIZE - 1; x++) {
      if (!(setup.terrain ?? []).some(([tx, ty]) => tx === x && ty === y)) level.terrain[y][x] = 'wall';
    }
  }
  return level;
}

function load(level: CompiledLevel, seed?: number): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(level, seed);
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

/** Pushes the block east from the player's cell and lets it settle. */
function pushBlock(engine: GameEngine): void {
  step(engine, 'E');
  for (let i = 0; i < MAX_TICKS; i++) engine.tick();
}

/** Ticks until the monster has left the given column or is gone. */
function tickUntilLeft(engine: GameEngine, x: number): void {
  for (let i = 0; i < MAX_TICKS; i++) {
    const monster = engine.getEntities().find((e) => e.kind === 'monster');
    if (monster === undefined || monster.x > x) return;
    engine.tick();
  }
  throw new Error(`the monster never left column ${x}`);
}

/** The monster is put on the tile and its arrival is resolved, without any walking. */
function arriveOn(type: string, tile: string, seed?: number): { engine: GameEngine; type: string | undefined } {
  const engine = load(room({ terrain: [[TILE_X, ROW, tile]], entities: [placed(type, TILE_X, ROW)] }), seed);
  const entity = engine.getEntities()[0];
  resolveMonsterArrival(contextOf(engine), entity, false);
  return { engine, type: engine.getEntities().find((e) => e.uid === entity.uid)?.type };
}

beforeEach(() => {
  loadTestConfigs();
});

describe('slime_cc2: blocks', () => {
  it.each(['dirt_block', 'ice_block'])('lets a %s survive, standing on the floor the slime became', (blockType) => {
    const engine = load(
      room({ terrain: [[TILE_X, ROW, SLIME_CC2]], entities: [placed(blockType, BLOCK_X, ROW)], player: { x: PLAYER_X, y: ROW } })
    );
    pushBlock(engine);
    expect(engine.getTerrain()[ROW][TILE_X]).toBe('floor');
    const block = engine.getEntities().find((e) => e.type === blockType);
    expect(block).toMatchObject({ kind: 'block', x: TILE_X, y: ROW });
  });

  it('destroys any other block as it cleans the slime', () => {
    const engine = load(
      room({ terrain: [[TILE_X, ROW, SLIME_CC2]], entities: [placed('color_block_red', BLOCK_X, ROW)], player: { x: PLAYER_X, y: ROW } })
    );
    pushBlock(engine);
    expect(engine.getTerrain()[ROW][TILE_X]).toBe('floor');
    expect(engine.getEntities()).toEqual([]);
  });

  it('keeps the classic slime destroying a dirt block', () => {
    const engine = load(
      room({ terrain: [[TILE_X, ROW, SLIME]], entities: [placed('dirt_block', BLOCK_X, ROW)], player: { x: PLAYER_X, y: ROW } })
    );
    pushBlock(engine);
    expect(engine.getTerrain()[ROW][TILE_X]).toBe('floor');
    expect(engine.getEntities()).toEqual([]);
  });

  it('lets a surviving block be pushed on over the cleaned floor', () => {
    const engine = load(
      room({ terrain: [[TILE_X, ROW, SLIME_CC2]], entities: [placed('dirt_block', BLOCK_X, ROW)], player: { x: PLAYER_X, y: ROW } })
    );
    pushBlock(engine);
    step(engine, 'E');
    for (let i = 0; i < MAX_TICKS; i++) engine.tick();
    expect(engine.getEntities()[0]).toMatchObject({ type: 'dirt_block', x: BEYOND_X });
    expect(engine.getPlayer()).toMatchObject({ x: TILE_X, alive: true });
  });
});

describe('slime_cc2: monsters', () => {
  it('kills a bug and keeps a blob and a ghost', () => {
    expect(arriveOn('bug', SLIME_CC2).engine.getEntities()).toEqual([]);
    expect(arriveOn('blob', SLIME_CC2).type).toBe('blob');
    expect(arriveOn('ghost', SLIME_CC2).type).toBe('ghost');
  });
});

describe('turtle_cc2: monsters', () => {
  it('lets a walker cross the turtle, which sinks into water behind it', () => {
    const engine = load(lane({ terrain: [[TILE_X, ROW, TURTLE_CC2]], entities: [placed('walker', TILE_X - 1, ROW)] }));
    for (let i = 0; i < MAX_TICKS && engine.getEntities()[0].x < TILE_X; i++) engine.tick();
    expect(engine.getEntities()[0].x).toBe(TILE_X);
    expect(engine.getTerrain()[ROW][TILE_X]).toBe(TURTLE_CC2);
    tickUntilLeft(engine, TILE_X);
    expect(engine.getTerrain()[ROW][TILE_X]).toBe('water');
  });

  it('leaves the turtle afloat behind a glider', () => {
    const engine = load(lane({ terrain: [[TILE_X, ROW, TURTLE_CC2]], entities: [placed('glider', TILE_X - 1, ROW)] }));
    tickUntilLeft(engine, TILE_X);
    expect(engine.getTerrain()[ROW][TILE_X]).toBe(TURTLE_CC2);
  });

  it('keeps a fireball and a ghost off the turtle', () => {
    for (const type of ['fireball', 'ghost']) {
      const engine = load(lane({ terrain: [[TILE_X, ROW, TURTLE_CC2]], entities: [placed(type, TILE_X - 1, ROW)] }));
      for (let i = 0; i < MAX_TICKS; i++) engine.tick();
      expect(engine.getEntities()[0].x, type).toBeLessThan(TILE_X);
      expect(engine.getTerrain()[ROW][TILE_X], type).toBe(TURTLE_CC2);
    }
  });

  it('does not sink while another actor still stands on the cell', () => {
    const engine = load(
      room({ terrain: [[TILE_X, ROW, TURTLE_CC2]], entities: [placed('walker', TILE_X, ROW), placed('dirt_block', TILE_X, ROW)] })
    );
    const world = contextOf(engine).world;
    const monster = world.entities[0];
    leaveCell(world, TILE_X, ROW, { leaver: monster });
    expect(engine.getTerrain()[ROW][TILE_X]).toBe(TURTLE_CC2);
    world.entities.splice(1, 1);
    leaveCell(world, TILE_X, ROW, { leaver: monster });
    expect(engine.getTerrain()[ROW][TILE_X]).toBe('water');
  });

  it('sinks the classic turtle behind a CC3D monster that enters turtles, and leaves it afloat behind one that leaves them afloat', () => {
    expect(ConfigRegistry.getEntityDef('bouncer')?.entersTurtles).toBe(true);
    expect(ConfigRegistry.getEntityDef('bouncer')?.leavesTurtlesAfloat).toBeUndefined();
    const sinking = load(lane({ terrain: [[TILE_X, ROW, TURTLE]], entities: [placed('bouncer', TILE_X - 1, ROW)] }));
    tickUntilLeft(sinking, TILE_X);
    expect(sinking.getTerrain()[ROW][TILE_X]).toBe('water');
    expect(ConfigRegistry.getEntityDef('blinky')?.leavesTurtlesAfloat).toBe(true);
    const afloat = load(lane({ terrain: [[TILE_X, ROW, TURTLE]], entities: [placed('blinky', TILE_X - 1, ROW)] }));
    tickUntilLeft(afloat, TILE_X);
    expect(afloat.getTerrain()[ROW][TILE_X]).toBe(TURTLE);
  });

  it('keeps the classic turtle closed to a bug', () => {
    const engine = load(lane({ terrain: [[TILE_X, ROW, TURTLE]], entities: [placed('bug', TILE_X - 1, ROW)] }));
    for (let i = 0; i < MAX_TICKS; i++) engine.tick();
    expect(engine.getEntities()[0].x).toBeLessThan(TILE_X);
    expect(engine.getTerrain()[ROW][TILE_X]).toBe(TURTLE);
    expect(ConfigRegistry.getTile(TURTLE).barsMonsters).toBeUndefined();
  });
});

describe('turtle_cc2: player and blocks', () => {
  it('sinks behind the player who leaves it', () => {
    const engine = load(room({ terrain: [[TILE_X, ROW, TURTLE_CC2]], player: { x: TILE_X, y: ROW } }));
    expect(step(engine, 'E')).toBe(true);
    expect(engine.getTerrain()[ROW][TILE_X]).toBe('water');
  });

  it('sinks behind a block pushed off it', () => {
    const engine = load(
      room({ terrain: [[BLOCK_X, ROW, TURTLE_CC2]], entities: [placed('dirt_block', BLOCK_X, ROW)], player: { x: PLAYER_X, y: ROW } })
    );
    pushBlock(engine);
    expect(engine.getTerrain()[ROW][BLOCK_X]).toBe('water');
  });
});

describe('transmogrifier_cc2', () => {
  it('turns a monster into its one-to-one CC2 target, not its classic pair', () => {
    const cc2 = ConfigRegistry.getEntityDef('bug')?.transmogrifiesToCc2;
    expect(cc2).toBeDefined();
    expect(cc2).not.toBe(ConfigRegistry.getEntityDef('bug')?.transmogrifiesTo);
    expect(arriveOn('bug', TRANSMOG_CC2).type).toBe(cc2);
    expect(arriveOn('glider', TRANSMOG_CC2).type).toBe(ConfigRegistry.getEntityDef('glider')?.transmogrifiesToCc2);
  });

  it('keeps the classic pairs on the classic transmogrifier', () => {
    expect(arriveOn('bug', TRANSMOG).type).toBe('paramecium');
  });

  it('leaves a monster without a CC2 entry unchanged', () => {
    expect(ConfigRegistry.getEntityDef('tank')?.transmogrifiesToCc2).toBeUndefined();
    expect(arriveOn('tank', TRANSMOG_CC2).type).toBe('tank');
  });

  it('does not change a monster that ignores floor effects, even one that names a CC2 target', () => {
    const ghost = ConfigRegistry.getEntityDef('ghost');
    expect(ghost?.ignoresFloorEffects).toBe(true);
    const named = ghost!.transmogrifiesToCc2;
    ghost!.transmogrifiesToCc2 = 'bug';
    try {
      expect(arriveOn('ghost', TRANSMOG_CC2).type).toBe('ghost');
      // Control: the same definition without the flag does turn into the named kind.
      ghost!.ignoresFloorEffects = false;
      expect(arriveOn('ghost', TRANSMOG_CC2).type).toBe('bug');
    } finally {
      ghost!.ignoresFloorEffects = true;
      ghost!.transmogrifiesToCc2 = named;
    }
  });

  it('keeps the uid, the cell and the facing of the changed monster', () => {
    const engine = load(room({ terrain: [[TILE_X, ROW, TRANSMOG_CC2]], entities: [placed('bug', TILE_X, ROW, 'N')] }));
    const before = engine.getEntities()[0];
    const uid = before.uid;
    resolveMonsterArrival(contextOf(engine), before, false);
    expect(engine.getEntities().find((e) => e.uid === uid)).toMatchObject({
      x: TILE_X,
      y: ROW,
      dir: 'N',
      kind: 'monster',
      type: ConfigRegistry.getEntityDef('bug')?.transmogrifiesToCc2
    });
    expect(engine.getEntities().find((e) => e.uid === uid)?.type).not.toBe('bug');
  });

  it('turns a blob into a member of its pool, the same one for the same seed', () => {
    const pool = ConfigRegistry.getEntityDef('blob')?.transmogrifiesToCc2Pool ?? [];
    expect(pool.length).toBeGreaterThan(1);
    const first = arriveOn('blob', TRANSMOG_CC2, CAUGHT_SEED).type;
    expect(pool).toContain(first);
    expect(arriveOn('blob', TRANSMOG_CC2, CAUGHT_SEED).type).toBe(first);
    const seen = new Set<string | undefined>();
    for (let seed = 1; seed <= SEED_SWEEP; seed++) seen.add(arriveOn('blob', TRANSMOG_CC2, seed).type);
    expect(seen.size).toBeGreaterThan(1);
    for (const type of seen) expect(pool).toContain(type);
  });

  it('draws nothing from the random stream when a monster that is not a blob arrives', () => {
    const engine = load(room({ terrain: [[TILE_X, ROW, TRANSMOG_CC2]], entities: [placed('bug', TILE_X, ROW)] }), CAUGHT_SEED);
    const reference = load(room(), CAUGHT_SEED);
    resolveMonsterArrival(contextOf(engine), engine.getEntities()[0], false);
    expect(contextOf(engine).world.rng.nextInt(0, RNG_PROBE_MAX)).toBe(contextOf(reference).world.rng.nextInt(0, RNG_PROBE_MAX));
  });

  it('turns a pushed dirt block into an ice block and the reverse', () => {
    for (const [from, to] of [
      ['dirt_block', 'ice_block'],
      ['ice_block', 'dirt_block']
    ]) {
      const engine = load(
        room({ terrain: [[TILE_X, ROW, TRANSMOG_CC2]], entities: [placed(from, BLOCK_X, ROW)], player: { x: PLAYER_X, y: ROW } })
      );
      pushBlock(engine);
      expect(engine.getEntities()[0], from).toMatchObject({ type: to, kind: 'block', x: TILE_X });
    }
  });

  it('leaves a block on the classic transmogrifier unchanged', () => {
    const engine = load(
      room({ terrain: [[TILE_X, ROW, TRANSMOG]], entities: [placed('dirt_block', BLOCK_X, ROW)], player: { x: PLAYER_X, y: ROW } })
    );
    pushBlock(engine);
    expect(engine.getEntities()[0]).toMatchObject({ type: 'dirt_block', x: TILE_X });
  });

  it('leaves the items on the cell where they lie', () => {
    const engine = load(
      room({ terrain: [[TILE_X, ROW, TRANSMOG_CC2]], items: [[TILE_X, ROW, 'key_red']], entities: [placed('bug', TILE_X, ROW)] })
    );
    resolveMonsterArrival(contextOf(engine), engine.getEntities()[0], false);
    expect(contextOf(engine).world.items[ROW][TILE_X]).toBe('key_red');
  });

  it('switches the character of the player who walks onto it', () => {
    const engine = load(room({ terrain: [[TILE_X, ROW, TRANSMOG_CC2]], player: { x: TILE_X - 1, y: ROW } }));
    const before = engine.getPlayerCharacter();
    expect(step(engine, 'E')).toBe(true);
    expect(engine.getPlayerCharacter()).not.toBe(before);
  });
});
