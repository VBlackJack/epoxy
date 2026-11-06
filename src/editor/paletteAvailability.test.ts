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
import enLocale from '../locales/en.json';
import frLocale from '../locales/fr.json';
import { loadTestConfigs } from '../test/loadTestConfigs';
import {
  cellEdgeAvailability,
  entityAvailability,
  EPOXY_ONLY_REASON_KEY,
  linkAvailability,
  majorityRuleset,
  tileAvailability,
  winRuleAvailability
} from './paletteAvailability';

/** Button actions of the colour channel toggle buttons, as the tile config names them. */
const COLOUR_BUTTON_ACTIONS: readonly string[] = ['toggle_walls_red', 'toggle_walls_blue', 'toggle_walls_yellow'];
/** One tile of each colour channel family: plate, hold door, toggle wall, toggle button, floating block. */
const COLOUR_TILE_IDS: readonly string[] = [
  'pressure_plate_red',
  'hold_door_red_closed',
  'hold_door_red_open',
  'toggle_wall_red_open',
  'toggle_wall_blue_closed',
  'toggle_button_red',
  'toggle_button_blue',
  'toggle_button_yellow',
  'floating_block_red',
  'floating_block_yellow'
];
const COLOUR_BLOCK_IDS: readonly string[] = ['color_block_red', 'color_block_green', 'color_block_blue', 'color_block_yellow'];
const ARROW_BLOCK_IDS: readonly string[] = ['arrow_block_one', 'arrow_block_line', 'arrow_block_corner', 'arrow_block_tee'];

describe('paletteAvailability', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('leaves everything available under Epoxy rules', () => {
    for (const id of Object.keys(ConfigRegistry.getTiles().tiles)) {
      expect(tileAvailability('epoxy', id)).toEqual({ available: true });
    }
    for (const id of Object.keys(ConfigRegistry.getMonsters().entities)) {
      expect(entityAvailability('epoxy', id)).toEqual({ available: true });
    }
    expect(winRuleAvailability('epoxy', 'receivers')).toEqual({ available: true });
  });

  it('blocks exactly the Epoxy-only tiles under Lynx, derived from the tile config', () => {
    const blocked: string[] = [];
    for (const [id, def] of Object.entries(ConfigRegistry.getTiles().tiles)) {
      const isLaser = def.laserEmitter !== undefined || def.laserReceiverGroup !== undefined || def.laserGateGroup !== undefined;
      const isColourChannel =
        def.plateColor !== undefined ||
        def.holdDoorColor !== undefined ||
        def.toggleChannel !== undefined ||
        def.floatingBlockColor !== undefined ||
        (def.buttonAction !== undefined && COLOUR_BUTTON_ACTIONS.includes(def.buttonAction));
      const isEpoxyOnlyItem = def.slowsMonsters !== undefined || def.hastesPlayer !== undefined || def.revealsHiddenWalls !== undefined || def.pullsBlocks !== undefined || def.absorbsMonsterContact !== undefined || def.collectible === 'charge' || def.litCharge !== undefined;
      const isSteeringPad = def.buttonAction === 'steer_monsters';
      const isShotDevice = def.shotLauncher !== undefined || def.buttonAction === 'fire_launchers';
      const isSwivelDoor = def.swivelTurns !== undefined;
      const isTransmogrifier = def.transmogrifies === true;
      const isTurnPlate = def.facingTurn !== undefined;
      const isSignalTile = def.signalSource !== undefined || def.signalGate !== undefined;
      const isForceCycle = def.forceCycle === true;
      const result = tileAvailability('lynx', id);
      expect(result.available, id).toBe(!(isLaser || isColourChannel || isEpoxyOnlyItem || isSteeringPad || isShotDevice || isSwivelDoor || isTransmogrifier || isTurnPlate || isSignalTile || isForceCycle));
      if (!result.available) blocked.push(id);
    }
    expect(blocked.length).toBeGreaterThan(0);
    expect(tileAvailability('lynx', 'laser_emitter_n')).toEqual({ available: false, reasonKey: EPOXY_ONLY_REASON_KEY });
    expect(tileAvailability('lynx', 'wall')).toEqual({ available: true });
  });

  it('offers the turn plates under the Epoxy rules only', () => {
    for (const id of ['turn_plate_cw', 'turn_plate_ccw']) {
      expect(tileAvailability('epoxy', id), id).toEqual({ available: true });
      expect(tileAvailability('lynx', id), id).toEqual({ available: false, reasonKey: EPOXY_ONLY_REASON_KEY });
    }
  });

  it('offers the signal plate and gates under the Epoxy rules only', () => {
    const signalIds = ['signal_plate', 'signal_button', 'signal_gate_and', 'signal_gate_or', 'signal_gate_not', 'signal_gate_xor', 'signal_latch_off', 'signal_latch_on'];
    for (const id of signalIds) {
      expect(tileAvailability('epoxy', id), id).toEqual({ available: true });
      expect(tileAvailability('lynx', id), id).toEqual({ available: false, reasonKey: EPOXY_ONLY_REASON_KEY });
    }
  });

  it('blocks every colour channel tile family under Lynx and allows it under Epoxy', () => {
    for (const id of COLOUR_TILE_IDS) {
      expect(ConfigRegistry.getTile(id), id).toBeDefined();
      expect(tileAvailability('lynx', id), id).toEqual({ available: false, reasonKey: EPOXY_ONLY_REASON_KEY });
      expect(tileAvailability('epoxy', id), id).toEqual({ available: true });
    }
  });

  it('keeps the original toggle wall and button available under Lynx', () => {
    expect(tileAvailability('lynx', 'button_green')).toEqual({ available: true });
    expect(tileAvailability('lynx', 'toggle_wall_closed')).toEqual({ available: true });
    expect(tileAvailability('lynx', 'toggle_wall_open')).toEqual({ available: true });
  });

  it('blocks exactly the mirrors, turrets, colour blocks, puppets and skitters under Lynx', () => {
    let blocked = 0;
    for (const [id, def] of Object.entries(ConfigRegistry.getMonsters().entities)) {
      const epoxyOnly =
        def.mirrorAxis !== undefined ||
        def.plateColor !== undefined ||
        def.turretBeam !== undefined ||
        def.steeredBy !== undefined ||
        def.pushArrows !== undefined ||
        def.movementPattern === 'flee_player' ||
        def.epoxyOnly === true;
      const result = entityAvailability('lynx', id);
      expect(result.available, id).toBe(!epoxyOnly);
      if (epoxyOnly) blocked++;
    }
    expect(blocked).toBeGreaterThan(0);
    expect(entityAvailability('lynx', 'dirt_block')).toEqual({ available: true });
  });

  it('blocks each colour block under Lynx and allows it under Epoxy', () => {
    for (const id of COLOUR_BLOCK_IDS) {
      expect(entityAvailability('lynx', id), id).toEqual({ available: false, reasonKey: EPOXY_ONLY_REASON_KEY });
      expect(entityAvailability('epoxy', id), id).toEqual({ available: true });
    }
  });

  it('keeps the four arrow blocks out of the Lynx palette and in the Epoxy one', () => {
    for (const id of ARROW_BLOCK_IDS) {
      expect(ConfigRegistry.getEntityDef(id), id).toBeDefined();
      expect(entityAvailability('lynx', id), id).toEqual({ available: false, reasonKey: EPOXY_ONLY_REASON_KEY });
      expect(entityAvailability('epoxy', id), id).toEqual({ available: true });
    }
  });

  it('blocks the targets and receivers win rules under Lynx only', () => {
    expect(winRuleAvailability('lynx', 'exit')).toEqual({ available: true });
    expect(winRuleAvailability('lynx', 'targets')).toEqual({ available: false, reasonKey: EPOXY_ONLY_REASON_KEY });
    expect(winRuleAvailability('lynx', 'receivers')).toEqual({ available: false, reasonKey: EPOXY_ONLY_REASON_KEY });
  });

  it('gives a reason key that exists in both locales', () => {
    const lookup = (root: unknown): unknown =>
      EPOXY_ONLY_REASON_KEY.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], root);
    expect(typeof lookup(enLocale)).toBe('string');
    expect(typeof lookup(frLocale)).toBe('string');
  });
});

