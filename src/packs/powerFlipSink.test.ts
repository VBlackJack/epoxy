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

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../audio/AudioManager', () => ({
  AudioManager: { playSfx: vi.fn(), playStep: vi.fn() }
}));

import { ConfigRegistry } from '../config/ConfigRegistry';
import { PACK_JSON_VERSION_V19 } from '../config/constants';
import { signalTileHoldsEnd } from '../editor/editorSignalLinks';
import { registryTileLookup } from '../core/epoxy/epoxySignals';
import { compileSignalSpec, normalizeSignalLinks, signalSinkOf, usesPowerFlipSinkFormat } from '../core/signalLinks';
import type { Cc2LevelData, CompiledLevel } from '../core/types';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { makeLevel } from '../test/packFixtures';
import { serializePack } from './packJson';

const SOURCE = 'toggle_switch_off';
const FORCE_FLOOR = 'force_n';
const SWIVEL = 'swivel_door_cc2_ne';
const GREEN_WALL = 'toggle_wall_closed';
const SOURCE_CELL = { x: 1, y: 1 };
const TARGET_CELL = { x: 3, y: 3 };
const CC2_STUB = { v: 1 } as unknown as Cc2LevelData;

function levelWith(target: string, cc2: boolean): CompiledLevel {
  const level = makeLevel('flip');
  level.terrain[SOURCE_CELL.y][SOURCE_CELL.x] = SOURCE;
  level.terrain[TARGET_CELL.y][TARGET_CELL.x] = target;
  const signalLinks = [{ fromX: SOURCE_CELL.x, fromY: SOURCE_CELL.y, toX: TARGET_CELL.x, toY: TARGET_CELL.y }];
  return { ...level, signalLinks, ...(cc2 ? { cc2: CC2_STUB } : {}) };
}

describe('links to tiles that flip on power', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('are valid on a CC2-engine level only', () => {
    for (const target of [FORCE_FLOOR, SWIVEL]) {
      const native = levelWith(target, false);
      expect(normalizeSignalLinks(native.signalLinks, native.terrain, native.ruleset)).toBeNull();
      expect(compileSignalSpec(native, registryTileLookup)).toBeUndefined();
      const cc2 = levelWith(target, true);
      expect(normalizeSignalLinks(cc2.signalLinks, cc2.terrain, cc2.ruleset, null, undefined, true)).toHaveLength(1);
      const spec = compileSignalSpec(cc2, registryTileLookup);
      expect(spec?.links).toHaveLength(1);
      expect(spec?.nodes.find((node) => node.kind === 'sink')?.fires).toBe('flip');
    }
  });

  it('keep the green toggle wall linkable on a native level as before', () => {
    const native = levelWith(GREEN_WALL, false);
    expect(compileSignalSpec(native, registryTileLookup)?.links).toHaveLength(1);
  });

  it('make the tile an input end in the editor only when the map is a CC2-engine one', () => {
    const tile = ConfigRegistry.getTile(FORCE_FLOOR);
    expect(signalSinkOf(tile)).toBeNull();
    expect(signalSinkOf(tile, { cc2Engine: true })).toEqual({ fires: 'flip' });
    expect(signalTileHoldsEnd(tile, 'input')).toBe(false);
    expect(signalTileHoldsEnd(tile, 'input', true)).toBe(true);
  });

  it('need pack format 19 on a CC2-engine level and nothing else does', () => {
    expect(usesPowerFlipSinkFormat(levelWith(FORCE_FLOOR, true))).toBe(true);
    expect(usesPowerFlipSinkFormat(levelWith(SWIVEL, true))).toBe(true);
    expect(usesPowerFlipSinkFormat(levelWith(GREEN_WALL, true))).toBe(false);
    expect(usesPowerFlipSinkFormat(levelWith(FORCE_FLOOR, false))).toBe(false);
    const written = (level: CompiledLevel): number => JSON.parse(serializePack('N', [makeLevel('a'), level])).version;
    expect(written(levelWith(FORCE_FLOOR, true))).toBe(PACK_JSON_VERSION_V19);
    expect(written(levelWith(GREEN_WALL, true))).toBeLessThan(PACK_JSON_VERSION_V19);
    expect(written(levelWith(FORCE_FLOOR, false))).toBeLessThan(PACK_JSON_VERSION_V19);
  });
});
