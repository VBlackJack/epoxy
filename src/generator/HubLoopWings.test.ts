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
import { LevelMetrics } from '../core/LevelMetrics';
import { ProceduralGenerator } from '../core/ProceduralGenerator';
import { SeededRandom } from '../core/Random';
import { buildTestLevel } from '../test/buildTestLevel';
import { cellReachableWithout, replays } from '../test/levelChecks';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { profileFor } from './DifficultyProfile';
import { HubPlan, HubPlanner } from './HubPlanner';
import { compilePiece } from './PieceCompiler';
import { CompiledPiece } from './PieceTypes';

const PLAN_SEEDS = 40;
const ENDLESS_LEVEL = 10;
const LEVEL_SEEDS = [1, 2, 3];
const LEVEL_TEST_TIMEOUT_MS = 120000;
/**
 * Floor the walkable cell count of an endless level is expected to stay over. Its open floor is the
 * hub region, which carries monsters, chips and patches, not bays and nooks on every corridor:
 * 20 seeds at levels 10 and 20 measure a median of 341 to 352 and a minimum of 290.
 */
const MIN_WALKABLE_CELLS = 280;
const MAX_REVISIT_RATIO = 1.5;

describe('hub loop wings', () => {
  let library: CompiledPiece[] = [];

  beforeAll(() => {
    loadTestConfigs();
    const legend = ConfigRegistry.getPieceLegend();
    const annotations = ConfigRegistry.getMotifAnnotations();
    library = ConfigRegistry.getMotifs().pieces.map((def) => compilePiece(def, legend, annotations[def.id]));
  });

  const plans = (mode: 'pack' | 'endless', level: number): HubPlan[] => {
    const cfg = ConfigRegistry.getGame().procedural!;
    const profile = profileFor(mode, level, cfg);
    const rules = ConfigRegistry.getMotifs().motifRules ?? {};
    return Array.from({ length: PLAN_SEEDS }, (_, i) =>
      HubPlanner.plan(profile, library, rules, new SeededRandom(i + 1), cfg.hub)
    );
  };

  it('chains up to the configured number of puzzles per wing in endless mode, and keeps the final wing alone', () => {
    const cfg = ConfigRegistry.getGame().procedural!;
    let chained = 0;
    for (const plan of plans('endless', ENDLESS_LEVEL)) {
      for (const wing of plan.wings) {
        expect(wing.then.length + 1).toBeLessThanOrEqual(cfg.hub.maxPiecesPerWing);
        if (wing.isFinal) {
          expect(wing.loop).toBe(false);
          expect(wing.then).toHaveLength(0);
        } else {
          expect(wing.loop).toBe(true);
        }
        if (wing.then.length > 0) chained++;
      }
    }
    expect(chained).toBeGreaterThan(0);
  });

  it('keeps pack mode on dead-end wings', () => {
    for (const plan of plans('pack', 6)) {
      for (const wing of plan.wings) {
        expect(wing.loop).toBe(false);
        expect(wing.then).toHaveLength(0);
      }
    }
  });

  it('keeps the boots that defeat the return strip out of a loop level, and its material out of the locks', () => {
    const cfg = ConfigRegistry.getGame().procedural!;
    const item = cfg.hub.returnGate.item;
    for (const plan of plans('endless', ENDLESS_LEVEL)) {
      expect(plan.hubItems).not.toContain(item);
      for (const wing of plan.wings) {
        expect(wing.rewards).not.toContain(item);
        expect(wing.gate.config?.item).not.toBe(item);
        expect(wing.gate.config?.terrain).not.toBe(cfg.hub.returnGate.terrain);
        for (const piece of [wing.piece, ...wing.then]) {
          expect(piece.requires).not.toContain(item);
          expect(piece.items.some((row) => row.includes(item))).toBe(false);
        }
      }
    }
  });

  it('admits puzzles that cannot be walked back into loop wings only', () => {
    const cfg = ConfigRegistry.getGame().procedural!;
    const irreversible = library.filter((p) => !HubPlanner.fitsWing(p) && HubPlanner.fitsLoopWing(p, cfg.hub));
    expect(irreversible.length).toBeGreaterThan(0);
  });

  describe('key economy', () => {
    const doorsOf = (plan: HubPlan, item: string): number[] =>
      plan.wings.flatMap((w, i) => (w.gate.kind === 'door' && w.gate.config?.item === item ? [i] : []));

    it('asks for scarce colours from the configured difficulty on, and none below it', () => {
      const cfg = ConfigRegistry.getGame().procedural!;
      const rule = cfg.hub.scarceGates;
      expect(HubPlanner.scarceCount(rule.fromPieces - 1, cfg.hub)).toBe(0);
      expect(HubPlanner.scarceCount(rule.fromPieces, cfg.hub)).toBe(1);
      expect(HubPlanner.scarceCount(1000, cfg.hub)).toBe(rule.max);
    });

    it('plans a colour with more doors than keys at first, and the key to the second door behind the first', () => {
      let scarcePlans = 0;
      for (const plan of plans('endless', ENDLESS_LEVEL)) {
        for (const item of plan.scarce) {
          const doors = doorsOf(plan, item);
          expect(doors.length).toBeGreaterThanOrEqual(2);
          // The extra key lies in the first wing that has the colour's door.
          expect(plan.wings[doors[0]].rewards).toContain(item);
        }
        if (plan.scarce.length > 0) scarcePlans++;
      }
      expect(scarcePlans).toBeGreaterThan(PLAN_SEEDS / 2);
    });

    it('finds an order that wins by searching keys and boots, final wing last, and the plan carries it', () => {
      for (const plan of plans('endless', ENDLESS_LEVEL)) {
        const found = HubPlanner.winningOrder(plan.wings, plan.hubItems);
        expect(found).not.toBeNull();
        expect(plan.order).toEqual(found);
        expect([...plan.order].sort((a, b) => a - b)).toEqual(plan.wings.map((_, i) => i));
        expect(plan.wings[plan.order[plan.order.length - 1]].isFinal).toBe(true);
      }
    });

    it('rejects a plan whose scarce key is missing', () => {
      const plan = plans('endless', ENDLESS_LEVEL).find((p) => p.scarce.length > 0) as HubPlan;
      const item = plan.scarce[0];
      const first = doorsOf(plan, item)[0];
      plan.wings[first].rewards = plan.wings[first].rewards.filter((id) => id !== item);
      expect(HubPlanner.winningOrder(plan.wings, plan.hubItems)).toBeNull();
    });

    it('leaves pack plans in their drawn order, with nothing scarce', () => {
      for (const plan of plans('pack', 6)) {
        expect(plan.scarce).toHaveLength(0);
        expect(plan.order).toEqual(plan.wings.map((_, i) => i));
      }
    });
  });

  describe('generated levels', () => {
    it(
      'hold every planned puzzle, no boots against the strip, and cannot be walked around',
      () => {
        const cfg = ConfigRegistry.getGame().procedural!;
        const planned = profileFor('endless', ENDLESS_LEVEL, cfg).pieceCount;
        for (const seed of LEVEL_SEEDS) {
          const g = ProceduralGenerator.generateEndlessLevel(ENDLESS_LEVEL, seed);
          const id = g.level.id;
          expect(g.pieceMotifs.length - 1, id).toBeGreaterThanOrEqual(planned - 1);
          expect(g.level.items.some((row) => row.includes(cfg.hub.returnGate.item)), id).toBe(false);
          expect(
            g.level.terrain.some((row) => row.some((t) => t === cfg.hub.returnGate.terrain || t.startsWith('force_'))),
            id
          ).toBe(true);
          expect(replays(g.level, g.solution), id).toBe(true);
          expect(g.guards.length, id).toBeGreaterThan(g.pieceMotifs.length - 1);
          for (const guard of g.guards) {
            expect(cellReachableWithout(g.level, guard.box, guard.guarded), `${id} ${JSON.stringify(guard)}`).toBe(false);
          }
          const metrics = LevelMetrics.measure(g.level);
          expect(metrics.walkableCells, id).toBeGreaterThanOrEqual(MIN_WALKABLE_CELLS);
          expect(metrics.revisitRatio ?? 0, id).toBeLessThanOrEqual(MAX_REVISIT_RATIO);
        }
      },
      LEVEL_TEST_TIMEOUT_MS
    );
  });

  describe('guard check on a one-way strip', () => {
    // A box on the straight way to the target, and a second way round that
    // climbs a force floor pushing south, against the climber.
    const rows = ['#########', '#@..X.T.#', '#.#####.#', '#.......#'];
    const BOX = { x0: 4, y0: 1, x1: 4, y1: 1 };
    const TARGET = { x: 6, y: 1 };
    const STRIP = { x: 7, y: 2 };

    const levelWithStrip = () => {
      const level = buildTestLevel(rows.map((r) => r.replace('X', '.')));
      level.terrain[STRIP.y][STRIP.x] = 'force_s';
      return level;
    };

    it('does not let the target be reached up the strip', () => {
      expect(cellReachableWithout(levelWithStrip(), BOX, TARGET)).toBe(false);
    });

    it('lets the strip be climbed in a level that holds the boots against it', () => {
      const level = levelWithStrip();
      level.items[3][3] = ConfigRegistry.getGame().procedural!.hub.returnGate.item;
      expect(cellReachableWithout(level, BOX, TARGET)).toBe(true);
    });

    it('lets the strip be walked in its own direction', () => {
      const level = levelWithStrip();
      const down = { x0: 1, y0: 2, x1: 1, y1: 2 };
      level.terrain[2][1] = 'force_s';
      // The way down the left side is pushed along: still open, the target is reached by the right side.
      expect(cellReachableWithout(level, BOX, TARGET)).toBe(false);
      expect(cellReachableWithout(level, down, { x: 1, y: 3 })).toBe(true);
    });
  });
});
