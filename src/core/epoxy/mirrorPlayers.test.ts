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
import { findMonsterBehaviourConfigErrors } from '../../config/ConfigValidation';
import { PACK_JSON_VERSION_V13 } from '../../config/constants';
import { ENTITY_MAP } from '../../formats/cc2Mapping';
import en from '../../locales/en.json';
import fr from '../../locales/fr.json';
import { serializePack } from '../../packs/packJson';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { MELINDA_CHARACTER } from '../coreConstants';
import { GameEngine } from '../GameEngine';
import { LevelValidator } from '../LevelValidator';
import type { CompiledLevel, Direction, EntityDefinition, EntityPlacement, PlayerCharacter } from '../types';

const SIZE = 13;
const CENTER = 6;
const TIME_LIMIT_SECONDS = 1000;
const MIRROR_CHIP = 'mirror_chip';
const MIRROR_MELINDA = 'mirror_melinda';
const MIRRORS = [MIRROR_CHIP, MIRROR_MELINDA];
/** Ticks that let the player walk again after a step. */
const WALK_WAIT_TICKS = 6;
/** Ticks that let a sliding mirror cross several ice cells. */
const SLIDE_TICKS = 40;

interface Setup {
  entities: EntityPlacement[];
  terrain?: Array<[number, number, string]>;
  items?: Array<[number, number, string]>;
  player?: { x: number; y: number };
  character?: PlayerCharacter;
}

/** Walled floor room; the player starts at the centre unless the setup says otherwise. */
function room(setup: Setup): CompiledLevel {
  const terrain: string[][] = Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x) => (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? 'wall' : 'floor'))
  );
  for (const [x, y, id] of setup.terrain ?? []) terrain[y][x] = id;
  const items: Array<Array<string | null>> = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null));
  for (const [x, y, id] of setup.items ?? []) items[y][x] = id;
  return {
    id: 'mirror_room',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: TIME_LIMIT_SECONDS,
    chipsRequired: 0,
    playerStart: { ...(setup.player ?? { x: CENTER, y: CENTER }), dir: 'N' },
    terrain,
    items,
    entities: setup.entities,
    trapLinks: [],
    cloneLinks: [],
    ...(setup.character ? { character: setup.character } : {})
  };
}

function mirror(type: string, x: number, y: number, dir: Direction = 'N'): EntityPlacement {
  return { type, x, y, dir };
}

function load(level: CompiledLevel): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(level);
  return engine;
}

function run(engine: GameEngine, count: number): void {
  for (let i = 0; i < count; i++) engine.tick();
}

/** The player attempts one move, then waits for the walking cooldown. */
function walk(engine: GameEngine, dir: Direction): void {
  engine.attemptPlayerMove(dir);
  run(engine, WALK_WAIT_TICKS);
}

function cellOf(engine: GameEngine, type: string): string {
  const found = engine.getEntities().find((e) => e.type === type);
  return found ? `${found.x},${found.y}` : 'gone';
}

const at = (x: number, y: number): string => `${x},${y}`;

beforeEach(() => {
  loadTestConfigs();
});

