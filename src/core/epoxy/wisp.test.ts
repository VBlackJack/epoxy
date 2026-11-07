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
import { PACK_JSON_VERSION_V10, PACK_JSON_VERSION_V10_IDS } from '../../config/constants';
import { entityAvailability } from '../../editor/paletteAvailability';
import { DatCodec, datRefusalReason } from '../../formats/DatCodec';
import en from '../../locales/en.json';
import fr from '../../locales/fr.json';
import { parsePackJson, serializePack } from '../../packs/packJson';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { CHARGE_BLAST_RADIUS, PHASE_LINE_PATTERN, STONE_ITEM_ID } from '../coreConstants';
import { GameEngine } from '../GameEngine';
import { LevelValidator } from '../LevelValidator';
import { hasEpoxyOnlyContent, isEpoxyOnlyEntityType, isPhasingEntityType } from '../RulesetFeatures';
import { idSetVersionOf } from '../signalLinks';
import type { EpoxyContext } from './epoxyWorld';
import type { CompiledLevel, Direction, EntityPlacement, RuntimeEntity } from '../types';

const WISP = 'wisp';
const SIZE = 13;
const TIME_LIMIT_SECONDS = 200;
/** A corner of the room, far from the lane the wisp walks along. */
const FAR_PLAYER = { x: 11, y: 11 };
const LANE_Y = 5;
const MAX_WAIT_TICKS = 40;
/** Ticks that are always enough for a wisp to take one step. */
const ONE_STEP_TICKS = 40;
const FLIGHT_TICKS = 30;
const WARD = 'ward';
const BLOCK_ID = 'dirt_block';
const MONSTER_ID = 'pink_ball';
const OPEN_DOOR = 'hold_door_red_open';
const CLOSED_DOOR = 'hold_door_red_closed';
const SETTLE_TICKS = 30;
const CLONE_LINK = { buttonX: 3, buttonY: 3, clonerX: 5, clonerY: 5, templateType: WISP, templateDir: 'E' } as const;

interface Setup {
  terrain?: Array<[number, number, string]>;
  items?: Array<[number, number, string]>;
  entities?: EntityPlacement[];
  player?: { x: number; y: number };
  cloneLinks?: CompiledLevel['cloneLinks'];
}

function room(setup: Setup = {}): CompiledLevel {
  const terrain: string[][] = Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x) => (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? 'wall' : 'floor'))
  );
  for (const [x, y, id] of setup.terrain ?? []) terrain[y][x] = id;
  const items: Array<Array<string | null>> = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null));
  for (const [x, y, id] of setup.items ?? []) items[y][x] = id;
  return {
    id: 'wisp_room',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: TIME_LIMIT_SECONDS,
    chipsRequired: 0,
    playerStart: { ...(setup.player ?? FAR_PLAYER), dir: 'E' },
    terrain,
    items,
    entities: setup.entities ?? [],
    trapLinks: [],
    cloneLinks: setup.cloneLinks ?? []
  };
}

function wispAt(x: number, dir: Direction = 'E', y = LANE_Y): EntityPlacement {
  return { type: WISP, x, y, dir };
}

function load(level: CompiledLevel): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(level);
  return engine;
}

function contextOf(engine: GameEngine): EpoxyContext {
  return (engine as unknown as { ctx: EpoxyContext }).ctx;
}

function tickN(engine: GameEngine, count: number): void {
  for (let i = 0; i < count; i++) engine.tick();
}

function wispOf(engine: GameEngine): RuntimeEntity | undefined {
  return engine.getEntities().find((entity) => entity.type === WISP);
}

/** Ticks until the wisp has moved from where it was, or fails. */
function tickUntilMoved(engine: GameEngine): RuntimeEntity {
  const before = wispOf(engine);
  if (before === undefined) throw new Error('no wisp');
  const { x, y } = before;
  for (let i = 0; i < ONE_STEP_TICKS; i++) {
    engine.tick();
    const now = wispOf(engine);
    if (now === undefined) throw new Error('the wisp vanished');
    if (now.x !== x || now.y !== y) return now;
  }
  throw new Error('the wisp never moved');
}

/** Player step that waits for the move cooldown first. */
function step(engine: GameEngine, dir: Direction): boolean {
  for (let waited = 0; waited <= MAX_WAIT_TICKS; waited++) {
    if (engine.getPlayer().moveCooldown === 0) return engine.attemptPlayerMove(dir);
    engine.tick();
  }
  throw new Error('the player never became able to move');
}

beforeEach(() => {
  loadTestConfigs();
});

