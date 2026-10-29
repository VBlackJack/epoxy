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
import {
  ALL_ORIENTATIONS,
  compilePiece,
  orientPiece,
  orientPoint,
  orientTileId,
  PieceError,
  resetPieceCaches
} from './PieceCompiler';
import { PieceDefinition } from './PieceTypes';
import { loadTestConfigs } from '../test/loadTestConfigs';

function definition(rows: string[], extra: Partial<PieceDefinition> = {}): PieceDefinition {
  return { id: 'test_piece', motif: 'test', tier: 1, rows, ...extra };
}

describe('compilePiece', () => {
  beforeEach(() => {
    loadTestConfigs();
    resetPieceCaches();
  });

  it('reads ports, items and entities from the merged legend', () => {
    const piece = compilePiece(
      definition(['#@#', '#&#', '#C#', '#$#']),
      ConfigRegistry.getPieceLegend()
    );
    expect(piece.entry).toEqual({ x: 1, y: 0 });
    expect(piece.exit).toEqual({ x: 1, y: 3 });
    expect(piece.items[2][1]).toBe('chip');
    expect(piece.entities).toEqual([{ x: 1, y: 1, type: 'dirt_block', dir: 'S' }]);
  });

  it('rejects an unknown character, a missing port and an inner port', () => {
    const legend = ConfigRegistry.getPieceLegend();
    expect(() => compilePiece(definition(['#@#', '#§#', '#$#']), legend)).toThrow(PieceError);
    expect(() => compilePiece(definition(['#@#', '#.#', '###']), legend)).toThrow(PieceError);
    expect(() => compilePiece(definition(['#@##', '#.$#', '####']), legend)).toThrow(PieceError);
  });
});

describe('orientation', () => {
  beforeEach(() => {
    loadTestConfigs();
    resetPieceCaches();
  });

  it('turns points clockwise and mirrors left-right', () => {
    // 3 wide, 2 high: the top-left corner goes to the top-right after one turn
    expect(orientPoint({ x: 0, y: 0 }, 3, 2, { quarterTurns: 1, mirrored: false })).toEqual({
      x: 1,
      y: 0
    });
    expect(orientPoint({ x: 0, y: 0 }, 3, 2, { quarterTurns: 0, mirrored: true })).toEqual({
      x: 2,
      y: 0
    });
  });

  it('finds the rotated counterpart of directional tiles from the config', () => {
    const quarter = { quarterTurns: 1, mirrored: false } as const;
    expect(orientTileId('force_n', quarter)).toBe('force_e');
    expect(orientTileId('force_w', { quarterTurns: 0, mirrored: true })).toBe('force_e');
    expect(orientTileId('floor', quarter)).toBe('floor');
    for (const o of ALL_ORIENTATIONS) {
      expect(orientTileId('ice_nw', o)).not.toBeNull();
    }
  });

  it('turning four times gives the piece back', () => {
    const piece = compilePiece(
      definition(['#@###', '#.>I#', '##.C#', '###$#']),
      ConfigRegistry.getPieceLegend()
    );
    let turned = piece;
    for (let i = 0; i < 4; i++) turned = orientPiece(turned, { quarterTurns: 1, mirrored: false });
    expect(turned.terrain).toEqual(piece.terrain);
    expect(turned.entry).toEqual(piece.entry);
  });
});
