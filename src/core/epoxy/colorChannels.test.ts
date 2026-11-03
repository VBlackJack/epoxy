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
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { terrainEventKind } from '../DifficultyMetrics';
import { GameEngine } from '../GameEngine';
import { LevelMetrics, MECHANICS } from '../LevelMetrics';
import { LevelValidator } from '../LevelValidator';
import { Pathfinder } from '../Pathfinder';
import { isPlayerWalkable } from '../Walkability';
import { CompiledLevel, Direction, EntityPlacement } from '../types';

const TERRAIN_CODES: Record<string, string> = {
  '#': 'wall',
  '.': 'floor',
  P: 'floor',
  r: 'pressure_plate_red',
  g: 'pressure_plate_green',
  b: 'pressure_plate_blue',
  y: 'pressure_plate_yellow',
  R: 'hold_door_red_closed',
  O: 'hold_door_red_open',
  G: 'hold_door_green_closed',
  B: 'hold_door_blue_closed',
  Y: 'hold_door_yellow_closed',
  W: 'water',
  M: 'slime',
  F: 'floating_block_red',
  x: 'toggle_wall_red_closed',
  X: 'toggle_wall_red_open',
  k: 'toggle_button_red',
  K: 'toggle_button_blue',
  z: 'toggle_wall_blue_closed',
  w: 'toggle_wall_closed',
  v: 'toggle_wall_open',
  '[': 'button_green',
  '>': 'laser_emitter_e',
  L: 'laser_receiver_red',
  i: 'ice',
  E: 'exit'
};
const ENTITY_CODES: Record<string, string> = {
  '1': 'color_block_red',
  '2': 'dirt_block',
  '3': 'color_block_blue',
  '4': 'ice_block',
  m: 'blob'
};
/** Ticks run before each move so the move cooldown of the player has elapsed. */
const COOLDOWN_TICKS = 8;

/**
 * Builds a level from rows. Terrain: # wall, . floor, P player, r g b y plates (red, green, blue,
 * yellow), R O red hold door (closed, open), G B Y green, blue, yellow hold doors (closed), W water,
 * M slime, F floating red block, x X red toggle wall (closed, open), z blue toggle wall (closed),
 * w v green toggle wall (closed, open), k K red and blue toggle buttons, [ green button, > laser
 * emitter, L red receiver, i ice, E exit. Entities: 1 red block, 2 dirt block, 3 blue block, 4 ice
 * block, m blob. The letter p is the player standing on an open red hold door.
 */
function room(rows: string[], items: Record<string, string> = {}): CompiledLevel {
  let start = { x: 1, y: 1 };
  const entities: EntityPlacement[] = [];
  const terrain = rows.map((row, y) =>
    [...row].map((ch, x) => {
      if (ch === 'P' || ch === 'p') start = { x, y };
      const entityType = ENTITY_CODES[ch];
      if (entityType) entities.push({ type: entityType, x, y, dir: 'S' });
      return ch === 'p' ? 'hold_door_red_open' : (TERRAIN_CODES[ch] ?? 'floor');
    })
  );
  return {
    id: 'channel_room',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    playerStart: { ...start, dir: 'E' },
    terrain,
    items: terrain.map((row, y) => row.map((_, x) => items[`${x},${y}`] ?? null)),
    entities,
    trapLinks: [],
    cloneLinks: []
  };
}

function engineOf(level: CompiledLevel): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(level);
  return engine;
}

function engineFor(rows: string[], items: Record<string, string> = {}): GameEngine {
  return engineOf(room(rows, items));
}

/** Same room with the entities replaced: the letters of the rows then only describe the terrain. */
function engineWith(rows: string[], entities: EntityPlacement[]): GameEngine {
  const level = room(rows);
  level.entities = entities;
  return engineOf(level);
}

function move(engine: GameEngine, dir: Direction): boolean {
  for (let i = 0; i < COOLDOWN_TICKS; i++) engine.tick();
  return engine.attemptPlayerMove(dir);
}

