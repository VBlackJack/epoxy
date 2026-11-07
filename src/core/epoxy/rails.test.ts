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
import { findRailConfigErrors, normalizeUnderlays } from '../../config/ConfigValidation';
import { PACK_JSON_MAX_VERSION, PACK_JSON_VERSION_V8, PACK_JSON_VERSION_V9, PACK_JSON_VERSION_V9_IDS, PACK_JSON_VERSION_V11 } from '../../config/constants';
import { tileAvailability } from '../../editor/paletteAvailability';
import { DatCodec, datRefusalReason } from '../../formats/DatCodec';
import en from '../../locales/en.json';
import fr from '../../locales/fr.json';
import { parsePackJson, serializePack } from '../../packs/packJson';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { isEdgeBlockedAt } from '../EdgeRules';
import { GameEngine } from '../GameEngine';
import { LevelValidator } from '../LevelValidator';
import { hasEpoxyOnlyContent, isEpoxyOnlyTileId, isRailTileId } from '../RulesetFeatures';
import { idSetVersionOf } from '../signalLinks';
import { Pathfinder } from '../Pathfinder';
import { traceLevelBeams } from './epoxyBeamTrace';
import { attemptPushBlock } from './epoxyBlocks';
import { railExitFacing } from './epoxyRails';
import type { EpoxyContext } from './epoxyWorld';
import type { CompiledLevel, Direction, EntityPlacement, TileDefinition } from '../types';

const SIZE = 11;
const CENTER = 5;
const TIME_LIMIT_SECONDS = 100;
const MAX_WAIT_TICKS = 40;
const MAX_FLIGHT_TICKS = 60;
const MONSTER_WALK_TICKS = 400;
const LAUNCHER_X = 3;
const TRIGGER = { x: 1, y: 8 };
const START = { x: 1, y: 9 };
const EMITTER_X = 2;
const SLIDE_SETTLE_TICKS = 60;
const OLDEST_FORMAT_WITHOUT_RAILS = PACK_JSON_VERSION_V8;

const NS = 'rail_ns';
const EW = 'rail_ew';
const NE = 'rail_ne';
const SE = 'rail_se';
const SW = 'rail_sw';
const NW = 'rail_nw';
const SWITCH_A = 'rail_switch_a';
const SWITCH_B = 'rail_switch_b';
const RAIL_IDS = [NS, EW, NE, SE, SW, NW, SWITCH_A, SWITCH_B];

/** Open sides of every rail piece, as the design lists them. */
const OPEN_SIDES: Record<string, Direction[]> = {
  [NS]: ['N', 'S'],
  [EW]: ['E', 'W'],
  [NE]: ['N', 'E'],
  [SE]: ['S', 'E'],
  [SW]: ['S', 'W'],
  [NW]: ['N', 'W'],
  [SWITCH_A]: ['S', 'E'],
  [SWITCH_B]: ['S', 'W']
};

const OPPOSITE: Record<Direction, Direction> = { N: 'S', S: 'N', W: 'E', E: 'W' };

interface Setup {
  /** Terrain edits: x, y, tile id. */
  terrain?: Array<[number, number, string]>;
  entities?: EntityPlacement[];
  player?: { x: number; y: number };
  launcher?: boolean;
}

/** Walled floor room, the player at (1, 9) unless told otherwise. */
function room(setup: Setup = {}): CompiledLevel {
  const terrain: string[][] = Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x) => (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? 'wall' : 'floor'))
  );
  if (setup.launcher) {
    terrain[CENTER][LAUNCHER_X] = 'shot_launcher_e';
    terrain[TRIGGER.y][TRIGGER.x] = 'shot_trigger';
  }
  for (const [x, y, id] of setup.terrain ?? []) terrain[y][x] = id;
  const player = setup.player ?? START;
  return {
    id: 'rail_room',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: TIME_LIMIT_SECONDS,
    chipsRequired: 0,
    playerStart: { ...player, dir: 'E' },
    terrain,
    items: Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null)),
    entities: setup.entities ?? [],
    trapLinks: [],
    cloneLinks: [],
    ...(setup.launcher
      ? { launcherLinks: [{ buttonX: TRIGGER.x, buttonY: TRIGGER.y, launcherX: LAUNCHER_X, launcherY: CENTER }] }
      : {})
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

/** Ticks until the player may move, then moves. */
function step(engine: GameEngine, dir: Direction): boolean {
  for (let waited = 0; waited <= MAX_WAIT_TICKS; waited++) {
    if (engine.getPlayer().moveCooldown === 0) return engine.attemptPlayerMove(dir);
    engine.tick();
  }
  throw new Error('the player never became able to move');
}

