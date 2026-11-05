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
import { findTransmogrifierConfigErrors } from '../../config/ConfigValidation';
import { tileAvailability } from '../../editor/paletteAvailability';
import en from '../../locales/en.json';
import fr from '../../locales/fr.json';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { isDeviceCell } from '../DeviceRelations';
import { GameEngine } from '../GameEngine';
import { hasEpoxyOnlyContent, hasEpoxyOnlyMonsterContent, isEpoxyOnlyTileId, isTransmogrifierTileId } from '../RulesetFeatures';
import { resolveMonsterArrival } from './epoxyMonsters';
import { steerMonsters } from './epoxySteering';
import type { EpoxyContext } from './epoxyWorld';
import type { CompiledLevel, Direction, EntityDefinition, EntityPlacement, TileDefinition } from '../types';

const TRANSMOG = 'transmogrifier';
const SIZE = 11;
const LANE_Y = 5;
const LANE_FIRST_X = 1;
const LANE_LAST_X = 9;
const MONSTER_X = 4;
const PAD_X = 5;
const BEYOND_PAD_X = 6;
const TIME_LIMIT_SECONDS = 100;
const MAX_TICKS = 80;
const MAX_WAIT_TICKS = 40;
const FAR_CORNER = { x: 9, y: 9 };
const CLONER = { x: 6, y: 2 };
const CLONE_BUTTON = { x: 8, y: 8 };
const TELEPORT_EXIT_X = 8;
const TELEPORT_EXIT_Y = 2;

/** Every kind that swaps, with its pair. */
const PAIRS: Array<[string, string]> = [
  ['bug', 'paramecium'],
  ['paramecium', 'bug'],
  ['glider', 'fireball'],
  ['fireball', 'glider'],
  ['teeth', 'skitter'],
  ['skitter', 'teeth'],
  ['pink_ball', 'walker'],
  ['walker', 'pink_ball']
];

interface Setup {
  terrain?: Array<[number, number, string]>;
  entities?: EntityPlacement[];
  player?: { x: number; y: number };
  cloneLinks?: CompiledLevel['cloneLinks'];
}

/** A one-cell-wide lane in a walled block: a monster can only go forward or back. */
function lane(setup: Setup = {}): CompiledLevel {
  const terrain: string[][] = Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x) => (y === LANE_Y && x >= LANE_FIRST_X && x <= LANE_LAST_X ? 'floor' : 'wall'))
  );
  for (const [x, y, id] of setup.terrain ?? []) terrain[y][x] = id;
  return level(terrain, setup);
}

/** A walled open room, for the cases that need space around the pad. */
function room(setup: Setup = {}): CompiledLevel {
  const terrain: string[][] = Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x) => (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? 'wall' : 'floor'))
  );
  for (const [x, y, id] of setup.terrain ?? []) terrain[y][x] = id;
  return level(terrain, setup);
}

function level(terrain: string[][], setup: Setup): CompiledLevel {
  return {
    id: 'transmogrifier_room',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: TIME_LIMIT_SECONDS,
    chipsRequired: 0,
    playerStart: { ...(setup.player ?? FAR_CORNER), dir: 'E' },
    terrain,
    items: Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null)),
    entities: setup.entities ?? [],
    trapLinks: [],
    cloneLinks: setup.cloneLinks ?? []
  };
}

function load(compiled: CompiledLevel): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(compiled);
  return engine;
}

function contextOf(engine: GameEngine): EpoxyContext {
  return (engine as unknown as { ctx: EpoxyContext }).ctx;
}

function placed(type: string, x: number, y: number, dir: Direction = 'E'): EntityPlacement {
  return { type, x, y, dir };
}

/** Ticks until a monster stands on the given column or beyond. */
function tickUntilColumn(engine: GameEngine, x: number): void {
  for (let i = 0; i < MAX_TICKS; i++) {
    if (engine.getEntities().some((e) => e.kind === 'monster' && e.x >= x)) return;
    engine.tick();
  }
  throw new Error(`no monster reached column ${x}`);
}

/** Ticks until no entity is left. */
function tickUntilGone(engine: GameEngine): void {
  for (let i = 0; i < MAX_TICKS && engine.getEntities().length > 0; i++) engine.tick();
}

