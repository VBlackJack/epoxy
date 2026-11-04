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
import { findTurretConfigErrors } from '../../config/ConfigValidation';
import en from '../../locales/en.json';
import fr from '../../locales/fr.json';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { searchStateKey } from '../../test/pilotSearch';
import { GameEngine } from '../GameEngine';
import { LevelValidator } from '../LevelValidator';
import type { EpoxyWorld } from './epoxyWorld';
import type { BeamCell, CompiledLevel, Direction, EntityDefinition, EntityPlacement, RuntimeEntity } from '../types';

const SIZE = 11;
const LANE_Y = 5;
const TURRET_X = 3;
const START_X = 1;
const START_Y = 9;
const TIME_LIMIT_SECONDS = 100;
const TURRET_LENGTH = 3;
const TURN_PERIOD = 60;
const MULTI_ARMS = 4;
const MAX_WAIT_TICKS = 30;
const IDLE_TICKS_BEFORE_STEP = 10;
const SEARCH_KEY_PARTS = 11;

interface Setup {
  entities?: EntityPlacement[];
  /** Terrain edits: x, y, tile id. */
  terrain?: Array<[number, number, string]>;
  cloneLinks?: CompiledLevel['cloneLinks'];
  cellEdges?: CompiledLevel['cellEdges'];
  player?: { x: number; y: number };
}

/** Walled floor room; the player waits at the bottom left, away from the lane of row 5. */
function room(setup: Setup = {}): CompiledLevel {
  const terrain: string[][] = Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x) => (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? 'wall' : 'floor'))
  );
  for (const [x, y, id] of setup.terrain ?? []) terrain[y][x] = id;
  const player = setup.player ?? { x: START_X, y: START_Y };
  return {
    id: 'turret_room',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: TIME_LIMIT_SECONDS,
    chipsRequired: 0,
    playerStart: { ...player, dir: 'N' },
    terrain,
    items: Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null)),
    entities: setup.entities ?? [],
    trapLinks: [],
    cloneLinks: setup.cloneLinks ?? [],
    ...(setup.cellEdges ? { cellEdges: setup.cellEdges } : {})
  };
}

function placed(type: string, x: number, y: number, dir: Direction): EntityPlacement {
  return { type, x, y, dir };
}

/** A turret of the lane, facing east by default, as most tests need it. */
function laneTurret(type = 'turret_fixed', dir: Direction = 'E'): EntityPlacement {
  return placed(type, TURRET_X, LANE_Y, dir);
}

function load(level: CompiledLevel): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(level);
  return engine;
}

function run(engine: GameEngine, count: number): void {
  for (let i = 0; i < count; i++) engine.tick();
}

/** Takes the player's first step (north, away from the lane), which arms the turrets that wait for it. */
function firstStep(engine: GameEngine): void {
  expect(engine.attemptPlayerMove('N')).toBe(true);
}

/** Ticks until the player may move, then moves. */
function step(engine: GameEngine, dir: Direction): boolean {
  for (let waited = 0; waited <= MAX_WAIT_TICKS; waited++) {
    if (engine.getPlayer().moveCooldown === 0) return engine.attemptPlayerMove(dir);
    engine.tick();
  }
  throw new Error('the player never became able to move');
}

function world(engine: GameEngine): EpoxyWorld {
  return (engine as unknown as { w: EpoxyWorld }).w;
}

function turretOf(engine: GameEngine, type: string): RuntimeEntity {
  const found = engine.getEntities().find((e) => e.type === type);
  if (!found) throw new Error(`no ${type}`);
  return found;
}

function cellsOf(cells: readonly BeamCell[]): string[] {
  return cells.map((c) => `${c.x},${c.y}${c.horizontal ? 'h' : ''}${c.vertical ? 'v' : ''}`).sort();
}

/** The lane cells east of the turret, `count` of them. */
function laneCells(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `${TURRET_X + 1 + i},${LANE_Y}h`);
}

function defOf(type: string): EntityDefinition {
  const def = ConfigRegistry.getEntityDef(type);
  if (!def) throw new Error(`no definition ${type}`);
  return def;
}

