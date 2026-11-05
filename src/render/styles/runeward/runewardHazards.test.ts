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
 * The Runeward hazard painters (trap, teleports, ice, ice corners, force floors): the two trap states look
 * different, reduced motion freezes the portals and the force floors, force chevrons point where the tile pushes,
 * ice corners use the bend geometry of the shared drawing, and the colours that carry meaning keep their contrast.
 * When a contrast pair fails, the colours in game.json change, never the thresholds below.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigRegistry } from '../../../config/ConfigRegistry';
import type { Direction, RunewardArtConfig } from '../../../core/types';
import { loadTestConfigs } from '../../../test/loadTestConfigs';
import { createRecordedContext } from '../../../test/runewardTestContext';
import { iceBendGeometry } from '../../iceBend';
import { TELEPORT_GLYPH_RADIUS_TILE } from '../../PixelRenderer';
import { NEIGHBOUR, type TileNeighbours } from '../../tileNeighbours';
import { FORCE_VECTOR, TELEPORT_GLYPH_RADIUS } from './runewardHazards';
import { RUNEWARD_FALLBACK, RUNEWARD_PAINTERS, type RunewardPaintEnv, type RunewardTilePass } from './runewardTiles';

vi.mock('../../iceBend', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../iceBend')>();
  return { ...actual, paintIceBend: vi.fn(actual.paintIceBend) };
});

import { paintIceBend } from '../../iceBend';

const TILE = 48;
const SMALL_TILE = 12;
const FAR_TICK = 937;
const CELL: Readonly<TileNeighbours> = { wallMask: 0, shadowMask: NEIGHBOUR.N, hash: 424242, cx: 3, cy: 7 };
const FORCE_IDS: Readonly<Record<string, Direction>> = { force_n: 'N', force_e: 'E', force_s: 'S', force_w: 'W' };
const TELEPORT_IDS = ['teleport', 'teleport_red', 'teleport_blue', 'teleport_yellow', 'teleport_green'] as const;
const ICE_CORNER_IDS = ['ice_nw', 'ice_ne', 'ice_sw', 'ice_se'] as const;
const ARROW_ON_BASE_MIN = 3;
const JAW_ON_PIT_MIN = 3;
const ICE_ON_FLOOR_MIN = 1.2;
const PARCHMENT_ICE_ON_PAPER_MIN = 1.25;
const ICE_EDGE_ON_PAPER_MIN = 3;
const PINWHEEL_ARMS = 4;
const CHEVRONS_AT_REST = 3;
/** Fraction of the tile the closed jaws must gain over the open ones. */
const JAW_TRAVEL_MIN_TILE = 0.15;
/** A tick after the rest one, small enough that no chevron has wrapped round a whole step. */
const SHORT_TICK = 5;
const LINE_WIDTH_PREFIX = 'lineWidth = ';

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

function luminance(hex: string): number {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) throw new Error(`not an opaque hex colour: ${hex}`);
  const [r, g, b] = [match[1], match[2], match[3]].map((part) => {
    const c = parseInt(part, HEX_RADIX) / MAX_CHANNEL;
    return c <= SRGB_LINEAR_CUTOFF ? c / SRGB_LINEAR_DIVISOR : Math.pow((c + SRGB_OFFSET) / SRGB_SCALE, SRGB_GAMMA);
  });
  return LUMA_RED * r + LUMA_GREEN * g + LUMA_BLUE * b;
}

/** WCAG contrast ratio, at least 1. */
function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + FLARE) / (Math.min(la, lb) + FLARE);
}

function plainArt(): RunewardArtConfig {
  return ConfigRegistry.getGame().runewardArt as RunewardArtConfig;
}

function parchmentArt(): RunewardArtConfig {
  return ConfigRegistry.getGame().runewardArtVariants?.parchment as RunewardArtConfig;
}

const VARIANTS = [
  { name: 'plain', art: plainArt, smallCount: CHEVRONS_AT_REST },
  { name: 'parchment', art: parchmentArt, smallCount: 2 }
] as const;

function envOf(art: RunewardArtConfig, timeTick: number, reducedMotion: boolean): RunewardPaintEnv {
  return { timeTick, reducedMotion, cache: new Map(), art };
}