function terrainAt(engine: GameEngine, x: number, y: number): string {
  return engine.getTerrain()[y][x];
}

function at(engine: GameEngine): string {
  const { x, y } = engine.getPlayer();
  return `${x},${y}`;
}

function entityOf(engine: GameEngine, type: string): { x: number; y: number; dir: Direction } {
  const found = engine.getEntities().find((e) => e.type === type);
  if (!found) throw new Error(`no ${type}`);
  return found;
}

/** Fires the launcher, then ticks until no shot is left, returning the cells the first shot visited. */
function flight(engine: GameEngine): string[] {
  const trail: string[] = [];
  const note = (): void => {
    const shot = engine.getShots()?.[0];
    if (shot && trail[trail.length - 1] !== `${shot.x},${shot.y}`) trail.push(`${shot.x},${shot.y}`);
  };
  contextOf(engine).triggerButton(TRIGGER.x, TRIGGER.y, 'fire_launchers');
  note();
  for (let i = 0; i < MAX_FLIGHT_TICKS && (engine.getShots()?.length ?? 0) > 0; i++) {
    engine.tick();
    note();
  }
  return trail;
}

beforeEach(() => {
  loadTestConfigs();
});

describe('rails: configuration', () => {
  it('defines the eight pieces with their open sides, passable and see-through', () => {
    const names = { en, fr } as unknown as Record<string, { tiles: Record<string, { name: string; desc: { label: string } }> }>;
    for (const id of RAIL_IDS) {
      const tile = ConfigRegistry.getTile(id);
      expect(tile.category, id).toBe('mechanisms');
      expect(tile.layer, id).toBe('terrain');
      expect(tile.laserTransparent, id).toBe(true);
      expect(tile.passableByPlayer, id).toBe(true);
      expect(tile.passableByMonster, id).toBe(true);
      expect(tile.passableByBlock, id).toBe(true);
      expect(tile.blockedEdges, id).toBeUndefined();
      expect([...(tile.railSides ?? [])].sort(), id).toEqual([...OPEN_SIDES[id]].sort());
      for (const locale of [names.en, names.fr]) {
        expect(locale.tiles[id].name, id).toBeTruthy();
        expect(locale.tiles[id].desc.label, id).toBeTruthy();
      }
    }
  });

  it('names the pieces Straight Rail, Bent Rail and Rail Switch in English and Rail droit, Rail coude and Aiguillage in French', () => {
    const names = { en, fr } as unknown as Record<string, { tiles: Record<string, { name: string }> }>;
    for (const [id, base] of [[NS, 'Straight Rail'], [EW, 'Straight Rail'], [NE, 'Bent Rail'], [NW, 'Bent Rail'], [SWITCH_A, 'Rail Switch']]) {
      expect(names.en.tiles[id].name.startsWith(base), id).toBe(true);
    }
    for (const [id, base] of [[NS, 'Rail droit'], [EW, 'Rail droit'], [SE, 'Rail coudé'], [SW, 'Rail coudé'], [SWITCH_B, 'Aiguillage']]) {
      expect(names.fr.tiles[id].name.startsWith(base), id).toBe(true);
    }
  });

  it('pairs the two switches so the green button flips them, like toggle walls', () => {
    expect(ConfigRegistry.getTile(SWITCH_A).togglesTo).toBe(SWITCH_B);
    expect(ConfigRegistry.getTile(SWITCH_B).togglesTo).toBe(SWITCH_A);
    for (const id of [NS, EW, NE, SE, SW, NW]) expect(ConfigRegistry.getTile(id).togglesTo, id).toBeUndefined();
  });

  it('accepts the shipped rails and refuses malformed sides', () => {
    const tiles = ConfigRegistry.getTiles().tiles;
    expect(findRailConfigErrors(tiles)).toEqual([]);
    const withSides = (railSides: unknown): Record<string, TileDefinition> => ({
      ...tiles,
      [NS]: { ...tiles[NS], railSides } as TileDefinition
    });
    for (const bad of [[], ['N'], ['N', 'N'], ['N', 'S', 'E'], ['N', 'Q'], 'NS', null]) {
      expect(findRailConfigErrors(withSides(bad)).join(), JSON.stringify(bad)).toContain(`${NS}.railSides`);
    }
  });

  it('refuses a rail that closes sides another way or cannot be walked', () => {
    const tiles = ConfigRegistry.getTiles().tiles;
    const edit = (patch: Partial<TileDefinition>): Record<string, TileDefinition> => ({ ...tiles, [NS]: { ...tiles[NS], ...patch } });
    expect(findRailConfigErrors(edit({ blockedEdges: ['E'] })).join()).toContain('railSides alone');
    expect(findRailConfigErrors(edit({ passableByBlock: false })).join()).toContain('passable');
    expect(findRailConfigErrors(edit({ layer: 'item' })).join()).toContain('a rail is a terrain');
  });

  it('refuses a switch pair that does not point at each other or does not share exactly one side', () => {
    const tiles = ConfigRegistry.getTiles().tiles;
    const patched = (id: string, patch: Partial<TileDefinition>): Record<string, TileDefinition> => ({
      ...tiles,
      [id]: { ...tiles[id], ...patch }
    });
    expect(findRailConfigErrors(patched(SWITCH_B, { togglesTo: SWITCH_B })).join()).toContain('does not toggle back');
    expect(findRailConfigErrors(patched(SWITCH_B, { railSides: ['N', 'W'] })).join()).toContain('exactly 1 open side');
    expect(findRailConfigErrors(patched(SWITCH_B, { railSides: ['S', 'E'] })).join()).toContain('exactly 1 open side');
    expect(findRailConfigErrors(patched(SWITCH_A, { togglesTo: 'toggle_wall_closed' })).join()).toContain('is not a rail');
    expect(findRailConfigErrors(patched('toggle_wall_closed', { togglesTo: SWITCH_A })).join()).toContain('only a rail switch');
  });

  it('keeps rails out of underlays', () => {
    const terrain = [
      ['wall', 'wall', 'wall'],
      ['wall', 'dirt', 'wall'],
      ['wall', 'wall', 'wall']
    ];
    const hide = (terrainId: string) => normalizeUnderlays([{ x: 1, y: 1, terrain: terrainId }], terrain, 'epoxy');
    expect(hide('floor')).not.toBeNull();
    for (const id of RAIL_IDS) expect(hide(id), id).toBeNull();
  });
});