function beamOf(type: string): NonNullable<EntityDefinition['turretBeam']> {
  const beam = defOf(type).turretBeam;
  if (!beam) throw new Error(`${type} is no turret`);
  return beam;
}

beforeEach(() => {
  loadTestConfigs();
});

describe('turrets: configuration', () => {
  it('defines four turret blocks, with a beam of three cells and a period of sixty ticks', () => {
    const expected: Array<[string, number, boolean]> = [
      ['turret_fixed', 0, false],
      ['turret_cw', 1, false],
      ['turret_ccw', -1, false],
      ['turret_multi', 0, true]
    ];
    for (const [id, turn, allSides] of expected) {
      const def = defOf(id);
      expect(def.kind, id).toBe('block');
      expect(def.pushable, id).toBe(true);
      expect(def.refusesHazards, id).toEqual(['water']);
      expect(def.destroyedByBomb, id).toBe(true);
      expect(def.destroyedByFire, id).toBe(false);
      expect(def.mirrorAxis, id).toBeUndefined();
      expect(def.turretBeam?.length, id).toBe(TURRET_LENGTH);
      expect(def.turretBeam?.turn, id).toBe(turn);
      expect(def.turretBeam?.turnPeriodTicks, id).toBe(TURN_PERIOD);
      expect(def.turretBeam?.allSides === true, id).toBe(allSides);
    }
    expect(findTurretConfigErrors(ConfigRegistry.getMonsters().entities)).toEqual([]);
  });

  it('names every turret in both languages, in French with its accents', () => {
    const names = (locale: { entities: Record<string, { name: string }> }): string[] =>
      ['turret_fixed', 'turret_cw', 'turret_ccw', 'turret_multi'].map((id) => locale.entities[id].name);
    expect(names(en)).toEqual(['Fixed Turret', 'Clockwise Turret', 'Counter-Clockwise Turret', 'Four-Way Turret']);
    expect(names(fr)).toEqual(['Tourelle fixe', 'Tourelle horaire', 'Tourelle antihoraire', 'Tourelle quadruple']);
    for (const id of Object.keys(ConfigRegistry.getMonsters().entities)) {
      expect(ConfigRegistry.getEntityDef(id)?.i18nKey, id).toBe(`entities.${id}.name`);
    }
  });

  it('refuses a monster, a mirror, a bad length, a bad turn, a bad period, a bad flag and a bad opacity', () => {
    const entities = structuredClone(ConfigRegistry.getMonsters().entities);
    const withBeam = (patch: Record<string, unknown>, base: Partial<EntityDefinition> = {}): string[] =>
      findTurretConfigErrors({
        ...entities,
        turret_fixed: { ...entities.turret_fixed, ...base, turretBeam: { ...entities.turret_fixed.turretBeam, ...patch } as never }
      });
    expect(withBeam({})).toEqual([]);
    expect(withBeam({ length: 0 })).toHaveLength(1);
    expect(withBeam({ length: 9 })).toHaveLength(1);
    expect(withBeam({ length: 2.5 })).toHaveLength(1);
    expect(withBeam({ length: 8 })).toEqual([]);
    expect(withBeam({ turn: 2 })).toHaveLength(1);
    expect(withBeam({ turnPeriodTicks: 0 })).toHaveLength(1);
    expect(withBeam({ faceOnPush: 'yes' })).toHaveLength(1);
    expect(withBeam({ opacity: 'glass' })).toHaveLength(1);
    expect(withBeam({}, { kind: 'monster' })).toHaveLength(1);
    expect(withBeam({}, { mirrorAxis: 'slash' })).toHaveLength(1);
  });
});