describe('majorityRuleset', () => {
  it('returns the most common editable ruleset', () => {
    expect(majorityRuleset([{ ruleset: 'lynx' }, { ruleset: 'lynx' }, { ruleset: 'epoxy' }])).toBe('lynx');
    expect(majorityRuleset([{ ruleset: 'lynx' }, {}, { ruleset: 'epoxy' }])).toBe('epoxy');
  });

  it('counts a level with no ruleset as Epoxy', () => {
    expect(majorityRuleset([{}, {}, { ruleset: 'lynx' }])).toBe('epoxy');
  });

  it('returns Epoxy on a tie and on an empty list', () => {
    expect(majorityRuleset([{ ruleset: 'lynx' }, { ruleset: 'epoxy' }])).toBe('epoxy');
    expect(majorityRuleset([])).toBe('epoxy');
  });

  it('never answers cc3d: a pack of cc3d levels gives a new level the Epoxy rules, and cc3d levels do not vote', () => {
    expect(majorityRuleset([{ ruleset: 'cc3d' }, { ruleset: 'cc3d' }, { ruleset: 'lynx' }])).toBe('lynx');
    expect(majorityRuleset([{ ruleset: 'cc3d' }])).toBe('epoxy');
    expect(majorityRuleset([{ ruleset: 'cc3d' }, { ruleset: 'cc3d' }, {}])).toBe('epoxy');
  });
});

describe('linkAvailability', () => {
  it('refuses the shot system under Lynx with the Epoxy-only reason, and allows traps and clone machines everywhere', () => {
    expect(linkAvailability('epoxy', 'shot')).toEqual({ available: true });
    expect(linkAvailability('cc3d', 'shot')).toEqual({ available: true });
    expect(linkAvailability('lynx', 'shot')).toEqual({ available: false, reasonKey: EPOXY_ONLY_REASON_KEY });
    for (const system of ['trap', 'clone'] as const) {
      for (const ruleset of ['epoxy', 'lynx', 'cc3d'] as const) expect(linkAvailability(ruleset, system), `${system} ${ruleset}`).toEqual({ available: true });
    }
  });

  it('keeps the shot launchers and the shot trigger Epoxy only as tiles', () => {
    for (const id of ['shot_launcher_n', 'shot_launcher_e', 'shot_launcher_s', 'shot_launcher_w', 'shot_trigger']) {
      expect(tileAvailability('epoxy', id), id).toEqual({ available: true });
      expect(tileAvailability('lynx', id), id).toEqual({ available: false, reasonKey: EPOXY_ONLY_REASON_KEY });
    }
  });
});

describe('cellEdgeAvailability', () => {
  it('is Epoxy only, with the Epoxy-only reason under Lynx', () => {
    expect(cellEdgeAvailability('epoxy')).toEqual({ available: true });
    expect(cellEdgeAvailability('cc3d')).toEqual({ available: true });
    expect(cellEdgeAvailability('lynx')).toEqual({ available: false, reasonKey: EPOXY_ONLY_REASON_KEY });
  });
});