function moves(engine: GameEngine, path: string): void {
  const dirs: Record<string, Direction> = { N: 'N', E: 'E', S: 'S', W: 'W' };
  for (const ch of path) move(engine, dirs[ch]);
}

const tileAt = (engine: GameEngine, x: number, y: number): string => engine.getTerrain()[y][x];

beforeEach(() => {
  loadTestConfigs();
});

describe('hold doors and pressure plates', () => {
  it('opens a hold door only while every plate of its colour is pressed', () => {
    // Two red plates: the player holds the first, the dirt block is pushed onto the second.
    const engine = engineFor(['########', '#Pr2.r.#', '#..R...#', '########']);
    expect(tileAt(engine, 3, 2)).toBe('hold_door_red_closed');
    moves(engine, 'E');
    expect(engine.getPlayer().x).toBe(2);
    // One plate pressed out of two: the door stays shut.
    expect(tileAt(engine, 3, 2)).toBe('hold_door_red_closed');
    // The next push moves the block to (4, 1), the player to (3, 1): the first plate is free again.
    moves(engine, 'E');
    expect(tileAt(engine, 3, 2)).toBe('hold_door_red_closed');
    // Push again: the block reaches the second plate at (5, 1) and the player leaves the first one.
    moves(engine, 'E');
    expect(engine.getEntities()[0]).toMatchObject({ x: 5, y: 1 });
    expect(tileAt(engine, 3, 2)).toBe('hold_door_red_closed');
    // Back to the first plate: both are pressed, the door opens.
    moves(engine, 'WW');
    expect(engine.getPlayer().x).toBe(2);
    expect(tileAt(engine, 3, 2)).toBe('hold_door_red_open');
    // Stepping off the first plate shuts it again.
    moves(engine, 'W');
    expect(tileAt(engine, 3, 2)).toBe('hold_door_red_closed');
  });

  it('keeps a hold door closed when its colour has no plate, even with other colours pressed', () => {
    const engine = engineFor(['######', '#Pb.R#', '######']);
    moves(engine, 'E');
    expect(engine.getPlayer().x).toBe(2);
    expect(tileAt(engine, 4, 1)).toBe('hold_door_red_closed');
  });

  it('keeps a colour channel apart from the others', () => {
    const engine = engineFor(['########', '#Pr.b..#', '#.R.B..#', '########']);
    moves(engine, 'E');
    expect(tileAt(engine, 2, 2)).toBe('hold_door_red_open');
    expect(tileAt(engine, 4, 2)).toBe('hold_door_blue_closed');
  });

  it('is pressed by the player', () => {
    const engine = engineFor(['######', '#PrR.#', '######']);
    expect(tileAt(engine, 3, 1)).toBe('hold_door_red_closed');
    moves(engine, 'E');
    expect(tileAt(engine, 3, 1)).toBe('hold_door_red_open');
  });

  it('is pressed by a plain block and by a colour block of the plate colour only', () => {
    const rows = ['######', '#P.rR#', '######'];
    const door = (type: string): string => tileAt(engineWith(rows, [{ type, x: 3, y: 1, dir: 'S' }]), 4, 1);
    expect(door('dirt_block')).toBe('hold_door_red_open');
    expect(door('ice_block')).toBe('hold_door_red_open');
    expect(door('color_block_red')).toBe('hold_door_red_open');
    expect(door('color_block_blue')).toBe('hold_door_red_closed');
    expect(door('color_block_green')).toBe('hold_door_red_closed');
  });

  it('is not pressed by a monster unless its definition says so', () => {
    const rows = ['######', '#P.rR#', '######'];
    const monster: EntityPlacement[] = [{ type: 'blob', x: 3, y: 1, dir: 'S' }];
    expect(tileAt(engineWith(rows, monster), 4, 1)).toBe('hold_door_red_closed');
    const def = ConfigRegistry.getEntityDef('blob');
    if (!def) throw new Error('blob is not defined');
    def.pressesPlates = true;
    expect(tileAt(engineWith(rows, monster), 4, 1)).toBe('hold_door_red_open');
  });

  it('does not count a sliding block as pressing a plate', () => {
    // A block pushed onto ice slides on; it passes the plate without pressing it.
    const engine = engineFor(['#########', '#P2iiriR.#', '#########']);
    move(engine, 'E');
    const block = engine.getEntities()[0];
    expect(block.isSliding).toBe(true);
    expect(tileAt(engine, 7, 1)).toBe('hold_door_red_closed');
  });

  it('starts open when a block already stands on the plate at load', () => {
    const engine = engineWith(['#####', '#PrR#', '#####'], [{ type: 'dirt_block', x: 2, y: 1, dir: 'S' }]);
    expect(tileAt(engine, 3, 1)).toBe('hold_door_red_open');
  });

  it('closes on an occupant at once: the occupant may leave, nobody may enter', () => {
    // The player starts on an open door whose plate is free: the door shuts under them.
    const engine = engineFor(['######', '#pr..#', '######']);
    expect(tileAt(engine, 1, 1)).toBe('hold_door_red_closed');
    expect(move(engine, 'E')).toBe(true);
    expect(engine.getPlayer().x).toBe(2);
    // On the plate: the door opens. Off the plate: it shuts, and the player cannot go back in.
    expect(tileAt(engine, 1, 1)).toBe('hold_door_red_open');
    expect(move(engine, 'E')).toBe(true);
    expect(tileAt(engine, 1, 1)).toBe('hold_door_red_closed');
    expect(move(engine, 'W')).toBe(true);
    expect(move(engine, 'W')).toBe(true);
    expect(engine.getPlayer().x).toBe(1);
  });

  it('keeps a door open under an occupant when the door asks for it, and shuts it once free', () => {
    const def = ConfigRegistry.getTile('hold_door_red_open');
    def.holdDoorClosesOnOccupant = false;
    const engine = engineFor(['######', '#pr..#', '######']);
    expect(tileAt(engine, 1, 1)).toBe('hold_door_red_open');
    expect(move(engine, 'E')).toBe(true);
    expect(tileAt(engine, 1, 1)).toBe('hold_door_red_open');
    expect(move(engine, 'E')).toBe(true);
    expect(tileAt(engine, 1, 1)).toBe('hold_door_red_closed');
  });

  it('puts the doors back with the rest of the state on undo', () => {
    const engine = engineFor(['#######', '#Pr.R.#', '#######']);
    moves(engine, 'E');
    expect(tileAt(engine, 4, 1)).toBe('hold_door_red_open');
    moves(engine, 'E');
    expect(tileAt(engine, 4, 1)).toBe('hold_door_red_closed');
    expect(engine.undo()).toBe(true);
    expect(engine.getPlayer().x).toBe(2);
    expect(tileAt(engine, 4, 1)).toBe('hold_door_red_open');
    expect(engine.undo()).toBe(true);
    expect(engine.getPlayer().x).toBe(1);
    expect(tileAt(engine, 4, 1)).toBe('hold_door_red_closed');
  });

  it('is opaque to a laser while closed and lets it through while open', () => {
    const engine = engineFor(['#########', '#>..R..L#', '#P.r....#', '#########']);
    expect(engine.getLitReceivers()).toHaveLength(0);
    expect(engine.getBeamCells().some((c) => c.x === 5)).toBe(false);
    moves(engine, 'EE');
    expect(engine.getPlayer()).toMatchObject({ x: 3, y: 2 });
    expect(tileAt(engine, 4, 1)).toBe('hold_door_red_open');
    expect(engine.getLitReceivers()).toHaveLength(1);
    moves(engine, 'E');
    expect(tileAt(engine, 4, 1)).toBe('hold_door_red_closed');
    expect(engine.getLitReceivers()).toHaveLength(0);
  });
});

