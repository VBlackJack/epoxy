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
 * Legibility of the Runeward Parchment colours, read from game.json: WCAG contrast ratios between the
 * ink and the surfaces it is drawn on, between the liquids and between the shading and the floor.
 * When a pair fails, the colours in game.json change, never the thresholds below.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { ConfigRegistry } from '../../../config/ConfigRegistry';
import type { RunewardArtConfig } from '../../../core/types';
import { loadTestConfigs } from '../../../test/loadTestConfigs';
import { INK } from './runewardInk';

const INK_ON_PAPER_MIN = 7;
const INK_ON_SURFACE_MIN = 3;
const CREST_ON_WASH_MIN = 3;
const ROBE_ON_PAPER_MIN = 3;
const WATER_LAVA_MIN = 1.5;
const HATCH_ON_FLOOR_MIN = 1.3;

const HEX_RADIX = 16;
const SRGB_LINEAR_CUTOFF = 0.03928;
const SRGB_LINEAR_DIVISOR = 12.92;
const SRGB_OFFSET = 0.055;
const SRGB_SCALE = 1.055;
const SRGB_GAMMA = 2.4;
const LUMA_RED = 0.2126;
const LUMA_GREEN = 0.7152;
const LUMA_BLUE = 0.0722;
const FLARE = 0.05;
const MAX_CHANNEL = 255;

type Rgb = readonly [number, number, number];

/** Parses #rrggbb; the parchment colours the contrast cares about are all opaque hex. */
function parseHex(colour: string): Rgb {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(colour);
  if (!match) throw new Error(`not an opaque hex colour: ${colour}`);
  return [parseInt(match[1], HEX_RADIX), parseInt(match[2], HEX_RADIX), parseInt(match[3], HEX_RADIX)];
}

function linearChannel(value: number): number {
  const c = value / MAX_CHANNEL;
  return c <= SRGB_LINEAR_CUTOFF ? c / SRGB_LINEAR_DIVISOR : Math.pow((c + SRGB_OFFSET) / SRGB_SCALE, SRGB_GAMMA);
}

/** WCAG relative luminance of an sRGB colour. */
function luminance(rgb: Rgb): number {
  return LUMA_RED * linearChannel(rgb[0]) + LUMA_GREEN * linearChannel(rgb[1]) + LUMA_BLUE * linearChannel(rgb[2]);
}

/** WCAG contrast ratio, at least 1. */
function contrast(a: string | Rgb, b: string | Rgb): number {
  const la = luminance(typeof a === 'string' ? parseHex(a) : a);
  const lb = luminance(typeof b === 'string' ? parseHex(b) : b);
  return (Math.max(la, lb) + FLARE) / (Math.min(la, lb) + FLARE);
}

/** `top` laid over `bottom` with the given coverage, channel by channel. */
function mix(bottom: string, top: string, coverage: number): Rgb {
  const b = parseHex(bottom);
  const t = parseHex(top);
  return [0, 1, 2].map((i) => b[i] + (t[i] - b[i]) * coverage) as unknown as Rgb;
}

function art(): RunewardArtConfig {
  return ConfigRegistry.getGame().runewardArtVariants?.parchment as RunewardArtConfig;
}

interface Pair {
  readonly name: string;
  readonly a: string;
  readonly b: string;
}

function failures(pairs: readonly Pair[], minimum: number): string[] {
  return pairs
    .map((p) => ({ name: p.name, ratio: contrast(p.a, p.b) }))
    .filter((p) => p.ratio < minimum)
    .map((p) => `${p.name} ${p.ratio.toFixed(2)} < ${minimum}`);
}

