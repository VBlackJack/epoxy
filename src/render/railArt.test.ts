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
 * Rail piece drawing: every rail tile has its own look, a switch draws both its current form (full opacity) and
 * the other form (faded), and a fixed piece draws no faded form. Also checked through the Runeward painters.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { ConfigRegistry } from '../config/ConfigRegistry';
import type { RunewardArtConfig } from '../core/types';
import { createRecordedContext } from '../test/runewardTestContext';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { NEIGHBOUR, type TileNeighbours } from './tileNeighbours';
import { RAIL_OTHER_FORM_ALPHA, paintRailPiece, type RailColours } from './railArt';
import { RUNEWARD_PAINTERS } from './styles/runeward/runewardTiles';

const TILE = 48;
const COLOURS: RailColours = { outline: '#000001', sleeper: '#000002', rail: '#000003', buffer: '#000004' };
const CELL: Readonly<TileNeighbours> = { wallMask: 0, shadowMask: NEIGHBOUR.N, hash: 7, cx: 1, cy: 1 };

function railIds(): string[] {
  return Object.keys(ConfigRegistry.getTiles().tiles).filter((id) => ConfigRegistry.getTile(id).railSides !== undefined);
}

function paintId(id: string): string[] {
  const definition = ConfigRegistry.getTile(id);
  const other = definition.togglesTo === undefined ? undefined : ConfigRegistry.getTile(definition.togglesTo).railSides;
  const { ctx, lines } = createRecordedContext();
  paintRailPiece(ctx, 0, 0, TILE, definition.railSides ?? [], other, COLOURS);
  return lines;
}

/** The lines of a recorded drawing that set the global alpha. */
function alphaLines(lines: readonly string[]): string[] {
  return lines.filter((line) => line.startsWith('globalAlpha = '));
}

describe('rail art', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('gives each of the eight rail tiles a distinct drawing', () => {
    const ids = railIds();
    expect(ids).toHaveLength(8);
    expect(new Set(ids.map((id) => paintId(id).join('\n'))).size).toBe(ids.length);
  });

  it('draws a switch in its current form and its other form faded, and a fixed piece in one form only', () => {
    for (const id of ['rail_switch_a', 'rail_switch_b']) {
      expect(alphaLines(paintId(id)), id).toEqual([`globalAlpha = ${RAIL_OTHER_FORM_ALPHA}`, 'globalAlpha = 1']);
    }
    for (const id of railIds().filter((candidate) => !candidate.startsWith('rail_switch'))) {
      expect(alphaLines(paintId(id)), id).toEqual([]);
    }
    // The two switch positions are different pictures: the current bend is the bright one.
    expect(paintId('rail_switch_a').join('\n')).not.toBe(paintId('rail_switch_b').join('\n'));
  });

  it('puts a buffer bar on closed sides only, and none where the switch opens later', () => {
    // The buffers are the last path drawn: one move per bar.
    const bars = (id: string): number => {
      const lines = paintId(id);
      return lines.slice(lines.lastIndexOf('beginPath()')).filter((line) => line.startsWith('moveTo(')).length;
    };
    expect(bars('rail_ns')).toBe(2);
    expect(bars('rail_se')).toBe(2);
    // Switch A (S+E) closes N and W, but W opens in the other form, so only N keeps a bar.
    expect(bars('rail_switch_a')).toBe(1);
    expect(bars('rail_switch_b')).toBe(1);
  });

  it('paints the Runeward rails in both inks with the same two-form rule', () => {
    const game = ConfigRegistry.getGame();
    const arts = [game.runewardArt, game.runewardArtVariants?.parchment] as RunewardArtConfig[];
    for (const art of arts) {
      const env = { timeTick: 0, signalPowered: false, reducedMotion: false, cache: new Map(), art };
      const log = (id: string): string[] => {
        const { ctx, lines } = createRecordedContext();
        RUNEWARD_PAINTERS.tiles[id](ctx, 0, 0, TILE, 'all', CELL, env, false, false);
        return lines;
      };
      expect(alphaLines(log('rail_switch_a'))).toContain(`globalAlpha = ${RAIL_OTHER_FORM_ALPHA}`);
      expect(alphaLines(log('rail_ns'))).not.toContain(`globalAlpha = ${RAIL_OTHER_FORM_ALPHA}`);
      expect(new Set(railIds().map((id) => log(id).join('\n'))).size).toBe(8);
    }
  });
});
