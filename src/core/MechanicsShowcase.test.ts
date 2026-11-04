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

vi.mock('../audio/AudioManager', () => ({
  AudioManager: { playSfx: vi.fn(), playStep: vi.fn(), runSilently: <T>(task: () => T): T => task() }
}));

import { GameEngine } from './GameEngine';
import { ConfigRegistry } from '../config/ConfigRegistry';
import { isCompiledLevelShape } from '../config/ConfigValidation';
import { LevelValidator } from './LevelValidator';
import { CompiledLevel, Direction, LevelBlueprint } from './types';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { t } from '../i18n/I18nManager';
import { CHANNEL_COLOR_NAME_KEY_PREFIX } from './coreConstants';
import showcase from '../test/fixtures/mechanicsShowcase.json';
import { storedSolutionWins } from '../generator/SolutionReplay';
import { decodeActions, PieceSolver } from '../generator/PieceSolver';

/** Ticks the move cooldown away, then plays one step and reports whether it was taken. */
function step(engine: GameEngine, dir: Direction): boolean {
  const cooldownTicks = 20;
  for (let i = 0; i < cooldownTicks; i++) engine.tick();
  return engine.attemptPlayerMove(dir);
}

function walk(engine: GameEngine, path: string): void {
  for (const ch of path) {
    expect(step(engine, ch as Direction), `move ${ch} at (${engine.getPlayer().x}, ${engine.getPlayer().y})`).toBe(true);
  }
}

function compileShowcase(index: number = 0): CompiledLevel {
  const blueprint = (showcase as { levels: LevelBlueprint[] }).levels[index];
  return ConfigRegistry.compileBlueprint(blueprint);
}

/**
 * The hand-made level that shows every mechanic of the drop, barrier, thief,
 * turtle, thin wall, colour teleport, flame jet and bonus item set. It is
 * also the pack to import in the running game to see them drawn.
 */
describe('mechanics showcase level', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('passes the editor validator', () => {
    const report = LevelValidator.validate(compileShowcase());
    expect(report.issues.map((i) => i.i18nKey)).toEqual([]);
    expect(report.valid).toBe(true);
    expect(report.stats.reachableExit).toBe(true);
  });

  it('compiles at its own size with every tile resolved', () => {
    const level = compileShowcase();
    expect(isCompiledLevelShape(level, ConfigRegistry.getLevelSizeBounds())).toBe(true);
    expect(level.terrain).toHaveLength(11);
    expect(level.terrain[0]).toHaveLength(21);
    const ids = new Set(level.terrain.flat());
    for (const id of ids) {
      expect(ConfigRegistry.getTile(id).id, id).toBe(id);
    }
    for (const id of level.items.flat()) {
      if (id) expect(ConfigRegistry.getTile(id).id, id).toBe(id);
    }
  });

  it('plays through to the exit, using every mechanic on the way', () => {
    const engine = new GameEngine();
    engine.loadLevel(compileShowcase());

    // The red key, then its barrier: the key must be put down to pass.
    walk(engine, 'EE');
    expect(engine.getPlayer().keys.key_red).toBe(1);
    walk(engine, 'E');
    expect(step(engine, 'E')).toBe(false);
    expect(engine.getStatusBannerKey()).toBe('hud.messages.forbidden_item');
    expect(engine.dropItem('key_red')).toBe(true);
    walk(engine, 'EEE');
    expect(engine.getPlayer().keys.key_blue).toBe(1);
    walk(engine, 'WWW');
    expect(engine.getPlayer().keys.key_red).toBe(1);
    walk(engine, 'WWW');

    // The blue door, the bonus room, a blue teleport hop and the time penalty.
    walk(engine, 'SS');
    expect(engine.getTerrain()[3][1]).toBe('floor');
    walk(engine, 'SES');
    expect(engine.getLevelScoreMultiplier()).toBe(2);
    walk(engine, 'EEEE');
    expect(engine.getPlayer()).toMatchObject({ x: 2, y: 6 });
    walk(engine, 'EEEE');
    expect(engine.getExtraTimeSeconds()).toBe(-10);
    walk(engine, 'ENN');
    expect(engine.getPlayer().keys.key_yellow).toBe(1);

    // Thin panels close the room from above except at x = 1 and x = 5.
    walk(engine, 'WWWWWWNE');
    expect(engine.getPlayer()).toMatchObject({ x: 2, y: 3 });
    expect(step(engine, 'S')).toBe(false);
    walk(engine, 'EEEEEE');
    expect(engine.getTerrain()[3][8]).toBe('floor');

    // Turtles sink behind the player, the thief takes the keys, the button swaps the jets.
    walk(engine, 'EE');
    expect(engine.getTerrain()[3][9]).toBe('water');
    walk(engine, 'E');
    expect(engine.getTerrain()[3][10]).toBe('water');
    expect(Object.values(engine.getPlayer().keys).some((count) => count > 0)).toBe(false);
    expect(engine.getStatusBannerKey()).toBe('hud.messages.thief_stole_keys');
    walk(engine, 'E');
    expect(engine.getTerrain()[3][13]).toBe('flame_jet_off');
    expect(engine.getTerrain()[9][17]).toBe('flame_jet_on');
    walk(engine, 'EE');
    expect(engine.getLevelBonusPoints()).toBe(100);
    expect(engine.getTotalScore()).toBe(0);
    walk(engine, 'E');
    expect(engine.getExtraTimeSeconds()).toBe(0);

    // The red teleport lands next to its twin, far from the blue pair.
    walk(engine, 'E');
    expect(engine.getPlayer()).toMatchObject({ x: 18, y: 7 });
    walk(engine, 'SSE');
    expect(engine.isLevelCompleted()).toBe(true);
    expect(engine.getChipsRemaining()).toBe(0);
    const timing = ConfigRegistry.getGame().timing;
    expect(engine.getLastLevelScore()).toBe((timing.levelBasePoints + engine.getLastTimeBonus() + 100) * 2);
    expect(engine.getTotalScore()).toBe(engine.getLastLevelScore());
  });
});

