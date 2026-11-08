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
import { cc2TileInfo } from '../../formats/cc2TileTable';
import en from '../../locales/en.json';
import fr from '../../locales/fr.json';
import { serializePack } from '../../packs/packJson';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { DEFAULT_MONSTER_MOVE_INTERVAL_TICKS, EMULATE_CYCLE_PATTERN, MELINDA_CHARACTER } from '../coreConstants';
import { GameEngine } from '../GameEngine';
import { LevelValidator } from '../LevelValidator';
import type { CellEdge, CompiledLevel, Direction, EntityDefinition, EntityPlacement, PlayerCharacter } from '../types';

const SIZE = 13;
const CENTER = 6;
const TIME_LIMIT_SECONDS = 1000;
const FLOOR_MIMIC = 'floor_mimic';
const TIMID_TEETH = 'timid_teeth';
const GHOST = 'ghost';
const ROVER = 'rover';
const NEW_MONSTERS = [FLOOR_MIMIC, TIMID_TEETH, GHOST, ROVER];
/** A monster waits its interval, then moves on the next tick: a step lasts interval + 1 ticks. */
const stepTicks = (type: string): number => (ConfigRegistry.getEntityDef(type)?.moveIntervalTicks ?? DEFAULT_MONSTER_MOVE_INTERVAL_TICKS) + 1;
/** CC2 speeds: an ordinary monster takes 4 tics a step and the floor mimic 16. */
const MIMIC_SLOWDOWN = 4;
const ROVER_SWITCH_ATTEMPTS = 32;

interface Setup {
  entities: EntityPlacement[];
  terrain?: Array<[number, number, string]>;
  items?: Array<[number, number, string]>;
  cellEdges?: CellEdge[];
  player?: { x: number; y: number };
  character?: PlayerCharacter;
}

/** Walled floor room; the player stands still far from the action unless the setup says otherwise. */
function room(setup: Setup): CompiledLevel {
  const terrain: string[][] = Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x) => (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? 'wall' : 'floor'))
  );
  for (const [x, y, id] of setup.terrain ?? []) terrain[y][x] = id;
  const items: Array<Array<string | null>> = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null));
  for (const [x, y, id] of setup.items ?? []) items[y][x] = id;
  return {
    id: 'cc2_monsters_room',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: TIME_LIMIT_SECONDS,
    chipsRequired: 0,
    playerStart: { ...(setup.player ?? { x: SIZE - 2, y: SIZE - 2 }), dir: 'N' },
    terrain,
    items,
    entities: setup.entities,
    trapLinks: [],
    cloneLinks: [],
    ...(setup.cellEdges ? { cellEdges: setup.cellEdges } : {}),
    ...(setup.character ? { character: setup.character } : {})
  };
}