/** Lane level with one monster west of the pad; the player stands where the kind's movement rule heads east. */
function laneWith(type: string, extra: Array<[number, number, string]> = []): CompiledLevel {
  const player = type === 'skitter' ? { x: LANE_FIRST_X, y: LANE_Y } : { x: LANE_LAST_X, y: LANE_Y };
  return lane({ terrain: [[PAD_X, LANE_Y, TRANSMOG], ...extra], entities: [placed(type, MONSTER_X, LANE_Y)], player });
}

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

describe('transmogrifier: configuration', () => {
  it('is a mechanism tile every kind of actor can enter, flagged transmogrifies and named in both languages', () => {
    const tile = ConfigRegistry.getTile(TRANSMOG);
    expect(tile.category).toBe('mechanisms');
    expect(tile.transmogrifies).toBe(true);
    expect(tile.passableByPlayer).toBe(true);
    expect(tile.passableByMonster).toBe(true);
    expect(tile.passableByBlock).toBe(true);
    for (const locale of [en, fr] as unknown as Array<{ tiles: Record<string, { name: string; desc: { label: string } }> }>) {
      expect(locale.tiles[TRANSMOG].name).toBeTruthy();
      expect(locale.tiles[TRANSMOG].desc.label).toBeTruthy();
    }
  });

  it('pairs the four kinds symmetrically and leaves the others unpaired', () => {
    for (const [from, to] of PAIRS) {
      expect(ConfigRegistry.getEntityDef(from)?.transmogrifiesTo, from).toBe(to);
    }
    for (const unpaired of ['tank', 'blob', 'puppet', 'dirt_block']) {
      expect(ConfigRegistry.getEntityDef(unpaired)?.transmogrifiesTo, unpaired).toBeUndefined();
    }
  });

  it('accepts the shipped configuration', () => {
    expect(findTransmogrifierConfigErrors(ConfigRegistry.getTiles().tiles, ConfigRegistry.getMonsters().entities)).toEqual([]);
  });

  describe('rejects a bad pairing', () => {
    const errorsFor = (patch: Record<string, Partial<EntityDefinition>>, tiles?: Record<string, TileDefinition>): string =>
      findTransmogrifierConfigErrors(
        tiles ?? ConfigRegistry.getTiles().tiles,
        Object.fromEntries(
          Object.entries(ConfigRegistry.getMonsters().entities).map(([id, def]) => [id, { ...def, ...(patch[id] ?? {}) }])
        )
      ).join('; ');

    it('with a missing target, a block target, itself or a one-way pairing', () => {
      expect(errorsFor({ bug: { transmogrifiesTo: 'nowhere' } })).toContain('unknown entity nowhere');
      expect(errorsFor({ bug: { transmogrifiesTo: 'dirt_block' } })).toContain('is not a monster');
      expect(errorsFor({ bug: { transmogrifiesTo: 'bug' } })).toContain('into itself');
      expect(errorsFor({ paramecium: { transmogrifiesTo: 'glider' } })).toContain('must transmogrify back');
    });

    it('with a steered kind', () => {
      expect(errorsFor({ bug: { transmogrifiesTo: 'puppet' } })).toContain('must transmogrify back');
      expect(errorsFor({ puppet: { transmogrifiesTo: 'bug' }, bug: { transmogrifiesTo: 'puppet' } })).toContain('steeredBy');
    });

    it('with different intervals or a flier paired with a walker', () => {
      expect(errorsFor({ bug: { moveIntervalTicks: 7 } })).toContain('same moveIntervalTicks');
      expect(errorsFor({ glider: { flying: false } })).toContain('both fly or both walk');
    });

    it('with an override of pushing, passing tiles, plates or steering on a paired kind', () => {
      expect(errorsFor({ bug: { pushesBlocks: true } })).toContain('bug.pushesBlocks');
      expect(errorsFor({ paramecium: { passesTiles: ['fire'] } })).toContain('paramecium.passesTiles');
      expect(errorsFor({ teeth: { pressesPlates: true } })).toContain('teeth.pressesPlates');
      expect(errorsFor({ skitter: { steeredBy: 'steer_monsters' } })).toContain('skitter.steeredBy');
    });

    it('with a tile flag that is not true', () => {
      const tiles = ConfigRegistry.getTiles().tiles;
      const broken = { ...tiles, [TRANSMOG]: { ...tiles[TRANSMOG], transmogrifies: false as unknown as true } };
      expect(errorsFor({}, broken)).toContain('transmogrifier.transmogrifies');
    });
  });
});