describe('mirror players: configuration', () => {
  it('defines the two mirrors as Epoxy-only stationary monsters with their character and key', () => {
    const expected: Array<[string, PlayerCharacter, string]> = [
      [MIRROR_CHIP, 'chip', 'key_green'],
      [MIRROR_MELINDA, 'melinda', 'key_yellow']
    ];
    for (const [id, character, key] of expected) {
      const def = ConfigRegistry.getEntityDef(id);
      expect(def?.kind, id).toBe('monster');
      expect(def?.epoxyOnly, id).toBe(true);
      expect(def?.mirrorsCharacter, id).toBe(character);
      expect(def?.mirrorKey, id).toBe(key);
      expect(def?.movementPattern, id).toBe('stationary');
      expect(typeof en.entities[id as keyof typeof en.entities].name, id).toBe('string');
      expect(typeof fr.entities[id as keyof typeof fr.entities].name, id).toBe('string');
    }
  });

  it('passes the behaviour checks and refuses malformed mirror fields', () => {
    const tiles = ConfigRegistry.getTiles().tiles;
    expect(findMonsterBehaviourConfigErrors(tiles, ConfigRegistry.getMonsters().entities)).toEqual([]);
    const entities = (patch: Partial<EntityDefinition>, base = MIRROR_CHIP): Record<string, EntityDefinition> => ({
      ...ConfigRegistry.getMonsters().entities,
      [base]: { ...(ConfigRegistry.getMonsters().entities[base] as EntityDefinition), ...patch }
    });
    expect(findMonsterBehaviourConfigErrors(tiles, entities({ mirrorsCharacter: 'nobody' as PlayerCharacter }))).toEqual([
      'mirror_chip.mirrorsCharacter: unknown character nobody'
    ]);
    expect(findMonsterBehaviourConfigErrors(tiles, entities({ movementPattern: 'bounce' }))).toEqual([
      'mirror_chip.mirrorsCharacter: a mirror moves only with the player, so it needs the pattern "stationary"'
    ]);
    expect(findMonsterBehaviourConfigErrors(tiles, entities({ mirrorKey: 'floor' }))).toEqual([
      'mirror_chip.mirrorKey: "floor" is not the id of an existing key'
    ]);
    expect(findMonsterBehaviourConfigErrors(tiles, entities({ mirrorKey: 'key_green' }, 'bug'))).toEqual([
      'bug.mirrorKey: only a mirror player has this field'
    ]);
  });
});

describe('mirror players: copying the move', () => {
  it('steps the way the player steps', () => {
    const engine = load(room({ entities: [mirror(MIRROR_CHIP, 3, 3)] }));
    walk(engine, 'E');
    expect(cellOf(engine, MIRROR_CHIP)).toBe(at(4, 3));
    walk(engine, 'S');
    expect(cellOf(engine, MIRROR_CHIP)).toBe(at(4, 4));
    expect(engine.getPlayer()).toMatchObject({ x: CENTER + 1, y: CENTER + 1 });
  });

  it('copies a move the player attempts into a wall, and the mirror steps if its way is free', () => {
    const engine = load(room({ player: { x: CENTER, y: 1 }, entities: [mirror(MIRROR_CHIP, 3, 5)] }));
    walk(engine, 'N');
    expect(engine.getPlayer()).toMatchObject({ x: CENTER, y: 1 });
    expect(cellOf(engine, MIRROR_CHIP)).toBe(at(3, 4));
  });

  it('stays where a wall stops it while the player moves on', () => {
    const engine = load(room({ entities: [mirror(MIRROR_CHIP, 3, 1)] }));
    walk(engine, 'N');
    expect(cellOf(engine, MIRROR_CHIP)).toBe(at(3, 1));
    expect(engine.getPlayer()).toMatchObject({ x: CENTER, y: CENTER - 1 });
  });

  it('follows only the character it mirrors', () => {
    const chip = load(room({ entities: [mirror(MIRROR_CHIP, 3, 3), mirror(MIRROR_MELINDA, 9, 3)] }));
    walk(chip, 'E');
    expect(cellOf(chip, MIRROR_CHIP)).toBe(at(4, 3));
    expect(cellOf(chip, MIRROR_MELINDA)).toBe(at(9, 3));
    const melinda = load(room({ character: MELINDA_CHARACTER, entities: [mirror(MIRROR_CHIP, 3, 3), mirror(MIRROR_MELINDA, 9, 3)] }));
    walk(melinda, 'E');
    expect(cellOf(melinda, MIRROR_CHIP)).toBe(at(3, 3));
    expect(cellOf(melinda, MIRROR_MELINDA)).toBe(at(10, 3));
  });

  it('steps the front mirror of a line first, so a line of mirrors moves together', () => {
    const engine = load(room({ entities: [mirror(MIRROR_CHIP, 3, 3), mirror(MIRROR_CHIP, 4, 3), mirror(MIRROR_CHIP, 5, 3)] }));
    walk(engine, 'E');
    expect(engine.getEntities().map((e) => at(e.x, e.y)).sort()).toEqual([at(4, 3), at(5, 3), at(6, 3)]);
  });

  it('does not move on its own', () => {
    const engine = load(room({ entities: [mirror(MIRROR_CHIP, 3, 3)] }));
    run(engine, 100);
    expect(cellOf(engine, MIRROR_CHIP)).toBe(at(3, 3));
  });
});