interface DrawOptions {
  readonly tick?: number;
  readonly reduced?: boolean;
  readonly pass?: RunewardTilePass;
  readonly closed?: boolean;
  readonly size?: number;
  readonly cell?: Readonly<TileNeighbours>;
}

function tileLog(id: string, art: RunewardArtConfig, options: DrawOptions = {}): string[] {
  const { ctx, lines } = createRecordedContext();
  RUNEWARD_PAINTERS.tiles[id](
    ctx,
    0,
    0,
    options.size ?? TILE,
    options.pass ?? 'all',
    options.cell ?? CELL,
    envOf(art, options.tick ?? 0, options.reduced ?? false),
    false,
    options.closed ?? false
  );
  return lines;
}

/** Numbers inside a recorded call line such as `lineTo(1.5, 2)`. */
function argsOf(line: string): number[] {
  const inner = line.slice(line.indexOf('(') + 1, line.lastIndexOf(')'));
  return inner.split(',').map((part) => Number(part.trim()));
}

type Point = readonly [number, number];

interface Chevron {
  readonly tail1: Point;
  readonly tip: Point;
  readonly tail2: Point;
}

/** Chevrons of a recorded drawing: every moveTo followed by two lineTo calls, after the clip that frames the force floor. */
function chevronsOf(lines: readonly string[]): Chevron[] {
  const chevrons: Chevron[] = [];
  const start = lines.indexOf('clip()');
  for (let i = start + 1; i + 2 < lines.length; i += 1) {
    if (lines[i].startsWith('moveTo(') && lines[i + 1].startsWith('lineTo(') && lines[i + 2].startsWith('lineTo(')) {
      const [x1, y1] = argsOf(lines[i]);
      const [x2, y2] = argsOf(lines[i + 1]);
      const [x3, y3] = argsOf(lines[i + 2]);
      chevrons.push({ tail1: [x1, y1], tip: [x2, y2], tail2: [x3, y3] });
    }
  }
  return chevrons;
}

function along(point: Point, vector: Point): number {
  return point[0] * vector[0] + point[1] * vector[1];
}

/** How far the tip of a chevron sits ahead of its two ends along a vector; positive means it points that way. */
function pointing(chevron: Chevron, vector: Point): number {
  return along(chevron.tip, vector) - Math.max(along(chevron.tail1, vector), along(chevron.tail2, vector));
}

/** Direction a chevron points, as a unit step on each axis: the tip against the middle of its two ends. */
function heading(chevron: Chevron): string {
  const mx = (chevron.tail1[0] + chevron.tail2[0]) / 2;
  const my = (chevron.tail1[1] + chevron.tail2[1]) / 2;
  return `${Math.sign(Math.round(chevron.tip[0] - mx))},${Math.sign(Math.round(chevron.tip[1] - my))}`;
}

function lineWidths(lines: readonly string[]): number[] {
  return lines.filter((line) => line.startsWith(LINE_WIDTH_PREFIX)).map((line) => Number(line.slice(LINE_WIDTH_PREFIX.length)));
}

beforeEach(() => {
  loadTestConfigs();
  vi.mocked(paintIceBend).mockClear();
});

describe('Runeward trap', () => {
  it.each(VARIANTS)('draws open and closed jaws differently in the $name drawing', ({ art }) => {
    expect(tileLog('trap', art(), { closed: true })).not.toEqual(tileLog('trap', art(), { closed: false }));
  });

  it.each(VARIANTS)('pulls the jaw tips back to the sides when the trap opens in the $name drawing', ({ art }) => {
    // The jaws are drawn after the frame of the recess; the hatching of the parchment pit comes before it.
    const leftReach = (lines: readonly string[]): number =>
      Math.max(
        ...lines
          .slice(lines.lastIndexOf(lines.filter((line) => line.startsWith('strokeRect(')).at(-1) as string))
          .filter((line) => line.startsWith('lineTo('))
          .map((line) => argsOf(line)[0])
          .filter((x) => x < TILE / 2)
      );
    expect(leftReach(tileLog('trap', art(), { closed: true }))).toBeGreaterThan(
      leftReach(tileLog('trap', art(), { closed: false })) + TILE * JAW_TRAVEL_MIN_TILE
    );
  });

  it('keeps the closed jaws short of each other', () => {
    const xs = tileLog('trap', plainArt(), { closed: true })
      .filter((line) => line.startsWith('lineTo('))
      .map((line) => argsOf(line)[0]);
    expect(Math.max(...xs.filter((x) => x < TILE / 2))).toBeLessThan(TILE / 2);
    expect(Math.min(...xs.filter((x) => x > TILE / 2))).toBeGreaterThan(TILE / 2);
  });

  it('keeps the jaws readable against the pit', () => {
    for (const { art } of VARIANTS) {
      expect(contrast(art().trap.jaw, art().trap.pit)).toBeGreaterThanOrEqual(JAW_ON_PIT_MIN);
    }
  });

  it('outlines the parchment jaws in ink', () => {
    const art = parchmentArt();
    expect(tileLog('trap', art, { closed: true })).toContain(`strokeStyle = ${JSON.stringify(art.ink?.line)}`);
  });

  it('hatches the parchment recess on large tiles and washes it flat on small ones', () => {
    const clips = (size: number): number => tileLog('trap', parchmentArt(), { size }).filter((line) => line.startsWith('clip(')).length;
    expect(clips(TILE)).toBeGreaterThan(clips(SMALL_TILE));
  });

  it('draws nothing in the animated pass', () => {
    expect(tileLog('trap', plainArt(), { pass: 'animated' })).toEqual([]);
  });
});

