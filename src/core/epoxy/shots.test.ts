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
import {
  findShotConfigErrors,
  isCompiledLevelShape,
  normalizeLauncherLinks,
  stripInvalidTextFields
} from '../../config/ConfigValidation';
import en from '../../locales/en.json';
import fr from '../../locales/fr.json';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { BlockPuzzleSolver } from '../BlockPuzzleSolver';
import { MIRROR_FRONT_AXIS, MIRROR_FRONT_SIDES, OPPOSITE_DIRECTION, reflectOnMirror } from '../coreConstants';
import { GameEngine } from '../GameEngine';
import { featuresFor, hasLaserContent, isEpoxyOnlyEntityType, isEpoxyOnlyTileId } from '../RulesetFeatures';
import { DIRECTION_VECTORS } from '../../config/constants';
import { canMonsterEnter } from './epoxyMonsters';
import { shotsStateKey } from './epoxyShots';
import type { EpoxyContext, EpoxyWorld } from './epoxyWorld';
import type { CellEdge, CompiledLevel, Direction, EntityPlacement, LauncherLink, MirrorCorner } from '../types';

const SIZE = 11;
const LANE_Y = 5;
const LAUNCHER_X = 3;
const FIRST_CELL_X = 4;
const TRIGGER = { x: 1, y: 8 };
const START = { x: 1, y: 9 };
const FAR_CORNER = { x: 9, y: 9 };
const TIME_LIMIT_SECONDS = 100;
const STEP_TICKS = 2;
const MAX_FLIGHT_TICKS = 60;
const MAX_WAIT_TICKS = 30;
const IDLE_MONSTER_COOLDOWN = 100000;
const FLOOR = 'floor';
const LAUNCHER_E = 'shot_launcher_e';
const TRIGGER_TILE = 'shot_trigger';
const MIRROR_CELL = { x: 5, y: 5 };
const MIRROR_LAUNCHER_DISTANCE = 2;

const DEFAULT_LINK: LauncherLink = { buttonX: TRIGGER.x, buttonY: TRIGGER.y, launcherX: LAUNCHER_X, launcherY: LANE_Y };

interface Setup {
  /** Terrain edits: x, y, tile id. */
  terrain?: Array<[number, number, string]>;
  /** Item edits: x, y, item id. */
  items?: Array<[number, number, string]>;
  entities?: EntityPlacement[];
  /** The links; the default is one link from the trigger to the launcher. */
  links?: LauncherLink[];
  cloneLinks?: CompiledLevel['cloneLinks'];
  cellEdges?: CellEdge[];
  player?: { x: number; y: number; dir?: Direction };
  /** Leaves the launcher and the trigger out: a level without shots. */
  noLauncher?: boolean;
}

/** Walled floor room with an east launcher on the lane and a trigger near the player's start. */
function room(setup: Setup = {}): CompiledLevel {
  const terrain: string[][] = Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x) => (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? 'wall' : FLOOR))
  );
  if (!setup.noLauncher) {
    terrain[LANE_Y][LAUNCHER_X] = LAUNCHER_E;
    terrain[TRIGGER.y][TRIGGER.x] = TRIGGER_TILE;
  }
  for (const [x, y, id] of setup.terrain ?? []) terrain[y][x] = id;
  const items: (string | null)[][] = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null));
  for (const [x, y, id] of setup.items ?? []) items[y][x] = id;
  const player: { x: number; y: number; dir?: Direction } = setup.player ?? START;
  const links = setup.noLauncher ? [] : (setup.links ?? [DEFAULT_LINK]);
  return {
    id: 'shot_room',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: TIME_LIMIT_SECONDS,
    chipsRequired: 0,
    playerStart: { x: player.x, y: player.y, dir: player.dir ?? 'N' },
    terrain,
    items,
    entities: setup.entities ?? [],
    trapLinks: [],
    cloneLinks: setup.cloneLinks ?? [],
    ...(setup.cellEdges ? { cellEdges: setup.cellEdges } : {}),
    ...(links.length > 0 ? { launcherLinks: links } : {})
  };
}

function load(level: CompiledLevel): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(level);
  return engine;
}

function world(engine: GameEngine): EpoxyWorld {
  return (engine as unknown as { w: EpoxyWorld }).w;
}

function context(engine: GameEngine): EpoxyContext {
  return (engine as unknown as { ctx: EpoxyContext }).ctx;
}

/** Works the trigger the way a button does, without anyone standing on it. */
function fire(engine: GameEngine, x = TRIGGER.x, y = TRIGGER.y): boolean {
  return context(engine).triggerButton(x, y, 'fire_launchers');
}

function run(engine: GameEngine, count: number): void {
  for (let i = 0; i < count; i++) engine.tick();
}

/** Ticks until the player may move, then moves. */
function step(engine: GameEngine, dir: Direction): boolean {
  for (let waited = 0; waited <= MAX_WAIT_TICKS; waited++) {
    if (engine.getPlayer().moveCooldown === 0) return engine.attemptPlayerMove(dir);
    engine.tick();
  }
  throw new Error('the player never became able to move');
}

function shotsOf(engine: GameEngine): string[] {
  return (engine.getShots() ?? []).map((s) => `${s.x},${s.y},${s.dir}`);
}

/** Fires, then ticks until no shot is left, returning the cells the first shot visited (the first cell included). */
function flight(engine: GameEngine): string[] {
  const trail: string[] = [];
  const note = (): void => {
    const shot = engine.getShots()?.[0];
    if (shot && trail[trail.length - 1] !== `${shot.x},${shot.y}`) trail.push(`${shot.x},${shot.y}`);
  };
  fire(engine);
  note();
  for (let i = 0; i < MAX_FLIGHT_TICKS && (engine.getShots()?.length ?? 0) > 0 && engine.getPlayer().alive; i++) {
    engine.tick();
    note();
  }
  return trail;
}

/** A monster that never moves in a test: its next move is far off. */
function idle(engine: GameEngine, type: string): void {
  for (const entity of engine.getEntities()) if (entity.type === type) entity.cooldownTicks = IDLE_MONSTER_COOLDOWN;
}