describe('rails: Epoxy-only gating and pack format 9', () => {
  it('is Epoxy-only: hidden from the Lynx palette, counted as Epoxy content', () => {
    for (const id of RAIL_IDS) {
      expect(isRailTileId(id), id).toBe(true);
      expect(isEpoxyOnlyTileId(id), id).toBe(true);
      expect(tileAvailability('lynx', id).available, id).toBe(false);
      expect(tileAvailability('epoxy', id).available, id).toBe(true);
    }
    expect(isRailTileId('floor')).toBe(false);
    expect(hasEpoxyOnlyContent(room())).toBe(false);
    expect(hasEpoxyOnlyContent(room({ terrain: [[CENTER, CENTER, NS]] }))).toBe(true);
  });

  it('refuses a rail level in a DAT export and leaves it out of the pack', () => {
    const railed = room({ terrain: [[CENTER, CENTER, NE]] });
    expect(datRefusalReason(railed)).toBe('epoxy_only_items');
    const encoded = DatCodec.encodeLevelsWithReport([railed, room()]);
    expect(encoded.refused.map((r) => r.reason)).toEqual(['epoxy_only_items']);
    expect(encoded.levelCount).toBe(1);
  });

  it('writes pack format 9 for a rail level and reads it back', () => {
    const version = (levels: CompiledLevel[]): number => JSON.parse(serializePack('N', levels)).version;
    expect(PACK_JSON_MAX_VERSION).toBe(PACK_JSON_VERSION_V11);
    expect([...PACK_JSON_VERSION_V9_IDS].sort()).toEqual([...RAIL_IDS].sort());
    for (const id of RAIL_IDS) {
      const level = room({ terrain: [[CENTER, CENTER, id]] });
      expect(idSetVersionOf(level), id).toBe(PACK_JSON_VERSION_V9);
      expect(version([level]), id).toBe(PACK_JSON_VERSION_V9);
    }
    expect(version([room()])).toBe(1);
    const text = serializePack('Rails', [room({ terrain: [[CENTER, CENTER, NE]] })]);
    const result = parsePackJson(text, ConfigRegistry.getLevelSizeBounds(), new Set<string>(), () => 8000);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.levels[0].terrain[CENTER][CENTER]).toBe(NE);
  });

  it('is refused by a build that reads pack format 8 at most', async () => {
    const text = serializePack('Rails', [room({ terrain: [[CENTER, CENTER, NS]] })]);
    expect(JSON.parse(text).version).toBeGreaterThan(OLDEST_FORMAT_WITHOUT_RAILS);
    vi.resetModules();
    vi.doMock('../../config/constants', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../../config/constants')>()),
      PACK_JSON_MAX_VERSION: OLDEST_FORMAT_WITHOUT_RAILS
    }));
    try {
      const older = await import('../../packs/packJson');
      expect(older.parsePackJson(text, ConfigRegistry.getLevelSizeBounds(), new Set<string>(), () => 8000)).toEqual({
        ok: false,
        error: 'version'
      });
    } finally {
      vi.doUnmock('../../config/constants');
      vi.resetModules();
    }
  });
});

