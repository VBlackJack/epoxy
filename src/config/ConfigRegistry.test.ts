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
import { ConfigBundle, ConfigRegistry } from './ConfigRegistry';
import {
  assertConfigShape,
  ConfigLoadError,
  findAudioConfigErrors,
  findBlockPuzzleConfigErrors,
  InvalidLevelError,
  isCompiledLevelShape
} from './ConfigValidation';
import { DEFAULT_LEVEL_PASSWORD } from './constants';
import { LevelBlueprint, MusicTrackConfig } from '../core/types';
import { createTestBundle, loadTestConfigs } from '../test/loadTestConfigs';

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
    const { minLevelSize, maxLevelSize } = ConfigRegistry.getGame().grid;
    for (const level of campaign) {
      expect(level.terrain.length, level.id).toBeGreaterThanOrEqual(minLevelSize);
      expect(level.terrain.length, level.id).toBeLessThanOrEqual(maxLevelSize);
      expect(level.terrain[0].length, level.id).toBeGreaterThanOrEqual(minLevelSize);
      expect(level.terrain[0].length, level.id).toBeLessThanOrEqual(maxLevelSize);
      expect(level.terrain.every((row) => row.length === level.terrain[0].length), level.id).toBe(true);
    }
  });

  it('gives every campaign level its own id, number and password, numbered 1 to N', () => {
    const campaign = ConfigRegistry.getLevels();
    expect(new Set(campaign.map((l) => l.id)).size).toBe(campaign.length);
    expect(new Set(campaign.map((l) => l.password)).size).toBe(campaign.length);
    expect(campaign.map((l) => l.number)).toEqual(campaign.map((_, index) => index + 1));
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

  it('copies a non-empty author trimmed and drops an empty or blank one', () => {
    expect(ConfigRegistry.compileBlueprint(blueprint({ author: '  Ann  ' })).author).toBe('Ann');
    for (const author of ['', '   ']) {
      expect('author' in ConfigRegistry.compileBlueprint(blueprint({ author }))).toBe(false);
    }
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
    expect(findBlockPuzzleConfigErrors({ watchSearchBudget: 10, hintSearchBudget: 20, watchMaxCells: 30 })).toEqual([]);
  });

  it('names each budget that is missing, fractional or not positive', () => {
    expect(findBlockPuzzleConfigErrors({ watchSearchBudget: 0, hintSearchBudget: 1.5, watchMaxCells: 3 })).toHaveLength(2);
    expect(findBlockPuzzleConfigErrors({ watchSearchBudget: 10, hintSearchBudget: 20 })).toHaveLength(1);
    expect(findBlockPuzzleConfigErrors(undefined)).toHaveLength(1);
  });
});

describe('game tunables validation', () => {
  it('accepts the shipped endless dialog cap', () => {
    expect(() => ConfigRegistry.applyConfigs(createTestBundle())).not.toThrow();
  });

  it('refuses a missing, zero, fractional or negative start level cap', () => {
    for (const bad of [undefined, 0, -5, 2.5, '10']) {
      const bundle = createTestBundle();
      (bundle.game.endlessUi as unknown as Record<string, unknown>).maxStartLevel = bad;
      expect(() => ConfigRegistry.applyConfigs(bundle), String(bad)).toThrow(ConfigLoadError);
    }
  });

  it('refuses a missing, negative or fractional fallback candidate count', () => {
    for (const bad of [undefined, -1, 1.5, '2']) {
      const bundle = createTestBundle();
      (bundle.game.procedural!.scoring as unknown as Record<string, unknown>).fallbackCandidates = bad;
      expect(() => ConfigRegistry.applyConfigs(bundle), String(bad)).toThrow(ConfigLoadError);
    }
    const off = createTestBundle();
    off.game.procedural!.scoring.fallbackCandidates = 0;
    expect(() => ConfigRegistry.applyConfigs(off)).not.toThrow();
  });
});

