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
/** One kind of light source: its reach and the palette key of its tint. */
export interface LightSourceSettings {
  radiusTile: number;
  colorKey: string;
}

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
  /** Tiles that join with each other into one continuous wall mass. */
  wallJoinTiles: string[];
  /** Tiles that cast a shadow onto the cells south and east of them. */
  shadowCasterTiles: string[];
  /** Height of the front face shown under a wall that has open floor south of it. */
  wallFrontDepthTile: number;
  /** Width of the lit rim along the edges of a wall mass. */
  wallRimWidthTile: number;
  /** Corner rounding of a wall mass, applied only to its outer corners. */
  wallCornerRadiusTile: number;
  /** Inset of the panel engraved in cells deep inside a wall mass. */
  wallPanelInsetTile: number;
  /** Depth of the shadow a caster throws onto the floor next to it. */
  floorShadowDepthTile: number;
  /** One floor cell in this many shows a detail (seam, vent, scuff). */
  floorDetailEvery: number;
  /** Height of the small hop the player makes on each step. */
  playerHopTile: number;
  /** Modern style only: darkens the scene except around light sources. */
  lightingEnabled: boolean;
  /** Opacity of the darkness away from any light. */
  lightingAmbientAlpha: number;
  /** Opacity of the coloured glow added around each light. */
  lightingTintAlpha: number;
  /** The darkness is drawn at 1/N of the canvas resolution, then scaled up smoothly. */
  lightingResolutionDivisor: number;
  /** Relative radius change of flickering lights (fire, fireballs). */
  lightingFlicker: number;
  /** Light sources by id: 'player', a tile id, an item id or a monster type. */
  lightSources: Record<string, LightSourceSettings>;
  /** Opacity of the darkened corners of the view, 0 to disable. */
  vignetteAlpha: number;
  /** Fraction of the view radius left clear by the vignette. */
  vignetteInnerRatio: number;
  /** Opacity of the LCD pixel grid drawn over the 16-Bit Retro view when enabled. */
  lcdGridAlpha: number;
  /** Duration of the iris that opens on the player when a level starts, in reference frames. */
  irisOpenFrames: number;
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
  iconPixelSize: 32,
  wallJoinTiles: ['wall'],
  shadowCasterTiles: ['wall'],
  wallFrontDepthTile: 0.22,
  wallRimWidthTile: 0.05,
  wallCornerRadiusTile: 0.14,
  wallPanelInsetTile: 0.18,
  floorShadowDepthTile: 0.34,
  floorDetailEvery: 5,
  playerHopTile: 0.07,
  lightingEnabled: true,
  lightingAmbientAlpha: 0.4,
  lightingTintAlpha: 0.22,
  lightingResolutionDivisor: 4,
  lightingFlicker: 0.06,
  lightSources: {
    player: { radiusTile: 3.4, colorKey: 'modernPlayerVisor' }
  },
  vignetteAlpha: 0.45,
  vignetteInnerRatio: 0.55,
  lcdGridAlpha: 0.18,
  irisOpenFrames: 24
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
    const fallback = DEFAULT_RENDER_SETTINGS[key];
    const accepted = Array.isArray(fallback)
      ? isStringArray(value)
      : typeof fallback === 'object'
        ? isLightSourceTable(value)
        : typeof value === typeof fallback;
    if (accepted) {
      (resolved as unknown as Record<string, unknown>)[key] = value;
    }
  }
  resolved.glowBlurPx = { ...DEFAULT_RENDER_SETTINGS.glowBlurPx, ...source.glowBlurPx };
  resolvedCache.set(graphics, resolved);
  return resolved;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isLightSourceTable(value: unknown): value is Record<string, LightSourceSettings> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value).every(
    (source: unknown) =>
      !!source &&
      typeof (source as LightSourceSettings).radiusTile === 'number' &&
      typeof (source as LightSourceSettings).colorKey === 'string'
  );
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