describe('turrets: beams', () => {
  it('fires three cells along its facing, horizontally only, from the first step', () => {
    const engine = load(room({ entities: [laneTurret()] }));
    expect(engine.getBeamCells()).toEqual([]);
    firstStep(engine);
    expect(cellsOf(engine.getBeamCells())).toEqual(laneCells(TURRET_LENGTH));
  });

  it('fires south as vertical cells', () => {
    const engine = load(room({ entities: [laneTurret('turret_fixed', 'S')] }));
    firstStep(engine);
    expect(cellsOf(engine.getBeamCells())).toEqual([`${TURRET_X},6v`, `${TURRET_X},7v`, `${TURRET_X},8v`]);
  });

  it('fires four ways from a multi turret', () => {
    const engine = load(room({ entities: [placed('turret_multi', 5, 5, 'N')] }));
    firstStep(engine);
    const cells = engine.getBeamCells();
    expect(cells).toHaveLength(MULTI_ARMS * TURRET_LENGTH);
    expect(cells.filter((c) => c.horizontal && !c.vertical)).toHaveLength(2 * TURRET_LENGTH);
    expect(cells.filter((c) => c.vertical && !c.horizontal)).toHaveLength(2 * TURRET_LENGTH);
  });

  it('is stopped, without covering the cell, by a wall', () => {
    const engine = load(room({ entities: [laneTurret()], terrain: [[TURRET_X + 2, LANE_Y, 'wall']] }));
    firstStep(engine);
    expect(cellsOf(engine.getBeamCells())).toEqual(laneCells(1));
  });

  it('is stopped by a closed laser gate', () => {
    const closed = load(room({ entities: [laneTurret()], terrain: [[TURRET_X + 2, LANE_Y, 'laser_gate_red_closed']] }));
    firstStep(closed);
    expect(cellsOf(closed.getBeamCells())).toEqual(laneCells(1));
  });

  it('is stopped by a receiver and does not light it', () => {
    const engine = load(room({ entities: [laneTurret()], terrain: [[TURRET_X + 2, LANE_Y, 'laser_receiver_red']] }));
    firstStep(engine);
    expect(cellsOf(engine.getBeamCells())).toEqual(laneCells(1));
    expect(engine.getLitReceivers()).toEqual([]);
  });

  it('is stopped by a cell edge on either side of the step it would cross', () => {
    const onNearCell = load(room({ entities: [laneTurret()], cellEdges: [{ x: TURRET_X + 1, y: LANE_Y, sides: ['E'] }] }));
    firstStep(onNearCell);
    expect(cellsOf(onNearCell.getBeamCells())).toEqual(laneCells(1));
    const onFarCell = load(room({ entities: [laneTurret()], cellEdges: [{ x: TURRET_X + 2, y: LANE_Y, sides: ['W'] }] }));
    firstStep(onFarCell);
    expect(cellsOf(onFarCell.getBeamCells())).toEqual(laneCells(1));
  });

  it('is stopped by a mirror, a dirt block and another turret, and is never reflected', () => {
    // The other turret faces back at the first one: its beam covers the same single cell.
    for (const other of ['mirror_slash', 'mirror_backslash', 'dirt_block', 'turret_cw']) {
      const engine = load(room({ entities: [laneTurret(), placed(other, TURRET_X + 2, LANE_Y, 'W')] }));
      firstStep(engine);
      expect(cellsOf(engine.getBeamCells()), other).toEqual(laneCells(1));
    }
  });

  it('is stopped by a cell a dirt block could not enter (the dirt tile), and passes it with laser opacity', () => {
    const level = (): CompiledLevel => room({ entities: [laneTurret()], terrain: [[TURRET_X + 2, LANE_Y, 'dirt']] });
    const blocked = load(level());
    firstStep(blocked);
    expect(cellsOf(blocked.getBeamCells())).toEqual(laneCells(1));
    beamOf('turret_fixed').opacity = 'laser';
    const open = load(level());
    firstStep(open);
    expect(cellsOf(open.getBeamCells())).toEqual(laneCells(TURRET_LENGTH));
  });

  it('reads an item that a block could not enter as opaque with block opacity only, and retraces after a drop', () => {
    const engine = load(room({ entities: [laneTurret()] }));
    firstStep(engine);
    expect(cellsOf(engine.getBeamCells())).toEqual(laneCells(TURRET_LENGTH));
    // An item that stops a block lies on the lane; the cached beams only change once something marks them dirty.
    engine.getItems()[LANE_Y][TURRET_X + 2] = 'wall';
    expect(cellsOf(engine.getBeamCells())).toEqual(laneCells(TURRET_LENGTH));
    // Dropping an item marks them dirty.
    engine.getPlayer().keys.key_red = 1;
    expect(engine.dropItem('key_red')).toBe(true);
    expect(cellsOf(engine.getBeamCells())).toEqual(laneCells(1));

    beamOf('turret_fixed').opacity = 'laser';
    const seeing = load(room({ entities: [laneTurret()] }));
    seeing.getItems()[LANE_Y][TURRET_X + 2] = 'wall';
    firstStep(seeing);
    expect(cellsOf(seeing.getBeamCells())).toEqual(laneCells(TURRET_LENGTH));
  });

  it('lets a plain item such as a key lie on the lane without stopping the beam', () => {
    const engine = load(room({ entities: [laneTurret()] }));
    engine.getItems()[LANE_Y][TURRET_X + 2] = 'key_red';
    firstStep(engine);
    expect(cellsOf(engine.getBeamCells())).toEqual(laneCells(TURRET_LENGTH));
  });
});

