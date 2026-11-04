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

import { describe, expect, it } from 'vitest';
import { hasEpoxyOnlyContent } from '../core/RulesetFeatures';
import type { CompiledLevel } from '../core/types';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { isEditableRuleset, parseChipsRequired, parseRuleset, parseTimeLimit, parseWinRule, requiresEpoxyRules } from './metadataFields';

const CURRENT = 180;

describe('parseTimeLimit', () => {
  it('keeps the current value for an empty entry', () => {
    expect(parseTimeLimit('', CURRENT)).toBe(CURRENT);
    expect(parseTimeLimit('   ', CURRENT)).toBe(CURRENT);
  });

  it('accepts 0 as untimed instead of falling back', () => {
    expect(parseTimeLimit('0', CURRENT)).toBe(0);
  });

  it('floors a finite number and clamps it to zero or more', () => {
    expect(parseTimeLimit('90.9', CURRENT)).toBe(90);
    expect(parseTimeLimit('-5', CURRENT)).toBe(0);
    expect(parseTimeLimit('300', CURRENT)).toBe(300);
  });

  it('keeps the current value for an invalid entry', () => {
    expect(parseTimeLimit('abc', CURRENT)).toBe(CURRENT);
    expect(parseTimeLimit('Infinity', CURRENT)).toBe(CURRENT);
    expect(parseTimeLimit('NaN', CURRENT)).toBe(CURRENT);
  });
});

describe('parseChipsRequired', () => {
  it('follows the same rules', () => {
    expect(parseChipsRequired('', 4)).toBe(4);
    expect(parseChipsRequired('0', 4)).toBe(0);
    expect(parseChipsRequired('2.7', 4)).toBe(2);
    expect(parseChipsRequired('-1', 4)).toBe(0);
    expect(parseChipsRequired('x', 4)).toBe(4);
  });
});

describe('parseRuleset', () => {
  it('accepts every known ruleset', () => {
    expect(parseRuleset('epoxy', 'lynx')).toBe('epoxy');
    expect(parseRuleset('lynx', 'epoxy')).toBe('lynx');
  });

  it('keeps the current ruleset for an unknown entry', () => {
    expect(parseRuleset('ms', 'lynx')).toBe('lynx');
    expect(parseRuleset('', 'epoxy')).toBe('epoxy');
  });
});

describe('parseWinRule', () => {
  it('accepts the receivers rule and keeps the current one for an unknown entry', () => {
    expect(parseWinRule('receivers', 'exit')).toBe('receivers');
    expect(parseWinRule('targets', 'exit')).toBe('targets');
    expect(parseWinRule('nonsense', 'targets')).toBe('targets');
  });
});

describe('requiresEpoxyRules', () => {
  it('is true for targets and receivers levels, and for any level with Epoxy-only content (lasers or colour channels)', () => {
    expect(requiresEpoxyRules('targets', false)).toBe(true);
    expect(requiresEpoxyRules('receivers', false)).toBe(true);
    expect(requiresEpoxyRules('exit', true)).toBe(true);
  });

  it('is false for a plain exit level', () => {
    expect(requiresEpoxyRules('exit', false)).toBe(false);
  });

  it('is true for a level that places a colour channel tile or a colour block', () => {
    loadTestConfigs();
    const grid = (cell: string): string[][] => [['wall', 'wall', 'wall'], ['wall', cell, 'wall'], ['wall', 'wall', 'wall']];
    const empty = grid('floor').map((row) => row.map(() => null as string | null));
    const level = (terrain: string[][], entityType?: string): CompiledLevel =>
      ({ terrain, items: empty, entities: entityType ? [{ type: entityType, x: 1, y: 1, dir: 'S' }] : [] }) as unknown as CompiledLevel;
    for (const tile of ['pressure_plate_red', 'hold_door_blue_closed', 'toggle_wall_red_open', 'toggle_button_yellow', 'floating_block_green']) {
      expect(requiresEpoxyRules('exit', hasEpoxyOnlyContent(level(grid(tile)))), tile).toBe(true);
    }
    expect(requiresEpoxyRules('exit', hasEpoxyOnlyContent(level(grid('floor'), 'color_block_blue')))).toBe(true);
    expect(requiresEpoxyRules('exit', hasEpoxyOnlyContent(level(grid('floor'), 'dirt_block')))).toBe(false);
  });
});

describe('isEditableRuleset', () => {
  it('opens Epoxy and Lynx levels, with or without a ruleset', () => {
    for (const ruleset of [undefined, 'epoxy', 'lynx'] as const) {
      expect(isEditableRuleset(ruleset), String(ruleset)).toBe(true);
    }
  });

  it('opens cc3d levels in the editor, like every other ruleset', () => {
    for (const ruleset of [undefined, 'epoxy', 'lynx', 'cc3d'] as const) expect(isEditableRuleset(ruleset), String(ruleset)).toBe(true);
  });
});