describe('Runeward teleports and force floors', () => {
  const ids = [...TELEPORT_IDS, ...Object.keys(FORCE_IDS), 'force_random'];

  it.each(VARIANTS)('draws identical logs at two ticks under reduced motion in the $name drawing', ({ art }) => {
    for (const id of ids) {
      for (const pass of ['all', 'static', 'animated'] as const) {
        expect(tileLog(id, art(), { tick: 0, reduced: true, pass }), `${id} ${pass}`).toEqual(
          tileLog(id, art(), { tick: FAR_TICK, reduced: true, pass })
        );
      }
    }
  });

  it.each(VARIANTS)('moves with the clock in the animated pass when motion is allowed in the $name drawing', ({ art }) => {
    for (const id of ids) {
      expect(tileLog(id, art(), { tick: 0, pass: 'animated' }), id).not.toEqual(tileLog(id, art(), { tick: FAR_TICK, pass: 'animated' }));
    }
  });

  it.each(VARIANTS)('draws the static pass at clock 0 whatever the tick in the $name drawing', ({ art }) => {
    for (const id of ids) {
      expect(tileLog(id, art(), { tick: 0, pass: 'static' }), id).toEqual(tileLog(id, art(), { tick: FAR_TICK, pass: 'static' }));
    }
  });

  it('registers the teleports and force floors as animated tiles, and the trap and ice as static ones', () => {
    for (const id of ids) expect(RUNEWARD_PAINTERS.animatedTiles.has(id), id).toBe(true);
    for (const id of ['trap', 'ice', ...ICE_CORNER_IDS]) expect(RUNEWARD_PAINTERS.animatedTiles.has(id), id).toBe(false);
  });

  it('keeps the moving arcs of the parchment portal out of the static pass', () => {
    const arcs = (pass: RunewardTilePass): number => tileLog('teleport', parchmentArt(), { pass }).filter((line) => line.startsWith('arc(')).length;
    expect(arcs('animated')).toBeGreaterThan(0);
    expect(arcs('all')).toBe(arcs('static') + arcs('animated'));
  });

  it('draws a gold rim and ink rings on the parchment portal', () => {
    const art = parchmentArt();
    const lines = tileLog('teleport', art, { pass: 'static' });
    expect(lines).toContain(`strokeStyle = ${JSON.stringify(art.ink?.gold)}`);
    expect(lines).toContain(`strokeStyle = ${JSON.stringify(art.ink?.line)}`);
  });

  it('rings a coloured plain teleport in its colour', () => {
    const art = plainArt();
    expect(tileLog('teleport_red', art)).toContain(`strokeStyle = ${JSON.stringify(art.keys.red.main)}`);
    expect(tileLog('teleport', art)).toContain(`strokeStyle = ${JSON.stringify(art.portal.ring)}`);
  });
});

