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

vi.mock('../audio/AudioManager', () => import('../test/silentAudio'));

import { ConfigRegistry } from '../config/ConfigRegistry';
import { ALL_ORIENTATIONS, compilePiece, orientPiece, resetPieceCaches } from './PieceCompiler';
import { PieceSolver, SolverAction } from './PieceSolver';
import { CompiledPiece, PieceDefinition } from './PieceTypes';
import { loadTestConfigs } from '../test/loadTestConfigs';

/** The whole library is solved in 8 orientations; block puzzles take a moment. */
const LIBRARY_TIMEOUT_MS = 300000;
/** Monsters moving at random would make every state unique; pieces must not hold them. */
const RANDOM_MOVEMENT_PATTERNS = ['forward_else_random', 'pure_random'];
/** Arrival offsets, in steps, a monster piece must stay solvable from. */
const ARRIVAL_PHASES_CHECKED = 12;
/** Extra waits at the entry that a monster piece must survive, one replay each. */
const EXTRA_ENTRY_WAITS = [1, 2, 3, 4, 5, 6, 7, 8];
/** Entry waits tried in every rotation and mirror of a monster piece. */
const ORIENTED_ENTRY_WAITS = [0, 3, 7];
/** Live solving budget: a monster piece is searched in the browser, so it must stay small. */
const MONSTER_SOLVE_STATE_BUDGET = 25000;

function piece(rows: string[], extra: Partial<PieceDefinition> = {}): CompiledPiece {
  return compilePiece(
    { id: 'test_piece', motif: 'test', tier: 1, rows, ...extra },
    ConfigRegistry.getPieceLegend()
  );
}

/** Plays an action list on the piece alone; true when it ends in the piece's winning state. */
function winsWith(piece: CompiledPiece, actions: SolverAction[]): boolean {
  return PieceSolver.wins(piece, actions);
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
    const annotations = ConfigRegistry.getMotifAnnotations();
    pieces = definitions.map((def) => compilePiece(def, ConfigRegistry.getPieceLegend(), annotations[def.id]));
  });

  it('every piece carries an up-to-date annotation (npm run annotate:pieces)', () => {
    for (const p of pieces) expect(p.solution, `${p.id} is not annotated`).toBeDefined();
  });

  it('has unique piece ids and no monster that moves at random', () => {
    expect(new Set(definitions.map((d) => d.id)).size).toBe(definitions.length);
    for (const p of pieces) {
      for (const e of p.entities) {
        const pattern = ConfigRegistry.getEntityDef(e.type)?.movementPattern ?? '';
        expect(RANDOM_MOVEMENT_PATTERNS, `${p.id} ${e.type}`).not.toContain(pattern);
      }
    }
  });

  it(
    'every monster piece is solvable whenever the player arrives',
    () => {
      for (const p of pieces.filter((candidate) => PieceSolver.hasMonsters(candidate))) {
        for (let waits = 0; waits < ARRIVAL_PHASES_CHECKED; waits++) {
          expect(PieceSolver.solve(p, { startWaits: waits }).solvable, `${p.id} after ${waits} waits`).toBe(true);
        }
      }
    },
    LIBRARY_TIMEOUT_MS
  );

  it(
    'every monster piece still wins when the player waits at the entry first, within the live solving budget',
    () => {
      for (const p of pieces.filter((candidate) => PieceSolver.hasMonsters(candidate))) {
        for (const waits of EXTRA_ENTRY_WAITS) {
          const result = PieceSolver.solve(p, { startWaits: waits });
          expect(result.solvable, `${p.id} after ${waits} extra waits`).toBe(true);
          expect(result.statesExplored, `${p.id} search size`).toBeLessThanOrEqual(MONSTER_SOLVE_STATE_BUDGET);
          const replay = [...Array<SolverAction>(waits).fill('WAIT'), ...(result.moves ?? [])];
          expect(winsWith(p, replay), `${p.id} replay with ${waits} extra waits`).toBe(true);
        }
        for (const o of ALL_ORIENTATIONS) {
          const oriented = orientPiece(p, o);
          for (const waits of ORIENTED_ENTRY_WAITS) {
            expect(PieceSolver.solve(oriented, { startWaits: waits }).solvable, `${p.id} ${JSON.stringify(o)} after ${waits} waits`).toBe(true);
          }
        }
      }
    },
    LIBRARY_TIMEOUT_MS
  );

  it(
    'every annotated solution wins the piece in every allowed orientation',
    () => {
      for (const p of pieces) {
        const orientations = p.rotatable ? ALL_ORIENTATIONS : [ALL_ORIENTATIONS[0]];
        for (const o of orientations) {
          const oriented = orientPiece(p, o);
          // A mirror image turns a left-wall follower into a right-wall one: no stored solution.
          if (o.mirrored && PieceSolver.hasMonsters(p)) continue;
          expect(winsWith(oriented, oriented.solution ?? []), `${p.id} ${JSON.stringify(o)}`).toBe(true);
        }
      }
    },
    LIBRARY_TIMEOUT_MS
  );

  it(
    'no piece lets a block out or can be left unfinished, unless marked oneShot',
    () => {
      for (const p of pieces) {
        const analysis = PieceSolver.analyze(p);
        expect(analysis.truncated, p.id).toBe(false);
        expect(analysis.winnable, p.id).toBe(true);
        expect(analysis.blockEscapes, `${p.id} lets a block out through a port`).toBe(0);
        if (!p.oneShot) expect(analysis.deadExits, `${p.id} can be left unfinished`).toBe(0);
        expect(p.reversible, `${p.id} reversibility annotation`).toBe(analysis.unreturnableGoals === 0);
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