function placed(type: string, x: number, y: number, dir: Direction = 'E'): EntityPlacement {
  return { type, x, y, dir };
}

function has(engine: GameEngine, type: string): boolean {
  return engine.getEntities().some((e) => e.type === type);
}

beforeEach(() => {
  loadTestConfigs();
});

describe('shots: configuration', () => {
  it('defines four launchers that block both movement and laser light, and a trigger that is open ground', () => {
    const expected: Array<[string, Direction]> = [
      ['shot_launcher_n', 'N'],
      ['shot_launcher_e', 'E'],
      ['shot_launcher_s', 'S'],
      ['shot_launcher_w', 'W']
    ];
    for (const [id, dir] of expected) {
      const tile = ConfigRegistry.getTile(id);
      expect(tile.shotLauncher, id).toEqual({ dir, stepTicks: STEP_TICKS });
      expect(tile.passableByPlayer, id).toBe(false);
      expect(tile.passableByMonster, id).toBe(false);
      expect(tile.passableByBlock, id).toBe(false);
      expect(tile.laserTransparent, id).toBe(false);
    }
    const trigger = ConfigRegistry.getTile(TRIGGER_TILE);
    expect(trigger.buttonAction).toBe('fire_launchers');
    expect(trigger.laserTransparent).toBe(true);
    expect(trigger.buttonWorkedBy).toBeUndefined();
    expect(findShotConfigErrors(ConfigRegistry.getTiles().tiles, ConfigRegistry.getMonsters().entities)).toEqual([]);
  });

  it('defines four one-sided mirrors whose axis matches the corner they face', () => {
    const corners: Array<[string, MirrorCorner]> = [
      ['one_sided_mirror_ne', 'NE'],
      ['one_sided_mirror_nw', 'NW'],
      ['one_sided_mirror_se', 'SE'],
      ['one_sided_mirror_sw', 'SW']
    ];
    for (const [id, corner] of corners) {
      const def = ConfigRegistry.getEntityDef(id);
      expect(def?.kind, id).toBe('block');
      expect(def?.pushable, id).toBe(true);
      expect(def?.mirrorFrontCorner, id).toBe(corner);
      expect(def?.mirrorAxis, id).toBe(MIRROR_FRONT_AXIS[corner]);
    }
    expect(ConfigRegistry.getEntityDef('mirror_slash')?.mirrorFrontCorner).toBeUndefined();
    expect(ConfigRegistry.getEntityDef('mirror_backslash')?.mirrorFrontCorner).toBeUndefined();
  });

  it('declares the shot effect of ice blocks and turrets in the data', () => {
    expect(ConfigRegistry.getEntityDef('ice_block')?.shotEffect).toBe('melt');
    for (const id of ['turret_fixed', 'turret_cw', 'turret_ccw', 'turret_multi']) {
      expect(ConfigRegistry.getEntityDef(id)?.shotEffect, id).toBe('destroy');
    }
  });

  it('names the launchers, the trigger and the one-sided mirrors in both languages, in French with its accents', () => {
    const tileIds = ['shot_launcher_n', 'shot_launcher_e', 'shot_launcher_s', 'shot_launcher_w', 'shot_trigger'];
    const entityIds = ['one_sided_mirror_ne', 'one_sided_mirror_nw', 'one_sided_mirror_se', 'one_sided_mirror_sw'];
    for (const locale of [en, fr] as Array<{ tiles: Record<string, { name: string }>; entities: Record<string, { name: string }> }>) {
      for (const id of tileIds) expect(locale.tiles[id]?.name, id).toBeTruthy();
      for (const id of entityIds) expect(locale.entities[id]?.name, id).toBeTruthy();
    }
    expect(en.tiles.shot_launcher_n.name).toContain('Shot Launcher');
    expect(en.tiles.shot_trigger.name).toBe('Shot Trigger');
    expect(en.entities.one_sided_mirror_ne.name).toContain('One-Sided Mirror');
    expect(fr.tiles.shot_launcher_n.name).toContain('Lanceur de tirs');
    expect(fr.tiles.shot_trigger.name).toBe('Déclencheur de tir');
    expect(fr.entities.one_sided_mirror_ne.name).toContain('Miroir à une face');
  });

  it('rejects malformed shot fields', () => {
    const tiles = structuredClone(ConfigRegistry.getTiles().tiles);
    const entities = structuredClone(ConfigRegistry.getMonsters().entities);
    tiles.shot_launcher_n.shotLauncher = { dir: 'X' as Direction, stepTicks: STEP_TICKS };
    tiles.shot_launcher_e.shotLauncher = { dir: 'E', stepTicks: 0 };
    tiles.shot_launcher_s.shotLauncher = { dir: 'S', stepTicks: STEP_TICKS + 1 };
    tiles.shot_launcher_w.laserTransparent = true;
    entities.one_sided_mirror_ne.mirrorAxis = 'slash';
    entities.one_sided_mirror_nw.mirrorFrontCorner = 'XX' as MirrorCorner;
    entities.mirror_slash.shotEffect = 'melt';
    entities.dirt_block.shotEffect = 'reflect';
    entities.bug.shotEffect = 'explode' as never;
    const errors = findShotConfigErrors(tiles, entities).join('\n');
    expect(errors).toContain('shot_launcher_n.shotLauncher.dir');
    expect(errors).toContain('shot_launcher_e.shotLauncher.stepTicks');
    expect(errors).toContain('every launcher must declare the same count');
    expect(errors).toContain('shot_launcher_w.shotLauncher: a launcher cannot be laser transparent');
    expect(errors).toContain('one_sided_mirror_ne.mirrorFrontCorner');
    expect(errors).toContain('one_sided_mirror_nw.mirrorFrontCorner: expected NE, NW, SE or SW');
    expect(errors).toContain('mirror_slash.shotEffect: a melt needs meltsInFireTo');
    expect(errors).toContain('dirt_block.shotEffect: only a mirror reflects a shot');
    expect(errors).toContain('bug.shotEffect');
  });

  it('counts launchers and triggers as laser content that only the Epoxy engine plays', () => {
    const level = room();
    expect(hasLaserContent(level)).toBe(true);
    expect(featuresFor(level).blockHint).toBe(false);
    expect(featuresFor(level).deadEndWatch).toBe(false);
    expect(featuresFor(level).tapToPath).toBe(true);
    for (const id of ['shot_launcher_n', 'shot_launcher_e', 'shot_launcher_s', 'shot_launcher_w', TRIGGER_TILE]) {
      expect(isEpoxyOnlyTileId(id), id).toBe(true);
    }
    for (const id of ['one_sided_mirror_ne', 'one_sided_mirror_nw', 'one_sided_mirror_se', 'one_sided_mirror_sw']) {
      expect(isEpoxyOnlyEntityType(id), id).toBe(true);
    }
    expect(hasLaserContent(room({ noLauncher: true }))).toBe(false);
  });
});