describe('rails: edge rule', () => {
  it('closes every side a piece is not open on for walkers, and none for a beam', () => {
    for (const id of RAIL_IDS) {
      const terrain = [
        ['floor', 'floor', 'floor'],
        ['floor', id, 'floor'],
        ['floor', 'floor', 'floor']
      ];
      const open = OPEN_SIDES[id];
      const around: Array<[Direction, number, number]> = [
        ['N', 1, 0],
        ['S', 1, 2],
        ['W', 0, 1],
        ['E', 2, 1]
      ];
      for (const [side, nx, ny] of around) {
        const leaving = isEdgeBlockedAt(terrain, null, 1, 1, nx, ny, side);
        const entering = isEdgeBlockedAt(terrain, null, nx, ny, 1, 1, OPPOSITE[side]);
        expect(leaving, `${id} leave ${side}`).toBe(!open.includes(side));
        expect(entering, `${id} enter by ${side}`).toBe(!open.includes(side));
        expect(isEdgeBlockedAt(terrain, null, 1, 1, nx, ny, side, true), `${id} beam ${side}`).toBe(false);
        expect(isEdgeBlockedAt(terrain, null, nx, ny, 1, 1, OPPOSITE[side], true), `${id} beam in ${side}`).toBe(false);
      }
    }
  });

  it('faces a creature along the piece: the other open side, the same way on a straight', () => {
    const tiles = ConfigRegistry.getTiles().tiles;
    expect(railExitFacing(tiles[NS], 'S')).toBe('S');
    expect(railExitFacing(tiles[NS], 'N')).toBe('N');
    expect(railExitFacing(tiles[NE], 'S')).toBe('E');
    expect(railExitFacing(tiles[NE], 'W')).toBe('N');
    expect(railExitFacing(tiles[SW], 'E')).toBe('S');
    expect(railExitFacing(tiles[SW], 'N')).toBe('W');
    // Dropped in by a teleport or a clone machine through a closed side: the facing stays.
    expect(railExitFacing(tiles[NE], 'N')).toBeNull();
    expect(railExitFacing(tiles.floor, 'N')).toBeNull();
  });
});