describe('Runeward Parchment contrast', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('reads opaque colours for every pair it checks', () => {
    const a = art();
    expect(() => [a.ink!.line, a.floor.base, a.wall.top, a.water.deep, a.lava.crest].map(parseHex)).not.toThrow();
  });

  it('keeps the ink at 7:1 or more against every paper and floor shade', () => {
    const a = art();
    const ink = a.ink!;
    const papers: Record<string, string> = {
      'floor.base': a.floor.base,
      'floor.light': a.floor.light,
      'floor.dark': a.floor.dark,
      'paperStain': ink.paperStain
    };
    const pairs = Object.entries(papers).map(([name, colour]) => ({ name: `ink.line on ${name}`, a: ink.line, b: colour }));
    expect(failures(pairs, INK_ON_PAPER_MIN)).toEqual([]);
  });

  it('keeps the ink at 3:1 or more against every other surface it is drawn on', () => {
    const a = art();
    const surfaces: Record<string, string> = {
      'wall.top': a.wall.top,
      'wall.topLight': a.wall.topLight,
      'wall.topDark': a.wall.topDark,
      'wall.front': a.wall.front,
      'wall.frontDark': a.wall.frontDark,
      'water.light': a.water.light,
      'water.deep': a.water.deep,
      'lava.light': a.lava.light,
      'lava.deep': a.lava.deep,
      'exit.base': a.exit.base,
      'exit.ring': a.exit.ring,
      'mage.skin': a.mage.skin,
      'mage.robe': a.mage.robe,
      'mage.hat': a.mage.hat
    };
    const pairs = Object.entries(surfaces).map(([name, colour]) => ({ name: `ink.line on ${name}`, a: a.ink!.line, b: colour }));
    expect(failures(pairs, INK_ON_SURFACE_MIN)).toEqual([]);
  });

  it('keeps each liquid crest at 3:1 or more against its wash', () => {
    const a = art();
    const pairs: Pair[] = [];
    for (const [name, liquid] of [['water', a.water], ['lava', a.lava]] as const) {
      pairs.push({ name: `${name}.crest on ${name}.light`, a: liquid.crest, b: liquid.light });
      pairs.push({ name: `${name}.crest on ${name}.deep`, a: liquid.crest, b: liquid.deep });
    }
    expect(failures(pairs, CREST_ON_WASH_MIN)).toEqual([]);
  });

  it('keeps the mage robe at 3:1 or more against the paper', () => {
    const a = art();
    const pairs = [a.floor.base, a.floor.light, a.floor.dark].map((paper) => ({ name: `mage.robe on ${paper}`, a: a.mage.robe, b: paper }));
    expect(failures(pairs, ROBE_ON_PAPER_MIN)).toEqual([]);
  });

  it('keeps the scribe hood at 3:1 or more against the paper, with a 7:1 rim', () => {
    const a = art();
    const papers = [a.floor.base, a.floor.light, a.floor.dark];
    const cloak = a.character.cloak;
    const hood = papers.flatMap((paper) => [cloak.main, cloak.light, cloak.dark].map((colour) => ({ name: `character.cloak ${colour} on ${paper}`, a: colour, b: paper })));
    expect(failures(hood, ROBE_ON_PAPER_MIN)).toEqual([]);
    const rim = papers.map((paper) => ({ name: `character.cloak.edge on ${paper}`, a: cloak.edge, b: paper }));
    expect(failures(rim, INK_ON_PAPER_MIN)).toEqual([]);
  });

  it('keeps the character outline at 7:1 or more against the paper and 3:1 against the mage cloths', () => {
    const a = art();
    const paper = [a.floor.base, a.floor.light, a.floor.dark].map((p) => ({ name: `character.outline on ${p}`, a: a.character.outline, b: p }));
    expect(failures(paper, INK_ON_PAPER_MIN)).toEqual([]);
    const cloths = [a.mage.robe, a.mage.hat, a.mage.skin].map((c) => ({ name: `character.outline on ${c}`, a: a.character.outline, b: c }));
    expect(failures(cloths, INK_ON_SURFACE_MIN)).toEqual([]);
  });

  it('tells water from lava by 1.5:1 or more', () => {
    const a = art();
    expect(contrast(a.water.light, a.lava.light)).toBeGreaterThanOrEqual(WATER_LAVA_MIN);
  });

  it('keeps hatching over the floor at 1.3:1 or more against the bare floor', () => {
    const a = art();
    const coverage = INK.hatchWidth / INK.hatchSpacingFactor;
    for (const floor of [a.floor.base, a.floor.light, a.floor.dark]) {
      expect(contrast(mix(floor, a.ink!.hatch, coverage), floor)).toBeGreaterThanOrEqual(HATCH_ON_FLOOR_MIN);
    }
  });
});
