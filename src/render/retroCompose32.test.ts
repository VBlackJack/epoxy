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

/**
 * Composition of the 32-Bit Retro tiles: the same layer stacks as the 16-Bit style, drawn with a
 * 32-px spec and the derived 32-bit sprites. Checks the output size, the 15-bit colour rule and
 * that glyphs and flag text stay inside the tile.
 */

import { describe, expect, it } from 'vitest';

import { createTestBundle } from '../test/loadTestConfigs';
import {
  applyRetroShadow,
  composeRetroLayers,
  retroItemLayers,
  retroLabelLayers,
  retroLayersKey,
  retroShadowExtent,
  retroShadowSignature,
  retroTileLayers,
  retroWallLayers,
  RetroLayer,
  RetroTileInput
} from './retroCompose';
import { createRetro32SpriteCache, isFifteenBitColour } from './retro32';
import { RETRO32_SPEC, createRetro32ThemeSprites } from './retro32/spriteStyle32';
import { NEIGHBOUR } from './tileNeighbours';
import {
  RETRO16_SPEC,
  RETRO_CHAR_WIDTH,
  RETRO_FLAG_TEXT,
  RETRO_GLYPH_SIZE,
  RETRO_SHEET,
  RETRO_SPRITE_SIZE,
  findRetro32PaletteErrors,
  resolveRetroRamps
} from './retroSprites';

const BYTES_PER_PIXEL = 4;
const ALPHA_OFFSET = 3;
const CACHE_ENTRIES = 4096;
const SIGNATURE_COUNT = 8;
const WALL_MASK_COUNT = 16;
const PHASES = [0, 1, 2, 3];
const FLOOR_HASHES = [1, 0];
const FLOOR_DETAIL_EVERY = 5;
const SHADOW_DEPTH_TILE = 0.34;
const TILE_SIZE_32 = 32;
const LABELS = ['10', '100', '1K', '2K', 'x2', 'x3', '500', '+5', '-5'];
const KEY_ITEM = 'key_red';
const GLYPH_PREFIX = 'glyph_';
const DEFAULT_THEME = 'default';

const bundle = createTestBundle();
const tiles = bundle.tiles.tiles;
const palettes = bundle.game.retroPalettes;
const themeIds = Object.keys(palettes ?? {});
const resolveTile = (id: string) => tiles[id] ?? tiles.floor;

function tileInput(tileId: string, over: Partial<RetroTileInput>): RetroTileInput {
  return {
    tileId,
    def: resolveTile(tileId),
    resolve: resolveTile,
    pass: 'all',
    hash: 1,
    wallMask: 0,
    floorDetailEvery: FLOOR_DETAIL_EVERY,
    isEditor: false,
    revealHiddenWalls: false,
    isClosedTrap: true,
    phase: 0,
    reducedMotion: false,
    ...over
  };
}

/** Distinct layer stacks a tile can produce, keyed by their cache key. */
function tileStacks(tileId: string): Map<string, RetroLayer[]> {
  const stacks = new Map<string, RetroLayer[]>();
  const masks = tileId === 'wall' ? Array.from({ length: WALL_MASK_COUNT }, (_, i) => i) : [0];
  for (const wallMask of masks) {
    for (const hash of FLOOR_HASHES) {
      for (const isEditor of [false, true]) {
        for (const phase of PHASES) {
          const layers = retroTileLayers(tileInput(tileId, { wallMask, hash, isEditor, phase }));
          stacks.set(retroLayersKey(layers), layers);
        }
      }
    }
  }
  return stacks;
}

function themeSprites(themeId: string) {
  const ramps16 = resolveRetroRamps(palettes, themeId);
  return { ramps16, ...createRetro32ThemeSprites(themeId, ramps16, undefined, createRetro32SpriteCache(CACHE_ENTRIES)) };
}

function isOpaque(pixels: Uint8ClampedArray, offset: number): boolean {
  return pixels[offset + ALPHA_OFFSET] !== 0;
}

function allOpaquePixelsAreFifteenBit(pixels: Uint8ClampedArray): boolean {
  for (let o = 0; o < pixels.length; o += BYTES_PER_PIXEL) {
    if (isOpaque(pixels, o) && !isFifteenBitColour(pixels[o], pixels[o + 1], pixels[o + 2])) return false;
  }
  return true;
}

/** Top-left corner of a centred glyph, in the pixels of a style drawn at `layerScale` over the authoring grid. */
function glyphOriginOf(layerScale: number): number {
  return Math.floor((RETRO_SPRITE_SIZE - RETRO_GLYPH_SIZE) / 2) * layerScale;
}