describe('shots: mirror reflection table', () => {
  // Written out by hand from the settled rule: the corner names the two sides a shot may enter through.
  const table: Array<[MirrorCorner, Direction, Direction | null]> = [
    ['NE', 'S', 'E'],
    ['NE', 'W', 'N'],
    ['NE', 'E', null],
    ['NE', 'N', null],
    ['SW', 'N', 'W'],
    ['SW', 'E', 'S'],
    ['SW', 'S', null],
    ['SW', 'W', null],
    ['NW', 'S', 'W'],
    ['NW', 'E', 'N'],
    ['NW', 'N', null],
    ['NW', 'W', null],
    ['SE', 'N', 'E'],
    ['SE', 'W', 'S'],
    ['SE', 'S', null],
    ['SE', 'E', null]
  ];

  it('turns a shot that enters through a front side and refuses one that meets the back', () => {
    for (const [corner, dir, expected] of table) {
      expect(reflectOnMirror(MIRROR_FRONT_AXIS[corner], corner, dir), `${corner} ${dir}`).toBe(expected);
    }
  });

  it('turns a shot on both faces of a two-faced mirror, as before', () => {
    expect(reflectOnMirror('slash', undefined, 'E')).toBe('N');
    expect(reflectOnMirror('slash', undefined, 'W')).toBe('S');
    expect(reflectOnMirror('backslash', undefined, 'E')).toBe('S');
    expect(reflectOnMirror('backslash', undefined, 'W')).toBe('N');
  });

  it('keeps each corner in the sides that meet at it', () => {
    for (const corner of Object.keys(MIRROR_FRONT_SIDES) as MirrorCorner[]) {
      expect(MIRROR_FRONT_SIDES[corner]).toHaveLength(2);
      for (const side of MIRROR_FRONT_SIDES[corner]) expect(corner).toContain(side);
    }
  });

  it('plays every case of the table in the engine: the front turns the shot, the back destroys both', () => {
    for (const [corner, dir, expected] of table) {
      const vec = DIRECTION_VECTORS[dir];
      const launcherX = MIRROR_CELL.x - vec.dx * MIRROR_LAUNCHER_DISTANCE;
      const launcherY = MIRROR_CELL.y - vec.dy * MIRROR_LAUNCHER_DISTANCE;
      const launcherId = `shot_launcher_${dir.toLowerCase()}`;
      const mirrorType = `one_sided_mirror_${corner.toLowerCase()}`;
      const engine = load(
        room({
          terrain: [[launcherX, launcherY, launcherId]],
          entities: [placed(mirrorType, MIRROR_CELL.x, MIRROR_CELL.y)],
          links: [{ ...DEFAULT_LINK, launcherX, launcherY }],
          player: FAR_CORNER
        })
      );
      const trail = flight(engine);
      const label = `${corner} ${dir}`;
      if (expected === null) {
        expect(has(engine, mirrorType), `${label} destroyed`).toBe(false);
        expect(trail, label).not.toContain(`${MIRROR_CELL.x},${MIRROR_CELL.y}`);
        expect(trail[trail.length - 1], label).toBe(`${MIRROR_CELL.x - vec.dx},${MIRROR_CELL.y - vec.dy}`);
      } else {
        const out = DIRECTION_VECTORS[expected];
        expect(has(engine, mirrorType), `${label} kept`).toBe(true);
        expect(trail, label).toContain(`${MIRROR_CELL.x},${MIRROR_CELL.y}`);
        expect(trail, label).toContain(`${MIRROR_CELL.x + out.dx},${MIRROR_CELL.y + out.dy}`);
      }
      expect(engine.getShots(), label).toEqual([]);
    }
  });
});

