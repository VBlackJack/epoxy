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

import { beforeEach, describe, expect, it } from 'vitest';
import { ConfigRegistry } from './ConfigRegistry';
import {
  assertConfigShape,
  ConfigLoadError,
  findBlockPuzzleConfigErrors,
  InvalidLevelError,
  isCompiledLevelShape
} from './ConfigValidation';
import { DEFAULT_LEVEL_PASSWORD } from './constants';
import { LevelBlueprint } from '../core/types';
import { loadTestConfigs } from '../test/loadTestConfigs';

function blueprint(overrides: Partial<LevelBlueprint> = {}): LevelBlueprint {
  return {
    id: 'test_level',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 100,
    chipsRequired: 0,
    playerStart: { x: 1, y: 1, dir: 'S' },
    entities: [],
    trapLinks: [],
    cloneLinks: [],
    ...overrides
  };
}

describe('ConfigRegistry.compileBlueprint', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('compiles every shipped campaign level', () => {
    const campaign = ConfigRegistry.getLevels();
    expect(campaign.length).toBeGreaterThan(0);
    for (const level of campaign) {
      expect(level.terrain.length).toBe(ConfigRegistry.getGame().grid.mapHeight);
    }
  });

  it('rejects a level without a player start', () => {
    const bp = blueprint();
    delete (bp as Partial<LevelBlueprint>).playerStart;
    expect(() => ConfigRegistry.compileBlueprint(bp)).toThrow(InvalidLevelError);
  });

  it('rejects a player start outside the grid', () => {
    const bp = blueprint({ playerStart: { x: 40, y: 40, dir: 'N' } });
    expect(() => ConfigRegistry.compileBlueprint(bp)).toThrow(InvalidLevelError);
  });

  it('drops entities and links outside the grid', () => {
    const level = ConfigRegistry.compileBlueprint(
      blueprint({
        entities: [
          { x: 2, y: 2, type: 'bug', dir: 'N' },
          { x: 40, y: 40, type: 'bug', dir: 'N' }
        ],
        trapLinks: [{ buttonX: 1, buttonY: 2, trapX: -1, trapY: 3 }],
        cloneLinks: [
          { buttonX: 1, buttonY: 2, clonerX: 3, clonerY: 3, templateType: 'bug', templateDir: 'E' }
        ]
      })
    );
    expect(level.entities).toHaveLength(1);
    expect(level.trapLinks).toHaveLength(0);
    expect(level.cloneLinks).toHaveLength(1);
  });

  it('normalizes missing numeric fields and password', () => {
    const bp = blueprint({ password: '' });
    (bp as unknown as Record<string, unknown>).timeLimitSeconds = 'soon';
    (bp as unknown as Record<string, unknown>).chipsRequired = -4;
    const level = ConfigRegistry.compileBlueprint(bp);
    expect(level.timeLimitSeconds).toBe(0);
    expect(level.chipsRequired).toBe(0);
    expect(level.password).toBe(DEFAULT_LEVEL_PASSWORD);
  });

  it('gives procedural and custom packs a translation key', () => {
    ConfigRegistry.setProceduralLevels([ConfigRegistry.compileBlueprint(blueprint())]);
    const procedural = ConfigRegistry.getAllPacks().find((p) => p.levels.length === 1);
    expect(procedural?.i18nKey).toBeTruthy();
  });
});

/** Walled room of the given size as a terrain grid, player at (1, 1). */
function roomBlueprint(width: number, height: number): LevelBlueprint {
  return blueprint({
    terrain: Array.from({ length: height }, (_, y) =>
      Array.from({ length: width }, (_, x) =>
        x === 0 || y === 0 || x === width - 1 || y === height - 1 ? 'wall' : 'floor'
      )
    ),
    items: Array.from({ length: height }, () => Array.from({ length: width }, () => null))
  });
}