describe('wisp: configuration', () => {
  it('is an Epoxy-only phasing monster that presses no plate and is named in both languages', () => {
    const def = ConfigRegistry.getEntityDef(WISP);
    expect(def?.kind).toBe('monster');
    expect(def?.movementPattern).toBe(PHASE_LINE_PATTERN);
    expect(def?.pressesPlates).toBe(false);
    expect(def?.epoxyOnly).toBe(true);
    expect(isPhasingEntityType(WISP)).toBe(true);
    expect(isPhasingEntityType('walker')).toBe(false);
    expect(isEpoxyOnlyEntityType(WISP)).toBe(true);
    for (const locale of [en, fr] as unknown as Array<{ entities: Record<string, { name: string; desc: { label: string } }> }>) {
      expect(locale.entities[WISP].name).toBeTruthy();
      expect(locale.entities[WISP].desc.label).toBeTruthy();
    }
    expect([en.entities.wisp.name.startsWith('Wisp'), fr.entities.wisp.name.startsWith('Feu follet')]).toEqual([true, true]);
  });

  it('is hidden from the Lynx palette, refused by DAT export and counted as Epoxy-only content', () => {
    expect(entityAvailability('lynx', WISP).available).toBe(false);
    expect(entityAvailability('epoxy', WISP)).toEqual({ available: true });
    const level = room({ entities: [wispAt(5)] });
    expect(hasEpoxyOnlyContent(level)).toBe(true);
    expect(datRefusalReason(level)).toBe('epoxy_only_monsters');
    const encoded = DatCodec.encodeLevelsWithReport([level, room()]);
    expect(encoded.refused.map((r) => r.reason)).toEqual(['epoxy_only_monsters']);
  });
});

describe('wisp: movement', () => {
  it('walks straight ahead, one cell per step', () => {
    const engine = load(room({ entities: [wispAt(4)] }));
    expect(tickUntilMoved(engine)).toMatchObject({ x: 5, y: LANE_Y, dir: 'E' });
    expect(tickUntilMoved(engine)).toMatchObject({ x: 6, y: LANE_Y, dir: 'E' });
  });

  it.each(['wall', 'water', 'fire', 'door_red', 'toggle_wall_closed', 'hold_door_red_closed', 'recessed_wall', 'exit'])(
    'passes through a %s cell and is not harmed by it',
    (tile) => {
      const engine = load(room({ terrain: [[6, LANE_Y, tile]], entities: [wispAt(5)] }));
      expect(tickUntilMoved(engine)).toMatchObject({ x: 6, y: LANE_Y });
      expect(wispOf(engine)).toBeDefined();
      expect(tickUntilMoved(engine)).toMatchObject({ x: 7, y: LANE_Y });
    }
  );

  it('crosses the border wall of the room and turns round at the map edge', () => {
    const engine = load(room({ entities: [wispAt(1, 'W')] }));
    expect(tickUntilMoved(engine)).toMatchObject({ x: 0, y: LANE_Y, dir: 'W' });
    expect(tickUntilMoved(engine)).toMatchObject({ x: 1, y: LANE_Y, dir: 'E' });
  });

  it.each(['ice', 'force_n', 'force_s', 'force_random', 'force_cycle', 'teleport', 'trap'])(
    'ignores a %s cell: no slide, no force, no jump, no turn',
    (tile) => {
      const engine = load(room({ terrain: [[6, LANE_Y, tile], [9, LANE_Y, 'teleport']], entities: [wispAt(5)] }));
      expect(tickUntilMoved(engine)).toMatchObject({ x: 6, y: LANE_Y, dir: 'E' });
      expect(tickUntilMoved(engine)).toMatchObject({ x: 7, y: LANE_Y, dir: 'E' });
    }
  );

  it('does not slide on ice: it keeps its own step interval across a run of ice', () => {
    const ice: Array<[number, number, string]> = [4, 5, 6, 7, 8].map((x) => [x, LANE_Y, 'ice']);
    const engine = load(room({ terrain: ice, entities: [wispAt(3)] }));
    const first = tickUntilMoved(engine);
    expect(first.x).toBe(4);
    // One tick later it has not moved again.
    engine.tick();
    expect(wispOf(engine)?.x).toBe(4);
  });

  it('is stopped by a thin wall on the edge it would cross, and turns round', () => {
    const engine = load(room({ terrain: [[6, LANE_Y, 'thin_wall_w']], entities: [wispAt(5)] }));
    expect(tickUntilMoved(engine)).toMatchObject({ x: 4, y: LANE_Y, dir: 'W' });
  });

  it('is stopped by a block and by a monster, and turns round once', () => {
    for (const blocker of [BLOCK_ID, MONSTER_ID]) {
      const engine = load(room({ entities: [wispAt(5), { type: blocker, x: 6, y: LANE_Y, dir: 'E' }] }));
      for (const entity of engine.getEntities()) {
        if (entity.type === blocker) entity.cooldownTicks = ONE_STEP_TICKS * ONE_STEP_TICKS;
      }
      expect(tickUntilMoved(engine), blocker).toMatchObject({ x: 4, y: LANE_Y, dir: 'W' });
    }
  });

  it('stays put, facing as it was, when it is blocked both ways', () => {
    const engine = load(
      room({ entities: [wispAt(5), { type: BLOCK_ID, x: 6, y: LANE_Y, dir: 'E' }, { type: BLOCK_ID, x: 4, y: LANE_Y, dir: 'E' }] })
    );
    tickN(engine, ONE_STEP_TICKS);
    expect(wispOf(engine)).toMatchObject({ x: 5, y: LANE_Y, dir: 'E' });
  });
});