describe('shots: firing', () => {
  it('fires one shot per press, which enters the cell in front of the launcher at once', () => {
    const engine = load(room());
    expect(engine.getShots()).toEqual([]);
    expect(engine.attemptPlayerMove('N')).toBe(true);
    expect(engine.getPlayer()).toMatchObject({ x: TRIGGER.x, y: TRIGGER.y });
    expect(shotsOf(engine)).toEqual([`${FIRST_CELL_X},${LANE_Y},E`]);
  });

  it('crosses one cell per two ticks', () => {
    const engine = load(room({ player: FAR_CORNER }));
    fire(engine);
    const positions: number[] = [];
    for (let i = 0; i < 6; i++) {
      positions.push(engine.getShots()?.[0]?.x ?? -1);
      engine.tick();
    }
    expect(positions).toEqual([4, 4, 5, 5, 6, 6]);
  });

  it('keeps the same pace for a shot fired in the middle of a tick', () => {
    const engine = load(
      room({ entities: [placed('pink_ball', TRIGGER.x, TRIGGER.y - 2, 'S')], player: FAR_CORNER })
    );
    let ticks = 0;
    while ((engine.getShots()?.length ?? 0) === 0 && ticks < MAX_FLIGHT_TICKS) {
      engine.tick();
      ticks++;
    }
    expect(ticks).toBeLessThan(MAX_FLIGHT_TICKS);
    const positions: number[] = [];
    for (let i = 0; i < 6; i++) {
      positions.push(engine.getShots()?.[0]?.x ?? -1);
      engine.tick();
    }
    expect(positions).toEqual([4, 4, 5, 5, 6, 6]);
  });

  it('fires a launcher at most once per tick, and again in the next one', () => {
    const engine = load(room({ player: FAR_CORNER }));
    expect(fire(engine)).toBe(true);
    expect(fire(engine)).toBe(true);
    expect(engine.getShots()).toHaveLength(1);
    engine.tick();
    fire(engine);
    expect(engine.getShots()).toHaveLength(2);
  });

  it('fires a launcher once when two links name it', () => {
    const engine = load(room({ links: [DEFAULT_LINK, { ...DEFAULT_LINK }], player: FAR_CORNER }));
    fire(engine);
    expect(engine.getShots()).toHaveLength(1);
  });

  it('does nothing for a trigger without a link', () => {
    const engine = load(room({ links: [], player: FAR_CORNER }));
    expect(engine.getShots()).toEqual([]);
    expect(fire(engine)).toBe(true);
    expect(engine.getShots()).toEqual([]);
    const walked = load(room({ links: [] }));
    expect(walked.attemptPlayerMove('N')).toBe(true);
    expect(walked.getShots()).toEqual([]);
  });

  it('ignores the link of another trigger', () => {
    const engine = load(room({ player: FAR_CORNER }));
    fire(engine, TRIGGER.x + 1, TRIGGER.y);
    expect(engine.getShots()).toEqual([]);
  });

  it('fires every launcher a trigger is linked to', () => {
    const engine = load(
      room({
        terrain: [[8, 8, 'shot_launcher_w']],
        links: [DEFAULT_LINK, { ...DEFAULT_LINK, launcherX: 8, launcherY: 8 }],
        player: FAR_CORNER
      })
    );
    fire(engine);
    expect(shotsOf(engine).sort()).toEqual([`${FIRST_CELL_X},${LANE_Y},E`, '7,8,W'].sort());
  });

  it('stays silent when the launcher cell no longer holds a launcher', () => {
    const engine = load(room({ player: FAR_CORNER }));
    world(engine).terrain[LANE_Y][LAUNCHER_X] = FLOOR;
    fire(engine);
    expect(engine.getShots()).toEqual([]);
  });

  it('fires when a block is pushed onto the trigger', () => {
    const engine = load(room({ entities: [placed('dirt_block', TRIGGER.x, TRIGGER.y - 1, 'S')], player: { x: TRIGGER.x, y: TRIGGER.y - 2 } }));
    expect(engine.attemptPlayerMove('S')).toBe(true);
    expect(shotsOf(engine)).toEqual([`${FIRST_CELL_X},${LANE_Y},E`]);
  });

  it('fires when a monster steps onto the trigger', () => {
    const engine = load(room({ entities: [placed('pink_ball', TRIGGER.x, TRIGGER.y - 2, 'S')], player: FAR_CORNER }));
    for (let i = 0; i < MAX_FLIGHT_TICKS && (engine.getShots()?.length ?? 0) === 0; i++) engine.tick();
    expect(shotsOf(engine)).toEqual([`${FIRST_CELL_X},${LANE_Y},E`]);
  });

  it('has no shot to report on a level without launchers', () => {
    const engine = load(room({ noLauncher: true }));
    expect(engine.getShots()).toBeUndefined();
    expect(engine.captureState().shots).toBeUndefined();
    expect(shotsStateKey(engine.getShots())).toBe('');
  });
});