describe('transmogrifier: monsters arriving by a step', () => {
  it.each(PAIRS)('turns a %s into a %s and keeps everything else', (from, to) => {
    const engine = load(laneWith(from));
    const uid = engine.getEntities().find((e) => e.type === from)?.uid;
    expect(uid).toBeDefined();
    tickUntilColumn(engine, PAD_X);
    const after = engine.getEntities().find((e) => e.uid === uid);
    expect(after?.type).toBe(to);
    expect(after).toMatchObject({ x: PAD_X, y: LANE_Y, dir: 'E', kind: 'monster' });
  });

  it('does not swap again while the new kind stays on the pad', () => {
    const engine = load(laneWith('pink_ball'));
    tickUntilColumn(engine, PAD_X);
    expect(engine.getEntities()[0].type).toBe('walker');
    engine.tick();
    expect(engine.getEntities()[0].type).toBe('walker');
  });

  it('leaves a kind without a pair unchanged', () => {
    for (const type of ['tank', 'blob', 'puppet']) {
      const engine = load(room({ terrain: [[PAD_X, LANE_Y, TRANSMOG]], entities: [placed(type, MONSTER_X, LANE_Y)] }));
      const entity = engine.getEntities()[0];
      entity.x = PAD_X;
      expect(resolveMonsterArrival(contextOf(engine), entity, false), type).toBe(true);
      expect(engine.getEntities()[0].type, type).toBe(type);
    }
  });

  it('leaves a tank that walks onto the pad a tank', () => {
    const engine = load(laneWith('tank'));
    tickUntilColumn(engine, PAD_X);
    expect(engine.getEntities()[0].type).toBe('tank');
  });

  it('does not swap a monster that stands on the pad when the level starts', () => {
    const engine = load(lane({ terrain: [[PAD_X, LANE_Y, TRANSMOG]], entities: [placed('bug', PAD_X, LANE_Y)] }));
    expect(engine.getEntities()[0].type).toBe('bug');
    for (let i = 0; i < MAX_WAIT_TICKS; i++) engine.tick();
    expect(engine.getEntities()[0].type).toBe('bug');
  });

  it('does not touch the player or a pushed block', () => {
    const engine = load(
      room({
        terrain: [[PAD_X, LANE_Y, TRANSMOG]],
        entities: [placed('dirt_block', PAD_X - 1, LANE_Y, 'E')],
        player: { x: PAD_X - 2, y: LANE_Y }
      })
    );
    expect(step(engine, 'E')).toBe(true);
    expect(engine.getEntities()[0]).toMatchObject({ type: 'dirt_block', kind: 'block', x: PAD_X });
    expect(step(engine, 'E')).toBe(true);
    expect(engine.getPlayer()).toMatchObject({ x: PAD_X, alive: true });
    expect(engine.getEntities()[0]).toMatchObject({ type: 'dirt_block', kind: 'block', x: BEYOND_PAD_X });
  });

  it('lets the player walk across it', () => {
    const engine = load(room({ terrain: [[PAD_X, LANE_Y, TRANSMOG]], player: { x: PAD_X - 1, y: LANE_Y } }));
    expect(step(engine, 'E')).toBe(true);
    expect(engine.getPlayer()).toMatchObject({ x: PAD_X, y: LANE_Y, alive: true });
    expect(engine.getTerrain()[LANE_Y][PAD_X]).toBe(TRANSMOG);
  });
});

describe('transmogrifier: the new kind meets the hazards of the next cell', () => {
  it('drowns a glider turned into a fireball by the water behind the pad', () => {
    const engine = load(laneWith('glider', [[BEYOND_PAD_X, LANE_Y, 'water']]));
    tickUntilColumn(engine, PAD_X);
    expect(engine.getEntities()[0].type).toBe('fireball');
    tickUntilGone(engine);
    expect(engine.getEntities()).toEqual([]);
  });

  it('stops a fireball turned into a glider at the fire behind the pad, which only fireballs may enter', () => {
    const engine = load(laneWith('fireball', [[BEYOND_PAD_X, LANE_Y, 'fire']]));
    tickUntilColumn(engine, PAD_X);
    expect(engine.getEntities()[0].type).toBe('glider');
    // The glider cannot step into the fire: it turns back instead of burning, and stays on the lane.
    for (let i = 0; i < MAX_TICKS && engine.getEntities()[0].x === PAD_X; i++) engine.tick();
    expect(engine.getEntities()).toHaveLength(1);
    expect(engine.getEntities()[0].x).toBe(PAD_X - 1);
  });
});