describe('mirror players: the terrain of their character', () => {
  it('slides Chip mirror on ice and not Melinda mirror', () => {
    const iceRow: Array<[number, number, string]> = [3, 4, 5, 6, 7, 8].map((x) => [x, 3, 'ice']);
    const setup = { terrain: iceRow, player: { x: CENTER, y: 9 } };
    const chip = load(room({ ...setup, entities: [mirror(MIRROR_CHIP, 3, 3)] }));
    walk(chip, 'E');
    run(chip, SLIDE_TICKS);
    // The slide goes on to the wall and bounces back: the mirror is no longer where one step left it.
    expect(cellOf(chip, MIRROR_CHIP)).not.toBe(at(4, 3));
    const melinda = load(room({ ...setup, character: MELINDA_CHARACTER, entities: [mirror(MIRROR_MELINDA, 3, 3)] }));
    walk(melinda, 'E');
    run(melinda, SLIDE_TICKS);
    expect(cellOf(melinda, MIRROR_MELINDA)).toBe(at(4, 3));
  });

  it('stops Melinda mirror at dirt and gravel but lets Chip mirror through', () => {
    const terrain: Array<[number, number, string]> = [
      [4, 3, 'gravel'],
      [4, 5, 'dirt']
    ];
    const melinda = load(
      room({ terrain, character: MELINDA_CHARACTER, entities: [mirror(MIRROR_MELINDA, 3, 3), mirror(MIRROR_MELINDA, 3, 5)] })
    );
    walk(melinda, 'E');
    expect(melinda.getEntities().map((e) => at(e.x, e.y)).sort()).toEqual([at(3, 3), at(3, 5)]);
    const chip = load(room({ terrain, entities: [mirror(MIRROR_CHIP, 3, 3), mirror(MIRROR_CHIP, 3, 5)] }));
    walk(chip, 'E');
    expect(chip.getEntities().map((e) => at(e.x, e.y)).sort()).toEqual([at(4, 3), at(4, 5)]);
    expect(chip.getTerrain()[5][4]).toBe('floor');
  });

  it('is stopped by the gender sign of the other character', () => {
    const terrain: Array<[number, number, string]> = [[4, 3, 'sign_melinda_only']];
    const engine = load(room({ terrain, entities: [mirror(MIRROR_CHIP, 3, 3)] }));
    walk(engine, 'E');
    expect(cellOf(engine, MIRROR_CHIP)).toBe(at(3, 3));
  });

  it('opens a door of its own key colour without a key and without using one up', () => {
    const terrain: Array<[number, number, string]> = [
      [4, 3, 'door_green'],
      [4, 5, 'door_yellow']
    ];
    const engine = load(room({ terrain, entities: [mirror(MIRROR_CHIP, 3, 3), mirror(MIRROR_CHIP, 3, 5)] }));
    walk(engine, 'E');
    expect(engine.getEntities().map((e) => at(e.x, e.y)).sort()).toEqual([at(3, 5), at(4, 3)]);
    expect(engine.getTerrain()[3][4]).toBe('floor');
    expect(engine.getTerrain()[5][4]).toBe('door_yellow');
    const melinda = load(room({ terrain, character: MELINDA_CHARACTER, entities: [mirror(MIRROR_MELINDA, 3, 3), mirror(MIRROR_MELINDA, 3, 5)] }));
    walk(melinda, 'E');
    expect(melinda.getEntities().map((e) => at(e.x, e.y)).sort()).toEqual([at(3, 3), at(4, 5)]);
  });

  it('does not open a socket', () => {
    const engine = load(room({ terrain: [[4, 3, 'socket']], entities: [mirror(MIRROR_CHIP, 3, 3)] }));
    walk(engine, 'E');
    expect(cellOf(engine, MIRROR_CHIP)).toBe(at(3, 3));
  });

  it('pushes a block', () => {
    const engine = load(room({ entities: [mirror(MIRROR_CHIP, 3, 3), { type: 'dirt_block', x: 4, y: 3, dir: 'N' }] }));
    walk(engine, 'E');
    expect(cellOf(engine, MIRROR_CHIP)).toBe(at(4, 3));
    expect(cellOf(engine, 'dirt_block')).toBe(at(5, 3));
  });

  it('is blocked by a monster', () => {
    const engine = load(room({ entities: [mirror(MIRROR_CHIP, 3, 3), { type: 'bug', x: 4, y: 3, dir: 'N' }] }));
    walk(engine, 'E');
    expect(cellOf(engine, MIRROR_CHIP)).toBe(at(3, 3));
  });
});