/** Index of the colour channels level in the showcase pack. */
const COLOR_LEVEL_INDEX = 1;
/** The ids the colour channels level must use: every plate, hold door, colour wall, colour button, floating tile and colour block. */
const COLORS = ['red', 'green', 'blue', 'yellow'] as const;
const TOGGLE_COLORS = ['red', 'blue', 'yellow'] as const;
const COLOR_LEVEL_TILE_IDS: readonly string[] = [
  ...COLORS.map((c) => `pressure_plate_${c}`),
  ...COLORS.flatMap((c) => [`hold_door_${c}_closed`, `hold_door_${c}_open`]),
  ...TOGGLE_COLORS.flatMap((c) => [`toggle_wall_${c}_closed`, `toggle_wall_${c}_open`, `toggle_button_${c}`]),
  ...COLORS.map((c) => `floating_block_${c}`)
];
const COLOR_LEVEL_ENTITY_TYPES: readonly string[] = COLORS.map((c) => `color_block_${c}`);
/** The route of the level, one letter per step: each gate in turn, then the bridge. */
const GATE_STEP = 'S' + 'E'.repeat(6) + 'N';

describe('colour channels showcase level', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('uses every plate, hold door, colour wall, colour button, floating block and colour block', () => {
    const level = compileShowcase(COLOR_LEVEL_INDEX);
    const tiles = new Set(level.terrain.flat());
    for (const id of COLOR_LEVEL_TILE_IDS) expect(tiles.has(id), id).toBe(true);
    const types = new Set(level.entities.map((e) => e.type));
    for (const type of COLOR_LEVEL_ENTITY_TYPES) expect(types.has(type), type).toBe(true);
    expect(isCompiledLevelShape(level, ConfigRegistry.getLevelSizeBounds())).toBe(true);
  });

  it('passes the validator, warning only that each hold door colour starts against its plates', () => {
    const report = LevelValidator.validate(compileShowcase(COLOR_LEVEL_INDEX));
    expect(report.valid).toBe(true);
    expect(report.stats.reachableExit).toBe(true);
    expect(report.issues.every((i) => i.severity === 'warning')).toBe(true);
    const colours = report.issues
      .filter((i) => i.i18nKey === 'validator.issues.hold_door_wrong_start.label')
      .map((i) => i.params?.color)
      .sort();
    // The warning shows the localized colour name, not the raw id.
    expect(colours).toEqual(COLORS.map((c) => t(`${CHANNEL_COLOR_NAME_KEY_PREFIX}${c}`)).sort());
    expect(report.issues).toHaveLength(COLORS.length);
  });

  it('plays through the four gates, the three colour walls and the bridge to the exit', () => {
    const engine = new GameEngine();
    engine.loadLevel(compileShowcase(COLOR_LEVEL_INDEX));
    // Every hold door starts shut, whatever form the level placed.
    for (const color of COLORS) {
      expect(engine.getTerrain().flat().filter((id) => id === `hold_door_${color}_open`)).toEqual([]);
    }

    // Each colour block is pushed north onto the plate of its colour, which opens its doors for good.
    walk(engine, 'EEN');
    expect(engine.getTerrain()[1][3]).toBe('pressure_plate_red');
    expect(engine.getEntities().find((e) => e.type === 'color_block_red')).toMatchObject({ x: 3, y: 1 });
    expect(engine.getTerrain()[2][6]).toBe('hold_door_red_open');
    for (const color of ['green', 'blue', 'yellow'] as const) {
      expect(engine.getTerrain().flat()).toContain(`hold_door_${color}_closed`);
      walk(engine, GATE_STEP);
      expect(engine.getTerrain().flat()).not.toContain(`hold_door_${color}_closed`);
    }

    // The red button swaps the red walls, the blue one the blue walls, the yellow one the yellow walls.
    walk(engine, 'S' + 'E'.repeat(6));
    expect(engine.getPlayer()).toMatchObject({ x: 27, y: 3 });
    expect(engine.getTerrain()[2][29]).toBe('toggle_wall_red_open');
    expect(engine.getTerrain()[3][29]).toBe('toggle_wall_red_closed');
    expect(engine.getTerrain()[2][33]).toBe('toggle_wall_blue_closed');
    walk(engine, 'ENEESEE');
    expect(engine.getTerrain()[2][33]).toBe('toggle_wall_blue_open');
    expect(engine.getTerrain()[2][37]).toBe('toggle_wall_yellow_closed');
    walk(engine, 'NEESEE');
    expect(engine.getTerrain()[2][37]).toBe('toggle_wall_yellow_open');

    // The last colour block sinks into the water and floats, and the bridge leads to the exit.
    walk(engine, 'NEESEEE');
    expect(engine.getTerrain()[3][42]).toBe('floating_block_red');
    expect(engine.getEntities().filter((e) => e.type === 'color_block_red')).toHaveLength(1);
    walk(engine, 'EEEEEEE');
    expect(engine.isLevelCompleted()).toBe(true);
    expect(engine.getPlayer().alive).toBe(true);
  });

  it('carries a stored solution that wins in the engine', () => {
    expect(storedSolutionWins(compileShowcase(COLOR_LEVEL_INDEX))).toBe(true);
  });
});