describe('sprite style specs', () => {
  it('derives the 16-Bit layout from the authoring grid', () => {
    expect(RETRO16_SPEC.tileSize).toBe(RETRO_SPRITE_SIZE);
    expect(RETRO16_SPEC.layerScale).toBe(1);
    expect(RETRO16_SPEC.quantiseShadow).toBe(false);
  });

  it('doubles every size and offset for the 32-Bit style', () => {
    expect(RETRO32_SPEC.tileSize).toBe(TILE_SIZE_32);
    expect(RETRO32_SPEC.layerScale).toBe(2);
    expect(RETRO32_SPEC.quantiseShadow).toBe(true);
  });

  it('computes the shadow extent in the pixels of the style', () => {
    expect(retroShadowExtent(SHADOW_DEPTH_TILE)).toEqual({ depth: 5, side: 3 });
    expect(retroShadowExtent(SHADOW_DEPTH_TILE, RETRO16_SPEC)).toEqual({ depth: 5, side: 3 });
    expect(retroShadowExtent(SHADOW_DEPTH_TILE, RETRO32_SPEC)).toEqual({ depth: 11, side: 7 });
  });

  it('keeps the 16-Bit composition identical when the spec is passed explicitly', () => {
    const ramps = resolveRetroRamps(palettes, DEFAULT_THEME);
    const layers = retroWallLayers(0);
    expect(Array.from(composeRetroLayers(layers, ramps, RETRO16_SPEC))).toEqual(Array.from(composeRetroLayers(layers, ramps)));
  });
});

describe('32-Bit composition', () => {
  for (const themeId of themeIds) {
    it(`composes every tile at 32x32 in 15-bit colour (${themeId})`, () => {
      const { ramps16, ramps32, source } = themeSprites(themeId);
      const { depth, side } = retroShadowExtent(SHADOW_DEPTH_TILE, RETRO32_SPEC);
      for (const tileId of Object.keys(tiles)) {
        for (const layers of tileStacks(tileId).values()) {
          const buffer = composeRetroLayers(layers, ramps32, RETRO32_SPEC, source);
          expect(buffer.length).toBe(TILE_SIZE_32 * TILE_SIZE_32 * BYTES_PER_PIXEL);
          expect(allOpaquePixelsAreFifteenBit(buffer)).toBe(true);
          // The shadow stays 15-bit even when it is taken from the 9-bit ramps.
          for (let signature = 1; signature < SIGNATURE_COUNT; signature++) {
            const shaded = composeRetroLayers(layers, ramps32, RETRO32_SPEC, source);
            applyRetroShadow(shaded, TILE_SIZE_32, signature, ramps16, depth, side, RETRO32_SPEC);
            expect(allOpaquePixelsAreFifteenBit(shaded)).toBe(true);
          }
        }
      }
    });
  }

  it('paints the shadow on the north and west of a 32-px tile only', () => {
    const { ramps32, source } = themeSprites(DEFAULT_THEME);
    const { depth, side } = retroShadowExtent(SHADOW_DEPTH_TILE, RETRO32_SPEC);
    const plain = composeRetroLayers([{ name: 'floor' }], ramps32, RETRO32_SPEC, source);
    const shaded = composeRetroLayers([{ name: 'floor' }], ramps32, RETRO32_SPEC, source);
    const signature = retroShadowSignature(NEIGHBOUR.N | NEIGHBOUR.W);
    applyRetroShadow(shaded, TILE_SIZE_32, signature, ramps32, depth, side, RETRO32_SPEC);
    expect(Array.from(shaded)).not.toEqual(Array.from(plain));
    const southEast = (TILE_SIZE_32 * TILE_SIZE_32 - 1) * BYTES_PER_PIXEL;
    expect(Array.from(shaded.slice(southEast, southEast + BYTES_PER_PIXEL))).toEqual(
      Array.from(plain.slice(southEast, southEast + BYTES_PER_PIXEL))
    );
  });

  it('skips a layer the source lacks and keeps the tile size', () => {
    const { ramps32, source } = themeSprites(DEFAULT_THEME);
    const buffer = composeRetroLayers([{ name: 'no_such_sprite' }], ramps32, RETRO32_SPEC, source);
    expect(buffer.length).toBe(TILE_SIZE_32 * TILE_SIZE_32 * BYTES_PER_PIXEL);
    expect(buffer.every((v) => v === 0)).toBe(true);
  });
});

