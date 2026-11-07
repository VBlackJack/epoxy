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
 * Relay pad drawing: lit and dark are two states of one shape, a lit pad glows and fills its ring while a dark one
 * does not, neither matches the plain teleporter or the pocket gate pad, and the wired mark is a small plug. Also
 * checked through the Runeward painters in both inks.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { ConfigRegistry } from '../config/ConfigRegistry';
import type { RunewardArtConfig } from '../core/types';
import { createRecordedContext, countCalls } from '../test/runewardTestContext';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { NEIGHBOUR, type TileNeighbours } from './tileNeighbours';
import { RELAY_LIT_FILL_ALPHA, paintRelayPad, paintWiredMark, type RelayPadColours } from './relayArt';
import { RUNEWARD_PAINTERS } from './styles/runeward/runewardTiles';

const TILE = 48;
const COLOURS: RelayPadColours = { housing: '#000001', ring: '#000002', mark: '#000003', fill: '#000004' };
const CELL: Readonly<TileNeighbours> = { wallMask: 0, shadowMask: NEIGHBOUR.N, hash: 7, cx: 1, cy: 1 };

function padLines(lit: boolean, glow?: string): string[] {
  const { ctx, lines } = createRecordedContext();
  paintRelayPad(ctx, 0, 0, TILE, lit, COLOURS, glow === undefined ? {} : { glow });
  return lines;
}

describe('relay art', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('draws the same shape in both states, and fills the ring of a lit pad only', () => {
    const lit = padLines(true);
    const dark = padLines(false);
    expect(lit.join('\n')).not.toBe(dark.join('\n'));
    expect(lit).toContain(`globalAlpha = ${RELAY_LIT_FILL_ALPHA}`);
    expect(dark.filter((line) => line.startsWith('globalAlpha = '))).toEqual([]);
    // Housing, ring and wire are drawn in both: three strokes, and the two terminals as arcs after the ring.
    expect(countCalls(dark, 'stroke')).toBe(3);
    expect(countCalls(lit, 'stroke')).toBe(3);
    expect(countCalls(dark, 'arc')).toBe(3);
    expect(countCalls(lit, 'arc')).toBe(4);
  });

  it('glows only when lit and asked to', () => {
    expect(padLines(true, '#ff00ff').some((line) => line.startsWith('shadowBlur = '))).toBe(true);
    expect(padLines(false, '#ff00ff').some((line) => line.startsWith('shadowBlur = '))).toBe(false);
    expect(padLines(true).some((line) => line.startsWith('shadowBlur = '))).toBe(false);
  });

  it('keeps every line at least one pixel wide on a small tile', () => {
    const { ctx, lines } = createRecordedContext();
    paintRelayPad(ctx, 0, 0, 16, false, COLOURS, { crisp: true });
    const widths = lines.filter((line) => line.startsWith('lineWidth = ')).map((line) => Number(line.split(' = ')[1]));
    expect(widths.length).toBeGreaterThan(0);
    for (const width of widths) {
      expect(width).toBeGreaterThanOrEqual(1);
      expect(Number.isInteger(width)).toBe(true);
    }
  });

  it('draws the wired mark as a disc with two prongs, inside the cell', () => {
    const { ctx, lines } = createRecordedContext();
    paintWiredMark(ctx, 0, 0, TILE, { body: '#000005', edge: '#000006' });
    expect(countCalls(lines, 'arc')).toBe(1);
    expect(countCalls(lines, 'moveTo')).toBe(2);
    for (const line of lines.filter((l) => l.startsWith('arc(') || l.startsWith('moveTo(') || l.startsWith('lineTo('))) {
      const [x, y] = line.slice(line.indexOf('(') + 1, line.indexOf(')')).split(', ').map(Number);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(TILE);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(TILE);
    }
  });

  it('paints both Runeward pads in both inks, apart from each other and from the other pads', () => {
    const game = ConfigRegistry.getGame();
    const arts = [game.runewardArt, game.runewardArtVariants?.parchment] as RunewardArtConfig[];
    for (const art of arts) {
      const env = { timeTick: 0, signalPowered: false, reducedMotion: false, cache: new Map(), art };
      const log = (id: string): string => {
        const { ctx, lines } = createRecordedContext();
        RUNEWARD_PAINTERS.tiles[id](ctx, 0, 0, TILE, 'all', CELL, env, false, false);
        return lines.join('\n');
      };
      const drawings = ['relay_pad_lit', 'relay_pad_dark', 'pocket_gate_pad', 'teleport', 'floor'].map(log);
      expect(new Set(drawings).size).toBe(drawings.length);
    }
  });
});