/** Index of the cell edges level in the showcase pack. */
const EDGES_LEVEL_INDEX = 2;

/** Ticks a slide on ice or on a force floor needs to settle in the cell-edges level. */
const SLIDE_SETTLE_TICKS = 120;

function settle(engine: GameEngine): void {
  for (let i = 0; i < SLIDE_SETTLE_TICKS; i++) engine.tick();
}

/**
 * The level of thin walls on any terrain: one on water, one on a force floor, one on ice. Each stops
 * what would otherwise drown, burn or slide the player on.
 */
describe('cell edges showcase level', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  function compileEdges(): CompiledLevel {
    const blueprint = (showcase as { levels: LevelBlueprint[] }).levels[EDGES_LEVEL_INDEX];
    return ConfigRegistry.compileBlueprint(blueprint);
  }

  it('compiles with its cell edges and passes the editor validator', () => {
    const level = compileEdges();
    expect(level.cellEdges).toEqual([
      { x: 3, y: 1, sides: ['W'] },
      { x: 8, y: 4, sides: ['E'] },
      { x: 6, y: 5, sides: ['W'] }
    ]);
    expect(isCompiledLevelShape(level, ConfigRegistry.getLevelSizeBounds())).toBe(true);
    const report = LevelValidator.validate(level);
    expect(report.issues.map((i) => i.i18nKey)).toEqual([]);
    expect(report.valid).toBe(true);
    expect(report.stats.reachableExit).toBe(true);
  });

  it('plays through to the exit, the edges holding on water, force floor and ice', () => {
    const engine = new GameEngine();
    engine.loadLevel(compileEdges());

    // The edge on the water refuses the step before the water can take the player.
    walk(engine, 'E');
    expect(step(engine, 'E')).toBe(false);
    expect(engine.getPlayer()).toMatchObject({ x: 2, y: 1, alive: true });
    walk(engine, 'SEEESS');
    expect(engine.getPlayer()).toMatchObject({ x: 5, y: 4 });

    // The force floor pushes east and the edge stops the slide before the fire.
    walk(engine, 'E');
    settle(engine);
    expect(engine.getPlayer()).toMatchObject({ x: 8, y: 4, alive: true, isSliding: false });

    // The ice slide stops at the edge before the water, bounces back and has taken the chip.
    walk(engine, 'SW');
    settle(engine);
    expect(engine.getPlayer()).toMatchObject({ x: 8, y: 5, alive: true, isSliding: false });
    expect(engine.getChipsRemaining()).toBe(0);
    walk(engine, 'SE');
    expect(engine.isLevelCompleted()).toBe(true);
  });

  it('carries a stored solution that wins', () => {
    expect(storedSolutionWins(compileEdges())).toBe(true);
  });
});

