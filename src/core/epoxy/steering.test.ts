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
import { findSteeringConfigErrors } from '../../config/ConfigValidation';
import en from '../../locales/en.json';
import fr from '../../locales/fr.json';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { STEER_MONSTERS_ACTION } from '../coreConstants';
import { GameEngine } from '../GameEngine';
import { LevelValidator } from '../LevelValidator';
import { steerMonsters } from './epoxySteering';
import type { EpoxyContext, EpoxyWorld } from './epoxyWorld';
import type { CompiledLevel, Direction, EntityDefinition, EntityPlacement, RuntimeEntity, TileDefinition } from '../types';

const SIZE = 11;
const ROW = 5;
const PLAYER_X = 4;
const PAD_X = 5;
const TIME_LIMIT_SECONDS = 100;
const MAX_WAIT_TICKS = 40;
const PUPPET = 'puppet';
const PAD = 'puppet_control';
const SLIDE_TICKS = 40;
const IDLE_TICKS = 200;

interface Setup {
  entities?: EntityPlacement[];
  /** Terrain edits: x, y, tile id. */
  terrain?: Array<[number, number, string]>;
  /** Item edits: x, y, item id. */
  items?: Array<[number, number, string]>;
  cloneLinks?: CompiledLevel['cloneLinks'];
  /** Where the player starts; by default one step west of the control of the row. */
  player?: { x: number; y: number };
  /** Leaves the default control out of the row. */
  noPad?: boolean;
}

/** Walled floor room with the control at (5, 5) and the player one step west of it. */
function room(setup: Setup = {}): CompiledLevel {
  const terrain: string[][] = Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x) => (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? 'wall' : 'floor'))
  );
  if (!setup.noPad) terrain[ROW][PAD_X] = PAD;
  for (const [x, y, id] of setup.terrain ?? []) terrain[y][x] = id;
  const items: Array<Array<string | null>> = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null));
  for (const [x, y, id] of setup.items ?? []) items[y][x] = id;
  const player = setup.player ?? { x: PLAYER_X, y: ROW };
  return {
    id: 'steering_room',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: TIME_LIMIT_SECONDS,
    chipsRequired: 0,
    playerStart: { ...player, dir: 'E' },
    terrain,
    items,
    entities: setup.entities ?? [],
    trapLinks: [],
    cloneLinks: setup.cloneLinks ?? []
  };
}