describe('wisp: contact and death', () => {
  it('kills the player it walks into', () => {
    const engine = load(room({ player: { x: 6, y: LANE_Y }, entities: [wispAt(5)] }));
    tickN(engine, ONE_STEP_TICKS);
    expect(engine.getPlayer().alive).toBe(false);
  });

  it('is absorbed by a ward: the wisp is removed, the ward used up, the player lives', () => {
    const engine = load(room({ player: { x: 6, y: LANE_Y }, entities: [wispAt(5)] }));
    engine.getPlayer().boots.add(WARD);
    tickN(engine, ONE_STEP_TICKS);
    expect(engine.getPlayer().alive).toBe(true);
    expect(wispOf(engine)).toBeUndefined();
    expect(engine.getPlayer().boots.has(WARD)).toBe(false);
  });

  it('is destroyed by a thrown stone', () => {
    const engine = load(room({ items: [[11, 11, STONE_ITEM_ID]], player: { x: 2, y: LANE_Y }, entities: [wispAt(8)] }));
    engine.getPlayer().keys[STONE_ITEM_ID] = 1;
    expect(engine.dropItem(STONE_ITEM_ID)).toBe(true);
    tickN(engine, FLIGHT_TICKS);
    expect(wispOf(engine)).toBeUndefined();
    expect(engine.getPlayer().alive).toBe(true);
  });

  it('dies when it walks into a flying shot', () => {
    const engine = load(room({ items: [[11, 11, STONE_ITEM_ID]], entities: [wispAt(5)] }));
    contextOf(engine).world.shots.push({ x: 6, y: LANE_Y, dir: 'S', cooldown: ONE_STEP_TICKS * 4, payload: 'hurl_stone' });
    tickN(engine, ONE_STEP_TICKS);
    expect(wispOf(engine)).toBeUndefined();
    expect(contextOf(engine).world.shots).toHaveLength(0);
  });

  it('is destroyed by the blast of a charge', () => {
    const engine = load(room({ entities: [wispAt(7)] }));
    const world = contextOf(engine).world;
    world.litCharges.push({ x: 7 - CHARGE_BLAST_RADIUS, y: LANE_Y, detonateTick: engine.getTick() + 2 });
    tickN(engine, 4);
    expect(wispOf(engine)).toBeUndefined();
  });
});

describe('wisp: plates', () => {
  const row = ['wall', 'floor', 'floor', 'pressure_plate_red', CLOSED_DOOR, 'wall'];
  function plateLevel(type: string): CompiledLevel {
    const wall = row.map(() => 'wall');
    const terrain = [wall, row, wall];
    return {
      id: 'wisp_plate',
      number: 1,
      password: 'TEST',
      timeLimitSeconds: 0,
      chipsRequired: 0,
      playerStart: { x: 1, y: 1, dir: 'E' },
      terrain,
      items: terrain.map((r) => r.map(() => null)),
      entities: [{ type, x: 3, y: 1, dir: 'S' }],
      trapLinks: [],
      cloneLinks: []
    };
  }

  it('does not press a plate, where a walker does', () => {
    const walker = load(plateLevel('walker'));
    expect(walker.getTerrain()[1][4]).toBe(OPEN_DOOR);
    const wisp = load(plateLevel(WISP));
    expect(wisp.getTerrain()[1][4]).toBe(CLOSED_DOOR);
    tickN(wisp, SETTLE_TICKS);
    expect(wisp.getTerrain()[1][4]).toBe(CLOSED_DOOR);
  });
});

