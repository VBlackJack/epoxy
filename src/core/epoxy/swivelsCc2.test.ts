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
import { TERRAIN_MAP } from '../../formats/cc2Mapping';
import en from '../../locales/en.json';
import fr from '../../locales/fr.json';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { GameEngine } from '../GameEngine';
import { isEpoxyOnlyTileId, isSwivelTileId } from '../RulesetFeatures';
import { attemptPushBlock } from './epoxyBlocks';
import { leaveSwivel } from './epoxySwivels';
import { steerMonsters } from './epoxySteering';
import type { EpoxyContext, EpoxyWorld } from './epoxyWorld';
import type { CompiledLevel, Direction, EntityPlacement, TileDefinition } from '../types';

const SIZE = 11;
const CENTER = 5;
const TIME_LIMIT_SECONDS = 100;
const MAX_WAIT_TICKS = 40;
const MONSTER_WALK_TICKS = 300;
const START = { x: 1, y: 9 };
const LAUNCHER_X = 3;
const TRIGGER = { x: 1, y: 8 };
const MAX_FLIGHT_TICKS = 60;
const NE = 'swivel_door_cc2_ne';
const NW = 'swivel_door_cc2_nw';
const SE = 'swivel_door_cc2_se';
const SW = 'swivel_door_cc2_sw';
const CC2_IDS = [NE, SE, SW, NW];
const NATIVE_NE = 'swivel_door_ne';
const NATIVE_NW = 'swivel_door_nw';
const CC2_SWIVEL_COVERAGE_KEY = 'swivel_door';

/** CC2 tile codes of the four swivel doors and the door each one maps to. */
const CC2_CODES: Array<[number, string]> = [
  [0x48, SW],
  [0x49, NW],
  [0x4a, NE],
  [0x4b, SE]
];

/**
 * Door, side an actor leaves by through a closed side, and the door it becomes. Clockwise when the side clockwise of
 * the exit is closed too, else counter-clockwise (NE leaving N becomes SE, NE leaving E becomes NW).
 */
const TURN_TABLE: Array<[string, Direction, string]> = [
  [NE, 'N', SE],
  [NE, 'E', NW],
  [SE, 'E', SW],
  [SE, 'S', NE],
  [SW, 'S', NW],
  [SW, 'W', SE],
  [NW, 'W', NE],
  [NW, 'N', SW]
];

/** Door and a side it is open on: leaving through it does not turn the door. */
const OPEN_EXITS: Array<[string, Direction]> = [
  [NE, 'S'],
  [NE, 'W'],
  [SE, 'N'],
  [SE, 'W'],
  [SW, 'N'],
  [SW, 'E'],
  [NW, 'S'],
  [NW, 'E']
];