/** Index of the slow-time level in the showcase pack. */
const SLOW_TIME_LEVEL_INDEX = 3;
const SLOW_TIME_ID = 'slow_time';
/** Cell of the charm, and the actions of the stored solution that bring the player onto it. */
const CHARM_CELL = { x: 3, y: 2 };
const CHARM_ACTIONS = 2;

/**
 * The level of the slow-time charm: three patrols guard a lane that cannot be crossed at their normal pace,
 * the charm halves their speed while it is held, and the thief at the end of the lane takes it.
 */
describe('slow-time showcase level', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  function compileSlowTime(): CompiledLevel {
    const blueprint = (showcase as { levels: LevelBlueprint[] }).levels[SLOW_TIME_LEVEL_INDEX];
    return ConfigRegistry.compileBlueprint(blueprint);
  }

  it('compiles with the charm in place and passes the editor validator', () => {
    const level = compileSlowTime();
    expect(isCompiledLevelShape(level, ConfigRegistry.getLevelSizeBounds())).toBe(true);
    expect(level.items[CHARM_CELL.y][CHARM_CELL.x]).toBe(SLOW_TIME_ID);
    const report = LevelValidator.validate(level);
    expect(report.issues.map((i) => i.i18nKey)).toEqual([]);
    expect(report.valid).toBe(true);
    expect(report.stats.reachableExit).toBe(true);
  });

  it('plays through: the charm is picked up, the lane is crossed, the thief takes the charm, the exit opens the level', () => {
    const level = compileSlowTime();
    const actions = decodeActions(level.solution ?? '');
    const engine = new GameEngine();
    engine.loadLevel(level);
    actions.slice(0, CHARM_ACTIONS).forEach((action) => PieceSolver.play(engine, action));
    expect(engine.getPlayer()).toMatchObject({ x: CHARM_CELL.x, y: CHARM_CELL.y, alive: true });
    expect(engine.holdsItem(SLOW_TIME_ID)).toBe(true);
    actions.slice(CHARM_ACTIONS).forEach((action) => PieceSolver.play(engine, action));
    expect(engine.getPlayer().alive).toBe(true);
    expect(engine.holdsItem(SLOW_TIME_ID)).toBe(false);
    expect(engine.isLevelCompleted()).toBe(true);
  });

  it('carries a stored solution that wins, and that fails once the charm is taken away', () => {
    const level = compileSlowTime();
    expect(storedSolutionWins(level)).toBe(true);
    const withoutCharm = { ...level, items: level.items.map((row) => row.map((id) => (id === SLOW_TIME_ID ? null : id))) };
    expect(storedSolutionWins(withoutCharm)).toBe(false);
  });
});

/** Index of the underlays level in the showcase pack. */
const UNDERLAYS_LEVEL_INDEX = 4;

/**
 * The level of terrain hidden under removable tops: a key door over ice, a key door over a toggle button
 * and a socket over the exit. What is under each shows once the top is open.
 */
