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
 * Hidden walls must look exactly like floor: they may never join a wall mass or cast a shadow,
 * otherwise their neighbours would give them away.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../audio/AudioManager', () => ({
  AudioManager: { playSfx: vi.fn() }
}));

import { ConfigRegistry } from '../../../config/ConfigRegistry';
import { loadTestConfigs } from '../../../test/loadTestConfigs';
import { HIDDEN_WALL_TILES } from '../../PixelRenderer';

describe('hidden wall placement', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('lists hidden wall tiles', () => {
    expect(HIDDEN_WALL_TILES.size).toBeGreaterThan(0);
  });

  it('keeps every hidden wall out of the wall join and shadow caster lists', () => {
    const graphics = ConfigRegistry.getGame().graphics as unknown as Record<string, readonly string[]>;
    expect(graphics.wallJoinTiles.length).toBeGreaterThan(0);
    expect(graphics.shadowCasterTiles.length).toBeGreaterThan(0);
    for (const id of HIDDEN_WALL_TILES) {
      expect(graphics.wallJoinTiles).not.toContain(id);
      expect(graphics.shadowCasterTiles).not.toContain(id);
    }
  });
});
