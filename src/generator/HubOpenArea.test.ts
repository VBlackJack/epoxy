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
import { GeneratedLevel, ProceduralGenerator } from '../core/ProceduralGenerator';
import { SeededRandom } from '../core/Random';
import { cellReachableWithout, replays } from '../test/levelChecks';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { openAreaViolations } from '../test/openAreaChecks';
import { profileFor } from './DifficultyProfile';
import { HubPlanner } from './HubPlanner';
import { compilePiece, monsterCount } from './PieceCompiler';
import { CompiledPiece } from './PieceTypes';

/**
 * One shared sample of 8 levels keeps this file under 40 seconds. The same
 * checks run on 40 levels (20 seeds at levels 10 and 20) in
 * tools/levelMetrics.report.ts, which reports the violation counts.
 */
const LEVEL_NUMBERS = [10, 20];
const SEEDS = [1, 2, 3, 4];
const SUITE_TIMEOUT_MS = 240000;
const MIN_SHARE_WITH_HUB_MONSTERS = 0.75;
const MIN_SHARE_ALL_PIECES_KEPT = 0.8;
/** The finale is the last entry of pieceMotifs and is not a planned puzzle. */
const FINALE_PIECES = 1;

interface Sample {
  generated: GeneratedLevel;
  planned: number;
}

describe('hub open area of an endless level', () => {
  const samples: Sample[] = [];

  beforeAll(() => {
    loadTestConfigs();
    const cfg = ConfigRegistry.getGame().procedural;
    if (!cfg) throw new Error('game.json has no procedural section');
    for (const n of LEVEL_NUMBERS) {
      for (const seed of SEEDS) {
        samples.push({
          generated: ProceduralGenerator.generateEndlessLevel(n, seed),
          planned: profileFor('endless', n, cfg).pieceCount
        });
      }
    }
  }, SUITE_TIMEOUT_MS);

  it('replays every level and leaves no puzzle to walk around', () => {
    expect(samples).toHaveLength(LEVEL_NUMBERS.length * SEEDS.length);
    for (const { generated } of samples) {
      expect(replays(generated.level, generated.solution), generated.level.id).toBe(true);
      for (const g of generated.guards) {
        expect(cellReachableWithout(generated.level, g.box, g.guarded), generated.level.id).toBe(false);
      }
    }
  });

  it('keeps the planned pieces in at least 80 percent of the levels', () => {
    const kept = samples.filter((s) => s.generated.pieceMotifs.length - FINALE_PIECES >= s.planned).length;
    expect(kept / samples.length).toBeGreaterThanOrEqual(MIN_SHARE_ALL_PIECES_KEPT);
  });

  it('puts hub monsters in at least 75 percent of the levels', () => {
    const withMonsters = samples.filter((s) => (s.generated.open?.monsters.length ?? 0) >= 1).length;
    expect(withMonsters / samples.length).toBeGreaterThanOrEqual(MIN_SHARE_WITH_HUB_MONSTERS);
  });

  // Monster count and types, chips as required, closed region, gravel, links, patches, reachability.
  it('keeps every open-area rule on every level', () => {
    for (const { generated } of samples) {
      expect(openAreaViolations(generated)).toEqual([]);
    }
  });
});

describe('hub open area planning', () => {
  let library: CompiledPiece[] = [];

  beforeAll(() => {
    loadTestConfigs();
    const legend = ConfigRegistry.getPieceLegend();
    const annotations = ConfigRegistry.getMotifAnnotations();
    library = ConfigRegistry.getMotifs().pieces.map((def) => compilePiece(def, legend, annotations[def.id]));
  });

  const profile = (pieceCount: number) => ({
    ...profileFor('endless', 1, ConfigRegistry.getGame().procedural!),
    pieceCount
  });

  it('asks for no monster under the configured difficulty, then one more per step, up to the maximum', () => {
    const cfg = ConfigRegistry.getGame().procedural!;
    const rule = cfg.hub.openMonsters;
    const quiet = library.find((p) => monsterCount(p) === 0) as CompiledPiece;
    const count = (pieces: number): number =>
      HubPlanner.openMonsterTypes([], quiet, profile(pieces), cfg.hub, new SeededRandom(1)).length;
    const cap = cfg.maxMonstersPerLevel;
    expect(count(rule.fromPieces - 1)).toBe(0);
    expect(count(rule.fromPieces)).toBe(Math.min(1, cap));
    expect(count(rule.fromPieces + rule.piecesPerMonster)).toBe(Math.min(2, rule.max, cap));
    expect(count(1000)).toBe(Math.min(rule.max, cap));
  });

  it('draws deterministic movers only, and leaves no room when the pieces already fill the cap', () => {
    const cfg = ConfigRegistry.getGame().procedural!;
    const quiet = library.find((p) => monsterCount(p) === 0) as CompiledPiece;
    const types = HubPlanner.openMonsterTypes([], quiet, profile(1000), cfg.hub, new SeededRandom(2));
    for (const type of types) expect(cfg.hub.openMonsters.types).toContain(type);
    const crowded = library.filter((p) => monsterCount(p) > 0);
    const pieces: CompiledPiece[] = [];
    while (pieces.reduce((sum, p) => sum + monsterCount(p), 0) < cfg.maxMonstersPerLevel) pieces.push(crowded[0]);
    expect(HubPlanner.openMonsterTypes(pieces, quiet, profile(1000), cfg.hub, new SeededRandom(3))).toHaveLength(0);
  });

  it('asks for more chips as the level grows, between the configured bounds', () => {
    const cfg = ConfigRegistry.getGame().procedural!.hub;
    expect(HubPlanner.openChipCount(0, cfg)).toBe(cfg.openChips.min);
    expect(HubPlanner.openChipCount(1000, cfg)).toBe(cfg.openChips.max);
    const sizes = [6, 8, 10].map((n) => HubPlanner.openChipCount(n, cfg));
    expect(sizes).toEqual([...sizes].sort((a, b) => a - b));
  });
});
