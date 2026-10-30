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
import { ProceduralConfig } from '../core/types';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { profileFor } from './DifficultyProfile';

const PACK_LEVELS = Array.from({ length: 12 }, (_, i) => i + 1);
const ENDLESS_LEVELS = Array.from({ length: 80 }, (_, i) => i + 1);

describe('profileFor', () => {
  let cfg: ProceduralConfig;

  beforeAll(() => {
    loadTestConfigs();
    cfg = ConfigRegistry.getGame().procedural!;
  });

  it('reproduces the legacy level-number formulas in pack mode', () => {
    for (const n of PACK_LEVELS) {
      const p = profileFor('pack', n, cfg);
      const last = (values: number[]): number => values[Math.min(values.length, n) - 1];
      expect(p.pieceCount).toBe(Math.min(cfg.maxPieceCount, cfg.basePieceCount + Math.floor((n - 1) / cfg.levelsPerExtraPiece)));
      expect(p.motifCount).toBe(last(cfg.motifCountByLevel));
      expect(p.maxTier).toBe(last(cfg.maxTierByLevel));
      expect(p.layout).toBe(n >= cfg.hub.fromLevel ? 'hub' : 'chain');
      expect(p.onboarding).toBe(n === 1);
      expect(p.allowOneShot).toBe(n >= cfg.oneShotFromLevel);
      expect(p.preferHard).toBe(n >= cfg.hardPiecesFromLevel);
      expect(p.timed).toBe(n > cfg.untimedUpToLevel);
      expect(p.regionSize).toBe(cfg.baseRegionSize + cfg.regionGrowthPerLevel * (n - 1));
      if (n <= 10) {
        expect(p.targetMoves).toBe(cfg.scoring.targetMovesBase + cfg.scoring.targetMovesPerLevel * (n - 1));
      }
    }
  });

  it('starts endless mode at full difficulty', () => {
    const p = profileFor('endless', 1, cfg);
    expect(p.layout).toBe('hub');
    expect(p.timed).toBe(true);
    expect(p.onboarding).toBe(false);
    expect(p.allowOneShot).toBe(true);
    expect(p.preferHard).toBe(true);
    expect(p.pieceCount).toBe(cfg.endless.pieceCountStart);
    expect(p.maxTier).toBe(cfg.endless.maxTierStart);
    expect(p.maxTier).toBeGreaterThanOrEqual(Math.max(...cfg.maxTierByLevel));
  });

  it('grows monotonically in endless mode and stays capped', () => {
    let previous = profileFor('endless', 1, cfg);
    for (const n of ENDLESS_LEVELS) {
      const p = profileFor('endless', n, cfg);
      expect(p.pieceCount).toBeGreaterThanOrEqual(previous.pieceCount);
      expect(p.motifCount).toBeGreaterThanOrEqual(previous.motifCount);
      expect(p.maxTier).toBeGreaterThanOrEqual(previous.maxTier);
      expect(p.targetMoves).toBeGreaterThanOrEqual(previous.targetMoves);
      expect(p.pieceCount).toBeLessThanOrEqual(cfg.endless.pieceCountMax);
      expect(p.motifCount).toBeLessThanOrEqual(cfg.endless.motifCountMax);
      expect(p.maxTier).toBeLessThanOrEqual(cfg.endless.maxTierMax);
      expect(p.targetMoves).toBeLessThanOrEqual(cfg.endless.targetMovesMax);
      previous = p;
    }
    expect(profileFor('endless', 500, cfg).pieceCount).toBe(cfg.endless.pieceCountMax);
    expect(profileFor('endless', 500, cfg).targetMoves).toBe(cfg.endless.targetMovesMax);
  });

  it('caps the scorer target in pack mode too', () => {
    expect(profileFor('pack', 500, cfg).targetMoves).toBe(cfg.scoring.targetMovesMax);
  });
});