describe('rails: the player', () => {
  it('enters a straight piece only through its open sides', () => {
    expect(step(load(room({ terrain: [[CENTER, CENTER, NS]], player: { x: CENTER, y: CENTER - 1 } })), 'S')).toBe(true);
    expect(step(load(room({ terrain: [[CENTER, CENTER, NS]], player: { x: CENTER, y: CENTER + 1 } })), 'N')).toBe(true);
    const fromWest = load(room({ terrain: [[CENTER, CENTER, NS]], player: { x: CENTER - 1, y: CENTER } }));
    expect(step(fromWest, 'E')).toBe(false);
    expect(at(fromWest)).toBe(`${CENTER - 1},${CENTER}`);
    const fromEast = load(room({ terrain: [[CENTER, CENTER, NS]], player: { x: CENTER + 1, y: CENTER } }));
    expect(step(fromEast, 'W')).toBe(false);
  });

  it('enters a bend through either open side, never through a closed one', () => {
    expect(step(load(room({ terrain: [[CENTER, CENTER, NE]], player: { x: CENTER, y: CENTER - 1 } })), 'S')).toBe(true);
    expect(step(load(room({ terrain: [[CENTER, CENTER, NE]], player: { x: CENTER + 1, y: CENTER } })), 'W')).toBe(true);
    expect(step(load(room({ terrain: [[CENTER, CENTER, NE]], player: { x: CENTER, y: CENTER + 1 } })), 'N')).toBe(false);
    expect(step(load(room({ terrain: [[CENTER, CENTER, NE]], player: { x: CENTER - 1, y: CENTER } })), 'E')).toBe(false);
  });

  it('leaves a bend by either open side and can back out the way it came', () => {
    const engine = load(room({ terrain: [[CENTER, CENTER, NE]], player: { x: CENTER, y: CENTER - 1 } }));
    expect(step(engine, 'S')).toBe(true);
    expect(step(engine, 'W')).toBe(false);
    expect(step(engine, 'S')).toBe(false);
    expect(step(engine, 'N')).toBe(true);
    expect(at(engine)).toBe(`${CENTER},${CENTER - 1}`);
    const around = load(room({ terrain: [[CENTER, CENTER, NE]], player: { x: CENTER, y: CENTER - 1 } }));
    expect(step(around, 'S')).toBe(true);
    expect(step(around, 'E')).toBe(true);
    expect(at(around)).toBe(`${CENTER + 1},${CENTER}`);
  });

  it('bounces a slide off a closed side instead of entering the piece', () => {
    const iceRow: Array<[number, number, string]> = [
      [2, CENTER, 'ice'],
      [3, CENTER, 'ice'],
      [4, CENTER, 'ice']
    ];
    const engine = load(room({ terrain: [...iceRow, [CENTER, CENTER, NS]], player: { x: 1, y: CENTER } }));
    expect(step(engine, 'E')).toBe(true);
    let enteredRail = false;
    for (let i = 0; i < SLIDE_SETTLE_TICKS; i++) {
      engine.tick();
      if (at(engine) === `${CENTER},${CENTER}`) enteredRail = true;
    }
    expect(enteredRail).toBe(false);
    expect(engine.getPlayer().x).toBeLessThan(CENTER);
    // Through an open side the same slide goes in.
    const open = load(room({ terrain: [...iceRow, [CENTER, CENTER, EW]], player: { x: 1, y: CENTER } }));
    expect(step(open, 'E')).toBe(true);
    let entered = false;
    for (let i = 0; i < SLIDE_SETTLE_TICKS; i++) {
      open.tick();
      if (open.getPlayer().x >= CENTER) entered = true;
    }
    expect(entered).toBe(true);
  });

  it('pushes a block along a piece and refuses to push it across', () => {
    const engine = load(
      room({
        terrain: [[CENTER, CENTER, EW]],
        entities: [{ type: 'dirt_block', x: CENTER - 1, y: CENTER, dir: 'E' }],
        player: { x: CENTER - 2, y: CENTER }
      })
    );
    expect(step(engine, 'E')).toBe(true);
    expect(entityOf(engine, 'dirt_block').x).toBe(CENTER);
    expect(step(engine, 'E')).toBe(true);
    expect(entityOf(engine, 'dirt_block').x).toBe(CENTER + 1);

    const across = load(
      room({
        terrain: [[CENTER, CENTER, NS]],
        entities: [{ type: 'dirt_block', x: CENTER - 1, y: CENTER, dir: 'E' }],
        player: { x: CENTER - 2, y: CENTER }
      })
    );
    expect(step(across, 'E')).toBe(false);
    expect(entityOf(across, 'dirt_block').x).toBe(CENTER - 1);
    expect(at(across)).toBe(`${CENTER - 2},${CENTER}`);

    // A block standing on a piece cannot be pushed out through a closed side either.
    const onRail = load(room({ terrain: [[CENTER, CENTER, NS]], entities: [{ type: 'dirt_block', x: CENTER, y: CENTER, dir: 'E' }] }));
    const block = onRail.getEntities().find((e) => e.type === 'dirt_block');
    if (!block) throw new Error('no block');
    expect(attemptPushBlock(contextOf(onRail), block, 'E')).toBe(false);
    expect(attemptPushBlock(contextOf(onRail), block, 'S')).toBe(true);
  });

  it('lets a teleport exit onto a piece only through an open side', () => {
    const landing = (id: string): { x: number; y: number } => {
      const engine = load(
        room({
          terrain: [
            [2, 2, 'teleport'],
            [8, 8, 'teleport'],
            [9, 8, id]
          ],
          player: { x: 1, y: 2 }
        })
      );
      expect(step(engine, 'E')).toBe(true);
      return { x: engine.getPlayer().x, y: engine.getPlayer().y };
    };
    // Open on the west side, where the pad is: the player comes out onto the piece.
    expect(landing(EW)).toEqual({ x: 9, y: 8 });
    // Closed on the west side: the exit tries the other sides of the pad and stays off the piece.
    expect(landing(NS)).not.toEqual({ x: 9, y: 8 });
  });

  it('spawns a clone through an open side only', () => {
    const cloned = (id: string): number => {
      const level = room({
        terrain: [
          [CENTER, 3, 'clone_machine'],
          [CENTER, 4, id],
          [2, 3, 'button_red']
        ],
        entities: [{ type: 'tank', x: CENTER, y: 3, dir: 'S' }]
      });
      level.cloneLinks = [{ buttonX: 2, buttonY: 3, clonerX: CENTER, clonerY: 3, templateType: 'tank', templateDir: 'S' }];
      const engine = load(level);
      contextOf(engine).triggerButton(2, 3, 'trigger_cloner');
      return engine.getEntities().filter((e) => e.type === 'tank').length;
    };
    expect(cloned(NS)).toBe(2);
    expect(cloned(EW)).toBe(1);
  });
});