describe('turrets: kills', () => {
  it('kills the first monster on the beam and ends there', () => {
    const engine = load(
      room({
        entities: [laneTurret(), placed('pink_ball', TURRET_X + 1, LANE_Y, 'N'), placed('pink_ball', TURRET_X + 2, LANE_Y, 'N')]
      })
    );
    firstStep(engine);
    const balls = engine.getEntities().filter((e) => e.type === 'pink_ball');
    expect(balls.map((b) => b.x)).toEqual([TURRET_X + 2]);
    expect(engine.getPlayer().alive).toBe(true);
  });

  it('kills a player who walks into the beam', () => {
    const engine = load(
      room({
        entities: [laneTurret()],
        player: { x: TURRET_X + 1, y: LANE_Y + 1 }
      })
    );
    // The first step goes south, away from the lane, and arms the turret.
    expect(engine.attemptPlayerMove('S')).toBe(true);
    expect(engine.getPlayer().alive).toBe(true);
    // Back north into the beam: the player is on the first beam cell.
    expect(step(engine, 'N')).toBe(true);
    expect(step(engine, 'N')).toBe(true);
    expect(engine.getPlayer()).toMatchObject({ alive: false, deathReasonKey: 'hud.messages.death_laser' });
  });

  it('does not harm a block', () => {
    const engine = load(room({ entities: [laneTurret(), placed('mirror_slash', TURRET_X + 1, LANE_Y, 'N')] }));
    firstStep(engine);
    expect(engine.getEntities().some((e) => e.type === 'mirror_slash')).toBe(true);
    expect(engine.getBeamCells()).toEqual([]);
  });
});