describe('shots: what a shot does to what it meets', () => {
  const FAR_FROM_LANE = FAR_CORNER;
  const BEYOND = { x: 8, y: LANE_Y };

  it('kills a monster in its way and goes no further', () => {
    const engine = load(room({ entities: [placed('bug', 7, LANE_Y), placed('bug', BEYOND.x, BEYOND.y)], player: FAR_FROM_LANE }));
    idle(engine, 'bug');
    flight(engine);
    expect(engine.getEntities().map((e) => e.x)).toEqual([BEYOND.x]);
    expect(engine.getShots()).toEqual([]);
  });

  it('kills a puppet', () => {
    const engine = load(room({ entities: [placed('puppet', 7, LANE_Y)], player: FAR_FROM_LANE }));
    flight(engine);
    expect(engine.getEntities()).toEqual([]);
  });

  it('kills the player it meets, with the laser death', () => {
    const engine = load(room({ player: { x: 8, y: LANE_Y } }));
    flight(engine);
    expect(engine.getPlayer().alive).toBe(false);
    expect(engine.getPlayer().deathReasonKey).toBe('hud.messages.death_laser');
    expect(engine.getShots()).toEqual([]);
  });

  it('kills the player in the first cell at once', () => {
    const engine = load(room({ player: { x: FIRST_CELL_X, y: LANE_Y } }));
    expect(fire(engine)).toBe(false);
    expect(engine.getPlayer().alive).toBe(false);
    expect(engine.getShots()).toEqual([]);
  });

  it('is stopped by a wall, a closed door and a socket, and harms nothing beyond', () => {
    for (const id of ['wall', 'door_red', 'socket', 'clone_machine']) {
      const engine = load(room({ terrain: [[6, LANE_Y, id]], entities: [placed('bug', 8, LANE_Y)], player: FAR_FROM_LANE }));
      idle(engine, 'bug');
      const trail = flight(engine);
      expect(trail, id).toEqual(['4,5', '5,5']);
      expect(has(engine, 'bug'), id).toBe(true);
      expect(engine.getTerrain()[LANE_Y][6], id).toBe(id);
    }
  });

  it('is stopped by a thin wall on either side of the edge it crosses', () => {
    const crossing: CellEdge[][] = [[{ x: 5, y: LANE_Y, sides: ['E'] }], [{ x: 6, y: LANE_Y, sides: ['W'] }]];
    for (const edges of crossing) {
      const engine = load(room({ cellEdges: edges, entities: [placed('bug', 8, LANE_Y)], player: FAR_FROM_LANE }));
      idle(engine, 'bug');
      expect(flight(engine)).toEqual(['4,5', '5,5']);
      expect(has(engine, 'bug')).toBe(true);
    }
  });

  it('is stopped by an item, which stays where it is', () => {
    const engine = load(room({ items: [[6, LANE_Y, 'key_red']], player: FAR_FROM_LANE }));
    expect(flight(engine)).toEqual(['4,5', '5,5']);
    expect(engine.getItems()[LANE_Y][6]).toBe('key_red');
  });

  it('is stopped by another launcher, which is not harmed', () => {
    const engine = load(room({ terrain: [[6, LANE_Y, 'shot_launcher_s']], player: FAR_FROM_LANE }));
    expect(flight(engine)).toEqual(['4,5', '5,5']);
    expect(engine.getTerrain()[LANE_Y][6]).toBe('shot_launcher_s');
  });

  it('sets a bomb item off and is spent with it', () => {
    const engine = load(room({ items: [[6, LANE_Y, 'bomb']], entities: [placed('bug', 8, LANE_Y)], player: FAR_FROM_LANE }));
    idle(engine, 'bug');
    expect(flight(engine)).toEqual(['4,5', '5,5']);
    expect(engine.getItems()[LANE_Y][6]).toBeNull();
    expect(has(engine, 'bug')).toBe(true);
  });

  it('meets the entity of a cell before its item', () => {
    const engine = load(room({ items: [[6, LANE_Y, 'key_red']], entities: [placed('bug', 6, LANE_Y)], player: FAR_FROM_LANE }));
    idle(engine, 'bug');
    flight(engine);
    expect(has(engine, 'bug')).toBe(false);
    expect(engine.getItems()[LANE_Y][6]).toBe('key_red');
  });

  it('melts an ice block into water when it stood on plain floor', () => {
    const engine = load(room({ entities: [placed('ice_block', 6, LANE_Y)], player: FAR_FROM_LANE }));
    flight(engine);
    expect(has(engine, 'ice_block')).toBe(false);
    expect(engine.getTerrain()[LANE_Y][6]).toBe('water');
    expect(engine.getShots()).toEqual([]);
  });

  it('melts an ice block without leaving water when it stood on other ground', () => {
    const engine = load(room({ terrain: [[6, LANE_Y, 'dirt']], entities: [placed('ice_block', 6, LANE_Y)], player: FAR_FROM_LANE }));
    flight(engine);
    expect(has(engine, 'ice_block')).toBe(false);
    expect(engine.getTerrain()[LANE_Y][6]).toBe('dirt');
  });

  it('stops against any other block without harming it', () => {
    const engine = load(room({ entities: [placed('dirt_block', 6, LANE_Y)], player: FAR_FROM_LANE }));
    expect(flight(engine)).toEqual(['4,5', '5,5']);
    expect(has(engine, 'dirt_block')).toBe(true);
  });

  it('destroys a turret', () => {
    for (const id of ['turret_fixed', 'turret_cw', 'turret_ccw', 'turret_multi']) {
      const engine = load(room({ entities: [placed(id, 6, LANE_Y)], player: FAR_FROM_LANE }));
      flight(engine);
      expect(has(engine, id), id).toBe(false);
    }
  });

  it('turns on an existing mirror from either face and leaves it standing', () => {
    // slash: a shot flying east turns north, one flying west turns south.
    const east = load(room({ entities: [placed('mirror_slash', 6, LANE_Y)], player: FAR_FROM_LANE }));
    const eastTrail = flight(east);
    expect(eastTrail).toContain('6,5');
    expect(eastTrail).toContain('6,4');
    expect(eastTrail[eastTrail.length - 1]).toBe('6,1');
    expect(has(east, 'mirror_slash')).toBe(true);

    const west = load(
      room({
        terrain: [[9, LANE_Y, 'shot_launcher_w']],
        links: [{ ...DEFAULT_LINK, launcherX: 9, launcherY: LANE_Y }],
        entities: [placed('mirror_slash', 6, LANE_Y)],
        player: { x: 1, y: 1 }
      })
    );
    const westTrail = flight(west);
    expect(westTrail).toContain('6,6');
    expect(westTrail[westTrail.length - 1]).toBe('6,9');
    expect(has(west, 'mirror_slash')).toBe(true);
  });

  it('turns on a backslash mirror too', () => {
    const engine = load(room({ entities: [placed('mirror_backslash', 6, LANE_Y)], player: FAR_FROM_LANE }));
    const trail = flight(engine);
    expect(trail[trail.length - 1]).toBe('6,9');
  });

  it('passes water, fire, ice, plates, buttons and teleporters doing nothing', () => {
    const engine = load(
      room({
        terrain: [
          [4, LANE_Y, 'water'],
          [5, LANE_Y, 'fire'],
          [6, LANE_Y, 'ice'],
          [7, LANE_Y, 'pressure_plate_red'],
          [8, LANE_Y, 'teleport'],
          [9, LANE_Y, 'button_green'],
          [2, 2, 'teleport'],
          [2, 3, 'hold_door_red_closed'],
          [3, 3, 'toggle_wall_closed']
        ],
        player: { x: 1, y: 1 }
      })
    );
    const before = JSON.stringify(engine.getTerrain());
    fire(engine);
    const trail: string[] = [];
    for (let i = 0; i < MAX_FLIGHT_TICKS && (engine.getShots()?.length ?? 0) > 0; i++) {
      const shot = engine.getShots()?.[0];
      if (shot) trail.push(`${shot.x},${shot.y}`);
      engine.tick();
      // The plate is not pressed and the green button is not worked: the world stays as it was.
      expect(JSON.stringify(engine.getTerrain())).toBe(before);
    }
    expect(new Set(trail)).toEqual(new Set(['4,5', '5,5', '6,5', '7,5', '8,5', '9,5']));
    expect(engine.getPlayer()).toMatchObject({ x: 1, y: 1, alive: true });
  });

  it('is not an occupant for the hold doors', () => {
    const engine = load(
      room({
        terrain: [
          [FAR_CORNER.x, FAR_CORNER.y, 'pressure_plate_red'],
          [6, LANE_Y, 'hold_door_red_open']
        ],
        player: { x: FAR_CORNER.x, y: FAR_CORNER.y }
      })
    );
    expect(engine.getTerrain()[LANE_Y][6]).toBe('hold_door_red_open');
    fire(engine);
    run(engine, 4);
    expect(shotsOf(engine)).toEqual(['6,5,E']);
    expect(step(engine, 'N')).toBe(true);
    expect(engine.getTerrain()[LANE_Y][6]).toBe('hold_door_red_closed');
  });

  it('presses nothing and works no button it passes', () => {
    const engine = load(room({ terrain: [[6, LANE_Y, 'shot_trigger']], player: FAR_FROM_LANE }));
    world(engine).launcherLinks.push({ buttonX: 6, buttonY: LANE_Y, launcherX: LAUNCHER_X, launcherY: LANE_Y });
    const trail = flight(engine);
    expect(trail[trail.length - 1]).toBe('9,5');
  });
});

