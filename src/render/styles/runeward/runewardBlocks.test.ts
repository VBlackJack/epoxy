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
 * The Runeward block and mirror painters: the glyph and the colours of the colour blocks, the arrows of the
 * arrow blocks against the push rule of the engine, the legibility of the block faces on the floor, the
 * glass of the mirrors against the beam geometry, the ink of the parchment drawing and the dispatch tables.
 * When a contrast pair fails, the colours in game.json change, never the thresholds below.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { ConfigRegistry } from '../../../config/ConfigRegistry';
import { MIRROR_FRONT_AXIS } from '../../../core/coreConstants';
import { allowedPushDirs } from '../../../core/epoxy/epoxyArrowBlocks';
import type { Direction, MirrorCorner, RunewardArtConfig, RunewardKeyColour, RuntimeEntity } from '../../../core/types';
import { loadTestConfigs } from '../../../test/loadTestConfigs';
import { createRecordedContext } from '../../../test/runewardTestContext';
import { paintColorGlyph } from '../../colorGlyph';
import {
  ENTITIES,
  PENDING,
  blockFaceCentre,
  COLOUR_GLYPH_RADIUS,
  directionAngle,
  mirrorBackingCorner,
  mirrorBackingTriangle,
  mirrorGlassSegment
} from './runewardBlocks';
import { RUNEWARD_FALLBACK, RUNEWARD_PAINTERS, type RunewardPaintEnv } from './runewardTiles';

const TILE = 48;
const FACE_ON_FLOOR_MIN = 3;
const GLYPH_ON_FACE_MIN = 3;
const ROUND_FACTOR = 10000;
const QUARTER_TURN = Math.PI / 2;
/** Inset of the glass panel in a plain mirror and half the gap of the double ink line, in tiles. */
const PANEL_INSET = 0.2;
const INK_HALF_GAP = 0.05;
/** Inset of the stone of a one-sided mirror from the edge of the cell, in tiles. */
const STONE_INSET = 0.06;
const TURNS_PER_CIRCLE = 4;
const FACINGS: readonly Direction[] = ['N', 'E', 'S', 'W'];
const CHANNELS: readonly RunewardKeyColour[] = ['red', 'blue', 'yellow', 'green'];
const ARROW_BLOCK_IDS = ['arrow_block_one', 'arrow_block_line', 'arrow_block_corner', 'arrow_block_tee', 'arrow_block_cross', 'arrow_block_none'];
const MIRROR_IDS = ['mirror_slash', 'mirror_backslash'];
const ONE_SIDED: readonly MirrorCorner[] = ['NE', 'NW', 'SE', 'SW'];
const PAINTED_IDS = [
  'dirt_block', 'dirt_block_3d', 'ice_block', 'ice_block_3d', ...CHANNELS.map((c) => `color_block_${c}`), ...ARROW_BLOCK_IDS, ...MIRROR_IDS,
  ...ONE_SIDED.map((c) => `one_sided_mirror_${c.toLowerCase()}`)
];

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

function variants(): [string, RunewardArtConfig][] {
  return [['plain', plainArt()], ['parchment', parchmentArt()]];
}

function envOf(art: RunewardArtConfig): RunewardPaintEnv {
  return { timeTick: 0, signalPowered: false, reducedMotion: false, cache: new Map(), art };
}

function entityLog(id: string, dir: Direction, art: RunewardArtConfig): string[] {
  const { ctx, lines } = createRecordedContext();
  RUNEWARD_PAINTERS.entities[id](ctx, dir, 0, 0, TILE, envOf(art));
  return lines;
}

/** A number the way the recording context prints it. */
function printed(value: number): string {
  return String(Math.round(value * ROUND_FACTOR) / ROUND_FACTOR);
}

/** True when the lines hold `part` as consecutive lines. */
function containsRun(lines: readonly string[], part: readonly string[]): boolean {
  return lines.some((_, start) => part.every((line, offset) => lines[start + offset] === line));
}