describe('turrets: clock and arming', () => {
  it('stays silent and still until the first step, however long the level waits', () => {
    const engine = load(room({ entities: [laneTurret('turret_cw', 'N')] }));
    run(engine, TURN_PERIOD * 3);
    expect(engine.getBeamCells()).toEqual([]);
    expect(turretOf(engine, 'turret_cw').facing).toBe('N');
  });

  it('fires from load when the definition does not wait for the first step', () => {
    beamOf('turret_fixed').firesAfterFirstStep = false;
    const engine = load(room({ entities: [laneTurret()] }));
    expect(cellsOf(engine.getBeamCells())).toEqual(laneCells(TURRET_LENGTH));
  });

  it('turns a clockwise turret a quarter turn at 60 and 120 ticks after the first step', () => {
    const engine = load(room({ entities: [laneTurret('turret_cw', 'N')] }));
    firstStep(engine);
    run(engine, TURN_PERIOD - 1);
    expect(turretOf(engine, 'turret_cw').facing).toBe('N');
    run(engine, 1);
    expect(turretOf(engine, 'turret_cw').facing).toBe('E');
    run(engine, TURN_PERIOD);
    expect(turretOf(engine, 'turret_cw').facing).toBe('S');
  });

  it('turns a counter-clockwise turret the other way', () => {
    const engine = load(room({ entities: [laneTurret('turret_ccw', 'N')] }));
    firstStep(engine);
    run(engine, TURN_PERIOD);
    expect(turretOf(engine, 'turret_ccw').facing).toBe('W');
    run(engine, TURN_PERIOD);
    expect(turretOf(engine, 'turret_ccw').facing).toBe('S');
  });

  it('counts the period from the first step, not from the load', () => {
    const engine = load(room({ entities: [laneTurret('turret_cw', 'N')] }));
    run(engine, IDLE_TICKS_BEFORE_STEP);
    firstStep(engine);
    run(engine, TURN_PERIOD - 1);
    expect(engine.getTick()).toBe(IDLE_TICKS_BEFORE_STEP + TURN_PERIOD - 1);
    expect(turretOf(engine, 'turret_cw').facing).toBe('N');
    run(engine, 1);
    expect(turretOf(engine, 'turret_cw').facing).toBe('E');
  });

  it('counts the period from the load when the definition does not wait for the first step', () => {
    beamOf('turret_cw').firesAfterFirstStep = false;
    const engine = load(room({ entities: [laneTurret('turret_cw', 'N')] }));
    run(engine, TURN_PERIOD);
    expect(turretOf(engine, 'turret_cw').facing).toBe('E');
  });

  it('keeps a fixed turret still', () => {
    const engine = load(room({ entities: [laneTurret('turret_fixed', 'N')] }));
    firstStep(engine);
    run(engine, TURN_PERIOD * 2);
    expect(turretOf(engine, 'turret_fixed').facing).toBe('N');
  });

  it('turns the direction of fire while the entity direction stays the way it was placed', () => {
    const engine = load(room({ entities: [laneTurret('turret_cw', 'N')] }));
    firstStep(engine);
    run(engine, TURN_PERIOD);
    const entity = turretOf(engine, 'turret_cw');
    expect(entity.facing).toBe('E');
    expect(entity.dir).toBe('N');
    expect(cellsOf(engine.getBeamCells())).toEqual(laneCells(TURRET_LENGTH));
  });
});

describe('turrets: push and slide', () => {
  it('turns toward a push by the player', () => {
    const engine = load(room({ entities: [laneTurret('turret_fixed', 'N')], player: { x: TURRET_X - 1, y: LANE_Y } }));
    expect(engine.attemptPlayerMove('E')).toBe(true);
    const entity = turretOf(engine, 'turret_fixed');
    expect(entity.x).toBe(TURRET_X + 1);
    expect(entity.facing).toBe('E');
  });

  it('keeps its facing through a push when the definition says so', () => {
    beamOf('turret_fixed').faceOnPush = false;
    const engine = load(room({ entities: [laneTurret('turret_fixed', 'N')], player: { x: TURRET_X - 1, y: LANE_Y } }));
    expect(engine.attemptPlayerMove('E')).toBe(true);
    expect(turretOf(engine, 'turret_fixed').facing).toBe('N');
  });

  it('does not turn for a push that fails', () => {
    const engine = load(
      room({
        entities: [laneTurret('turret_fixed', 'N')],
        player: { x: TURRET_X - 1, y: LANE_Y },
        terrain: [[TURRET_X + 1, LANE_Y, 'wall']]
      })
    );
    expect(engine.attemptPlayerMove('E')).toBe(false);
    expect(turretOf(engine, 'turret_fixed').facing).toBe('N');
  });

  it('keeps its facing through a slide: a force floor changes the direction of travel only', () => {
    const engine = load(
      room({
        entities: [laneTurret('turret_fixed', 'N')],
        player: { x: TURRET_X - 1, y: LANE_Y },
        terrain: [[TURRET_X + 1, LANE_Y, 'force_s']]
      })
    );
    expect(engine.attemptPlayerMove('E')).toBe(true);
    const entity = turretOf(engine, 'turret_fixed');
    expect(entity.facing).toBe('E');
    expect(entity.dir).toBe('S');
    expect(entity.isSliding).toBe(true);
    run(engine, MAX_WAIT_TICKS);
    expect(turretOf(engine, 'turret_fixed').facing).toBe('E');
  });

  it('turns by its clock while the entity keeps the direction it slides in', () => {
    const engine = load(
      room({
        entities: [laneTurret('turret_cw', 'N')],
        player: { x: TURRET_X - 1, y: LANE_Y },
        terrain: [
          [TURRET_X + 1, LANE_Y, 'force_s'],
          [TURRET_X + 1, LANE_Y + 1, 'force_s'],
          [TURRET_X + 1, LANE_Y + 2, 'force_s']
        ]
      })
    );
    expect(engine.attemptPlayerMove('E')).toBe(true);
    run(engine, TURN_PERIOD);
    const entity = turretOf(engine, 'turret_cw');
    expect(entity.dir).toBe('S');
    // Pushed east at the first step, then one quarter turn clockwise at the first period.
    expect(entity.facing).toBe('S');
  });
});

