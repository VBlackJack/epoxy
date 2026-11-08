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
 * Render smoke test of the wired devices (purple wall and floor, toggle switch, black button, gray pulse button, wired
 * trap and wired flame jets): in every style each one draws something, never what a plain floor draws, and the wired
 * trap and jets are the plain device with the plug of a wired cell on top.
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
import { retroTileLayers, type RetroTileInput } from './retroCompose';
import { RETRO_SPRITE_NAMES, RETRO_SHEET } from './retroSprites';
import { WIRED_BASE_TILE, WIRED_SHAPE_OF_TILE } from './wiredArt';
import { NEIGHBOUR, type TileNeighbours } from './tileNeighbours';

/** The styles drawn by vector painters. The sprite styles (retro, retro32) compose layers, tested apart below. */
const STYLES: readonly GraphicsStyle[] = ['modern', 'runeward', 'runeward_parchment'];
const TILE_SIZE = 48;
const ORIGIN = 0;
const NEIGHBOURS: TileNeighbours = { wallMask: 0, shadowMask: NEIGHBOUR.N, hash: 7, cx: 2, cy: 3 };
const DRAWN_IDS = Object.keys(WIRED_SHAPE_OF_TILE);
const WIRED_BASE_IDS = Object.keys(WIRED_BASE_TILE);
const LIT_JET = 'flame_jet_wired_on';

function logOf(style: GraphicsStyle, tileId: string, pass: 'all' | 'static' | 'animated' = 'all', isEditor = false): string[] {
  const renderer = new PixelRenderer();
  renderer.setStyle(style);
  const { ctx, lines } = createRecordedContext();
  renderer.drawTile(ctx, tileId, ORIGIN, ORIGIN, TILE_SIZE, isEditor, true, pass, NEIGHBOURS);
  return lines;
}

describe('wired devices in the renderer', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  for (const style of STYLES) {
    for (const isEditor of [false, true]) {
      it(`${style}${isEditor ? ' (editor)' : ''}: each drawn wired device differs from the floor`, () => {
        const floor = logOf(style, 'floor', 'all', isEditor);
        for (const id of DRAWN_IDS) {
          const lines = logOf(style, id, 'all', isEditor);
          expect(lines.length, id).toBeGreaterThan(0);
          expect(lines, id).not.toEqual(floor);
        }
      });
    }

    it(`${style}: the two forms of a purple tile and of a switch differ`, () => {
      expect(logOf(style, 'purple_wall')).not.toEqual(logOf(style, 'purple_floor'));
      expect(logOf(style, 'toggle_switch_off')).not.toEqual(logOf(style, 'toggle_switch_on'));
      expect(logOf(style, 'black_button')).not.toEqual(logOf(style, 'button_gray_area'));
    });

    it(`${style}: a wired trap and jet draw the plain device and then a plug`, () => {
      for (const id of WIRED_BASE_IDS) {
        const wired = logOf(style, id);
        const plain = logOf(style, WIRED_BASE_TILE[id]);
        expect(wired.length, id).toBeGreaterThan(plain.length);
        expect(wired, id).not.toEqual(plain);
      }
    });

    it(`${style}: the plug of a lit wired jet follows the animated pass, not the cached one`, () => {
      const plain = logOf(style, 'flame_jet_on', 'static');
      expect(logOf(style, LIT_JET, 'static').length).toBeLessThanOrEqual(plain.length);
      expect(logOf(style, LIT_JET, 'animated').length).toBeGreaterThan(logOf(style, 'flame_jet_on', 'animated').length);
    });
  }

  describe('the sprite styles (retro and retro32)', () => {
    function layersOf(tileId: string, pass: RetroTileInput['pass'] = 'all'): string[] {
      const input: RetroTileInput = {
        tileId,
        def: ConfigRegistry.getTile(tileId),
        resolve: (id) => ConfigRegistry.getTile(id),
        pass,
        hash: 1,
        wallMask: 0,
        floorDetailEvery: 5,
        isEditor: false,
        revealHiddenWalls: false,
        isClosedTrap: true,
        phase: 0,
        reducedMotion: false
      };
      return retroTileLayers(input).map((layer) => layer.name);
    }

    it('draws each wired device as a sprite of its own over the floor', () => {
      for (const id of DRAWN_IDS) {
        expect(layersOf(id), id).toEqual(['floor', id]);
        expect(RETRO_SPRITE_NAMES, id).toContain(id);
        expect(Object.keys(RETRO_SHEET.sprites), id).toContain(id);
      }
    });
  });
});