describe('colour toggle walls', () => {
  it('lets a green button leave the red walls alone', () => {
    const engine = engineFor(['########', '#P[.xwv#', '########']);
    moves(engine, 'E');
    expect(tileAt(engine, 4, 1)).toBe('toggle_wall_red_closed');
    expect(tileAt(engine, 5, 1)).toBe('toggle_wall_open');
    expect(tileAt(engine, 6, 1)).toBe('toggle_wall_closed');
  });

  it('lets a red toggle button swap the red walls only', () => {
    const engine = engineFor(['#########', '#Pk.xXzw#', '#########']);
    moves(engine, 'E');
    expect(tileAt(engine, 4, 1)).toBe('toggle_wall_red_open');
    expect(tileAt(engine, 5, 1)).toBe('toggle_wall_red_closed');
    expect(tileAt(engine, 6, 1)).toBe('toggle_wall_blue_closed');
    expect(tileAt(engine, 7, 1)).toBe('toggle_wall_closed');
  });

  it('lets a blue toggle button leave the red walls alone and swap the blue ones', () => {
    const engine = engineFor(['########', '#PK.xz#', '########']);
    moves(engine, 'E');
    expect(tileAt(engine, 4, 1)).toBe('toggle_wall_red_closed');
    expect(tileAt(engine, 5, 1)).toBe('toggle_wall_blue_open');
  });

  it('swaps a colour wall even when a block stands in it', () => {
    const engine = engineWith(['#######', '#PkX..#', '#######'], [{ type: 'dirt_block', x: 3, y: 1, dir: 'S' }]);
    moves(engine, 'E');
    expect(tileAt(engine, 3, 1)).toBe('toggle_wall_red_closed');
  });
});

