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

/** Ink helpers: widths, hatch continuity across cells, size fallbacks and the paper. */

import { beforeEach, describe, expect, it } from 'vitest';
import { ConfigRegistry } from '../../../config/ConfigRegistry';
import type { RunewardArtConfig, RunewardInkConfig } from '../../../core/types';
import { loadTestConfigs } from '../../../test/loadTestConfigs';
import { NEIGHBOUR } from '../../tileNeighbours';
import { tileHash } from './runewardHash';
import {
  crossHatchPhase,
  fleckCount,
  hasInkDetail,
  hasInkHatching,
  hasStain,
  hatchOffsets,
  hatchPhase,
  hatchSpacing,
  hatchWidth,
  heavyLineWidth,
  INK_DETAIL_MIN_SIZE,
  INK_HATCH_MIN_SIZE,
  inkLineWidth,
  jointLayout,
  jointWidth,
  paintFlagstoneJoints,
  paintHatching,
  paintInkFloor,
  paintInkShadow,
  paintPaper
} from './runewardInk';
import { countCalls, createRecordedContext } from '../../../test/runewardTestContext';

const BIG = 48;
const SMALL_DETAIL = 19;
const SMALL_HATCH = 15;
const TINY = 8;
const HASH_SAMPLES = 600;
const STAIN_TOLERANCE = 0.06;
const FLOAT_TOLERANCE = 1e-6;
const SAMPLE_Y_VALUES = [0, 7, 23.5, 48];
const SAMPLE_CELLS: readonly (readonly [number, number])[] = [[0, 0], [3, 2], [17, 9]];
const PAPER_SAMPLES = 40;
const SIX = 6;

function parchment(): RunewardArtConfig {
  return ConfigRegistry.getGame().runewardArtVariants?.parchment as RunewardArtConfig;
}

function inkOf(art: RunewardArtConfig): RunewardInkConfig {
  return art.ink as RunewardInkConfig;
}

describe('ink widths and spacing', () => {
  it('follow the proportions of the tile with a one pixel floor', () => {
    expect(inkLineWidth(BIG)).toBeCloseTo(BIG * 0.04, 9);
    expect(heavyLineWidth(BIG)).toBeCloseTo(BIG * 0.07, 9);
    expect(jointWidth(BIG)).toBeCloseTo(BIG * 0.022, 9);
    expect(hatchSpacing(BIG)).toBeCloseTo(BIG * 0.125, 9);
    expect(hatchWidth(BIG)).toBeCloseTo(BIG * 0.025, 9);
    expect(inkLineWidth(TINY)).toBe(1);
    expect(heavyLineWidth(TINY)).toBe(1);
    expect(hatchWidth(TINY)).toBe(1);
    expect(hatchSpacing(TINY)).toBe(3);
  });

  it('switches detail at 20 px and hatching at 16 px', () => {
    expect(hasInkDetail(INK_DETAIL_MIN_SIZE)).toBe(true);
    expect(hasInkDetail(SMALL_DETAIL)).toBe(false);
    expect(hasInkHatching(INK_HATCH_MIN_SIZE)).toBe(true);
    expect(hasInkHatching(SMALL_HATCH)).toBe(false);
  });
});

describe('hatch phase', () => {
  it('continues across a cell border: the right edge of a cell is the left edge of the next', () => {
    for (const y of SAMPLE_Y_VALUES) {
      for (const [cx, cy] of SAMPLE_CELLS) {
        expect(hatchPhase(cx, cy, BIG, BIG, y)).toBeCloseTo(hatchPhase(cx + 1, cy, BIG, 0, y), 9);
        expect(crossHatchPhase(cx, cy, BIG, BIG, y)).toBeCloseTo(crossHatchPhase(cx + 1, cy, BIG, 0, y), 9);
      }
    }
  });

  it('continues across the bottom border too', () => {
    expect(hatchPhase(4, 5, BIG, 11, BIG)).toBeCloseTo(hatchPhase(4, 6, BIG, 11, 0), 9);
  });

  it('puts hatch lines on multiples of the spacing in world terms, in every cell', () => {
    const spacing = hatchSpacing(BIG);
    for (const cx of [0, 1, 5, 12]) {
      const base = hatchPhase(cx, 2, BIG, 0, 0);
      for (const t of hatchOffsets(base, spacing, 0, BIG * 2)) {
        const ratio = (base + t) / spacing;
        expect(Math.abs(ratio - Math.round(ratio))).toBeLessThan(FLOAT_TOLERANCE);
      }
    }
  });

  it('draws the lines of two neighbouring cells on the same world line', () => {
    const spacing = hatchSpacing(BIG);
    const leftLines = hatchOffsets(hatchPhase(2, 1, BIG, 0, 0), spacing, 0, BIG * 2);
    const rightLines = hatchOffsets(hatchPhase(3, 1, BIG, 0, 0), spacing, 0, BIG * 2);
    // A line x + y = t in the left cell is the line x + y = t - BIG in the right one.
    let continued = 0;
    for (const t of leftLines) {
      const shifted = t - BIG;
      if (shifted < 0) continue;
      continued += 1;
      expect(rightLines.some((u) => Math.abs(u - shifted) < FLOAT_TOLERANCE)).toBe(true);
    }
    expect(continued).toBeGreaterThan(0);
  });
});