describe('underlays showcase level', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  function compileUnderlays(): CompiledLevel {
    const blueprint = (showcase as { levels: LevelBlueprint[] }).levels[UNDERLAYS_LEVEL_INDEX];
    return ConfigRegistry.compileBlueprint(blueprint);
  }

  it('compiles with its underlays and passes the editor validator', () => {
    const level = compileUnderlays();
    expect(level.underlays).toEqual([
      { x: 4, y: 1, terrain: 'ice' },
      { x: 9, y: 1, terrain: 'button_green' },
      { x: 8, y: 3, terrain: 'exit' }
    ]);
    expect(isCompiledLevelShape(level, ConfigRegistry.getLevelSizeBounds())).toBe(true);
    const report = LevelValidator.validate(level);
    expect(report.issues.map((i) => i.i18nKey)).toEqual([]);
    expect(report.valid).toBe(true);
    expect(report.stats.reachableExit).toBe(true);
  });

  it('plays through to the exit, each top showing what it hid', () => {
    const engine = new GameEngine();
    engine.loadLevel(compileUnderlays());
    expect(engine.getTerrain()[1][4]).toBe('door_red');

    // The red door opens onto ice: the player slides to the chip.
    walk(engine, 'EEE');
    settle(engine);
    expect(engine.getTerrain()[1][4]).toBe('ice');
    expect(engine.getPlayer()).toMatchObject({ x: 8, y: 1, alive: true, isSliding: false });
    expect(engine.getChipsRemaining()).toBe(0);

    // The blue door opens onto a button, which lowers the toggle wall.
    expect(engine.getTerrain()[2][8]).toBe('toggle_wall_closed');
    walk(engine, 'E');
    expect(engine.getTerrain()[1][9]).toBe('button_green');
    expect(engine.getTerrain()[2][8]).toBe('toggle_wall_open');

    // The socket opens onto the exit.
    walk(engine, 'WSS');
    expect(engine.getTerrain()[3][8]).toBe('exit');
    expect(engine.isLevelCompleted()).toBe(true);
  });

  it('carries a stored solution that wins', () => {
    expect(storedSolutionWins(compileUnderlays())).toBe(true);
  });
});

/** Index of the turret level in the showcase pack. */
const TURRET_LEVEL_INDEX = 5;
const TURRET_TYPES: readonly string[] = ['turret_cw', 'turret_ccw', 'turret_fixed'];
/** The solution letter that waits one move cooldown. */
const WAIT_LETTER = '.';
/** Actions before the lane is crossed: three steps east, then the waits that let both turning turrets look away. */
const WAIT_ACTIONS_END = 15;
const FIXED_TURRET_END_CELL = { x: 10, y: 3 };

/**
 * The level of the turrets: a clockwise and a counter-clockwise turret watch the lane from two alcoves and
 * turn away after a turn period (60 ticks), and a fixed turret under the lane is pushed aside so it faces away.
 */
describe('turret showcase level', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('uses the three kinds of turret and passes the validator', () => {
    const level = compileShowcase(TURRET_LEVEL_INDEX);
    expect(isCompiledLevelShape(level, ConfigRegistry.getLevelSizeBounds())).toBe(true);
    expect(new Set(level.entities.map((e) => e.type))).toEqual(new Set(TURRET_TYPES));
    const report = LevelValidator.validate(level);
    expect(report.issues.map((i) => i.i18nKey)).toEqual([]);
    expect(report.valid).toBe(true);
    expect(report.stats.reachableExit).toBe(true);
  });

  it('plays through: both alcove turrets turn away, the fixed one is pushed aside and the exit opens the level', () => {
    const level = compileShowcase(TURRET_LEVEL_INDEX);
    const actions = decodeActions(level.solution ?? '');
    const engine = new GameEngine();
    engine.loadLevel(level);
    const facingOf = (type: string): string | undefined => engine.getEntities().find((e) => e.type === type)?.facing;
    expect([facingOf('turret_cw'), facingOf('turret_ccw'), facingOf('turret_fixed')]).toEqual(['S', 'S', 'N']);
    actions.slice(0, WAIT_ACTIONS_END).forEach((action) => PieceSolver.play(engine, action));
    expect(engine.getPlayer().alive).toBe(true);
    // A turn period after the first step each has quarter-turned away from the lane.
    expect([facingOf('turret_cw'), facingOf('turret_ccw')]).toEqual(['W', 'E']);
    actions.slice(WAIT_ACTIONS_END).forEach((action) => PieceSolver.play(engine, action));
    expect(engine.getPlayer().alive).toBe(true);
    expect(engine.isLevelCompleted()).toBe(true);
    const fixed = engine.getEntities().find((e) => e.type === 'turret_fixed');
    expect(fixed).toMatchObject({ ...FIXED_TURRET_END_CELL, facing: 'E' });
  });

  it('carries a stored solution that wins, and that fails once the waits are taken out', () => {
    const level = compileShowcase(TURRET_LEVEL_INDEX);
    expect(storedSolutionWins(level)).toBe(true);
    const hasty = { ...level, solution: (level.solution ?? '').split(WAIT_LETTER).join('') };
    expect(storedSolutionWins(hasty)).toBe(false);
  });
});
/** Index of the puppet level in the showcase pack. */
const PUPPET_LEVEL_INDEX = 6;
/** Actions that bring the puppet onto the plate: east onto the control, back, east again, back, east a third time. */
const PUPPET_ROUTINE = 'EWEWE';
const PUPPET_START = { x: 3, y: 1 };
const PUPPET_PLATE = { x: 6, y: 1 };
const PUPPET_DOOR = { x: 8, y: 3 };
const SKITTER_START = { x: 13, y: 3 };
/** Moves east along the corridor, from the control to the room before the exit. */
const CORRIDOR_WALK = 'E'.repeat(10);