function placed(type: string, x: number, y: number, dir: Direction = 'E'): EntityPlacement {
  return { type, x, y, dir };
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

function run(engine: GameEngine, count: number): void {
  for (let i = 0; i < count; i++) engine.tick();
}

/** The cell of every entity of a type, in list order. */
function cellsOf(engine: GameEngine, type: string): string[] {
  return engine
    .getEntities()
    .filter((e) => e.type === type)
    .map((e) => `${e.x},${e.y}`);
}

function puppetAt(engine: GameEngine, index = 0): RuntimeEntity {
  const found = engine.getEntities().filter((e) => e.type === PUPPET)[index];
  if (!found) throw new Error(`no puppet ${index}`);
  return found;
}

/** The player steps east onto the control from one cell west of it. */
function stepOntoPad(engine: GameEngine): void {
  expect(step(engine, 'E')).toBe(true);
  expect(engine.getPlayer().x).toBe(PAD_X);
}

/** Puts the player on a cell without a move, for tests that call the steering directly. */
function placePlayer(engine: GameEngine, x: number, y: number): EpoxyWorld {
  const w = world(engine);
  w.player.x = x;
  w.player.y = y;
  w.player.dir = 'E';
  return w;
}

beforeEach(() => {
  loadTestConfigs();
});

describe('steering: configuration', () => {
  it('defines the puppet as a monster steered by the control, with no pattern of its own', () => {
    const def = ConfigRegistry.getEntityDef(PUPPET) as EntityDefinition;
    expect(def.kind).toBe('monster');
    expect(def.steeredBy).toBe(STEER_MONSTERS_ACTION);
    expect(def.pressesPlates).toBe(true);
    expect(def.pushesBlocks).toBe(true);
    expect(def.passesTiles).toEqual(['gravel', 'fire']);
    expect(def.movementPattern).toBeUndefined();
    expect(def.immuneToWater).toBe(false);
    expect(def.immuneToFire).toBe(false);
  });

  it('defines the control as a button only the player works', () => {
    const tile = ConfigRegistry.getTile(PAD);
    expect(tile.buttonAction).toBe(STEER_MONSTERS_ACTION);
    expect(tile.buttonWorkedBy).toBe('player');
    expect(tile.passableByPlayer).toBe(true);
    expect(tile.passableByMonster).toBe(true);
    expect(tile.passableByBlock).toBe(true);
  });

  it('accepts the shipped configs', () => {
    expect(findSteeringConfigErrors(ConfigRegistry.getTiles().tiles, ConfigRegistry.getMonsters().entities)).toEqual([]);
  });

  it('refuses a steeredBy action no tile carries, an unknown tile to pass and an unknown pattern', () => {
    const tiles = ConfigRegistry.getTiles().tiles;
    const base = ConfigRegistry.getEntityDef(PUPPET) as EntityDefinition;
    const entitiesWith = (changes: Partial<EntityDefinition>): Record<string, EntityDefinition> => ({
      [PUPPET]: { ...base, ...changes }
    });
    const withoutPad: Record<string, TileDefinition> = { ...tiles };
    delete withoutPad[PAD];
    expect(findSteeringConfigErrors(withoutPad, entitiesWith({}))).toEqual([
      `${PUPPET}.steeredBy: no tile carries the button action "${STEER_MONSTERS_ACTION}"`
    ]);
    expect(findSteeringConfigErrors(tiles, entitiesWith({ passesTiles: ['gravel', 'nowhere'] }))).toEqual([
      `${PUPPET}.passesTiles: "nowhere" is not the id of an existing tile`
    ]);
    expect(findSteeringConfigErrors(tiles, entitiesWith({ movementPattern: 'teleport_around' }))).toEqual([
      `${PUPPET}.movementPattern: unknown pattern "teleport_around"`
    ]);
    expect(findSteeringConfigErrors(tiles, entitiesWith({ pushesBlocks: 'yes' as unknown as boolean }))).toEqual([
      `${PUPPET}.pushesBlocks: expected a boolean`
    ]);
    expect(findSteeringConfigErrors(tiles, entitiesWith({ kind: 'block' }))).toEqual(
      expect.arrayContaining([
        `${PUPPET}.steeredBy: only a monster may be steered`,
        `${PUPPET}.pushesBlocks: only a monster pushes blocks`,
        `${PUPPET}.passesTiles: only a monster passes tiles`
      ])
    );
  });

  it('refuses a worker on a tile that is no button, and an unknown worker', () => {
    const tiles = ConfigRegistry.getTiles().tiles;
    const entities = ConfigRegistry.getMonsters().entities;
    expect(findSteeringConfigErrors({ ...tiles, wall: { ...tiles.wall, buttonWorkedBy: 'player' } }, entities)).toEqual([
      'wall.buttonWorkedBy: only a button has a worker'
    ]);
    expect(
      findSteeringConfigErrors({ ...tiles, [PAD]: { ...tiles[PAD], buttonWorkedBy: 'anyone' as unknown as 'player' } }, entities)
    ).toEqual([`${PAD}.buttonWorkedBy: expected "player"`]);
  });

  it('names the puppet, its control and the two warnings in both languages, with accents in French', () => {
    expect(en.entities.puppet.name).toBe('Puppet');
    expect(fr.entities.puppet.name).toBe('Marionnette');
    expect(en.tiles.puppet_control.name).toBe('Puppet Control');
    expect(fr.tiles.puppet_control.name).toBe('Commande de marionnette');
    expect(en.validator.issues.steering_pad_no_puppet.label.startsWith('Warning: ')).toBe(true);
    expect(fr.validator.issues.steering_pad_no_puppet.label.startsWith('Avertissement : ')).toBe(true);
    expect(en.validator.issues.puppet_no_steering_pad.label.startsWith('Warning: ')).toBe(true);
    expect(fr.validator.issues.puppet_no_steering_pad.label.startsWith('Avertissement : ')).toBe(true);
  });
});

describe('steering: a puppet moves only when the control is worked', () => {
  it('never decides a step of its own, near the player or far from the player', () => {
    const engine = load(room({ entities: [placed(PUPPET, 8, 3), placed(PUPPET, 6, 6)], player: { x: 2, y: 8 } }));
    run(engine, IDLE_TICKS);
    expect(cellsOf(engine, PUPPET)).toEqual(['8,3', '6,6']);
  });

  it('takes one step the way the player moved when the player steps onto the control', () => {
    const engine = load(room({ entities: [placed(PUPPET, 8, ROW)] }));
    stepOntoPad(engine);
    expect(cellsOf(engine, PUPPET)).toEqual(['9,5']);
    expect(puppetAt(engine).dir).toBe('E');
    expect(engine.getPlayer().alive).toBe(true);
  });

  it('steps in the direction of the player in each of the four directions', () => {
    const cases: Array<[Direction, { x: number; y: number }, [number, number], string]> = [
      ['E', { x: 4, y: 5 }, [8, 5], '9,5'],
      ['W', { x: 6, y: 5 }, [3, 5], '2,5'],
      ['N', { x: 5, y: 6 }, [8, 4], '8,3'],
      ['S', { x: 5, y: 4 }, [8, 4], '8,5']
    ];
    for (const [dir, start, [px, py], expected] of cases) {
      const engine = load(room({ player: start, entities: [placed(PUPPET, px, py)] }));
      expect(step(engine, dir), dir).toBe(true);
      expect(cellsOf(engine, PUPPET), dir).toEqual([expected]);
      expect(puppetAt(engine).dir, dir).toBe(dir);
    }
  });

  it('steps once for each time the player steps onto the control', () => {
    const engine = load(room({ entities: [placed(PUPPET, 6, ROW)] }));
    stepOntoPad(engine);
    expect(cellsOf(engine, PUPPET)).toEqual(['7,5']);
    expect(step(engine, 'W')).toBe(true);
    expect(cellsOf(engine, PUPPET)).toEqual(['7,5']);
    stepOntoPad(engine);
    expect(cellsOf(engine, PUPPET)).toEqual(['8,5']);
  });

  it('does not step when the player walks onto an ordinary cell', () => {
    const engine = load(room({ entities: [placed(PUPPET, 8, ROW)], player: { x: 1, y: 8 } }));
    expect(step(engine, 'E')).toBe(true);
    expect(cellsOf(engine, PUPPET)).toEqual(['8,5']);
  });

  it('counts a slide that ends on the control, in the direction of the slide', () => {
    const engine = load(
      room({ terrain: [[PAD_X - 1, ROW, 'ice']], entities: [placed(PUPPET, 8, ROW)], player: { x: PLAYER_X - 1, y: ROW } })
    );
    // The player steps onto the ice, which carries it east onto the control.
    expect(step(engine, 'E')).toBe(true);
    expect(cellsOf(engine, PUPPET)).toEqual(['8,5']);
    for (let i = 0; i < SLIDE_TICKS && engine.getPlayer().x < PAD_X; i++) engine.tick();
    expect(engine.getPlayer().x).toBe(PAD_X);
    expect(cellsOf(engine, PUPPET)).toEqual(['9,5']);
  });

  it('is immune to ice and force floors: it never slides', () => {
    const engine = load(
      room({
        terrain: [
          [8, ROW, 'ice'],
          [8, 3, 'force_s']
        ],
        entities: [placed(PUPPET, 7, ROW), placed(PUPPET, 7, 3)]
      })
    );
    stepOntoPad(engine);
    expect(cellsOf(engine, PUPPET)).toEqual(['8,5', '8,3']);
    run(engine, IDLE_TICKS);
    expect(cellsOf(engine, PUPPET)).toEqual(['8,5', '8,3']);
  });

  it('is undone with the move that steered it', () => {
    const engine = load(room({ entities: [placed(PUPPET, 8, ROW)] }));
    stepOntoPad(engine);
    expect(cellsOf(engine, PUPPET)).toEqual(['9,5']);
    expect(engine.undo()).toBe(true);
    expect(cellsOf(engine, PUPPET)).toEqual(['8,5']);
    expect(engine.getPlayer().x).toBe(PLAYER_X);
  });
});

describe('steering: the order of the steps', () => {
  it('moves a line of puppets together: the one in front steps first', () => {
    const engine = load(room({ entities: [placed(PUPPET, 6, ROW), placed(PUPPET, 7, ROW), placed(PUPPET, 8, ROW)] }));
    stepOntoPad(engine);
    expect(cellsOf(engine, PUPPET)).toEqual(['7,5', '8,5', '9,5']);
  });

  it('moves a line the same way whatever the order of the list, going north', () => {
    const engine = load(
      room({ player: { x: 5, y: 6 }, entities: [placed(PUPPET, 8, 4), placed(PUPPET, 8, 3), placed(PUPPET, 8, 5)] })
    );
    expect(step(engine, 'N')).toBe(true);
    expect(cellsOf(engine, PUPPET).sort()).toEqual(['8,2', '8,3', '8,4']);
  });

  it('lets puppets level with each other step at the same time', () => {
    const engine = load(room({ entities: [placed(PUPPET, 8, 3), placed(PUPPET, 8, 7)] }));
    stepOntoPad(engine);
    expect(cellsOf(engine, PUPPET)).toEqual(['9,3', '9,7']);
  });

  it('keeps a blocked puppet where it is and still moves the others', () => {
    const engine = load(room({ entities: [placed(PUPPET, 9, ROW), placed(PUPPET, 7, 3)] }));
    stepOntoPad(engine);
    // The first is against the wall at x = 10.
    expect(cellsOf(engine, PUPPET)).toEqual(['9,5', '8,3']);
  });

  it('skips a puppet an earlier step removed from the line, so it cannot step onto the player', () => {
    // The front puppet presses the orange button, which lights the jet under the second one: it burns away
    // and must not take its step onto the player standing east of it.
    const engine = load(
      room({
        terrain: [
          [7, 4, 'button_orange'],
          [3, 6, 'flame_jet_off']
        ],
        entities: [placed(PUPPET, 6, 4), placed(PUPPET, 3, 6)]
      })
    );
    const w = placePlayer(engine, 4, 6);
    expect(steerMonsters(contextOf(engine), 'E')).toBe(true);
    expect(w.player.alive).toBe(true);
    expect(cellsOf(engine, PUPPET)).toEqual(['7,4']);
  });
});

describe('steering: what a puppet may enter', () => {
  it('refuses walls, closed doors and the edge of the map', () => {
    const engine = load(
      room({
        terrain: [
          [8, 3, 'wall'],
          [8, 7, 'door_red']
        ],
        entities: [placed(PUPPET, 7, 3), placed(PUPPET, 7, 7), placed(PUPPET, 9, 8)]
      })
    );
    stepOntoPad(engine);
    expect(cellsOf(engine, PUPPET)).toEqual(['7,3', '7,7', '9,8']);
  });

  it('enters gravel', () => {
    const engine = load(room({ terrain: [[8, 3, 'gravel']], entities: [placed(PUPPET, 7, 3)] }));
    stepOntoPad(engine);
    expect(cellsOf(engine, PUPPET)).toEqual(['8,3']);
  });

  it('walks into water and dies there', () => {
    const engine = load(room({ terrain: [[8, 3, 'water']], entities: [placed(PUPPET, 7, 3)] }));
    stepOntoPad(engine);
    expect(cellsOf(engine, PUPPET)).toEqual([]);
  });

  it('walks into slime and dies there', () => {
    const engine = load(room({ terrain: [[8, 3, 'slime']], entities: [placed(PUPPET, 7, 3)] }));
    stepOntoPad(engine);
    expect(cellsOf(engine, PUPPET)).toEqual([]);
  });

  it('walks into fire and burns', () => {
    const engine = load(room({ terrain: [[8, 3, 'fire']], entities: [placed(PUPPET, 7, 3)] }));
    stepOntoPad(engine);
    expect(cellsOf(engine, PUPPET)).toEqual([]);
  });

  it('refuses a flame jet that is lit, which its definition does not pass', () => {
    const engine = load(room({ terrain: [[8, 3, 'flame_jet_on']], entities: [placed(PUPPET, 7, 3)] }));
    stepOntoPad(engine);
    expect(cellsOf(engine, PUPPET)).toEqual(['7,3']);
  });

  it('dies on a bomb and takes the bomb with it', () => {
    const engine = load(room({ items: [[8, 3, 'bomb']], entities: [placed(PUPPET, 7, 3)] }));
    stepOntoPad(engine);
    expect(cellsOf(engine, PUPPET)).toEqual([]);
    expect(engine.getItems()[3][8]).toBeNull();
  });

  it('refuses a cell that holds an item other than a bomb', () => {
    const engine = load(
      room({ items: [[8, 3, 'chip'], [8, 7, 'key_red']], entities: [placed(PUPPET, 7, 3), placed(PUPPET, 7, 7)] })
    );
    stepOntoPad(engine);
    expect(cellsOf(engine, PUPPET)).toEqual(['7,3', '7,7']);
    expect(engine.getItems()[3][8]).toBe('chip');
  });

  it('refuses a cell another monster stands on', () => {
    const engine = load(room({ entities: [placed(PUPPET, 7, 3), placed('blob', 8, 3)] }));
    stepOntoPad(engine);
    expect(cellsOf(engine, PUPPET)).toEqual(['7,3']);
  });

  it('does not step from a clone machine or from a closed trap', () => {
    const engine = load(
      room({
        terrain: [
          [7, 3, 'clone_machine'],
          [7, 7, 'trap']
        ],
        entities: [placed(PUPPET, 7, 3), placed(PUPPET, 7, 7)]
      })
    );
    stepOntoPad(engine);
    expect(cellsOf(engine, PUPPET)).toEqual(['7,3', '7,7']);
  });

  it('kills the player it steps onto, and no puppet after it steps', () => {
    const engine = load(room({ entities: [placed(PUPPET, 7, 4), placed(PUPPET, 3, 7)] }));
    const w = placePlayer(engine, 8, 4);
    expect(steerMonsters(contextOf(engine), 'E')).toBe(false);
    expect(w.player.alive).toBe(false);
    expect(w.player.deathReasonKey).toBe('hud.messages.death_monster');
    expect(cellsOf(engine, PUPPET)).toEqual(['8,4', '3,7']);
  });
});

describe('steering: blocks and plates', () => {
  it('pushes one block ahead of it', () => {
    const engine = load(room({ entities: [placed(PUPPET, 7, ROW), placed('dirt_block', 8, ROW)] }));
    stepOntoPad(engine);
    expect(cellsOf(engine, PUPPET)).toEqual(['8,5']);
    expect(cellsOf(engine, 'dirt_block')).toEqual(['9,5']);
  });

  it('refuses a push of two blocks', () => {
    const engine = load(
      room({ entities: [placed(PUPPET, 6, ROW), placed('dirt_block', 7, ROW), placed('dirt_block', 8, ROW)] })
    );
    stepOntoPad(engine);
    expect(cellsOf(engine, PUPPET)).toEqual(['6,5']);
    expect(cellsOf(engine, 'dirt_block')).toEqual(['7,5', '8,5']);
  });

  it('refuses a push against a wall', () => {
    const engine = load(room({ entities: [placed(PUPPET, 8, ROW), placed('dirt_block', 9, ROW)] }));
    stepOntoPad(engine);
    expect(cellsOf(engine, PUPPET)).toEqual(['8,5']);
    expect(cellsOf(engine, 'dirt_block')).toEqual(['9,5']);
  });

  it('refuses a push that would land the block on the live player', () => {
    const engine = load(room({ entities: [placed(PUPPET, 7, 3), placed('dirt_block', 8, 3)] }));
    const w = placePlayer(engine, 9, 3);
    expect(steerMonsters(contextOf(engine), 'E')).toBe(true);
    expect(w.player.alive).toBe(true);
    expect(cellsOf(engine, PUPPET)).toEqual(['7,3']);
    expect(cellsOf(engine, 'dirt_block')).toEqual(['8,3']);
  });

  it('sinks a pushed block in water and takes the cell the block left', () => {
    const engine = load(
      room({ terrain: [[9, ROW, 'water']], entities: [placed(PUPPET, 7, ROW), placed('dirt_block', 8, ROW)] })
    );
    stepOntoPad(engine);
    expect(cellsOf(engine, PUPPET)).toEqual(['8,5']);
    expect(cellsOf(engine, 'dirt_block')).toEqual([]);
  });

  it('turns a pushed turret toward the push', () => {
    const engine = load(room({ entities: [placed(PUPPET, 7, ROW), placed('turret_cw', 8, ROW, 'N')] }));
    stepOntoPad(engine);
    const turret = engine.getEntities().find((e) => e.type === 'turret_cw') as RuntimeEntity;
    expect(`${turret.x},${turret.y}`).toBe('9,5');
    expect(turret.facing).toBe('E');
  });

  it('refuses a monster in the way even with a block behind it', () => {
    const engine = load(room({ entities: [placed(PUPPET, 7, 3), placed('blob', 8, 3), placed('dirt_block', 9, 3)] }));
    stepOntoPad(engine);
    expect(cellsOf(engine, PUPPET)).toEqual(['7,3']);
    expect(cellsOf(engine, 'dirt_block')).toEqual(['9,3']);
  });

  it('presses a plate it stops on, and releases it when it leaves', () => {
    const engine = load(
      room({
        terrain: [
          [7, ROW, 'pressure_plate_red'],
          [3, 2, 'hold_door_red_closed']
        ],
        entities: [placed(PUPPET, 6, ROW)]
      })
    );
    expect(engine.getTerrain()[2][3]).toBe('hold_door_red_closed');
    stepOntoPad(engine);
    expect(engine.getTerrain()[2][3]).toBe('hold_door_red_open');
    expect(step(engine, 'W')).toBe(true);
    stepOntoPad(engine);
    expect(cellsOf(engine, PUPPET)).toEqual(['8,5']);
    expect(engine.getTerrain()[2][3]).toBe('hold_door_red_closed');
  });
});

describe('steering: only the player works the control', () => {
  it('ignores a monster that walks onto it', () => {
    const engine = load(
      room({ player: { x: 2, y: 9 }, terrain: [[5, 7, PAD]], entities: [placed('walker', 6, 7, 'W'), placed(PUPPET, 8, 3)] })
    );
    let crossed = false;
    for (let i = 0; i < IDLE_TICKS; i++) {
      engine.tick();
      if (cellsOf(engine, 'walker').includes('5,7')) crossed = true;
    }
    expect(crossed).toBe(true);
    expect(cellsOf(engine, PUPPET)).toEqual(['8,3']);
  });

  it('ignores a block the player pushes onto it', () => {
    const engine = load(
      room({ player: { x: 3, y: 7 }, terrain: [[5, 7, PAD]], entities: [placed('dirt_block', 4, 7), placed(PUPPET, 8, 3)] })
    );
    expect(step(engine, 'E')).toBe(true);
    expect(cellsOf(engine, 'dirt_block')).toEqual(['5,7']);
    expect(cellsOf(engine, PUPPET)).toEqual(['8,3']);
  });

  it('does not chain: a puppet stepping onto a second control steers nothing', () => {
    const engine = load(room({ terrain: [[8, ROW, PAD]], entities: [placed(PUPPET, 7, ROW), placed(PUPPET, 3, 2)] }));
    stepOntoPad(engine);
    expect(cellsOf(engine, PUPPET)).toEqual(['8,5', '4,2']);
    run(engine, IDLE_TICKS);
    expect(cellsOf(engine, PUPPET)).toEqual(['8,5', '4,2']);
  });

  it('does not chain: a puppet pushing a block onto a second control steers nothing', () => {
    const engine = load(
      room({
        terrain: [[9, ROW, PAD]],
        entities: [placed(PUPPET, 7, ROW), placed('dirt_block', 8, ROW), placed(PUPPET, 3, 2)]
      })
    );
    stepOntoPad(engine);
    expect(cellsOf(engine, PUPPET)).toEqual(['8,5', '4,2']);
    expect(cellsOf(engine, 'dirt_block')).toEqual(['9,5']);
  });

  it('does not chain: a puppet cloned onto a control steers nothing', () => {
    const engine = load(
      room({
        terrain: [
          [3, 3, 'clone_machine'],
          [4, 3, PAD],
          [2, 3, 'button_red']
        ],
        entities: [placed(PUPPET, 3, 3), placed(PUPPET, 8, 8)],
        cloneLinks: [{ buttonX: 2, buttonY: 3, clonerX: 3, clonerY: 3, templateType: PUPPET, templateDir: 'E' }]
      })
    );
    contextOf(engine).triggerButton(2, 3, 'trigger_cloner');
    expect(cellsOf(engine, PUPPET).sort()).toEqual(['3,3', '4,3', '8,8']);
  });
});

describe('steering: clones and the shared entry rules', () => {
  it('lets a clone machine spawn a puppet onto gravel, where it would not spawn teeth', () => {
    const link = (templateType: string): CompiledLevel['cloneLinks'] => [
      { buttonX: 2, buttonY: 3, clonerX: 3, clonerY: 3, templateType, templateDir: 'E' }
    ];
    const terrain: Array<[number, number, string]> = [
      [3, 3, 'clone_machine'],
      [4, 3, 'gravel'],
      [2, 3, 'button_red']
    ];
    const puppets = load(room({ terrain, entities: [placed(PUPPET, 3, 3)], cloneLinks: link(PUPPET) }));
    contextOf(puppets).triggerButton(2, 3, 'trigger_cloner');
    expect(cellsOf(puppets, PUPPET).sort()).toEqual(['3,3', '4,3']);
    const teeth = load(room({ terrain, entities: [placed('teeth', 3, 3)], cloneLinks: link('teeth') }));
    contextOf(teeth).triggerButton(2, 3, 'trigger_cloner');
    expect(cellsOf(teeth, 'teeth')).toEqual(['3,3']);
  });

  it('keeps passesTiles and steeredBy out of every other monster', () => {
    for (const [id, def] of Object.entries(ConfigRegistry.getMonsters().entities)) {
      if (id === PUPPET) continue;
      expect(def.passesTiles, id).toBeUndefined();
      expect(def.steeredBy, id).toBeUndefined();
    }
  });
});

describe('steering: validator warnings', () => {
  const keys = (level: CompiledLevel): string[] => LevelValidator.validate(level).issues.map((issue) => issue.i18nKey);
  const PAD_WITHOUT_PUPPET = 'validator.issues.steering_pad_no_puppet.label';
  const PUPPET_WITHOUT_PAD = 'validator.issues.puppet_no_steering_pad.label';

  it('warns about a control with no puppet, and about a puppet with no control', () => {
    expect(keys(room())).toContain(PAD_WITHOUT_PUPPET);
    expect(keys(room({ noPad: true, entities: [placed(PUPPET, 8, ROW)] }))).toContain(PUPPET_WITHOUT_PAD);
  });

  it('is quiet when the level has both, or neither', () => {
    const both = keys(room({ entities: [placed(PUPPET, 8, ROW)] }));
    expect(both).not.toContain(PAD_WITHOUT_PUPPET);
    expect(both).not.toContain(PUPPET_WITHOUT_PAD);
    const neither = keys(room({ noPad: true }));
    expect(neither).not.toContain(PAD_WITHOUT_PUPPET);
    expect(neither).not.toContain(PUPPET_WITHOUT_PAD);
  });

  it('counts a puppet that a clone machine makes', () => {
    const cloned = keys(
      room({
        terrain: [
          [3, 3, 'clone_machine'],
          [2, 3, 'button_red']
        ],
        cloneLinks: [{ buttonX: 2, buttonY: 3, clonerX: 3, clonerY: 3, templateType: PUPPET, templateDir: 'E' }]
      })
    );
    expect(cloned).not.toContain(PAD_WITHOUT_PUPPET);
  });

  it('gives both warnings the warning severity', () => {
    const lonePad = LevelValidator.validate(room()).issues.find((i) => i.i18nKey === PAD_WITHOUT_PUPPET);
    expect(lonePad?.severity).toBe('warning');
    const lonePuppet = LevelValidator.validate(room({ noPad: true, entities: [placed(PUPPET, 8, ROW)] })).issues.find(
      (i) => i.i18nKey === PUPPET_WITHOUT_PAD
    );
    expect(lonePuppet?.severity).toBe('warning');
  });
});