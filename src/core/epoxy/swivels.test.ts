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
import { findSwivelConfigErrors } from '../../config/ConfigValidation';
import en from '../../locales/en.json';
import fr from '../../locales/fr.json';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { BlockPuzzleSolver } from '../BlockPuzzleSolver';
import { GameEngine } from '../GameEngine';
import { featuresFor, hasEpoxyOnlyContent, isEpoxyOnlyTileId, isSwivelTileId } from '../RulesetFeatures';
import { attemptPushBlock, moveBlockTo } from './epoxyBlocks';
import { leaveSwivel } from './epoxySwivels';
import { steerMonsters } from './epoxySteering';
import type { EpoxyContext, EpoxyWorld } from './epoxyWorld';
import type { CompiledLevel, Direction, EntityPlacement, TileDefinition } from '../types';

const SIZE = 11;
const CENTER = 5;
const TIME_LIMIT_SECONDS = 100;
const MAX_WAIT_TICKS = 40;
const MAX_FLIGHT_TICKS = 60;
const MONSTER_WALK_TICKS = 300;
const LAUNCHER_X = 3;
const TRIGGER = { x: 1, y: 8 };
const START = { x: 1, y: 9 };
const EMITTER_X = 2;
const NE = 'swivel_door_ne';
const NW = 'swivel_door_nw';
const SE = 'swivel_door_se';
const SW = 'swivel_door_sw';
const SWIVEL_IDS = [NE, SE, SW, NW];

/** Door, side the actor came in by, and the door it turns into: the entry side always ends up closed. */
const ROTATION_TABLE: Array<[string, Direction, string]> = [
  [NE, 'S', SE],
  [NE, 'W', NW],
  [SE, 'W', SW],
  [SE, 'N', NE],
  [SW, 'N', NW],
  [SW, 'E', SE],
  [NW, 'E', NE],
  [NW, 'S', SW]
];

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
    id: 'swivel_room',
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