describe('shots: running into a shot', () => {
  function withShotAt(engine: GameEngine, x: number, y: number, dir: Direction = 'E', cooldown = 5): void {
    world(engine).shots.push({ x, y, dir, cooldown });
  }

  it('kills the player who steps into it and spends it', () => {
    const engine = load(room({ player: { x: FIRST_CELL_X, y: LANE_Y + 1 } }));
    withShotAt(engine, FIRST_CELL_X, LANE_Y);
    expect(engine.attemptPlayerMove('N')).toBe(true);
    expect(engine.getPlayer().alive).toBe(false);
    expect(engine.getPlayer().deathReasonKey).toBe('hud.messages.death_laser');
    expect(engine.getShots()).toEqual([]);
  });

  it('kills the player who is teleported onto it', () => {
    const engine = load(
      room({
        terrain: [
          [5, 8, 'teleport'],
          [8, 8, 'teleport']
        ],
        player: { x: 4, y: 8 }
      })
    );
    withShotAt(engine, 9, 8);
    expect(engine.attemptPlayerMove('E')).toBe(true);
    expect(engine.getPlayer().alive).toBe(false);
    expect(engine.getShots()).toEqual([]);
  });

  it('kills a monster that steps into it and spends it (the monster moves first)', () => {
    const engine = load(room({ entities: [placed('pink_ball', 5, LANE_Y, 'W')], player: FAR_CORNER }));
    engine.getEntities()[0].cooldownTicks = 0;
    withShotAt(engine, FIRST_CELL_X, LANE_Y, 'E', 0);
    engine.tick();
    expect(engine.getEntities()).toEqual([]);
    expect(engine.getShots()).toEqual([]);
  });

  it('kills a monster the shot steps into (the shot moves first in its turn)', () => {
    const engine = load(room({ entities: [placed('bug', 5, LANE_Y)], player: FAR_CORNER }));
    idle(engine, 'bug');
    withShotAt(engine, FIRST_CELL_X, LANE_Y, 'E', 0);
    engine.tick();
    expect(engine.getEntities()).toEqual([]);
    expect(engine.getShots()).toEqual([]);
  });

  it('kills a monster that a clone machine spawns into it', () => {
    const engine = load(
      room({
        terrain: [
          [6, 2, 'clone_machine'],
          [8, 8, 'button_brown']
        ],
        entities: [placed('bug', 6, 2, 'S')],
        cloneLinks: [{ buttonX: 8, buttonY: 8, clonerX: 6, clonerY: 2, templateType: 'bug', templateDir: 'S' }],
        player: FAR_CORNER
      })
    );
    withShotAt(engine, 6, 3);
    expect(context(engine).triggerButton(8, 8, 'trigger_cloner')).toBe(true);
    expect(engine.getEntities()).toHaveLength(1);
    expect(engine.getShots()).toEqual([]);
  });

  it('does not let a block be pushed into it', () => {
    const engine = load(room({ entities: [placed('dirt_block', FIRST_CELL_X, LANE_Y + 1, 'N')], player: { x: FIRST_CELL_X, y: LANE_Y + 2 } }));
    withShotAt(engine, FIRST_CELL_X, LANE_Y);
    expect(engine.attemptPlayerMove('N')).toBe(false);
    expect(engine.getEntities()[0]).toMatchObject({ x: FIRST_CELL_X, y: LANE_Y + 1 });
    expect(engine.getPlayer()).toMatchObject({ x: FIRST_CELL_X, y: LANE_Y + 2, alive: true });
    expect(engine.getShots()).toHaveLength(1);
  });

  it('does not let a clone machine spawn a block into it', () => {
    const engine = load(
      room({
        terrain: [
          [6, 2, 'clone_machine'],
          [8, 8, 'button_brown']
        ],
        entities: [placed('dirt_block', 6, 2, 'S')],
        cloneLinks: [{ buttonX: 8, buttonY: 8, clonerX: 6, clonerY: 2, templateType: 'dirt_block', templateDir: 'S' }],
        player: FAR_CORNER
      })
    );
    withShotAt(engine, 6, 3);
    context(engine).triggerButton(8, 8, 'trigger_cloner');
    expect(engine.getEntities()).toHaveLength(1);
    expect(engine.getShots()).toHaveLength(1);
  });

  it('is no obstacle to the entry test of a monster: it may step in, and dies there', () => {
    const engine = load(room({ entities: [placed('bug', 5, LANE_Y, 'W')], player: FAR_CORNER }));
    withShotAt(engine, FIRST_CELL_X, LANE_Y);
    expect(canMonsterEnter(world(engine), engine.getEntities()[0], 'W')).toBe(true);
  });
});