describe('mirror players: items, hazards and contact', () => {
  it('takes keys and boots on its way but leaves chips', () => {
    const engine = load(
      room({
        items: [
          [4, 3, 'key_red'],
          [4, 5, 'chip'],
          [4, 7, 'hiking_boots']
        ],
        entities: [mirror(MIRROR_CHIP, 3, 3), mirror(MIRROR_CHIP, 3, 5), mirror(MIRROR_CHIP, 3, 7)]
      })
    );
    walk(engine, 'E');
    const items = engine.getItems();
    expect(items[3][4]).toBeNull();
    expect(items[5][4]).toBe('chip');
    expect(items[7][4]).toBeNull();
  });

  it('dies in water, fire and bombs and the level goes on', () => {
    const engine = load(
      room({
        terrain: [
          [4, 3, 'water'],
          [4, 5, 'fire']
        ],
        items: [[4, 7, 'bomb']],
        entities: [mirror(MIRROR_CHIP, 3, 3), mirror(MIRROR_CHIP, 3, 5), mirror(MIRROR_CHIP, 3, 7)]
      })
    );
    walk(engine, 'E');
    expect(engine.getEntities()).toEqual([]);
    expect(engine.getPlayer().alive).toBe(true);
    expect(engine.isLevelCompleted()).toBe(false);
  });

  it('presses the buttons it steps on', () => {
    const engine = load(
      room({
        terrain: [
          [4, 3, 'button_green'],
          [9, 9, 'toggle_wall_closed']
        ],
        entities: [mirror(MIRROR_CHIP, 3, 3)]
      })
    );
    walk(engine, 'E');
    expect(engine.getTerrain()[9][9]).toBe('toggle_wall_open');
  });

  it('kills the player who steps into a mirror', () => {
    const engine = load(room({ player: { x: 5, y: 3 }, entities: [mirror(MIRROR_CHIP, 4, 3)] }));
    engine.attemptPlayerMove('W');
    expect(engine.getPlayer().alive).toBe(false);
  });

  it('kills the player when the mirror steps into the cell the player holds', () => {
    // The player is against the west wall: the attempt is refused, yet the mirror copies it and steps onto the player.
    const engine = load(room({ player: { x: 1, y: 3 }, entities: [mirror(MIRROR_CHIP, 2, 3)] }));
    engine.attemptPlayerMove('W');
    expect(engine.getPlayer().alive).toBe(false);
  });

  it('copies a forced slide step the wall refuses', () => {
    // The player steps onto ice beside the east wall, and the slide then runs into the wall. The mirror copies that
    // refused step too: it walks into the water one cell on and dies, which the bounce back alone would never do.
    const terrain: Array<[number, number, string]> = [
      [11, 3, 'ice'],
      [4, 8, 'water']
    ];
    const engine = load(room({ terrain, player: { x: 10, y: 3 }, entities: [mirror(MIRROR_CHIP, 2, 8)] }));
    engine.attemptPlayerMove('E');
    expect(cellOf(engine, MIRROR_CHIP)).toBe(at(3, 8));
    run(engine, SLIDE_TICKS);
    expect(cellOf(engine, MIRROR_CHIP)).toBe('gone');
  });

  it('puts the mirror state back on undo', () => {
    const engine = load(room({ entities: [mirror(MIRROR_CHIP, 3, 3)] }));
    walk(engine, 'E');
    expect(cellOf(engine, MIRROR_CHIP)).toBe(at(4, 3));
    expect(engine.undo()).toBe(true);
    expect(cellOf(engine, MIRROR_CHIP)).toBe(at(3, 3));
  });
});

