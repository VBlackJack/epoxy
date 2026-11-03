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
import { storedSolutionWins } from '../generator/SolutionReplay';
import { CompiledLevel, Direction, LevelBlueprint } from './types';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { t } from '../i18n/I18nManager';
import { CHANNEL_COLOR_NAME_KEY_PREFIX } from './coreConstants';
import showcase from '../test/fixtures/mechanicsShowcase.json';

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