describe('shots: undo and the per-tick guard', () => {
  it('takes a shot back with the move that fired it, and lets the press fire again', () => {
    const engine = load(room());
    expect(engine.attemptPlayerMove('N')).toBe(true);
    expect(engine.getShots()).toHaveLength(1);
    expect(engine.undo()).toBe(true);
    expect(engine.getShots()).toEqual([]);
    expect(engine.attemptPlayerMove('N')).toBe(true);
    expect(shotsOf(engine)).toEqual([`${FIRST_CELL_X},${LANE_Y},E`]);
  });

  it('puts a shot in flight back where it was', () => {
    const engine = load(room());
    engine.attemptPlayerMove('N');
    run(engine, 3);
    while (engine.getPlayer().moveCooldown > 0) engine.tick();
    const before = JSON.stringify(engine.getShots());
    expect(engine.attemptPlayerMove('E')).toBe(true);
    run(engine, 3);
    expect(JSON.stringify(engine.getShots())).not.toBe(before);
    expect(engine.undo()).toBe(true);
    expect(JSON.stringify(engine.getShots())).toBe(before);
  });

  it('snapshots shots only on a level with launchers', () => {
    const withLauncher = load(room());
    expect(withLauncher.captureState().shots).toEqual([]);
    const without = load(room({ noLauncher: true }));
    expect('shots' in without.captureState()).toBe(false);
  });

  it('restores the shots of a captured state', () => {
    const engine = load(room({ player: FAR_CORNER }));
    fire(engine);
    run(engine, 3);
    const state = engine.captureState();
    run(engine, 6);
    engine.restoreState(state);
    expect(engine.getShots()).toEqual(state.shots);
    expect(world(engine).firedLaunchers.size).toBe(0);
  });

  it('lets a restored state fire at once when the guard was set by the undone tick', () => {
    const engine = load(room({ player: FAR_CORNER }));
    const state = engine.captureState();
    fire(engine);
    expect(world(engine).firedLaunchers.size).toBe(1);
    engine.restoreState(state);
    expect(world(engine).firedLaunchers.size).toBe(0);
    fire(engine);
    expect(engine.getShots()).toHaveLength(1);
  });

  it('starts a restarted level with no shot', () => {
    const level = room({ player: FAR_CORNER });
    const engine = load(level);
    fire(engine);
    engine.loadLevel(level);
    expect(engine.getShots()).toEqual([]);
  });

  it('does not advance shots once the player is dead or the level is won', () => {
    const engine = load(room({ player: FAR_CORNER }));
    fire(engine);
    world(engine).player.alive = false;
    engine.tick();
    expect(shotsOf(engine)).toEqual([`${FIRST_CELL_X},${LANE_Y},E`]);
  });
});

describe('shots: laser beams and one-sided mirrors', () => {
  const emitterRoom = (setup: Setup): GameEngine => load(room({ noLauncher: true, ...setup }));
  const cellsOf = (engine: GameEngine): string[] =>
    engine
      .getBeamCells()
      .map((c) => `${c.x},${c.y}${c.horizontal ? 'h' : ''}${c.vertical ? 'v' : ''}`)
      .sort();

  it('stops a beam that meets the back of a one-sided mirror, uncovered and unharmed', () => {
    const engine = emitterRoom({ terrain: [[2, LANE_Y, 'laser_emitter_e']], entities: [placed('one_sided_mirror_ne', 6, LANE_Y)] });
    expect(cellsOf(engine)).toEqual(['3,5h', '4,5h', '5,5h']);
    engine.tick();
    expect(has(engine, 'one_sided_mirror_ne')).toBe(true);
  });

  it('turns a beam that meets the front of a one-sided mirror', () => {
    const engine = emitterRoom({ terrain: [[6, 2, 'laser_emitter_s']], entities: [placed('one_sided_mirror_ne', 6, LANE_Y)] });
    expect(cellsOf(engine)).toEqual(['6,3v', '6,4v', '6,5hv', '7,5h', '8,5h', '9,5h'].sort());
  });

  it('still turns a beam on both faces of an existing mirror', () => {
    const engine = emitterRoom({ terrain: [[2, LANE_Y, 'laser_emitter_e']], entities: [placed('mirror_slash', 6, LANE_Y)] });
    expect(cellsOf(engine)).toEqual(['3,5h', '4,5h', '5,5h', '6,5hv', '6,4v', '6,3v', '6,2v', '6,1v'].sort());
    const back = emitterRoom({ terrain: [[9, LANE_Y, 'laser_emitter_w']], entities: [placed('mirror_slash', 6, LANE_Y)] });
    expect(cellsOf(back)).toEqual(['8,5h', '7,5h', '6,5hv', '6,6v', '6,7v', '6,8v', '6,9v'].sort());
  });

  it('stops a turret beam at a one-sided mirror on both faces without destroying it', () => {
    const engine = emitterRoom({
      entities: [
        placed('turret_fixed', 3, LANE_Y, 'E'),
        placed('one_sided_mirror_ne', 5, LANE_Y),
        placed('turret_fixed', 7, LANE_Y, 'W')
      ]
    });
    expect(engine.attemptPlayerMove('N')).toBe(true);
    const cells = cellsOf(engine);
    expect(cells).toContain('4,5h');
    expect(cells).toContain('6,5h');
    expect(cells.some((c) => c.startsWith('5,5'))).toBe(false);
    run(engine, 5);
    expect(has(engine, 'one_sided_mirror_ne')).toBe(true);
  });

  it('leaves the turret beam against an existing mirror as it was', () => {
    const engine = emitterRoom({ entities: [placed('turret_fixed', 3, LANE_Y, 'E'), placed('mirror_slash', 5, LANE_Y)] });
    expect(engine.attemptPlayerMove('N')).toBe(true);
    const cells = cellsOf(engine);
    expect(cells).toContain('4,5h');
    expect(cells.some((c) => c.startsWith('5,5'))).toBe(false);
  });
});