describe('rails: switches', () => {
  it('flips with the green button, the player standing on it, who then leaves by an open side', () => {
    const engine = load(room({ terrain: [[CENTER, CENTER, SWITCH_A]], player: { x: CENTER, y: CENTER + 1 } }));
    // Come in by the south side, open on both forms.
    expect(step(engine, 'N')).toBe(true);
    expect(at(engine)).toBe(`${CENTER},${CENTER}`);
    contextOf(engine).triggerButton(1, 1, 'toggle_walls');
    expect(terrainAt(engine, CENTER, CENTER)).toBe(SWITCH_B);
    // The east side is closed now and the west side open.
    expect(step(engine, 'E')).toBe(false);
    expect(step(engine, 'W')).toBe(true);
    expect(at(engine)).toBe(`${CENTER - 1},${CENTER}`);
  });

  it('flips back and forth, together with the toggle walls', () => {
    const engine = load(room({ terrain: [[CENTER, CENTER, SWITCH_A], [7, 7, 'toggle_wall_closed']] }));
    contextOf(engine).triggerButton(1, 1, 'toggle_walls');
    expect(terrainAt(engine, CENTER, CENTER)).toBe(SWITCH_B);
    expect(terrainAt(engine, 7, 7)).toBe('toggle_wall_open');
    contextOf(engine).triggerButton(1, 1, 'toggle_walls');
    expect(terrainAt(engine, CENTER, CENTER)).toBe(SWITCH_A);
    expect(terrainAt(engine, 7, 7)).toBe('toggle_wall_closed');
  });

  it('flips when the player walks onto a green button, and undo puts the form back', () => {
    const engine = load(room({ terrain: [[CENTER, CENTER, SWITCH_A], [3, 8, 'button_green']], player: { x: 2, y: 8 } }));
    expect(step(engine, 'E')).toBe(true);
    expect(terrainAt(engine, CENTER, CENTER)).toBe(SWITCH_B);
    expect(engine.undo()).toBe(true);
    expect(terrainAt(engine, CENTER, CENTER)).toBe(SWITCH_A);
    expect(at(engine)).toBe('2,8');
  });
});

describe('rails: monsters', () => {
  /** The first tick at which the monster stands on the cell, or -1. */
  function reaches(engine: GameEngine, monster: string, x: number, y: number): number {
    for (let i = 0; i < MONSTER_WALK_TICKS; i++) {
      engine.tick();
      const found = engine.getEntities().find((e) => e.type === monster);
      if (found && found.x === x && found.y === y) return i;
    }
    return -1;
  }

  /**
   * A one-cell-wide corridor in solid wall: floor at (1..2, 5), a straight, the bend, then two straights going `exit`
   * (north or south) and a floor cell at the far end. The player waits in a sealed cell elsewhere.
   */
  function corridor(monster: string, exit: 'N' | 'S'): GameEngine {
    const level = room({ entities: [{ type: monster, x: 2, y: CENTER, dir: 'E' }], player: { x: 9, y: 9 } });
    level.terrain = level.terrain.map((row) => row.map(() => 'wall'));
    const sign = exit === 'N' ? -1 : 1;
    const cells: Array<[number, number, string]> = [
      [1, CENTER, 'floor'],
      [2, CENTER, 'floor'],
      [3, CENTER, EW],
      [4, CENTER, exit === 'N' ? NW : SW],
      [4, CENTER + sign, NS],
      [4, CENTER + 2 * sign, NS],
      [4, CENTER + 3 * sign, 'floor'],
      [9, 9, 'floor']
    ];
    for (const [x, y, id] of cells) level.terrain[y][x] = id;
    return load(level);
  }

  /** Where the corridor ends: the cell the monsters have to reach. */
  const END_NORTH = { x: 4, y: CENTER - 3 };
  const END_SOUTH = { x: 4, y: CENTER + 3 };

  it('turns a tank through a bend, where it would otherwise stand against the closed side', () => {
    const engine = corridor('tank', 'N');
    expect(reaches(engine, 'tank', END_NORTH.x, END_NORTH.y)).toBeGreaterThanOrEqual(0);
    expect(entityOf(engine, 'tank').dir).toBe('N');
  });

  it('turns a ball through a bend instead of bouncing in front of it', () => {
    expect(reaches(corridor('pink_ball', 'N'), 'pink_ball', END_NORTH.x, END_NORTH.y)).toBeGreaterThanOrEqual(0);
  });

  it('takes a bug through a bend with its own wall following, without turning it back', () => {
    expect(reaches(corridor('bug', 'N'), 'bug', END_NORTH.x, END_NORTH.y)).toBeGreaterThanOrEqual(0);
  });

  it('takes a bend that opens to the right as well', () => {
    for (const monster of ['tank', 'pink_ball', 'bug', 'paramecium', 'walker']) {
      expect(reaches(corridor(monster, 'S'), monster, END_SOUTH.x, END_SOUTH.y), monster).toBeGreaterThanOrEqual(0);
    }
  });

  it('faces a monster along the piece it arrives on', () => {
    const engine = corridor('tank', 'N');
    let facing: Direction | null = null;
    for (let i = 0; i < MONSTER_WALK_TICKS && facing === null; i++) {
      engine.tick();
      const tank = entityOf(engine, 'tank');
      if (tank.x === 4 && tank.y === CENTER) facing = tank.dir;
    }
    expect(facing).toBe('N');
  });

  it('keeps a monster off a piece it meets by a closed side', () => {
    const engine = load(room({ terrain: [[4, CENTER, NS]], entities: [{ type: 'tank', x: 2, y: CENTER, dir: 'E' }] }));
    for (let i = 0; i < MONSTER_WALK_TICKS; i++) engine.tick();
    expect(entityOf(engine, 'tank').x).toBe(3);
  });
});