describe('turrets: clone machines', () => {
  const CLONER_X = 5;
  const BUTTON_X = 3;
  const BUTTON_Y = 6;

  /** A turret template on a clone machine of the lane, and a button two cells north of the player. */
  function clonerLevel(): CompiledLevel {
    return room({
      entities: [placed('turret_cw', CLONER_X, LANE_Y, 'E')],
      terrain: [
        [CLONER_X, LANE_Y, 'clone_machine'],
        [BUTTON_X, BUTTON_Y, 'button_red']
      ],
      cloneLinks: [
        { buttonX: BUTTON_X, buttonY: BUTTON_Y, clonerX: CLONER_X, clonerY: LANE_Y, templateType: 'turret_cw', templateDir: 'E' }
      ],
      player: { x: BUTTON_X, y: BUTTON_Y + 2 }
    });
  }

  /** The first step, east and away from the button, which arms the turrets. */
  function armAwayFromButton(engine: GameEngine): void {
    expect(engine.attemptPlayerMove('E')).toBe(true);
  }

  /** Back to the button column and north onto the button. */
  function walkOntoButton(engine: GameEngine): void {
    for (const dir of ['W', 'N', 'N'] as const) expect(step(engine, dir)).toBe(true);
  }

  it('fires and turns a template on a clone machine', () => {
    const engine = load(clonerLevel());
    expect(world(engine).hasTurrets).toBe(true);
    armAwayFromButton(engine);
    // The template faces east from the machine: the beam starts one cell east of it.
    expect(cellsOf(engine.getBeamCells())).toEqual(
      Array.from({ length: TURRET_LENGTH }, (_, i) => `${CLONER_X + 1 + i},${LANE_Y}h`)
    );
    run(engine, TURN_PERIOD);
    expect(turretOf(engine, 'turret_cw').facing).toBe('S');
  });

  it('spawns a clone that faces the way its template does now', () => {
    const engine = load(clonerLevel());
    armAwayFromButton(engine);
    run(engine, TURN_PERIOD);
    expect(turretOf(engine, 'turret_cw').facing).toBe('S');
    walkOntoButton(engine);
    const copies = engine.getEntities().filter((e) => e.type === 'turret_cw');
    expect(copies).toHaveLength(2);
    expect(copies.find((e) => e.x !== CLONER_X)?.facing).toBe('S');
  });

  it('spawns a clone that faces its spawn direction when the template is gone', () => {
    const level = clonerLevel();
    level.entities = [];
    const engine = load(level);
    expect(world(engine).hasTurrets).toBe(true);
    armAwayFromButton(engine);
    walkOntoButton(engine);
    expect(engine.getEntities().find((e) => e.type === 'turret_cw')?.facing).toBe('E');
  });

  it('knows a level with only a turret link has turrets, and one without none', () => {
    const level = clonerLevel();
    level.entities = [];
    expect(world(load(level)).hasTurrets).toBe(true);
    expect(world(load(room())).hasTurrets).toBe(false);
  });
});

