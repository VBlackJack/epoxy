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
import { ConfigRegistry } from '../config/ConfigRegistry';
import { CompiledLevel } from '../core/types';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { makeLevel } from '../test/packFixtures';
import { parseHexColor, renderLevelThumbnail, thumbnailDisplaySize, thumbnailPaletteKey } from './levelThumbnail';
import {
  THUMBNAIL_BYTES_PER_PIXEL,
  THUMBNAIL_ENTITY_COLOR,
  THUMBNAIL_PLACEHOLDER_CELLS,
  THUMBNAIL_PLAYER_COLOR
} from './uiConstants';

function pixel(level: CompiledLevel, x: number, y: number): number[] {
  const buffer = renderLevelThumbnail(level, ConfigRegistry.getGame().palette);
  const at = (y * buffer.width + x) * THUMBNAIL_BYTES_PER_PIXEL;
  return Array.from(buffer.data.slice(at, at + THUMBNAIL_BYTES_PER_PIXEL));
}

const rgba = (hex: string): number[] => [...(parseHexColor(hex) as readonly number[]), 255];
const paletteRgba = (key: string): number[] => rgba(ConfigRegistry.getGame().palette[key]);

describe('levelThumbnail', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('parses short and long hex colours and refuses the rest', () => {
    expect(parseHexColor('#102030')).toEqual([16, 32, 48]);
    expect(parseHexColor('#fa0')).toEqual([255, 170, 0]);
    expect(parseHexColor('rgba(1, 2, 3, 0.5)')).toBeNull();
    expect(parseHexColor(undefined)).toBeNull();
  });

  it('gives every tile of the base config a palette entry', () => {
    const { palette } = ConfigRegistry.getGame();
    for (const id of Object.keys(ConfigRegistry.getTiles().tiles)) {
      const key = thumbnailPaletteKey(id);
      expect(key, id).not.toBeNull();
      expect(parseHexColor(palette[key as string]), `${id} -> ${key}`).not.toBeNull();
    }
  });

  it('has one pixel per cell of the map', () => {
    const level = makeLevel('a');
    const buffer = renderLevelThumbnail(level, ConfigRegistry.getGame().palette);
    expect(buffer.height).toBe(level.terrain.length);
    expect(buffer.width).toBe(level.terrain[0].length);
    expect(buffer.data).toHaveLength(buffer.width * buffer.height * THUMBNAIL_BYTES_PER_PIXEL);
  });

  it('colours cells by tile, with an item hiding the terrain below it', () => {
    const level = makeLevel('a');
    level.terrain[3][3] = 'wall';
    level.terrain[3][4] = 'water';
    level.items[3][5] = 'key_red';
    expect(pixel(level, 3, 3)).toEqual(paletteRgba('wallBase'));
    expect(pixel(level, 4, 3)).toEqual(paletteRgba('waterDeep'));
    expect(pixel(level, 5, 3)).toEqual(paletteRgba('red'));
    expect(pixel(level, 6, 6)).toEqual(paletteRgba('floorBase'));
  });

  it('marks entities and the player start with contrasting pixels', () => {
    const level = makeLevel('a', { entities: [{ type: 'dirt_block', x: 5, y: 5, dir: 'S' }] });
    expect(pixel(level, 5, 5)).toEqual(rgba(THUMBNAIL_ENTITY_COLOR));
    expect(pixel(level, level.playerStart.x, level.playerStart.y)).toEqual(rgba(THUMBNAIL_PLAYER_COLOR));
  });

  it('paints a Sokoban target and a laser receiver from the base palette', () => {
    const level = makeLevel('a');
    level.terrain[2][2] = 'block_target';
    level.terrain[2][3] = 'laser_receiver_blue';
    level.terrain[2][4] = 'laser_gate_red_closed';
    expect(pixel(level, 2, 2)).toEqual(paletteRgba('blockTarget'));
    expect(pixel(level, 3, 2)).toEqual(paletteRgba('blue'));
    expect(pixel(level, 4, 2)).toEqual(paletteRgba('red'));
  });

  it('renders a lynx level like an epoxy one', () => {
    const level = makeLevel('a', { ruleset: 'lynx' });
    level.terrain[2][2] = 'fire';
    expect(pixel(level, 2, 2)).toEqual(paletteRgba('fireBase'));
  });

  it('shows a neutral chequerboard for a cc3d level, whatever its terrain', () => {
    const level = { ...makeLevel('c'), ruleset: 'cc3d' as const };
    level.terrain[0][0] = 'fire';
    const buffer = renderLevelThumbnail(level, ConfigRegistry.getGame().palette);
    expect(buffer.width).toBe(THUMBNAIL_PLACEHOLDER_CELLS);
    expect(buffer.height).toBe(THUMBNAIL_PLACEHOLDER_CELLS);
    expect(pixel(level, 0, 0)).toEqual(paletteRgba('floorBorder'));
    expect(pixel(level, 1, 0)).toEqual(paletteRgba('wallBase'));
  });

  it('uses the fallback colour for an unknown tile and ignores out-of-map entities', () => {
    const level = makeLevel('a', { entities: [{ type: 'dirt_block', x: 999, y: 999, dir: 'S' }] });
    level.terrain[1][2] = 'mystery_tile';
    expect(pixel(level, 2, 1)).toEqual([128, 128, 128, 255]);
  });

  it('scales to the largest whole multiple that fits the box', () => {
    expect(thumbnailDisplaySize(32, 32, 64)).toEqual({ width: 64, height: 64 });
    expect(thumbnailDisplaySize(40, 20, 64)).toEqual({ width: 40, height: 20 });
    expect(thumbnailDisplaySize(10, 5, 64)).toEqual({ width: 60, height: 30 });
    expect(thumbnailDisplaySize(100, 100, 64)).toEqual({ width: 100, height: 100 });
  });
});