describe('audio configuration validation', () => {
  const fileTrack = { id: 'orchestral', i18nKey: 'app.music.orchestral.label', source: 'file', files: ['orchestral.ogg'] };

  function bundleWith(mutate: (bundle: ConfigBundle) => void): ConfigBundle {
    const bundle = createTestBundle();
    mutate(bundle);
    return bundle;
  }

  it('accepts the shipped audio.json and a declared file track mapped to a biome', () => {
    expect(() => ConfigRegistry.applyConfigs(createTestBundle())).not.toThrow();
    const withFile = bundleWith((b) => {
      b.audio.tracks!.push(fileTrack as unknown as MusicTrackConfig);
      b.game.themes!.cyber_neon.musicTrackId = 'orchestral';
    });
    expect(() => ConfigRegistry.applyConfigs(withFile)).not.toThrow();
  });

  it('refuses a missing default track and a default track that is a file track', () => {
    const missing = bundleWith((b) => {
      b.audio.defaultTrackId = 'nope';
    });
    expect(() => ConfigRegistry.applyConfigs(missing)).toThrow(ConfigLoadError);
    const fileDefault = bundleWith((b) => {
      b.audio.tracks!.push(fileTrack as unknown as MusicTrackConfig);
      b.audio.defaultTrackId = 'orchestral';
    });
    expect(() => ConfigRegistry.applyConfigs(fileDefault)).toThrow(ConfigLoadError);
  });

  it('refuses a theme that points to an unknown track', () => {
    const bad = bundleWith((b) => {
      b.game.themes!.arctic_lab.musicTrackId = 'nope';
    });
    expect(() => ConfigRegistry.applyConfigs(bad)).toThrow(ConfigLoadError);
  });

  it('refuses a file track without files, with empty names, or a duplicate track id', () => {
    for (const files of [undefined, [], ['']]) {
      const bad = bundleWith((b) => {
        b.audio.tracks!.push({ ...fileTrack, files } as unknown as MusicTrackConfig);
      });
      expect(() => ConfigRegistry.applyConfigs(bad), JSON.stringify(files)).toThrow(ConfigLoadError);
    }
    const duplicate = bundleWith((b) => {
      b.audio.tracks!.push({ ...fileTrack, id: b.audio.tracks![0].id } as unknown as MusicTrackConfig);
    });
    expect(() => ConfigRegistry.applyConfigs(duplicate)).toThrow(ConfigLoadError);
  });

  it('refuses a file track gain or a file fade-in that is negative or not a number', () => {
    for (const gain of [-0.1, '1', null, Number.NaN]) {
      const bad = bundleWith((b) => {
        b.audio.tracks!.push({ ...fileTrack, gain } as unknown as MusicTrackConfig);
      });
      expect(() => ConfigRegistry.applyConfigs(bad), String(gain)).toThrow(ConfigLoadError);
    }
    const zero = bundleWith((b) => {
      b.audio.tracks!.push({ ...fileTrack, gain: 0 } as unknown as MusicTrackConfig);
    });
    expect(() => ConfigRegistry.applyConfigs(zero)).not.toThrow();
    for (const fade of [-1, '400', Number.NaN]) {
      const bad = bundleWith((b) => {
        (b.audio.musicMix as Record<string, unknown>).fileFadeInMs = fade;
      });
      expect(() => ConfigRegistry.applyConfigs(bad), String(fade)).toThrow(ConfigLoadError);
    }
    const noFade = bundleWith((b) => {
      b.audio.musicMix!.fileFadeInMs = 0;
    });
    expect(() => ConfigRegistry.applyConfigs(noFade)).not.toThrow();
  });

  it('refuses an unknown default music mode', () => {
    const bad = bundleWith((b) => {
      b.audio.defaultMusicMode = 'shuffle';
    });
    expect(() => ConfigRegistry.applyConfigs(bad)).toThrow(ConfigLoadError);
    expect(findAudioConfigErrors({ ...createTestBundle().audio, defaultMusicMode: 'random' }, undefined)).toEqual([]);
  });

  it('checks the endless music tracks against the declared tracks', () => {
    const audio = createTestBundle().audio;
    const known = audio.tracks?.[0].id as string;
    expect(findAudioConfigErrors(audio, undefined, [known])).toEqual([]);
    expect(findAudioConfigErrors(audio, undefined, undefined)).toEqual([]);
    expect(findAudioConfigErrors(audio, undefined, ['nope'])).toHaveLength(1);
    expect(findAudioConfigErrors(audio, undefined, [known, 7])).toHaveLength(1);
    const bad = bundleWith((b) => {
      b.game.endlessUi.musicTrackIds = ['nope'];
    });
    expect(() => ConfigRegistry.applyConfigs(bad)).toThrow(ConfigLoadError);
  });

  it('rejects malformed sampled-effect fields and accepts the shipped ones', () => {
    const base = createTestBundle().audio;
    const errorsFor = (patch: Record<string, unknown>): string[] =>
      findAudioConfigErrors(
        { ...base, effects: { ...base.effects, probe: { waveform: 'square', notes: [], ...patch } } },
        undefined
      );
    expect(errorsFor({ files: [] })).toHaveLength(1);
    expect(errorsFor({ files: [''] })).toHaveLength(1);
    expect(errorsFor({ files: 'a.wav' })).toHaveLength(1);
    expect(errorsFor({ maxDurationMs: 0 })).toHaveLength(1);
    expect(errorsFor({ maxDurationMs: Number.NaN })).toHaveLength(1);
    expect(errorsFor({ fadeOutMs: -1, maxDurationMs: 100 })).toHaveLength(1);
    expect(errorsFor({ fadeOutMs: 50 })).toHaveLength(1);
    expect(errorsFor({ fadeOutMs: 200, maxDurationMs: 100 })).toHaveLength(1);
    expect(errorsFor({ gain: -0.1 })).toHaveLength(1);
    expect(errorsFor({ gain: Number.POSITIVE_INFINITY })).toHaveLength(1);
    expect(errorsFor({ minIntervalMs: -1 })).toHaveLength(1);
    expect(errorsFor({ minIntervalMs: Number.NaN })).toHaveLength(1);
    expect(errorsFor({ minIntervalMs: '250' })).toHaveLength(1);
    expect(errorsFor({ minIntervalMs: 0 })).toEqual([]);
    expect(errorsFor({ minIntervalMs: 250 })).toEqual([]);
    expect(errorsFor({ files: ['a.wav'], maxDurationMs: 100, fadeOutMs: 100, gain: 0.4 })).toEqual([]);
    expect(findAudioConfigErrors(base, undefined)).toEqual([]);
  });

  it('requires every terrain step effect to be an existing effect', () => {
    const base = createTestBundle().audio;
    const withMap = (terrainStepEffects: Record<string, unknown>) =>
      findAudioConfigErrors({ ...base, terrainStepEffects } as typeof base, undefined);
    expect(withMap({ ice: 'step' })).toEqual([]);
    expect(withMap({ ice: 'nope' })).toHaveLength(1);
    expect(withMap({ ice: 'toString' })).toHaveLength(1);
    expect(withMap({ ice: 3 })).toHaveLength(1);
    expect(findAudioConfigErrors({ ...base, terrainStepEffects: undefined }, undefined)).toEqual([]);
  });
});
