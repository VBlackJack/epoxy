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
import { ConfigRegistry } from './ConfigRegistry';
import { findColorChannelConfigErrors } from './ConfigValidation';
import { loadTestConfigs } from '../test/loadTestConfigs';

const COLORS = ['red', 'green', 'blue', 'yellow'];
const TOGGLE_COLORS = ['red', 'blue', 'yellow'];
const CHANNEL_TILE_COUNT = 25;

describe('colour channel config', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('accepts the shipped tiles and entities', () => {
    expect(findColorChannelConfigErrors(ConfigRegistry.getTiles().tiles, ConfigRegistry.getMonsters().entities)).toEqual([]);
  });

  it('ships 25 channel tiles and 4 colour blocks', () => {
    const tiles = Object.values(ConfigRegistry.getTiles().tiles);
    const channel = tiles.filter(
      (t) =>
        t.plateColor !== undefined ||
        t.holdDoorColor !== undefined ||
        t.toggleChannel !== undefined ||
        t.floatingBlockColor !== undefined ||
        t.buttonAction?.startsWith('toggle_walls_')
    );
    expect(channel).toHaveLength(CHANNEL_TILE_COUNT);
    const blocks = Object.values(ConfigRegistry.getMonsters().entities).filter((e) => e.plateColor !== undefined);
    expect(blocks.map((b) => b.id).sort()).toEqual(COLORS.map((c) => `color_block_${c}`).sort());
  });

  it('pairs every colour block with the floating tile it leaves in water', () => {
    for (const c of COLORS) {
      const def = ConfigRegistry.getEntityDef(`color_block_${c}`);
      expect(def?.waterTransformsTo).toBe(`floating_block_${c}`);
      expect(ConfigRegistry.getTile(`floating_block_${c}`).passableByPlayer).toBe(true);
    }
  });

  it('keeps the green toggle walls on togglesTo and the colour walls on their own pair', () => {
    expect(ConfigRegistry.getTile('toggle_wall_closed').toggleChannel).toBeUndefined();
    for (const c of TOGGLE_COLORS) {
      const closed = ConfigRegistry.getTile(`toggle_wall_${c}_closed`);
      expect(closed.togglesTo).toBeUndefined();
      expect(closed.channelTogglesTo).toBe(`toggle_wall_${c}_open`);
      expect(ConfigRegistry.getTile(`toggle_button_${c}`).buttonAction).toBe(`toggle_walls_${c}`);
    }
  });

  it('refuses malformed channel tiles', () => {
    const tiles = structuredClone(ConfigRegistry.getTiles().tiles);
    const entities = structuredClone(ConfigRegistry.getMonsters().entities);
    const bad = (patch: Record<string, unknown>, id: string): string[] =>
      findColorChannelConfigErrors({ ...tiles, [id]: { ...tiles[id], ...patch } }, entities);

    expect(bad({ plateColor: 'purple' }, 'pressure_plate_red')).toHaveLength(1);
    expect(bad({ holdDoorTogglesTo: 'missing_tile' }, 'hold_door_red_open')).not.toEqual([]);
    expect(bad({ holdDoorOpen: false }, 'hold_door_red_open')).not.toEqual([]);
    expect(bad({ holdDoorColor: 'blue' }, 'hold_door_red_open')).not.toEqual([]);
    expect(bad({ holdDoorClosesOnOccupant: 'yes' }, 'hold_door_red_closed')).not.toEqual([]);
    expect(bad({ toggleChannel: 'green' }, 'toggle_wall_red_closed')).not.toEqual([]);
    expect(bad({ channelTogglesTo: 'toggle_wall_blue_open' }, 'toggle_wall_red_closed')).not.toEqual([]);
    expect(bad({ togglesTo: 'toggle_wall_open' }, 'toggle_wall_red_closed')).not.toEqual([]);
    const badBlock = { ...entities.color_block_red, plateColor: 'purple' as never };
    expect(findColorChannelConfigErrors(tiles, { ...entities, color_block_red: badBlock })).toHaveLength(1);
  });

  it('refuses a channel button with no wall of its channel', () => {
    const tiles = structuredClone(ConfigRegistry.getTiles().tiles);
    const withoutWalls = Object.fromEntries(Object.entries(tiles).filter(([id]) => !id.startsWith('toggle_wall_red_')));
    expect(findColorChannelConfigErrors(withoutWalls).some((e) => e.includes('no wall of channel red'))).toBe(true);
  });
});