describe('mirror players: validator, pack format and import', () => {
  it('keeps a level winnable whose exit lies behind a door only the mirror of that colour opens', () => {
    const wall = (x: number, y: number): [number, number, string] => [x, y, 'wall'];
    // A corridor closed by a green door, with the exit beyond it and no green key anywhere.
    const terrain: Array<[number, number, string]> = [
      ...[1, 2, 3].flatMap((y) => [wall(7, y), wall(8, y)].filter(([, row]) => row !== 2)),
      [7, 2, 'door_green'],
      [8, 2, 'floor'],
      [10, 2, 'exit']
    ];
    for (const y of [1, 3]) terrain.push(wall(9, y));
    const closed = room({ terrain, player: { x: 2, y: 2 }, entities: [] });
    const withMirror = room({ terrain, player: { x: 2, y: 2 }, entities: [mirror(MIRROR_CHIP, 3, 2)] });
    const errorsOf = (level: CompiledLevel): string[] =>
      LevelValidator.validate(level)
        .issues.filter((issue) => issue.severity === 'error')
        .map((issue) => issue.i18nKey);
    expect(errorsOf(closed).length).toBeGreaterThan(0);
    expect(errorsOf(withMirror)).toEqual([]);
  });

  it('counts only the mirror of the level character for the doors it opens', () => {
    const wall = (x: number, y: number): [number, number, string] => [x, y, 'wall'];
    const terrain: Array<[number, number, string]> = [wall(7, 1), wall(7, 3), [7, 2, 'door_green'], [8, 2, 'exit']];
    const errorsOf = (level: CompiledLevel): string[] =>
      LevelValidator.validate(level)
        .issues.filter((issue) => issue.severity === 'error')
        .map((issue) => issue.i18nKey);
    for (let y = 1; y < 4; y++) terrain.push(wall(9, y));
    expect(errorsOf(room({ terrain, player: { x: 2, y: 2 }, entities: [mirror(MIRROR_CHIP, 3, 2)] }))).toEqual([]);
    // Melinda plays: a mirror Chip never moves, so it opens nothing.
    expect(errorsOf(room({ terrain, character: MELINDA_CHARACTER, player: { x: 2, y: 2 }, entities: [mirror(MIRROR_CHIP, 3, 2)] })).length).toBeGreaterThan(0);
  });

  it('keeps a level with mirrors on a plain floor free of errors', () => {
    const level = room({ terrain: [[10, 10, 'exit']], entities: [mirror(MIRROR_CHIP, 3, 3), mirror(MIRROR_MELINDA, 9, 9)] });
    expect(LevelValidator.validate(level).issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  });

  it('writes a pack holding a mirror as format 13', () => {
    for (const id of MIRRORS) {
      const level = room({ entities: [mirror(id, 3, 3)] });
      expect(JSON.parse(serializePack('p', [level])).version, id).toBe(PACK_JSON_VERSION_V13);
    }
  });

  it('maps the CC2 mirror player codes to the mirrors', () => {
    expect(ENTITY_MAP.get(0x65)).toEqual({ id: MIRROR_CHIP, key: MIRROR_CHIP });
    expect(ENTITY_MAP.get(0x66)).toEqual({ id: MIRROR_MELINDA, key: MIRROR_MELINDA });
  });
});