/**
 * The level of the puppet: three steps onto the control walk the puppet to the plate that holds the door,
 * and the skitter that blocks the room is flushed out of the way by coming at it from the side.
 */
describe('puppet showcase level', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  const entityCell = (engine: GameEngine, type: string): { x: number; y: number } | undefined => {
    const found = engine.getEntities().find((e) => e.type === type);
    return found ? { x: found.x, y: found.y } : undefined;
  };

  it('uses a puppet, its control, a plate with its door and a skitter, and passes the validator', () => {
    const level = compileShowcase(PUPPET_LEVEL_INDEX);
    expect(isCompiledLevelShape(level, ConfigRegistry.getLevelSizeBounds())).toBe(true);
    expect(new Set(level.entities.map((e) => e.type))).toEqual(new Set(['puppet', 'skitter']));
    expect(level.terrain.flat()).toEqual(expect.arrayContaining(['puppet_control', 'pressure_plate_red', 'hold_door_red_closed']));
    const report = LevelValidator.validate(level);
    expect(report.issues.map((i) => i.i18nKey)).toEqual([]);
    expect(report.valid).toBe(true);
    expect(report.stats.reachableExit).toBe(true);
  });

  it('plays through: the puppet walks to the plate, the door holds, the skitter is flushed from the way', () => {
    const level = compileShowcase(PUPPET_LEVEL_INDEX);
    const actions = decodeActions(level.solution ?? '');
    const engine = new GameEngine();
    engine.loadLevel(level);
    expect(entityCell(engine, 'puppet')).toEqual(PUPPET_START);
    expect(engine.getTerrain()[PUPPET_DOOR.y][PUPPET_DOOR.x]).toBe('hold_door_red_closed');
    // One step of the puppet for each time the player steps east onto the control.
    const puppetAfter = actions.slice(0, PUPPET_ROUTINE.length).map((action) => {
      PieceSolver.play(engine, action);
      return entityCell(engine, 'puppet')?.x;
    });
    expect(puppetAfter).toEqual([4, 4, 5, 5, PUPPET_PLATE.x]);
    expect(entityCell(engine, 'puppet')).toEqual(PUPPET_PLATE);
    expect(engine.getTerrain()[PUPPET_DOOR.y][PUPPET_DOOR.x]).toBe('hold_door_red_open');
    // The skitter has run from the player as far as the east wall allows and waits, lined up with the player.
    expect(entityCell(engine, 'skitter')).toEqual(SKITTER_START);
    actions.slice(PUPPET_ROUTINE.length).forEach((action) => PieceSolver.play(engine, action));
    expect(engine.getPlayer().alive).toBe(true);
    expect(engine.isLevelCompleted()).toBe(true);
    expect(entityCell(engine, 'puppet')).toEqual(PUPPET_PLATE);
    // Coming at it from above made it run south, off the way to the exit.
    const skitter = entityCell(engine, 'skitter');
    expect(skitter).toBeDefined();
    expect(skitter?.y).toBeGreaterThan(SKITTER_START.y);
  });

  it('carries a stored solution that wins', () => {
    expect(storedSolutionWins(compileShowcase(PUPPET_LEVEL_INDEX))).toBe(true);
  });

  it('is not won without the puppet on the plate, nor by walking straight at the skitter', () => {
    const level = compileShowcase(PUPPET_LEVEL_INDEX);
    const solution = level.solution ?? '';
    // Never working the control: the door stays shut.
    expect(storedSolutionWins({ ...level, solution: `${CORRIDOR_WALK}EEEE` })).toBe(false);
    // The routine, then straight along the row into the skitter on the exit.
    const straight = `${PUPPET_ROUTINE}${CORRIDOR_WALK}EEEE`;
    expect(solution.startsWith(PUPPET_ROUTINE)).toBe(true);
    expect(storedSolutionWins({ ...level, solution: straight })).toBe(false);
  });
});