describe('colour blocks and floating blocks', () => {
  it('turns a colour block that enters water into a floating block the player can cross', () => {
    const engine = engineFor(['#######', '#P1W.E#', '#######']);
    moves(engine, 'E');
    expect(engine.getEntities()).toHaveLength(0);
    expect(tileAt(engine, 3, 1)).toBe('floating_block_red');
    moves(engine, 'EE');
    expect(engine.getPlayer()).toMatchObject({ x: 4, alive: true });
  });

  it('floats a blue block into its own colour', () => {
    const engine = engineFor(['#######', '#P3W.E#', '#######']);
    moves(engine, 'E');
    expect(tileAt(engine, 3, 1)).toBe('floating_block_blue');
  });

  it('keeps the dirt block and the ice block as they were in water', () => {
    const dirt = engineFor(['#######', '#P2W.E#', '#######']);
    moves(dirt, 'E');
    expect(tileAt(dirt, 3, 1)).toBe('dirt');
    const ice = engineFor(['#######', '#P4W.E#', '#######']);
    moves(ice, 'E');
    for (let i = 0; i < COOLDOWN_TICKS * 2; i++) ice.tick();
    expect(tileAt(ice, 3, 1)).toBe('water');
  });

  it('lets a bomb on the water destroy a colour block and leaves the water as it is', () => {
    const engine = engineFor(['#######', '#P1W.E#', '#######'], { '3,1': 'bomb' });
    moves(engine, 'E');
    expect(engine.getEntities()).toHaveLength(0);
    expect(tileAt(engine, 3, 1)).toBe('water');
    expect(engine.getItems()[1][3]).toBeNull();
  });

  it('turns slime under a colour block into floor, not a floating block', () => {
    const engine = engineFor(['#######', '#P1M.E#', '#######']);
    moves(engine, 'E');
    expect(engine.getEntities()).toHaveLength(0);
    expect(tileAt(engine, 3, 1)).toBe('floor');
  });

  it('walks over a floating block as over floor, with no block left to push', () => {
    const engine = engineFor(['######', '#PF.E#', '######']);
    expect(engine.getEntities()).toHaveLength(0);
    moves(engine, 'E');
    expect(engine.getPlayer().x).toBe(2);
  });
});