describe('Runeward force floors', () => {
  it('matches the push direction the game gives each force tile', () => {
    for (const [id, direction] of Object.entries(FORCE_IDS)) expect(ConfigRegistry.getTile(id).forceDirection, id).toBe(direction);
    expect(ConfigRegistry.getTile('force_random').forceDirection).toBe('RANDOM');
  });

  it.each(VARIANTS)('points every chevron where the tile pushes in the $name drawing', ({ art }) => {
    for (const [id, direction] of Object.entries(FORCE_IDS)) {
      for (const pass of ['static', 'animated'] as const) {
        const chevrons = chevronsOf(tileLog(id, art(), { pass, tick: 21 }));
        expect(chevrons.length, `${id} ${pass}`).toBeGreaterThanOrEqual(CHEVRONS_AT_REST);
        for (const chevron of chevrons) expect(pointing(chevron, FORCE_VECTOR[direction]), `${id} ${pass}`).toBeGreaterThan(0);
      }
    }
  });

  it.each(VARIANTS)('draws three chevrons at rest, in line through the middle of the tile, in the $name drawing', ({ art }) => {
    for (const [id, direction] of Object.entries(FORCE_IDS)) {
      const chevrons = chevronsOf(tileLog(id, art(), { pass: 'static' }));
      expect(chevrons.length, id).toBe(CHEVRONS_AT_REST);
      const [dx, dy] = FORCE_VECTOR[direction];
      for (const chevron of chevrons) {
        expect(chevron.tip[0] * Math.abs(dy) + chevron.tip[1] * Math.abs(dx), id).toBeCloseTo(TILE / 2, 3);
      }
    }
  });

  it('moves the chevrons along the push, not against it', () => {
    for (const [id, direction] of Object.entries(FORCE_IDS)) {
      const vector = FORCE_VECTOR[direction];
      const lead = (tick: number): number => {
        const tips = chevronsOf(tileLog(id, plainArt(), { pass: 'animated', tick })).map((c) => along(c.tip, vector));
        return Math.max(...tips.filter((value) => value < along([TILE / 2, TILE / 2], vector) + TILE * JAW_TRAVEL_MIN_TILE * 2));
      };
      expect(lead(SHORT_TICK), id).toBeGreaterThan(lead(0));
    }
  });

  it.each(VARIANTS)('draws the random floor as a pinwheel pointing four ways in the $name drawing', ({ art }) => {
    const chevrons = chevronsOf(tileLog('force_random', art(), { pass: 'static' }));
    expect(chevrons.length).toBe(PINWHEEL_ARMS);
    expect(new Set(chevrons.map(heading)).size).toBe(PINWHEEL_ARMS);
    for (const chevron of chevrons) {
      const outward = [chevron.tip[0] - TILE / 2, chevron.tip[1] - TILE / 2] as const;
      expect(pointing(chevron, [Math.sign(Math.round(outward[0])), Math.sign(Math.round(outward[1]))]), heading(chevron)).toBeGreaterThan(0);
    }
  });

  it('keeps the plain chevrons at 3:1 or more against the underlay', () => {
    const art = plainArt();
    expect(contrast(art.force.arrow, art.force.base)).toBeGreaterThanOrEqual(ARROW_ON_BASE_MIN);
  });

  it('outlines the parchment chevrons in ink on a hatched underlay', () => {
    const art = parchmentArt();
    const lines = tileLog('force_e', art, { pass: 'static' });
    expect(lines).toContain(`strokeStyle = ${JSON.stringify(art.ink?.line)}`);
    expect(lines).toContain(`strokeStyle = ${JSON.stringify(art.ink?.hatch)}`);
    expect(Math.max(...lineWidths(lines))).toBeGreaterThan(Math.max(...lineWidths(tileLog('force_e', plainArt(), { pass: 'static' }))));
  });

  it.each(VARIANTS)('keeps the chevrons pointing the right way on a small tile in the $name drawing', ({ art, smallCount }) => {
    for (const [id, direction] of Object.entries(FORCE_IDS)) {
      const chevrons = chevronsOf(tileLog(id, art(), { pass: 'static', size: SMALL_TILE }));
      expect(chevrons.length, id).toBe(smallCount);
      for (const chevron of chevrons) expect(pointing(chevron, FORCE_VECTOR[direction]), id).toBeGreaterThan(0);
    }
  });

  it.each([SMALL_TILE, SMALL_TILE + 3])('keeps the parchment chevron outlines apart at %i px, below the hatching size', (size) => {
    for (const [id, direction] of Object.entries(FORCE_IDS)) {
      const lines = tileLog(id, parchmentArt(), { pass: 'static', size });
      const vector = FORCE_VECTOR[direction];
      const chevrons = chevronsOf(lines).sort((a, b) => along(a.tip, vector) - along(b.tip, vector));
      const outline = Math.max(...lineWidths(lines));
      for (let i = 1; i < chevrons.length; i += 1) {
        const reach = (c: Chevron): number => along(c.tip, vector) - Math.min(along(c.tail1, vector), along(c.tail2, vector));
        const gap = along(chevrons[i].tip, vector) - reach(chevrons[i]) - along(chevrons[i - 1].tip, vector) - outline;
        expect(gap, `${id} ${size}`).toBeGreaterThan(0);
      }
    }
  });
});