describe('ConfigRegistry.compileBlueprint with a level size of its own', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('compiles a 10x10 terrain grid at its own size', () => {
    const level = ConfigRegistry.compileBlueprint(roomBlueprint(10, 10));
    expect(level.terrain).toHaveLength(10);
    expect(level.terrain.every((row) => row.length === 10)).toBe(true);
    expect(level.items).toHaveLength(10);
    expect(level.items.every((row) => row.length === 10)).toBe(true);
    expect(level.terrain[0][9]).toBe('wall');
    expect(level.terrain[5][5]).toBe('floor');
  });

  it('compiles 40x30 legend rows at their own size', () => {
    const rows = Array.from({ length: 30 }, (_, y) =>
      y === 0 || y === 29 ? '#'.repeat(40) : `#${'.'.repeat(38)}#`
    );
    const level = ConfigRegistry.compileBlueprint(
      blueprint({ rows, playerStart: { x: 38, y: 28, dir: 'N' } })
    );
    expect(level.terrain).toHaveLength(30);
    expect(level.terrain.every((row) => row.length === 40)).toBe(true);
    expect(level.playerStart).toEqual({ x: 38, y: 28, dir: 'N' });
    expect(level.terrain[28][38]).toBe('floor');
  });

  it('keeps the default map size for a blueprint without terrain or rows', () => {
    const { mapWidth, mapHeight } = ConfigRegistry.getGame().grid;
    const level = ConfigRegistry.compileBlueprint(blueprint());
    expect(level.terrain).toHaveLength(mapHeight);
    expect(level.terrain[0]).toHaveLength(mapWidth);
  });

  it('checks the player start, entities and links against the level size', () => {
    expect(() =>
      ConfigRegistry.compileBlueprint({ ...roomBlueprint(10, 10), playerStart: { x: 12, y: 1, dir: 'S' } })
    ).toThrow(InvalidLevelError);
    const level = ConfigRegistry.compileBlueprint({
      ...roomBlueprint(10, 10),
      entities: [
        { x: 2, y: 2, type: 'bug', dir: 'N' },
        { x: 20, y: 2, type: 'bug', dir: 'N' }
      ],
      trapLinks: [{ buttonX: 1, buttonY: 2, trapX: 3, trapY: 12 }]
    });
    expect(level.entities).toHaveLength(1);
    expect(level.trapLinks).toHaveLength(0);
  });

  it('rejects a level larger than the configured bound', () => {
    const { maxLevelSize } = ConfigRegistry.getGame().grid;
    expect(() => ConfigRegistry.compileBlueprint(roomBlueprint(maxLevelSize + 1, 10))).toThrow(
      InvalidLevelError
    );
    expect(() => ConfigRegistry.compileBlueprint(roomBlueprint(10, maxLevelSize + 1))).toThrow(
      InvalidLevelError
    );
  });
});

describe('isCompiledLevelShape', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('accepts a stored level of any rectangular size within the bounds', () => {
    const bounds = ConfigRegistry.getLevelSizeBounds();
    const accepted = (bp: LevelBlueprint) => isCompiledLevelShape(ConfigRegistry.compileBlueprint(bp), bounds);
    expect(accepted(roomBlueprint(10, 10))).toBe(true);
    expect(accepted(roomBlueprint(40, 30))).toBe(true);
    expect(accepted(blueprint())).toBe(true);
  });

  it('rejects a ragged terrain, a mismatched items grid and a start outside the level', () => {
    const bounds = ConfigRegistry.getLevelSizeBounds();
    const ragged = ConfigRegistry.compileBlueprint(roomBlueprint(10, 10));
    ragged.terrain[3] = ragged.terrain[3].slice(0, 7);
    expect(isCompiledLevelShape(ragged, bounds)).toBe(false);

    const mismatched = ConfigRegistry.compileBlueprint(roomBlueprint(10, 10));
    mismatched.items = mismatched.items.slice(0, 9);
    expect(isCompiledLevelShape(mismatched, bounds)).toBe(false);

    const outside = ConfigRegistry.compileBlueprint(roomBlueprint(10, 10));
    outside.playerStart = { x: 10, y: 1, dir: 'S' };
    expect(isCompiledLevelShape(outside, bounds)).toBe(false);

    const empty = ConfigRegistry.compileBlueprint(roomBlueprint(10, 10));
    empty.terrain = [];
    expect(isCompiledLevelShape(empty, bounds)).toBe(false);
  });
});