describe('rails: beams and shots', () => {
  const beamKeys = (engine: GameEngine): string[] => engine.getBeamCells().map((c) => `${c.x},${c.y}`);

  it('lets a laser beam pass through a piece whatever its open sides', () => {
    for (const id of RAIL_IDS) {
      const engine = load(room({ terrain: [[EMITTER_X, CENTER, 'laser_emitter_e'], [CENTER, CENTER, id]] }));
      expect(beamKeys(engine), id).toContain(`${CENTER},${CENTER}`);
      expect(beamKeys(engine), id).toContain(`${CENTER + 1},${CENTER}`);
    }
  });

  it('lets a shot fly through a piece whatever its open sides', () => {
    for (const id of RAIL_IDS) {
      const trail = flight(load(room({ launcher: true, terrain: [[CENTER, CENTER, id]] })));
      expect(trail, id).toContain(`${CENTER},${CENTER}`);
      expect(trail, id).toContain(`${CENTER + 1},${CENTER}`);
    }
  });

  it('lets a turret beam pass through a piece', () => {
    const turret: EntityPlacement = { type: 'turret_fixed', x: 3, y: CENTER, dir: 'E' };
    for (const id of [NS, NW]) {
      const level = room({ terrain: [[4, CENTER, id]], entities: [turret] });
      const cells = traceLevelBeams(level, { armTurrets: true }).turretCells.map((c) => `${c.x},${c.y}`);
      expect(cells, id).toContain('4,5');
      expect(cells, id).toContain('5,5');
    }
  });

  it('does not report a launcher facing a piece as facing a wall', () => {
    const level = room({ launcher: true, terrain: [[LAUNCHER_X + 1, CENTER, NS]] });
    const keys = LevelValidator.validate(level).issues.map((i) => i.i18nKey);
    expect(keys).not.toContain('validator.issues.shot_launcher_faces_wall.label');
  });
});