describe('transmogrifier: other ways to arrive', () => {
  it('swaps a monster that a teleporter drops next to it', () => {
    const engine = load(
      room({
        terrain: [
          [PAD_X - 1, LANE_Y, 'teleport'],
          [TELEPORT_EXIT_X - 1, TELEPORT_EXIT_Y, 'teleport'],
          [TELEPORT_EXIT_X, TELEPORT_EXIT_Y, TRANSMOG]
        ],
        entities: [placed('pink_ball', PAD_X - 2, LANE_Y, 'E')]
      })
    );
    for (let i = 0; i < MAX_TICKS && engine.getEntities()[0].x !== TELEPORT_EXIT_X; i++) engine.tick();
    expect(engine.getEntities()[0]).toMatchObject({ type: 'walker', x: TELEPORT_EXIT_X, y: TELEPORT_EXIT_Y });
  });

  it('swaps a monster that a clone machine spawns onto it, and leaves the template alone', () => {
    const engine = load(
      room({
        terrain: [
          [CLONER.x, CLONER.y, 'clone_machine'],
          [CLONER.x, CLONER.y + 1, TRANSMOG],
          [CLONE_BUTTON.x, CLONE_BUTTON.y, 'button_brown']
        ],
        entities: [placed('bug', CLONER.x, CLONER.y, 'S')],
        cloneLinks: [
          { buttonX: CLONE_BUTTON.x, buttonY: CLONE_BUTTON.y, clonerX: CLONER.x, clonerY: CLONER.y, templateType: 'bug', templateDir: 'S' }
        ]
      })
    );
    expect(contextOf(engine).triggerButton(CLONE_BUTTON.x, CLONE_BUTTON.y, 'trigger_cloner')).toBe(true);
    const found = engine.getEntities().map((e) => `${e.type}@${e.x},${e.y}`).sort();
    expect(found).toEqual([`bug@${CLONER.x},${CLONER.y}`, `paramecium@${CLONER.x},${CLONER.y + 1}`]);
  });

  it('leaves a steered puppet a puppet when a steering step puts it on the pad', () => {
    const engine = load(
      room({
        terrain: [
          [PAD_X, LANE_Y, TRANSMOG],
          [1, 1, 'puppet_control']
        ],
        entities: [placed('puppet', PAD_X - 1, LANE_Y, 'E')]
      })
    );
    expect(steerMonsters(contextOf(engine), 'E')).toBe(true);
    expect(engine.getEntities()[0]).toMatchObject({ type: 'puppet', x: PAD_X });
  });
});

describe('transmogrifier: undo', () => {
  it('puts the old kind back when the player undoes a move made before the swap', () => {
    const engine = load(
      lane({
        terrain: [[PAD_X, LANE_Y, TRANSMOG]],
        entities: [placed('bug', MONSTER_X, LANE_Y)],
        player: { x: LANE_LAST_X - 1, y: LANE_Y }
      })
    );
    expect(step(engine, 'E')).toBe(true);
    tickUntilColumn(engine, PAD_X);
    expect(engine.getEntities()[0].type).toBe('paramecium');
    expect(engine.undo()).toBe(true);
    expect(engine.getEntities()[0]).toMatchObject({ type: 'bug', x: MONSTER_X });
  });
});

describe('transmogrifier: rulesets and devices', () => {
  it('is an Epoxy-only tile, and a level holding one is Epoxy-only content and monster content', () => {
    expect(isTransmogrifierTileId(TRANSMOG)).toBe(true);
    expect(isTransmogrifierTileId('floor')).toBe(false);
    expect(isEpoxyOnlyTileId(TRANSMOG)).toBe(true);
    const plain = lane();
    const marked = lane({ terrain: [[PAD_X, LANE_Y, TRANSMOG]] });
    expect(hasEpoxyOnlyContent(plain)).toBe(false);
    expect(hasEpoxyOnlyContent(marked)).toBe(true);
    expect(hasEpoxyOnlyMonsterContent(plain)).toBe(false);
    expect(hasEpoxyOnlyMonsterContent(marked)).toBe(true);
  });

  it('is unavailable in the Lynx palette and available under Epoxy rules', () => {
    expect(tileAvailability('lynx', TRANSMOG).available).toBe(false);
    expect(tileAvailability('epoxy', TRANSMOG).available).toBe(true);
  });

  it('is not a device', () => {
    expect(isDeviceCell(lane({ terrain: [[PAD_X, LANE_Y, TRANSMOG]] }), PAD_X, LANE_Y)).toBe(false);
  });
});
