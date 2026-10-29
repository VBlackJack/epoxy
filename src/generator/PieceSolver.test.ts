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

import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../audio/AudioManager', () => ({
  AudioManager: new Proxy({}, { get: () => () => undefined })
}));

import { ConfigRegistry } from '../config/ConfigRegistry';
import { ALL_ORIENTATIONS, compilePiece, orientPiece, resetPieceCaches } from './PieceCompiler';
import { PieceSolver } from './PieceSolver';
import { CompiledPiece, PieceDefinition } from './PieceTypes';
import { loadTestConfigs } from '../test/loadTestConfigs';

/** The whole library is solved in 8 orientations; block puzzles take a moment. */
const LIBRARY_TIMEOUT_MS = 120000;

function piece(rows: string[], extra: Partial<PieceDefinition> = {}): CompiledPiece {
  return compilePiece(
    { id: 'test_piece', motif: 'test', tier: 1, rows, ...extra },
    ConfigRegistry.getPieceLegend()
  );
}

/** Same piece with the item at (x, y) replaced by bare floor. */
function withoutItem(source: CompiledPiece, x: number, y: number): CompiledPiece {
  const items = source.items.map((row) => [...row]);
  items[y][x] = null;
  return { ...source, items };
}

describe('PieceSolver', () => {
  beforeAll(() => {
    loadTestConfigs();
    resetPieceCaches();
  });

  it('solves a corridor with the shortest move list', () => {
    const result = PieceSolver.solve(piece(['#@#', '#.#', '#$#']));
    expect(result.solvable).toBe(true);
    expect(result.moves).toEqual(['S', 'S']);
  });

  it('requires every chip before the exit counts', () => {
    const result = PieceSolver.solve(piece(['##@##', '#C.##', '##$##']));
    expect(result.solvable).toBe(true);
    // over to the chip and back before going down
    expect(result.moves).toEqual(['S', 'W', 'E', 'S']);
  });

  it('reports an unsolvable piece', () => {
    expect(PieceSolver.solve(piece(['#@#', '###', '#$#'])).solvable).toBe(false);
  });

  it('starts with the carried items', () => {
    const fire = piece(['#@#', '#F#', '#$#'], { requires: ['boots_fire'] });
    expect(PieceSolver.solve(fire).solvable).toBe(true);
    expect(PieceSolver.solve(fire, { carried: [] }).solvable).toBe(false);
  });

  it('stops at the state bound', () => {
    const result = PieceSolver.solve(piece(['#@###', '#...#', '#...#', '###$#']), { maxStates: 2 });
    expect(result.truncated).toBe(true);
  });
});

describe('motif library', () => {
  let pieces: CompiledPiece[] = [];
  let definitions: PieceDefinition[] = [];

  beforeAll(() => {
    loadTestConfigs();
    resetPieceCaches();
    definitions = ConfigRegistry.getMotifs().pieces;
    pieces = definitions.map((def) => compilePiece(def, ConfigRegistry.getPieceLegend()));
  });

  it('has unique piece ids and no monsters', () => {
    expect(new Set(definitions.map((d) => d.id)).size).toBe(definitions.length);
    for (const p of pieces) {
      for (const e of p.entities) {
        expect(ConfigRegistry.getEntityDef(e.type)?.kind, `${p.id} ${e.type}`).toBe('block');
      }
    }
  });

  it(
    'every piece is solvable in every allowed orientation',
    () => {
      for (const p of pieces) {
        const orientations = p.rotatable ? ALL_ORIENTATIONS : [ALL_ORIENTATIONS[0]];
        for (const o of orientations) {
          const result = PieceSolver.solve(orientPiece(p, o));
          expect(result.solvable, `${p.id} ${JSON.stringify(o)}`).toBe(true);
        }
      }
    },
    LIBRARY_TIMEOUT_MS
  );

  it(
    'every required carried item is really needed',
    () => {
      for (const p of pieces.filter((candidate) => candidate.requires.length > 0)) {
        expect(PieceSolver.solve(p, { carried: [] }).solvable, p.id).toBe(false);
      }
    },
    LIBRARY_TIMEOUT_MS
  );

  it(
    'every key and pair of boots inside a piece is needed',
    () => {
      for (const p of pieces) {
        p.items.forEach((row, y) =>
          row.forEach((id, x) => {
            if (!id) return;
            const collectible = ConfigRegistry.getTile(id).collectible;
            if (collectible !== 'key' && collectible !== 'boot') return;
            const result = PieceSolver.solve(withoutItem(p, x, y));
            expect(result.solvable, `${p.id}: ${id} at ${x},${y} is decorative`).toBe(false);
          })
        );
      }
    },
    LIBRARY_TIMEOUT_MS
  );
});