interface Setup {
  launcher?: boolean;
  terrain?: Array<[number, number, string]>;
  entities?: EntityPlacement[];
  player?: { x: number; y: number };
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
    id: 'swivel_cc2_room',
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

function entityOf(engine: GameEngine, type: string): { x: number; y: number } {
  const found = engine.getEntities().find((e) => e.type === type);
  if (!found) throw new Error(`no ${type}`);
  return found;
}

beforeEach(() => {
  loadTestConfigs();
});

describe('cc2 swivel doors: configuration', () => {
  it('defines four doors with the cc2 rule, named in both locales, Epoxy only', () => {
    const closed: Record<string, string> = { [NE]: 'EN', [SE]: 'ES', [SW]: 'SW', [NW]: 'NW' };
    const names = { en, fr } as unknown as Record<string, { tiles: Record<string, { name: string }> }>;
    for (const id of CC2_IDS) {
      const tile = ConfigRegistry.getTile(id);
      expect(tile.swivelRule, id).toBe('cc2');
      expect(tile.swivelTurns, id).toBeDefined();
      expect(tile.laserTransparent, id).toBe(true);
      expect([...(tile.blockedEdges ?? [])].sort().join(''), id).toBe(closed[id]);
      expect(names.en.tiles[id].name, id).toBeTruthy();
      expect(names.fr.tiles[id].name, id).toBeTruthy();
      expect(isSwivelTileId(id), id).toBe(true);
      expect(isEpoxyOnlyTileId(id), id).toBe(true);
    }
    expect(ConfigRegistry.getTile(NATIVE_NE).swivelRule).toBeUndefined();
  });

  it('accepts the shipped doors and refuses a door that turns into a door of the other rule', () => {
    const tiles = ConfigRegistry.getTiles().tiles;
    expect(findSwivelConfigErrors(tiles)).toEqual([]);
    const mixed: Record<string, TileDefinition> = {
      ...tiles,
      [NE]: { ...tiles[NE], swivelTurns: { cw: SE, ccw: NATIVE_NW } }
    };
    expect(findSwivelConfigErrors(mixed).join()).toContain('same swivel rule');
    const unknownRule: Record<string, TileDefinition> = {
      ...tiles,
      [NE]: { ...tiles[NE], swivelRule: 'other' as unknown as 'cc2' }
    };
    expect(findSwivelConfigErrors(unknownRule).join()).toContain('swivelRule');
    const onPlainTile: Record<string, TileDefinition> = {
      ...tiles,
      floor: { ...tiles.floor, swivelRule: 'other' as unknown as 'cc2' }
    };
    expect(findSwivelConfigErrors(onPlainTile).join()).toContain('floor.swivelRule');
  });

  it('is what the cc2 codes 0x48 to 0x4b map to, with the swivel coverage key', () => {
    for (const [code, id] of CC2_CODES) {
      expect(TERRAIN_MAP.get(code), code.toString(16)).toEqual({ id, key: CC2_SWIVEL_COVERAGE_KEY });
    }
  });
});

describe('cc2 swivel doors: turning rule', () => {
  it('turns when leaving through a closed side, for every door and closed side', () => {
    for (const [from, exit, to] of TURN_TABLE) {
      const engine = load(room({ terrain: [[CENTER, CENTER, from]] }));
      const w = world(engine);
      w.beamDirty = false;
      leaveSwivel(w, CENTER, CENTER, exit);
      expect(terrainAt(engine, CENTER, CENTER), `${from} leaving ${exit}`).toBe(to);
      expect(w.beamDirty).toBe(true);
    }
  });

  it('does not turn when leaving through an open side', () => {
    for (const [from, exit] of OPEN_EXITS) {
      const engine = load(room({ terrain: [[CENTER, CENTER, from]] }));
      const w = world(engine);
      w.beamDirty = false;
      leaveSwivel(w, CENTER, CENTER, exit);
      expect(terrainAt(engine, CENTER, CENTER), `${from} leaving ${exit}`).toBe(from);
      expect(w.beamDirty).toBe(false);
    }
  });

  it('records no entry side', () => {
    const engine = load(room({ terrain: [[CENTER, CENTER, NE]], player: { x: CENTER, y: CENTER + 1 } }));
    expect(step(engine, 'N')).toBe(true);
    expect(world(engine).swivelEntry.size).toBe(0);
  });
});

describe('cc2 swivel doors: the player', () => {
  it('cannot enter through a closed side', () => {
    const fromNorth = load(room({ terrain: [[CENTER, CENTER, NE]], player: { x: CENTER, y: CENTER - 1 } }));
    expect(step(fromNorth, 'S')).toBe(false);
    const fromEast = load(room({ terrain: [[CENTER, CENTER, NE]], player: { x: CENTER + 1, y: CENTER } }));
    expect(step(fromEast, 'W')).toBe(false);
    expect(terrainAt(fromEast, CENTER, CENTER)).toBe(NE);
    expect(fromNorth.getPlayer().y).toBe(CENTER - 1);
  });

  it('pushes a block ahead while leaving through a closed side, and the door turns once the player steps off', () => {
    const engine = load(
      room({
        terrain: [[CENTER, CENTER, NE]],
        entities: [{ type: 'dirt_block', x: CENTER, y: CENTER - 1, dir: 'N' }],
        player: { x: CENTER, y: CENTER }
      })
    );
    expect(step(engine, 'N')).toBe(true);
    expect(engine.getPlayer().y).toBe(CENTER - 1);
    expect(entityOf(engine, 'dirt_block').y).toBe(CENTER - 2);
    expect(terrainAt(engine, CENTER, CENTER)).toBe(SE);
  });

  it('leaves through a closed side and pushes the door round', () => {
    const north = load(room({ terrain: [[CENTER, CENTER, NE]], player: { x: CENTER, y: CENTER } }));
    expect(step(north, 'N')).toBe(true);
    expect(terrainAt(north, CENTER, CENTER)).toBe(SE);
    const east = load(room({ terrain: [[CENTER, CENTER, NE]], player: { x: CENTER, y: CENTER } }));
    expect(step(east, 'E')).toBe(true);
    expect(terrainAt(east, CENTER, CENTER)).toBe(NW);
  });

  it('leaves through an open side and keeps the door as it is', () => {
    const engine = load(room({ terrain: [[CENTER, CENTER, NE]], player: { x: CENTER, y: CENTER } }));
    expect(step(engine, 'S')).toBe(true);
    expect(terrainAt(engine, CENTER, CENTER)).toBe(NE);
    // Back in by the open south side, then out by the same side: still no turn.
    expect(step(engine, 'N')).toBe(true);
    expect(step(engine, 'S')).toBe(true);
    expect(terrainAt(engine, CENTER, CENTER)).toBe(NE);
  });

  it('walks through from an open side to a closed one, and the door has turned behind', () => {
    const engine = load(room({ terrain: [[CENTER, CENTER, NE]], player: { x: CENTER, y: CENTER + 1 } }));
    expect(step(engine, 'N')).toBe(true);
    expect(step(engine, 'N')).toBe(true);
    expect(terrainAt(engine, CENTER, CENTER)).toBe(SE);
    expect(engine.getPlayer().y).toBe(CENTER - 1);
    // The north side is open on the south-east door, so the player can come back in; leaving by the closed south
    // side turns it again (south-east becomes north-east).
    expect(step(engine, 'S')).toBe(true);
    expect(step(engine, 'S')).toBe(true);
    expect(terrainAt(engine, CENTER, CENTER)).toBe(NE);
  });

  it('puts the orientation back on undo', () => {
    const engine = load(room({ terrain: [[CENTER, CENTER, NE]], player: { x: CENTER, y: CENTER } }));
    expect(step(engine, 'N')).toBe(true);
    expect(terrainAt(engine, CENTER, CENTER)).toBe(SE);
    expect(engine.undo()).toBe(true);
    expect(terrainAt(engine, CENTER, CENTER)).toBe(NE);
  });
});

describe('cc2 swivel doors: monsters and blocks', () => {
  it('a monster leaving through a closed side pushes the door round', () => {
    const engine = load(
      room({
        terrain: [[CENTER, CENTER, NE]],
        entities: [{ type: 'walker', x: CENTER, y: CENTER + 1, dir: 'N' }]
      })
    );
    let turned = false;
    for (let i = 0; i < MONSTER_WALK_TICKS && !turned; i++) {
      engine.tick();
      // In by the open south side, on out through the closed north side: the door became south-east.
      if (entityOf(engine, 'walker').y < CENTER && terrainAt(engine, CENTER, CENTER) === SE) turned = true;
    }
    expect(turned).toBe(true);
  });

  it('a steered puppet turns the door on the way out and cannot enter by a closed side', () => {
    const engine = load(
      room({
        terrain: [
          [CENTER, CENTER, NE],
          [1, 1, 'puppet_control']
        ],
        entities: [{ type: 'puppet', x: CENTER, y: CENTER, dir: 'N' }]
      })
    );
    const ctx = contextOf(engine);
    // Out through the closed east side: north-east becomes north-west.
    expect(steerMonsters(ctx, 'E')).toBe(true);
    expect(entityOf(engine, 'puppet').x).toBe(CENTER + 1);
    expect(terrainAt(engine, CENTER, CENTER)).toBe(NW);
    // Back in by the east side, which is open now; out through the closed west side: north-west becomes north-east.
    steerMonsters(ctx, 'W');
    expect(entityOf(engine, 'puppet').x).toBe(CENTER);
    steerMonsters(ctx, 'W');
    expect(entityOf(engine, 'puppet').x).toBe(CENTER - 1);
    expect(terrainAt(engine, CENTER, CENTER)).toBe(NE);
    // The west side is open on north-east: it comes back in, and cannot enter by a closed side from the north.
    steerMonsters(ctx, 'E');
    expect(entityOf(engine, 'puppet').x).toBe(CENTER);
  });

  it('a pushed block leaves through a closed side and turns the door, and cannot enter by one', () => {
    const engine = load(
      room({
        terrain: [[CENTER, CENTER, NE]],
        entities: [{ type: 'dirt_block', x: CENTER, y: CENTER, dir: 'N' }],
        player: { x: CENTER, y: CENTER + 1 }
      })
    );
    const block = engine.getEntities().find((e) => e.type === 'dirt_block');
    if (!block) throw new Error('no block');
    expect(attemptPushBlock(contextOf(engine), block, 'N')).toBe(true);
    expect(block.y).toBe(CENTER - 1);
    expect(terrainAt(engine, CENTER, CENTER)).toBe(SE);

    const blocked = load(
      room({
        terrain: [[CENTER, CENTER, NE]],
        entities: [{ type: 'dirt_block', x: CENTER, y: CENTER - 1, dir: 'S' }]
      })
    );
    const other = blocked.getEntities().find((e) => e.type === 'dirt_block');
    if (!other) throw new Error('no block');
    expect(attemptPushBlock(contextOf(blocked), other, 'S')).toBe(false);
    expect(terrainAt(blocked, CENTER, CENTER)).toBe(NE);
  });
});

describe('cc2 swivel doors: shots', () => {
  it('a shot enters by an open side and stops at a closed side instead of leaving through it', () => {
    const engine = load(room({ launcher: true, terrain: [[CENTER, CENTER, NE]] }));
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
    expect(trail).toEqual(['4,5', '5,5']);
    expect(terrainAt(engine, CENTER, CENTER)).toBe(NE);
  });
});

describe('native swivel doors stay as they were', () => {
  it('still refuse to leave through a closed side and turn behind the actor', () => {
    const stuck = load(room({ terrain: [[CENTER, CENTER, NATIVE_NE]], player: { x: CENTER, y: CENTER } }));
    expect(step(stuck, 'N')).toBe(false);
    expect(step(stuck, 'E')).toBe(false);
    const through = load(room({ terrain: [[CENTER, CENTER, NATIVE_NE]], player: { x: CENTER - 1, y: CENTER } }));
    expect(step(through, 'E')).toBe(true);
    expect(step(through, 'S')).toBe(true);
    expect(terrainAt(through, CENTER, CENTER)).toBe(NATIVE_NW);
  });
});
