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
import { ProceduralGenerator } from '../core/ProceduralGenerator';
import { SeededRandom } from '../core/Random';
import { cellReachableWithout, replays } from '../test/levelChecks';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { profileFor } from './DifficultyProfile';
import { HubDependency, HubPlan, HubPlanner } from './HubPlanner';
import { ALL_ORIENTATIONS, compilePiece, orientPiece } from './PieceCompiler';
import { PieceSolver } from './PieceSolver';
import { CompiledPiece } from './PieceTypes';

const PLAN_SEEDS = 40;
const ENDLESS_LEVELS = [10, 20];
const PACK_LEVEL = 6;
/** Share of the planned endless levels that must hold at least one pair. */
const MIN_SHARE_WITH_PAIR = 0.8;
const MIN_EXPORTERS = 4;
const MIN_CONSUMERS = 4;
const LEVEL_SEEDS = [1, 2];
const LEVEL_TEST_TIMEOUT_MS = 180000;
const LIBRARY_TIMEOUT_MS = 120000;

describe('hub dependencies', () => {
  let library: CompiledPiece[] = [];
  let exporters: CompiledPiece[] = [];
  let consumers: CompiledPiece[] = [];

  beforeAll(() => {
    loadTestConfigs();
    const legend = ConfigRegistry.getPieceLegend();
    const annotations = ConfigRegistry.getMotifAnnotations();
    library = ConfigRegistry.getMotifs().pieces.map((def) => compilePiece(def, legend, annotations[def.id]));
    exporters = library.filter((p) => p.exports !== null);
    consumers = library.filter((p) => p.imports !== null);
  });

  const plans = (mode: 'pack' | 'endless', level: number): HubPlan[] => {
    const cfg = ConfigRegistry.getGame().procedural!;
    const profile = profileFor(mode, level, cfg);
    const rules = ConfigRegistry.getMotifs().motifRules ?? {};
    return Array.from({ length: PLAN_SEEDS }, (_, i) =>
      HubPlanner.plan(profile, library, rules, new SeededRandom(i + 1), cfg.hub)
    );
  };

  /** Piece ids of a plan in the order the proof visits them. */
  const visited = (plan: HubPlan): string[] =>
    plan.order.flatMap((i) => [plan.wings[i].piece, ...plan.wings[i].then].map((p) => p.id));

  const wingOf = (plan: HubPlan, id: string): number =>
    plan.wings.findIndex((w) => [w.piece, ...w.then].some((p) => p.id === id));

  describe('library', () => {
    it('holds exporters and consumers of both kinds, with a partner for each', () => {
      expect(exporters.length).toBeGreaterThanOrEqual(MIN_EXPORTERS);
      expect(consumers.length).toBeGreaterThanOrEqual(MIN_CONSUMERS);
      for (const kind of ['block', 'item'] as const) {
        expect(exporters.some((p) => p.exports?.kind === kind)).toBe(true);
      }
      for (const e of exporters) {
        expect(
          consumers.some((c) => c.imports?.kind === e.exports?.kind && c.imports?.item === e.exports?.item),
          `${e.id} has no consumer`
        ).toBe(true);
      }
    });

    it(
      'every consumer is unsolvable without its import, and solvable with it in every orientation',
      () => {
        for (const c of consumers) {
          expect(PieceSolver.solve(c, { withoutImports: true }).solvable, `${c.id} without import`).toBe(false);
          for (const o of ALL_ORIENTATIONS) {
            expect(PieceSolver.solve(orientPiece(c, o)).solvable, `${c.id} ${JSON.stringify(o)}`).toBe(true);
          }
        }
      },
      LIBRARY_TIMEOUT_MS
    );

    it(
      'every exporter really exports: the key is needed to win, the block ends outside the exit',
      () => {
        for (const e of exporters) {
          const exchange = e.exports as NonNullable<CompiledPiece['exports']>;
          if (exchange.kind === 'item') {
            // Without the key lying inside, the piece cannot be won: the export is part of solving it.
            const items = e.items.map((row) => row.map((id) => (id === exchange.item ? null : id)));
            expect(PieceSolver.solve({ ...e, items }).solvable, `${e.id} wins without its key`).toBe(false);
          } else {
            // The annotated solution ends with the block on the cell beyond the exit, not inside.
            const level = PieceSolver.toLevel(e);
            expect(level.terrain[e.exit.y + 1][e.exit.x + 1], e.id).not.toBe('exit');
          }
          for (const o of ALL_ORIENTATIONS) {
            const oriented = orientPiece(e, o);
            expect(PieceSolver.wins(oriented, oriented.solution ?? []), `${e.id} ${JSON.stringify(o)}`).toBe(true);
          }
        }
      },
      LIBRARY_TIMEOUT_MS
    );
  });

  describe('planning', () => {
    it('asks for pairs from the configured difficulty on, and none below it', () => {
      const cfg = ConfigRegistry.getGame().procedural!;
      const rule = cfg.hub.dependencies;
      expect(HubPlanner.dependencyCount(rule.fromPieces - 1, cfg.hub)).toBe(0);
      expect(HubPlanner.dependencyCount(rule.fromPieces, cfg.hub)).toBe(1);
      expect(HubPlanner.dependencyCount(1000, cfg.hub)).toBe(rule.max);
    });

    it('gives most endless levels a pair, the consumer after the exporter in the proven order', () => {
      for (const level of ENDLESS_LEVELS) {
        let withPair = 0;
        for (const plan of plans('endless', level)) {
          if (plan.dependencies.length > 0) withPair++;
          const ids = visited(plan);
          for (const dep of plan.dependencies) {
            const at = ids.indexOf(dep.exporter);
            const later = ids.indexOf(dep.consumer);
            expect(at, `${dep.exporter} missing`).toBeGreaterThanOrEqual(0);
            expect(later, `${dep.consumer} missing`).toBeGreaterThan(at);
            if (dep.kind === 'block') {
              // A block is pushed along the corridor: the consumer comes right after, in the same wing.
              expect(later).toBe(at + 1);
              expect(wingOf(plan, dep.exporter)).toBe(wingOf(plan, dep.consumer));
            }
            expect(plan.wings[wingOf(plan, dep.consumer)].isFinal).toBe(false);
          }
          expect(HubPlanner.winningOrder(plan.wings, plan.hubItems)).toEqual(plan.order);
        }
        expect(withPair / PLAN_SEEDS, `level ${level}`).toBeGreaterThanOrEqual(MIN_SHARE_WITH_PAIR);
      }
    });

    it('never locks a wing with the colour a pair hands over', () => {
      for (const plan of plans('endless', ENDLESS_LEVELS[1])) {
        for (const dep of plan.dependencies.filter((d) => d.kind === 'item')) {
          for (const wing of plan.wings) expect(wing.gate.config?.item).not.toBe(dep.item);
          expect(plan.hubItems).not.toContain(dep.item);
        }
      }
    });

    it('keeps exchange pieces out of pack levels', () => {
      for (const plan of plans('pack', PACK_LEVEL)) {
        expect(plan.dependencies).toHaveLength(0);
        for (const wing of plan.wings) {
          for (const piece of [wing.piece, ...wing.then]) {
            expect(piece.exports, piece.id).toBeNull();
            expect(piece.imports, piece.id).toBeNull();
          }
        }
      }
    });

    it('rejects an order where the key is needed before it is found, or the block has no exporter', () => {
      const withItem = plans('endless', ENDLESS_LEVELS[1]).find((p) => p.dependencies.some((d) => d.kind === 'item'));
      expect(withItem).toBeDefined();
      const itemPair = (withItem as HubPlan).dependencies.find((d) => d.kind === 'item') as HubDependency;
      const exporterWing = (withItem as HubPlan).wings[wingOf(withItem as HubPlan, itemPair.exporter)];
      const exporter = exporterWing.piece.id === itemPair.exporter ? exporterWing.piece : exporterWing.then.find((p) => p.id === itemPair.exporter);
      // The exporter no longer hands its key over: the consumer's door cannot be opened.
      const stripped = { ...(exporter as CompiledPiece), exports: null };
      const wings = (withItem as HubPlan).wings.map((w) => ({
        ...w,
        piece: w.piece.id === itemPair.exporter ? stripped : w.piece,
        then: w.then.map((p) => (p.id === itemPair.exporter ? stripped : p))
      }));
      expect(HubPlanner.winningOrder(wings, (withItem as HubPlan).hubItems)).toBeNull();

      const withBlock = plans('endless', ENDLESS_LEVELS[1]).find((p) => p.dependencies.some((d) => d.kind === 'block'));
      expect(withBlock).toBeDefined();
      const blockPair = (withBlock as HubPlan).dependencies.find((d) => d.kind === 'block') as HubDependency;
      const swapped = (withBlock as HubPlan).wings.map((w) => {
        const chain = [w.piece, ...w.then];
        const at = chain.findIndex((p) => p.id === blockPair.exporter);
        if (at < 0) return w;
        [chain[at], chain[at + 1]] = [chain[at + 1], chain[at]];
        return { ...w, piece: chain[0], then: chain.slice(1) };
      });
      expect(HubPlanner.winningOrder(swapped, (withBlock as HubPlan).hubItems)).toBeNull();
    });
  });

  describe('generated levels', () => {
    it(
      'carry their pairs through the proof: the level replays and no puzzle can be walked around',
      () => {
        for (const level of ENDLESS_LEVELS) {
          for (const seed of LEVEL_SEEDS) {
            const g = ProceduralGenerator.generateEndlessLevel(level, seed);
            const id = g.level.id;
            expect(g.dependencies.length, id).toBeGreaterThan(0);
            for (const dep of g.dependencies) {
              expect(g.pieceMotifs.length, `${id} ${dep.exporter}`).toBeGreaterThan(0);
            }
            expect(replays(g.level, g.solution), id).toBe(true);
            for (const guard of g.guards) {
              expect(cellReachableWithout(g.level, guard.box, guard.guarded), `${id} ${JSON.stringify(guard)}`).toBe(false);
            }
          }
        }
      },
      LEVEL_TEST_TIMEOUT_MS
    );
  });
});
