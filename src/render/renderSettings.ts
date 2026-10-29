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

import { GraphicsConfig, ThemePalette } from '../core/types';

/** Shadow blur radii, in pixels, baked into glowing sprites and the terrain cache. */
export interface GlowBlurSettings {
  soft: number;
  medium: number;
  strong: number;
}

/**
 * Every tuning value the renderer reads from the `graphics` block of game.json.
 * Per-frame values (lerps, decays, speeds) are expressed per reference frame,
 * see REFERENCE_FRAME_MS; sizes suffixed `Tile` are fractions of a tile.
 */
export interface RenderSettings {
  entityLerpFactor: number;
  cameraLerpFactor: number;
  teleportSnapDistance: number;
  zoomSnapEpsilonTiles: number;
  maxFrameDeltaMs: number;
  maxParticles: number;
  particleBurstCount: number;
  particleAngleJitter: number;
  particleSpeedMin: number;
  particleSpeedRange: number;
  particleDecayMin: number;
  particleDecayRange: number;
  particleRadiusMinTile: number;
  particleRadiusRangeTile: number;
  particleSparkleEvery: number;
  shockwaveStartRadius: number;
  shockwaveMaxRadius: number;
  shockwaveWinMaxRadius: number;
  shockwaveGrowthPerFrame: number;
  shockwaveFadePerFrame: number;
  shockwaveLineWidthTile: number;
  screenShakeExplosion: number;
  screenShakeDecay: number;
  screenShakeMinIntensity: number;
  pathLineWidthTile: number;
  pathAlpha: number;
  terrainCacheMarginTiles: number;
  terrainCacheMaxPx: number;
  spriteCacheMaxEntries: number;
  glowBlurPx: GlowBlurSettings;
  hintFontModern: string;
  hintFontRetro: string;
  iconPixelSize: number;
}

/** The graphics block as stored in game.json, including keys GraphicsConfig does not declare. */
export type GraphicsConfigSource = GraphicsConfig & Partial<Omit<RenderSettings, 'glowBlurPx'>> & {
  glowBlurPx?: Partial<GlowBlurSettings>;
};

/** Single fallback table, used only when game.json omits the graphics block or one of its keys. */
export const DEFAULT_RENDER_SETTINGS: Readonly<RenderSettings> = {
  entityLerpFactor: 0.32,
  cameraLerpFactor: 0.22,
  teleportSnapDistance: 1.8,
  zoomSnapEpsilonTiles: 0.04,
  maxFrameDeltaMs: 100,
  maxParticles: 200,
  particleBurstCount: 18,
  particleAngleJitter: 0.4,
  particleSpeedMin: 0.03,
  particleSpeedRange: 0.09,
  particleDecayMin: 0.025,
  particleDecayRange: 0.02,
  particleRadiusMinTile: 0.04,
  particleRadiusRangeTile: 0.06,
  particleSparkleEvery: 3,
  shockwaveStartRadius: 0.1,
  shockwaveMaxRadius: 1.1,
  shockwaveWinMaxRadius: 1.8,
  shockwaveGrowthPerFrame: 0.06,
  shockwaveFadePerFrame: 0.045,
  shockwaveLineWidthTile: 0.06,
  screenShakeExplosion: 9,
  screenShakeDecay: 0.85,
  screenShakeMinIntensity: 0.25,
  pathLineWidthTile: 0.05,
  pathAlpha: 0.65,
  terrainCacheMarginTiles: 2,
  terrainCacheMaxPx: 4096,
  spriteCacheMaxEntries: 256,
  glowBlurPx: { soft: 6, medium: 8, strong: 10 },
  hintFontModern: 'system-ui, sans-serif',
  hintFontRetro: 'monospace',
  iconPixelSize: 32
};

const resolvedCache = new WeakMap<object, RenderSettings>();

/** Merges the graphics block over the defaults; the result is memoized per config object. */
export function resolveRenderSettings(graphics: GraphicsConfig | undefined): RenderSettings {
  if (!graphics) return DEFAULT_RENDER_SETTINGS;
  const cached = resolvedCache.get(graphics);
  if (cached) return cached;
  const source = graphics as GraphicsConfigSource;
  const resolved: RenderSettings = { ...DEFAULT_RENDER_SETTINGS };
  for (const key of Object.keys(DEFAULT_RENDER_SETTINGS) as (keyof RenderSettings)[]) {
    if (key === 'glowBlurPx') continue;
    const value = source[key];
    if (typeof value === typeof DEFAULT_RENDER_SETTINGS[key]) {
      (resolved as unknown as Record<string, unknown>)[key] = value;
    }
  }
  resolved.glowBlurPx = { ...DEFAULT_RENDER_SETTINGS.glowBlurPx, ...source.glowBlurPx };
  resolvedCache.set(graphics, resolved);
  return resolved;
}

/**
 * Picks the active theme, falling back to the configured default theme and then to
 * the first theme declared. Returns undefined only when game.json has no themes.
 */
export function resolveTheme(
  themes: Record<string, ThemePalette> | undefined,
  themeId: string,
  defaultThemeId: string | undefined
): ThemePalette | undefined {
  if (!themes) return undefined;
  return themes[themeId] ?? (defaultThemeId ? themes[defaultThemeId] : undefined) ?? Object.values(themes)[0];
}