/** Tiles added with the drop, barrier, thief, turtle, thin wall, teleport, flame and bonus mechanics. */
const MECHANIC_TILE_IDS = [
  'thin_wall_ne',
  'thin_wall_nw',
  'thin_wall_sw',
  'thin_wall_ns',
  'thin_wall_ew',
  'thin_wall_nes',
  'thin_wall_new',
  'thin_wall_nsw',
  'thin_wall_esw',
  'thin_wall_nesw',
  'turtle',
  'thief_keys',
  'forbid_key_red',
  'forbid_key_blue',
  'forbid_key_yellow',
  'forbid_key_green',
  'forbid_boots_ice',
  'forbid_boots_water',
  'forbid_boots_fire',
  'forbid_boots_force',
  'score_10',
  'score_100',
  'score_1000',
  'score_2x',
  'stopwatch_bonus',
  'stopwatch_penalty',
  'button_orange',
  'flame_jet_off',
  'flame_jet_on',
  'teleport_red',
  'teleport_blue',
  'teleport_yellow',
  'teleport_green'
];

describe('tiles.json mechanics', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('resolves every mechanic tile to its own definition', () => {
    for (const id of MECHANIC_TILE_IDS) {
      const tile = ConfigRegistry.getTile(id);
      expect(tile.id, id).toBe(id);
      expect(tile.i18nKey, id).toBe(`tiles.${id}.name`);
      expect(ConfigRegistry.getTiles().categories.some((c) => c.id === tile.category), id).toBe(true);
    }
  });

  it('points every tile reference at an existing tile', () => {
    const tiles = ConfigRegistry.getTiles().tiles;
    const references: Array<keyof (typeof tiles)[string]> = [
      'transformsToOnStep',
      'revealsToOnTouch',
      'transformsToOnUnlock',
      'transformsToOnLeave',
      'blockTransformsTo',
      'protectedByItem',
      'forbiddenItem',
      'requiredKey',
      'togglesTo',
      'flameTogglesTo'
    ];
    for (const tile of Object.values(tiles)) {
      for (const field of references) {
        const target = tile[field];
        if (typeof target === 'string') {
          expect(tiles[target], `${tile.id}.${field}`).toBeDefined();
        }
      }
    }
  });

  it('gives every thin panel a distinct set of blocked edges', () => {
    const seen = new Set<string>();
    for (const tile of Object.values(ConfigRegistry.getTiles().tiles)) {
      if (!tile.id.startsWith('thin_wall_')) continue;
      const edges = [...(tile.blockedEdges ?? [])].sort().join('');
      expect(edges.length, tile.id).toBeGreaterThan(0);
      expect(seen.has(edges), tile.id).toBe(false);
      seen.add(edges);
    }
    expect(seen.size).toBe(15);
  });

  it('groups the colour teleporters apart from the plain one', () => {
    const groups = new Set<string | undefined>();
    for (const tile of Object.values(ConfigRegistry.getTiles().tiles)) {
      if (tile.isTeleporter) groups.add(tile.teleportGroup);
    }
    expect(groups.has(undefined)).toBe(true);
    expect(groups.size).toBe(5);
  });
});

describe('assertConfigShape', () => {
  it('reports the missing keys', () => {
    expect(() => assertConfigShape('game.json', { grid: {} }, ['grid', 'timing'])).toThrow(
      ConfigLoadError
    );
  });

  it('rejects a non-object payload', () => {
    expect(() => assertConfigShape('game.json', [], ['grid'])).toThrow(ConfigLoadError);
  });
});

describe('findBlockPuzzleConfigErrors', () => {
  it('accepts positive integer budgets', () => {
    expect(findBlockPuzzleConfigErrors({ watchSearchBudget: 10, hintSearchBudget: 20 })).toEqual([]);
  });

  it('names each budget that is missing, fractional or not positive', () => {
    expect(findBlockPuzzleConfigErrors({ watchSearchBudget: 0, hintSearchBudget: 1.5 })).toHaveLength(2);
    expect(findBlockPuzzleConfigErrors({ watchSearchBudget: 10 })).toHaveLength(1);
    expect(findBlockPuzzleConfigErrors(undefined)).toHaveLength(1);
  });
});