describe('glyph and label layout', () => {
  /** Every layer with an offset that any tile, item or label can produce. */
  function positionedLayers(): RetroLayer[] {
    const layers: RetroLayer[] = [];
    for (const tileId of Object.keys(tiles)) {
      for (const stack of tileStacks(tileId).values()) layers.push(...stack);
      layers.push(...retroItemLayers(tileId, resolveTile(tileId)));
    }
    for (const label of LABELS) layers.push(...retroLabelLayers(label));
    return layers.filter((l) => l.x !== undefined && l.y !== undefined);
  }

  for (const spec of [RETRO16_SPEC, RETRO32_SPEC]) {
    it(`keeps every offset sprite inside a ${spec.tileSize}-px tile`, () => {
      const positioned = positionedLayers();
      expect(positioned.length).toBeGreaterThan(0);
      for (const layer of positioned) {
        const sprite = RETRO_SHEET.sprites[layer.name];
        if (!sprite) continue;
        const x = (layer.x ?? 0) * spec.layerScale;
        const y = (layer.y ?? 0) * spec.layerScale;
        expect(x).toBeGreaterThanOrEqual(0);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(x + sprite.width * spec.layerScale).toBeLessThanOrEqual(spec.tileSize);
        expect(y + sprite.height * spec.layerScale).toBeLessThanOrEqual(spec.tileSize);
      }
    });

    it(`places the glyph at the spec origin (${spec.id})`, () => {
      const glyph = retroItemLayers(KEY_ITEM, resolveTile(KEY_ITEM)).find((l) => l.name.startsWith(GLYPH_PREFIX));
      expect(glyph).toBeDefined();
      expect((glyph?.x ?? 0) * spec.layerScale).toBe(glyphOriginOf(spec.layerScale));
      expect((glyph?.y ?? 0) * spec.layerScale).toBe(glyphOriginOf(spec.layerScale));
    });

    it(`centres the flag text on the spec centre (${spec.id})`, () => {
      for (const label of LABELS) {
        const layers = retroLabelLayers(label);
        const first = layers[0];
        const last = layers[layers.length - 1];
        const left = (first.x ?? 0) * spec.layerScale;
        const right = (last.x ?? 0) * spec.layerScale + RETRO_CHAR_WIDTH * spec.layerScale;
        expect(Math.abs((left + right) / 2 - RETRO_FLAG_TEXT.centerX * spec.layerScale)).toBeLessThanOrEqual(
          spec.layerScale
        );
        expect((first.y ?? 0) * spec.layerScale).toBe(RETRO_FLAG_TEXT.top * spec.layerScale);
      }
    });
  }

  it('draws a 32-Bit glyph only inside its doubled box', () => {
    const { ramps32, source } = themeSprites(DEFAULT_THEME);
    const layers = retroItemLayers(KEY_ITEM, resolveTile(KEY_ITEM)).filter((l) => l.name.startsWith(GLYPH_PREFIX));
    const buffer = composeRetroLayers(layers, ramps32, RETRO32_SPEC, source);
    const low = glyphOriginOf(RETRO32_SPEC.layerScale);
    const high = low + RETRO_GLYPH_SIZE * RETRO32_SPEC.layerScale;
    let opaque = 0;
    for (let y = 0; y < TILE_SIZE_32; y++) {
      for (let x = 0; x < TILE_SIZE_32; x++) {
        if (!isOpaque(buffer, (y * TILE_SIZE_32 + x) * BYTES_PER_PIXEL)) continue;
        opaque++;
        expect(x).toBeGreaterThanOrEqual(low);
        expect(x).toBeLessThan(high);
        expect(y).toBeGreaterThanOrEqual(low);
        expect(y).toBeLessThan(high);
      }
    }
    expect(opaque).toBeGreaterThan(0);
  });
});

describe('findRetro32PaletteErrors', () => {
  const THEMES = ['default', 'cyber_neon'];

  it('accepts no overrides and well formed overrides', () => {
    expect(findRetro32PaletteErrors(undefined, THEMES)).toEqual([]);
    expect(findRetro32PaletteErrors({ cyber_neon: { floor: ['#102030', '#a0b0c0'] } }, THEMES)).toEqual([]);
  });

  it('reports unknown themes and unknown ramps', () => {
    const errors = findRetro32PaletteErrors({ lava: { floor: ['#102030'] }, default: { nope: ['#102030'] } }, THEMES);
    expect(errors).toEqual(['retro32Palettes.lava: unknown theme', 'retro32Palettes.default.nope: unknown ramp']);
  });

  it('reports empty ramps and colours that are not #rrggbb', () => {
    const errors = findRetro32PaletteErrors({ default: { floor: [], wall: ['red'], water: [3] } }, THEMES);
    expect(errors).toEqual([
      'retro32Palettes.default.floor must be a non-empty array',
      'retro32Palettes.default.wall colour red is not #rrggbb',
      'retro32Palettes.default.water colour 3 is not #rrggbb'
    ]);
  });
});