function world(engine: GameEngine): EpoxyWorld {
  return (engine as unknown as { w: EpoxyWorld }).w;
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

function cellKey(x: number, y: number): number {
  return y * SIZE + x;
}

function entityOf(engine: GameEngine, type: string): { x: number; y: number } {
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

describe('swivel doors: configuration', () => {
  it('defines four doors that close two adjacent sides, let light through and are named', () => {
    const closed: Record<string, string> = { [NE]: 'NE', [SE]: 'ES', [SW]: 'SW', [NW]: 'NW' };
    const names = { en, fr } as unknown as Record<string, { tiles: Record<string, { name: string }> }>;
    for (const id of SWIVEL_IDS) {
      const tile = ConfigRegistry.getTile(id);
      expect(tile.category, id).toBe('mechanisms');
      expect(tile.laserTransparent, id).toBe(true);
      expect(tile.passableByPlayer, id).toBe(true);
      expect(tile.passableByMonster, id).toBe(true);
      expect(tile.passableByBlock, id).toBe(true);
      expect([...(tile.blockedEdges ?? [])].sort().join(''), id).toBe(closed[id].split('').sort().join(''));
      expect(tile.swivelTurns, id).toBeDefined();
      expect(names.en.tiles[id].name, id).toBeTruthy();
      expect(names.fr.tiles[id].name, id).toBeTruthy();
    }
  });

  it('accepts the shipped doors and refuses a missing target, a non-door target and wrong edges', () => {
    const tiles = ConfigRegistry.getTiles().tiles;
    expect(findSwivelConfigErrors(tiles)).toEqual([]);
    const withTurns = (turns: { cw: string; ccw: string }): Record<string, TileDefinition> => ({
      ...tiles,
      [NE]: { ...tiles[NE], swivelTurns: turns }
    });
    expect(findSwivelConfigErrors(withTurns({ cw: 'nowhere', ccw: NW })).join()).toContain('unknown tile');
    expect(findSwivelConfigErrors(withTurns({ cw: 'floor', ccw: NW })).join()).toContain('not a swivel door');
    expect(findSwivelConfigErrors(withTurns({ cw: NW, ccw: SE })).length).toBeGreaterThanOrEqual(2);
  });

  it('is an Epoxy-only tile, and a level with one loses the hint, the watch and the tapped path', () => {
    for (const id of SWIVEL_IDS) {
      expect(isSwivelTileId(id), id).toBe(true);
      expect(isEpoxyOnlyTileId(id), id).toBe(true);
    }
    expect(isSwivelTileId('floor')).toBe(false);
    const plain = room();
    const swivelLevel = room({ terrain: [[CENTER, CENTER, NE]] });
    expect(hasEpoxyOnlyContent(plain)).toBe(false);
    expect(hasEpoxyOnlyContent(swivelLevel)).toBe(true);
    expect(featuresFor(plain).tapToPath).toBe(true);
    const aids = featuresFor(swivelLevel);
    expect(aids.tapToPath).toBe(false);
    expect(aids.blockHint).toBe(false);
    expect(aids.deadEndWatch).toBe(false);
  });

  it('is not judged by the block puzzle search', () => {
    const level = room({
      terrain: [
        [CENTER, CENTER, NE],
        [7, 7, 'block_target']
      ],
      entities: [{ type: 'dirt_block', x: 7, y: 5, dir: 'S' }]
    });
    level.winRule = 'targets';
    expect(BlockPuzzleSolver.verdict(load(level))).toEqual({ kind: 'not_checked' });
  });
});

describe('swivel doors: rotation table', () => {
  it('turns a door so the side the actor came in by is closed, for every door and entry side', () => {
    for (const [from, entry, to] of ROTATION_TABLE) {
      const engine = load(room({ terrain: [[CENTER, CENTER, from]] }));
      const w = world(engine);
      w.swivelEntry.set(cellKey(CENTER, CENTER), entry);
      w.beamDirty = false;
      leaveSwivel(w, CENTER, CENTER);
      expect(terrainAt(engine, CENTER, CENTER), `${from} entered by ${entry}`).toBe(to);
      expect(ConfigRegistry.getTile(to).blockedEdges, `${from} entered by ${entry}`).toContain(entry);
      expect(w.beamDirty).toBe(true);
      expect(w.swivelEntry.size).toBe(0);
    }
  });

  it('does not turn a door nobody entered', () => {
    const engine = load(room({ terrain: [[CENTER, CENTER, NE]] }));
    leaveSwivel(world(engine), CENTER, CENTER);
    expect(terrainAt(engine, CENTER, CENTER)).toBe(NE);
  });
});

describe('swivel doors: the player', () => {
  it('cannot enter through a closed side', () => {
    const fromNorth = load(room({ terrain: [[CENTER, CENTER, NE]], player: { x: CENTER, y: CENTER - 1 } }));
    expect(step(fromNorth, 'S')).toBe(false);
    const fromEast = load(room({ terrain: [[CENTER, CENTER, NE]], player: { x: CENTER + 1, y: CENTER } }));
    expect(step(fromEast, 'W')).toBe(false);
    expect(terrainAt(fromEast, CENTER, CENTER)).toBe(NE);
  });

  it('cannot leave through a closed side, and a door the player starts on does not turn', () => {
    const engine = load(room({ terrain: [[CENTER, CENTER, NE]], player: { x: CENTER, y: CENTER } }));
    expect(step(engine, 'N')).toBe(false);
    expect(step(engine, 'E')).toBe(false);
    expect(step(engine, 'S')).toBe(true);
    expect(terrainAt(engine, CENTER, CENTER)).toBe(NE);
    expect(world(engine).swivelEntry.size).toBe(0);
  });

  it('turns behind whoever passes through, closing the side they came in by', () => {
    const engine = load(room({ terrain: [[CENTER, CENTER, NE]], player: { x: CENTER - 1, y: CENTER } }));
    expect(step(engine, 'E')).toBe(true);
    expect(terrainAt(engine, CENTER, CENTER)).toBe(NE);
    expect(world(engine).swivelEntry.get(cellKey(CENTER, CENTER))).toBe('W');
    expect(step(engine, 'S')).toBe(true);
    expect(terrainAt(engine, CENTER, CENTER)).toBe(NW);
    // The way back by the west side is closed now.
    expect(step(engine, 'W')).toBe(true);
    expect(step(engine, 'N')).toBe(true);
    expect(step(engine, 'E')).toBe(false);
  });

  it('turns and closes the entry side when the player backs out', () => {
    const engine = load(room({ terrain: [[CENTER, CENTER, NE]], player: { x: CENTER - 1, y: CENTER } }));
    expect(step(engine, 'E')).toBe(true);
    expect(step(engine, 'W')).toBe(true);
    expect(terrainAt(engine, CENTER, CENTER)).toBe(NW);
    expect(step(engine, 'E')).toBe(false);
  });

  it('records the entry when a teleport lands on the door, and turns it when the player leaves', () => {
    const level = room({
      terrain: [
        [2, 2, 'teleport'],
        [8, 8, 'teleport'],
        [9, 8, NE]
      ],
      player: { x: 1, y: 2 }
    });
    const engine = load(level);
    expect(step(engine, 'E')).toBe(true);
    expect(engine.getPlayer().x).toBe(9);
    expect(engine.getPlayer().y).toBe(8);
    expect(world(engine).swivelEntry.get(cellKey(9, 8))).toBe('W');
    expect(step(engine, 'S')).toBe(true);
    expect(terrainAt(engine, 9, 8)).toBe(NW);
  });

  it('puts back the orientation and the entry record on undo', () => {
    const engine = load(room({ terrain: [[CENTER, CENTER, NE]], player: { x: CENTER - 1, y: CENTER } }));
    expect(step(engine, 'E')).toBe(true);
    expect(step(engine, 'S')).toBe(true);
    expect(terrainAt(engine, CENTER, CENTER)).toBe(NW);
    expect(world(engine).swivelEntry.size).toBe(0);
    expect(engine.undo()).toBe(true);
    expect(terrainAt(engine, CENTER, CENTER)).toBe(NE);
    expect(world(engine).swivelEntry.get(cellKey(CENTER, CENTER))).toBe('W');
    expect(step(engine, 'S')).toBe(true);
    expect(terrainAt(engine, CENTER, CENTER)).toBe(NW);
    expect(engine.undo()).toBe(true);
    expect(engine.undo()).toBe(true);
    expect(terrainAt(engine, CENTER, CENTER)).toBe(NE);
    expect(world(engine).swivelEntry.size).toBe(0);
  });
});

describe('swivel doors: monsters, blocks and puppets', () => {
  it('turns behind a monster that walks through', () => {
    const engine = load(
      room({
        terrain: [[CENTER, CENTER, NE]],
        entities: [{ type: 'walker', x: CENTER - 1, y: CENTER, dir: 'E' }]
      })
    );
    let entered = false;
    let turned = false;
    for (let i = 0; i < MONSTER_WALK_TICKS && !turned; i++) {
      engine.tick();
      const walker = entityOf(engine, 'walker');
      if (walker.x === CENTER && walker.y === CENTER) entered = true;
      if (entered && terrainAt(engine, CENTER, CENTER) !== NE) turned = true;
    }
    expect(entered).toBe(true);
    expect(turned).toBe(true);
    expect(ConfigRegistry.getTile(terrainAt(engine, CENTER, CENTER)).blockedEdges).toContain('W');
  });

  it('turns behind a pushed block', () => {
    const engine = load(
      room({ terrain: [[CENTER, CENTER, NE]], entities: [{ type: 'dirt_block', x: CENTER, y: CENTER + 1, dir: 'N' }] })
    );
    const ctx = contextOf(engine);
    const block = engine.getEntities().find((e) => e.type === 'dirt_block');
    if (!block) throw new Error('no block');
    // Pushed north into the door by its open south side, then moved back out by the same side.
    expect(attemptPushBlock(ctx, block, 'N')).toBe(true);
    expect(world(engine).swivelEntry.get(cellKey(CENTER, CENTER))).toBe('S');
    expect(terrainAt(engine, CENTER, CENTER)).toBe(NE);
    moveBlockTo(ctx, block, CENTER, CENTER + 1, 'S');
    expect(terrainAt(engine, CENTER, CENTER)).toBe(SE);
    expect(world(engine).swivelEntry.size).toBe(0);
  });

  it('turns behind a steered puppet', () => {
    const engine = load(
      room({
        terrain: [
          [CENTER, CENTER, NE],
          [1, 1, 'puppet_control']
        ],
        entities: [{ type: 'puppet', x: CENTER - 1, y: CENTER, dir: 'E' }]
      })
    );
    const ctx = contextOf(engine);
    expect(steerMonsters(ctx, 'E')).toBe(true);
    expect(entityOf(engine, 'puppet').x).toBe(CENTER);
    expect(terrainAt(engine, CENTER, CENTER)).toBe(NE);
    // East is closed: the puppet stays; south is open.
    steerMonsters(ctx, 'E');
    expect(entityOf(engine, 'puppet').x).toBe(CENTER);
    steerMonsters(ctx, 'S');
    expect(entityOf(engine, 'puppet').y).toBe(CENTER + 1);
    expect(terrainAt(engine, CENTER, CENTER)).toBe(NW);
  });
});

describe('swivel doors: light and shots', () => {
  const beamKeys = (engine: GameEngine): string[] => engine.getBeamCells().map((c) => `${c.x},${c.y}`);

  it('stops a laser at a closed side and lets it into the cell through an open one', () => {
    const emitter: Array<[number, number, string]> = [[EMITTER_X, CENTER, 'laser_emitter_e']];
    const open = load(room({ terrain: [...emitter, [CENTER, CENTER, NE]] }));
    expect(beamKeys(open)).toContain(`${CENTER},${CENTER}`);
    expect(beamKeys(open)).not.toContain(`${CENTER + 1},${CENTER}`);
    const closed = load(room({ terrain: [...emitter, [CENTER, CENTER, NW]] }));
    expect(beamKeys(closed)).toContain(`${CENTER - 1},${CENTER}`);
    expect(beamKeys(closed)).not.toContain(`${CENTER},${CENTER}`);
  });

  it('follows the new orientation after a door turns', () => {
    const engine = load(
      room({
        terrain: [
          [EMITTER_X, CENTER, 'laser_emitter_e'],
          [CENTER, CENTER, NE]
        ]
      })
    );
    expect(beamKeys(engine)).toContain(`${CENTER},${CENTER}`);
    // An actor came in by the west side and leaves: the door turns to close it and the beam stops short.
    const w = world(engine);
    w.swivelEntry.set(cellKey(CENTER, CENTER), 'W');
    leaveSwivel(w, CENTER, CENTER);
    expect(terrainAt(engine, CENTER, CENTER)).toBe(NW);
    expect(beamKeys(engine)).not.toContain(`${CENTER},${CENTER}`);
  });

  it('stops a shot at a closed side and lets it into the cell through an open one', () => {
    const open = load(room({ launcher: true, terrain: [[CENTER, CENTER, NE]] }));
    expect(flight(open)).toEqual(['4,5', '5,5']);
    const closedWest = load(room({ launcher: true, terrain: [[CENTER, CENTER, NW]] }));
    expect(flight(closedWest)).toEqual(['4,5']);
    const closedSouthWest = load(room({ launcher: true, terrain: [[CENTER, CENTER, SW]] }));
    expect(flight(closedSouthWest)).toEqual(['4,5']);
  });
});

describe('swivel doors: placement', () => {
  it('leaves an actor placed on the door free to go without turning it', () => {
    const engine = load(room({ terrain: [[CENTER, CENTER, SW]], player: { x: CENTER, y: CENTER } }));
    expect(step(engine, 'N')).toBe(true);
    expect(terrainAt(engine, CENTER, CENTER)).toBe(SW);
  });
});