describe('wisp: clone machines', () => {
  const machineTerrain: Array<[number, number, string]> = [[5, 5, 'clone_machine'], [3, 3, 'button_red']];

  it('is an error when it stands on a clone machine or a clone link names it', () => {
    const onMachine = room({ terrain: [[5, 5, 'clone_machine']], entities: [wispAt(5)] });
    const named = room({ terrain: machineTerrain, cloneLinks: [CLONE_LINK] });
    for (const level of [onMachine, named]) {
      const issues = LevelValidator.validate(level).issues.filter((issue) => issue.i18nKey === 'validator.issues.wisp_cloned.label');
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('error');
    }
    const clean = room({ entities: [wispAt(5)] });
    expect(LevelValidator.validate(clean).issues.map((issue) => issue.i18nKey)).not.toContain('validator.issues.wisp_cloned.label');
  });

  it('spawns nothing from a link that names it', () => {
    const engine = load(room({ terrain: machineTerrain, cloneLinks: [CLONE_LINK] }));
    contextOf(engine).triggerButton(3, 3, 'trigger_cloner');
    tickN(engine, 4);
    expect(wispOf(engine)).toBeUndefined();
  });
});

describe('wisp: over a clone machine', () => {
  const machineTerrain: Array<[number, number, string]> = [[6, LANE_Y, 'clone_machine'], [3, 3, 'button_red']];
  const link = { buttonX: 3, buttonY: 3, clonerX: 6, clonerY: LANE_Y, templateType: MONSTER_ID, templateDir: 'S' } as const;

  it('keeps moving across a linked machine, which still spawns its own template', () => {
    const engine = load(room({ terrain: machineTerrain, cloneLinks: [link], entities: [wispAt(5)] }));
    expect(tickUntilMoved(engine)).toMatchObject({ x: 6, y: LANE_Y });
    expect(tickUntilMoved(engine)).toMatchObject({ x: 7, y: LANE_Y });
    contextOf(engine).triggerButton(3, 3, 'trigger_cloner');
    expect(engine.getEntities().some((e) => e.type === MONSTER_ID)).toBe(true);
    expect(wispOf(engine)).toBeDefined();
  });

  it('dies to a blast while standing on a machine', () => {
    const engine = load(room({ terrain: machineTerrain, cloneLinks: [link], entities: [wispAt(6)] }));
    contextOf(engine).world.litCharges.push({ x: 6, y: LANE_Y, detonateTick: engine.getTick() + 2 });
    tickN(engine, 4);
    expect(wispOf(engine)).toBeUndefined();
  });
});

describe('wisp: pack format 10', () => {
  it('is a format 10 id: a level with a wisp, or a link naming one, needs format 10', () => {
    expect(PACK_JSON_VERSION_V10_IDS.has(WISP)).toBe(true);
    expect(PACK_JSON_VERSION_V10_IDS.has(STONE_ITEM_ID)).toBe(true);
    expect(idSetVersionOf(room({ entities: [wispAt(5)] }))).toBe(PACK_JSON_VERSION_V10);
    expect(idSetVersionOf(room())).toBe(0);
    expect(idSetVersionOf(room({ cloneLinks: [CLONE_LINK] }))).toBe(PACK_JSON_VERSION_V10);
  });

  it('writes a pack with a wisp as format 10 and reads it back', () => {
    const text = serializePack('Wisp', [room({ entities: [wispAt(5)] })]);
    expect(JSON.parse(text).version).toBe(PACK_JSON_VERSION_V10);
    const result = parsePackJson(text, ConfigRegistry.getLevelSizeBounds(), new Set<string>(), () => 8000);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.levels[0].entities.map((e) => e.type)).toEqual([WISP]);
  });
});

describe('wisp: undo and replay', () => {
  it('puts the wisp back where it was when moves are undone, and plays the same twice', () => {
    const level = room({ player: { x: 2, y: 2 }, entities: [wispAt(5, 'E', 8)] });
    const play = (): string[] => {
      const engine = load(level);
      const trace: string[] = [];
      for (const dir of ['E', 'E', 'S', 'S'] as const) {
        step(engine, dir);
        tickN(engine, 3);
        trace.push(JSON.stringify(engine.getEntities()));
      }
      return trace;
    };
    expect(play()).toEqual(play());

    const engine = load(level);
    step(engine, 'E');
    tickN(engine, ONE_STEP_TICKS);
    const before = JSON.stringify(engine.getEntities());
    const key = engine.getRuntimeKeyExtra();
    step(engine, 'E');
    tickN(engine, ONE_STEP_TICKS);
    expect(JSON.stringify(engine.getEntities())).not.toBe(before);
    expect(engine.undo()).toBe(true);
    expect(JSON.stringify(engine.getEntities())).toBe(before);
    expect(engine.getRuntimeKeyExtra()).toBe(key);
  });
});