describe('Runeward ice', () => {
  it.each(VARIANTS)('calls the shared bend with the geometry of each corner tile in the $name drawing', ({ art }) => {
    for (const id of ICE_CORNER_IDS) {
      vi.mocked(paintIceBend).mockClear();
      tileLog(id, art());
      const calls = vi.mocked(paintIceBend).mock.calls;
      expect(calls.length, id).toBe(1);
      const [, bend, cellX, cellY, cellSize, inset] = calls[0];
      expect(bend, id).toEqual(iceBendGeometry(ConfigRegistry.getTile(id)));
      expect([cellX, cellY, cellSize, inset], id).toEqual([0, 0, TILE, 0]);
    }
  });

  it('gives the four corners four different bends', () => {
    const keys = ICE_CORNER_IDS.map((id) => JSON.stringify(iceBendGeometry(ConfigRegistry.getTile(id))));
    expect(new Set(keys).size).toBe(ICE_CORNER_IDS.length);
  });

  it.each(VARIANTS)('paints the wall quadrant of a bend in the wall top colour in the $name drawing', ({ art }) => {
    tileLog('ice_nw', art());
    expect(vi.mocked(paintIceBend).mock.calls.at(-1)?.[6].wall).toBe(art().wall.top);
  });

  it('cross-hatches the wall quadrant in the parchment drawing only', () => {
    const clips = (art: RunewardArtConfig): number => tileLog('ice_se', art).filter((line) => line === 'clip("evenodd")').length;
    expect(clips(parchmentArt())).toBe(1);
    expect(clips(plainArt())).toBe(0);
  });

  it('varies the cracks with the cell hash and keeps them still', () => {
    const other = { ...CELL, hash: CELL.hash + 1 };
    expect(tileLog('ice', plainArt(), { cell: CELL })).not.toEqual(tileLog('ice', plainArt(), { cell: other }));
    expect(tileLog('ice', plainArt(), { cell: CELL, tick: 0 })).toEqual(tileLog('ice', plainArt(), { cell: CELL, tick: FAR_TICK }));
  });

  it.each(VARIANTS)('draws nothing in the animated pass of ice and corners in the $name drawing', ({ art }) => {
    for (const id of ['ice', ...ICE_CORNER_IDS]) expect(tileLog(id, art(), { pass: 'animated' }), id).toEqual([]);
  });

  it('keeps the plain ice apart from the floor, and the parchment ice outline apart from the paper', () => {
    expect(contrast(plainArt().ice.base, plainArt().floor.base)).toBeGreaterThanOrEqual(ICE_ON_FLOOR_MIN);
    expect(contrast(parchmentArt().ice.base, parchmentArt().floor.base)).toBeGreaterThanOrEqual(PARCHMENT_ICE_ON_PAPER_MIN);
    expect(contrast(parchmentArt().ice.edge, parchmentArt().floor.base)).toBeGreaterThanOrEqual(ICE_EDGE_ON_PAPER_MIN);
  });
});

describe('Runeward hazard dispatch', () => {
  it('moves every implemented hazard id out of the fallback', () => {
    const ids = ['trap', 'ice', ...ICE_CORNER_IDS, ...TELEPORT_IDS, ...Object.keys(FORCE_IDS), 'force_random'];
    for (const id of ids) {
      expect(RUNEWARD_PAINTERS.tiles[id], id).toBeDefined();
      expect(RUNEWARD_FALLBACK.has(id), id).toBe(false);
    }
  });

  it('uses the glyph radius of the shared teleport drawing', () => {
    expect(TELEPORT_GLYPH_RADIUS).toBe(TELEPORT_GLYPH_RADIUS_TILE);
  });
});