describe('shots: launcher links', () => {
  const GRID = [
    ['wall', 'wall', 'wall', 'wall', 'wall'],
    ['wall', TRIGGER_TILE, 'floor', LAUNCHER_E, 'wall'],
    ['wall', 'floor', 'floor', 'floor', 'wall'],
    ['wall', 'dirt', TRIGGER_TILE, 'shot_launcher_n', 'wall'],
    ['wall', 'wall', 'wall', 'wall', 'wall']
  ];
  const link = (buttonX: number, buttonY: number, launcherX: number, launcherY: number): LauncherLink => ({
    buttonX,
    buttonY,
    launcherX,
    launcherY
  });

  it('keeps only links from a trigger to a launcher, once each, sorted by row then column', () => {
    const result = normalizeLauncherLinks(
      [
        link(2, 3, 3, 3),
        link(1, 1, 3, 3),
        link(1, 1, 3, 1),
        link(1, 1, 3, 1),
        link(2, 1, 3, 1),
        link(1, 1, 2, 1),
        link(9, 9, 3, 1),
        link(1, 1, 9, 9),
        { buttonX: 1.5, buttonY: 1, launcherX: 3, launcherY: 1 },
        'nonsense',
        null
      ],
      GRID,
      'epoxy',
      null,
      (id) => ConfigRegistry.getTile(id)
    );
    expect(result).toEqual([link(1, 1, 3, 1), link(1, 1, 3, 3), link(2, 3, 3, 3)]);
  });

  it('carries launcher links on Epoxy levels only', () => {
    const lookup = (id: string) => ConfigRegistry.getTile(id);
    expect(normalizeLauncherLinks([link(1, 1, 3, 1)], GRID, 'lynx', null, lookup)).toBeNull();
    expect(normalizeLauncherLinks([link(1, 1, 3, 1)], GRID, 'cc3d', null, lookup)).toBeNull();
    expect(normalizeLauncherLinks([link(1, 1, 3, 1)], GRID, undefined, null, lookup)).toEqual([link(1, 1, 3, 1)]);
    expect(normalizeLauncherLinks([], GRID, 'epoxy', null, lookup)).toBeNull();
    expect(normalizeLauncherLinks('x', GRID, 'epoxy', null, lookup)).toBeNull();
  });

  it('accepts a launcher or a trigger hidden under a removable top', () => {
    const lookup = (id: string) => ConfigRegistry.getTile(id);
    const hidden = [{ x: 1, y: 3, terrain: LAUNCHER_E }];
    expect(normalizeLauncherLinks([link(1, 1, 1, 3)], GRID, 'epoxy', null, lookup)).toBeNull();
    expect(normalizeLauncherLinks([link(1, 1, 1, 3)], GRID, 'epoxy', hidden, lookup)).toEqual([link(1, 1, 1, 3)]);
  });

  it('checks only the shape when no tile lookup exists', () => {
    expect(normalizeLauncherLinks([link(1, 2, 2, 2), link(9, 9, 1, 1)], GRID, 'epoxy', null, null)).toEqual([link(1, 2, 2, 2)]);
  });

  it('is carried by the compiled level', () => {
    const level = ConfigRegistry.compileBlueprint({
      id: 'linked',
      number: 1,
      password: 'TEST',
      timeLimitSeconds: 0,
      chipsRequired: 0,
      playerStart: { x: 1, y: 2, dir: 'S' },
      terrain: GRID.map((row) => [...row]),
      entities: [],
      trapLinks: [],
      cloneLinks: [],
      launcherLinks: [link(2, 3, 3, 3), link(1, 1, 3, 1), link(1, 1, 1, 1)]
    });
    expect(level.launcherLinks).toEqual([link(1, 1, 3, 1), link(2, 3, 3, 3)]);
    const plain = ConfigRegistry.compileBlueprint({
      id: 'plain',
      number: 1,
      password: 'TEST',
      timeLimitSeconds: 0,
      chipsRequired: 0,
      playerStart: { x: 1, y: 2, dir: 'S' },
      terrain: GRID.map((row) => [...row]),
      entities: [],
      trapLinks: [],
      cloneLinks: []
    });
    expect('launcherLinks' in plain).toBe(false);
  });

  it('cleans a stored level: unusable links are dropped, a canonical list is kept as it is', () => {
    const level = room();
    expect(stripInvalidTextFields(level)).toBe(level);
    const dirty = { ...level, launcherLinks: [DEFAULT_LINK, { ...DEFAULT_LINK, launcherX: 9 }] };
    expect(stripInvalidTextFields(dirty).launcherLinks).toEqual([DEFAULT_LINK]);
    const empty = { ...level, launcherLinks: [{ ...DEFAULT_LINK, launcherX: 9 }] };
    expect('launcherLinks' in stripInvalidTextFields(empty)).toBe(false);
  });

  it('refuses a stored level with more links than cells in strict mode', () => {
    const level = room();
    const bounds = { minSize: 1, maxSize: 64 };
    expect(isCompiledLevelShape(level, bounds, true)).toBe(true);
    const many = { ...level, launcherLinks: Array.from({ length: SIZE * SIZE + 1 }, () => ({ ...DEFAULT_LINK })) };
    expect(isCompiledLevelShape(many, bounds, true)).toBe(false);
  });
});

describe('shots: searches and hashes', () => {
  it('tells states with shots apart, and leaves the key empty without them', () => {
    expect(shotsStateKey(undefined)).toBe('');
    expect(shotsStateKey([])).toBe('');
    const a = shotsStateKey([{ x: 4, y: 5, dir: 'E', cooldown: 1 }]);
    const b = shotsStateKey([{ x: 4, y: 5, dir: 'E', cooldown: 0 }]);
    expect(a).not.toBe('');
    expect(a).not.toBe(b);
  });

  it('makes the block puzzle solver give up on a level with launchers or links', () => {
    const targetLevel = (setup: Setup, links: LauncherLink[] = []): CompiledLevel => {
      const level = room({ noLauncher: true, entities: [placed('dirt_block', 4, 4)], terrain: [[6, 6, 'block_target']], ...setup });
      return { ...level, winRule: 'targets', ...(links.length > 0 ? { launcherLinks: links } : {}) };
    };
    expect(BlockPuzzleSolver.verdict(load(targetLevel({}))).kind).toBe('solved');
    expect(BlockPuzzleSolver.verdict(load(targetLevel({}, [DEFAULT_LINK]))).kind).toBe('not_checked');
    expect(BlockPuzzleSolver.verdict(load(targetLevel({ terrain: [[6, 6, 'block_target'], [2, 2, LAUNCHER_E]] }))).kind).toBe('not_checked');
  });

  it('keeps every direction opposite to its own opposite', () => {
    for (const dir of ['N', 'E', 'S', 'W'] as Direction[]) expect(OPPOSITE_DIRECTION[OPPOSITE_DIRECTION[dir]]).toBe(dir);
  });
});
