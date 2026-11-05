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
    for (const section of ['floor', 'wall', 'blueWall', 'shadow', 'seal', 'exit', 'water', 'lava', 'mage', 'keys', 'door', 'gate', 'plate', 'rune', 'trap', 'portal', 'ice', 'force', 'animation']) {
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

  it('remembers its verdict per config object', () => {
    const art = freshArt();
    expect(validRunewardArt(art)).toBe(art);
    art.floor.base = BAD_COLOUR;
    expect(validRunewardArt(art)).toBe(art);
  });
});