describe('hatching and its fallback', () => {
  const cell = { cx: 2, cy: 3 };
  const rect = { x: 0, y: 0, w: BIG, h: BIG };

  beforeEach(() => {
    loadTestConfigs();
  });

  it('strokes hatch lines clipped to the rectangle', () => {
    const { ctx, lines } = createRecordedContext();
    paintHatching(ctx, BIG, cell, rect, '#123456');
    expect(countCalls(lines, 'clip')).toBe(1);
    expect(countCalls(lines, 'moveTo')).toBeGreaterThan(3);
    expect(countCalls(lines, 'stroke')).toBe(1);
  });

  it('replaces the shadow hatching by a flat wash below 16 px', () => {
    const art = parchment();
    const { ctx, lines } = createRecordedContext();
    paintInkShadow(ctx, SMALL_HATCH, art, inkOf(art), { hash: 1, shadowMask: NEIGHBOUR.N });
    expect(countCalls(lines, 'stroke')).toBe(0);
    expect(countCalls(lines, 'moveTo')).toBe(0);
    expect(lines).toContain(`fillStyle = ${JSON.stringify(art.shadow.color)}`);
    expect(countCalls(lines, 'fillRect')).toBe(1);
  });

  it('hatches the shadow, cross-hatched near the wall, from 16 px', () => {
    const art = parchment();
    const { ctx, lines } = createRecordedContext();
    paintInkShadow(ctx, INK_HATCH_MIN_SIZE, art, inkOf(art), { hash: 1, shadowMask: NEIGHBOUR.N });
    expect(countCalls(lines, 'stroke')).toBe(2);
    expect(countCalls(lines, 'fillRect')).toBe(0);
  });

  it('draws nothing without a caster to the north', () => {
    const art = parchment();
    const { ctx, lines } = createRecordedContext();
    paintInkShadow(ctx, BIG, art, inkOf(art), { hash: 1, shadowMask: NEIGHBOUR.S });
    expect(lines).toEqual([]);
  });
});

describe('paper', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('puts 0 to 3 flecks per tile and a stain on about one tile in six', () => {
    const counts = new Set<number>();
    let stains = 0;
    for (let i = 0; i < HASH_SAMPLES; i += 1) {
      const hash = tileHash(i, i * 3);
      counts.add(fleckCount(hash));
      if (hasStain(hash)) stains += 1;
    }
    expect([...counts].sort()).toEqual([0, 1, 2, 3]);
    expect(stains / HASH_SAMPLES).toBeGreaterThan(1 / SIX - STAIN_TOLERANCE);
    expect(stains / HASH_SAMPLES).toBeLessThan(1 / SIX + STAIN_TOLERANCE);
  });

  it('draws one arc per fleck and one ellipse per stain at full size', () => {
    const art = parchment();
    for (let i = 0; i < PAPER_SAMPLES; i += 1) {
      const hash = tileHash(i, 5);
      const { ctx, lines } = createRecordedContext();
      paintPaper(ctx, BIG, art.floor.base, inkOf(art), { hash, shadowMask: 0 });
      expect(countCalls(lines, 'arc')).toBe(fleckCount(hash));
      expect(countCalls(lines, 'ellipse')).toBe(hasStain(hash) ? 1 : 0);
    }
  });

  it('drops flagstone joints and flecks below 20 px', () => {
    const art = parchment();
    for (let i = 0; i < PAPER_SAMPLES; i += 1) {
      const cell = { hash: tileHash(i, 9), shadowMask: 0 };
      const small = createRecordedContext();
      paintInkFloor(small.ctx, SMALL_DETAIL, art, inkOf(art), cell);
      expect(countCalls(small.lines, 'arc')).toBe(0);
      expect(countCalls(small.lines, 'ellipse')).toBe(0);
      expect(countCalls(small.lines, 'stroke')).toBe(0);
      // Only the paper colour and its rectangle remain.
      expect(small.lines).toHaveLength(2);
    }
    const joints = createRecordedContext();
    paintFlagstoneJoints(joints.ctx, INK_DETAIL_MIN_SIZE, inkOf(art), { hash: 0, shadowMask: 0 });
    expect(countCalls(joints.lines, 'stroke')).toBe(1);
  });

  it('has two joint layouts picked by the hash', () => {
    const art = parchment();
    expect(jointLayout(0)).not.toBe(jointLayout(1));
    const a = createRecordedContext();
    const b = createRecordedContext();
    paintFlagstoneJoints(a.ctx, BIG, inkOf(art), { hash: 0, shadowMask: 0 });
    paintFlagstoneJoints(b.ctx, BIG, inkOf(art), { hash: 1, shadowMask: 0 });
    expect(a.lines).not.toEqual(b.lines);
  });
});
