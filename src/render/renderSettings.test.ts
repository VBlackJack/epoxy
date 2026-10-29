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
import { DEFAULT_RENDER_SETTINGS, resolveRenderSettings, resolveTheme } from './renderSettings';

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

  it('finds every renderer setting in the shipped game.json', () => {
    const shipped = createTestBundle().game.graphics as unknown as Record<string, unknown>;
    for (const key of Object.keys(DEFAULT_RENDER_SETTINGS)) {
      expect(shipped, key).toHaveProperty(key);
    }
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
