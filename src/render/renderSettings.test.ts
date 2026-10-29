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

import { describe, expect, it } from 'vitest';
import { GraphicsConfig, ThemePalette } from '../core/types';
import { createTestBundle } from '../test/loadTestConfigs';
import {
  AUTO_QUALITY_ID,
  DEFAULT_FRAME_BUDGET,
  parseQuality,
  DEFAULT_RENDER_SETTINGS,
  findGraphicsConfigErrors,
  resolveFrameBudget,
  resolveQualitySettings,
  resolveRenderSettings,
  resolveTheme
} from './renderSettings';

const BASE_GRAPHICS: GraphicsConfig = {
  defaultStyle: 'modern',
  entityLerpFactor: 0.5,
  cameraLerpFactor: 0.22,
  teleportSnapDistance: 1.8,
  maxParticles: 10,
  particleBurstCount: 4
};

function theme(id: string): ThemePalette {
  return {
    id,
    i18nKey: id,
    floorTop: id,
    floorBottom: id,
    floorGrid: id,
    wallTop: id,
    wallBottom: id,
    wallBevel: id,
    accentGlow: id
  };
}

describe('resolveRenderSettings', () => {
  it('returns the defaults without a graphics block', () => {
    expect(resolveRenderSettings(undefined)).toBe(DEFAULT_RENDER_SETTINGS);
  });

  it('overrides defaults key by key, glow radii included, and memoizes', () => {
    const graphics = { ...BASE_GRAPHICS, glowBlurPx: { strong: 20 } } as GraphicsConfig;
    const settings = resolveRenderSettings(graphics);
    expect(settings.entityLerpFactor).toBe(0.5);
    expect(settings.maxFrameDeltaMs).toBe(DEFAULT_RENDER_SETTINGS.maxFrameDeltaMs);
    expect(settings.glowBlurPx).toEqual({ ...DEFAULT_RENDER_SETTINGS.glowBlurPx, strong: 20 });
    expect(resolveRenderSettings(graphics)).toBe(settings);
  });

  it('ignores values of the wrong type', () => {
    const graphics = { ...BASE_GRAPHICS, maxFrameDeltaMs: 'fast' } as unknown as GraphicsConfig;
    expect(resolveRenderSettings(graphics).maxFrameDeltaMs).toBe(DEFAULT_RENDER_SETTINGS.maxFrameDeltaMs);
  });

  it('accepts only arrays of strings for tile lists', () => {
    const good = { ...BASE_GRAPHICS, wallJoinTiles: ['wall', 'steel'] } as unknown as GraphicsConfig;
    expect(resolveRenderSettings(good).wallJoinTiles).toEqual(['wall', 'steel']);
    const bad = { ...BASE_GRAPHICS, wallJoinTiles: { wall: true } } as unknown as GraphicsConfig;
    expect(resolveRenderSettings(bad).wallJoinTiles).toEqual(DEFAULT_RENDER_SETTINGS.wallJoinTiles);
  });

  it('accepts only well-formed light source tables', () => {
    const good = {
      ...BASE_GRAPHICS,
      lightSources: { exit: { radiusTile: 2, colorKey: 'green' } }
    } as unknown as GraphicsConfig;
    expect(resolveRenderSettings(good).lightSources).toEqual({ exit: { radiusTile: 2, colorKey: 'green' } });
    const bad = { ...BASE_GRAPHICS, lightSources: { exit: { radiusTile: '2' } } } as unknown as GraphicsConfig;
    expect(resolveRenderSettings(bad).lightSources).toEqual(DEFAULT_RENDER_SETTINGS.lightSources);
  });

  it('tints every shipped light source with a palette colour', () => {
    const game = createTestBundle().game;
    const sources = resolveRenderSettings(game.graphics).lightSources;
    const missing = Object.entries(sources).filter(([, source]) => !(source.colorKey in game.palette));
    expect(missing).toEqual([]);
  });

  it('finds every renderer setting in the shipped game.json', () => {
    const shipped = createTestBundle().game.graphics as unknown as Record<string, unknown>;
    for (const key of Object.keys(DEFAULT_RENDER_SETTINGS)) {
      expect(shipped, key).toHaveProperty(key);
    }
  });
});

