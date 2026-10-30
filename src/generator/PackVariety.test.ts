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
import { SeededRandom } from '../core/Random';
import { ProceduralConfig } from '../core/types';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { compilePiece } from './PieceCompiler';
import { CompiledPiece, MotifRule } from './PieceTypes';
import { hubShapeFor, leadChoiceFor, leadMotifFor } from './PackVariety';
import { ProgressionPlanner } from './ProgressionPlanner';

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
const LEVELS = Array.from({ length: 12 }, (_, i) => i + 1);
const PLAN_SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);
const ONBOARDING_SEEDS = Array.from({ length: 30 }, (_, i) => i + 1);

describe('pack variety', () => {
  let cfg: ProceduralConfig;
  let library: CompiledPiece[];

  beforeAll(() => {
    loadTestConfigs();
    cfg = ConfigRegistry.getGame().procedural!;
    const motifs = ConfigRegistry.getMotifs();
    const annotations = ConfigRegistry.getMotifAnnotations();
    library = motifs.pieces.map((def) => compilePiece(def, ConfigRegistry.getPieceLegend(), annotations[def.id]));
  });

  const rules = (): Record<string, MotifRule> => ConfigRegistry.getMotifs().motifRules ?? {};

  it('never repeats a lead motif within the no-repeat window', () => {
    for (const seed of SEEDS) {
      const leads = LEVELS.map((n) => leadMotifFor(n, seed, library, rules(), cfg));
      leads.forEach((lead, i) => {
        expect(lead, `seed ${seed} level ${i + 1}`).toBeDefined();
        for (let back = 1; back <= cfg.noRepeatWindow && i - back >= 0; back++) {
          expect(lead, `seed ${seed} level ${i + 1} against ${i + 1 - back}`).not.toBe(leads[i - back]);
        }
      });
    }
  });

  it('never repeats a hub outline within the window, and only draws hub levels', () => {
    expect(hubShapeFor(cfg.hub.fromLevel - 1, 1, cfg).preferred).toBeUndefined();
    for (const seed of SEEDS) {
      const shapes = LEVELS.filter((n) => n >= cfg.hub.fromLevel).map((n) => hubShapeFor(n, seed, cfg));
      shapes.forEach((choice, i) => {
        expect(choice.allowed).toContain(choice.preferred);
        for (let back = 1; back <= cfg.noRepeatWindow && i - back >= 0; back++) {
          expect(choice.preferred, `seed ${seed} hub ${i}`).not.toBe(shapes[i - back].preferred);
        }
      });
    }
  });

  it('derives a level from the seed alone: same answer, whatever was built before', () => {
    expect(leadMotifFor(9, 5, library, rules(), cfg)).toBe(leadMotifFor(9, 5, library, rules(), cfg));
    expect(hubShapeFor(9, 5, cfg)).toEqual(hubShapeFor(9, 5, cfg));
    const differing = SEEDS.filter((s) => leadMotifFor(6, s, library, rules(), cfg) !== leadMotifFor(6, 1, library, rules(), cfg));
    expect(differing.length).toBeGreaterThan(0);
  });

  it('puts a wanted lead motif first in the plan', () => {
    for (const seed of PLAN_SEEDS) {
      const lead = leadMotifFor(5, seed, library, rules(), cfg)!;
      const plan = ProgressionPlanner.plan(5, library, rules(), new SeededRandom(seed), undefined, lead);
      expect(plan.motifs[0]).toBe(lead);
    }
  });

  it('keeps the motifs drawn for the neighbouring levels out of a fallback', () => {
    for (const seed of SEEDS) {
      for (const n of [3, 5, 8]) {
        const { preferred, avoid } = leadChoiceFor(n, seed, library, rules(), cfg);
        const neighbours = [n - 2, n - 1, n + 1, n + 2].map((k) => leadMotifFor(k, seed, library, rules(), cfg));
        for (const lead of neighbours) expect(avoid, `seed ${seed} level ${n}`).toContain(lead);
        expect(avoid).not.toContain(preferred);
        const shape = hubShapeFor(n, seed, cfg);
        const shapeNeighbours = [n - 2, n - 1, n + 1, n + 2].map((k) => hubShapeFor(k, seed, cfg).preferred);
        for (const id of shapeNeighbours) {
          if (id && shape.allowed.length < cfg.hub.shapes.length) expect(shape.allowed, `seed ${seed} hub ${n}`).not.toContain(id);
        }
      }
    }
  });

  it('leads a relaxed plan with a motif outside the avoided ones when another exists', () => {
    for (const seed of PLAN_SEEDS) {
      const avoid = leadChoiceFor(5, seed, library, rules(), cfg).avoid;
      const plan = ProgressionPlanner.plan(5, library, rules(), new SeededRandom(seed), undefined, undefined, avoid);
      expect(avoid, `seed ${seed}`).not.toContain(plan.motifs[0]);
    }
  });

  it('never makes level 1 a motif kept for later, whatever the seed', () => {
    expect(cfg.firstLevelExcludedMotifs).toContain('monsters');
    for (const seed of ONBOARDING_SEEDS) {
      const lead = leadMotifFor(1, seed, library, rules(), cfg);
      expect(cfg.firstLevelExcludedMotifs, `seed ${seed} lead`).not.toContain(lead);
      const plan = ProgressionPlanner.plan(1, library, rules(), new SeededRandom(seed));
      for (const motif of plan.motifs) expect(cfg.firstLevelExcludedMotifs, `seed ${seed}`).not.toContain(motif);
      for (const step of plan.steps) expect(cfg.firstLevelExcludedMotifs, `seed ${seed}`).not.toContain(step.piece.motif);
    }
  });

  it('makes level 1 one tier-1 puzzle and the finale', () => {
    for (const seed of PLAN_SEEDS) {
      const plan = ProgressionPlanner.plan(1, library, rules(), new SeededRandom(seed));
      expect(plan.steps, `seed ${seed}`).toHaveLength(2);
      expect(plan.steps[0].piece.tier).toBe(1);
      expect(rules()[plan.steps[1].piece.motif]?.role).toBe('finale');
    }
  });

  it('meets puzzles that can be failed for good before the others', () => {
    let seen = 0;
    for (const seed of PLAN_SEEDS) {
      const plan = ProgressionPlanner.plan(2, library, rules(), new SeededRandom(seed));
      const puzzles = plan.steps.slice(0, -1).map((s) => ProgressionPlanner.isIrreversible(s.piece, cfg));
      if (puzzles.some(Boolean)) seen++;
      const firstSafe = puzzles.indexOf(false);
      if (firstSafe >= 0) expect(puzzles.slice(firstSafe).some(Boolean), `seed ${seed}`).toBe(false);
    }
    expect(seen).toBeGreaterThan(0);
  });
});