/** Directions of the arrows drawn, read back from the quarter turns the drawing applies, in drawing order. */
function drawnArrowDirections(lines: readonly string[]): Direction[] {
  return lines
    .filter((line) => line.startsWith('rotate('))
    .map((line) => {
      const angle = Number(line.slice('rotate('.length, -1));
      const turns = ((Math.round(angle / QUARTER_TURN) % TURNS_PER_CIRCLE) + TURNS_PER_CIRCLE) % TURNS_PER_CIRCLE;
      return FACINGS[turns];
    });
}

function definitionOf(id: string): NonNullable<ReturnType<typeof ConfigRegistry.getEntityDef>> {
  const def = ConfigRegistry.getEntityDef(id);
  if (!def) throw new Error(`no definition for ${id}`);
  return def;
}

describe('Runeward block painters', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  it('paints every block and mirror id and no longer lists any as pending', () => {
    expect(PENDING).toEqual([]);
    expect(new Set(Object.keys(ENTITIES))).toEqual(new Set(PAINTED_IDS));
    for (const id of PAINTED_IDS) {
      expect(id in RUNEWARD_PAINTERS.entities).toBe(true);
      expect(RUNEWARD_FALLBACK.has(id)).toBe(false);
    }
  });

  it('draws something different for every block and mirror in both variants', () => {
    for (const [, art] of variants()) {
      const logs = PAINTED_IDS.filter((id) => !ARROW_BLOCK_IDS.includes(id)).map((id) => entityLog(id, 'N', art).join('\n'));
      expect(new Set(logs).size).toBe(logs.length);
    }
  });

  it('draws the plain art without ink and the parchment art with the ink line', () => {
    const plainInk = plainArt().ink;
    expect(plainInk).toBeUndefined();
    const ink = parchmentArt().ink as NonNullable<RunewardArtConfig['ink']>;
    for (const id of PAINTED_IDS) {
      expect(entityLog(id, 'N', parchmentArt())).toContain(`strokeStyle = ${JSON.stringify(ink.line)}`);
    }
  });

  it('hatches the front of the block with the ink hatching colour in the parchment art', () => {
    const ink = parchmentArt().ink as NonNullable<RunewardArtConfig['ink']>;
    for (const id of PAINTED_IDS) {
      expect(entityLog(id, 'N', parchmentArt())).toContain(`strokeStyle = ${JSON.stringify(ink.hatch)}`);
    }
  });

  describe('colour blocks', () => {
    it('takes the channel from the definition and the colours of that channel', () => {
      for (const colour of CHANNELS) {
        expect(definitionOf(`color_block_${colour}`).plateColor).toBe(colour);
        const plain = plainArt();
        expect(plain.block.colour[colour].base).toBe(plain.keys[colour].main);
        expect(plain.block.colour[colour].light).toBe(plain.keys[colour].light);
      }
    });

    it('draws the glyph of its channel, centred, in the glyph colour of the channel', () => {
      for (const [, art] of variants()) {
        const glyphs = new Set<string>();
        for (const colour of CHANNELS) {
          const centre = blockFaceCentre(TILE);
          const expected = createRecordedContext();
          paintColorGlyph(expected.ctx, colour, centre.x, centre.y, TILE * COLOUR_GLYPH_RADIUS, art.keys[colour].glyph);
          expect(expected.lines.length).toBeGreaterThan(0);
          expect(containsRun(entityLog(`color_block_${colour}`, 'N', art), expected.lines)).toBe(true);
          glyphs.add(expected.lines.join('\n'));
        }
        expect(glyphs.size).toBe(CHANNELS.length);
      }
    });

    it('fills each colour block with the base of its own channel', () => {
      for (const [, art] of variants()) {
        for (const colour of CHANNELS) {
          const log = entityLog(`color_block_${colour}`, 'N', art);
          expect(log.some((line) => line.includes(art.block.colour[colour].base))).toBe(true);
          for (const other of CHANNELS.filter((c) => c !== colour)) {
            if (art.block.colour[other].base === art.block.colour[colour].base) continue;
            expect(log.some((line) => line.includes(art.block.colour[other].base))).toBe(false);
          }
        }
      }
    });
  });

  describe('arrow blocks', () => {
    it('draws four different pictures for the four facings', () => {
      for (const [, art] of variants()) {
        // The locked block shows no arrow, so its facing cannot show: it is drawn the same whatever it faces.
        for (const id of ARROW_BLOCK_IDS.filter((blockId) => (definitionOf(blockId).pushArrows ?? []).length > 0)) {
          const logs = FACINGS.map((facing) => entityLog(id, facing, art).join('\n'));
          expect(new Set(logs).size).toBe(FACINGS.length);
        }
      }
    });

    it('draws one arrow per push arrow, pointing where the engine lets the block be pushed', () => {
      for (const [, art] of variants()) {
        for (const id of ARROW_BLOCK_IDS) {
          const def = definitionOf(id);
          for (const facing of FACINGS) {
            const entity = { type: id, dir: facing, facing } as unknown as RuntimeEntity;
            const allowed = allowedPushDirs(entity, def) as Direction[];
            const drawn = drawnArrowDirections(entityLog(id, facing, art));
            expect(drawn).toHaveLength((def.pushArrows ?? []).length);
            expect(drawn).toEqual(allowed);
          }
        }
      }
    });

    it('turns a north arrow by a quarter turn per step clockwise', () => {
      expect(FACINGS.map(directionAngle)).toEqual([0, QUARTER_TURN, QUARTER_TURN * 2, QUARTER_TURN * 3]);
    });
  });

  describe('legibility', () => {
    it('keeps the face of every block and the stone of the mirrors apart from the floor', () => {
      for (const [name, art] of variants()) {
        const faces: [string, string][] = [
          ['dirt', art.block.dirt.base],
          ['ice', art.block.ice.base],
          ['arrow', art.block.arrow.base],
          ['mirror', art.mirror.frame.base],
          ...CHANNELS.map((c): [string, string] => [c, art.block.colour[c].base])
        ];
        for (const [label, base] of faces) {
          expect(contrast(base, art.floor.base), `${name} ${label}`).toBeGreaterThanOrEqual(FACE_ON_FLOOR_MIN);
        }
      }
    });

    it('keeps the glyphs readable on their block faces', () => {
      for (const [name, art] of variants()) {
        expect(contrast(art.block.arrow.glyph, art.block.arrow.base), `${name} arrow`).toBeGreaterThanOrEqual(GLYPH_ON_FACE_MIN);
        for (const colour of CHANNELS) {
          expect(contrast(art.keys[colour].glyph, art.block.colour[colour].base), `${name} ${colour}`).toBeGreaterThanOrEqual(
            GLYPH_ON_FACE_MIN
          );
        }
      }
    });
  });

  describe('mirrors', () => {
    it('runs the glass along the axis of the definition, as the beam geometry has it', () => {
      const slash = mirrorGlassSegment('slash', TILE, 0);
      expect(slash.x1).toBeGreaterThan(slash.x0);
      expect(slash.y1).toBeLessThan(slash.y0);
      const backslash = mirrorGlassSegment('backslash', TILE, 0);
      expect(backslash.x1).toBeGreaterThan(backslash.x0);
      expect(backslash.y1).toBeGreaterThan(backslash.y0);
      expect(definitionOf('mirror_slash').mirrorAxis).toBe('slash');
      expect(definitionOf('mirror_backslash').mirrorAxis).toBe('backslash');
    });

    it('draws the glass of each plain mirror between the corners of its panel', () => {
      for (const [, art] of variants()) {
        for (const id of MIRROR_IDS) {
          const segment = mirrorGlassSegment(definitionOf(id).mirrorAxis ?? 'slash', TILE, PANEL_INSET);
          const run = [`moveTo(${printed(segment.x0)}, ${printed(segment.y0)})`, `lineTo(${printed(segment.x1)}, ${printed(segment.y1)})`];
          const log = entityLog(id, 'N', art);
          expect(containsRun(log, run), id).toBe(true);
          expect(log).toContain(`strokeStyle = ${JSON.stringify(art.mirror.glass)}`);
        }
        const slash = entityLog('mirror_slash', 'N', art).join('\n');
        const backslash = entityLog('mirror_backslash', 'N', art).join('\n');
        expect(slash).not.toBe(backslash);
      }
    });

    it('puts the stone backing of a one-sided mirror in the corner opposite its reflecting corner', () => {
      const opposite: Record<MirrorCorner, MirrorCorner> = { NE: 'SW', NW: 'SE', SE: 'NW', SW: 'NE' };
      for (const front of ONE_SIDED) {
        const id = `one_sided_mirror_${front.toLowerCase()}`;
        const def = definitionOf(id);
        expect(def.mirrorFrontCorner).toBe(front);
        expect(def.mirrorAxis).toBe(MIRROR_FRONT_AXIS[front]);
        expect(mirrorBackingCorner(front)).toBe(opposite[front]);
        const triangle = mirrorBackingTriangle(front, TILE);
        const backing = triangle[1];
        const east = opposite[front].endsWith('E');
        const south = opposite[front].startsWith('S');
        expect(backing[0] > TILE / 2).toBe(east);
        expect(backing[1] > TILE / 2).toBe(south);
        for (const [name, art] of variants()) {
          const log = entityLog(id, 'N', art);
          const run = triangle.map(([px, py], index) => `${index === 0 ? 'moveTo' : 'lineTo'}(${printed(px)}, ${printed(py)})`);
          expect(containsRun(log, run), `${name} ${id}`).toBe(true);
        }
      }
    });

    it('lays the glass of a one-sided mirror on the diagonal that cuts its reflecting corner off', () => {
      for (const front of ONE_SIDED) {
        const triangle = mirrorBackingTriangle(front, TILE);
        const [start, , end] = triangle;
        const segment = mirrorGlassSegment(MIRROR_FRONT_AXIS[front], TILE, STONE_INSET);
        expect([start[0], start[1], end[0], end[1]]).toEqual([segment.x0, segment.y0, segment.x1, segment.y1]);
        for (const [, art] of variants()) {
          const log = entityLog(`one_sided_mirror_${front.toLowerCase()}`, 'N', art);
          const run = [`moveTo(${printed(segment.x0)}, ${printed(segment.y0)})`, `lineTo(${printed(segment.x1)}, ${printed(segment.y1)})`];
          expect(containsRun(log, run)).toBe(true);
        }
      }
    });

    it('draws the glass as a double ink line in the parchment art and as a band in the plain art', () => {
      const parchment = entityLog('mirror_slash', 'N', parchmentArt());
      const segment = mirrorGlassSegment('slash', TILE, PANEL_INSET);
      const length = Math.hypot(segment.x1 - segment.x0, segment.y1 - segment.y0);
      const gap = TILE * INK_HALF_GAP;
      const normalX = (-(segment.y1 - segment.y0) / length) * gap;
      const normalY = ((segment.x1 - segment.x0) / length) * gap;
      for (const sign of [1, -1]) {
        const run = [
          `moveTo(${printed(segment.x0 + normalX * sign)}, ${printed(segment.y0 + normalY * sign)})`,
          `lineTo(${printed(segment.x1 + normalX * sign)}, ${printed(segment.y1 + normalY * sign)})`
        ];
        expect(containsRun(parchment, run)).toBe(true);
      }
      const plain = entityLog('mirror_slash', 'N', plainArt());
      expect(plain).toContain(`strokeStyle = ${JSON.stringify(plainArt().mirror.glassLight)}`);
      expect(parchment).not.toContain(`strokeStyle = ${JSON.stringify(parchmentArt().mirror.glassLight)}`);
    });
  });
});