describe('turrets: undo and search keys', () => {
  it('restores the facing and the clock on undo', () => {
    const engine = load(room({ entities: [laneTurret('turret_cw', 'N')] }));
    firstStep(engine);
    run(engine, IDLE_TICKS_BEFORE_STEP);
    expect(step(engine, 'N')).toBe(true);
    run(engine, TURN_PERIOD);
    expect(turretOf(engine, 'turret_cw').facing).not.toBe('N');
    const tickBeforeUndo = engine.getTick();
    expect(engine.undo()).toBe(true);
    expect(turretOf(engine, 'turret_cw').facing).toBe('N');
    expect(engine.getTick()).toBeLessThan(tickBeforeUndo);
    // The clock is the one of the first step: the turn comes at the same tick as before.
    run(engine, TURN_PERIOD - engine.getTick());
    expect(turretOf(engine, 'turret_cw').facing).toBe('E');
  });

  it('forgets the first step when it is undone', () => {
    const engine = load(room({ entities: [laneTurret('turret_cw', 'N')] }));
    firstStep(engine);
    expect(world(engine).playStartTick).toBe(0);
    expect(engine.undo()).toBe(true);
    expect(world(engine).playStartTick).toBe(-1);
    expect(engine.getBeamCells()).toEqual([]);
    run(engine, TURN_PERIOD);
    expect(turretOf(engine, 'turret_cw').facing).toBe('N');
  });

  it('writes the play start into a snapshot of a turret level only', () => {
    expect('playStartTick' in load(room({ entities: [laneTurret()] })).captureState()).toBe(true);
    expect('playStartTick' in load(room()).captureState()).toBe(false);
  });

  it('tells two facings apart in the search state key, and two clock phases', () => {
    const north = load(room({ entities: [laneTurret('turret_fixed', 'N')] }));
    const east = load(room({ entities: [laneTurret('turret_fixed', 'E')] }));
    expect(searchStateKey(north)).not.toBe(searchStateKey(east));
    const early = load(room({ entities: [laneTurret('turret_cw', 'N')] }));
    const late = load(room({ entities: [laneTurret('turret_cw', 'N')] }));
    firstStep(early);
    firstStep(late);
    run(late, 1);
    expect(searchStateKey(early)).not.toBe(searchStateKey(late));
    expect(early.getTurretPhaseKey()).not.toBe(late.getTurretPhaseKey());
  });

  it('leaves the search state key of a level without turrets as it was', () => {
    const engine = load(room());
    expect(engine.getTurretPhaseKey()).toBe('');
    expect(JSON.parse(searchStateKey(engine))).toHaveLength(SEARCH_KEY_PARTS);
  });
});

describe('turrets: beam lists', () => {
  it('returns the cached emitter list itself while no turret beam exists', () => {
    const plain = load(room({ terrain: [[2, 2, 'laser_emitter_e']] }));
    expect(plain.getBeamCells()).toBe(plain.getEmitterBeamCells());
    const waiting = load(room({ terrain: [[2, 2, 'laser_emitter_e']], entities: [laneTurret()] }));
    expect(waiting.getBeamCells()).toBe(waiting.getEmitterBeamCells());
  });

  it('returns a fresh merged list of copies when a turret beam exists, leaving the emitter cells alone', () => {
    const engine = load(room({ terrain: [[TURRET_X + 2, LANE_Y - 1, 'laser_emitter_s']], entities: [laneTurret()] }));
    firstStep(engine);
    const emitter = engine.getEmitterBeamCells();
    const emitterBefore = cellsOf(emitter);
    const merged = engine.getBeamCells();
    expect(merged).not.toBe(emitter);
    // The crossing cell carries both axes in the merged list only.
    expect(merged.find((c) => c.x === TURRET_X + 2 && c.y === LANE_Y)).toMatchObject({ horizontal: true, vertical: true });
    expect(cellsOf(engine.getEmitterBeamCells())).toEqual(emitterBefore);
    expect(engine.getEmitterBeamCells().some((c) => c.horizontal)).toBe(false);
  });
});

describe('turrets: validator', () => {
  it('does not flag a gate that only a turret beam crosses as a self-feeding gate', () => {
    // The turret beam is there from load, as the validator loads the level without a step.
    beamOf('turret_fixed').firesAfterFirstStep = false;
    const level = room({
      entities: [laneTurret()],
      terrain: [
        [2, 2, 'laser_emitter_e'],
        [4, 2, 'laser_receiver_red'],
        [TURRET_X + 2, LANE_Y, 'laser_gate_red_closed']
      ]
    });
    const report = LevelValidator.validate(level);
    expect(report.issues.map((i) => i.i18nKey)).not.toContain('validator.issues.laser_gate_on_beam.label');
  });
});