describe('colour channels in the validator and the helpers', () => {
  const issueKeys = (rows: string[], items: Record<string, string> = {}): string[] =>
    LevelValidator.validate(room(rows, items)).issues.map((i) => i.i18nKey);

  it('lets a green button leave a red wall shut, but a red button open it', () => {
    expect(issueKeys(['#######', '#P[.xE#', '#######'])).toContain('validator.issues.unreachable_exit.label');
    expect(issueKeys(['#######', '#Pk.xE#', '#######'])).not.toContain('validator.issues.unreachable_exit.label');
    // A blue button does not open a red wall either.
    expect(issueKeys(['#######', '#PK.xE#', '#######'])).toContain('validator.issues.unreachable_exit.label');
  });

  it('passes a hold door only when blocks can hold every plate of its colour', () => {
    const noBlock = ['#########', '#P.r.RE.#', '#########'];
    expect(issueKeys(noBlock)).toContain('validator.issues.unreachable_exit.label');
    const withBlock = ['#########', '#P2r.RE.#', '#########'];
    expect(issueKeys(withBlock)).not.toContain('validator.issues.unreachable_exit.label');
    // A blue block cannot hold a red plate.
    expect(issueKeys(['#########', '#P3r.RE.#', '#########'])).toContain('validator.issues.unreachable_exit.label');
    expect(issueKeys(['#########', '#P1r.RE.#', '#########'])).not.toContain('validator.issues.unreachable_exit.label');
  });

  it('warns about a hold door with no plate, orphan channel walls and buttons, and a door placed against its plates', () => {
    expect(issueKeys(['######', '#P.RE#', '######'])).toContain('validator.issues.hold_door_no_plate.label');
    expect(issueKeys(['######', '#P.xE#', '######'])).toContain('validator.issues.channel_walls_no_button.label');
    expect(issueKeys(['######', '#PkxE#', '######'])).not.toContain('validator.issues.channel_walls_no_button.label');
    expect(issueKeys(['######', '#PkIE#', '######'])).toContain('validator.issues.channel_button_no_walls.label');
    // A block on the plate at the start keeps the door open: placed closed, it is the wrong way round.
    const wrong = LevelValidator.validate(room(['#######', '#P2rRE#', '#######']));
    expect(wrong.issues.map((i) => i.i18nKey)).not.toContain('validator.issues.hold_door_wrong_start.label');
    const placedClosed = room(['#######', '#Pr.RE#', '#######']);
    placedClosed.entities = [{ type: 'dirt_block', x: 2, y: 1, dir: 'S' }];
    const report = LevelValidator.validate(placedClosed);
    expect(report.issues.map((i) => i.i18nKey)).toContain('validator.issues.hold_door_wrong_start.label');
    expect(report.issues.every((i) => i.severity === 'warning' || i.i18nKey.includes('unreachable'))).toBe(true);
  });

  it('counts the channel mechanics of a level', () => {
    const mechanics = LevelMetrics.measure(room(['#########', '#Pkx2rRE#', '#########'])).mechanics;
    expect(mechanics).toContain(MECHANICS.PLATES_HOLD_DOORS);
    expect(mechanics).toContain(MECHANICS.TOGGLE_WALLS);
    expect(mechanics).not.toContain(MECHANICS.COLOR_BLOCKS);
    const withBlock = room(['#####', '#P.E#', '#####']);
    withBlock.entities = [{ type: 'color_block_red', x: 2, y: 1, dir: 'S' }];
    expect(LevelMetrics.measure(withBlock).mechanics).toContain(MECHANICS.COLOR_BLOCKS);
  });

  it('treats channel walls and hold doors as walkable for the metrics and as reversible for the difficulty count', () => {
    for (const id of ['toggle_wall_red_closed', 'hold_door_blue_closed', 'hold_door_blue_open']) {
      expect(isPlayerWalkable(ConfigRegistry.getTile(id)), id).toBe(true);
    }
    expect(terrainEventKind('toggle_wall_red_closed', 'toggle_wall_red_open')).toBeNull();
    expect(terrainEventKind('hold_door_red_closed', 'hold_door_red_open')).toBeNull();
  });

  it('points the objective at a colour button only when a wall of its channel is shut', () => {
    expect(Pathfinder.findNextObjective(engineFor(['#######', '#Pk.xE#', '#######']))).toEqual({ x: 2, y: 1 });
    expect(Pathfinder.findNextObjective(engineFor(['#######', '#PK.xE#', '#######']))).toBeNull();
    expect(Pathfinder.findNextObjective(engineFor(['#######', '#P[.xE#', '#######']))).toBeNull();
  });
});
