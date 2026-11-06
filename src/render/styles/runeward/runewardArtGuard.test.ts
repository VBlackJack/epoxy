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

/** The art config guard: a good config passes, a malformed one is refused and never throws. */

import { beforeEach, describe, expect, it } from 'vitest';
import type { RunewardArtConfig, RunewardInkConfig } from '../../../core/types';
import { ConfigRegistry } from '../../../config/ConfigRegistry';
import { loadTestConfigs } from '../../../test/loadTestConfigs';
import { isRunewardArtValid, validRunewardArt } from './runewardArtGuard';

const BAD_COLOUR = 'not-a-colour';

/** Sections of the art config that hold the colours of blocks, monsters, devices, items, signals and marks. */
const OBJECT_SECTIONS: readonly string[] = ['block', 'mirror', 'monster', 'device', 'item', 'signal', 'mark'];

/** Monster types (and the shot) that carry their own colours. */
const MONSTER_TYPES: readonly string[] = [
  'bug', 'paramecium', 'pink_ball', 'walker', 'teeth', 'glider', 'fireball', 'tank', 'blob', 'puppet',
  'skitter', 'shot'
];

function freshArt(): RunewardArtConfig {
  return structuredClone(ConfigRegistry.getGame().runewardArt) as RunewardArtConfig;
}

function parchmentArt(): RunewardArtConfig {
  return structuredClone(ConfigRegistry.getGame().runewardArtVariants?.parchment) as RunewardArtConfig;
}

describe('Runeward art guard', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('accepts the shipped config', () => {
    expect(isRunewardArtValid(freshArt())).toBe(true);
  });

  it('refuses a missing config', () => {
    expect(validRunewardArt(undefined)).toBeNull();
    expect(validRunewardArt(null)).toBeNull();
    expect(validRunewardArt('floor')).toBeNull();
  });

  it('refuses a missing sub-object without throwing', () => {
    for (const section of ['floor', 'wall', 'blueWall', 'shadow', 'seal', 'exit', 'water', 'lava', 'mage', 'keys', 'door', 'gate', 'plate', 'rune', 'trap', 'portal', 'ice', 'force', 'animation', ...OBJECT_SECTIONS]) {
      const art = freshArt() as unknown as Record<string, unknown>;
      delete art[section];
      expect(validRunewardArt(art)).toBeNull();
    }
  });

  it('refuses a bad colour string and a bad number', () => {
    const colour = freshArt();
    colour.floor.base = BAD_COLOUR;
    expect(validRunewardArt(colour)).toBeNull();
    const period = freshArt();
    period.animation.flowPeriodMs = 0;
    expect(validRunewardArt(period)).toBeNull();
    const pulse = freshArt();
    pulse.animation.pulsePeriodMs = 0;
    expect(validRunewardArt(pulse)).toBeNull();
    const scroll = freshArt();
    scroll.animation.forceScrollPeriodMs = 0;
    expect(validRunewardArt(scroll)).toBeNull();
    const glyph = freshArt();
    glyph.keys.blue.glyph = BAD_COLOUR;
    expect(validRunewardArt(glyph)).toBeNull();
    const text = freshArt() as unknown as { shadow: { depth: unknown } };
    text.shadow.depth = 'deep';
    expect(validRunewardArt(text)).toBeNull();
  });

  it('accepts the shipped parchment variant and an art block without ink', () => {
    expect(isRunewardArtValid(parchmentArt())).toBe(true);
    expect(parchmentArt().ink).toBeDefined();
    expect(freshArt().ink).toBeUndefined();
  });

  it('refuses a malformed ink section', () => {
    const missing = parchmentArt() as unknown as Record<string, unknown>;
    delete missing.ink;
    expect(isRunewardArtValid(missing)).toBe(true);
    const badColour = parchmentArt();
    (badColour.ink as RunewardInkConfig).gold = BAD_COLOUR;
    expect(validRunewardArt(badColour)).toBeNull();
    const badTorch = parchmentArt();
    (badTorch.ink as RunewardInkConfig).torch.color = '';
    expect(validRunewardArt(badTorch)).toBeNull();
    for (const radius of [0, -1, Number.NaN, 'wide']) {
      const art = parchmentArt();
      (art.ink as { torch: { radiusTile: unknown } }).torch.radiusTile = radius;
      expect(validRunewardArt(art), String(radius)).toBeNull();
    }
    const notObject = parchmentArt() as unknown as { ink: unknown };
    notObject.ink = 'ink';
    expect(validRunewardArt(notObject)).toBeNull();
  });

  it('refuses an art block missing one of the object sections, in both variants', () => {
    for (const section of OBJECT_SECTIONS) {
      for (const make of [freshArt, parchmentArt]) {
        const art = make() as unknown as Record<string, unknown>;
        delete art[section];
        expect(validRunewardArt(art), section).toBeNull();
      }
    }
  });

  it('refuses a bad colour in each object section, in both variants', () => {
    const leaves: readonly (readonly string[])[] = [
      ['block', 'dirt', 'base'], ['block', 'arrow', 'glyph'], ['block', 'colour', 'green', 'edge'],
      ['mirror', 'frame', 'edge'], ['mirror', 'glassLight'],
      ['device', 'thinWall', 'dark'], ['device', 'flameJet', 'core'], ['device', 'laserChannel', 'blue', 'light'],
      ['item', 'boots', 'eye', 'main'], ['item', 'stopwatch', 'penalty'], ['item', 'forbid', 'slash'],
      ['signal', 'lit'], ['mark', 'hint', 'glow'], ['mark', 'button', 'gray', 'light']
    ];
    for (const make of [freshArt, parchmentArt]) {
      for (const path of leaves) {
        const art = make();
        let node = art as unknown as Record<string, unknown>;
        for (const key of path.slice(0, -1)) node = node[key] as Record<string, unknown>;
        node[path[path.length - 1]] = BAD_COLOUR;
        expect(validRunewardArt(art), path.join('.')).toBeNull();
      }
    }
  });

  it('refuses a monster type without colours and a bad monster colour', () => {
    expect(MONSTER_TYPES).toHaveLength(12);
    for (const type of MONSTER_TYPES) {
      for (const make of [freshArt, parchmentArt]) {
        const missing = make();
        delete (missing.monster as unknown as Record<string, unknown>)[type];
        expect(validRunewardArt(missing), type).toBeNull();
        const bad = make();
        bad.monster[type as keyof typeof bad.monster].eye = BAD_COLOUR;
        expect(validRunewardArt(bad), type).toBeNull();
      }
    }
  });

  it('refuses a monster step that is not above zero', () => {
    for (const make of [freshArt, parchmentArt]) {
      expect(isRunewardArtValid(make())).toBe(true);
      for (const step of [0, -1, Number.NaN, 'slow']) {
        const art = make();
        (art.animation as { monsterStepMs: unknown }).monsterStepMs = step;
        expect(validRunewardArt(art), String(step)).toBeNull();
      }
      const missing = make();
      delete (missing.animation as unknown as Record<string, unknown>).monsterStepMs;
      expect(validRunewardArt(missing)).toBeNull();
    }
  });

  it('remembers its verdict per config object', () => {
    const art = freshArt();
    expect(validRunewardArt(art)).toBe(art);
    art.floor.base = BAD_COLOUR;
    expect(validRunewardArt(art)).toBe(art);
  });
});
