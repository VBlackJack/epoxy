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
  entityAvailability,
  EPOXY_ONLY_REASON_KEY,
  majorityRuleset,
  tileAvailability,
  winRuleAvailability
} from './paletteAvailability';

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

  it('blocks exactly the laser tiles under Lynx, derived from the tile config', () => {
    const blocked: string[] = [];
    for (const [id, def] of Object.entries(ConfigRegistry.getTiles().tiles)) {
      const isLaser = def.laserEmitter !== undefined || def.laserReceiverGroup !== undefined || def.laserGateGroup !== undefined;
      const result = tileAvailability('lynx', id);
      expect(result.available).toBe(!isLaser);
      if (!result.available) blocked.push(id);
    }
    expect(blocked.length).toBeGreaterThan(0);
    expect(tileAvailability('lynx', 'laser_emitter_n')).toEqual({ available: false, reasonKey: EPOXY_ONLY_REASON_KEY });
    expect(tileAvailability('lynx', 'wall')).toEqual({ available: true });
  });

  it('blocks exactly the mirrors under Lynx', () => {
    let mirrors = 0;
    for (const [id, def] of Object.entries(ConfigRegistry.getMonsters().entities)) {
      const result = entityAvailability('lynx', id);
      expect(result.available).toBe(def.mirrorAxis === undefined);
      if (def.mirrorAxis !== undefined) mirrors++;
    }
    expect(mirrors).toBeGreaterThan(0);
    expect(entityAvailability('lynx', 'dirt_block')).toEqual({ available: true });
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

  it('counts cc3d levels, which win only with strictly more levels than each other ruleset', () => {
    expect(majorityRuleset([{ ruleset: 'cc3d' }, { ruleset: 'cc3d' }, { ruleset: 'lynx' }])).toBe('cc3d');
    expect(majorityRuleset([{ ruleset: 'cc3d' }])).toBe('cc3d');
    expect(majorityRuleset([{ ruleset: 'cc3d' }, {}])).toBe('epoxy');
    expect(majorityRuleset([{ ruleset: 'cc3d' }, { ruleset: 'lynx' }, { ruleset: 'lynx' }, { ruleset: 'cc3d' }, {}])).toBe('lynx');
  });
});
