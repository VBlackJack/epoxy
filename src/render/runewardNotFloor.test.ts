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
 * Through the real renderer in both Runeward styles, the tiles that block someone or carry a glyph
 * must never be drawn like plain floor at the same cell: the socket stops the player, gravel and dirt
 * stop monsters, the hint tile carries a glyph. Only the hidden walls may match the floor.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../audio/AudioManager', () => ({
  AudioManager: { playSfx: vi.fn() }
}));

import type { GraphicsStyle } from '../core/types';
import { ConfigRegistry } from '../config/ConfigRegistry';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { createRecordedContext } from '../test/runewardTestContext';
import { PixelRenderer } from './PixelRenderer';
import { NEIGHBOUR, type TileNeighbours } from './tileNeighbours';

const STYLE_IDS: readonly GraphicsStyle[] = ['runeward', 'runeward_parchment'];
const TILE_SIZE = 48;
const ORIGIN = 0;
const SHADOW_MASKS: readonly number[] = [0, NEIGHBOUR.N];
const CELLS: readonly (readonly [number, number])[] = [[0, 0], [5, 4], [17, 9]];
const DIFFERENT_FROM_FLOOR: readonly string[] = ['socket', 'gravel', 'dirt', 'hint'];
const SAME_AS_FLOOR: readonly string[] = ['invisible_wall', 'appearing_wall'];

/** Seal base colour of the art block a style draws with: only the Runeward seal painter fills with it. */
function sealBase(style: GraphicsStyle): string {
  const game = ConfigRegistry.getGame();
  const art = style === 'runeward_parchment' ? game.runewardArtVariants?.parchment : game.runewardArt;
  return art!.seal.base;
}

function logOf(style: GraphicsStyle, tileId: string, neighbours: TileNeighbours): string[] {
  const renderer = new PixelRenderer();
  renderer.setStyle(style);
  const { ctx, lines } = createRecordedContext();
  renderer.drawTile(ctx, tileId, ORIGIN, ORIGIN, TILE_SIZE, false, true, 'all', neighbours);
  return lines;
}

describe('Runeward tiles that must not look like floor', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it.each(STYLE_IDS)('draws socket, gravel, dirt and hint unlike the floor in %s', (style) => {
    for (const [cx, cy] of CELLS) {
      for (const shadowMask of SHADOW_MASKS) {
        const neighbours: TileNeighbours = { wallMask: 0, shadowMask, hash: cx * 31 + cy + 1, cx, cy };
        const floor = logOf(style, 'floor', neighbours);
        expect(floor.length).toBeGreaterThan(0);
        const sealed = logOf(style, 'socket', neighbours);
        expect(sealed).toContain(`fillStyle = ${JSON.stringify(sealBase(style))}`);
        expect(floor).not.toContain(`fillStyle = ${JSON.stringify(sealBase(style))}`);
        for (const id of DIFFERENT_FROM_FLOOR) {
          expect(logOf(style, id, neighbours), id).not.toEqual(floor);
        }
        for (const id of SAME_AS_FLOOR) {
          expect(logOf(style, id, neighbours), id).toEqual(floor);
        }
      }
    }
  });
});