function monster(type: string, x: number, y: number, dir: Direction = 'N'): EntityPlacement {
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

function find(engine: GameEngine, type: string) {
  return engine.getEntities().find((e) => e.type === type);
}

function cellOf(engine: GameEngine, type: string): string {
  const found = find(engine, type);
  return found ? `${found.x},${found.y}` : 'gone';
}

beforeEach(() => {
  loadTestConfigs();
});

describe('cc2 monsters: configuration', () => {
  it('defines the four monsters as Epoxy-only monsters', () => {
    for (const id of NEW_MONSTERS) {
      const def = ConfigRegistry.getEntityDef(id);
      expect(def?.kind, id).toBe('monster');
      expect(def?.epoxyOnly, id).toBe(true);
      expect(typeof en.entities[id as keyof typeof en.entities].name, id).toBe('string');
      expect(typeof fr.entities[id as keyof typeof fr.entities].name, id).toBe('string');
    }
  });

  it('passes the behaviour checks', () => {
    expect(findMonsterBehaviourConfigErrors(ConfigRegistry.getTiles().tiles, ConfigRegistry.getMonsters().entities)).toEqual([]);
  });

  it('refuses malformed behaviour fields', () => {
    const tiles = ConfigRegistry.getTiles().tiles;
    const entities = (patch: Partial<EntityDefinition>, base = GHOST): Record<string, EntityDefinition> => ({
      ...ConfigRegistry.getMonsters().entities,
      [base]: { ...(ConfigRegistry.getMonsters().entities[base] as EntityDefinition), ...patch }
    });
    expect(findMonsterBehaviourConfigErrors(tiles, entities({ blockedByTiles: ['nowhere'] }))).toEqual([
      'ghost.blockedByTiles: "nowhere" is not the id of an existing tile'
    ]);
    expect(findMonsterBehaviourConfigErrors(tiles, entities({ blockedByHazards: ['lava' as 'water'] }))).toEqual([
      'ghost.blockedByHazards: unknown hazard lava'
    ]);
    expect(findMonsterBehaviourConfigErrors(tiles, entities({ ignoresCellEdges: 'yes' as unknown as boolean }))).toEqual([
      'ghost.ignoresCellEdges: expected a boolean'
    ]);
    expect(findMonsterBehaviourConfigErrors(tiles, entities({ passesSolidTiles: false }))).toEqual([
      'ghost.blockedByTiles: only a monster that passes solid tiles has this field',
      'ghost.blockedByHazards: only a monster that passes solid tiles has this field'
    ]);
    expect(findMonsterBehaviourConfigErrors(tiles, entities({ fleesCharacters: ['nobody' as PlayerCharacter] }, TIMID_TEETH))).toEqual([
      'timid_teeth.fleesCharacters: unknown character nobody'
    ]);
    expect(findMonsterBehaviourConfigErrors(tiles, entities({ fleesCharacters: ['chip'] }, 'bug'))).toEqual([
      'bug.fleesCharacters: needs the pattern "chase_player" or "flee_player"'
    ]);
    expect(findMonsterBehaviourConfigErrors(tiles, entities({ emulates: ['teeth', 'nothing'] }, ROVER))).toEqual([
      'rover.emulates: "nothing" is not the id of an existing monster'
    ]);
    expect(findMonsterBehaviourConfigErrors(tiles, entities({ emulates: [ROVER] }, ROVER))).toEqual([
      'rover.emulates: "rover" emulates others itself'
    ]);
    expect(findMonsterBehaviourConfigErrors(tiles, entities({ emulationSwitchAttempts: 0 }, ROVER))).toEqual([
      'rover.emulationSwitchAttempts: expected a whole number of at least 1'
    ]);
    expect(findMonsterBehaviourConfigErrors(tiles, entities({ emulates: ['teeth'] }, 'bug'))).toContain(
      'bug.emulates: goes with the pattern "emulate_cycle" and nothing else'
    );
  });

  it('gives the rover the cycle pattern and the CC2 list of imitated monsters', () => {
    const def = ConfigRegistry.getEntityDef(ROVER);
    expect(def?.movementPattern).toBe(EMULATE_CYCLE_PATTERN);
    expect(def?.emulates).toEqual(['teeth', 'glider', 'bug', 'pink_ball', TIMID_TEETH, 'fireball', 'paramecium', 'walker']);
    expect(def?.emulationSwitchAttempts).toBe(ROVER_SWITCH_ATTEMPTS);
  });
});

describe('floor mimic', () => {
  it('chases the player', () => {
    const engine = load(room({ entities: [monster(FLOOR_MIMIC, CENTER, CENTER)], player: { x: CENTER + 4, y: CENTER } }));
    run(engine, stepTicks(FLOOR_MIMIC));
    expect(cellOf(engine, FLOOR_MIMIC)).toBe(`${CENTER + 1},${CENTER}`);
  });

  it('steps four times slower than an ordinary monster, and stays put until then', () => {
    const bugStep = stepTicks('bug');
    expect(stepTicks(FLOOR_MIMIC)).toBe(bugStep * MIMIC_SLOWDOWN);
    const engine = load(room({ entities: [monster(FLOOR_MIMIC, CENTER, CENTER)], player: { x: CENTER + 4, y: CENTER } }));
    run(engine, stepTicks(FLOOR_MIMIC) - 1);
    expect(cellOf(engine, FLOOR_MIMIC)).toBe(`${CENTER},${CENTER}`);
    run(engine, 1);
    expect(cellOf(engine, FLOOR_MIMIC)).toBe(`${CENTER + 1},${CENTER}`);
    run(engine, stepTicks(FLOOR_MIMIC));
    expect(cellOf(engine, FLOOR_MIMIC)).toBe(`${CENTER + 2},${CENTER}`);
  });
});

describe('teeth and timid teeth, by character', () => {
  /** The cell of a monster after its first step, with the player four cells to its east. */
  function afterFirstStep(type: string, character?: PlayerCharacter): string {
    const engine = load(
      room({ entities: [monster(type, CENTER, CENTER)], player: { x: CENTER + 4, y: CENTER }, ...(character ? { character } : {}) })
    );
    run(engine, stepTicks(type));
    return cellOf(engine, type);
  }
  const TOWARD = `${CENTER + 1},${CENTER}`;
  const AWAY = `${CENTER - 1},${CENTER}`;

  it('makes teeth chase Chip and flee Melinda, as in CC2', () => {
    expect(afterFirstStep('teeth')).toBe(TOWARD);
    expect(afterFirstStep('teeth', 'chip')).toBe(TOWARD);
    expect(afterFirstStep('teeth', MELINDA_CHARACTER)).toBe(AWAY);
  });

  it('makes timid teeth flee Chip and chase Melinda', () => {
    expect(afterFirstStep(TIMID_TEETH)).toBe(AWAY);
    expect(afterFirstStep(TIMID_TEETH, 'chip')).toBe(AWAY);
    expect(afterFirstStep(TIMID_TEETH, MELINDA_CHARACTER)).toBe(TOWARD);
  });

  it('leaves the other chasers and the skitter alone', () => {
    expect(afterFirstStep('lurker')).toBe(TOWARD);
    expect(afterFirstStep('lurker', MELINDA_CHARACTER)).toBe(TOWARD);
    expect(afterFirstStep('skitter')).toBe(AWAY);
    expect(afterFirstStep('skitter', MELINDA_CHARACTER)).toBe(AWAY);
  });
});

describe('ghost', () => {
  /** A ghost at the centre heading east, with the setup's terrain; returns the engine after `steps` steps. */
  function ghostRun(setup: Omit<Setup, 'entities'>, steps: number, dir: Direction = 'E'): GameEngine {
    const engine = load(room({ ...setup, entities: [monster(GHOST, CENTER, CENTER, dir)] }));
    run(engine, stepTicks(GHOST) * steps);
    return engine;
  }

  it('turns forward, left, right, back', () => {
    // Blocked ahead and to the left by steel; it takes the right turn (south when heading east).
    const engine = ghostRun(
      {
        terrain: [
          [CENTER + 1, CENTER, 'steel_wall'],
          [CENTER, CENTER - 1, 'steel_wall']
        ]
      },
      1
    );
    expect(cellOf(engine, GHOST)).toBe(`${CENTER},${CENTER + 1}`);
    // Blocked ahead, left and right: back.
    const trapped = ghostRun(
      {
        terrain: [
          [CENTER + 1, CENTER, 'steel_wall'],
          [CENTER, CENTER - 1, 'steel_wall'],
          [CENTER, CENTER + 1, 'steel_wall']
        ]
      },
      1
    );
    expect(cellOf(trapped, GHOST)).toBe(`${CENTER - 1},${CENTER}`);
  });

  it('passes walls, doors, sockets, blue walls and thin walls', () => {
    for (const tile of ['wall', 'door_red', 'socket', 'blue_wall_real', 'invisible_wall', 'thin_wall_w', 'thin_wall_e']) {
      const engine = ghostRun({ terrain: [[CENTER + 1, CENTER, tile]] }, 1);
      expect(cellOf(engine, GHOST), tile).toBe(`${CENTER + 1},${CENTER}`);
    }
  });

  it('crosses the cell edges of a level', () => {
    const edges: CellEdge[] = [
      { x: CENTER, y: CENTER, sides: ['E'] },
      { x: CENTER + 1, y: CENTER, sides: ['W'] }
    ];
    const engine = ghostRun({ cellEdges: edges }, 1);
    expect(cellOf(engine, GHOST)).toBe(`${CENTER + 1},${CENTER}`);
    // An ordinary monster is stopped by the same edge.
    const walker = load(room({ cellEdges: edges, entities: [monster('walker', CENTER, CENTER, 'E')] }));
    run(walker, stepTicks('walker'));
    expect(cellOf(walker, 'walker')).not.toBe(`${CENTER + 1},${CENTER}`);
  });

  it('passes neither steel walls, nor water, nor clone machines, nor the map edge', () => {
    for (const tile of ['steel_wall', 'water', 'clone_machine']) {
      const engine = ghostRun({ terrain: [[CENTER + 1, CENTER, tile]] }, 1);
      expect(cellOf(engine, GHOST), tile).not.toBe(`${CENTER + 1},${CENTER}`);
    }
    // On the last column, facing the map edge: it turns instead of leaving the map.
    const border = load(room({ entities: [monster(GHOST, SIZE - 1, CENTER, 'E')] }));
    run(border, stepTicks(GHOST));
    expect(cellOf(border, GHOST)).toBe(`${SIZE - 1},${CENTER - 1}`);
  });

  it('is not carried by ice or force floors, and cannot turn on ice', () => {
    const forced = ghostRun({ terrain: [[CENTER + 1, CENTER, 'force_n']] }, 2);
    // It steps onto the force floor, then keeps heading east instead of being pushed north.
    expect(cellOf(forced, GHOST)).toBe(`${CENTER + 2},${CENTER}`);
    const icy = ghostRun({ terrain: [[CENTER + 1, CENTER, 'ice'], [CENTER + 2, CENTER, 'steel_wall']] }, 3);
    // On ice it goes straight on or stays: the steel wall ahead holds it where it is.
    expect(cellOf(icy, GHOST)).toBe(`${CENTER + 1},${CENTER}`);
  });

  it('sets off no bomb, is held by no trap, and burns in no fire', () => {
    const bomb = ghostRun({ items: [[CENTER + 1, CENTER, 'bomb']] }, 1);
    expect(cellOf(bomb, GHOST)).toBe(`${CENTER + 1},${CENTER}`);
    expect(bomb.getItems()[CENTER][CENTER + 1]).toBe('bomb');
    const fire = ghostRun({ terrain: [[CENTER + 1, CENTER, 'fire']] }, 1);
    expect(cellOf(fire, GHOST)).toBe(`${CENTER + 1},${CENTER}`);
    const slime = ghostRun({ terrain: [[CENTER + 1, CENTER, 'slime']] }, 1);
    expect(cellOf(slime, GHOST)).toBe(`${CENTER + 1},${CENTER}`);
    // Standing on a closed trap, the ghost walks away.
    const trapped = load(room({ terrain: [[CENTER, CENTER, 'trap']], entities: [monster(GHOST, CENTER, CENTER, 'E')] }));
    run(trapped, stepTicks(GHOST));
    expect(cellOf(trapped, GHOST)).toBe(`${CENTER + 1},${CENTER}`);
  });

  it('walks over items without picking them up', () => {
    const engine = ghostRun({ items: [[CENTER + 1, CENTER, 'key_red']] }, 1);
    expect(cellOf(engine, GHOST)).toBe(`${CENTER + 1},${CENTER}`);
    expect(engine.getItems()[CENTER][CENTER + 1]).toBe('key_red');
  });

  it('kills the player on contact', () => {
    const engine = load(room({ entities: [monster(GHOST, CENTER, CENTER, 'E')], player: { x: CENTER + 1, y: CENTER } }));
    run(engine, stepTicks(GHOST));
    expect(engine.getPlayer().alive).toBe(false);
  });

  it('does not make a level unwinnable for the validator', () => {
    const level = room({ entities: [monster(GHOST, CENTER, CENTER, 'E')], player: { x: 2, y: 2 } });
    level.terrain[SIZE - 2][SIZE - 2] = 'exit';
    const report = LevelValidator.validate(level);
    expect(report.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  });
});

describe('rover', () => {
  /** The player sits in a sealed two-cell pocket, so no rover ever reaches them and the play runs on. */
  const POCKET: Pick<Setup, 'player' | 'terrain'> = {
    player: { x: 1, y: 1 },
    terrain: [
      [3, 1, 'steel_wall'],
      [2, 2, 'steel_wall'],
      [1, 2, 'steel_wall']
    ]
  };
  const stepDecision = (engine: GameEngine): void => run(engine, stepTicks(ROVER));

  it('starts on the first behaviour and counts each step decision', () => {
    const engine = load(room({ ...POCKET, entities: [monster(ROVER, CENTER, CENTER)] }));
    expect(find(engine, ROVER)).toMatchObject({ emulatee: 0, emulationMoves: 0 });
    stepDecision(engine);
    expect(find(engine, ROVER)).toMatchObject({ emulatee: 0, emulationMoves: 1 });
  });

  it('keeps native entities free of the rover fields', () => {
    const engine = load(room({ entities: [monster('teeth', CENTER, CENTER), monster('glider', 2, 2)] }));
    run(engine, stepTicks('teeth') * 2);
    for (const entity of engine.getEntities()) {
      expect(Object.keys(entity), entity.type).not.toContain('emulatee');
      expect(Object.keys(entity), entity.type).not.toContain('emulationMoves');
    }
  });

  it('moves on to the next behaviour at the 32nd step decision, wrapping round after the last', () => {
    const engine = load(room({ ...POCKET, entities: [monster(ROVER, CENTER, CENTER)] }));
    const list = ConfigRegistry.getEntityDef(ROVER)?.emulates ?? [];
    for (let i = 0; i < ROVER_SWITCH_ATTEMPTS - 1; i++) stepDecision(engine);
    expect(find(engine, ROVER)).toMatchObject({ emulatee: 0, emulationMoves: ROVER_SWITCH_ATTEMPTS - 1 });
    stepDecision(engine);
    expect(find(engine, ROVER)).toMatchObject({ emulatee: 1, emulationMoves: 0 });
    for (let behaviour = 2; behaviour <= list.length; behaviour++) {
      for (let i = 0; i < ROVER_SWITCH_ATTEMPTS; i++) stepDecision(engine);
      expect(find(engine, ROVER)?.emulatee).toBe(behaviour % list.length);
    }
  });

  it('chases like teeth first and flees like timid teeth in the fifth behaviour', () => {
    // First behaviour (teeth): toward Chip, who stands to the east.
    const first = load(room({ entities: [monster(ROVER, CENTER, CENTER)], player: { x: CENTER + 4, y: CENTER } }));
    stepDecision(first);
    expect(cellOf(first, ROVER)).toBe(`${CENTER + 1},${CENTER}`);
    // Fifth behaviour (timid teeth): away from Chip.
    const fifth = load(room({ entities: [monster(ROVER, CENTER, CENTER)], player: { x: SIZE - 2, y: CENTER } }));
    const rover = find(fifth, ROVER);
    if (rover === undefined) throw new Error('the rover is missing');
    rover.emulatee = 4;
    rover.emulationMoves = 0;
    stepDecision(fifth);
    expect(cellOf(fifth, ROVER)).toBe(`${CENTER - 1},${CENTER}`);
  });

  it('follows the wall of a bug in the third behaviour (turning left first)', () => {
    const engine = load(room({ entities: [monster(ROVER, CENTER, CENTER, 'E')] }));
    const rover = find(engine, ROVER);
    if (rover === undefined) throw new Error('the rover is missing');
    rover.emulatee = 2;
    rover.emulationMoves = 0;
    stepDecision(engine);
    // A bug tries left (north when heading east) before straight on.
    expect(cellOf(engine, ROVER)).toBe(`${CENTER},${CENTER - 1}`);
  });

  it('restores its behaviour state on undo', () => {
    const engine = load(room({ ...POCKET, entities: [monster(ROVER, CENTER, CENTER)] }));
    for (let i = 0; i < 3; i++) stepDecision(engine);
    const snapshot = engine.captureState();
    const before = { ...(find(engine, ROVER) as object) };
    for (let i = 0; i < ROVER_SWITCH_ATTEMPTS; i++) stepDecision(engine);
    expect(find(engine, ROVER)?.emulatee).toBe(1);
    engine.restoreState(snapshot);
    expect(find(engine, ROVER)).toMatchObject(before);
    expect(find(engine, ROVER)).toMatchObject({ emulatee: 0, emulationMoves: 3 });
    // The snapshot is a copy: playing on does not change it.
    stepDecision(engine);
    expect(snapshot.entities.find((e) => e.type === ROVER)).toMatchObject({ emulationMoves: 3 });
  });

  it('restores its behaviour state through a player undo', () => {
    const engine = load(room({ ...POCKET, entities: [monster(ROVER, CENTER, CENTER)] }));
    for (let i = 0; i < 2; i++) stepDecision(engine);
    expect(engine.attemptPlayerMove('E')).toBe(true);
    for (let i = 0; i < ROVER_SWITCH_ATTEMPTS; i++) stepDecision(engine);
    expect(find(engine, ROVER)?.emulatee).toBe(1);
    expect(engine.undo()).toBe(true);
    expect(find(engine, ROVER)).toMatchObject({ emulatee: 0, emulationMoves: 2 });
  });
});

describe('pack format and the CC2 import', () => {
  it('writes a pack holding any of the four monsters as format 13', () => {
    for (const id of NEW_MONSTERS) {
      const level = room({ entities: [monster(id, CENTER, CENTER)] });
      expect(JSON.parse(serializePack('p', [level])).version, id).toBe(PACK_JSON_VERSION_V13);
    }
    const plain = room({ entities: [monster('teeth', CENTER, CENTER)] });
    expect(JSON.parse(serializePack('p', [plain])).version).toBeLessThan(PACK_JSON_VERSION_V13);
  });

  it('maps the CC2 actor codes to the four monsters', () => {
    const expected: Array<[number, string]> = [
      [0x57, TIMID_TEETH],
      [0x69, ROVER],
      [0x82, FLOOR_MIMIC],
      [0x8b, GHOST]
    ];
    for (const [code, id] of expected) {
      expect(ENTITY_MAP.get(code), `0x${code.toString(16)}`).toEqual({ id, key: id });
      expect(cc2TileInfo(code)).toBeDefined();
    }
  });
});
