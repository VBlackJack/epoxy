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
import { profileFor } from './DifficultyProfile';
import { HubPlanner } from './HubPlanner';
import { compilePiece, monsterCount } from './PieceCompiler';
import { CompiledPiece } from './PieceTypes';
import { ProgressionPlanner } from './ProgressionPlanner';

const SEEDS = 20;
const LEVEL_NUMBERS = [1, 25];

describe('monster density of planned pieces', () => {
  let library: CompiledPiece[] = [];
  let cfg: ProceduralConfig;

  beforeAll(() => {
    loadTestConfigs();
    cfg = ConfigRegistry.getGame().procedural!;
    const legend = ConfigRegistry.getPieceLegend();
    const annotations = ConfigRegistry.getMotifAnnotations();
    library = ConfigRegistry.getMotifs().pieces.map((def) => compilePiece(def, legend, annotations[def.id]));
  });

  const piece = (monsters: number, width: number, height: number): CompiledPiece => {
    const base = library.find((p) => monsterCount(p) > 0)!;
    return { ...base, width, height, entities: base.entities.slice(0, 1).flatMap((e) => Array(monsters).fill(e)) };
  };

  it('accepts a piece at exactly the limit and refuses one just under it', () => {
    const limit = cfg.minBoxCellsPerMonster;
    expect(ProgressionPlanner.meetsMonsterDensity(piece(2, limit, 2), cfg)).toBe(true);
    expect(ProgressionPlanner.meetsMonsterDensity(piece(2, limit - 1, 2), cfg)).toBe(false);
  });

  it('accepts a piece without monsters whatever its size', () => {
    expect(ProgressionPlanner.meetsMonsterDensity(piece(0, 1, 1), cfg)).toBe(true);
  });

  it('keeps every monster piece of the library within the limit', () => {
    for (const p of library.filter((q) => monsterCount(q) > 0)) {
      expect(ProgressionPlanner.meetsMonsterDensity(p, cfg), p.id).toBe(true);
    }
  });

  it('plans no piece under the limit and no more monsters than the cap, in endless hub levels', () => {
    const rules = ConfigRegistry.getMotifs().motifRules ?? {};
    for (const n of LEVEL_NUMBERS) {
      const profile = profileFor('endless', n, cfg);
      for (let seed = 1; seed <= SEEDS; seed++) {
        const plan = HubPlanner.plan(profile, library, rules, new SeededRandom(seed), cfg.hub);
        const pieces = plan.wings.flatMap((w) => [w.piece, ...w.then]);
        for (const p of pieces) {
          expect(ProgressionPlanner.meetsMonsterDensity(p, cfg), `${p.id} seed ${seed} level ${n}`).toBe(true);
        }
      }
    }
  }, 120000);

  it('never selects more monsters than the cap in one level', () => {
    const rules = ConfigRegistry.getMotifs().motifRules ?? {};
    for (const mode of ['pack', 'endless'] as const) {
      for (let n = 1; n <= 30; n++) {
        const profile = profileFor(mode, n, cfg);
        for (let seed = 1; seed <= SEEDS; seed++) {
          const { puzzles } = ProgressionPlanner.selectPuzzles(profile, library, rules, new SeededRandom(seed));
          const total = puzzles.reduce((sum, p) => sum + monsterCount(p), 0);
          expect(total, `${mode} ${n} seed ${seed}`).toBeLessThanOrEqual(cfg.maxMonstersPerLevel);
        }
      }
    }
  }, 120000);
});