describe('rails: validator and pathfinder', () => {
  const CODES: Record<string, string> = { '#': 'wall', '.': 'floor', P: 'floor', E: 'exit', b: 'button_green', s: SWITCH_A, '|': NS };

  /** A one-row corridor level from a picture; the player starts at P. */
  function corridorLevel(picture: string): CompiledLevel {
    const level = room();
    const row = [...picture];
    level.terrain = [row.map(() => 'wall'), row.map((ch) => CODES[ch]), row.map(() => 'wall')];
    level.items = level.terrain.map((r) => r.map(() => null));
    level.playerStart = { x: row.indexOf('P'), y: 1, dir: 'E' };
    return level;
  }

  const unreachable = (level: CompiledLevel): boolean =>
    LevelValidator.validate(level).issues.some((i) => i.i18nKey.startsWith('validator.issues.unreachable_exit'));

  /**
   * The exit sits west of the switch and the player comes up from its south side, open in both forms. The switch
   * starts open on S and E, so the way west only opens after the green button flips it to S and W.
   */
  const SWITCH_PICTURE = ['#####', '#Es##', '##.##', '#b.P#', '#####'];
  const SWITCH_CODES: Record<string, string> = { '#': 'wall', E: 'exit', s: SWITCH_A, '.': 'floor', P: 'floor', b: 'button_green' };

  function switchLevel(withButton: boolean): CompiledLevel {
    const level = room();
    level.terrain = SWITCH_PICTURE.map((row) => [...row].map((ch) => (ch === 'b' && !withButton ? 'floor' : SWITCH_CODES[ch])));
    level.items = level.terrain.map((r) => r.map(() => null));
    level.playerStart = { x: 3, y: 3, dir: 'W' };
    return level;
  }

  it('wins a switch level only after the green button, and the validator reports no unreachable exit', () => {
    expect(unreachable(switchLevel(true))).toBe(false);
    const engine = load(switchLevel(true));
    for (const dir of ['W', 'W'] as const) expect(step(engine, dir)).toBe(true);
    expect(terrainAt(engine, 2, 1)).toBe(SWITCH_B);
    for (const dir of ['E', 'N', 'N', 'W'] as const) expect(step(engine, dir)).toBe(true);
    expect(at(engine)).toBe('1,1');
    // Without the button press the west side stays closed.
    const stuck = load(switchLevel(false));
    for (const dir of ['W', 'N', 'N'] as const) expect(step(stuck, dir)).toBe(true);
    expect(step(stuck, 'W')).toBe(false);
  });

  it('over-approximates: a switch level with no green button at all is not reported as unreachable', () => {
    expect(unreachable(switchLevel(false))).toBe(false);
  });

  it('points the objective marker to the green button when only a rail switch needs it', () => {
    expect(Pathfinder.findNextObjective(load(switchLevel(true)))).toEqual({ x: 1, y: 3 });
  });

  it('still reports an exit sealed by a straight rail seen from its closed side', () => {
    expect(unreachable(corridorLevel('#P.|.E#'))).toBe(true);
    expect(unreachable(corridorLevel('#P...E#'))).toBe(false);
  });

  it('plans a path through the open sides of a straight and no path through a closed one', () => {
    const open = load(room({ terrain: [[4, 5, EW]], player: { x: 3, y: 5 } }));
    expect(Pathfinder.findPath(open, 6, 5).moves).toEqual(['E', 'E', 'E']);
    const shut = load(room({ terrain: [[4, 5, NS]], player: { x: 3, y: 5 } }));
    const { moves } = Pathfinder.findPath(shut, 5, 5);
    // Walk the whole path and check no step enters or leaves a rail through a closed side.
    let [x, y] = [3, 5];
    for (const dir of moves) {
      const vec = { N: [0, -1], S: [0, 1], W: [-1, 0], E: [1, 0] }[dir];
      const terrain = shut.getTerrain();
      expect(isEdgeBlockedAt(terrain, null, x, y, x + vec[0], y + vec[1], dir)).toBe(false);
      x += vec[0];
      y += vec[1];
    }
    expect([x, y]).toEqual([5, 5]);
  });

  it('flips a switch under a monster and under a block, both leave by an open side, and undo restores', () => {
    const ctxFlip = (engine: GameEngine): void => {
      contextOf(engine).triggerButton(1, 1, 'toggle_walls');
    };
    const block = load(
      room({ terrain: [[CENTER, CENTER, SWITCH_A]], entities: [{ type: 'dirt_block', x: CENTER, y: CENTER, dir: 'E' }] })
    );
    const piece = block.getEntities().find((e) => e.type === 'dirt_block');
    if (!piece) throw new Error('no block');
    expect(step(block, 'N')).toBe(true);
    ctxFlip(block);
    expect(terrainAt(block, CENTER, CENTER)).toBe(SWITCH_B);
    expect(attemptPushBlock(contextOf(block), piece, 'E')).toBe(false);
    expect(attemptPushBlock(contextOf(block), piece, 'W')).toBe(true);
    expect(block.undo()).toBe(true);
    expect(terrainAt(block, CENTER, CENTER)).toBe(SWITCH_A);
    expect(entityOf(block, 'dirt_block').x).toBe(CENTER);

    const monster = load(
      room({ terrain: [[CENTER, CENTER, SWITCH_A]], entities: [{ type: 'tank', x: CENTER, y: CENTER, dir: 'W' }] })
    );
    // Facing west, closed in the starting form: the tank cannot leave.
    for (let i = 0; i < MONSTER_WALK_TICKS / 10; i++) monster.tick();
    expect(entityOf(monster, 'tank').x).toBe(CENTER);
    expect(step(monster, 'N')).toBe(true);
    ctxFlip(monster);
    expect(terrainAt(monster, CENTER, CENTER)).toBe(SWITCH_B);
    for (let i = 0; i < MONSTER_WALK_TICKS / 10; i++) monster.tick();
    expect(entityOf(monster, 'tank').x).toBeLessThan(CENTER);
    expect(monster.undo()).toBe(true);
    expect(terrainAt(monster, CENTER, CENTER)).toBe(SWITCH_A);
    expect(entityOf(monster, 'tank').x).toBe(CENTER);
  });
});