describe('resolveQualitySettings', () => {
  it('keeps the settings as they are in high quality', () => {
    const graphics = { ...BASE_GRAPHICS } as GraphicsConfig;
    expect(resolveQualitySettings(graphics, 'high')).toBe(resolveRenderSettings(graphics));
  });

  it('applies the preset of game.json, falling back to the built-in one', () => {
    const custom = {
      ...BASE_GRAPHICS,
      qualityPresets: { low: { vignetteAlpha: 0.1 } }
    } as unknown as GraphicsConfig;
    expect(resolveQualitySettings(custom, 'low').vignetteAlpha).toBe(0.1);
    expect(resolveQualitySettings(custom, 'low').lightingEnabled).toBe(true);
    const plain = { ...BASE_GRAPHICS } as GraphicsConfig;
    expect(resolveQualitySettings(plain, 'low').lightingEnabled).toBe(false);
  });

  it('ignores preset values of the wrong type and keys that are not plain settings', () => {
    const graphics = {
      ...BASE_GRAPHICS,
      qualityPresets: { medium: { maxParticles: 'few', lightSources: {}, wallJoinTiles: [] } }
    } as unknown as GraphicsConfig;
    const settings = resolveQualitySettings(graphics, 'medium');
    expect(settings.maxParticles).toBe(resolveRenderSettings(graphics).maxParticles);
    expect(settings.lightSources).toBe(resolveRenderSettings(graphics).lightSources);
    expect(settings.wallJoinTiles).toBe(resolveRenderSettings(graphics).wallJoinTiles);
  });

  it('memoizes per quality', () => {
    const graphics = { ...BASE_GRAPHICS } as GraphicsConfig;
    expect(resolveQualitySettings(graphics, 'low')).toBe(resolveQualitySettings(graphics, 'low'));
  });
});

describe('parseQuality', () => {
  it('keeps known levels and falls back to automatic for anything else', () => {
    expect(parseQuality('medium')).toBe('medium');
    expect(parseQuality(AUTO_QUALITY_ID)).toBe(AUTO_QUALITY_ID);
    expect(parseQuality('ultra')).toBe(AUTO_QUALITY_ID);
    expect(parseQuality(undefined)).toBe(AUTO_QUALITY_ID);
  });
});

describe('resolveFrameBudget', () => {
  it('reads the budget from game.json, with defaults', () => {
    expect(resolveFrameBudget(undefined)).toEqual(DEFAULT_FRAME_BUDGET);
    const graphics = { ...BASE_GRAPHICS, frameBudgetMs: 20 } as unknown as GraphicsConfig;
    expect(resolveFrameBudget(graphics)).toEqual({ ...DEFAULT_FRAME_BUDGET, frameBudgetMs: 20 });
  });
});

describe('findGraphicsConfigErrors', () => {
  it('accepts the shipped configuration', () => {
    const bundle = createTestBundle();
    const tileIds = new Set(Object.keys(bundle.tiles.tiles));
    expect(findGraphicsConfigErrors(bundle.game.graphics, bundle.game.palette, tileIds)).toEqual([]);
  });

  it('reports dangling references', () => {
    const graphics = {
      ...BASE_GRAPHICS,
      lightSources: { exit: { radiusTile: 1, colorKey: 'nope' } },
      wallJoinTiles: ['wall', 'granite'],
      qualityPresets: { ultra: {}, low: { sparkle: 1 } }
    } as unknown as GraphicsConfig;
    const errors = findGraphicsConfigErrors(graphics, { green: '#0f0' }, new Set(['wall']));
    expect(errors).toEqual([
      'lightSources.exit: unknown palette key nope',
      'wallJoinTiles: unknown tile granite',
      'qualityPresets.ultra: unknown quality',
      'qualityPresets.low.sparkle: unknown setting'
    ]);
  });
});

describe('resolveTheme', () => {
  const themes = { a: theme('a'), b: theme('b') };

  it('prefers the requested theme, then the default, then the first one', () => {
    expect(resolveTheme(themes, 'b', 'a')?.id).toBe('b');
    expect(resolveTheme(themes, 'missing', 'b')?.id).toBe('b');
    expect(resolveTheme(themes, 'missing', 'missing')?.id).toBe('a');
    expect(resolveTheme(themes, 'missing', undefined)?.id).toBe('a');
  });

  it('returns undefined without themes', () => {
    expect(resolveTheme(undefined, 'a', 'a')).toBeUndefined();
  });
});
